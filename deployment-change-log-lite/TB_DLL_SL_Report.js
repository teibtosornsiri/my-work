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
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const parse = (s, d) => {
                if (!s) return d;
                const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
                try { return format.parse({ value: s, type: format.Type.DATE }); } catch (e) { return d; }
            };
                        const yesterday = new Date(today.getTime() - 864e5);
            // probe = 7 วันล่าสุด · รายงาน = เมื่อวาน 1 วัน (เปิดหน้าเร็ว อยากได้ทั้งเดือนค่อยเลือกเอง)
            const from = parse(p.f_from, todayDefault ? new Date(today.getTime() - 6 * 864e5) : yesterday);
            const to = parse(p.f_to, todayDefault ? today : yesterday);
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

        function buildReport(ui, per, res, ctx) {
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
                    flagOn
                        ? { label: 'ผู้แก้ไม่มีสิทธิ์ deploy', value: ui.int(res.flagged), bad: res.flagged > 0, note: res.flagged ? 'ต้องมีคำอธิบายทุกแถว' : '' }
                        : { label: 'ผู้แก้ (คน)', value: ui.int(res.actors || 0), icon: 'doc', note: 'ใช้เวลาดึง ' + ((res.ms || 0) / 1000).toFixed(1) + ' วิ' }
                ]),
                res.total ? ui.grid([
                    ui.card({ title: 'ตามประเภท object', body: ui.barList(res.byType.slice(0, 8)) }),
                    ui.card({ title: 'ตามผู้แก้', body: ui.barList(res.byActor.slice(0, 8)) })
                ]) : '',
                ui.tabs([
                    flagOn && {
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
                ].filter(Boolean))
            ]) + loadingOverlay(per);
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
