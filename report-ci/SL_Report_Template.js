/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * SL_Report_Template — โครงตั้งต้นสำหรับรายงาน Suitelet ตามมาตรฐาน Report CI
 * ตัวอย่างนี้: อายุเจ้าหนี้ (Vendor Bill ที่ยังค้างจ่าย) แยกตาม Subsidiary
 *
 * ก๊อปไฟล์นี้ไปทำรายงานใหม่ แล้วแก้แค่ 3 จุดที่มีป้าย [แก้ตรงนี้]
 *   1. FILTERS  — ช่องกรอง
 *   2. fetchRows — SuiteQL
 *   3. buildPage — หน้าตา (การ์ดสรุป / กราฟ / ตาราง)
 *
 * ธีม: เปลี่ยนที่ THEME หรือเติม &theme=tabler|tremor|hybrid ท้าย URL เพื่อลองดู
 * หมายเหตุ: ยอดใน demo เป็นสกุลเงินของเอกสาร (foreignAmountUnpaid) ยังไม่แปลงเป็น base currency
 */
define(['N/ui/serverWidget', 'N/query', 'N/runtime', 'N/format', 'N/url', './Lib_Report_UI'],
    (serverWidget, query, runtime, format, url, UI) => {

        const THEME = 'tremor';   // [แก้ตรงนี้] tabler | tremor | hybrid
        const BUCKETS = [
            { label: 'ยังไม่ครบกำหนด', test: d => d <= 0 },
            { label: '1–30 วัน', test: d => d >= 1 && d <= 30 },
            { label: '31–60 วัน', test: d => d >= 31 && d <= 60 },
            { label: '61–90 วัน', test: d => d >= 61 && d <= 90 },
            { label: 'เกิน 90 วัน', test: d => d > 90 }
        ];

        // [แก้ตรงนี้] 1. ตัวกรอง
        function readFilters(p) {
            return {
                subsidiary: p.f_sub || '',
                asOf: p.f_asof || format.format({ value: new Date(), type: format.Type.DATE }),
                vendor: (p.f_vendor || '').trim()
            };
        }

        function subsidiaryOptions() {
            const rs = query.runSuiteQL({ query: 'SELECT id, name FROM subsidiary WHERE isinactive = \'F\' ORDER BY name' }).asMappedResults();
            return [{ value: '', text: 'ทุกบริษัท' }].concat(rs.map(r => ({ value: r.id, text: r.name })));
        }

        // [แก้ตรงนี้] 2. ดึงข้อมูล
        function fetchRows(f) {
            const where = ["t.type = 'VendBill'", 't.foreignamountunpaid <> 0', "tl.mainline = 'T'"];
            const params = [];
            if (f.subsidiary) { where.push('tl.subsidiary = ?'); params.push(f.subsidiary); }
            if (f.vendor) { where.push('LOWER(BUILTIN.DF(t.entity)) LIKE ?'); params.push('%' + f.vendor.toLowerCase() + '%'); }
            const sql = `
                SELECT t.id, t.tranid, t.trandate, t.duedate,
                       BUILTIN.DF(t.entity) AS vendor, BUILTIN.DF(tl.subsidiary) AS sub,
                       BUILTIN.DF(t.currency) AS currency, t.foreignamountunpaid AS amt
                FROM transaction t
                JOIN transactionline tl ON tl.transaction = t.id
                WHERE ${where.join(' AND ')}
                ORDER BY sub, vendor, t.duedate`;
            const out = [];
            const paged = query.runSuiteQLPaged({ query: sql, params, pageSize: 1000 });
            paged.pageRanges.forEach(r => paged.fetch({ index: r.index }).data.asMappedResults().forEach(x => out.push(x)));
            return out;
        }

        // [แก้ตรงนี้] 3. หน้าตา
        function buildPage(ui, f, rows, ctx) {
            const asOf = format.parse({ value: f.asOf, type: format.Type.DATE });
            const days = d => d ? Math.round((asOf - format.parse({ value: d, type: format.Type.DATE })) / 864e5) : 0;

            // รวมเป็นรายผู้ขาย แยกช่วงอายุ
            const byVendor = {};
            rows.forEach(r => {
                const k = r.sub + '|' + r.vendor;
                const v = byVendor[k] || (byVendor[k] = { sub: r.sub, vendor: r.vendor, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, total: 0, count: 0 });
                const i = BUCKETS.findIndex(b => b.test(days(r.duedate)));
                v['b' + i] += Number(r.amt) || 0;
                v.total += Number(r.amt) || 0;
                v.count++;
            });
            const vendors = Object.keys(byVendor).map(k => byVendor[k]).map(v => Object.assign(v, {
                status: v.b4 > 0 ? { text: 'เกิน 90 วัน', tone: 'neg' } : v.b3 > 0 ? { text: 'ใกล้ครบ 90', tone: 'warn' } : v.total < 0 ? { text: 'จ่ายล่วงหน้า', tone: 'info' } : { text: 'ปกติ', tone: 'pos' }
            }));
            const bucketTotals = BUCKETS.map((b, i) => vendors.reduce((s, v) => s + v['b' + i], 0));
            const grand = bucketTotals.reduce((a, b) => a + b, 0);
            const overdue = vendors.filter(v => v.b3 + v.b4 > 0).sort((a, b) => (b.b3 + b.b4) - (a.b3 + a.b4)).slice(0, 6);
            const billUrl = id => url.resolveRecord({ recordType: 'vendorbill', recordId: id });

            const detail = rows.filter(r => days(r.duedate) > 60 || Number(r.amt) < 0).map(r => Object.assign({}, r, {
                age: days(r.duedate),
                status: Number(r.amt) < 0 ? { text: 'ยอดติดลบ', tone: 'info' } : days(r.duedate) > 90 ? { text: 'เกิน 90 วัน', tone: 'neg' } : { text: 'เกิน 60 วัน', tone: 'warn' }
            }));

            return ui.render([
                ui.header({
                    crumb: 'Payables', crumbCurrent: 'AP Aging', title: 'อายุเจ้าหนี้ ณ ' + f.asOf,
                    meta: (f.subsidiary ? '' : 'ทุกบริษัท · ') + rows.length + ' เอกสาร · ยอดตามสกุลเงินของเอกสาร',
                    actions: [ui.button('Export CSV', { href: ctx.selfUrl + '&export=csv', icon: 'download' })]
                }),
                ui.filterBar({
                    action: ctx.baseUrl, hidden: ctx.hidden, resetHref: ctx.selfBase,
                    fields: [
                        ui.field({ id: 'f_sub', label: 'Subsidiary', type: 'select', value: f.subsidiary, options: subsidiaryOptions() }),
                        ui.field({ id: 'f_asof', label: 'ณ วันที่', type: 'date', value: f.asOf }),
                        ui.field({ id: 'f_vendor', label: 'ผู้ขาย', value: f.vendor, placeholder: 'ชื่อบางส่วน', icon: 'search' })
                    ]
                }),
                ui.kpis([
                    { label: 'ยอดเจ้าหนี้คงค้าง', value: (grand / 1e6).toFixed(2), unit: 'ลบ.', icon: 'doc', note: vendors.length + ' ผู้ขาย' },
                    { label: 'เกิน 90 วัน', value: (bucketTotals[4] / 1e6).toFixed(2), unit: 'ลบ.', bad: bucketTotals[4] > 0, icon: 'warn', note: vendors.filter(v => v.b4 > 0).length + ' ผู้ขาย' },
                    { label: 'ยังไม่ครบกำหนด', value: grand ? Math.round(bucketTotals[0] / grand * 100) + '%' : '–', icon: 'clock', note: 'ของยอดรวม' }
                ]),
                ui.grid([
                    ui.card({ title: 'สัดส่วนตามอายุหนี้', aside: 'รวม ' + ui.int(grand), body: ui.distribution(BUCKETS.map((b, i) => ({ label: b.label, amount: bucketTotals[i] }))) }),
                    ui.card({ title: 'ต้องติดตามก่อน', aside: 'เกิน 60 วัน', body: overdue.length ? ui.barList(overdue.map(v => ({ label: v.vendor, value: v.b3 + v.b4 }))) : ui.empty('ไม่มีผู้ขายที่เกิน 60 วัน') })
                ], { layout: 'wide-left' }),
                ui.tabs([
                    {
                        id: 'sum', label: 'สรุปตามผู้ขาย', count: vendors.length,
                        body: ui.table({
                            groupBy: 'sub', subtotal: true, total: true, note: 'ยอดในวงเล็บ = เงินจ่ายล่วงหน้า / ใบลดหนี้',
                            columns: [
                                { key: 'vendor', label: 'ผู้ขาย', type: 'wrap' },
                                { key: 'status', label: 'สถานะ', type: 'badge' },
                                { key: 'b0', label: 'Current', type: 'amount', heat: 0, total: true },
                                { key: 'b1', label: '1–30', type: 'amount', heat: 1, total: true },
                                { key: 'b2', label: '31–60', type: 'amount', heat: 2, total: true },
                                { key: 'b3', label: '61–90', type: 'amount', heat: 3, total: true },
                                { key: 'b4', label: '> 90', type: 'amount', heat: 4, total: true },
                                { key: 'total', label: 'ยอดคงค้าง', type: 'amount', total: true }
                            ],
                            rows: vendors
                        })
                    },
                    {
                        id: 'det', label: 'Bill ที่ต้องติดตาม', count: detail.length,
                        body: ui.table({
                            total: 'รวม', emptyTitle: 'ไม่มี Bill ที่ต้องติดตาม',
                            columns: [
                                { key: 'tranid', label: 'เลขที่', sub: 'trandate', link: r => billUrl(r.id) },
                                { key: 'vendor', label: 'ผู้ขาย', type: 'wrap' },
                                { key: 'duedate', label: 'ครบกำหนด', type: 'date' },
                                { key: 'age', label: 'เกิน (วัน)', type: 'int' },
                                { key: 'currency', label: 'สกุล' },
                                { key: 'amt', label: 'ยอดคงค้าง', type: 'amount', total: true },
                                { key: 'status', label: 'สถานะ', type: 'badge' }
                            ],
                            rows: detail
                        })
                    }
                ])
            ]);
        }

        function toCsv(rows) {
            const head = ['Doc No', 'Date', 'Due', 'Vendor', 'Subsidiary', 'Currency', 'Unpaid'];
            const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
            return '﻿' + [head.join(',')].concat(rows.map(r => [r.tranid, r.trandate, r.duedate, r.vendor, r.sub, r.currency, r.amt].map(q).join(','))).join('\r\n');
        }

        function onRequest(context) {
            const p = context.request.parameters;
            const script = runtime.getCurrentScript();
            const base = url.resolveScript({ scriptId: script.id, deploymentId: script.deploymentId });
            const f = readFilters(p);
            const ui = UI.create({ theme: p.theme || THEME, density: p.density });

            let rows = [], error = '';
            try { rows = fetchRows(f); } catch (e) { error = e.message; log.error('fetchRows', e); }

            if (p.export === 'csv' && !error) {
                context.response.addHeader({ name: 'Content-Type', value: 'text/csv; charset=utf-8' });
                context.response.addHeader({ name: 'Content-Disposition', value: 'attachment; filename="ap_aging.csv"' });
                context.response.write(toCsv(rows));
                return;
            }

            const keep = ['f_sub', 'f_asof', 'f_vendor', 'theme', 'density'].filter(k => p[k]).map(k => k + '=' + encodeURIComponent(p[k])).join('&');
            const ctx = {
                baseUrl: base.split('?')[0],
                hidden: { script: p.script, deploy: p.deploy, theme: p.theme || '', density: p.density || '' },
                selfBase: base,
                selfUrl: base + (keep ? '&' + keep : '')
            };

            const form = serverWidget.createForm({ title: 'AP Aging' });
            const html = form.addField({ id: 'custpage_rui', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
            html.defaultValue = error
                ? ui.render([ui.header({ crumb: 'Payables', title: 'AP Aging' }), ui.alert('ดึงข้อมูลไม่สำเร็จ: ' + error, 'neg')])
                : buildPage(ui, f, rows, ctx);
            context.response.writePage(form);
        }

        return { onRequest };
    });
