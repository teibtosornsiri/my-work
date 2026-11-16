/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * TB_DLL_SL_Report — รายงานการเปลี่ยนแปลงใน PROD (Deployment Change Log Lite)
 *   (ไม่มี param)   การเปลี่ยนแปลงจาก System Notes ตามช่วงวันที่ + ติดธงผู้แก้ที่ไม่มีสิทธิ์ deploy
 *   &view=probe     หา recordtypeid ของ object แต่ละประเภท ใช้ตั้ง RECTYPE_MAP ใน TB_DLL_Config
 *   &export=csv     CSV สำหรับกระทบยอดใน Excel (มีช่อง CR No. / คำอธิบาย / ผู้ตรวจ)
 * filter: f_from, f_to (รูปแบบวันที่ของผู้ใช้ หรือ YYYY-MM-DD) — ค่าเริ่มต้น = เดือนก่อน
 *
 * ต้องมี Lib_Report_UI.js (Report CI) อยู่โฟลเดอร์เดียวกัน หรือแก้ path ใน define
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/format', 'N/url', './Lib_Report_UI', './TB_DLL_Lib'],
    (serverWidget, runtime, format, url, UI, L) => {

        const CFG = L.CFG;

        function dateFmt() {
            try { return runtime.getCurrentUser().getPreference({ name: 'DATEFORMAT' }); } catch (e) { return ''; }
        }

        function readPeriod(p) {
            const now = new Date();
            const parse = (s, d) => {
                if (!s) return d;
                const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
                try { return format.parse({ value: s, type: format.Type.DATE }); } catch (e) { return d; }
            };
            const from = parse(p.f_from, new Date(now.getFullYear(), now.getMonth() - 1, 1));
            const to = parse(p.f_to, new Date(now.getFullYear(), now.getMonth(), 0));
            return {
                fromText: format.format({ value: from, type: format.Type.DATE }),
                toText: format.format({ value: to, type: format.Type.DATE }),
                fromYmd: L.ymd(from), toYmd: L.ymd(to)
            };
        }

        function selfUrl(params) {
            const s = runtime.getCurrentScript();
            return url.resolveScript({ scriptId: s.id, deploymentId: s.deploymentId, params: params || {} });
        }

        function filterBar(ui, per, ctx, extraHidden) {
            return ui.filterBar({
                action: ctx.baseUrl, hidden: Object.assign({}, ctx.hidden, extraHidden || {}), cols: 3,
                fields: [
                    ui.field({ id: 'f_from', label: 'ตั้งแต่', type: 'date', value: per.fromText, picker: ctx.dateFmt }),
                    ui.field({ id: 'f_to', label: 'ถึง', type: 'date', value: per.toText, picker: ctx.dateFmt })
                ]
            });
        }

        function buildReport(ui, per, res, ctx) {
            const rows = res.changes.slice().reverse().map(c => Object.assign({}, c, {
                object: c.objType + ': ' + c.objName,
                fieldsText: c.fields.join(', '),
                flagBadge: c.flag ? { text: 'ไม่มีสิทธิ์ deploy', tone: 'neg' } : { text: 'ปกติ', tone: 'pos' },
                detailText: c.details.join(' | ')
            }));
            const flaggedRows = rows.filter(r => r.flag);
            const priv = L.employeesWithRoles(CFG.PRIVILEGED_ROLE_IDS.concat(CFG.DEPLOYER_ROLE_IDS));
            const columns = [
                { key: 'tsText', label: 'เวลา', type: 'date' },
                { key: 'object', label: 'Object', type: 'wrap', sub: 'fieldsText' },
                { key: 'actorName', label: 'ผู้แก้', sub: 'roleName' },
                { key: 'context', label: 'Context' },
                { key: 'detailText', label: 'ค่าเดิม → ใหม่ (ตัวอย่าง)', type: 'wrap' },
                { key: 'flagBadge', label: 'ธง', type: 'badge' }
            ];

            return ui.render([
                ui.header({
                    crumb: 'IT Controls', crumbCurrent: 'Change Report',
                    title: 'การเปลี่ยนแปลงใน PROD ' + per.fromText + ' – ' + per.toText,
                    meta: 'System Notes ' + res.noteRows + ' แถว · Export CSV แล้วกรอกเลข CR ทุกแถว แถวที่ไม่มี CR ให้เขียนคำอธิบาย แล้วให้ผู้ review เซ็น',
                    actions: [
                        ui.button('Export CSV', { href: selfUrl({ f_from: per.fromYmd, f_to: per.toYmd, export: 'csv' }), icon: 'download', kind: 'primary' }),
                        ui.button('Probe record types', { href: selfUrl({ view: 'probe', f_from: per.fromYmd, f_to: per.toYmd }), kind: 'ghost' })
                    ]
                }),
                ctx.warnings.map(w => ui.alert(w, 'warn')).join(''),
                filterBar(ui, per, ctx),
                ui.kpis([
                    { label: 'การเปลี่ยนแปลง', value: ui.int(res.total), icon: 'doc' },
                    { label: 'Object ที่ถูกแก้', value: ui.int(res.objects), icon: 'doc' },
                    { label: 'ผู้แก้ไม่มีสิทธิ์ deploy', value: ui.int(res.flagged), bad: res.flagged > 0, note: res.flagged ? 'ต้องมีคำอธิบายทุกแถว' : '' }
                ]),
                res.total ? ui.grid([
                    ui.card({ title: 'ตามประเภท object', body: ui.barList(res.byType.slice(0, 8)) }),
                    ui.card({ title: 'ตามผู้แก้', body: ui.barList(res.byActor.slice(0, 8)) })
                ]) : '',
                ui.tabs([
                    {
                        id: 'flag', label: 'ติดธง', count: flaggedRows.length,
                        body: ui.table({ emptyTitle: 'ไม่มีรายการติดธง', emptyText: 'ทุกการเปลี่ยนแปลงทำโดยผู้มีสิทธิ์ deploy', columns, rows: flaggedRows })
                    },
                    {
                        id: 'all', label: 'ทั้งหมด', count: rows.length,
                        body: ui.table({
                            emptyTitle: 'ไม่พบการเปลี่ยนแปลง',
                            emptyText: ctx.warnings.length ? 'ตรวจคำเตือนด้านบน (RECTYPE_MAP อาจยังไม่ได้ตั้ง)' : 'ไม่มี System Note ของ object ในขอบเขตช่วงนี้',
                            columns, rows
                        })
                    },
                    {
                        id: 'priv', label: 'ผู้ถือสิทธิ์สูง', count: priv.length,
                        body: ui.table({
                            note: 'ผู้ review ยืนยันว่ารายชื่อนี้ยังจำเป็น (Administrator และ role ผู้ deploy)',
                            emptyTitle: 'ไม่มีข้อมูล', emptyText: 'ตั้ง PRIVILEGED_ROLE_IDS / DEPLOYER_ROLE_IDS ใน TB_DLL_Config',
                            columns: [{ key: 'name', label: 'ชื่อ' }, { key: 'rolename', label: 'Role' }],
                            rows: priv
                        })
                    }
                ])
            ]);
        }

        function buildProbe(ui, per, rows, ctx) {
            return ui.render([
                ui.header({
                    crumb: 'Change Report', crumbCurrent: 'Probe',
                    title: 'recordtypeid ที่มีการเปลี่ยนแปลง ' + per.fromText + ' – ' + per.toText,
                    meta: 'แก้ object ที่รู้จัก (อัปไฟล์ทับ, แก้ description ของ script ฯลฯ) แล้วเปิดหน้านี้ช่วงวันนั้น หาแถวที่ recordid ตรง แล้วใส่ใน RECTYPE_MAP',
                    actions: [ui.button('กลับไปรายงาน', { href: selfUrl({ f_from: per.fromYmd, f_to: per.toYmd }), kind: 'ghost' })]
                }),
                filterBar(ui, per, ctx, { view: 'probe' }),
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

        function page(ctx, html) {
            const form = serverWidget.createForm({ title: 'Change Report' });
            const f = form.addField({ id: 'custpage_rui', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
            f.defaultValue = html;
            ctx.response.writePage(form);
        }

        function onRequest(ctx) {
            const p = ctx.request.parameters;
            const ui = UI.create({ theme: p.theme || CFG.THEME, density: p.density });
            const s = runtime.getCurrentScript();
            const view = {
                baseUrl: url.resolveScript({ scriptId: s.id, deploymentId: s.deploymentId }).split('?')[0],
                hidden: { script: p.script, deploy: p.deploy, compid: p.compid || '' },
                dateFmt: dateFmt(),
                warnings: L.configWarnings()
            };
            const per = readPeriod(p);
            try {
                if (p.view === 'probe') return page(ctx, buildProbe(ui, per, L.probeRecordTypes(per.fromYmd, per.toYmd, 30), view));
                const res = L.run(per.fromYmd, per.toYmd);
                if (p.export === 'csv') {
                    ctx.response.addHeader({ name: 'Content-Type', value: 'text/csv; charset=utf-8' });
                    ctx.response.addHeader({ name: 'Content-Disposition', value: 'attachment; filename="prod_changes_' + per.fromYmd + '_' + per.toYmd + '.csv"' });
                    return ctx.response.write(L.toCsv(per.fromYmd, per.toYmd, res));
                }
                return page(ctx, buildReport(ui, per, res, view));
            } catch (e) {
                L.log('report error', e.message + ' ' + (e.stack || ''));
                return page(ctx, ui.render([
                    ui.header({ crumb: 'IT Controls', title: 'Change Report' }),
                    ui.alert('ดึงข้อมูลไม่สำเร็จ: ' + e.message, 'neg'),
                    filterBar(ui, per, view)
                ]));
            }
        }

        return { onRequest };
    });
