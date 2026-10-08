/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Generic Batch Record Update v2.1 — CSV + Query Mode
 * ────────────────────────────────────────────────────
 * Two modes under one Suitelet:
 *   📁 CSV Mode  → Upload CSV → Drag-drop mapping → Process
 *   🔍 Query Mode → Write SuiteQL or Visual Builder → Select IDs → Set values → Process
 *
 * Routes:
 *   GET                        → Landing page (mode selector)
 *   GET  ?action=csvupload     → CSV Step 1: Upload form
 *   POST step=upload           → CSV Step 2: Drag-drop mapping
 *   POST step=process          → Step 3: Progress page (shared)
 *   GET  ?action=query         → Query Mode page
 *   GET  ?action=runquery      → AJAX: execute SuiteQL → return JSON
 *   GET  ?action=update        → AJAX: update 1 record
 */
define([
    'N/ui/serverWidget',
    'N/record',
    'N/log',
    'N/runtime',
    'N/file',
    'N/query'
], (serverWidget, record, log, runtime, file, query) => {

    /* ─── CONFIG ─── */
    const FILE_FOLDER = 75519;  // *** เปลี่ยนเป็น folder ID จริง ***

    const RECORD_TYPES = [
        { value: 'itemreceipt',         label: 'Item Receipt' },
        { value: 'itemfulfillment',     label: 'Item Fulfillment' },
        { value: 'transferorder',       label: 'Transfer Order' },
        { value: 'salesorder',          label: 'Sales Order' },
        { value: 'purchaseorder',       label: 'Purchase Order' },
        { value: 'vendorbill',          label: 'Vendor Bill' },
        { value: 'invoice',             label: 'Invoice' },
        { value: 'inventoryadjustment', label: 'Inventory Adjustment' },
        { value: 'journalentry',        label: 'Journal Entry' },
    ];

    function getBaseUrl() {
        return '/app/site/hosting/scriptlet.nl?script='
            + runtime.getCurrentScript().id
            + '&deploy=' + runtime.getCurrentScript().deploymentId;
    }

    /* ══════════════════════════════════════════════════════
     *  LANDING PAGE — Mode Selector
     * ══════════════════════════════════════════════════════ */
    function renderLanding(context) {
        const form = serverWidget.createForm({ title: 'Batch Record Update' });
        const base = getBaseUrl();
        const fHtml = form.addField({ id: 'custpage_landing', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
        fHtml.defaultValue = `
<style>
.landing{font-family:'Segoe UI',Arial,sans-serif;max-width:800px;margin:30px auto;text-align:center}
.landing h2{color:#1e3a5f;margin-bottom:8px;font-size:22px}
.landing p{color:#6b7280;margin-bottom:30px}
.mode-cards{display:flex;gap:24px;justify-content:center;flex-wrap:wrap}
.mode-card{
    flex:1;min-width:280px;max-width:360px;padding:32px 24px;border-radius:14px;
    text-decoration:none;color:#1e3a5f;transition:all .2s;cursor:pointer;
    border:2px solid #e5e7eb;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.06);
}
.mode-card:hover{border-color:#3b82f6;box-shadow:0 4px 20px rgba(59,130,246,.15);transform:translateY(-2px)}
.mode-card .icon{font-size:48px;margin-bottom:12px}
.mode-card h3{margin:0 0 8px;font-size:18px}
.mode-card p{margin:0;font-size:13px;color:#6b7280;text-align:left}
.mode-card ul{text-align:left;font-size:12px;color:#6b7280;margin:10px 0 0;padding-left:18px}
.mode-card ul li{margin:3px 0}
</style>
<div class="landing">
    <h2>🛠️ Batch Record Update</h2>
    <p>เลือกโหมดการทำงาน</p>
    <div class="mode-cards">
        <a class="mode-card" href="${base}&action=csvupload">
            <div class="icon">📁</div>
            <h3>CSV Upload</h3>
            <p>Upload CSV file แล้วลาก-วาง map columns ไปยัง NetSuite fields</p>
            <ul>
                <li>Drag & Drop column mapping</li>
                <li>Body + Line level fields</li>
                <li>รองรับ Line ID matching</li>
            </ul>
        </a>
        <a class="mode-card" href="${base}&action=query">
            <div class="icon">🔍</div>
            <h3>Query Mode</h3>
            <p>ค้นหา records ด้วย SuiteQL แล้วเลือก update ค่าได้เลย ไม่ต้อง upload file</p>
            <ul>
                <li>🧩 Visual Builder — จับวางง่ายๆ ไม่ต้องเขียน SQL</li>
                <li>📝 Raw SQL — สำหรับ advanced users</li>
                <li>Preview + เลือก records → ระบุค่า → Process</li>
            </ul>
        </a>
    </div>
</div>`;
        context.response.writePage(form);
    }

    /* ══════════════════════════════════════════════════════
     *  CSV MODE — Step 1: Upload
     * ══════════════════════════════════════════════════════ */
    function renderCsvUpload(context) {
        const form = serverWidget.createForm({ title: 'Batch Record Update — CSV Upload' });

        // Add a reliable back button via INLINEHTML (NS addButton functionName doesn't support expressions)
        const backUrl = getBaseUrl();
        form.addField({ id: 'custpage_back_btn', type: serverWidget.FieldType.INLINEHTML, label: ' ' })
            .defaultValue = `<a href="${backUrl}" style="display:inline-block;padding:6px 16px;background:#6b7280;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;margin-bottom:4px">⬅ Back</a>`;

        const fType = form.addField({ id: 'custpage_rectype', type: serverWidget.FieldType.SELECT, label: 'Transaction Type' });
        fType.isMandatory = true;
        fType.addSelectOption({ value: '', text: '-- Select --' });
        RECORD_TYPES.forEach(t => fType.addSelectOption({ value: t.value, text: t.label }));

        const fSub = form.addField({ id: 'custpage_sublist', type: serverWidget.FieldType.TEXT, label: 'Sublist ID' });
        fSub.defaultValue = 'item';
        fSub.setHelpText({ help: 'Sublist สำหรับ line-level mapping เช่น item, expense, line' });

        form.addField({ id: 'custpage_csv_file', type: serverWidget.FieldType.FILE, label: 'Upload CSV File' }).isMandatory = true;

        form.addField({ id: 'custpage_step', type: serverWidget.FieldType.TEXT, label: 'step' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        form.updateDefaultValues({ custpage_step: 'upload' });

        form.addSubmitButton({ label: 'Next → Mapping' });
        context.response.writePage(form);
    }

    /* ══════════════════════════════════════════════════════
     *  CSV MODE — Step 2: Drag-Drop Mapping
     * ══════════════════════════════════════════════════════ */
    function renderCsvMapping(context) {
        const req = context.request;
        const recType = req.parameters.custpage_rectype || '';
        const sublistId = req.parameters.custpage_sublist || 'item';

        const uploadedFile = req.files.custpage_csv_file;
        if (!uploadedFile || !recType) { renderCsvUpload(context); return; }

        const contents = uploadedFile.getContents();
        const { headers, rows } = parseCSVFull(contents);
        if (headers.length === 0) { renderError(context, 'ไม่พบ header ใน CSV'); return; }

        const recTypeLabel = (RECORD_TYPES.find(t => t.value === recType) || {}).label || recType;
        const sample = rows.slice(0, 5);

        const form = serverWidget.createForm({ title: 'Batch Record Update — Step 2: Mapping' });

        // Save CSV data to File Cabinet
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const csvFile = file.create({
            name: 'batch_update_data_' + ts + '.json',
            fileType: file.Type.JSON,
            contents: JSON.stringify({ headers, rows }),
            folder: FILE_FOLDER,
            isOnline: true
        });
        const csvFileId = csvFile.save();
        log.audit('renderCsvMapping', 'Saved CSV data → file #' + csvFileId + ' (' + rows.length + ' rows)');

        // Hidden fields
        form.addField({ id: 'custpage_csv_file_id', type: serverWidget.FieldType.TEXT, label: 'fid' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        form.addField({ id: 'custpage_rectype2', type: serverWidget.FieldType.TEXT, label: 'rt' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        form.addField({ id: 'custpage_sublist2', type: serverWidget.FieldType.TEXT, label: 'sl' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        form.addField({ id: 'custpage_mapping_json', type: serverWidget.FieldType.LONGTEXT, label: 'mapping' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        form.addField({ id: 'custpage_step', type: serverWidget.FieldType.TEXT, label: 'step' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        form.updateDefaultValues({
            custpage_csv_file_id: String(csvFileId),
            custpage_rectype2: recType,
            custpage_sublist2: sublistId,
            custpage_step: 'process'
        });

        const html = buildMappingHTML(headers, sample, recTypeLabel, sublistId);
        form.addField({ id: 'custpage_html', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue = html;

        form.addSubmitButton({ label: '🚀 Start Processing' });
        context.response.writePage(form);
    }

    /* ══════════════════════════════════════════════════════
     *  CSV Mapping HTML (same as V2)
     * ══════════════════════════════════════════════════════ */
    function buildMappingHTML(headers, sample, recTypeLabel, sublistId) {
        const colsJson = JSON.stringify(headers);
        const sampleJson = JSON.stringify(sample);

        return `
<style>
.mp{font-family:'Segoe UI',Arial,sans-serif;max-width:1250px;margin:8px auto;font-size:13px}
.mp h2{margin:0 0 4px;font-size:17px;color:#1e3a5f}
.mp-info{background:#eef4ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1e40af}
.src-zone{background:#f8fafc;border:2px dashed #cbd5e1;border-radius:10px;padding:12px 14px;margin-bottom:16px;min-height:48px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.src-zone.drag-over{border-color:#3b82f6;background:#eff6ff}
.chip{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:grab;user-select:none;transition:all .15s;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.chip:active{cursor:grabbing;transform:scale(1.05)}
.chip-src{background:#e0e7ff;color:#3730a3;border:1.5px solid #a5b4fc}
.chip-id{background:#fef3c7;color:#92400e;border:1.5px solid #fbbf24}
.chip-lid{background:#fce7f3;color:#9d174d;border:1.5px solid #f472b6}
.chip-body{background:#dcfce7;color:#166534;border:1.5px solid #86efac}
.chip-line{background:#e0f2fe;color:#075985;border:1.5px solid #7dd3fc}
.chip .x{cursor:pointer;opacity:.5;font-size:14px;margin-left:2px}.chip .x:hover{opacity:1;color:#dc2626}
.zones{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:16px}
@media(max-width:900px){.zones{grid-template-columns:1fr}}
.zone{border:2px dashed #d1d5db;border-radius:10px;padding:12px;min-height:100px;transition:all .2s}
.zone.drag-over{border-color:#3b82f6;background:#eff6ff;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
.zone h3{margin:0 0 8px;font-size:14px;display:flex;align-items:center;gap:6px}
.zone-id{border-color:#fbbf24;background:#fffbeb}
.zone-id h3{color:#92400e}
.zone-body{border-color:#86efac;background:#f0fdf4}
.zone-body h3{color:#166534}
.zone-line{border-color:#7dd3fc;background:#f0f9ff}
.zone-line h3{color:#075985}
.zone .items{display:flex;flex-wrap:wrap;gap:6px;min-height:36px}
.zone .empty-hint{color:#9ca3af;font-size:11px;font-style:italic}
.ns-pair{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap}
.ns-pair .arrow{color:#6b7280;font-size:14px}
.ns-input{border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;width:180px;font-family:monospace}
.ns-input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.2)}
.ns-input::placeholder{color:#9ca3af}
.opts{display:flex;gap:20px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.opt-group{display:flex;align-items:center;gap:6px}
.opt-group label{font-weight:600;color:#374151;font-size:12px}
.opt-group input{border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px}
.pv-wrap{border:1px solid #e5e7eb;border-radius:8px;overflow:auto;max-height:200px;margin-bottom:14px}
.pv{width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap}
.pv th{background:#1e3a5f;color:#fff;padding:6px 10px;position:sticky;top:0;text-align:left}
.pv td{padding:5px 10px;border-bottom:1px solid #f3f4f6}
.pv tr:hover td{background:#f8fafc}
.pv .hi{background:#fef9c3}
.zone-lid{border-color:#f472b6;background:#fdf2f8;margin-top:10px;padding:8px 12px;border-radius:8px;border:1.5px dashed #f472b6}
.zone-lid h4{margin:0 0 6px;font-size:13px;color:#9d174d}
</style>
<div class="mp">
    <div class="mp-info"><b>📋 ${esc(recTypeLabel)}</b> | Sublist: <b>${esc(sublistId)}</b> | CSV: <b>${headers.length} columns</b></div>
    <h2>📄 CSV Columns — ลากวางด้านล่าง</h2>
    <div id="srcZone" class="src-zone"></div>
    <div class="zones">
        <div class="zone zone-id" id="zoneId"><h3>🔑 Record ID</h3><p style="font-size:11px;color:#78716c;margin:0 0 6px">ลาก column ที่เก็บ Internal ID</p><div class="items" id="zoneIdItems"></div></div>
        <div class="zone zone-body" id="zoneBody"><h3>📦 Body Fields (Order Level)</h3><p style="font-size:11px;color:#4b5563;margin:0 0 6px">ลาก column → ระบุ NS Field ID</p><div class="items" id="zoneBodyItems"></div></div>
        <div class="zone zone-line" id="zoneLine"><h3>📝 Line Fields</h3><p style="font-size:11px;color:#4b5563;margin:0 0 6px">ลาก column → ระบุ NS Field ID</p><div class="items" id="zoneLineItems"></div>
            <div class="zone-lid" id="zoneLid"><h4>🔗 Line ID (optional)</h4><div class="items" id="zoneLidItems"></div></div>
        </div>
    </div>
    <div class="opts"><div class="opt-group"><label>⚡ Threads:</label><input type="number" id="optThreads" value="5" min="1" max="10" style="width:60px"/></div></div>
    <h2>👀 Data Preview</h2>
    <div class="pv-wrap"><table class="pv" id="pvTable"></table></div>
    <div id="valMsg" style="display:none;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:13px;font-weight:600"></div>
</div>
<script>
(function(){
    var COLS=${colsJson},SAMPLE=${sampleJson};
    var placements={};
    function init(){COLS.forEach(function(c){placements[c]={zone:'src',nsField:''}});renderAll();buildPreview()}
    function renderAll(){
        var src=[],id=[],body=[],line=[],lid=[];
        COLS.forEach(function(c){var p=placements[c];if(p.zone==='id')id.push(c);else if(p.zone==='body')body.push(c);else if(p.zone==='line')line.push(c);else if(p.zone==='lid')lid.push(c);else src.push(c)});
        renderChips('srcZone',src,'chip-src',false);renderChips('zoneIdItems',id,'chip-id',false);renderChips('zoneBodyItems',body,'chip-body',true);renderChips('zoneLineItems',line,'chip-line',true);renderChips('zoneLidItems',lid,'chip-lid',false);
        highlightPreview();validate();syncHidden();
    }
    function renderChips(cid,cols,cls,showNs){
        var c=document.getElementById(cid);c.innerHTML='';
        if(!cols.length){c.innerHTML='<span class="empty-hint">ลาก column มาวางที่นี่</span>';return}
        cols.forEach(function(col){
            var w=document.createElement('div');w.className='ns-pair';
            var ch=document.createElement('span');ch.className='chip '+cls;ch.draggable=true;ch.dataset.col=col;
            ch.innerHTML=col+' <span class="x">&times;</span>';
            ch.addEventListener('dragstart',function(e){e.dataTransfer.setData('text/plain',col);e.dataTransfer.effectAllowed='move';ch.style.opacity='0.4'});
            ch.addEventListener('dragend',function(){ch.style.opacity='1'});
            ch.querySelector('.x').addEventListener('click',function(e){e.stopPropagation();placements[col]={zone:'src',nsField:''};renderAll()});
            w.appendChild(ch);
            if(showNs){
                var ar=document.createElement('span');ar.className='arrow';ar.textContent='→';w.appendChild(ar);
                var inp=document.createElement('input');inp.className='ns-input';inp.type='text';inp.placeholder='NS field ID';inp.value=placements[col].nsField||'';
                inp.addEventListener('input',function(){placements[col].nsField=this.value.trim();syncHidden();validate()});
                w.appendChild(inp);
            }
            c.appendChild(w);
        });
    }
    function setupZone(zid,zn){
        var el=document.getElementById(zid);
        el.addEventListener('dragover',function(e){e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over')});
        el.addEventListener('dragleave',function(){el.classList.remove('drag-over')});
        el.addEventListener('drop',function(e){
            e.preventDefault();el.classList.remove('drag-over');var col=e.dataTransfer.getData('text/plain');if(!col||!placements[col])return;
            if(zn==='id')COLS.forEach(function(c){if(placements[c].zone==='id')placements[c]={zone:'src',nsField:''}});
            placements[col]={zone:zn,nsField:placements[col].nsField||''};renderAll();
        });
    }
    setupZone('srcZone','src');setupZone('zoneId','id');
    document.getElementById('zoneIdItems').addEventListener('dragover',function(e){e.preventDefault()});
    document.getElementById('zoneIdItems').addEventListener('drop',function(e){
        e.preventDefault();e.stopPropagation();var col=e.dataTransfer.getData('text/plain');if(!col)return;
        COLS.forEach(function(c){if(placements[c].zone==='id')placements[c]={zone:'src',nsField:''}});
        placements[col]={zone:'id',nsField:''};renderAll();
    });
    setupZone('zoneBody','body');setupZone('zoneLine','line');
    // zoneLid nested — stopPropagation
    (function(){
        var lz=document.getElementById('zoneLid'),li=document.getElementById('zoneLidItems');
        function hDrop(e){e.preventDefault();e.stopPropagation();lz.classList.remove('drag-over');var col=e.dataTransfer.getData('text/plain');if(!col||!placements[col])return;COLS.forEach(function(c){if(placements[c].zone==='lid')placements[c]={zone:'src',nsField:''}});placements[col]={zone:'lid',nsField:''};renderAll()}
        function hOver(e){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';lz.classList.add('drag-over')}
        function hLeave(e){e.stopPropagation();lz.classList.remove('drag-over')}
        lz.addEventListener('dragover',hOver);lz.addEventListener('dragleave',hLeave);lz.addEventListener('drop',hDrop);
        li.addEventListener('dragover',hOver);li.addEventListener('drop',hDrop);
    })();
    function buildPreview(){var t=document.getElementById('pvTable'),h='<thead><tr>';COLS.forEach(function(c){h+='<th>'+he(c)+'</th>'});h+='</tr></thead><tbody>';SAMPLE.forEach(function(r){h+='<tr>';COLS.forEach(function(c,i){h+='<td>'+he(r[i]||'')+'</td>'});h+='</tr>'});h+='</tbody>';t.innerHTML=h}
    function highlightPreview(){document.querySelectorAll('#pvTable th').forEach(function(th,i){var p=placements[COLS[i]];th.classList.toggle('hi',p&&p.zone!=='src')})}
    function validate(){
        var msg=document.getElementById('valMsg'),hasId=COLS.some(function(c){return placements[c].zone==='id'}),bf=COLS.filter(function(c){return placements[c].zone==='body'}),lf=COLS.filter(function(c){return placements[c].zone==='line'}),errs=[];
        if(!hasId)errs.push('⚠️ ต้องระบุ Record ID column');if(!bf.length&&!lf.length)errs.push('⚠️ ต้อง map อย่างน้อย 1 field');
        bf.forEach(function(c){if(!placements[c].nsField)errs.push('⚠️ Body "'+c+'" → ยังไม่ระบุ NS Field ID')});
        lf.forEach(function(c){if(!placements[c].nsField)errs.push('⚠️ Line "'+c+'" → ยังไม่ระบุ NS Field ID')});
        if(errs.length){msg.style.display='block';msg.style.background='#fef3c7';msg.style.color='#92400e';msg.style.border='1px solid #fbbf24';msg.innerHTML=errs.join('<br/>')}
        else{msg.style.display='block';msg.style.background='#d1fae5';msg.style.color='#065f46';msg.style.border='1px solid #86efac';msg.innerHTML='✅ Ready!'}
        return!errs.length;
    }
    function syncHidden(){
        var idCol='',lidCol='',bodyMap=[],lineMap=[];
        COLS.forEach(function(c){var p=placements[c];if(p.zone==='id')idCol=c;if(p.zone==='lid')lidCol=c;if(p.zone==='body'&&p.nsField)bodyMap.push({csvCol:c,nsField:p.nsField});if(p.zone==='line'&&p.nsField)lineMap.push({csvCol:c,nsField:p.nsField})});
        var threads=parseInt(document.getElementById('optThreads').value,10)||5;
        try{nlapiSetFieldValue('custpage_mapping_json',JSON.stringify({idCol:idCol,lidCol:lidCol,bodyMap:bodyMap,lineMap:lineMap,threads:threads}))}catch(e){}
    }
    document.getElementById('optThreads').addEventListener('change',syncHidden);
    if(typeof window.nsAdditionalSubmitAction==='undefined'){window.nsAdditionalSubmitAction=function(){syncHidden();if(!validate()){alert('กรุณาตั้งค่า mapping ให้ครบก่อน');return false}return true}}
    function he(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML}
    init();
})();
</script>`;
    }

    /* ══════════════════════════════════════════════════════
     *  QUERY MODE — Full page with Visual Builder + Raw SQL
     * ══════════════════════════════════════════════════════ */
    function renderQueryMode(context) {
        const form = serverWidget.createForm({ title: 'Batch Record Update — Query Mode' });
        const base = getBaseUrl();

        // No NS submit button — we use custom Process button + redirect
        const fHtml = form.addField({ id: 'custpage_qhtml', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
        fHtml.defaultValue = buildQueryHTML(base);
        context.response.writePage(form);
    }

    function buildQueryHTML(base) {
        const recTypesJson = JSON.stringify(RECORD_TYPES);
        return `
<style>
*,:before,:after{box-sizing:border-box}
.qp{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;max-width:1300px;margin:0 auto;font-size:13px;color:#1e293b;padding:8px 0}
.qp a.back-link{font-size:12px;color:#64748b;text-decoration:none;display:inline-flex;align-items:center;gap:4px;padding:4px 0;margin-bottom:12px;transition:color .15s}
.qp a.back-link:hover{color:#1a56db}

/* Tabs — pill style */
.qtabs{display:inline-flex;gap:2px;padding:3px;background:#f1f5f9;border-radius:10px;margin-bottom:20px}
.qtab{padding:8px 22px;font-size:13px;font-weight:600;cursor:pointer;border-radius:8px;color:#64748b;transition:all .2s;user-select:none}
.qtab:hover{color:#334155}
.qtab.active{color:#fff;background:#1e3a5f;box-shadow:0 1px 4px rgba(30,58,95,.25)}

/* Panels */
.qpanel{display:none}.qpanel.active{display:block}

/* Card sections */
.q-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.q-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;cursor:pointer;user-select:none}
.q-card-head h3{margin:0;font-size:13px;font-weight:700;color:#334155;display:flex;align-items:center;gap:6px}
.q-card-head .toggle-icon{font-size:11px;color:#94a3b8;transition:transform .2s}
.q-card.collapsed .q-card-body{display:none}
.q-card.collapsed .toggle-icon{transform:rotate(-90deg)}
.q-card-body{padding:14px 16px}

/* Form rows — compact grid */
.f-grid{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;align-items:center}
.f-grid label{font-size:12px;font-weight:600;color:#475569;white-space:nowrap}
.f-grid select,.f-grid input[type=text],.f-grid input[type=number]{border:1px solid #cbd5e1;border-radius:6px;padding:6px 10px;font-size:12px;background:#fff;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;transition:border-color .15s,box-shadow .15s}
.f-grid select:focus,.f-grid input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.12)}
.f-grid select{min-width:170px}

/* WHERE conditions — compact */
.cond-list{display:flex;flex-direction:column;gap:6px}
.cond-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.cond-row input,.cond-row select{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:12px;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;background:#fff !important}
.cond-row .c-field{width:150px}.cond-row .c-op{width:110px}.cond-row .c-val{width:200px;flex:1;min-width:120px}
.cond-and{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;width:32px;text-align:center;flex-shrink:0}
.btn-sm{padding:4px 10px;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;transition:all .15s}
.btn-add{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}.btn-add:hover{background:#d1fae5}
.btn-del{background:#fff;color:#94a3b8;border:1px solid #e2e8f0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:14px;padding:0}
.btn-del:hover{background:#fef2f2;color:#dc2626;border-color:#fca5a5}

/* SQL Editor */
.sql-editor{width:100%;min-height:120px;font-family:'Fira Code','SF Mono',Consolas,monospace;font-size:13px !important;border:1px solid #1e293b;border-radius:8px;padding:12px;resize:vertical;background:#0f172a !important;color:#e2e8f0 !important;line-height:1.6;tab-size:4;-webkit-text-fill-color:#e2e8f0 !important}
.sql-editor::placeholder{color:#64748b !important;-webkit-text-fill-color:#64748b !important}
.sql-editor:focus{outline:none;box-shadow:0 0 0 3px rgba(59,130,246,.2)}
.sql-editor::selection{background:#334155;color:#f8fafc}
.sql-preview{background:#0f172a;color:#93c5fd;border-radius:8px;padding:10px 14px;font-family:'Fira Code',monospace;font-size:11.5px;margin-top:8px;white-space:pre-wrap;max-height:90px;overflow:auto;border:1px solid #1e293b}

/* Run toolbar */
.qr-toolbar{display:flex;gap:8px;align-items:center;margin:16px 0 12px;flex-wrap:wrap}
.qr-toolbar .btn{padding:7px 18px;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px}
.btn-run{background:#1e3a5f;color:#fff}.btn-run:hover{background:#15294a;box-shadow:0 2px 8px rgba(30,58,95,.25)}
.btn-sel{background:#fff;color:#475569;border:1px solid #e2e8f0}.btn-sel:hover{background:#f8fafc}
.qr-count{font-size:12px;color:#64748b;margin-left:auto}

/* Results table */
.qr-wrap{border:1px solid #e2e8f0;border-radius:10px;overflow:auto;max-height:400px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.qr{width:100%;border-collapse:collapse;font-size:12px}
.qr th{background:#1e3a5f;color:#fff;padding:8px 10px;position:sticky;top:0;text-align:left;white-space:nowrap;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.3px}
.qr td{padding:6px 10px;border-bottom:1px solid #f1f5f9;white-space:nowrap}
.qr tbody tr{transition:background .1s}
.qr tr:hover td{background:#f8fafc}
.qr tr.selected td{background:#ecfdf5}
.qr input[type=checkbox]{width:15px;height:15px;cursor:pointer;accent-color:#1e3a5f}

/* Update Config */
.uc-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.uc-card-head{padding:12px 16px;background:linear-gradient(135deg,#fefce8,#fef9c3);border-bottom:1px solid #fde68a}
.uc-card-head h3{margin:0;font-size:13px;font-weight:700;color:#92400e;display:flex;align-items:center;gap:6px}
.uc-card-body{padding:14px 16px}
.uc-sub{margin-bottom:14px}
.uc-sub h4{margin:0 0 8px;font-size:12px;font-weight:700;color:#475569;display:flex;align-items:center;gap:5px;padding-bottom:6px;border-bottom:1px solid #f1f5f9}
.uc-row{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
.uc-row input{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:12px;font-family:'SF Mono',Consolas,monospace;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;background:#fff !important}
.uc-row .uf-field{width:200px}.uc-row .uf-value{width:200px;flex:1;min-width:120px}
.uc-row .arrow{color:#94a3b8;font-size:12px;flex-shrink:0}

/* Inventory Detail */
.inv-section{background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px;margin-top:12px}
.inv-section h4{margin:0 0 8px;font-size:12px;font-weight:700;color:#7c3aed;display:flex;align-items:center;gap:5px}
.inv-row{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
.inv-row input{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:12px;font-family:monospace;width:140px;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;background:#fff !important}
.inv-row select{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:12px;width:100px;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;background:#fff !important}

.status-msg{padding:10px 14px;border-radius:8px;font-size:12px;font-weight:600;margin:10px 0}
.msg-info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
.msg-err{background:#fef2f2;color:#991b1b;border:1px solid #fca5a5}
.msg-ok{background:#ecfdf5;color:#065f46;border:1px solid #86efac}

.spinner{display:inline-block;width:14px;height:14px;border:2px solid #cbd5e1;border-top-color:#1a56db;border-radius:50%;animation:spin .6s linear infinite;margin-right:5px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}

/* Process button */
.btn-process{padding:12px 36px;font-size:14px;font-weight:700;border:none;border-radius:8px;background:#1e3a5f;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(30,58,95,.2);transition:all .2s;display:inline-flex;align-items:center;gap:6px}
.btn-process:hover{background:#15294a;box-shadow:0 4px 16px rgba(30,58,95,.3);transform:translateY(-1px)}
</style>

<div class="qp">
    <a class="back-link" href="${base}">← Back to Mode Selection</a>

    <!-- Tabs -->
    <div class="qtabs">
        <div class="qtab active" onclick="switchTab('visual')">🧩 Visual Builder</div>
        <div class="qtab" onclick="switchTab('sql')">📝 Raw SQL</div>
    </div>

    <!-- ═══ Visual Builder Panel ═══ -->
    <div id="panelVisual" class="qpanel active">
        <div class="q-card">
            <div class="q-card-head" onclick="toggleCard(this)"><h3>📋 Record Type & Fields</h3><span class="toggle-icon">▼</span></div>
            <div class="q-card-body">
                <div class="f-grid">
                    <label>Record Type</label>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                        <select id="vbRecType" onchange="vbRecTypeChanged()"><option value="">-- Select --</option></select>
                        <label style="font-size:12px;font-weight:600;color:#475569">Table</label>
                        <input id="vbTable" type="text" placeholder="transaction" style="width:180px"/>
                    </div>
                    <label>SELECT</label>
                    <input id="vbSelect" type="text" value="id, tranid" style="width:100%" placeholder="id, tranid, entity, ..."/>
                </div>
            </div>
        </div>

        <div class="q-card">
            <div class="q-card-head" onclick="toggleCard(this)"><h3>🔍 WHERE Conditions</h3><span class="toggle-icon">▼</span></div>
            <div class="q-card-body">
                <div id="vbConditions" class="cond-list"></div>
                <button type="button" class="btn-sm btn-add" onclick="addCondition()" style="margin-top:8px">+ Add Condition</button>
            </div>
        </div>

        <div class="q-card">
            <div class="q-card-head" onclick="toggleCard(this)"><h3>⚙️ Options</h3><span class="toggle-icon">▼</span></div>
            <div class="q-card-body">
                <div class="f-grid">
                    <label>ORDER BY</label>
                    <input id="vbOrderBy" type="text" placeholder="id DESC" style="width:200px"/>
                    <label>LIMIT</label>
                    <input id="vbLimit" type="number" value="200" min="1" max="5000" style="width:100px"/>
                </div>
            </div>
        </div>

        <div id="vbPreview" class="sql-preview">SELECT id, tranid FROM transaction WHERE ...</div>
    </div>

    <!-- ═══ Raw SQL Panel ═══ -->
    <div id="panelSql" class="qpanel">
        <div class="q-card">
            <div class="q-card-head"><h3>📝 SuiteQL Editor</h3></div>
            <div class="q-card-body">
                <textarea id="sqlEditor" class="sql-editor" placeholder="SELECT id, tranid, type FROM transaction WHERE ..."></textarea>
                <p style="font-size:11px;color:#64748b;margin:6px 0 0">ต้องมี column <code style="background:#f1f5f9;padding:1px 4px;border-radius:3px">id</code> สำหรับ Internal ID ของ record ที่จะ update</p>
            </div>
        </div>
    </div>

    <!-- ═══ Run & Results ═══ -->
    <div class="qr-toolbar">
        <button type="button" class="btn btn-run" onclick="runQuery()"><span id="runIcon">▶</span> Run Query</button>
        <button type="button" class="btn btn-sel" onclick="selectAll()">☑ Select All</button>
        <button type="button" class="btn btn-sel" onclick="deselectAll()">☐ Deselect All</button>
        <span id="qrCount" class="qr-count"></span>
    </div>
    <div id="qrMsg" style="display:none" class="status-msg"></div>
    <div id="qrWrap" class="qr-wrap" style="display:none"><table class="qr" id="qrTable"></table></div>

    <!-- ═══ Update Config ═══ -->
    <div id="updateSection" style="display:none">
        <div class="uc-card">
            <div class="uc-card-head"><h3>✏️ Update Configuration</h3></div>
            <div class="uc-card-body">
                <div class="f-grid" style="margin-bottom:14px">
                    <label>Record Type</label>
                    <select id="ucRecType"></select>
                    <label>Sublist ID</label>
                    <input id="ucSublist" type="text" value="item" style="width:140px"/>
                </div>

                <div class="uc-sub">
                    <h4>📦 Body Fields</h4>
                    <div id="ucBodyFields"></div>
                    <button type="button" class="btn-sm btn-add" onclick="addUpdateField('body')">+ Add Body Field</button>
                </div>

                <div class="uc-sub">
                    <h4>📝 Line Fields</h4>
                    <div id="ucLineFields"></div>
                    <button type="button" class="btn-sm btn-add" onclick="addUpdateField('line')">+ Add Line Field</button>
                </div>

                <div class="inv-section">
                    <h4>📦 Inventory Detail (optional)</h4>
                    <p style="font-size:11px;color:#6b21a8;margin:0 0 8px">สำหรับ Item Receipt / Fulfillment ที่ต้อง set Serial/Lot Number</p>
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
                        <label style="font-size:11px;font-weight:600;color:#7c3aed"><input type="checkbox" id="ucInvDetailEnabled" onchange="toggleInvDetail()" style="margin-right:4px;accent-color:#7c3aed"/> Enable Inventory Detail</label>
                    </div>
                    <div id="ucInvDetailConfig" style="display:none">
                        <div id="ucInvDetailRows"></div>
                        <button type="button" class="btn-sm btn-add" onclick="addInvDetailRow()" style="background:#faf5ff;color:#7c3aed;border-color:#e9d5ff">+ Add Detail Row</button>
                    </div>
                </div>

                <div class="f-grid" style="margin-top:14px">
                    <label>Threads</label>
                    <input id="ucThreads" type="number" value="5" min="1" max="10" style="width:70px"/>
                </div>
            </div>
        </div>
        <div id="ucValMsg" style="display:none" class="status-msg"></div>
        <div style="text-align:center;margin-top:16px">
            <button type="button" onclick="processQuery()" class="btn-process">🚀 Process Selected Records</button>
        </div>
    </div>
</div>

<script>
(function(){
    var BASE='${base}';
    var REC_TYPES=${recTypesJson};
    var activeTab='visual';
    var queryResults=[];  // [{...row data}]
    var queryColumns=[];  // column names from result
    var selectedIds={};   // id → true

    // ─── Populate dropdowns ───
    var vbRT=document.getElementById('vbRecType');
    var ucRT=document.getElementById('ucRecType');
    REC_TYPES.forEach(function(t){
        vbRT.innerHTML+='<option value="'+t.value+'">'+t.label+'</option>';
        ucRT.innerHTML+='<option value="'+t.value+'">'+t.label+'</option>';
    });

    // Default table mapping
    var TABLE_MAP={itemreceipt:'transaction',itemfulfillment:'transaction',transferorder:'transaction',salesorder:'transaction',purchaseorder:'transaction',vendorbill:'transaction',invoice:'transaction',inventoryadjustment:'transaction',journalentry:'transaction'};

    // SuiteQL type string mapping (used in WHERE type = '...')
    var TYPE_MAP={itemreceipt:'ItemRcpt',itemfulfillment:'ItemShip',transferorder:'TrnfrOrd',salesorder:'SalesOrd',purchaseorder:'PurchOrd',vendorbill:'VendBill',invoice:'CustInvc',inventoryadjustment:'InvAdjst',journalentry:'Journal'};

    // ─── Tab switching ───
    window.switchTab=function(tab){
        activeTab=tab;
        document.querySelectorAll('.qtab').forEach(function(t,i){t.classList.toggle('active',i===(tab==='visual'?0:1))});
        document.getElementById('panelVisual').classList.toggle('active',tab==='visual');
        document.getElementById('panelSql').classList.toggle('active',tab==='sql');
    };

    // ─── Collapsible cards ───
    window.toggleCard=function(headEl){headEl.parentElement.classList.toggle('collapsed')};

    // ─── Visual Builder ───
    var condId=0;
    var autoTypeCondId=null; // track auto-injected type condition

    function vbRecTypeChanged(){
        var rt=document.getElementById('vbRecType').value;
        document.getElementById('vbTable').value=TABLE_MAP[rt]||'transaction';
        document.getElementById('ucRecType').value=rt;

        // Auto-inject/update type condition
        var typeVal=TYPE_MAP[rt]||'';
        if(autoTypeCondId){
            // Update existing auto-type condition
            var row=document.getElementById('cond_'+autoTypeCondId);
            if(row){
                row.querySelector('.c-field').value='type';
                row.querySelector('.c-op').value='=';
                row.querySelector('.c-val').value=typeVal;
            }
        } else if(typeVal){
            // Add new condition for type
            addCondition();
            var rows=document.getElementById('vbConditions').children;
            var lastRow=rows[rows.length-1];
            autoTypeCondId=parseInt(lastRow.dataset.cid,10);
            lastRow.querySelector('.c-field').value='type';
            lastRow.querySelector('.c-op').value='=';
            lastRow.querySelector('.c-val').value=typeVal;
        }
        updateVbPreview();
    }
    window.vbRecTypeChanged=vbRecTypeChanged;

    var OPERATORS=['=','!=','>','>=','<','<=','LIKE','NOT LIKE','IN','NOT IN','IS NULL','IS NOT NULL'];

    window.addCondition=function(){
        condId++;
        var div=document.getElementById('vbConditions');
        var row=document.createElement('div');row.className='cond-row';row.id='cond_'+condId;row.dataset.cid=condId;
        var optsHtml='';OPERATORS.forEach(function(op){optsHtml+='<option value="'+op+'">'+op+'</option>'});
        row.innerHTML=
            (div.children.length>0?'<span class="cond-and">AND</span>':'')+
            '<input type="text" class="c-field" placeholder="field name" oninput="updateVbPreview()"/>'+
            '<select class="c-op" onchange="updateVbPreview()">'+optsHtml+'</select>'+
            '<input type="text" class="c-val" placeholder="value" oninput="updateVbPreview()"/>'+
            '<button type="button" class="btn-sm btn-del" onclick="removeCond('+condId+')">✕</button>';
        div.appendChild(row);
    };

    window.removeCond=function(cid){
        var el=document.getElementById('cond_'+cid);if(el)el.remove();
        var rows=document.getElementById('vbConditions').children;
        for(var i=0;i<rows.length;i++){
            var andSpan=rows[i].querySelector('.cond-and');
            if(i===0&&andSpan)andSpan.remove();
            if(i>0&&!rows[i].querySelector('.cond-and')){var s=document.createElement('span');s.className='cond-and';s.textContent='AND';rows[i].insertBefore(s,rows[i].firstChild)}
        }
        updateVbPreview();
    };

    // Listen to all inputs for live preview
    ['vbTable','vbSelect','vbOrderBy','vbLimit'].forEach(function(id){
        document.getElementById(id).addEventListener('input',updateVbPreview);
    });

    function updateVbPreview(){
        var tbl=document.getElementById('vbTable').value.trim()||'transaction';
        var sel=document.getElementById('vbSelect').value.trim()||'id';
        var orderBy=document.getElementById('vbOrderBy').value.trim();
        var limit=parseInt(document.getElementById('vbLimit').value,10)||200;

        var where=buildWhere();
        var sql='SELECT '+sel+'\\nFROM '+tbl;
        if(where)sql+='\\nWHERE '+where;
        if(orderBy)sql+='\\nORDER BY '+orderBy;
        sql+='\\nFETCH FIRST '+limit+' ROWS ONLY';
        document.getElementById('vbPreview').textContent=sql;
    }
    window.updateVbPreview=updateVbPreview;

    function buildWhere(){
        var parts=[];
        var rows=document.getElementById('vbConditions').children;
        for(var i=0;i<rows.length;i++){
            var field=rows[i].querySelector('.c-field').value.trim();
            var op=rows[i].querySelector('.c-op').value;
            var val=rows[i].querySelector('.c-val').value.trim();
            if(!field)continue;
            if(op==='IS NULL'||op==='IS NOT NULL'){parts.push(field+' '+op)}
            else if(op==='IN'||op==='NOT IN'){parts.push(field+' '+op+' ('+val+')')}
            else if(op==='LIKE'||op==='NOT LIKE'){parts.push(field+" "+op+" '"+val+"'")}
            else{
                // auto-detect: number vs string
                if(val===''||val==='?')parts.push(field+' '+op+' ?');
                else if(!isNaN(val))parts.push(field+' '+op+' '+val);
                else parts.push(field+" "+op+" '"+val+"'");
            }
        }
        return parts.join(' AND ');
    }

    function getSQL(){
        if(activeTab==='sql'){
            return document.getElementById('sqlEditor').value.trim();
        }
        // Visual → build SQL
        var tbl=document.getElementById('vbTable').value.trim()||'transaction';
        var sel=document.getElementById('vbSelect').value.trim()||'id';
        var orderBy=document.getElementById('vbOrderBy').value.trim();
        var limit=parseInt(document.getElementById('vbLimit').value,10)||200;
        var where=buildWhere();
        var sql='SELECT '+sel+' FROM '+tbl;
        if(where)sql+=' WHERE '+where;
        if(orderBy)sql+=' ORDER BY '+orderBy;
        sql+=' FETCH FIRST '+limit+' ROWS ONLY';
        return sql;
    }

    // ─── Run Query ───
    window.runQuery=function(){
        var sql=getSQL();
        if(!sql){showMsg('qrMsg','กรุณาใส่ SQL query','msg-err');return}
        showMsg('qrMsg','<span class="spinner"></span> Running query...','msg-info');
        document.getElementById('runIcon').textContent='⏳';

        var xhr=new XMLHttpRequest();
        xhr.open('GET',BASE+'&action=runquery&sql='+encodeURIComponent(sql),true);
        xhr.timeout=60000;
        xhr.onload=function(){
            document.getElementById('runIcon').textContent='▶';
            try{
                var r=JSON.parse(xhr.responseText);
                if(r.error){showMsg('qrMsg','❌ '+r.error,'msg-err');return}
                queryColumns=r.columns||[];
                queryResults=r.rows||[];
                selectedIds={};
                showMsg('qrMsg','✅ พบ '+queryResults.length+' records','msg-ok');
                renderResults();
                document.getElementById('qrWrap').style.display='block';
                document.getElementById('updateSection').style.display=queryResults.length>0?'block':'none';
                // Auto-sync Record Type from Visual Builder to Update Config
                var vbRT=document.getElementById('vbRecType').value;
                if(vbRT)document.getElementById('ucRecType').value=vbRT;
            }catch(e){showMsg('qrMsg','❌ Parse error: '+e.message,'msg-err')}
        };
        xhr.onerror=function(){document.getElementById('runIcon').textContent='▶';showMsg('qrMsg','❌ Network error','msg-err')};
        xhr.ontimeout=function(){document.getElementById('runIcon').textContent='▶';showMsg('qrMsg','❌ Timeout (60s)','msg-err')};
        xhr.send();
    };

    function renderResults(){
        var t=document.getElementById('qrTable');
        var h='<thead><tr><th><input type="checkbox" id="chkAll" onchange="toggleAll(this.checked)"/></th>';
        queryColumns.forEach(function(c){h+='<th>'+he(c)+'</th>'});
        h+='</tr></thead><tbody>';
        queryResults.forEach(function(row,i){
            var rid=String(row.id||row.ID||row.Id||'');
            h+='<tr id="qrow_'+i+'" style="cursor:pointer">';
            h+='<td><input type="checkbox" id="chk_'+i+'" data-rid="'+he(rid)+'" onchange="toggleChk('+i+')"/></td>';
            queryColumns.forEach(function(c){h+='<td onclick="clickRow('+i+')">'+he(String(row[c]!=null?row[c]:''))+'</td>'});
            h+='</tr>';
        });
        h+='</tbody>';t.innerHTML=h;
        updateCount();
    }

    // Click on row cell (not checkbox) → toggle checkbox
    window.clickRow=function(i){
        var chk=document.getElementById('chk_'+i);
        chk.checked=!chk.checked;
        toggleChk(i);
    };

    // Checkbox onchange
    window.toggleChk=function(i){
        var chk=document.getElementById('chk_'+i);
        var rid=chk.getAttribute('data-rid');
        if(chk.checked)selectedIds[rid]=true;else delete selectedIds[rid];
        document.getElementById('qrow_'+i).classList.toggle('selected',chk.checked);
        updateCount();
    };

    window.toggleAll=function(checked){
        queryResults.forEach(function(row,i){
            var chk=document.getElementById('chk_'+i);
            var rid=chk.getAttribute('data-rid');
            chk.checked=checked;
            if(checked)selectedIds[rid]=true;else delete selectedIds[rid];
            document.getElementById('qrow_'+i).classList.toggle('selected',checked);
        });
        updateCount();
    };

    window.selectAll=function(){document.getElementById('chkAll').checked=true;toggleAll(true)};
    window.deselectAll=function(){document.getElementById('chkAll').checked=false;toggleAll(false)};

    function updateCount(){
        var n=Object.keys(selectedIds).length;
        document.getElementById('qrCount').textContent=n+' of '+queryResults.length+' selected';
    }

    // ─── Update Fields Config ───
    var ufId=0;
    window.addUpdateField=function(type){
        ufId++;var cid=type==='body'?'ucBodyFields':'ucLineFields';
        var div=document.getElementById(cid);
        var row=document.createElement('div');row.className='uc-row';row.id='uf_'+ufId;
        row.innerHTML=
            '<input type="text" class="uf-field" placeholder="NS Field ID (e.g. custbody_xxx)"/>'+
            '<span class="arrow">→</span>'+
            '<input type="text" class="uf-value" placeholder="Value"/>'+
            '<button type="button" class="btn-sm btn-del" onclick="this.parentElement.remove()">✕</button>';
        div.appendChild(row);
    };

    // ─── Inventory Detail ───
    var invRowId=0;
    window.toggleInvDetail=function(){
        var en=document.getElementById('ucInvDetailEnabled').checked;
        document.getElementById('ucInvDetailConfig').style.display=en?'block':'none';
        if(en&&document.getElementById('ucInvDetailRows').children.length===0)addInvDetailRow();
    };
    window.addInvDetailRow=function(){
        invRowId++;
        var div=document.getElementById('ucInvDetailRows');
        var row=document.createElement('div');row.className='inv-row';row.id='inv_'+invRowId;
        row.innerHTML=
            '<select class="inv-type"><option value="serial">Serial#</option><option value="lot">Lot#</option></select>'+
            '<input type="text" class="inv-number" placeholder="Number"/>'+
            '<input type="text" class="inv-qty" placeholder="Qty" style="width:70px"/>'+
            '<input type="text" class="inv-location" placeholder="Location ID" style="width:90px"/>'+
            '<button type="button" class="btn-sm btn-del" onclick="this.parentElement.remove()">✕</button>';
        div.appendChild(row);
    };

    // ─── Custom Process: AJAX save → redirect (bypass NS form submit entirely) ───
    window.processQuery=function(){
        var ids=Object.keys(selectedIds).filter(function(id){return id&&id!=='undefined'&&id!=='null'});
        if(!ids.length){showMsg('ucValMsg','⚠️ ยังไม่ได้เลือก record','msg-err');return}

        var recType=document.getElementById('ucRecType').value;
        var sublistId=document.getElementById('ucSublist').value.trim()||'item';
        var threads=parseInt(document.getElementById('ucThreads').value,10)||5;
        if(!recType){showMsg('ucValMsg','⚠️ เลือก Record Type','msg-err');return}

        var bodyFields={},lineFields={};
        document.querySelectorAll('#ucBodyFields .uc-row').forEach(function(row){
            var f=row.querySelector('.uf-field').value.trim();
            var v=row.querySelector('.uf-value').value.trim();
            if(f)bodyFields[f]=v;
        });
        document.querySelectorAll('#ucLineFields .uc-row').forEach(function(row){
            var f=row.querySelector('.uf-field').value.trim();
            var v=row.querySelector('.uf-value').value.trim();
            if(f)lineFields[f]=v;
        });

        // Collect inventory detail config
        var invDetail=null;
        if(document.getElementById('ucInvDetailEnabled').checked){
            var invRows=[];
            document.querySelectorAll('#ucInvDetailRows .inv-row').forEach(function(row){
                var type=row.querySelector('.inv-type').value;
                var num=row.querySelector('.inv-number').value.trim();
                var qty=row.querySelector('.inv-qty').value.trim();
                var loc=row.querySelector('.inv-location').value.trim();
                if(num)invRows.push({type:type,number:num,quantity:qty||'1',location:loc});
            });
            if(invRows.length)invDetail=invRows;
        }

        if(!Object.keys(bodyFields).length&&!Object.keys(lineFields).length&&!invDetail){showMsg('ucValMsg','⚠️ ระบุ field อย่างน้อย 1 ตัว','msg-err');return}

        var items=ids.map(function(id){return{id:id,bodyFields:bodyFields,lineFields:lineFields,lineIds:[],invDetail:invDetail}});
        var data={recType:recType,sublistId:sublistId,threads:threads,items:items,
            bodyMap:Object.keys(bodyFields).map(function(f){return{nsField:f}}),
            lineMap:Object.keys(lineFields).map(function(f){return{nsField:f}}),
            invDetail:!!invDetail};

        showMsg('ucValMsg','<span class="spinner"></span> Saving data...','msg-info');

        var dataStr=JSON.stringify(data);
        var xhr=new XMLHttpRequest();
        xhr.open('POST',BASE+'&action=savequery',false);
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
        xhr.send('data='+encodeURIComponent(dataStr));
        try{
            var resp=JSON.parse(xhr.responseText);
            if(resp.error){showMsg('ucValMsg','❌ Save error: '+resp.error,'msg-err');return}
            window.location.href=BASE+'&action=queryprocess&fileId='+resp.fileId;
        }catch(e){
            showMsg('ucValMsg','❌ Error: '+e.message,'msg-err');
        }
    };

    function showMsg(id,html,cls){var el=document.getElementById(id);el.style.display='block';el.className='status-msg '+cls;el.innerHTML=html}
    function he(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML}

    // Init: add one condition row
    addCondition();
    updateVbPreview();
})();
</script>`;
    }

    /* ══════════════════════════════════════════════════════
     *  AJAX — Run SuiteQL Query
     * ══════════════════════════════════════════════════════ */
    function ajaxRunQuery(context) {
        const sql = context.request.parameters.sql || '';
        const result = { columns: [], rows: [], error: '' };

        try {
            if (!sql.trim()) throw new Error('Empty SQL');

            // Security: block dangerous statements
            const upper = sql.toUpperCase().trim();
            if (/^\s*(UPDATE|DELETE|INSERT|DROP|ALTER|CREATE|MERGE)\s/i.test(upper)) {
                throw new Error('Only SELECT statements are allowed');
            }

            const mapped = query.runSuiteQL({ query: sql }).asMappedResults();
            result.rows = mapped.slice(0, 5000); // safety cap

            // Get column names from first result row (reliable across all NS versions)
            if (mapped.length > 0) {
                result.columns = Object.keys(mapped[0]);
            }

            log.audit('ajaxRunQuery', 'SQL returned ' + result.rows.length + ' rows');
        } catch (e) {
            result.error = e.message;
            log.error('ajaxRunQuery', { sql: sql.substring(0, 200), error: e.message });
        }

        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        context.response.write(JSON.stringify(result));
    }

    /* ══════════════════════════════════════════════════════
     *  POST ?action=savequery — Save query data to File Cabinet
     * ══════════════════════════════════════════════════════ */
    function ajaxSaveQuery(context) {
        const result = { fileId: 0, error: '' };
        try {
            const dataStr = context.request.parameters.data || '';
            if (!dataStr) throw new Error('Empty data');

            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const f = file.create({
                name: 'batch_query_data_' + ts + '.json',
                fileType: file.Type.JSON,
                contents: dataStr,
                folder: FILE_FOLDER,
                isOnline: true
            });
            result.fileId = f.save();
            log.audit('ajaxSaveQuery', 'Saved query data → file #' + result.fileId + ' (' + dataStr.length + ' chars)');
        } catch (e) {
            result.error = e.message;
            log.error('ajaxSaveQuery', e.message);
        }
        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        context.response.write(JSON.stringify(result));
    }

    /* ══════════════════════════════════════════════════════
     *  POST step=queryprocess — Query Mode → Progress
     * ══════════════════════════════════════════════════════ */
    function processQueryMode(context) {
        const req = context.request;
        const queryFileId = req.parameters.fileId || '';
        log.audit('processQueryMode', 'File ID: ' + queryFileId);

        let data;
        try {
            const f = file.load({ id: parseInt(queryFileId, 10) });
            data = JSON.parse(f.getContents());
            try { file.delete({ id: parseInt(queryFileId, 10) }); } catch (_) {}
        } catch (e) {
            log.error('processQueryMode', 'Failed to load file #' + queryFileId + ': ' + e.message);
            data = {};
        }

        const recType = data.recType || '';
        const sublistId = data.sublistId || 'item';
        const threads = Math.min(Math.max(data.threads || 5, 1), 10);
        const items = data.items || [];
        const bodyMap = data.bodyMap || [];
        const lineMap = data.lineMap || [];

        if (!recType) { renderError(context, 'Missing record type'); return; }
        if (!items.length) { renderError(context, 'ไม่ได้เลือก record'); return; }

        log.audit('processQueryMode', 'Processing ' + items.length + ' records | type=' + recType);

        const config = { recType, sublistId, lineIdField: '', bodyMap, lineMap, threads };
        renderProgressPage(context, items, config);
    }

    /* ══════════════════════════════════════════════════════
     *  CSV MODE — Step 3: Process (from CSV mapping)
     * ══════════════════════════════════════════════════════ */
    function processCsvMode(context) {
        const req = context.request;
        const recType = req.parameters.custpage_rectype2 || '';
        const sublistId = req.parameters.custpage_sublist2 || 'item';
        const csvFileId = req.parameters.custpage_csv_file_id || '';

        let csvData, mapping;
        try {
            const f = file.load({ id: parseInt(csvFileId, 10) });
            csvData = JSON.parse(f.getContents());
            try { file.delete({ id: parseInt(csvFileId, 10) }); } catch (_) {}
        } catch (e) {
            log.error('processCsvMode', 'Failed to load file #' + csvFileId + ': ' + e.message);
            csvData = {};
        }
        try { mapping = JSON.parse(req.parameters.custpage_mapping_json || '{}'); } catch (_) { mapping = {}; }

        const headers = csvData.headers || [];
        const rows = csvData.rows || [];
        const idCol = mapping.idCol || '';
        const lidCol = mapping.lidCol || '';
        const bodyMap = mapping.bodyMap || [];
        const lineMap = mapping.lineMap || [];
        const threads = Math.min(Math.max(mapping.threads || 5, 1), 10);

        if (!recType) { renderError(context, 'Missing transaction type'); return; }
        if (!idCol) { renderError(context, 'ไม่ได้เลือก Record ID column'); return; }

        const idIdx = headers.indexOf(idCol);
        if (idIdx === -1) { renderError(context, 'ID column not found'); return; }
        const lidIdx = lidCol ? headers.indexOf(lidCol) : -1;

        const bodyResolved = [];
        for (const m of bodyMap) { const ci = headers.indexOf(m.csvCol); if (ci >= 0) bodyResolved.push({ colIdx: ci, nsField: m.nsField, csvCol: m.csvCol }); }
        const lineResolved = [];
        for (const m of lineMap) { const ci = headers.indexOf(m.csvCol); if (ci >= 0) lineResolved.push({ colIdx: ci, nsField: m.nsField, csvCol: m.csvCol }); }

        const grouped = {};
        rows.forEach(cols => {
            const recId = (cols[idIdx] || '').trim();
            if (!recId || isNaN(parseInt(recId, 10))) return;
            if (!grouped[recId]) {
                grouped[recId] = { id: recId, bodyFields: {}, lineFields: {}, lineIds: [] };
                bodyResolved.forEach(m => { grouped[recId].bodyFields[m.nsField] = (cols[m.colIdx] || '').trim(); });
                lineResolved.forEach(m => { grouped[recId].lineFields[m.nsField] = (cols[m.colIdx] || '').trim(); });
            }
            if (lidIdx >= 0) {
                const lid = (cols[lidIdx] || '').trim();
                if (lid && grouped[recId].lineIds.indexOf(lid) === -1) grouped[recId].lineIds.push(lid);
            }
        });

        const items = Object.values(grouped);
        if (!items.length) { renderError(context, 'ไม่พบ record ที่ต้อง update'); return; }

        const config = {
            recType, sublistId, lineIdField: lidCol || '',
            bodyMap: bodyResolved.map(m => ({ csvCol: m.csvCol, nsField: m.nsField })),
            lineMap: lineResolved.map(m => ({ csvCol: m.csvCol, nsField: m.nsField })),
            threads
        };
        renderProgressPage(context, items, config);
    }

    /* ══════════════════════════════════════════════════════
     *  AJAX Endpoint — Update 1 Record
     * ══════════════════════════════════════════════════════ */
    function ajaxUpdate(context) {
        const p = context.request.parameters;
        const recType = p.recType || '';
        const recId = parseInt(p.id, 10);
        const sublistId = p.sublistId || 'item';

        let bodyFields = {}, lineFields = {}, invDetail = null;
        try { bodyFields = JSON.parse(p.bodyFields || '{}'); } catch (_) {}
        try { lineFields = JSON.parse(p.lineFields || '{}'); } catch (_) {}
        try { invDetail = JSON.parse(p.invDetail || 'null'); } catch (_) {}

        const lineIdField = p.lineIdField || '';
        const lineIdValues = p.lineIdValues || '';
        const result = { recId, status: 'ok', lines: 0, invLines: 0, error: '' };

        try {
            if (!recId || !recType) throw new Error('Missing recType or id');

            // Inventory Detail subrecord editing REQUIRES dynamic mode.
            // For plain line-field updates (no amount changes), standard mode is used:
            //   - avoids per-line commitLine re-validation
            //   - fixes Journal Entry "Transaction was not complete." (dynamic commitLine
            //     re-checks debit/credit balance on every line commit and breaks the txn)
            //   - balance is validated once at save() and stays intact (amounts untouched)
            const hasInvDetail = !!(invDetail && Array.isArray(invDetail) && invDetail.length > 0);
            const useDynamic = hasInvDetail;
            const rec = record.load({ type: recType, id: recId, isDynamic: useDynamic });

            Object.keys(bodyFields).forEach(fid => {
                const v = bodyFields[fid];
                if (v === '' || v == null) return;
                const n = Number(v);
                rec.setValue({ fieldId: fid, value: isNaN(n) ? v : n });
            });

            const lineKeys = Object.keys(lineFields);
            if (lineKeys.length > 0) {
                const cnt = rec.getLineCount({ sublistId });
                const targets = lineIdValues ? lineIdValues.split(',').map(s => s.trim()) : null;

                // Candidate fields to match "Line ID" against. The chosen lineIdField is
                // tried first, then common line-identifier fields, because a CSV "Line ID"
                // exported from SuiteQL is usually transactionline.id / uniquekey, which does
                // NOT equal the SuiteScript 'line' (sequence) value.
                const matchFields = [];
                [lineIdField, 'lineuniquekey', 'line', 'id'].forEach(f => {
                    if (f && matchFields.indexOf(f) === -1) matchFields.push(f);
                });
                const diagSamples = [];  // for the "no match" diagnostic

                for (let i = 0; i < cnt; i++) {
                    if (targets && lineIdField) {
                        let matched = false;
                        const rowVals = {};
                        for (let mf = 0; mf < matchFields.length; mf++) {
                            let cv;
                            try { cv = rec.getSublistValue({ sublistId, fieldId: matchFields[mf], line: i }); }
                            catch (_ignore) { continue; }
                            if (cv === '' || cv == null) continue;
                            rowVals[matchFields[mf]] = String(cv);
                            if (targets.indexOf(String(cv)) !== -1) { matched = true; break; }
                        }
                        // Final fallback: 0-based line index (client "Line ID" is often the array position 0,1,2...)
                        if (!matched && targets.indexOf(String(i)) !== -1) { matched = true; }
                        rowVals['_index'] = String(i);
                        if (diagSamples.length < 8) diagSamples.push(rowVals);
                        if (!matched) continue;
                    }

                    if (useDynamic) {
                        // ─── DYNAMIC MODE (only when Inventory Detail is involved) ───
                        rec.selectLine({ sublistId, line: i });
                        lineKeys.forEach(fid => {
                            const v = lineFields[fid];
                            if (v === '' || v == null) return;
                            const n = Number(v);
                            rec.setCurrentSublistValue({ sublistId, fieldId: fid, value: isNaN(n) ? v : n });
                        });

                        // ─── Inventory Detail Subrecord ───
                        try {
                            const invRec = rec.getCurrentSublistSubrecord({ sublistId, fieldId: 'inventorydetail' });
                            if (invRec) {
                                // Remove existing assignment lines (reverse loop)
                                const existCount = invRec.getLineCount({ sublistId: 'inventoryassignment' });
                                for (let x = existCount - 1; x >= 0; x--) {
                                    invRec.removeLine({ sublistId: 'inventoryassignment', line: x });
                                }
                                // Add new detail lines
                                invDetail.forEach(det => {
                                    invRec.selectNewLine({ sublistId: 'inventoryassignment' });
                                    if (det.type === 'serial') {
                                        invRec.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'receiptinventorynumber', value: det.number });
                                    } else {
                                        // lot number
                                        invRec.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'receiptinventorynumber', value: det.number });
                                    }
                                    const qty = parseFloat(det.quantity) || 1;
                                    invRec.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: qty });
                                    if (det.location) {
                                        invRec.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: parseInt(det.location, 10) });
                                    }
                                    invRec.commitLine({ sublistId: 'inventoryassignment' });
                                    result.invLines++;
                                });
                            }
                        } catch (invErr) {
                            log.debug('ajaxUpdate invDetail', 'Line ' + i + ': ' + invErr.message);
                        }

                        rec.commitLine({ sublistId });
                    } else {
                        // ─── STANDARD MODE (default) — set by line index, no commitLine ───
                        lineKeys.forEach(fid => {
                            const v = lineFields[fid];
                            if (v === '' || v == null) return;
                            const n = Number(v);
                            rec.setSublistValue({ sublistId, fieldId: fid, line: i, value: isNaN(n) ? v : n });
                        });
                    }

                    result.lines++;
                }

                // Guard against silent "success" when a Line ID match found nothing.
                if (targets && lineIdField && result.lines === 0) {
                    const seen = {};
                    diagSamples.forEach(rv => {
                        Object.keys(rv).forEach(k => {
                            seen[k] = seen[k] || [];
                            if (seen[k].length < 8 && seen[k].indexOf(rv[k]) === -1) seen[k].push(rv[k]);
                        });
                    });
                    const avail = Object.keys(seen).map(k => k + '=[' + seen[k].join(',') + ']').join('  ');
                    throw new Error('No line matched Line ID (' + targets.join(',') + '). '
                        + 'Available on this record: ' + (avail || '(none)')
                        + '. ตรวจว่า Line ID ใน CSV ตรงกับ field ไหน แล้วเลือก match field ให้ถูก.');
                }
            }

            rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
            log.debug('ajaxUpdate OK', recType + '#' + recId + ' lines:' + result.lines + ' inv:' + result.invLines);
        } catch (e) {
            result.status = 'error';
            result.error = (e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e.message || String(e));
            log.error('ajaxUpdate Error', { recType, recId, name: e.name, message: e.message });
        }

        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        context.response.write(JSON.stringify(result));
    }

    /* ══════════════════════════════════════════════════════
     *  SHARED — Progress Page (AJAX + Disconnect/Resume)
     * ══════════════════════════════════════════════════════ */
    function renderProgressPage(context, items, config) {
        const recTypeLabel = (RECORD_TYPES.find(t => t.value === config.recType) || {}).label || config.recType;
        const form = serverWidget.createForm({ title: 'Batch Update ' + recTypeLabel + ' — Processing' });

        const baseUrl = getBaseUrl() + '&action=update';
        const backUrl = getBaseUrl();
        const total = items.length;

        let mapSummary = '<b>Type:</b> ' + esc(recTypeLabel) + ' | <b>Records:</b> ' + total;
        if (config.bodyMap.length) mapSummary += '<br/><b>Body:</b> ' + config.bodyMap.map(m => (m.csvCol ? m.csvCol + ' → ' : '') + m.nsField).join(', ');
        if (config.lineMap.length) mapSummary += '<br/><b>Line (' + esc(config.sublistId) + '):</b> ' + config.lineMap.map(m => (m.csvCol ? m.csvCol + ' → ' : '') + m.nsField).join(', ');
        if (config.lineIdField) mapSummary += ' (match: ' + esc(config.lineIdField) + ')';

        const html = `
<style>
.w{font-family:Arial,sans-serif;max-width:1200px;margin:10px auto}
.cards{display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.cd{flex:1;min-width:130px;padding:18px;border-radius:10px;text-align:center;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.cd h2{margin:0;font-size:28px}.cd p{margin:4px 0 0;font-size:11px;opacity:.9}
.bg-t{background:linear-gradient(135deg,#606c88,#3f4c6b)}
.bg-p{background:linear-gradient(135deg,#667eea,#764ba2)}
.bg-g{background:linear-gradient(135deg,#11998e,#38ef7d)}
.bg-r{background:linear-gradient(135deg,#eb3349,#f45c43)}
.bg-s{background:linear-gradient(135deg,#f093fb,#f5576c)}
.bar-w{background:#e9ecef;border-radius:8px;height:32px;margin-bottom:18px;overflow:hidden}
.bar{height:100%;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:14px;transition:width .4s ease;min-width:40px}
.bar.run{background:linear-gradient(90deg,#667eea,#764ba2)}
.bar.ok{background:linear-gradient(90deg,#11998e,#38ef7d)}
.bar.mix{background:linear-gradient(90deg,#f5af19,#f12711)}
.bar.pause{background:linear-gradient(90deg,#fbbf24,#f59e0b)}
.st{padding:12px 18px;border-radius:8px;margin-bottom:14px;font-size:14px;font-weight:bold}
.st-run{background:#fff3cd;color:#856404}
.st-ok{background:#d1fae5;color:#065f46}
.st-err{background:#fee2e2;color:#991b1b}
.st-disc{background:#fef3c7;color:#92400e;border:2px solid #f59e0b}
.map-info{background:#f0f6ff;border:1px solid #b3d4fc;border-radius:8px;padding:12px 16px;margin-bottom:14px;font-size:12px;color:#1e40af}
.lg{background:#1e1e2e;color:#a6e3a1;border-radius:8px;padding:14px;font-family:monospace;font-size:12px;max-height:350px;overflow-y:auto;white-space:pre-wrap}
.l-ok{color:#a6e3a1}.l-er{color:#f38ba8}.l-in{color:#89b4fa}.l-wn{color:#fab387}
.tb{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
.tb th{background:#1a56db;color:#fff;padding:8px;text-align:left;position:sticky;top:0}
.tb td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
.tb tr:hover td{background:#f0f6ff}
.sok{color:#059669;font-weight:bold}.ser{color:#dc2626;font-weight:bold}
.btn-r{display:inline-block;padding:12px 28px;font-size:15px;border:none;border-radius:8px;background:#f59e0b;color:#fff;cursor:pointer;font-weight:bold;margin:4px 6px;box-shadow:0 2px 8px rgba(245,158,11,.4)}
.btn-r:hover{background:#d97706}
.btn-b{padding:10px 28px;font-size:14px;border:none;border-radius:6px;background:#1a56db;color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.pul{animation:pulse 1.5s infinite}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}.shake{animation:shake .4s ease 3}
</style>
<div class="w">
    <div class="map-info">${mapSummary}</div>
    <div id="banner" class="st st-run pul">🔄 Starting... 0 / ${total}</div>
    <div id="discAlert" style="display:none" class="st st-disc shake">⚠️ <span id="discMsg">Connection lost!</span> <button type="button" class="btn-r" onclick="resumeWork()">🔄 Resume</button></div>
    <div class="cards">
        <div class="cd bg-t"><h2 id="cT">${total}</h2><p>Total</p></div>
        <div class="cd bg-p"><h2 id="cP">0</h2><p>Processed</p></div>
        <div class="cd bg-g"><h2 id="cO">0</h2><p>✅ Success</p></div>
        <div class="cd bg-r"><h2 id="cE">0</h2><p>❌ Error</p></div>
        <div class="cd bg-s"><h2 id="cS">0</h2><p>⏭ Skipped</p></div>
    </div>
    <div class="bar-w"><div id="bar" class="bar run" style="width:2%">0%</div></div>
    <div id="log" class="lg"><span class="l-in">[start] Update ${total} records (${config.threads} threads)</span></div>
    <div id="resTbl" style="display:none"></div>
    <div id="doneArea" style="display:none;margin-top:18px;text-align:center;"><a href="${backUrl}" class="btn-b">⬅ Back</a></div>
</div>
<script>
(function(){
    var BASE='${baseUrl}',DATA=${JSON.stringify(items)},CFG=${JSON.stringify(config)};
    var total=DATA.length,done=0,ok=0,err=0,skipped=0;
    var successList=[],errorList=[],doneIds={};
    var THREADS=CFG.threads||5,cursor=0,running=0,paused=false,finished=false;
    var conFails=0,MAX_CF=3;
    function ts(){return new Date().toLocaleTimeString()}
    function addLog(m,c){var el=document.getElementById('log');el.innerHTML+='\\n<span class="'+(c||'l-in')+'">['+ts()+'] '+m+'</span>';el.scrollTop=el.scrollHeight}
    function upd(){document.getElementById('cP').textContent=done;document.getElementById('cO').textContent=ok;document.getElementById('cE').textContent=err;document.getElementById('cS').textContent=skipped;var pct=total>0?Math.round((done/total)*100):0;var bar=document.getElementById('bar');bar.style.width=Math.max(pct,2)+'%';bar.textContent=pct+'%';if(!paused&&!finished)document.getElementById('banner').textContent='🔄 Processing... '+done+' / '+total}
    function showDisc(r){paused=true;document.getElementById('bar').className='bar pause';document.getElementById('banner').textContent='⏸ Paused — '+done+'/'+total;document.getElementById('banner').className='st st-disc';var da=document.getElementById('discAlert');da.style.display='block';da.className='st st-disc shake';document.getElementById('discMsg').textContent=r;addLog('⚠️ PAUSED: '+r,'l-wn')}
    window.addEventListener('offline',function(){showDisc('เน็ตหลุด!')});
    window.addEventListener('online',function(){if(paused){addLog('🌐 Network back — กด Resume','l-in');document.getElementById('discMsg').textContent='🌐 เน็ตกลับมาแล้ว — กด Resume'}});
    window.resumeWork=function(){if(finished)return;paused=false;conFails=0;document.getElementById('discAlert').style.display='none';document.getElementById('banner').className='st st-run pul';document.getElementById('bar').className='bar run';addLog('🔄 Resuming...','l-in');var s=Math.min(THREADS-running,total-cursor);for(var i=0;i<s;i++)fireOne()};
    function finish(){if(finished)return;finished=true;var bar=document.getElementById('bar');bar.style.width='100%';bar.textContent='100%';var bn=document.getElementById('banner');bn.className='st '+(err>0?'st-err':'st-ok');bn.textContent=err>0?'⚠️ Done — OK:'+ok+' ERR:'+err:'✅ Complete! '+ok+' records updated!';bar.className='bar '+(err>0?'mix':'ok');addLog('🏁 Done! OK:'+ok+' ERR:'+err+' SKIP:'+skipped,err>0?'l-er':'l-ok');document.getElementById('discAlert').style.display='none';document.getElementById('doneArea').style.display='block';renderTables()}
    function renderTables(){var h='';if(successList.length){h+='<div style="margin-top:20px"><h3 style="color:#059669">✅ Updated ('+successList.length+')</h3><div style="max-height:350px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px"><table class="tb"><thead><tr><th>#</th><th>ID</th><th>Body</th><th>Lines</th></tr></thead><tbody>';successList.forEach(function(r,i){h+='<tr><td>'+(i+1)+'</td><td>'+r.recId+'</td><td>'+he(r.bd)+'</td><td>'+r.lines+'</td></tr>'});h+='</tbody></table></div></div>'}if(errorList.length){h+='<div style="margin-top:20px"><h3 style="color:#dc2626">❌ Errors ('+errorList.length+')</h3><div style="max-height:300px;overflow:auto;border:1px solid #fca5a5;border-radius:8px"><table class="tb"><thead><tr><th style="background:#dc2626">#</th><th style="background:#dc2626">ID</th><th style="background:#dc2626">Error</th></tr></thead><tbody>';errorList.forEach(function(r,i){h+='<tr><td>'+(i+1)+'</td><td>'+r.recId+'</td><td class="ser">'+he(r.error)+'</td></tr>'});h+='</tbody></table></div></div>'}document.getElementById('resTbl').innerHTML=h;document.getElementById('resTbl').style.display='block'}
    function he(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
    function fireOne(){
        if(paused||finished)return;if(cursor>=total){if(running===0)finish();return}
        var idx=cursor++;var item=DATA[idx];if(doneIds[item.id]){done++;skipped++;upd();fireOne();return}
        var u=BASE+'&recType='+encodeURIComponent(CFG.recType)+'&sublistId='+encodeURIComponent(CFG.sublistId)+'&id='+encodeURIComponent(item.id)+'&bodyFields='+encodeURIComponent(JSON.stringify(item.bodyFields||{}))+'&lineFields='+encodeURIComponent(JSON.stringify(item.lineFields||{}))+'&lineIdField='+encodeURIComponent(CFG.lineIdField||'')+'&lineIdValues='+encodeURIComponent((item.lineIds||[]).join(','))+'&invDetail='+encodeURIComponent(JSON.stringify(item.invDetail||null));
        running++;var xhr=new XMLHttpRequest();xhr.open('GET',u,true);xhr.timeout=30000;
        xhr.onload=function(){running--;conFails=0;done++;try{var r=JSON.parse(xhr.responseText);if(r.status==='ok'){ok++;doneIds[item.id]=true;var bd=Object.entries(item.bodyFields||{}).map(function(e){return e[0]+'='+e[1]}).join(', ');successList.push({recId:r.recId,bd:bd,lines:r.lines});addLog('✅ #'+r.recId+' ('+r.lines+' lines)','l-ok')}else{err++;doneIds[item.id]=true;errorList.push({recId:item.id,error:r.error});addLog('❌ #'+item.id+': '+r.error,'l-er')}}catch(e){err++;doneIds[item.id]=true;errorList.push({recId:item.id,error:'Parse error'});addLog('❌ #'+item.id+': parse error','l-er')}upd();fireOne()};
        xhr.onerror=function(){running--;conFails++;cursor=idx;if(conFails>=MAX_CF||!navigator.onLine){showDisc('Network error x'+conFails)}else{addLog('⚠️ #'+item.id+' retry','l-wn');setTimeout(fireOne,2000)}};
        xhr.ontimeout=function(){running--;conFails++;cursor=idx;if(conFails>=MAX_CF){showDisc('Timeout x'+conFails)}else{addLog('⏱ timeout retry','l-wn');setTimeout(fireOne,2000)}};
        xhr.send();
    }
    addLog('🚀 Starting '+THREADS+' threads...','l-in');for(var t=0;t<THREADS;t++)fireOne();
})();
</script>`;
        form.addField({ id: 'custpage_progress', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue = html;
        context.response.writePage(form);
    }

    /* ══════════════════════════════════════════════════════
     *  CSV Parser
     * ══════════════════════════════════════════════════════ */
    function parseCSVFull(contents) {
        const lines = contents.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 1) return { headers: [], rows: [] };
        const headers = splitCSVLine(lines[0]).map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = splitCSVLine(lines[i]);
            if (cols.some(c => c.trim())) rows.push(cols.map(c => c.trim()));
        }
        return { headers, rows };
    }

    function splitCSVLine(line) {
        const r = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
            else { if (c === '"') q = true; else if (c === ',' || c === '\t') { r.push(cur); cur = ''; } else cur += c; }
        }
        r.push(cur);
        return r;
    }

    function renderError(context, msg) {
        const form = serverWidget.createForm({ title: 'Error' });
        form.addField({ id: 'custpage_err', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue =
            '<div style="padding:30px;text-align:center;font-size:16px;color:#dc2626;">❌ ' + esc(msg) + '</div>'
            + '<div style="text-align:center;margin-top:16px;"><button type="button" onclick="history.back()" style="padding:8px 24px;border:none;border-radius:6px;background:#1a56db;color:#fff;cursor:pointer;">⬅ Back</button></div>';
        context.response.writePage(form);
    }

    function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    /* ══════════════════════════════════════════════════════
     *  ENTRY POINT
     * ══════════════════════════════════════════════════════ */
    function onRequest(context) {
        const action = context.request.parameters.action || '';
        if (context.request.method === 'GET') {
            if (action === 'update')    return ajaxUpdate(context);
            if (action === 'runquery')      return ajaxRunQuery(context);
            if (action === 'queryprocess') return processQueryMode(context);
            if (action === 'csvupload')    return renderCsvUpload(context);
            if (action === 'query')        return renderQueryMode(context);
            return renderLanding(context);
        }
        // POST
        if (action === 'savequery')  return ajaxSaveQuery(context);
        const step = context.request.parameters.custpage_step || 'upload';
        if (step === 'process')      return processCsvMode(context);
        if (step === 'queryprocess') return processQueryMode(context);
        return renderCsvMapping(context);
    }

    return { onRequest };
});