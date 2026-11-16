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

        function readPeriod(p, todayDefault) {
            // "วันนี้" ตามเวลาของผู้ใช้ (TIMEZONE_OFFSET_HOURS) ไม่ใช่เวลา server ของ NetSuite (ฝั่งอเมริกา)
            const off = Number(CFG.TIMEZONE_OFFSET_HOURS);
            const now = Number.isFinite(off) ? new Date(Date.now() + off * 3600e3) : new Date();
            const today = Number.isFinite(off) ? new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const parse = (s, d) => {
                if (!s) return d;
                const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
                try { return format.parse({ value: s, type: format.Type.DATE }); } catch (e) { return d; }
            };
            // probe = 7 วันล่าสุด · รายงาน = ต้นเดือนนี้ถึงวันนี้ (โหลดทีละวัน จึงเลือกทั้งเดือนได้)
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const from = parse(p.f_from, todayDefault ? new Date(today.getTime() - 6 * 864e5) : monthStart);
            const to = parse(p.f_to, today);
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

        function filterBar(ui, per, ctx, extraHidden, extraFields) {
            return ui.filterBar({
                action: ctx.baseUrl, hidden: Object.assign({}, ctx.hidden, extraHidden || {}), cols: extraFields ? 4 : 3,
                fields: [
                    ui.field({ id: 'f_from', label: 'ตั้งแต่', type: 'date', value: per.fromText, picker: ctx.dateFmt }),
                    ui.field({ id: 'f_to', label: 'ถึง', type: 'date', value: per.toText, picker: ctx.dateFmt })
                ].concat(extraFields || [])
            });
        }

        /** ส่วนผลลัพธ์ (KPI, กราฟ, แท็บ) — server วาดหลัง browser ดึงครบทุกวันแล้ว */
        function buildBody(ui, res) {
            const rows = res.changes.slice().reverse().map(c => Object.assign({}, c, {
                object: c.objType + ': ' + c.objName,
                fieldsText: c.fields.join(', '),
                flagBadge: c.flag ? { text: 'ไม่มีสิทธิ์ deploy', tone: 'neg' } : { text: 'ปกติ', tone: 'pos' },
                detailText: c.details.join(' | ')
            }));
            const flaggedRows = rows.filter(r => r.flag);
            const flagOn = CFG.FLAG_UNAUTHORIZED !== false;
            const priv = L.employeesWithRoles(CFG.PRIVILEGED_ROLE_IDS.concat(CFG.DEPLOYER_ROLE_IDS));
            const columns = [
                { key: 'tsText', label: 'เวลา', type: 'date' },
                { key: 'object', label: 'Object', type: 'wrap', sub: 'fieldsText' },
                { key: 'scriptText', label: 'Script (ID · ชื่อ · ประเภท · deploy บน)', type: 'wrap' },
                { key: 'actorName', label: 'ผู้แก้', sub: 'roleName' },
                { key: 'context', label: 'Context' },
                { key: 'detailText', label: 'ค่าเดิม → ใหม่ (ตัวอย่าง)', type: 'wrap' },
                { key: 'flagBadge', label: 'ธง', type: 'badge' }
            ];

            return [
                ui.kpis([
                    { label: 'การเปลี่ยนแปลง', value: ui.int(res.total), icon: 'doc' },
                    { label: 'Object ที่ถูกแก้', value: ui.int(res.objects), icon: 'doc' },
                    flagOn
                        ? { label: 'ผู้แก้ไม่มีสิทธิ์ deploy', value: ui.int(res.flagged), bad: res.flagged > 0, note: res.flagged ? 'ต้องมีคำอธิบายทุกแถว' : '' }
                        : { label: 'ผู้แก้ (คน)', value: ui.int(res.actors || 0), icon: 'doc', note: 'ใช้เวลาดึง ' + ((res.ms || 0) / 1000).toFixed(1) + ' วิ' }
                ]),
                res.total ? ui.grid([
                    ui.card({ title: 'ตามประเภท object', body: ui.barList(res.byType.slice(0, 8)) }),
                    ui.card({ title: 'ตามผู้แก้', body: ui.barList(res.byActor.slice(0, 8)) })
                ]) : '',
                ui.tabs([
                    {
                        id: 'grp', label: 'ตาม Script', count: res.scripts,
                        body: scriptDiagram(ui, res.groups || [])
                    },
                    flagOn && {
                        id: 'flag', label: 'ติดธง', count: flaggedRows.length,
                        body: ui.table({ emptyTitle: 'ไม่มีรายการติดธง', emptyText: 'ทุกการเปลี่ยนแปลงทำโดยผู้มีสิทธิ์ deploy', columns, rows: flaggedRows })
                    },
                    {
                        id: 'all', label: 'ทั้งหมด', count: rows.length,
                        body: ui.table({
                            emptyTitle: 'ไม่พบการเปลี่ยนแปลง',
                            emptyText: L.configWarnings().length ? 'ตรวจคำเตือนด้านบน (RECTYPE_MAP อาจยังไม่ได้ตั้ง)' : 'ไม่มี System Note ของ object ในขอบเขตช่วงนี้',
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
                ].filter(Boolean))
            ].join('');
        }

        /**
         * หน้าแรกของรายงาน: header + ตัวกรอง + แถบความคืบหน้า แล้ว browser ดึงทีละวันผ่าน &ajax=day
         * ครบแล้วส่งรายการทั้งหมดไป &ajax=render (POST) ให้ server วาดผล — ทั้งเดือนไม่ชน timeout/governance
         */
        function buildShell(ui, per, ctx) {
            const days = L.daysBetween(per.fromYmd, per.toYmd, 92);
            const boot = { days, from: per.fromYmd, to: per.toYmd, ajaxUrl: selfUrl({}), conc: Math.max(1, Math.min(6, Number(CFG.LOAD_CONCURRENCY) || 3)) };
            const disabledBtn = (id, label, kind) => '<a id="' + id + '" class="btn ' + kind + '" style="opacity:.45;pointer-events:none" href="#">' + UI.esc(label) + '</a>';
            const html = ui.render([
                ui.header({
                    crumb: 'IT Controls', crumbCurrent: 'Change Report',
                    title: 'การเปลี่ยนแปลงใน PROD ' + per.fromText + ' – ' + per.toText + ' (' + days.length + ' วัน)',
                    meta: 'Script · Script Deployment · ไฟล์โปรแกรมใต้ SuiteScripts · Export CSV แล้วกรอกเลข CR แถวที่ไม่มี CR ให้เขียนคำอธิบาย แล้วให้ผู้ review เซ็น',
                    actions: [
                        disabledBtn('tbdll-exp-grp', 'Export CSV (ตาม Script)', 'primary'),
                        disabledBtn('tbdll-exp-all', 'Export CSV (ทุก log)', 'ghost'),
                        ui.button('หยุด', { id: 'tbdll-stop', kind: 'ghost' }),
                        ui.button('Probe record types', { href: selfUrl({ view: 'probe' }), kind: 'ghost' })
                    ]
                }),
                ctx.warnings.map(w => ui.alert(w, 'warn')).join(''),
                filterBar(ui, per, ctx),
                ui.card({ title: 'ความคืบหน้า', body: '<div id="tbdll-status">กำลังเริ่ม…</div>'
                    + '<div style="height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden;margin-top:8px"><div id="tbdll-bar" style="height:100%;width:0;background:var(--primary,#2563eb);transition:width .2s"></div></div>'
                    + '<div id="tbdll-log" style="margin-top:8px;font-size:12px;color:#6b7280;max-height:96px;overflow:auto"></div>' }),
                '<div id="tbdll-res"></div>',
                detailModal()
            ]);
            return html + '<script>window.TBDLL_REPORT=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script><script>' + REPORT_JS + '</script>' + loadingOverlay(per);
        }

        /** กล่อง "ค่าเดิม → ใหม่" ของ object เดียว — ซ่อนไว้ก่อน แสดงเมื่อกดปุ่มในไดอะแกรม */
        function detailModal() {
            return '<div id="tbdll-detail" style="display:none;position:fixed;inset:0;z-index:9998;background:rgba(17,24,39,.45);align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto">'
                + '<div style="background:#fff;border-radius:12px;max-width:1100px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.25)">'
                + '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #e5e7eb">'
                + '<b id="tbdll-detail-title" style="flex:1">รายละเอียด</b>'
                + '<button id="tbdll-detail-close" type="button" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:4px 12px;cursor:pointer">ปิด</button>'
                + '</div><div id="tbdll-detail-body" style="padding:0 16px 16px"></div></div></div>';
        }

        const REPORT_JS = [
            '(function(){',
            'var B=window.TBDLL_REPORT,stop=false,changes=[],noteRows=0,t0=Date.now(),cur="",waitFrom=0,tick=null,failed=[];',
            'function $(id){return document.getElementById(id);}',
            'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}',
            'function sec(){return Math.round((Date.now()-t0)/1000);}',
            'function status(t,pct){$("tbdll-status").innerHTML=t;if(pct!=null)$("tbdll-bar").style.width=pct+"%";}',
            'function logl(t){var d=$("tbdll-log");d.innerHTML="<div>"+t+"</div>"+d.innerHTML;}',
            'function getJSON(u,opt){return fetch(u,Object.assign({credentials:"same-origin"},opt||{})).then(function(r){return r.text();}).then(function(t){try{return JSON.parse(t);}catch(e){throw new Error("ตอบกลับไม่ใช่ JSON (session หมดหรือ script error)");}});}',
            'tick=setInterval(function(){if(cur)status(cur+" · รอ server "+Math.round((Date.now()-waitFrom)/1000)+" วิ · รวม "+sec()+" วิ");},1000);',
            'function bind(root){',
            '  root.querySelectorAll("[data-tabs]").forEach(function(box){box.addEventListener("click",function(e){var t=e.target.closest(".tab");if(!t)return;',
            '    box.querySelectorAll(".tab").forEach(function(x){x.setAttribute("aria-selected",x===t);});box.parentNode.querySelectorAll("[data-pane]").forEach(function(p){p.hidden=p.getAttribute("data-pane")!==t.getAttribute("data-tab");});});});',
            '  root.querySelectorAll("input[data-filter-for]").forEach(function(inp){inp.addEventListener("keydown",function(e){if(e.key==="Enter")e.preventDefault();});inp.addEventListener("input",function(){var q=inp.value.trim().toLowerCase(),tb=document.getElementById(inp.getAttribute("data-filter-for"));',
            '    if(!tb)return;tb.querySelectorAll("tbody tr").forEach(function(tr){tr.style.display=!q||tr.textContent.toLowerCase().indexOf(q)>=0?"":"none";});});});',
            '  var gq=root.querySelector("#tbdll-gq");if(gq){gq.addEventListener("keydown",function(e){if(e.key==="Enter")e.preventDefault();});gq.addEventListener("input",function(){var q=gq.value.trim().toLowerCase(),n=0;',
            '    root.querySelectorAll(".tbg").forEach(function(r){var ok=!q||r.getAttribute("data-q").indexOf(q)>=0;r.style.display=ok?"":"none";if(ok)n++;});var c=root.querySelector("#tbdll-gc");if(c)c.textContent=n+" กลุ่ม";});}',
            '  root.querySelectorAll("[data-obj]").forEach(function(b){b.addEventListener("click",function(e){',
            '    if(e)e.preventDefault();var p=String(b.getAttribute("data-obj")).split("|"),box=$("tbdll-detail"),body=$("tbdll-detail-body"),ttl=$("tbdll-detail-title");if(!box||!body)return;',
            '    box.style.display="flex";if(ttl)ttl.textContent=(p[0]||"")+" #"+(p[1]||"");body.innerHTML="<div style=\\"padding:16px;color:#6b7280\\">กำลังดึงค่าเดิม → ใหม่…</div>";',
            '    getJSON(B.ajaxUrl+"&ajax=detail&type="+encodeURIComponent(p[0])+"&id="+encodeURIComponent(p[1])+"&from="+B.from+"&to="+B.to)',
            '      .then(function(j){if(!j.ok)throw new Error(j.error||"error");body.innerHTML=j.html;bind(body);})',
            '      .catch(function(e2){body.innerHTML="<div style=\\"padding:16px;color:#dc2626\\">"+esc(e2.message)+"</div>";});',
            '  });});}',
            'function dl(id,name,text){var a=$(id);if(!a)return;a.href=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));a.download=name;a.style.opacity="";a.style.pointerEvents="";}',
            'function render(partial){clearInterval(tick);cur="";status("ดึงครบแล้ว "+changes.length+" การเปลี่ยนแปลง · กำลังสรุปผล…",95);',
            '  getJSON(B.ajaxUrl+"&ajax=render",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from:B.from,to:B.to,noteRows:noteRows,ms:Date.now()-t0,changes:changes})})',
            '  .then(function(j){if(!j.ok)throw new Error(j.error||"render error");$("tbdll-res").innerHTML=j.html;bind($("tbdll-res"));',
            '    dl("tbdll-exp-grp","prod_changes_by_script_"+B.from+"_"+B.to+".csv",j.csvGroup);dl("tbdll-exp-all","prod_changes_"+B.from+"_"+B.to+".csv",j.csvAll);',
            '    var msg=(partial?"<b>ข้อมูลไม่ครบ</b> หยุดที่ "+partial+" · ":"เสร็จ · ")+B.days.length+" วัน · "+changes.length+" การเปลี่ยนแปลง · System Notes "+noteRows.toLocaleString()+" แถว · "+sec()+" วิ";',
            '    if(failed.length)msg+=" · <b style=\\"color:#dc2626\\">ดึงไม่สำเร็จ "+failed.length+" วัน: "+failed.join(", ")+"</b>";status(msg,100);})',
            '  .catch(function(e){status("สรุปผลไม่สำเร็จ: "+esc(e.message),100);});}',
            'var i=0,active=0,finished=0,CONC=Math.max(1,Math.min(6,Number(B.conc)||3));',
            'function progress(){status("ดึงแล้ว "+finished+"/"+B.days.length+" วัน · กำลังดึง "+active+" · พบแล้ว "+changes.length+" การเปลี่ยนแปลง · รวม "+sec()+" วิ",B.days.length?finished/B.days.length*90:0);}',
            'function fetchDay(d){var tries=0;(function go(){',
            '  cur="วันที่ <b>"+d+"</b>";waitFrom=Date.now();',
            '  getJSON(B.ajaxUrl+"&ajax=day&day="+d).then(function(j){if(!j.ok)throw new Error(j.error||"error");',
            '    Array.prototype.push.apply(changes,j.changes);noteRows+=j.noteRows||0;logl(d+": "+j.changes.length+" การเปลี่ยนแปลง, "+(j.ms/1000).toFixed(1)+" วิ");',
            '    finished++;active--;progress();pump();})',
            '  .catch(function(e){if(++tries<3){logl(d+": ลองใหม่ ("+esc(e.message)+")");go();}',
            '    else{failed.push(d);logl("<b>"+d+": ข้าม</b> "+esc(e.message));finished++;active--;progress();pump();}});})();}',
            'function pump(){',
            '  if(stop){if(active===0){clearInterval(tick);render(doneAll()?"":B.days[Math.max(0,finished-1)]||"");}return;}',
            '  while(active<CONC&&i<B.days.length){var d=B.days[i++];active++;fetchDay(d);}',
            '  progress();',
            '  if(i>=B.days.length&&active===0){clearInterval(tick);render("");}',
            '}',
            'function doneAll(){return finished>=B.days.length;}',
            '$("tbdll-stop").addEventListener("click",function(){stop=true;status("กำลังหยุด… รอคำขอที่ค้างอยู่ให้จบ",Math.min(95,finished/B.days.length*90));if(active===0)pump();});',
            '$("tbdll-detail-close").addEventListener("click",function(){$("tbdll-detail").style.display="none";});',
            'document.addEventListener("keydown",function(e){if(e.key==="Escape"){var b=$("tbdll-detail");if(b)b.style.display="none";}});',
            'pump();',
            '})();'
        ].join('\n');

        /**
         * ไดอะแกรมรวมตาม script: กล่อง script (ซ้าย) → สิ่งที่ถูกแก้ (ขวา) — ผู้ตรวจเห็นทีละ script ไม่ต้องไล่ทีละ log
         */
        function scriptDiagram(ui, groups) {
            const esc = UI.esc;
            if (!groups.length) return ui.empty('ไม่พบการเปลี่ยนแปลง', 'ไม่มีการแก้ Script / Deployment / ไฟล์โปรแกรม ในช่วงนี้');
            const KIND = {
                'Script': { t: 'Script', c: '#2563eb', bg: 'rgba(37,99,235,.08)' },
                'Script Deployment': { t: 'Deployment', c: '#7c3aed', bg: 'rgba(124,58,237,.08)' },
                'File': { t: 'File', c: '#0f766e', bg: 'rgba(15,118,110,.08)' }
            };
            const kind = k => KIND[k] || { t: k, c: '#6b7280', bg: 'rgba(107,114,128,.08)' };
            const range = (a, b) => a === b ? a : a + ' → ' + b;
            const css = '<style>'
                + '.tbg{display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:0 32px;padding:16px;border-bottom:1px solid var(--line,#eceef2);align-items:center}'
                + '.tbg:last-child{border-bottom:0}'
                + '.tbg-root{border:2px solid var(--primary,#2563eb);background:rgba(37,99,235,.04);border-radius:10px;padding:12px 14px}'
                + '.tbg-root.other{border-color:#9ca3af;background:#f9fafb}'
                + '.tbg-root b{display:block;font-size:14px;margin:4px 0 2px;word-break:break-word}'
                + '.tbg-root code{font-size:12px;color:#374151;word-break:break-all}'
                + '.tbg-meta{margin-top:8px;font-size:12px;color:#6b7280;line-height:1.5}'
                + '.tbg-chip{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;margin:2px 4px 0 0}'
                + '.tbg-kids{position:relative;border-left:2px solid #c7d2fe;padding:2px 0 2px 20px;display:flex;flex-direction:column;gap:8px}'
                + '.tbg-node{position:relative;border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:8px 12px;background:#fff;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}'
                + '.tbg-node:before{content:"";position:absolute;left:-22px;top:50%;width:20px;border-top:2px solid #c7d2fe}'
                + '.tbg-node .lb{font-weight:600;word-break:break-word}'
                + '.tbg-node .x{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600}'
                + '.tbg-node .sm{flex-basis:100%;font-size:12px;color:#6b7280}'
                + '.tbdll-d{border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;font-size:11px;border-radius:6px;padding:2px 8px;cursor:pointer;white-space:nowrap}'
                + '.tbdll-d:hover{background:#e0e7ff}'
                + '.tbg-bar{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line,#eceef2)}'
                + '.tbg-bar input{flex:1;max-width:360px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px}'
                + '@media(max-width:720px){.tbg{grid-template-columns:1fr;gap:12px}}'
                + '</style>';
            const body = groups.map(g => {
                const isScript = g.kind === 'script';
                const k = g.children.map(n => {
                    const kd = kind(n.kind);
                    return '<div class="tbg-node"><span class="tbg-chip" style="color:' + kd.c + ';background:' + kd.bg + '">' + esc(kd.t) + '</span>'
                        + '<span class="lb">' + esc(n.label) + '</span>' + (n.sub ? '<span style="color:#6b7280;font-size:12px">' + esc(n.sub) + '</span>' : '')
                        + '<span class="x">× ' + n.count + '</span>'
                        + (n.objId ? '<button type="button" class="tbdll-d" data-obj="' + esc(n.objType) + '|' + esc(n.objId) + '">ดูค่าเดิม → ใหม่</button>' : '')
                        + '<span class="sm">' + esc(n.editors.join(', ')) + ' · ' + esc(range(n.firstText, n.lastText)) + '</span></div>';
                }).join('');
                const search = [g.scriptid, g.name, g.type, g.deployedOn.join(' '), g.editors.join(' '), g.children.map(n => n.label).join(' ')].join(' ').toLowerCase();
                return '<div class="tbg" data-q="' + esc(search) + '"><div class="tbg-root' + (isScript ? '' : ' other') + '">'
                    + '<span class="tbg-chip" style="color:#fff;background:' + (isScript ? 'var(--primary,#2563eb)' : '#6b7280') + '">' + esc(g.type || '-') + '</span>'
                    + '<b>' + esc(g.name || '-') + '</b>' + (g.scriptid ? '<code>' + esc(g.scriptid) + '</code>' : '')
                    + (g.deployedOn.length ? '<div style="margin-top:6px">' + g.deployedOn.map(r => '<span class="tbg-chip" style="color:#7c3aed;background:rgba(124,58,237,.08)">deploy บน ' + esc(r) + '</span>').join('') + '</div>' : '')
                    + '<div class="tbg-meta">แก้ ' + g.count + ' ครั้ง · ' + g.children.length + ' รายการ<br>' + esc(g.editors.join(', ')) + '<br>' + esc(range(g.firstText, g.lastText)) + '</div>'
                    + '</div><div class="tbg-kids">' + k + '</div></div>';
            }).join('');
            const bar = '<div class="tbg-bar"><input id="tbdll-gq" placeholder="ค้นหา script / ไฟล์ / ผู้แก้"><span id="tbdll-gc" style="color:#6b7280">' + groups.length + ' กลุ่ม</span></div>';
            const js = '<script>(function(){var i=document.getElementById("tbdll-gq");if(!i)return;i.addEventListener("keydown",function(e){if(e.key==="Enter")e.preventDefault();});'
                + 'i.addEventListener("input",function(){var q=i.value.trim().toLowerCase(),n=0;document.querySelectorAll(".tbg").forEach(function(r){var ok=!q||r.getAttribute("data-q").indexOf(q)>=0;r.style.display=ok?"":"none";if(ok)n++;});'
                + 'document.getElementById("tbdll-gc").textContent=n+" กลุ่ม";});})();</script>';
            return css + bar + body + js;
        }

        /**
         * overlay ตอนกด "แสดงรายงาน" — หน้าเดิมยังอยู่จนกว่า server จะส่งหน้าใหม่ จึงต้องบอกว่ากำลังโหลด
         * (ฟังคลิกปุ่มของ filterBar และ Enter ในช่องกรอก ซึ่ง Lib_Report_UI ใช้ navigate แบบ GET)
         */
        function loadingOverlay(per) {
            return '<div id="tbdll-load" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(255,255,255,.75);backdrop-filter:blur(2px);align-items:center;justify-content:center">'
                + '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 32px;box-shadow:0 10px 30px rgba(0,0,0,.12);text-align:center;font:14px/1.6 inherit;min-width:320px">'
                + '<div style="width:36px;height:36px;margin:0 auto 12px;border:3px solid #e5e7eb;border-top-color:#2563eb;border-radius:50%;animation:tbdllspin 1s linear infinite"></div>'
                + '<b>กำลังดึง System Notes…</b><div id="tbdll-load-range" style="color:#6b7280"></div>'
                + '<div id="tbdll-load-sec" style="margin-top:6px;font-variant-numeric:tabular-nums">0 วินาที</div>'
                + '<div style="margin-top:8px;font-size:12px;color:#6b7280">1 วันใช้ไม่กี่วินาที · ทั้งเดือนอาจใช้ 1–3 นาที</div></div></div>'
                + '<style>@keyframes tbdllspin{to{transform:rotate(360deg)}}</style>'
                + '<script>(function(){var box=document.getElementById("tbdll-load");if(!box)return;var t;'
                + 'function show(){var f=document.getElementById("f_from"),g=document.getElementById("f_to");'
                + 'document.getElementById("tbdll-load-range").textContent=(f?f.value:"")+" – "+(g?g.value:"");box.style.display="flex";var s=0;clearInterval(t);'
                + 't=setInterval(function(){s++;document.getElementById("tbdll-load-sec").textContent=s+" วินาที";},1000);}'
                + 'document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-get-submit]");if(b)show();},true);'
                + 'document.addEventListener("keydown",function(e){if(e.key==="Enter"&&e.target.closest&&e.target.closest(".fbar"))show();},true);'
                + 'window.addEventListener("pageshow",function(){box.style.display="none";clearInterval(t);});})();</script>';
        }

        /**
         * หน้า probe: โหลดหน้าเปล่าก่อน แล้ว browser ทยอยดึงทีละวันผ่าน &ajax=probeday พร้อมแถบความคืบหน้า
         * (Suitelet ตอบได้ทีเดียวตอนจบ จึงแยกเป็นหลาย request เล็ก ๆ — ไม่ timeout และเห็นว่าถึงไหนแล้ว)
         */
        function buildProbe(ui, per, ctx, pf) {
            const days = L.daysBetween(per.fromYmd, per.toYmd, 92);
            const boot = {
                days, sliceHours: 6, who: pf.actor ? 'me' : 'all', rid: pf.recordId || '',
                ajaxUrl: selfUrl({ view: 'probe' }),
                mapped: L.rectypes().toType
            };
            const html = ui.render([
                ui.header({
                    crumb: 'Change Report', crumbCurrent: 'Probe',
                    title: 'หา recordtypeid ' + per.fromText + ' – ' + per.toText + ' (' + days.length + ' วัน)',
                    meta: 'ปุ่มซ้าย: หา recordtypeid ของ File อัตโนมัติจากไฟล์ใต้ SuiteScripts ที่แก้ล่าสุด · ประเภทอื่น (Script, Field, Role): แก้ object นั้นด้วย user ตัวเอง แล้วสแกนวันนั้นหาแถวที่ recordid ตรงกับ internal id',
                    actions: [
                        ui.button('ตรวจหา File อัตโนมัติ', { id: 'tbdll-auto', kind: 'primary' }),
                        ui.button('เริ่มสแกน', { id: 'tbdll-start' }),
                        ui.button('หยุด', { id: 'tbdll-stop', kind: 'ghost' }),
                        ui.button('กลับไปรายงาน', { href: selfUrl({}), kind: 'ghost' })
                    ]
                }),
                filterBar(ui, per, ctx, { view: 'probe' }, [
                    ui.field({ id: 'rid', label: 'Internal ID ของ object (ไม่บังคับ)', value: pf.recordId || '', placeholder: 'แคบสุดและเร็วสุด' }),
                    ui.field({ id: 'who', label: 'ผู้แก้', type: 'select', value: boot.who, options: [{ value: 'all', text: 'ทุกคน' }, { value: 'me', text: 'เฉพาะฉัน (เร็วกว่า)' }] })
                ]),
                ui.card({ title: 'ความคืบหน้า', body: '<div id="tbdll-status" style="margin-bottom:8px">กด "เริ่มสแกน" หรือ "ตรวจหา File อัตโนมัติ"</div>'
                    + '<div style="height:8px;border-radius:4px;background:var(--line,#e5e7eb);overflow:hidden"><div id="tbdll-bar" style="height:100%;width:0;background:var(--primary,#2563eb);transition:width .2s"></div></div>'
                    + '<div id="tbdll-log" style="margin-top:8px;font-size:12px;color:var(--muted,#6b7280);max-height:120px;overflow:auto"></div>' }),
                ui.card({ title: 'ผลลัพธ์', flush: true, body: '<div style="padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">'
                    + '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="tbdll-hidecr" checked> ซ่อน custom record (CUSTOMRECORDENTRY)</label>'
                    + '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="tbdll-onlyhit"> เฉพาะแถวที่น่าจะใช่</label>'
                    + '<input id="tbdll-q" placeholder="กรองคำ เช่น SCRIPT, MEDIA, ROLE" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px">'
                    + '<span id="tbdll-count" style="color:#6b7280"></span></div><div id="tbdll-result" style="padding:16px">ยังไม่มีผล</div>' })
            ]);
            return html + '<script>window.TBDLL_PROBE=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script><script>' + PROBE_JS + '</script>';
        }

        const PROBE_JS = [
            '(function(){',
            'var B=window.TBDLL_PROBE,stop=false,busy=false,agg={},t0=0;',
            'function $(id){return document.getElementById(id);}',
            'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}',
            'function sec(){return Math.round((Date.now()-t0)/1000);}',
            'function status(t,pct){$("tbdll-status").innerHTML=t;if(pct!=null)$("tbdll-bar").style.width=pct+"%";}',
            'function logl(t){var d=$("tbdll-log");d.innerHTML="<div>"+t+"</div>"+d.innerHTML;}',
            'function val(id,def){var e=document.getElementById(id);return e?e.value:def;}',
            'function get(params){var u=B.ajaxUrl;for(var k in params)u+="&"+k+"="+encodeURIComponent(params[k]);',
            '  return fetch(u,{credentials:"same-origin"}).then(function(r){return r.text();}).then(function(t){try{return JSON.parse(t);}catch(e){throw new Error("ตอบกลับไม่ใช่ JSON (session หมดหรือ script error)");}});}',
            'function total(){var n=0;for(var k in agg)n+=agg[k].cnt;return n;}',
            'var HIT=/SCRIPT|MEDIA|FILE|FOLDER|ROLE|CUSTFIELD|CUSTOMFIELD|BODYFIELD|COLUMNFIELD|ENTITYFIELD|ITEMFIELD|CRMFIELD|OTHERFIELD|WORKFLOW|CUSTRECORDTYPE|CUSTOMRECORDTYPE|SAVEDSEARCH|TEMPLATE|FORM/;',
            'function prefix(f){f=String(f||"");var i=f.indexOf(".");return i>0?f.slice(0,i):f;}',
            'function isCR(k,r){return prefix(r.field)==="CUSTOMRECORDENTRY";}',
            'function isHit(r){return !isCR("",r)&&HIT.test(prefix(r.field).toUpperCase());}',
            'function render(){var hide=$("tbdll-hidecr").checked,only=$("tbdll-onlyhit").checked,q=String($("tbdll-q").value||"").trim().toUpperCase();',
            '  var all=Object.keys(agg),keys=all.filter(function(k){var r=agg[k];if(hide&&isCR(k,r))return false;if(only&&!isHit(r))return false;if(q&&(k+" "+r.field+" "+(r.label||"")).toUpperCase().indexOf(q)<0)return false;return true;})',
            '    .sort(function(a,b){return (isHit(agg[b])?1:0)-(isHit(agg[a])?1:0)||agg[b].last.localeCompare(agg[a].last);});',
            '  $("tbdll-count").innerHTML="แสดง "+keys.length+" จาก "+all.length+" record type";',
            '  if(!keys.length){$("tbdll-result").innerHTML=all.length?"ไม่มีแถวตามตัวกรอง":"ไม่พบ System Note";return;}',
            '  var h="<div class=\\"scroll\\"><table class=\\"rt\\"><thead><tr><th>recordtypeid</th><th>ประเภทจาก field</th><th>ชื่อ</th><th class=\\"n\\">จำนวนแถว</th><th>recordid ตัวอย่าง</th><th>field ตัวอย่าง</th><th class=\\"n\\">ล่าสุด</th><th>map แล้วเป็น</th></tr></thead><tbody>";',
            '  keys.forEach(function(k){var r=agg[k],hit=isHit(r);h+="<tr"+(hit?" style=\\"background:rgba(37,99,235,.08)\\"":"")+"><td><b>"+esc(k)+"</b></td><td>"+esc(prefix(r.field))+(hit?" <span class=\\"badge b-info\\">น่าจะใช่</span>":"")+"</td><td>"+esc(r.label||"")+"</td><td class=\\"n\\">"+r.cnt.toLocaleString()+"</td><td>"+esc(r.samples.slice(0,4).join(", "))+"</td><td>"+esc(r.field)+"</td><td class=\\"n\\">"+esc(r.last)+"</td><td>"+esc(B.mapped[k]||"")+"</td></tr>";});',
            '  $("tbdll-result").innerHTML=h+"</tbody></table></div>";}',
            'function merge(rows){rows.forEach(function(r){var k=String(r.rt);var a=agg[k]||(agg[k]={cnt:0,samples:[],field:r.samplefield||"",last:"",label:""});',
            '  a.cnt+=Number(r.cnt)||0;[r.samplerec,r.samplerec2].forEach(function(s){s=String(s);if(s&&a.samples.indexOf(s)<0)a.samples.push(s);});',
            '  if(String(r.lastdate||"")>a.last){a.last=String(r.lastdate||"");a.day=a.last.slice(0,10);}});}',
            'var cur="",waitFrom=0,tick=null;',
            'function pad(n){return (n<10?"0":"")+n;}',
            'function nextDay(d){var t=Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))+864e5,x=new Date(t);return x.getUTCFullYear()+"-"+pad(x.getUTCMonth()+1)+"-"+pad(x.getUTCDate());}',
            'function slices(){var out=[],st=B.sliceHours||6;B.days.forEach(function(d){for(var h=0;h<24;h+=st){var e=h+st;out.push({from:d+" "+pad(h)+":00",to:e>=24?nextDay(d)+" 00:00":d+" "+pad(e)+":00",label:d+" "+pad(h)+":00–"+(e>=24?"24":pad(e))+":00"});}});return out;}',
            'function startTick(){stopTick();tick=setInterval(function(){if(cur)status(cur+" · รอ server "+Math.round((Date.now()-waitFrom)/1000)+" วิ · รวม "+sec()+" วิ");},1000);}',
            'function stopTick(){if(tick)clearInterval(tick);tick=null;cur="";}',
            'function scan(){if(busy)return;busy=true;stop=false;agg={};t0=Date.now();$("tbdll-log").innerHTML="";startTick();',
            '  var sl=slices(),i=0,who=val("who",B.who),rid=val("rid",B.rid);',
            '  function next(){if(stop){stopTick();status("หยุดที่ช่วง "+i+"/"+sl.length+" · พบ "+Object.keys(agg).length+" record type · "+total().toLocaleString()+" แถว · "+sec()+" วิ");busy=false;return;}',
            '    if(i>=sl.length){stopTick();labels();return;}',
            '    var s=sl[i];cur="กำลังสแกน <b>"+s.label+"</b> (ช่วง "+(i+1)+"/"+sl.length+") · พบแล้ว "+Object.keys(agg).length+" record type · "+total().toLocaleString()+" แถว";waitFrom=Date.now();status(cur+" · รวม "+sec()+" วิ",i/sl.length*90);',
            '    var tries=0;(function go(){get({ajax:"probeday",from:s.from,to:s.to,who:who,rid:rid}).then(function(j){if(!j.ok)throw new Error(j.error||"error");merge(j.rows);render();logl(s.label+": "+j.rows.length+" record type, "+(j.ms/1000).toFixed(1)+" วิ");i++;next();})',
            '      .catch(function(e){if(++tries<2){logl(s.label+": ลองใหม่ ("+esc(e.message)+")");go();}else{logl("<b>"+s.label+": ข้าม</b> "+esc(e.message));i++;next();}});})();}',
            '  next();}',
            'function labels(){var keys=Object.keys(agg).filter(function(k){return !isCR(k,agg[k]);}).sort(function(a,b){return (isHit(agg[b])?1:0)-(isHit(agg[a])?1:0);}).slice(0,40),j=0;',
            '  function next(){if(stop||j>=keys.length){status("เสร็จ · "+B.days.length+" วัน · "+Object.keys(agg).length+" record type · "+total().toLocaleString()+" แถว · "+sec()+" วิ",100);busy=false;render();return;}',
            '    var k=keys[j];status("สแกนครบแล้ว กำลังหาชื่อ record type "+(j+1)+"/"+keys.length+" · "+sec()+" วิ",90+j/keys.length*10);',
            '    get({ajax:"label",rt:k,day:agg[k].day||B.days[0]}).then(function(x){agg[k].label=x.label||"";}).catch(function(){}).then(function(){j++;render();next();});}',
            '  next();}',
            'function auto(){if(busy)return;busy=true;t0=Date.now();status("กำลังหาไฟล์ใต้ SuiteScripts ที่แก้ล่าสุด แล้วดู System Note ของไฟล์นั้น…",30);',
            '  get({ajax:"autofile"}).then(function(j){if(!j.ok)throw new Error(j.error);var c={};j.rows.forEach(function(r){if(r.rt!=="")c[r.rt]=(c[r.rt]||0)+1;});',
            '    var h="<div class=\\"scroll\\"><table class=\\"rt\\"><thead><tr><th>ไฟล์</th><th>file id</th><th>วันที่แก้</th><th>recordtypeid ที่พบ</th><th class=\\"n\\">แถว</th></tr></thead><tbody>";',
            '    j.rows.forEach(function(r){h+="<tr><td>"+esc(r.fileName)+"</td><td>"+esc(r.fileId)+"</td><td>"+esc(r.day)+"</td><td>"+(r.rt===""?"ไม่พบ System Note":esc(r.rt))+"</td><td class=\\"n\\">"+esc(r.cnt)+"</td></tr>";});',
            '    var best=Object.keys(c).sort(function(a,b){return c[b]-c[a];})[0];',
            '    $("tbdll-result").innerHTML=(best?"<div style=\\"padding:12px 16px\\"><b>แนะนำ: \'File\': "+esc(best)+"</b> (พบใน "+c[best]+" จาก "+j.rows.filter(function(r){return r.rt!=="";}).length+" แถวที่ตรวจ) — ใส่ใน RECTYPE_MAP ของ TB_DLL_Config</div>":"<div style=\\"padding:12px 16px\\">ไม่พบ System Note ของไฟล์ที่แก้ล่าสุด — SuiteQL อาจไม่เห็นการเปลี่ยนแปลงของ File</div>")+h+"</tbody></table></div>";',
            '    status("ตรวจหา File เสร็จ · "+sec()+" วิ",100);}).catch(function(e){status("ไม่สำเร็จ: "+esc(e.message),0);}).then(function(){busy=false;});}',
            '$("tbdll-start").addEventListener("click",function(){scan();});',
            '$("tbdll-stop").addEventListener("click",function(){stop=true;});',
            '$("tbdll-auto").addEventListener("click",function(){auto();});',
            '["tbdll-hidecr","tbdll-onlyhit"].forEach(function(id){$(id).addEventListener("change",render);});$("tbdll-q").addEventListener("input",render);',
            '$("tbdll-q").addEventListener("keydown",function(e){if(e.key==="Enter")e.preventDefault();});',
            '})();'
        ].join('\n');

        function json(ctx, obj) {
            ctx.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
            ctx.response.write(JSON.stringify(obj));
        }

        /** endpoint ของหน้า probe — คืน JSON เสมอ */
        function probeAjax(ctx, p) {
            const t = Date.now();
            try {
                if (p.ajax === 'probeday') {
                    const tsOk = s => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(s || ''));
                    if (!tsOk(p.from) || !tsOk(p.to)) throw new Error('from/to ต้องเป็น YYYY-MM-DD HH:MI');
                    const rows = L.probeRecordTypes('', '', {
                        fromTs: String(p.from), toTs: String(p.to),
                        actor: p.who === 'me' ? String(runtime.getCurrentUser().id) : '',
                        recordId: /^\d+$/.test(String(p.rid || '')) ? String(p.rid) : '',
                        limit: 200, skipLabels: true
                    });
                    return json(ctx, { ok: true, rows, ms: Date.now() - t });
                }
                if (p.ajax === 'label') return json(ctx, { ok: true, label: L.recordTypeLabel(p.rt, String(p.day || '')) });
                if (p.ajax === 'autofile') return json(ctx, { ok: true, rows: L.autoDetectFileRectype(5), ms: Date.now() - t });
                throw new Error('ไม่รู้จัก ajax=' + p.ajax);
            } catch (e) {
                L.log('probe ajax ' + p.ajax, e.message);
                return json(ctx, { ok: false, error: e.message });
            }
        }

        function page(ctx, html) {
            const form = serverWidget.createForm({ title: 'Change Report' });
            const f = form.addField({ id: 'custpage_rui', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
            f.defaultValue = html;
            ctx.response.writePage(form);
        }

        /** ดึงการเปลี่ยนแปลงของวันเดียว → JSON (browser เรียกทีละวัน) */
        function dayAjax(ctx, p) {
            const day = String(p.day || '');
            try {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day ต้องเป็น YYYY-MM-DD');
                const t = Date.now();
                const res = L.run(day, day);
                const changes = res.changes.map(c => ({
                    objType: c.objType, objId: c.objId, objName: c.objName, actor: c.actor, actorName: c.actorName, role: c.role, roleName: c.roleName,
                    context: c.context, ts: c.ts, fields: c.fields, details: c.details || [], scripts: c.scripts || [], scriptText: c.scriptText || ''
                }));
                return json(ctx, { ok: true, day, changes, noteRows: res.noteRows, ms: Date.now() - t });
            } catch (e) {
                L.log('day ajax ' + day, e.message);
                return json(ctx, { ok: false, error: e.message });
            }
        }

        /** ค่าเดิม → ใหม่ ของ object เดียว (ปุ่มในไดอะแกรม) — query ทีละ recordid ซึ่งเร็ว */
        function detailAjax(ctx, ui, p) {
            try {
                const type = String(p.type || '');
                const id = String(p.id || '');
                const from = String(p.from || ''), to = String(p.to || '');
                if (!/^\d+$/.test(id)) throw new Error('id ต้องเป็นตัวเลข');
                if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('from/to ต้องเป็น YYYY-MM-DD');
                const t = Date.now();
                const d = L.objectDetail(type, id, from, to);
                L.log('detail', type + ' #' + id + ' ' + from + '..' + to + ' · ' + d.rows.length + ' แถว · ' + (Date.now() - t) + ' ms');
                return json(ctx, { ok: true, html: detailTable(ui, type, id, d), count: d.rows.length, ms: Date.now() - t });
            } catch (e) {
                L.log('detail ajax', e.message);
                return json(ctx, { ok: false, error: e.message });
            }
        }

        /** ตารางค่าเดิม → ใหม่ ของ object เดียว */
        function detailTable(ui, type, id, d) {
            const rows = d.rows.map(r => ({
                when: r.tsText,
                who: r.actorName + (r.roleName ? ' (' + r.roleName + ')' : ''),
                field: r.field,
                oldv: r.oldValue,
                newv: r.newValue,
                ctx: r.context
            }));
            return ui.table({
                note: type + ' #' + id + ' · ' + d.rows.length + ' แถว' + (d.truncated ? ' · แสดง 800 แถวแรก' : ''),
                emptyTitle: 'ไม่มีรายละเอียด',
                emptyText: 'ไม่พบ System Note ของ object นี้ในช่วงวันที่เลือก',
                columns: [
                    { key: 'when', label: 'เวลา', type: 'date' },
                    { key: 'who', label: 'ผู้แก้' },
                    { key: 'field', label: 'Field', type: 'wrap' },
                    { key: 'oldv', label: 'ค่าเดิม', type: 'wrap' },
                    { key: 'newv', label: 'ค่าใหม่', type: 'wrap' },
                    { key: 'ctx', label: 'Context' }
                ],
                rows
            });
        }

        /** รับรายการที่ browser ดึงครบแล้ว (POST JSON) → วาด KPI/ไดอะแกรม/ตาราง + CSV สองแบบ */
        function renderAjax(ctx, ui) {
            try {
                const body = JSON.parse(ctx.request.body || '{}');
                const res = L.finish(body.changes || [], { noteRows: body.noteRows || 0, ms: body.ms || 0 });
                L.log('render', (body.from || '') + '..' + (body.to || '') + ' · changes ' + res.total + ' · scripts ' + res.scripts + ' · browser ' + Math.round((body.ms || 0) / 1000) + ' s');
                return json(ctx, {
                    ok: true,
                    html: buildBody(ui, res),
                    csvGroup: L.toGroupCsv(body.from || '', body.to || '', res.groups),
                    csvAll: L.toCsv(body.from || '', body.to || '', res)
                });
            } catch (e) {
                L.log('render ajax', e.message + ' ' + (e.stack || ''));
                return json(ctx, { ok: false, error: e.message });
            }
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
            const isProbe = p.view === 'probe';
            const per = readPeriod(p, isProbe);
            try {
                if (isProbe) {
                    if (p.ajax) return probeAjax(ctx, p);
                    const pf = {
                        actor: p.who === 'me' ? String(runtime.getCurrentUser().id) : '',
                        recordId: /^\d+$/.test(String(p.rid || '').trim()) ? String(p.rid).trim() : ''
                    };
                    return page(ctx, buildProbe(ui, per, view, pf));
                }
                if (p.ajax === 'day') return dayAjax(ctx, p);
                if (p.ajax === 'detail') return detailAjax(ctx, ui, p);
                if (p.ajax === 'render') return renderAjax(ctx, ui);
                return page(ctx, buildShell(ui, per, view));
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
