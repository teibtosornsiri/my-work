/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * TB_DLL_Lib — ของกลางของ Deployment Change Log (Lite)
 *   - ดึง System Notes ของ object ตาม RECTYPE_MAP แล้วรวมเป็น "การเปลี่ยนแปลง" (object + ผู้แก้ + นาทีเดียวกัน)
 *   - ติดธงการเปลี่ยนแปลงที่ผู้แก้ไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy
 *   - CSV สำหรับกระทบยอดใน Excel (มีช่องว่าง CR No. / คำอธิบาย / ผู้ตรวจ)
 *   - summarize() เป็น pure function ทดสอบนอก NetSuite ได้
 *
 * ตัวแปรระดับไฟล์ขึ้นต้น tbdll เพื่อไม่ชนกับไฟล์ผู้เรียก
 */
define(['N/query', './TB_DLL_Config'], (tbdllQuery, CFG) => {

    const tbdllLog = (title, detail) => log.audit(CFG.LOG_PREFIX + ' ' + title, detail);

    function runAll(sql, params) {
        const out = [];
        const paged = tbdllQuery.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000 });
        paged.pageRanges.forEach(r => paged.fetch({ index: r.index }).data.asMappedResults().forEach(x => out.push(x)));
        return out;
    }

    function chunk(arr, n) {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    }

    const ids = arr => (arr || []).map(Number).filter(n => Number.isFinite(n));

    /** 'YYYY-MM-DD HH24:MI:SS' → epoch ms แบบ naive (ใช้เทียบ/แสดงเท่านั้น) */
    function parseTs(s) {
        if (!s) return null;
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
    }

    function fmtTs(ms) {
        if (ms === null || ms === undefined) return '';
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }

    function ymd(d) {
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    // ---------- config ----------

    /**
     * แปลง RECTYPE_MAP เป็นเงื่อนไข
     * ค่าแต่ละประเภทเป็นได้: ตัวเลข · array ตัวเลข · { rt: null, fieldPrefix: 'MEDIAITEM.' }
     * (บางประเภท เช่น File, System Note มี recordtypeid = null ต้องแยกด้วย prefix ของ field แทน)
     * คืน { toType: {rt: type}, all: [rt ตัวเลข], nullRules: [{prefix, type}] }
     */
    function rectypes() {
        const toType = {}, all = [], nullRules = [];
        Object.keys(CFG.RECTYPE_MAP).forEach(t => {
            const v = CFG.RECTYPE_MAP[t];
            [].concat(v === null || v === undefined || v === false ? [] : v).forEach(x => {
                if (x === false || x === null || x === '' || x === undefined) return;
                if (typeof x === 'object') {
                    if ((x.rt === null || x.rt === undefined) && x.fieldPrefix) { nullRules.push({ prefix: String(x.fieldPrefix).toUpperCase(), type: t }); toType['null'] = toType['null'] ? toType['null'] + ' / ' + t : t; }
                    else if (Number.isFinite(Number(x.rt))) { toType[String(Number(x.rt))] = t; all.push(Number(x.rt)); }
                    return;
                }
                const n = Number(x);
                if (Number.isFinite(n)) { toType[String(n)] = t; all.push(n); }
            });
        });
        return { toType, all, nullRules };
    }

    /** เงื่อนไข WHERE ตาม RECTYPE_MAP → { sql, params } หรือ null ถ้ายังไม่ได้ตั้ง */
    function rectypeWhere(rt) {
        const parts = [], params = [];
        if (rt.all.length) parts.push('sn.recordtypeid IN (' + rt.all.join(',') + ')');
        rt.nullRules.forEach(r => { parts.push('(sn.recordtypeid IS NULL AND UPPER(sn.field) LIKE ?)'); params.push(r.prefix + '%'); });
        return parts.length ? { sql: '(' + parts.join(' OR ') + ')', params } : null;
    }

    function typeOfNote(rt, recordtypeid, field) {
        if (recordtypeid === null || recordtypeid === undefined || recordtypeid === '') {
            const f = String(field || '').toUpperCase();
            const hit = rt.nullRules.find(r => f.indexOf(r.prefix) === 0);
            return hit ? hit.type : 'rectype null (' + (f.split('.')[0] || '-') + ')';
        }
        return rt.toType[String(recordtypeid)] || ('rectype ' + recordtypeid);
    }

    function configWarnings() {
        const w = [];
        const rt = rectypes();
        const missing = Object.keys(CFG.RECTYPE_MAP).filter(t => CFG.RECTYPE_MAP[t] === null || CFG.RECTYPE_MAP[t] === undefined);
        if (!rt.all.length && !rt.nullRules.length) w.push('ยังไม่ได้ตั้ง RECTYPE_MAP ใน TB_DLL_Config — รายงานยังไม่เห็นการเปลี่ยนแปลง เปิด &view=probe เพื่อหาค่า');
        else if (missing.length) w.push('ยังไม่ได้ map recordtypeid ของ: ' + missing.join(', ') + ' — การเปลี่ยนแปลงของประเภทนี้ไม่อยู่ในรายงาน');
        if (CFG.FLAG_UNAUTHORIZED !== false && !CFG.DEPLOYER_ROLE_IDS.length && !CFG.DEPLOYER_EMPLOYEE_IDS.length) w.push('ยังไม่ได้ตั้งผู้มีสิทธิ์ deploy — ระบบติดธง "ผู้แก้ไม่มีสิทธิ์" ไม่ได้');
        return w;
    }

    // ---------- people ----------

    function employeesWithRoles(roleIds) {
        const r = ids(roleIds);
        if (!r.length) return [];
        try {
            return runAll(
                'SELECT er.entity AS id, e.entityid AS code, e.firstname, e.lastname, er.role AS role, BUILTIN.DF(er.role) AS rolename ' +
                'FROM employeerolesforsearch er JOIN employee e ON e.id = er.entity ' +
                "WHERE e.isinactive = 'F' AND e.giveaccess = 'T' AND er.role IN (" + r.join(',') + ') ORDER BY e.firstname, e.lastname')
                .map(x => {
                    const full = [x.firstname, x.lastname].filter(Boolean).join(' ').trim();
                    return Object.assign(x, { name: full ? full + (x.code ? ' (' + x.code + ')' : '') : (x.code || '#' + x.id) });
                });
        } catch (e) {
            tbdllLog('employeesWithRoles failed', e.message);
            return [];
        }
    }

    function deployerSet() {
        const set = {};
        ids(CFG.DEPLOYER_EMPLOYEE_IDS).forEach(id => { set[String(id)] = true; });
        employeesWithRoles(CFG.DEPLOYER_ROLE_IDS).forEach(r => { set[String(r.id)] = true; });
        return set;
    }

    // ---------- System Notes ----------

    function fetchSystemNotes(fromYmd, toYmd) {
        const rt = rectypes();
        const rw = rectypeWhere(rt);
        if (!rw) return [];
        const where = "sn.date >= TO_DATE(?, 'YYYY-MM-DD') AND sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1 AND " + rw.sql;
        const qp = [fromYmd, toYmd].concat(rw.params);
        const full = 'SELECT sn.id, sn.recordid, sn.recordtypeid, sn.field, sn.context, sn.type, sn.oldvalue, sn.newvalue, sn.name AS actor, BUILTIN.DF(sn.name) AS actorname, ' +
            "sn.role, BUILTIN.DF(sn.role) AS rolename, TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI:SS') AS ts FROM systemnote sn WHERE " + where + ' ORDER BY sn.date';
        const minimal = 'SELECT sn.id, sn.recordid, sn.recordtypeid, sn.field, sn.context, sn.name AS actor, ' +
            "TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI:SS') AS ts FROM systemnote sn WHERE " + where + ' ORDER BY sn.date';
        let rows;
        try { rows = runAll(full, qp); } catch (e) {
            tbdllLog('systemnote full query failed, retry minimal', e.message);
            rows = runAll(minimal, qp);
        }
        const skip = (CFG.EXCLUDE_CONTEXTS || []).map(String);
        return rows.filter(r => skip.indexOf(String(r.context || '')) < 0).map(r => ({
            objType: typeOfNote(rt, r.recordtypeid, r.field),
            objId: String(r.recordid),
            field: r.field || '',
            oldValue: r.oldvalue === null || r.oldvalue === undefined ? '' : String(r.oldvalue),
            newValue: r.newvalue === null || r.newvalue === undefined ? '' : String(r.newvalue),
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
                g = map[k] = { key: k, objType: n.objType, objId: n.objId, objName: '', actor: n.actor, actorName: n.actorName, role: n.role, roleName: n.roleName, context: n.context, ts: n.ts, fields: [], details: [] };
                out.push(g);
            }
            if (n.field && g.fields.indexOf(n.field) < 0) g.fields.push(n.field);
            if (n.field && (n.oldValue || n.newValue) && g.details.length < 5) g.details.push(n.field + ': ' + n.oldValue.slice(0, 60) + ' → ' + n.newValue.slice(0, 60));
        });
        return out;
    }

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
            chunk(ids(Object.keys(byType[t])), 200).forEach(part => {
                try {
                    tbdllQuery.runSuiteQL({ query: NAME_SQL[t] + '(' + part.join(',') + ')' }).asMappedResults().forEach(r => {
                        names[t + '|' + r.id] = r.skey && r.skey !== r.name ? r.name + ' (' + r.skey + ')' : r.name;
                    });
                } catch (e) { tbdllLog('attachObjectNames ' + t, e.message); }
            });
        });
        changes.forEach(c => { c.objName = names[c.objType + '|' + c.objId] || ('#' + c.objId); });
        return changes;
    }

    const SCRIPT_TYPE = {
        USEREVENT: 'User Event', CLIENT: 'Client Script', SCRIPTLET: 'Suitelet', SUITELET: 'Suitelet', RESTLET: 'RESTlet',
        MAPREDUCE: 'Map/Reduce', SCHEDULED: 'Scheduled', MASSUPDATE: 'Mass Update', PORTLET: 'Portlet',
        WORKFLOWACTION: 'Workflow Action', ACTION: 'Workflow Action', BUNDLEINSTALLATION: 'Bundle Installation',
        SDFINSTALLATION: 'SDF Installation', PLUGINTYPEIMPL: 'Plug-in', CUSTOMGLLINES: 'Custom GL Plug-in'
    };
    /** UE / CS / Workflow Action ผูกกับ record → บอกว่า deploy บน record ไหน */
    const RECORD_BOUND = ['User Event', 'Client Script', 'Workflow Action'];

    /**
     * ข้อมูล script ของแต่ละการเปลี่ยนแปลง (Script ID, ชื่อ, ประเภท, deploy บน record ไหน)
     *   File              → script ที่ใช้ไฟล์นี้เป็น Script File
     *   Script            → script ตัวนั้น
     *   Script Deployment → script แม่ของ deployment + record ของ deployment นั้น
     * ตาราง scriptdeployment ไม่อยู่ใน catalog ของทุกบัญชี — query ไม่ได้ก็ข้ามเงียบ ๆ (ได้แค่ข้อมูล script)
     */
    function attachScriptInfo(changes) {
        const uniq = a => a.filter((x, i, arr) => x && arr.indexOf(x) === i);
        const fileIds = ids(uniq(changes.filter(c => c.objType === 'File').map(c => c.objId)));
        const deployIds = ids(uniq(changes.filter(c => c.objType === 'Script Deployment').map(c => c.objId)));
        let scriptIds = ids(uniq(changes.filter(c => c.objType === 'Script').map(c => c.objId)));

        // deployment ที่ถูกแก้ → script แม่
        const deployById = {};
        const deploySql = cols => 'SELECT ' + cols + ' FROM scriptdeployment WHERE ';
        const DEP_FULL = 'primarykey AS id, script, scriptid, title, recordtype, isdeployed';
        const DEP_MIN = 'primarykey AS id, script, scriptid, title';
        let depCols = DEP_FULL, depOk = true;
        const runDep = where => {
            if (!depOk) return [];
            try { return runAll(deploySql(depCols) + where); } catch (e) {
                if (depCols === DEP_FULL) { depCols = DEP_MIN; try { return runAll(deploySql(depCols) + where); } catch (e2) { /* ไปข้างล่าง */ } }
                depOk = false; tbdllLog('scriptdeployment query failed', e.message); return [];
            }
        };
        chunk(deployIds, 200).forEach(part => runDep('primarykey IN (' + part.join(',') + ')').forEach(d => { deployById[String(d.id)] = d; if (d.script) scriptIds.push(Number(d.script)); }));
        scriptIds = uniq(scriptIds.map(String)).map(Number);

        // script จาก id และจาก script file
        const scripts = {}, byFile = {};
        const take = r => {
            const s = scripts[String(r.id)] = { id: String(r.id), scriptid: r.scriptid || '', name: r.name || '', type: SCRIPT_TYPE[String(r.scripttype || '').toUpperCase()] || String(r.scripttype || ''), deployedOn: [] };
            if (r.scriptfile) (byFile[String(r.scriptfile)] = byFile[String(r.scriptfile)] || []).push(s);
        };
        try {
            chunk(scriptIds, 200).forEach(part => runAll('SELECT id, scriptid, name, scripttype, scriptfile FROM script WHERE id IN (' + part.join(',') + ')').forEach(take));
            chunk(fileIds, 200).forEach(part => runAll('SELECT id, scriptid, name, scripttype, scriptfile FROM script WHERE scriptfile IN (' + part.join(',') + ')').forEach(r => { if (!scripts[String(r.id)]) take(r); }));
        } catch (e) { tbdllLog('script query failed', e.message); }

        // record ที่ UE / CS deploy อยู่ (เฉพาะ deployment ที่ deployed)
        const boundIds = Object.keys(scripts).filter(k => RECORD_BOUND.indexOf(scripts[k].type) >= 0).map(Number);
        if (depCols === DEP_FULL) {
            chunk(boundIds, 200).forEach(part => runDep('script IN (' + part.join(',') + ')').forEach(d => {
                const s = scripts[String(d.script)];
                if (!s || d.isdeployed === 'F' || !d.recordtype) return;
                const rt = String(d.recordtype);
                if (s.deployedOn.indexOf(rt) < 0) s.deployedOn.push(rt);
            }));
        }

        const fmt = s => [s.scriptid, s.name, s.type].filter(Boolean).join(' · ') + (s.deployedOn.length ? ' · deploy บน ' + s.deployedOn.join(', ') : '');
        changes.forEach(c => {
            let list = [];
            if (c.objType === 'File') list = byFile[c.objId] || [];
            else if (c.objType === 'Script' && scripts[c.objId]) list = [scripts[c.objId]];
            else if (c.objType === 'Script Deployment') {
                const d = deployById[c.objId];
                if (d) {
                    c.objName = (d.title || d.scriptid || c.objName) + (d.scriptid && d.title ? ' (' + d.scriptid + ')' : '');
                    const s = scripts[String(d.script)];
                    if (s) list = [Object.assign({}, s, { deployedOn: d.recordtype ? [String(d.recordtype)] : [] })];
                }
            }
            c.scripts = list;
            c.scriptText = list.map(fmt).join(' | ');
        });
        return changes;
    }

    /**
     * ชื่อผู้แก้: BUILTIN.DF ของ employee คืนแค่รหัส (entityid เช่น E-000008) → ดึงชื่อจากตาราง entity
     * แสดงเป็น "ชื่อ นามสกุล (รหัส)" ถ้ามีชื่อ
     */
    function attachActorNames(changes) {
        const list = ids(changes.map(c => c.actor).filter((x, i, a) => x && a.indexOf(x) === i));
        const names = {};
        chunk(list, 200).forEach(part => {
            try {
                tbdllQuery.runSuiteQL({ query: 'SELECT id, entityid, altname, firstname, lastname FROM entity WHERE id IN (' + part.join(',') + ')' }).asMappedResults().forEach(r => {
                    const full = [r.firstname, r.lastname].filter(Boolean).join(' ').trim() || String(r.altname || '').trim();
                    const code = String(r.entityid || '').trim();
                    names[String(r.id)] = full && full !== code ? full + (code ? ' (' + code + ')' : '') : (code || '#' + r.id);
                });
            } catch (e) { tbdllLog('attachActorNames', e.message); }
        });
        changes.forEach(c => { if (names[c.actor]) c.actorName = names[c.actor]; });
        return changes;
    }

    /**
     * โหมด probe: recordtypeid ที่มีการเปลี่ยนแปลง — ใช้ตั้ง RECTYPE_MAP
     * systemnote ทั้งบัญชีใหญ่มาก (รวม transaction) จึงต้องกรองแคบเสมอ:
     *   o.actor     employee id ของคนที่แก้ (ค่าเริ่มต้น = ผู้เปิดหน้า) — ส่ง '' เมื่อต้องการทุกคน
     *   o.recordId  internal id ของ object ที่เพิ่งแก้ (ถ้ารู้) — แคบที่สุด
     * คืน { rows, sql } (sql ไว้แสดงให้รู้ว่ากรองอะไร)
     */
    function probeRecordTypes(fromYmd, toYmd, o) {
        const opt = o || {};
        // ช่วงเวลาระดับชั่วโมง (o.fromTs / o.toTs = 'YYYY-MM-DD HH24:MI', toTs ไม่รวม) ใช้ซอยวันให้ request เล็กลง
        const byTs = opt.fromTs && opt.toTs;
        const where = byTs
            ? ["sn.date >= TO_DATE(?, 'YYYY-MM-DD HH24:MI')", "sn.date < TO_DATE(?, 'YYYY-MM-DD HH24:MI')"]
            : ["sn.date >= TO_DATE(?, 'YYYY-MM-DD')", "sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1"];
        const params = byTs ? [opt.fromTs, opt.toTs] : [fromYmd, toYmd];
        if (opt.actor) { where.push('sn.name = ?'); params.push(Number(opt.actor)); }
        if (opt.recordId) { where.push('sn.recordid = ?'); params.push(Number(opt.recordId)); }
        const rows = tbdllQuery.runSuiteQL({
            query: 'SELECT sn.recordtypeid AS rt, COUNT(*) AS cnt, MIN(sn.recordid) AS samplerec, MAX(sn.recordid) AS samplerec2, ' +
                "MIN(sn.field) AS samplefield, TO_CHAR(MAX(sn.date), 'YYYY-MM-DD HH24:MI') AS lastdate " +
                'FROM systemnote sn WHERE ' + where.join(' AND ') + ' GROUP BY sn.recordtypeid ORDER BY lastdate DESC',
            params
        }).asMappedResults().slice(0, opt.limit || 30);
        const mapped = rectypes().toType;
        rows.forEach(r => {
            r.mappedAs = mapped[String(r.rt)] || '';
            r.samples = String(r.samplerec) === String(r.samplerec2) ? String(r.samplerec) : r.samplerec + ', ' + r.samplerec2;
            r.label = '';
        });
        // ชื่อ record type: query ละแถว ใช้ตัวกรองเดียวกัน (ไม่สแกนทั้งตาราง) ทำเฉพาะเมื่อผลไม่เยอะ
        if (!opt.skipLabels && rows.length <= 15) {
            rows.forEach(r => {
                try {
                    const x = tbdllQuery.runSuiteQL({
                        query: 'SELECT BUILTIN.DF(sn.recordtypeid) AS label FROM systemnote sn WHERE ' + where.join(' AND ') + ' AND sn.recordtypeid = ? FETCH FIRST 1 ROWS ONLY',
                        params: params.concat([r.rt])
                    }).asMappedResults();
                    r.label = x.length ? x[0].label : '';
                } catch (e) { r.label = ''; }
            });
        }
        return rows;
    }

    // ---------- ขอบเขต File ----------

    /** id ของโฟลเดอร์ SuiteScripts และโฟลเดอร์ย่อยทุกชั้น (string) */
    function suiteScriptFolderIds() {
        const root = String(CFG.SUITESCRIPTS_FOLDER_ID);
        const all = runAll('SELECT id, parent FROM mediaitemfolder');
        const kids = {};
        all.forEach(f => { const p = f.parent === null || f.parent === undefined ? '' : String(f.parent); (kids[p] = kids[p] || []).push(String(f.id)); });
        const out = {}, stack = [root];
        while (stack.length) {
            const id = stack.pop();
            if (out[id]) continue;
            out[id] = true;
            (kids[id] || []).forEach(k => stack.push(k));
        }
        return out;
    }

    /** id ของไฟล์ที่อยู่ในขอบเขต FILE_SCOPE จากรายการ id ที่ให้มา → set (string) · 'all' = คืน null (ไม่กรอง) */
    /** นามสกุลไฟล์ (ตัวเล็ก) ผ่านเกณฑ์ CODE_FILE_EXTENSIONS ไหม */
    function isCodeFile(name) {
        const exts = (CFG.CODE_FILE_EXTENSIONS || []).map(e => String(e).replace(/^\./, '').toLowerCase());
        if (!exts.length) return true;
        const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
        return !!m && exts.indexOf(m[1]) >= 0;
    }

    function fileIdsInScope(fileIds) {
        const scope = CFG.FILE_SCOPE || 'suitescripts';
        const byExt = (CFG.CODE_FILE_EXTENSIONS || []).length > 0;
        if ((scope === 'all' && !byExt) || !fileIds.length) return null;
        const keep = {};
        const scriptFiles = {};
        if (scope === 'scriptfile') {
            chunk(ids(fileIds), 200).forEach(part => runAll('SELECT DISTINCT scriptfile FROM script WHERE scriptfile IN (' + part.join(',') + ')')
                .forEach(r => { scriptFiles[String(r.scriptfile)] = true; }));
        }
        const folders = scope === 'suitescripts' ? suiteScriptFolderIds() : null;
        // id ที่ไม่อยู่ในตาราง file (เช่น folder ซึ่ง System Note ก็ขึ้น MEDIAITEM.) จะไม่ถูกเก็บ
        chunk(ids(fileIds), 200).forEach(part => runAll('SELECT id, name, folder FROM file WHERE id IN (' + part.join(',') + ')')
            .forEach(r => {
                const id = String(r.id);
                if (scope === 'scriptfile' && !scriptFiles[id]) return;
                if (folders && !folders[String(r.folder)]) return;
                if (!isCodeFile(r.name)) return;
                keep[id] = true;
            }));
        return keep;
    }

    /** ตัดการเปลี่ยนแปลงของ File ที่อยู่นอกขอบเขต */
    function applyFileScope(changes) {
        const fileIds = changes.filter(c => c.objType === 'File').map(c => c.objId).filter((x, i, a) => a.indexOf(x) === i);
        const keep = fileIdsInScope(fileIds);
        if (!keep) return changes;
        return changes.filter(c => c.objType !== 'File' || keep[c.objId]);
    }

    /**
     * หา recordtypeid ของ File อัตโนมัติ: ไฟล์ใต้ SuiteScripts ที่แก้ล่าสุด n ไฟล์ → System Note ของไฟล์นั้นในวันที่แก้
     * คืน [{rt, cnt, fileId, fileName, day}] — rt ที่ซ้ำกันหลายไฟล์ = มั่นใจได้
     */
    function autoDetectFileRectype(n) {
        const folders = Object.keys(suiteScriptFolderIds()).map(Number).filter(Number.isFinite);
        const files = [];
        chunk(folders, 200).forEach(part => runAll(
            "SELECT id, name, TO_CHAR(lastmodifieddate, 'YYYY-MM-DD') AS d, lastmodifieddate AS lm FROM file WHERE folder IN (" + part.join(',') + ') ORDER BY lastmodifieddate DESC FETCH FIRST ' + (n || 5) + ' ROWS ONLY')
            .forEach(f => files.push(f)));
        files.sort((a, b) => String(b.d).localeCompare(String(a.d)));
        const out = [];
        files.slice(0, n || 5).forEach(f => {
            const rows = tbdllQuery.runSuiteQL({
                query: "SELECT sn.recordtypeid AS rt, COUNT(*) AS cnt FROM systemnote sn WHERE sn.date >= TO_DATE(?, 'YYYY-MM-DD') AND sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1 AND sn.recordid = ? GROUP BY sn.recordtypeid",
                params: [f.d, f.d, Number(f.id)]
            }).asMappedResults();
            rows.forEach(r => out.push({ rt: r.rt, cnt: r.cnt, fileId: String(f.id), fileName: f.name, day: f.d }));
            if (!rows.length) out.push({ rt: '', cnt: 0, fileId: String(f.id), fileName: f.name, day: f.d });
        });
        return out;
    }

    /** ชื่อของ recordtypeid หนึ่งตัว — กรองด้วยวันที่ที่รู้ว่ามีแถว (ไม่สแกนทั้งตาราง) */
    function recordTypeLabel(rt, dayYmd) {
        try {
            const x = tbdllQuery.runSuiteQL({
                query: "SELECT BUILTIN.DF(sn.recordtypeid) AS label FROM systemnote sn WHERE sn.date >= TO_DATE(?, 'YYYY-MM-DD') AND sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1 AND sn.recordtypeid = ? FETCH FIRST 1 ROWS ONLY",
                params: [dayYmd, dayYmd, Number(rt)]
            }).asMappedResults();
            return x.length ? (x[0].label || '') : '';
        } catch (e) { return ''; }
    }

    /** รายการวัน YYYY-MM-DD จาก from ถึง to (รวมปลาย) */
    function daysBetween(fromYmd, toYmd, max) {
        const out = [];
        let t = parseTs(fromYmd);
        const end = parseTs(toYmd);
        while (t !== null && end !== null && t <= end && out.length < (max || 366)) {
            out.push(fmtTs(t).slice(0, 10));
            t += 864e5;
        }
        return out;
    }

    // ---------- สรุป (pure) ----------

    /**
     * ติดธงและสรุป
     * @param {Array} changes จาก groupChanges + attachObjectNames
     * @param {Object} deployers set ของ employee id ที่มีสิทธิ์ deploy ({} = ไม่ได้ตั้ง → ไม่ติดธง)
     */
    function summarize(changes, deployers) {
        const hasList = CFG.FLAG_UNAUTHORIZED !== false && Object.keys(deployers || {}).length > 0;
        const byType = {}, byActor = {};
        let flagged = 0;
        changes.forEach(c => {
            c.tsText = fmtTs(c.ts);
            c.flag = hasList && !deployers[c.actor] ? 'ผู้แก้ไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy' : '';
            if (c.flag) flagged++;
            byType[c.objType] = (byType[c.objType] || 0) + 1;
            byActor[c.actorName || '-'] = (byActor[c.actorName || '-'] || 0) + 1;
        });
        const top = o => Object.keys(o).map(k => ({ label: k, value: o[k] })).sort((a, b) => b.value - a.value);
        return { changes, total: changes.length, flagged, objects: Object.keys(changes.reduce((m, c) => (m[c.objType + '|' + c.objId] = 1, m), {})).length, byType: top(byType), byActor: top(byActor) };
    }

    /**
     * รวมการเปลี่ยนแปลงตาม script (pure) — สำหรับมุมมองผู้ตรวจ ไม่แตกทีละ log
     * แต่ละกลุ่ม = script หนึ่งตัว มีลูกเป็นสิ่งที่ถูกแก้: Script record / Deployment แต่ละตัว / File แต่ละไฟล์
     * File ที่ไม่ใช่ Script File ของ script ไหน → กลุ่ม "ไฟล์อื่น" · object ที่ไม่รู้ script → กลุ่ม "ไม่ทราบ script"
     */
    function groupByScript(changes) {
        const groups = {};
        const touch = (o, c) => {
            o.count++;
            if (c.actorName && o.editors.indexOf(c.actorName) < 0) o.editors.push(c.actorName);
            if (c.ts !== null && c.ts !== undefined) { o.first = o.first === null ? c.ts : Math.min(o.first, c.ts); o.last = o.last === null ? c.ts : Math.max(o.last, c.ts); }
        };
        const newNode = (kind, label, sub) => ({ kind, label, sub: sub || '', count: 0, editors: [], first: null, last: null });
        const group = (key, info) => groups[key] || (groups[key] = Object.assign({ key, children: {}, editors: [], count: 0, first: null, last: null, deployedOn: [] }, info));
        const addDeployedOn = (g, list) => (list || []).forEach(r => { if (g.deployedOn.indexOf(r) < 0) g.deployedOn.push(r); });

        changes.forEach(c => {
            const scripts = c.scripts || [];
            let targets;
            if (scripts.length) {
                targets = scripts.map(s => {
                    const g = group('s:' + s.id, { kind: 'script', scriptId: s.id, scriptid: s.scriptid, name: s.name, type: s.type });
                    addDeployedOn(g, s.deployedOn);
                    return g;
                });
            } else if (c.objType === 'File') {
                targets = [group('files', { kind: 'files', name: 'ไฟล์ที่ไม่ใช่ Script File ของ script ไหน', type: 'lib / HTML / template' })];
            } else {
                targets = [group('unknown', { kind: 'unknown', name: 'ไม่ทราบ script', type: c.objType })];
            }
            const nodeKey = c.objType + '|' + c.objId;
            const label = c.objType === 'Script' ? 'Script record' : c.objType === 'Script Deployment' ? 'Deployment: ' + c.objName : c.objName;
            const sub = c.objType === 'Script Deployment' && scripts[0] && scripts[0].deployedOn && scripts[0].deployedOn.length ? 'บน ' + scripts[0].deployedOn.join(', ') : c.objType === 'File' ? 'File #' + c.objId : '';
            targets.forEach(g => {
                const n = g.children[nodeKey] || (g.children[nodeKey] = newNode(c.objType, label, sub));
                touch(n, c);
                touch(g, c);
            });
        });

        const order = { 'Script': 0, 'Script Deployment': 1, 'File': 2 };
        return Object.keys(groups).map(k => {
            const g = groups[k];
            g.children = Object.keys(g.children).map(x => g.children[x]).sort((a, b) => (a.kind in order ? order[a.kind] : 9) - (b.kind in order ? order[b.kind] : 9) || (b.last || 0) - (a.last || 0));
            g.firstText = fmtTs(g.first); g.lastText = fmtTs(g.last);
            g.children.forEach(n => { n.firstText = fmtTs(n.first); n.lastText = fmtTs(n.last); });
            return g;
        }).sort((a, b) => (a.kind === 'script' ? 0 : 1) - (b.kind === 'script' ? 0 : 1) || (b.last || 0) - (a.last || 0));
    }

    /** CSV แบบรวมตาม script — 1 แถวต่อสิ่งที่ถูกแก้ พร้อมช่องให้กรอก CR */
    function toGroupCsv(fromYmd, toYmd, groups) {
        const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
        const head = ['Script ID', 'Script Name', 'Script Type', 'Deployed On', 'Changed Item', 'Item Type', 'Saves', 'Changed By', 'First Change', 'Last Change', 'CR No.', 'คำอธิบาย (กรณีไม่มี CR)', 'ผู้ตรวจ / วันที่'];
        const lines = [['Period', fromYmd + ' to ' + toYmd, 'Scripts', groups.filter(g => g.kind === 'script').length].map(q).join(','), head.map(q).join(',')];
        groups.forEach(g => g.children.forEach(n => lines.push([g.scriptid || '', g.name, g.type, g.deployedOn.join(' '), n.label, n.kind, n.count, n.editors.join(', '), n.firstText, n.lastText, '', '', ''].map(q).join(','))));
        return '﻿' + lines.join('\r\n');
    }

    function run(fromYmd, toYmd) {
        const t0 = Date.now();
        const notes = fetchSystemNotes(fromYmd, toYmd);
        const t1 = Date.now();
        const changes = attachScriptInfo(attachActorNames(attachObjectNames(applyFileScope(groupChanges(notes)))));
        const res = summarize(changes, CFG.FLAG_UNAUTHORIZED === false ? {} : deployerSet());
        res.noteRows = notes.length;
        res.ms = Date.now() - t0;
        res.actors = Object.keys(changes.reduce((m, c) => (m[c.actor] = 1, m), {})).length;
        res.groups = groupByScript(changes);
        res.scripts = res.groups.filter(g => g.kind === 'script').length;
        tbdllLog('run', fromYmd + '..' + toYmd + ' · systemnote ' + notes.length + ' แถว (' + (t1 - t0) + ' ms) · changes ' + res.total + ' · objects ' + res.objects +
            ' · flagged ' + res.flagged + ' · รวม ' + res.ms + ' ms');
        return res;
    }

    /** CSV สำหรับกระทบยอดใน Excel — 3 คอลัมน์ท้ายให้ IT / ผู้ review กรอก */
    function toCsv(fromYmd, toYmd, res) {
        const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
        const head = ['Changed At', 'Object Type', 'Object', 'Object ID', 'Script (ID · ชื่อ · ประเภท · deploy บน)', 'Changed By', 'Role', 'Context', 'Fields', 'Old → New (ตัวอย่าง)', 'Flag',
            'CR No.', 'คำอธิบาย (กรณีไม่มี CR)', 'ผู้ตรวจ / วันที่'];
        const lines = [
            ['Period', fromYmd + ' to ' + toYmd, 'Changes', res.total, 'Flagged', res.flagged].map(q).join(','),
            head.map(q).join(',')
        ];
        res.changes.forEach(c => lines.push([c.tsText, c.objType, c.objName, c.objId, c.scriptText || '', c.actorName, c.roleName, c.context, c.fields.join(' '), c.details.join(' | '), c.flag, '', '', ''].map(q).join(',')));
        return '﻿' + lines.join('\r\n');
    }

    return {
        CFG, runAll, chunk, ids, parseTs, fmtTs, ymd,
        rectypes, rectypeWhere, typeOfNote, configWarnings, employeesWithRoles, deployerSet,
        fetchSystemNotes, groupChanges, attachObjectNames, attachActorNames, attachScriptInfo, probeRecordTypes, recordTypeLabel, daysBetween,
        suiteScriptFolderIds, fileIdsInScope, applyFileScope, autoDetectFileRectype,
        summarize, run, toCsv, groupByScript, toGroupCsv,
        log: tbdllLog
    };
});
