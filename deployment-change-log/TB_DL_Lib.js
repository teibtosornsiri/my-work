/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * TB_DL_Lib — ของกลางของชุด Deployment Change Log
 *   - ชื่อ record / field / list (ตรงกับ spec หัวข้อ 4)
 *   - แปลงชื่อค่าใน custom list → internal id (SB กับ PROD id ไม่ตรงกัน จึงอ้างด้วยชื่อ)
 *   - ดึง System Notes, Change Log, รายชื่อผู้มีสิทธิ์ deploy, SHA-1 ของไฟล์
 *   - reconcile(): จับคู่การเปลี่ยนแปลงจริงกับ CR → Matched / Exception E1–E6 (pure function ทดสอบนอก NS ได้)
 *
 * ตัวแปรระดับไฟล์ตั้งชื่อขึ้นต้น tbdl เพื่อไม่ชนกับไฟล์ผู้เรียก (scope ร่วมกันใน dependency tree)
 */
define(['N/query', 'N/file', 'N/crypto', 'N/encode', 'N/runtime', './TB_DL_Config'],
    (tbdlQuery, tbdlFile, tbdlCrypto, tbdlEncode, tbdlRuntime, CFG) => {

        const REC = {
            LOG: 'customrecord_tb_deploy_log',
            OBJ: 'customrecord_tb_deploy_obj',
            EXC: 'customrecord_tb_deploy_exc',
            SIGN: 'customrecord_tb_deploy_signoff'
        };

        const F = {
            desc: 'custrecord_tbdl_desc',
            type: 'custrecord_tbdl_type',
            risk: 'custrecord_tbdl_risk',
            requester: 'custrecord_tbdl_requester',
            approver: 'custrecord_tbdl_approver',
            approveDate: 'custrecord_tbdl_approve_date',
            developer: 'custrecord_tbdl_developer',
            uatBy: 'custrecord_tbdl_uat_by',
            uatDate: 'custrecord_tbdl_uat_date',
            deployer: 'custrecord_tbdl_deployer',
            deployDate: 'custrecord_tbdl_deploy_date',
            method: 'custrecord_tbdl_method',
            sdfRef: 'custrecord_tbdl_sdf_ref',
            rollback: 'custrecord_tbdl_rollback',
            verifiedBy: 'custrecord_tbdl_verified_by',
            verifiedDate: 'custrecord_tbdl_verified_date',
            status: 'custrecord_tbdl_status',
            history: 'custrecord_tbdl_history',
            // Affected Object (child)
            oParent: 'custrecord_tbdo_parent',
            oType: 'custrecord_tbdo_objtype',
            oKey: 'custrecord_tbdo_objkey',
            oProdId: 'custrecord_tbdo_prod_id',
            oAction: 'custrecord_tbdo_action',
            oSha1: 'custrecord_tbdo_sha1',
            // Exception explanation
            eCode: 'custrecord_tbde_code',
            eObject: 'custrecord_tbde_object',
            eChangeTs: 'custrecord_tbde_change_ts',
            eActor: 'custrecord_tbde_actor',
            eExplain: 'custrecord_tbde_explain',
            eResolution: 'custrecord_tbde_resolution',
            eCr: 'custrecord_tbde_cr',
            eBy: 'custrecord_tbde_by',
            eDate: 'custrecord_tbde_date',
            // Sign-off
            sFrom: 'custrecord_tbds_from',
            sTo: 'custrecord_tbds_to',
            sTotal: 'custrecord_tbds_total',
            sMatched: 'custrecord_tbds_matched',
            sExceptions: 'custrecord_tbds_exceptions',
            sFile: 'custrecord_tbds_file',
            sReviewer: 'custrecord_tbds_reviewer',
            sSignedDate: 'custrecord_tbds_signed_date',
            sStatus: 'custrecord_tbds_status',
            sNote: 'custrecord_tbds_note'
        };

        const LIST = {
            status: 'customlist_tbdl_status',
            type: 'customlist_tbdl_type',
            risk: 'customlist_tbdl_risk',
            method: 'customlist_tbdl_method',
            objtype: 'customlist_tbdl_objtype',
            action: 'customlist_tbdl_action'
        };

        /** ชื่อค่าใน list ต้องตรงตัวอักษรกับที่สร้างใน NetSuite */
        const S = {
            DRAFT: 'Draft',
            PENDING: 'Pending Approval',
            APPROVED: 'Approved',
            UAT: 'UAT Passed',
            DEPLOYED: 'Deployed',
            VERIFIED: 'Verified',
            ROLLED_BACK: 'Rolled back',
            REJECTED: 'Rejected'
        };
        const EMERGENCY = 'Emergency fix';
        const DONE_STATUSES = [S.DEPLOYED, S.VERIFIED];

        const EXC = {
            E1: 'มีการเปลี่ยนแปลงแต่ไม่มี CR รองรับ',
            E2: 'เปลี่ยนก่อนวันที่อนุมัติ',
            E3: 'ผู้แก้ไม่ใช่ผู้ deploy ของ CR หรือไม่อยู่ในรายชื่อผู้มีสิทธิ์',
            E4: 'SHA-1 ของไฟล์ใน PROD ไม่ตรงกับที่บันทึกใน Change Log',
            E5: 'CR บอกว่า Deployed แต่ไม่พบ System Note ของ object',
            E6: 'ผู้อนุมัติเป็นคนเดียวกับ Developer หรือผู้ deploy'
        };

        // ---------- utils ----------

        const tbdlLog = (title, detail) => log.audit(CFG.LOG_PREFIX + ' ' + title, detail);

        function runAll(sql, params) {
            const out = [];
            const paged = tbdlQuery.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000 });
            paged.pageRanges.forEach(r => paged.fetch({ index: r.index }).data.asMappedResults().forEach(x => out.push(x)));
            return out;
        }

        function chunk(arr, n) {
            const out = [];
            for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
            return out;
        }

        /** 'YYYY-MM-DD HH24:MI:SS' → epoch ms แบบ naive (ใช้เทียบกันเองเท่านั้น ทุกค่ามาจาก TO_CHAR ในบัญชีเดียวกัน) */
        function parseTs(s) {
            if (!s) return null;
            const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
            if (!m) return null;
            return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        }

        function fmtTs(ms) {
            if (ms === null || ms === undefined) return '';
            const d = new Date(ms), p = n => String(n).padStart(2, '0');
            return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
        }

        /** JS Date (จาก format.parse) → 'YYYY-MM-DD' ตามวันที่ที่ผู้ใช้เห็น */
        function ymd(d) {
            const p = n => String(n).padStart(2, '0');
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        }

        const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
        const ids = arr => (arr || []).map(Number).filter(n => Number.isFinite(n));

        // ---------- custom list ----------

        const tbdlListMemo = {};
        /** คืน { byName: {name: id}, byId: {id: name} } */
        function listMap(listId) {
            if (tbdlListMemo[listId]) return tbdlListMemo[listId];
            const byName = {}, byId = {};
            tbdlQuery.runSuiteQL({ query: 'SELECT id, name FROM ' + listId }).asMappedResults().forEach(r => {
                byName[r.name] = String(r.id);
                byId[String(r.id)] = r.name;
            });
            return (tbdlListMemo[listId] = { byName, byId });
        }

        function listId(listKey, name) {
            const id = listMap(LIST[listKey]).byName[name];
            if (!id) throw new Error('ไม่พบค่า "' + name + '" ใน ' + LIST[listKey] + ' — ตรวจชื่อค่าใน custom list ให้ตรงกับ TB_DL_Lib');
            return id;
        }

        function listName(listKey, id) {
            return id === null || id === undefined || id === '' ? '' : (listMap(LIST[listKey]).byId[String(id)] || '');
        }

        // ---------- config ----------

        /** recordtypeid ทั้งหมดใน RECTYPE_MAP + reverse map */
        function rectypes() {
            const toType = {}, all = [];
            Object.keys(CFG.RECTYPE_MAP).forEach(t => {
                [].concat(CFG.RECTYPE_MAP[t] === null || CFG.RECTYPE_MAP[t] === undefined ? [] : CFG.RECTYPE_MAP[t]).forEach(v => {
                    const n = Number(v);
                    if (Number.isFinite(n)) { toType[String(n)] = t; all.push(n); }
                });
            });
            return { toType, all };
        }

        function configWarnings() {
            const w = [];
            const rt = rectypes();
            const missing = Object.keys(CFG.RECTYPE_MAP).filter(t => CFG.RECTYPE_MAP[t] === null || CFG.RECTYPE_MAP[t] === undefined);
            if (!rt.all.length) w.push('ยังไม่ได้ตั้ง RECTYPE_MAP ใน TB_DL_Config — รายงานยังไม่เห็นการเปลี่ยนแปลงจาก System Notes เปิด &view=probe เพื่อหาค่า');
            else if (missing.length) w.push('ยังไม่ได้ map recordtypeid ของ: ' + missing.join(', ') + ' — การเปลี่ยนแปลงของประเภทนี้ไม่อยู่ในรายงาน');
            if (!CFG.DEPLOYER_ROLE_IDS.length && !CFG.DEPLOYER_EMPLOYEE_IDS.length) w.push('ยังไม่ได้ตั้งผู้มีสิทธิ์ deploy (DEPLOYER_ROLE_IDS / DEPLOYER_EMPLOYEE_IDS) — ตรวจ E3 ได้แค่ "ผู้แก้ = ผู้ deploy ของ CR"');
            return w;
        }

        // ---------- people ----------

        /** คนที่ถือ role ใด role หนึ่ง → [{id, name, role, roleName}] (ตาราง employeerolesforsearch) */
        function employeesWithRoles(roleIds) {
            const r = ids(roleIds);
            if (!r.length) return [];
            try {
                return runAll(
                    'SELECT er.entity AS id, BUILTIN.DF(er.entity) AS name, er.role AS role, BUILTIN.DF(er.role) AS rolename ' +
                    'FROM employeerolesforsearch er JOIN employee e ON e.id = er.entity ' +
                    "WHERE e.isinactive = 'F' AND e.giveaccess = 'T' AND er.role IN (" + r.join(',') + ') ORDER BY name');
            } catch (e) {
                tbdlLog('employeesWithRoles failed', e.message);
                return [];
            }
        }

        /** Set ของ employee id (string) ที่มีสิทธิ์ deploy */
        function deployerSet() {
            const set = {};
            ids(CFG.DEPLOYER_EMPLOYEE_IDS).forEach(id => { set[String(id)] = true; });
            employeesWithRoles(CFG.DEPLOYER_ROLE_IDS).forEach(r => { set[String(r.id)] = true; });
            return set;
        }

        // ---------- System Notes ----------

        /**
         * ดึง System Notes ของ object ใน RECTYPE_MAP ระหว่าง fromYmd ถึง toYmd (รวมวันสุดท้าย)
         * คืนแถวดิบ 1 แถวต่อ field
         */
        function fetchSystemNotes(fromYmd, toYmd) {
            const rt = rectypes();
            if (!rt.all.length) return [];
            const where = "sn.date >= TO_DATE(?, 'YYYY-MM-DD') AND sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1 AND sn.recordtypeid IN (" + rt.all.join(',') + ')';
            const full = 'SELECT sn.id, sn.recordid, sn.recordtypeid, sn.field, sn.context, sn.type, sn.name AS actor, BUILTIN.DF(sn.name) AS actorname, ' +
                "sn.role, BUILTIN.DF(sn.role) AS rolename, TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI:SS') AS ts FROM systemnote sn WHERE " + where + ' ORDER BY sn.date';
            const minimal = 'SELECT sn.id, sn.recordid, sn.recordtypeid, sn.field, sn.context, sn.name AS actor, ' +
                "TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI:SS') AS ts FROM systemnote sn WHERE " + where + ' ORDER BY sn.date';
            let rows;
            try { rows = runAll(full, [fromYmd, toYmd]); } catch (e) {
                tbdlLog('systemnote full query failed, retry minimal', e.message);
                rows = runAll(minimal, [fromYmd, toYmd]);
            }
            return rows.map(r => ({
                noteId: r.id,
                objType: rt.toType[String(r.recordtypeid)] || ('rectype ' + r.recordtypeid),
                objId: String(r.recordid),
                field: r.field || '',
                context: r.context || '',
                noteType: r.type || '',
                actor: r.actor === null || r.actor === undefined ? '' : String(r.actor),
                actorName: r.actorname || (r.actor ? '#' + r.actor : ''),
                role: r.role === null || r.role === undefined ? '' : String(r.role),
                roleName: r.rolename || '',
                ts: parseTs(r.ts)
            }));
        }

        /** รวมแถวที่เป็นการ save ครั้งเดียวกัน (object + ผู้แก้ + นาทีเดียวกัน) */
        function groupChanges(notes) {
            const map = {}, out = [];
            notes.forEach(n => {
                const minute = Math.floor((n.ts || 0) / 60000);
                const k = n.objType + '|' + n.objId + '|' + n.actor + '|' + minute;
                let g = map[k];
                if (!g) {
                    g = map[k] = { key: k, objType: n.objType, objId: n.objId, objName: '', actor: n.actor, actorName: n.actorName, role: n.role, roleName: n.roleName, context: n.context, ts: n.ts, fields: [] };
                    out.push(g);
                }
                if (n.field && g.fields.indexOf(n.field) < 0) g.fields.push(n.field);
            });
            return out;
        }

        /** ใส่ชื่อ object ให้แถวการเปลี่ยนแปลง (query ต่อประเภท ทีละ 200 id) */
        function attachObjectNames(changes) {
            const NAME_SQL = {
                'Script': 'SELECT id, scriptid AS skey, name FROM script WHERE id IN ',
                'File': 'SELECT id, name AS skey, name FROM file WHERE id IN ',
                'Custom Field': 'SELECT internalid AS id, scriptid AS skey, name FROM customfield WHERE internalid IN ',
                'Custom Record Type': 'SELECT internalid AS id, scriptid AS skey, name FROM customrecordtype WHERE internalid IN ',
                'Role': 'SELECT id, scriptid AS skey, name FROM role WHERE id IN '
            };
            const byType = {};
            changes.forEach(c => { (byType[c.objType] = byType[c.objType] || {})[c.objId] = true; });
            const names = {};
            Object.keys(byType).forEach(t => {
                if (!NAME_SQL[t]) return;
                const list = ids(Object.keys(byType[t]));
                chunk(list, 200).forEach(part => {
                    try {
                        tbdlQuery.runSuiteQL({ query: NAME_SQL[t] + '(' + part.join(',') + ')' }).asMappedResults().forEach(r => {
                            names[t + '|' + r.id] = r.skey && r.skey !== r.name ? r.name + ' (' + r.skey + ')' : r.name;
                        });
                    } catch (e) { tbdlLog('attachObjectNames ' + t, e.message); }
                });
            });
            changes.forEach(c => { c.objName = names[c.objType + '|' + c.objId] || ('#' + c.objId); });
            return changes;
        }

        /** โหมด probe: recordtypeid ที่มีการเปลี่ยนในช่วงวันที่ พร้อมตัวอย่าง (ใช้ตั้ง RECTYPE_MAP) */
        function probeRecordTypes(fromYmd, toYmd, limit) {
            const rows = tbdlQuery.runSuiteQL({
                query: 'SELECT sn.recordtypeid AS rt, COUNT(*) AS cnt, MIN(sn.recordid) AS samplerec, MIN(sn.field) AS samplefield, MAX(sn.date) AS lastdate ' +
                    "FROM systemnote sn WHERE sn.date >= TO_DATE(?, 'YYYY-MM-DD') AND sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1 " +
                    'GROUP BY sn.recordtypeid ORDER BY cnt DESC',
                params: [fromYmd, toYmd]
            }).asMappedResults().slice(0, limit || 30);
            const mapped = rectypes().toType;
            rows.forEach(r => {
                r.mappedAs = mapped[String(r.rt)] || '';
                try {
                    const x = tbdlQuery.runSuiteQL({ query: 'SELECT BUILTIN.DF(sn.recordtypeid) AS label FROM systemnote sn WHERE sn.recordtypeid = ? FETCH FIRST 1 ROWS ONLY', params: [r.rt] }).asMappedResults();
                    r.label = x.length ? x[0].label : '';
                } catch (e) { r.label = ''; }
            });
            return rows;
        }

        // ---------- Change Log ----------

        /**
         * CR ที่เกี่ยวกับช่วงเวลา: deploy ตั้งแต่ (from − WINDOW − 3 วัน) หรือยังไม่ deploy แต่อนุมัติแล้ว
         * พร้อม Affected Objects
         */
        function fetchChangeLogs(fromYmd, toYmd) {
            const crs = runAll(
                'SELECT h.id, h.name, h.' + F.status + ' AS status, h.' + F.type + ' AS ctype, ' +
                'h.' + F.requester + ' AS requester, h.' + F.approver + ' AS approver, h.' + F.developer + ' AS developer, h.' + F.deployer + ' AS deployer, ' +
                'BUILTIN.DF(h.' + F.approver + ') AS approvername, BUILTIN.DF(h.' + F.developer + ') AS developername, BUILTIN.DF(h.' + F.deployer + ') AS deployername, ' +
                "TO_CHAR(h." + F.approveDate + ", 'YYYY-MM-DD HH24:MI:SS') AS approvets, TO_CHAR(h." + F.deployDate + ", 'YYYY-MM-DD HH24:MI:SS') AS deployts, " +
                'h.' + F.method + ' AS method ' +
                'FROM ' + REC.LOG + ' h ' +
                "WHERE h.isinactive = 'F' AND ((h." + F.deployDate + " >= TO_DATE(?, 'YYYY-MM-DD') - ? AND h." + F.deployDate + " < TO_DATE(?, 'YYYY-MM-DD') + 1) " +
                'OR (h.' + F.deployDate + ' IS NULL AND h.' + F.approveDate + ' IS NOT NULL)) ORDER BY h.id',
                [fromYmd, Math.ceil(CFG.WINDOW_HOURS / 24) + 3, toYmd]);
            const byId = {};
            crs.forEach(c => {
                byId[c.id] = {
                    id: String(c.id), name: c.name,
                    status: listName('status', c.status), type: listName('type', c.ctype), method: listName('method', c.method),
                    requester: c.requester ? String(c.requester) : '', approver: c.approver ? String(c.approver) : '',
                    developer: c.developer ? String(c.developer) : '', deployer: c.deployer ? String(c.deployer) : '',
                    approverName: c.approvername || '', developerName: c.developername || '', deployerName: c.deployername || '',
                    approveTs: parseTs(c.approvets), deployTs: parseTs(c.deployts),
                    objects: []
                };
            });
            const crIds = ids(Object.keys(byId));
            chunk(crIds, 200).forEach(part => {
                runAll('SELECT o.id, o.' + F.oParent + ' AS parent, o.' + F.oType + ' AS otype, o.' + F.oKey + ' AS okey, o.' + F.oProdId + ' AS prodid, ' +
                    'o.' + F.oAction + ' AS oaction, o.' + F.oSha1 + ' AS sha1 FROM ' + REC.OBJ + " o WHERE o.isinactive = 'F' AND o." + F.oParent + ' IN (' + part.join(',') + ')')
                    .forEach(o => {
                        const cr = byId[o.parent];
                        if (cr) cr.objects.push({
                            id: String(o.id), objType: listName('objtype', o.otype), objKey: o.okey || '',
                            prodId: o.prodid === null || o.prodid === undefined ? '' : String(o.prodid),
                            action: listName('action', o.oaction), sha1: (o.sha1 || '').trim().toLowerCase()
                        });
                    });
            });
            return crIds.map(id => byId[id]);
        }

        // ---------- SHA-1 ----------

        const TEXT_TYPES = ['JAVASCRIPT', 'HTMLDOC', 'PLAINTEXT', 'XMLDOC', 'CSV', 'JSON', 'STYLESHEET', 'FREEMARKER', 'SCSS', 'MISCTEXT'];

        /** SHA-1 (hex ตัวเล็ก) ของไฟล์ข้อความใน File Cabinet — ไฟล์ binary คืน null */
        function fileSha1(fileId) {
            const f = tbdlFile.load({ id: fileId });
            if (TEXT_TYPES.indexOf(String(f.fileType).toUpperCase()) < 0) return { sha1: null, note: 'ไฟล์ประเภท ' + f.fileType + ' ไม่ได้ตรวจ' };
            const h = tbdlCrypto.createHash({ algorithm: tbdlCrypto.HashAlg.SHA1 });
            h.update({ input: f.getContents(), inputEncoding: tbdlEncode.Encoding.UTF_8 });
            return { sha1: h.digest({ outputEncoding: tbdlEncode.Encoding.HEX }).toLowerCase(), note: '' };
        }

        /**
         * ไฟล์ที่ต้องตรวจ = File object ของ CR ล่าสุด (Deployed/Verified) ต่อไฟล์ ที่มี prodId + sha1
         * คืน { [fileId]: {sha1, note} } — เกิน maxFiles หรือ governance ใกล้หมด = ไม่ตรวจ (note บอก)
         */
        function currentFileHashes(crs, maxFiles) {
            const latest = {};
            crs.filter(c => DONE_STATUSES.indexOf(c.status) >= 0).forEach(c => c.objects.forEach(o => {
                if (o.objType !== 'File' || !o.prodId || !o.sha1) return;
                const prev = latest[o.prodId];
                if (!prev || (c.deployTs || 0) > (prev.deployTs || 0)) latest[o.prodId] = { deployTs: c.deployTs };
            }));
            const out = {};
            Object.keys(latest).forEach((fid, i) => {
                if (i >= maxFiles || tbdlRuntime.getCurrentScript().getRemainingUsage() < 150) { out[fid] = { sha1: null, note: 'ไม่ได้ตรวจ (เกินจำนวนที่ตั้งไว้ต่อรอบ)' }; return; }
                try { out[fid] = fileSha1(fid); } catch (e) { out[fid] = { sha1: null, note: 'โหลดไฟล์ไม่ได้: ' + e.message }; }
            });
            return out;
        }

        // ---------- reconcile (pure) ----------

        /**
         * จับคู่การเปลี่ยนแปลงกับ CR
         * @param {Object} p
         * @param {Array}  p.changes     จาก groupChanges + attachObjectNames
         * @param {Array}  p.crs         จาก fetchChangeLogs
         * @param {Object} p.deployers   set ของ employee id ที่มีสิทธิ์ deploy ({} = ไม่ได้ตั้ง)
         * @param {Object} p.hashes      จาก currentFileHashes
         * @param {number} p.windowHours
         * @param {number} p.fromMs      ต้นช่วง (00:00 ของวันแรก, naive)
         * @param {number} p.toMs        ท้ายช่วง (00:00 ของวันถัดจากวันสุดท้าย, naive)
         * @param {Object} p.explained   { [excKey]: {explain, resolution, by, date} }
         * @returns {{changes:Array, exceptions:Array, crRows:Array, summary:Object}}
         */
        function reconcile(p) {
            const winMs = (p.windowHours || 24) * 3600e3;
            const deployers = p.deployers || {};
            const hasDeployerList = Object.keys(deployers).length > 0;
            const explained = p.explained || {};
            const exceptions = [];
            const matchedObj = {};   // crId|objId → true

            const addExc = (code, base) => {
                const key = code + '|' + base.keyTail;
                const ex = Object.assign({ code, codeText: EXC[code], key }, base);
                delete ex.keyTail;
                ex.explanation = explained[key] || null;
                exceptions.push(ex);
                return ex;
            };

            const sameObject = (o, c) => o.objType === c.objType && o.prodId && String(o.prodId) === String(c.objId);

            p.changes.forEach(c => {
                const cands = [];
                p.crs.forEach(cr => cr.objects.forEach(o => { if (sameObject(o, c)) cands.push({ cr, o }); }));
                const done = cands.filter(x => DONE_STATUSES.indexOf(x.cr.status) >= 0 && x.cr.approveTs !== null);
                const inWindow = done.filter(x => c.ts >= x.cr.approveTs && x.cr.deployTs !== null && c.ts <= x.cr.deployTs + winMs);
                const tail = c.objType + '|' + c.objId + '|' + c.actor + '|' + Math.floor((c.ts || 0) / 60000);
                const base = {
                    keyTail: tail, objType: c.objType, objId: c.objId, objName: c.objName, actor: c.actor, actorName: c.actorName,
                    ts: c.ts, tsText: fmtTs(c.ts), fields: c.fields.join(', '), context: c.context
                };
                c.tsText = base.tsText;
                c.exceptionCodes = [];

                if (inWindow.length) {
                    // เลือก CR ที่ deploy ใกล้เวลาเปลี่ยนที่สุด
                    inWindow.sort((a, b) => Math.abs(c.ts - a.cr.deployTs) - Math.abs(c.ts - b.cr.deployTs));
                    const hit = inWindow[0];
                    c.cr = hit.cr.name; c.crId = hit.cr.id;
                    matchedObj[hit.cr.id + '|' + c.objId] = true;
                    const okActor = hit.cr.deployer && hit.cr.deployer === c.actor;
                    const listed = !hasDeployerList || deployers[c.actor];
                    if (!okActor || !listed) {
                        addExc('E3', Object.assign({}, base, {
                            cr: hit.cr.name, crId: hit.cr.id,
                            detail: (!okActor ? 'ผู้ deploy ใน CR: ' + (hit.cr.deployerName || '-') : '') + (!listed ? (!okActor ? ' · ' : '') + 'ผู้แก้ไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy' : '')
                        }));
                        c.exceptionCodes.push('E3');
                    }
                    c.result = c.exceptionCodes.length ? 'Exception' : 'Matched';
                    return;
                }

                const early = done.filter(x => c.ts < x.cr.approveTs && (x.cr.deployTs === null || c.ts <= x.cr.deployTs + winMs));
                if (early.length) {
                    addExc('E2', Object.assign({}, base, { cr: early[0].cr.name, crId: early[0].cr.id, detail: 'อนุมัติเมื่อ ' + fmtTs(early[0].cr.approveTs) }));
                    c.cr = early[0].cr.name; c.crId = early[0].cr.id;
                    c.exceptionCodes.push('E2');
                } else {
                    const pending = cands.filter(x => DONE_STATUSES.indexOf(x.cr.status) < 0);
                    addExc('E1', Object.assign({}, base, {
                        cr: '', crId: '',
                        detail: pending.length ? 'มี CR ' + pending[0].cr.name + ' แต่สถานะยังเป็น ' + pending[0].cr.status
                            : done.length ? 'มี CR ' + done[0].cr.name + ' แต่เวลาเปลี่ยนอยู่นอกช่วงอนุมัติ–deploy+' + (p.windowHours || 24) + ' ชม.'
                                : 'ไม่พบ CR ที่มี object นี้'
                    }));
                    c.exceptionCodes.push('E1');
                }
                c.result = 'Exception';
            });

            const crRows = [];
            p.crs.forEach(cr => {
                const deployedInPeriod = cr.deployTs !== null && cr.deployTs >= p.fromMs && cr.deployTs < p.toMs;
                const approvedInPeriod = cr.approveTs !== null && cr.approveTs >= p.fromMs && cr.approveTs < p.toMs;
                if (!deployedInPeriod && !approvedInPeriod) return;
                const codes = [];
                const crBase = { objType: '', objId: '', objName: '', actor: '', actorName: '', ts: cr.deployTs || cr.approveTs, tsText: fmtTs(cr.deployTs || cr.approveTs), fields: '', context: '', cr: cr.name, crId: cr.id };

                if (cr.approver && (cr.approver === cr.developer || cr.approver === cr.deployer)) {
                    addExc('E6', Object.assign({}, crBase, { keyTail: 'CR|' + cr.id, detail: 'ผู้อนุมัติ ' + cr.approverName + (cr.approver === cr.developer ? ' = Developer' : '') + (cr.approver === cr.deployer ? ' = ผู้ deploy' : '') }));
                    codes.push('E6');
                }
                if (deployedInPeriod && DONE_STATUSES.indexOf(cr.status) >= 0) {
                    cr.objects.forEach(o => {
                        if (!o.prodId) {
                            addExc('E5', Object.assign({}, crBase, { keyTail: 'CR|' + cr.id + '|OBJ|' + o.id, objType: o.objType, objName: o.objKey, detail: 'ยังไม่ได้ใส่ Internal ID ฝั่ง PROD จึงจับคู่ไม่ได้' }));
                            codes.push('E5');
                        } else if (!matchedObj[cr.id + '|' + o.prodId] && o.objType && rectypeMapped(o.objType)) {
                            addExc('E5', Object.assign({}, crBase, { keyTail: 'CR|' + cr.id + '|OBJ|' + o.id, objType: o.objType, objId: o.prodId, objName: o.objKey, detail: 'ไม่พบ System Note ของ object นี้ช่วงอนุมัติ–deploy+' + (p.windowHours || 24) + ' ชม.' }));
                            codes.push('E5');
                        }
                    });
                }
                crRows.push({
                    id: cr.id, name: cr.name, status: cr.status, type: cr.type, method: cr.method,
                    approverName: cr.approverName, developerName: cr.developerName, deployerName: cr.deployerName,
                    approveText: fmtTs(cr.approveTs), deployText: fmtTs(cr.deployTs), objects: cr.objects.length,
                    codes: codes.filter((x, i, a) => a.indexOf(x) === i).join(', ')
                });
            });

            // E4: hash ไฟล์ปัจจุบันไม่ตรงกับ CR ล่าสุดของไฟล์นั้น
            const latestFile = {};
            p.crs.filter(c => DONE_STATUSES.indexOf(c.status) >= 0).forEach(cr => cr.objects.forEach(o => {
                if (o.objType !== 'File' || !o.prodId || !o.sha1) return;
                const prev = latestFile[o.prodId];
                if (!prev || (cr.deployTs || 0) > (prev.cr.deployTs || 0)) latestFile[o.prodId] = { cr, o };
            }));
            const hashNotes = [];
            Object.keys(latestFile).forEach(fid => {
                const h = (p.hashes || {})[fid];
                const x = latestFile[fid];
                if (!h) return;
                if (!h.sha1) { hashNotes.push({ fileId: fid, objName: x.o.objKey, cr: x.cr.name, note: h.note }); return; }
                if (h.sha1 !== x.o.sha1) {
                    addExc('E4', {
                        keyTail: 'FILE|' + fid + '|' + h.sha1, objType: 'File', objId: fid, objName: x.o.objKey, actor: '', actorName: '',
                        ts: null, tsText: '', fields: '', context: '', cr: x.cr.name, crId: x.cr.id,
                        detail: 'PROD ' + h.sha1.slice(0, 12) + '… · CR ' + x.o.sha1.slice(0, 12) + '…'
                    });
                }
            });

            const byCode = {};
            exceptions.forEach(e => { byCode[e.code] = (byCode[e.code] || 0) + 1; });
            const matched = p.changes.filter(c => c.result === 'Matched').length;
            return {
                changes: p.changes,
                exceptions,
                crRows,
                hashNotes,
                summary: {
                    changes: p.changes.length,
                    matched,
                    exceptions: exceptions.length,
                    unexplained: exceptions.filter(e => !e.explanation).length,
                    crs: crRows.length,
                    byCode
                }
            };
        }

        function rectypeMapped(objType) {
            const v = CFG.RECTYPE_MAP[objType];
            return v !== null && v !== undefined && [].concat(v).length > 0;
        }

        // ---------- exceptions explained ----------

        /** คำอธิบาย exception ที่บันทึกแล้ว { [key]: {...} } — key เก็บใน field name ของ record */
        function fetchExplanations(keys) {
            const out = {};
            const list = (keys || []).filter(Boolean);
            chunk(list, 200).forEach(part => {
                const marks = part.map(() => '?').join(',');
                runAll('SELECT e.id, e.name AS ekey, e.' + F.eExplain + ' AS explain, e.' + F.eResolution + ' AS resolution, BUILTIN.DF(e.' + F.eBy + ') AS byname, ' +
                    "TO_CHAR(e." + F.eDate + ", 'YYYY-MM-DD HH24:MI') AS edate FROM " + REC.EXC + " e WHERE e.isinactive = 'F' AND e.name IN (" + marks + ')', part)
                    .forEach(r => { out[r.ekey] = { id: String(r.id), explain: r.explain || '', resolution: r.resolution || '', by: r.byname || '', date: r.edate || '' }; });
            });
            return out;
        }

        // ---------- หา internal id ฝั่ง PROD จาก Script ID / Path ----------

        const RESOLVE_SQL = {
            'Script': 'SELECT id FROM script WHERE UPPER(scriptid) = UPPER(?)',
            'Custom Field': 'SELECT internalid AS id FROM customfield WHERE UPPER(scriptid) = UPPER(?)',
            'Custom Record Type': 'SELECT internalid AS id FROM customrecordtype WHERE UPPER(scriptid) = UPPER(?)',
            'Role': 'SELECT id FROM role WHERE UPPER(scriptid) = UPPER(?)',
            // ตารางนี้ยังไม่ได้ยืนยันในทุกบัญชี — ไม่เจอ = คืน null ให้คนใส่เอง
            'Script Deployment': 'SELECT primarykey AS id FROM scriptdeployment WHERE UPPER(scriptid) = UPPER(?)'
        };

        /** คืน internal id (string) หรือ null ถ้าหาไม่ได้ (object ยังไม่ถูกสร้าง / ประเภทที่ไม่รองรับ) */
        function resolveProdId(objType, key) {
            const k = String(key || '').trim();
            if (!k) return null;
            try {
                if (objType === 'File') return String(tbdlFile.load({ id: k.replace(/^\/+/, '') }).id);
                if (!RESOLVE_SQL[objType]) return null;
                const r = tbdlQuery.runSuiteQL({ query: RESOLVE_SQL[objType], params: [k] }).asMappedResults();
                return r.length ? String(r[0].id) : null;
            } catch (e) {
                tbdlLog('resolveProdId ' + objType + ' ' + k, e.message);
                return null;
            }
        }

        /** สถานะ (ชื่อ) ของ Change Log */
        function headerStatus(logId) {
            const r = tbdlQuery.runSuiteQL({ query: 'SELECT ' + F.status + ' AS st FROM ' + REC.LOG + ' WHERE id = ?', params: [logId] }).asMappedResults();
            return r.length ? listName('status', r[0].st) : '';
        }

        /** Affected Objects ของ CR เดียว */
        function objectsOf(logId) {
            return runAll('SELECT o.id, o.' + F.oType + ' AS otype, o.' + F.oKey + ' AS okey, o.' + F.oProdId + ' AS prodid, o.' + F.oSha1 + ' AS sha1 ' +
                'FROM ' + REC.OBJ + " o WHERE o.isinactive = 'F' AND o." + F.oParent + ' = ?', [logId])
                .map(o => ({ id: String(o.id), objType: listName('objtype', o.otype), objKey: o.okey || '', prodId: o.prodid === null || o.prodid === undefined ? '' : String(o.prodid), sha1: o.sha1 || '' }));
        }

        // ---------- ทั้งชุด ----------

        /**
         * รันรายงานกระทบยอดทั้งชุดสำหรับช่วงวันที่ (YYYY-MM-DD)
         * @param {{fromYmd:string, toYmd:string, maxHashFiles:number}} o
         */
        function runReconciliation(o) {
            const notes = fetchSystemNotes(o.fromYmd, o.toYmd);
            const changes = attachObjectNames(groupChanges(notes));
            const crs = fetchChangeLogs(o.fromYmd, o.toYmd);
            const hashes = currentFileHashes(crs, o.maxHashFiles);
            const deployers = deployerSet();
            const first = reconcile({
                changes, crs, deployers, hashes, windowHours: CFG.WINDOW_HOURS,
                fromMs: parseTs(o.fromYmd), toMs: parseTs(o.toYmd) + 864e5, explained: {}
            });
            const explained = fetchExplanations(first.exceptions.map(e => e.key));
            first.exceptions.forEach(e => { e.explanation = explained[e.key] || null; });
            first.summary.unexplained = first.exceptions.filter(e => !e.explanation).length;
            first.noteRows = notes.length;
            return first;
        }

        /** CSV ของผลกระทบยอด (Exception + Matched + CR) — ใช้ทั้งปุ่ม Export และ snapshot รายเดือน */
        function toCsv(fromYmd, toYmd, res) {
            const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
            const head = ['Section', 'Code', 'Meaning', 'Object Type', 'Object', 'Object ID', 'Changed At', 'Actor', 'Fields', 'CR', 'Detail', 'Explanation', 'Resolution', 'Explained By'];
            const lines = [['Period', fromYmd + ' to ' + toYmd].map(q).join(','), head.map(q).join(',')];
            res.exceptions.forEach(e => lines.push(['Exception', e.code, e.codeText, e.objType, e.objName, e.objId, e.tsText, e.actorName, e.fields, e.cr, e.detail,
                e.explanation ? e.explanation.explain : '', e.explanation ? e.explanation.resolution : '', e.explanation ? e.explanation.by : ''].map(q).join(',')));
            res.changes.filter(c => c.result === 'Matched').forEach(c => lines.push(['Matched', '', '', c.objType, c.objName, c.objId, c.tsText, c.actorName, c.fields.join(' '), c.cr, '', '', '', ''].map(q).join(',')));
            res.crRows.forEach(r => lines.push(['CR', r.codes, '', '', r.name, r.id, r.deployText || r.approveText, r.deployerName, '', r.status,
                'approver ' + r.approverName + ' / developer ' + r.developerName, '', '', ''].map(q).join(',')));
            return '﻿' + lines.join('\r\n');
        }

        return {
            REC, F, LIST, S, EMERGENCY, DONE_STATUSES, EXC, CFG,
            toCsv,
            runAll, chunk, parseTs, fmtTs, ymd, num, ids,
            listMap, listId, listName,
            rectypes, configWarnings,
            employeesWithRoles, deployerSet,
            fetchSystemNotes, groupChanges, attachObjectNames, probeRecordTypes,
            fetchChangeLogs, fileSha1, currentFileHashes,
            reconcile, fetchExplanations, runReconciliation,
            resolveProdId, headerStatus, objectsOf,
            log: tbdlLog
        };
    });
