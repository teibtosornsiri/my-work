/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * TB_DL_SL_Recon — Change Reconciliation Report (spec หัวข้อ 5–6)
 *   (ไม่มี param)            รายงาน: System Notes เทียบ Change Log → Matched / Exception E1–E6
 *   &view=probe              หา recordtypeid ของ object แต่ละประเภท ใช้ตั้ง RECTYPE_MAP ใน TB_DL_Config
 *   &action=explain          ฟอร์มอธิบาย exception (GET แสดง / POST บันทึก)
 *   &action=signoff          ผู้ review sign-off ช่วงวันที่ (ต้องอธิบาย exception ครบก่อน)
 *   &export=csv              ดาวน์โหลด CSV
 * filter: f_from, f_to (รูปแบบวันที่ของผู้ใช้) — ค่าเริ่มต้น = เดือนก่อน
 *
 * ต้องมี Lib_Report_UI.js (Report CI) อยู่โฟลเดอร์เดียวกัน หรือแก้ path ใน define
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/format', 'N/url', 'N/record', 'N/redirect', 'N/query', './Lib_Report_UI', './TB_DL_Lib'],
    (serverWidget, runtime, format, url, record, redirect, query, UI, L) => {

        const CFG = L.CFG, F = L.F;
        const CODE_TONE = { E1: 'neg', E2: 'warn', E3: 'warn', E4: 'neg', E5: 'info', E6: 'warn' };
        const RESOLUTIONS = ['เปิด CR ย้อนหลังแบบ Emergency แล้ว', 'Rollback แล้ว', 'แก้ข้อมูลใน Change Log แล้ว', 'ยอมรับความเสี่ยง (ระบุเหตุผล)', 'อื่น ๆ'];

        // ---------- วันที่ ----------

        function dateFmt() {
            try { return runtime.getCurrentUser().getPreference({ name: 'DATEFORMAT' }); } catch (e) { return ''; }
        }

        function readPeriod(p) {
            const now = new Date();
            const defFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const defTo = new Date(now.getFullYear(), now.getMonth(), 0);
            const parse = (s, d) => {
                if (!s) return d;
                const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);   // ลิงก์จากอีเมลส่ง YYYY-MM-DD
                if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
                try { return format.parse({ value: s, type: format.Type.DATE }); } catch (e) { return d; }
            };
            const from = parse(p.f_from, defFrom), to = parse(p.f_to, defTo);
            return {
                from, to,
                fromText: format.format({ value: from, type: format.Type.DATE }),
                toText: format.format({ value: to, type: format.Type.DATE }),
                fromYmd: L.ymd(from), toYmd: L.ymd(to)
            };
        }

        function selfUrl(params) {
            const s = runtime.getCurrentScript();
            return url.resolveScript({ scriptId: s.id, deploymentId: s.deploymentId, params: params || {} });
        }

        const isReviewer = me => L.ids(CFG.REVIEWER_EMPLOYEE_IDS).indexOf(Number(me)) >= 0;

        // ---------- sign-off record ----------

        function findSignoff(per) {
            const r = query.runSuiteQL({
                query: 'SELECT s.id, s.name, s.' + F.sStatus + ' AS st, BUILTIN.DF(s.' + F.sReviewer + ') AS reviewer, ' +
                    "TO_CHAR(s." + F.sSignedDate + ", 'YYYY-MM-DD HH24:MI') AS signed, s." + F.sFile + ' AS fileid ' +
                    'FROM ' + L.REC.SIGN + ' s WHERE s.' + F.sFrom + " = TO_DATE(?, 'YYYY-MM-DD') AND s." + F.sTo + " = TO_DATE(?, 'YYYY-MM-DD') " +
                    "AND s.isinactive = 'F' ORDER BY s.id DESC",
                params: [per.fromYmd, per.toYmd]
            }).asMappedResults();
            return r.length ? r[0] : null;
        }

        // ---------- หน้า ----------

        function exceptionUrl(per, e) {
            return selfUrl({
                action: 'explain', f_from: per.fromText, f_to: per.toText,
                k: e.key, code: e.code, obj: (e.objType ? e.objType + ': ' : '') + (e.objName || ''), ts: e.tsText || '', actor: e.actor || '', cr: e.crId || ''
            });
        }

        function buildReport(ui, per, res, ctx) {
            const s = res.summary;
            const me = String(runtime.getCurrentUser().id);
            const so = ctx.signoff;
            const recUrl = id => url.resolveRecord({ recordType: L.REC.LOG, recordId: id });

            const excRows = res.exceptions.map(e => Object.assign({}, e, {
                codeBadge: { text: e.code, tone: CODE_TONE[e.code] || 'muted' },
                object: (e.objType ? e.objType + ': ' : '') + (e.objName || ''),
                state: e.explanation ? { text: 'อธิบายแล้ว', tone: 'pos' } : { text: 'รออธิบาย', tone: 'neg' },
                explainText: e.explanation ? (e.explanation.resolution + (e.explanation.explain ? ' · ' + e.explanation.explain : '') + ' — ' + e.explanation.by) : '',
                act: e.explanation ? 'แก้คำอธิบาย' : 'อธิบาย'
            })).sort((a, b) => (a.explanation ? 1 : 0) - (b.explanation ? 1 : 0) || a.code.localeCompare(b.code));

            const chgRows = res.changes.map(c => Object.assign({}, c, {
                object: c.objType + ': ' + c.objName,
                fieldsText: c.fields.join(', '),
                resBadge: c.result === 'Matched' ? { text: 'Matched', tone: 'pos' } : { text: (c.exceptionCodes || []).join(', ') || 'Exception', tone: 'neg' }
            }));

            const crRows = res.crRows.map(r => Object.assign({}, r, {
                st: { text: r.status, tone: r.status === 'Verified' ? 'pos' : r.status === 'Deployed' ? 'info' : r.status === 'Rolled back' ? 'warn' : 'muted' }
            }));

            const priv = L.employeesWithRoles(CFG.PRIVILEGED_ROLE_IDS.concat(CFG.DEPLOYER_ROLE_IDS));

            const canSign = isReviewer(me) && !(so && so.st === 'Signed');
            const signBtn = canSign ? ui.button('Sign-off ช่วงนี้', {
                kind: 'primary', icon: 'check',
                onclick: "if(confirm('ยืนยัน sign-off รายงานช่วง " + per.fromText + " – " + per.toText + " ในชื่อของคุณ?'))location.href='" + selfUrl({ action: 'signoff', f_from: per.fromText, f_to: per.toText }) + "'"
            }) : '';

            const warnings = ctx.warnings.map(w => ui.alert(w, 'warn')).join('');
            const signInfo = so
                ? ui.alert(so.st === 'Signed' ? 'Sign-off แล้วโดย ' + so.reviewer + ' เมื่อ ' + so.signed : 'มี snapshot ของช่วงนี้แล้ว รอ sign-off', so.st === 'Signed' ? 'pos' : 'info')
                : '';

            return ui.render([
                ui.header({
                    crumb: 'IT Controls', crumbCurrent: 'Change Reconciliation',
                    title: 'กระทบยอดการเปลี่ยนแปลงใน PROD ' + per.fromText + ' – ' + per.toText,
                    meta: 'System Notes ' + res.noteRows + ' แถว · ช่วงหลัง deploy ที่ยังนับ ' + CFG.WINDOW_HOURS + ' ชม.',
                    actions: [
                        ui.button('Export CSV', { href: selfUrl({ f_from: per.fromText, f_to: per.toText, export: 'csv' }), icon: 'download', kind: 'ghost' }),
                        ui.button('Probe record types', { href: selfUrl({ view: 'probe', f_from: per.fromText, f_to: per.toText }), kind: 'ghost' }),
                        signBtn
                    ]
                }),
                warnings, signInfo,
                ui.filterBar({
                    action: ctx.baseUrl, hidden: ctx.hidden, cols: 3,
                    fields: [
                        ui.field({ id: 'f_from', label: 'ตั้งแต่', type: 'date', value: per.fromText, picker: ctx.dateFmt }),
                        ui.field({ id: 'f_to', label: 'ถึง', type: 'date', value: per.toText, picker: ctx.dateFmt })
                    ]
                }),
                ui.kpis([
                    { label: 'การเปลี่ยนแปลงใน PROD', value: ui.int(s.changes), icon: 'doc' },
                    { label: 'Matched กับ CR', value: ui.int(s.matched), icon: 'check' },
                    { label: 'Exception', value: ui.int(s.exceptions), bad: s.exceptions > 0, note: Object.keys(s.byCode).sort().map(k => k + ' ' + s.byCode[k]).join(' · ') },
                    { label: 'รออธิบาย', value: ui.int(s.unexplained), bad: s.unexplained > 0, note: s.unexplained ? 'ต้องอธิบายครบก่อน sign-off' : 'พร้อม sign-off' },
                    { label: 'CR ในช่วง', value: ui.int(s.crs), icon: 'doc' }
                ]),
                ui.tabs([
                    {
                        id: 'exc', label: 'Exceptions', count: excRows.length,
                        body: ui.table({
                            emptyTitle: 'ไม่มี Exception', emptyText: 'ทุกการเปลี่ยนแปลงในช่วงนี้มี CR รองรับ',
                            columns: [
                                { key: 'codeBadge', label: 'รหัส', type: 'badge' },
                                { key: 'codeText', label: 'ความหมาย', type: 'wrap' },
                                { key: 'object', label: 'Object', type: 'wrap', sub: 'fields' },
                                { key: 'tsText', label: 'เวลา', type: 'date' },
                                { key: 'actorName', label: 'ผู้แก้' },
                                { key: 'cr', label: 'CR', link: r => r.crId ? recUrl(r.crId) : '' },
                                { key: 'detail', label: 'รายละเอียด', type: 'wrap' },
                                { key: 'state', label: 'สถานะ', type: 'badge' },
                                { key: 'explainText', label: 'คำอธิบาย', type: 'wrap' },
                                { key: 'act', label: '', link: r => exceptionUrl(per, r) }
                            ],
                            rows: excRows
                        })
                    },
                    {
                        id: 'chg', label: 'การเปลี่ยนแปลงทั้งหมด', count: chgRows.length,
                        body: ui.table({
                            emptyTitle: 'ไม่พบการเปลี่ยนแปลง', emptyText: ctx.warnings.length ? 'ตรวจคำเตือนด้านบน (RECTYPE_MAP อาจยังไม่ได้ตั้ง)' : 'ไม่มี System Note ของ object ในขอบเขตช่วงนี้',
                            columns: [
                                { key: 'tsText', label: 'เวลา', type: 'date' },
                                { key: 'object', label: 'Object', type: 'wrap', sub: 'fieldsText' },
                                { key: 'actorName', label: 'ผู้แก้', sub: 'roleName' },
                                { key: 'context', label: 'Context' },
                                { key: 'cr', label: 'CR', link: r => r.crId ? recUrl(r.crId) : '' },
                                { key: 'resBadge', label: 'ผล', type: 'badge' }
                            ],
                            rows: chgRows
                        })
                    },
                    {
                        id: 'cr', label: 'CR ในช่วง (population)', count: crRows.length,
                        body: ui.table({
                            emptyTitle: 'ไม่มี CR ที่อนุมัติหรือ deploy ในช่วงนี้',
                            columns: [
                                { key: 'name', label: 'CR', link: r => recUrl(r.id), sub: 'type' },
                                { key: 'st', label: 'สถานะ', type: 'badge' },
                                { key: 'approverName', label: 'ผู้อนุมัติ', sub: 'approveText' },
                                { key: 'developerName', label: 'Developer' },
                                { key: 'deployerName', label: 'ผู้ deploy', sub: 'deployText' },
                                { key: 'method', label: 'วิธี' },
                                { key: 'objects', label: 'Objects', type: 'int' },
                                { key: 'codes', label: 'Exception' }
                            ],
                            rows: crRows
                        })
                    },
                    {
                        id: 'priv', label: 'ผู้ถือสิทธิ์สูง', count: priv.length,
                        body: ui.table({
                            note: 'ผู้ sign-off ยืนยันว่ารายชื่อนี้ยังจำเป็น (Administrator และ role ผู้ deploy)',
                            emptyTitle: 'ไม่มีข้อมูล', emptyText: 'ตั้ง PRIVILEGED_ROLE_IDS / DEPLOYER_ROLE_IDS ใน TB_DL_Config',
                            columns: [{ key: 'name', label: 'ชื่อ' }, { key: 'rolename', label: 'Role' }],
                            rows: priv
                        })
                    },
                    {
                        id: 'hash', label: 'ไฟล์ที่ยังไม่ได้ตรวจ SHA-1', count: res.hashNotes.length,
                        body: ui.table({
                            emptyTitle: 'ตรวจ SHA-1 ครบทุกไฟล์',
                            columns: [{ key: 'objName', label: 'ไฟล์' }, { key: 'cr', label: 'CR' }, { key: 'note', label: 'เหตุผล', type: 'wrap' }],
                            rows: res.hashNotes
                        })
                    }
                ])
            ]);
        }

        function buildProbe(ui, per, rows, ctx) {
            return ui.render([
                ui.header({
                    crumb: 'Change Reconciliation', crumbCurrent: 'Probe',
                    title: 'recordtypeid ที่มีการเปลี่ยนแปลง ' + per.fromText + ' – ' + per.toText,
                    meta: 'วิธีใช้: แก้ object ที่รู้จัก (เช่นอัปไฟล์ทับ 1 ไฟล์, แก้ description ของ script 1 ตัว) แล้วเปิดหน้านี้ช่วงวันนั้น หาแถวที่ตรงกับเวลา แล้วใส่ใน RECTYPE_MAP',
                    actions: [ui.button('กลับไปรายงาน', { href: selfUrl({ f_from: per.fromText, f_to: per.toText }), kind: 'ghost' })]
                }),
                ui.filterBar({
                    action: ctx.baseUrl, hidden: Object.assign({}, ctx.hidden, { view: 'probe' }), cols: 3,
                    fields: [
                        ui.field({ id: 'f_from', label: 'ตั้งแต่', type: 'date', value: per.fromText, picker: ctx.dateFmt }),
                        ui.field({ id: 'f_to', label: 'ถึง', type: 'date', value: per.toText, picker: ctx.dateFmt })
                    ]
                }),
                ui.card({
                    title: '30 อันดับที่มีแถวมากที่สุด', flush: true, body: ui.table({
                        columns: [
                            { key: 'rt', label: 'recordtypeid' },
                            { key: 'label', label: 'ชื่อ (BUILTIN.DF)', type: 'wrap' },
                            { key: 'cnt', label: 'จำนวนแถว', type: 'int' },
                            { key: 'samplerec', label: 'recordid ตัวอย่าง' },
                            { key: 'samplefield', label: 'field ตัวอย่าง' },
                            { key: 'lastdate', label: 'ล่าสุด', type: 'date' },
                            { key: 'mappedAs', label: 'map แล้วเป็น' }
                        ],
                        rows
                    })
                })
            ]);
        }

        // ---------- explain ----------

        function explainForm(ctx, p) {
            const form = serverWidget.createForm({ title: 'อธิบาย Exception ' + (p.code || '') });
            const info = form.addField({ id: 'custpage_info', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
            const esc = UI.esc;
            const existing = L.fetchExplanations([p.k])[p.k];
            info.defaultValue = '<div style="font:13px/1.7 sans-serif;margin:8px 0 16px">'
                + '<b>' + esc(p.code + ' — ' + (L.EXC[p.code] || '')) + '</b><br>Object: ' + esc(p.obj || '-') + '<br>เวลา: ' + esc(p.ts || '-') + '</div>';
            const add = (id, type, label, src) => form.addField({ id, type, label, source: src });
            const hidden = (id, v) => { const f = add(id, serverWidget.FieldType.TEXT, id); f.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }); f.defaultValue = v || ''; };
            hidden('custpage_k', p.k); hidden('custpage_code', p.code); hidden('custpage_obj', p.obj); hidden('custpage_ts', p.ts);
            hidden('custpage_actor', p.actor); hidden('custpage_from', p.f_from); hidden('custpage_to', p.f_to);
            const res = add('custpage_resolution', serverWidget.FieldType.SELECT, 'การแก้ไข');
            res.isMandatory = true;
            res.addSelectOption({ value: '', text: '' });
            RESOLUTIONS.forEach(r => res.addSelectOption({ value: r, text: r, isSelected: !!existing && existing.resolution === r }));
            const ex = add('custpage_explain', serverWidget.FieldType.LONGTEXT, 'คำอธิบาย');
            ex.isMandatory = true;
            if (existing) ex.defaultValue = existing.explain;
            const cr = add('custpage_cr', serverWidget.FieldType.SELECT, 'CR ที่เกี่ยวข้อง', L.REC.LOG);
            if (p.cr) cr.defaultValue = p.cr;
            form.addSubmitButton({ label: 'บันทึก' });
            ctx.response.writePage(form);
        }

        function saveExplain(ctx) {
            const p = ctx.request.parameters;
            const key = p.custpage_k;
            if (!key || !p.custpage_explain || !p.custpage_resolution) throw new Error('กรอกการแก้ไขและคำอธิบายให้ครบ');
            const existing = L.fetchExplanations([key])[key];
            const rec = existing ? record.load({ type: L.REC.EXC, id: existing.id }) : record.create({ type: L.REC.EXC });
            const set = (f, v) => rec.setValue({ fieldId: f, value: v });
            set('name', key.slice(0, 300));
            set(F.eCode, p.custpage_code || '');
            set(F.eObject, (p.custpage_obj || '').slice(0, 300));
            set(F.eChangeTs, p.custpage_ts || '');
            if (p.custpage_actor) set(F.eActor, Number(p.custpage_actor));
            set(F.eExplain, p.custpage_explain);
            set(F.eResolution, p.custpage_resolution);
            if (p.custpage_cr) set(F.eCr, Number(p.custpage_cr));
            set(F.eBy, Number(runtime.getCurrentUser().id));
            set(F.eDate, new Date());
            rec.save();
            redirect.redirect({ url: selfUrl({ f_from: p.custpage_from, f_to: p.custpage_to }) });
        }

        // ---------- sign-off ----------

        function signoff(per, res) {
            const me = runtime.getCurrentUser();
            if (!isReviewer(me.id)) throw new Error('คุณไม่อยู่ในรายชื่อผู้ sign-off (REVIEWER_EMPLOYEE_IDS)');
            if (res.summary.unexplained > 0) throw new Error('ยังมี Exception ที่ไม่ได้อธิบาย ' + res.summary.unexplained + ' รายการ — อธิบายให้ครบก่อน sign-off');
            const so = findSignoff(per);
            if (so && so.st === 'Signed') throw new Error('ช่วงนี้ sign-off ไปแล้ว');
            const rec = so ? record.load({ type: L.REC.SIGN, id: so.id }) : record.create({ type: L.REC.SIGN });
            if (!so) {
                rec.setValue({ fieldId: 'name', value: per.fromYmd + ' – ' + per.toYmd });
                rec.setValue({ fieldId: F.sFrom, value: per.from });
                rec.setValue({ fieldId: F.sTo, value: per.to });
                rec.setValue({ fieldId: F.sNote, value: 'สร้างตอน sign-off (ไม่มี snapshot จาก scheduled script)' });
            }
            // เก็บตัวเลข ณ เวลาที่ sign-off
            rec.setValue({ fieldId: F.sTotal, value: res.summary.changes });
            rec.setValue({ fieldId: F.sMatched, value: res.summary.matched });
            rec.setValue({ fieldId: F.sExceptions, value: res.summary.exceptions });
            rec.setValue({ fieldId: F.sReviewer, value: Number(me.id) });
            rec.setValue({ fieldId: F.sSignedDate, value: new Date() });
            rec.setValue({ fieldId: F.sStatus, value: 'Signed' });
            rec.save();
            L.log('signoff', per.fromYmd + '..' + per.toYmd + ' by ' + me.name);
        }

        // ---------- entry ----------

        function page(ctx, title, html) {
            const form = serverWidget.createForm({ title });
            const f = form.addField({ id: 'custpage_rui', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
            f.defaultValue = html;
            ctx.response.writePage(form);
        }

        function onRequest(ctx) {
            const p = ctx.request.parameters;
            const ui = UI.create({ theme: p.theme || CFG.THEME, density: p.density });
            const s = runtime.getCurrentScript();
            const base = url.resolveScript({ scriptId: s.id, deploymentId: s.deploymentId });
            const view = {
                baseUrl: base.split('?')[0],
                hidden: { script: p.script, deploy: p.deploy, compid: p.compid || '' },
                dateFmt: dateFmt(),
                warnings: L.configWarnings()
            };

            try {
                if (ctx.request.method === 'POST' && p.custpage_k) return saveExplain(ctx);
                if (p.action === 'explain') return explainForm(ctx, p);

                const per = readPeriod(p);
                if (p.view === 'probe') {
                    return page(ctx, 'Change Reconciliation — Probe', buildProbe(ui, per, L.probeRecordTypes(per.fromYmd, per.toYmd, 30), view));
                }

                const res = L.runReconciliation({ fromYmd: per.fromYmd, toYmd: per.toYmd, maxHashFiles: CFG.HASH_MAX_FILES_SUITELET });

                if (p.action === 'signoff') {
                    signoff(per, res);
                    return redirect.redirect({ url: selfUrl({ f_from: per.fromText, f_to: per.toText }) });
                }
                if (p.export === 'csv') {
                    ctx.response.addHeader({ name: 'Content-Type', value: 'text/csv; charset=utf-8' });
                    ctx.response.addHeader({ name: 'Content-Disposition', value: 'attachment; filename="change_reconciliation_' + per.fromYmd + '_' + per.toYmd + '.csv"' });
                    return ctx.response.write(L.toCsv(per.fromYmd, per.toYmd, res));
                }
                view.signoff = findSignoff(per);
                return page(ctx, 'Change Reconciliation', buildReport(ui, per, res, view));
            } catch (e) {
                L.log('recon error', e.message + ' ' + (e.stack || ''));
                return page(ctx, 'Change Reconciliation', ui.render([
                    ui.header({ crumb: 'IT Controls', title: 'Change Reconciliation' }),
                    ui.alert('ทำรายการไม่สำเร็จ: ' + e.message, 'neg'),
                    ui.button('กลับไปรายงาน', { href: selfUrl({ f_from: p.f_from || p.custpage_from || '', f_to: p.f_to || p.custpage_to || '' }), kind: 'ghost' })
                ]));
            }
        }

        return { onRequest };
    });
