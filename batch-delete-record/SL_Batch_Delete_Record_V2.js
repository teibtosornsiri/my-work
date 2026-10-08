/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Batch Delete Records from Saved Search — V2
 * ─────────────────────────────────────────────
 * Rewritten from SuiteScript 1.0 → 2.1
 *
 * Features:
 *   - Modern dashboard UI with real-time progress
 *   - Parallel AJAX deletion using fetch() + concurrency pool
 *   - Live throughput chart (vanilla JS, no Google Charts dependency)
 *   - Select All / Deselect / Filter by status
 *   - Export errors to CSV
 *   - Disconnect detection + resume from last position
 *
 * Steps:
 *   GET (no search)     → Input form: enter Saved Search ID
 *   GET (with search)   → Load search → render INLINEHTML dashboard
 *   GET step=delete     → AJAX endpoint: delete single record, return JSON
 *
 * Deploy:
 *   Script ID:  customscript_sl_batch_delete_v2
 *   Deploy ID:  customdeploy_sl_batch_delete_v2
 *   Status:     Released
 *   Log Level:  Debug
 *   Available Without Login: No
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/record',
    'N/log',
    'N/runtime',
    'N/url',
    'N/file',
    'N/task'
], (serverWidget, search, recordModule, log, runtime, url, file, task) => {

    /* ═══════════════════════════════════════════════
     *  CONSTANTS
     * ═══════════════════════════════════════════════ */
    const MAX_SEARCH_RESULTS = 5000;
    const SEARCH_PAGE_SIZE   = 1000;

    // ── Map/Reduce Config ──
    const MR_SCRIPT_ID   = 'customscript_mr_batch_delete_transaction';
    const MR_DEPLOY_IDS  = [
        'customdeploy_mr_batch_delete_transaction',
        'customdeploy_mr_batch_delete_trans_2',
        'customdeploy_mr_batch_delete_trans_3',
        'customdeploy_mr_batch_delete_trans_4',
        'customdeploy_mr_batch_delete_trans_5'
    ];
    const MR_FILE_FOLDER = 482;

    /* ═══════════════════════════════════════════════
     *  ENTRY POINT
     * ═══════════════════════════════════════════════ */
    const onRequest = (context) => {
        const { request, response } = context;
        const params = request.parameters;
        const step   = params.step || '';

        try {
            if (step === 'delete') {
                handleDelete(params, response);
            } else if (step === 'mrstart') {
                handleMRStart(request, response);
            } else if (step === 'mrstatus') {
                handleMRStatus(params, response);
            } else {
                handlePage(params, response);
            }
        } catch (e) {
            log.error('onRequest', e);
            response.write(JSON.stringify({ success: false, error: e.message }));
        }
    };

    /* ═══════════════════════════════════════════════
     *  STEP: DELETE (AJAX endpoint)
     *  Returns JSON: { success, elapsed, error? }
     * ═══════════════════════════════════════════════ */
    function handleDelete(params, response) {
        const timer      = Date.now();
        const recordId   = params.recordId;
        const recordType = params.recordType;

        response.setHeader({ name: 'Content-Type', value: 'application/json' });

        if (!recordId || !recordType) {
            response.write(JSON.stringify({ success: false, error: 'Missing recordId or recordType', category: 'PARAM' }));
            return;
        }

        try {
            recordModule.delete({ type: recordType, id: Number(recordId) });
            const elapsed = Date.now() - timer;
            log.audit('deleteOK', `${recordType} #${recordId} (${elapsed}ms)`);
            response.write(JSON.stringify({ success: true, elapsed }));
        } catch (e) {
            const elapsed = Date.now() - timer;
            const msg     = e.message || String(e);
            const category = classifyError(msg);
            log.error('deleteFail', `${recordType} #${recordId}: [${category}] ${msg}`);
            response.write(JSON.stringify({
                success:  false,
                error:    msg,
                category: category,
                elapsed:  elapsed
            }));
        }
    }

    /**
     * Classify NetSuite delete errors into broad categories
     * so the UI can group/filter them.
     */
    function classifyError(msg) {
        const m = (msg || '').toLowerCase();
        if (m.includes('permission') || m.includes('not allowed') || m.includes('restrict'))
            return 'PERMISSION';
        if (m.includes('dependent') || m.includes('referenced') || m.includes('linked')
            || m.includes('cannot delete') || m.includes('related'))
            return 'DEPENDENCY';
        if (m.includes('locked') || m.includes('concurrent') || m.includes('in use'))
            return 'LOCKED';
        if (m.includes('not found') || m.includes('does not exist') || m.includes('invalid'))
            return 'NOT_FOUND';
        if (m.includes('governance') || m.includes('usage limit'))
            return 'GOVERNANCE';
        return 'OTHER';
    }

    /* ═══════════════════════════════════════════════
     *  STEP: PAGE (Input form or Dashboard)
     * ═══════════════════════════════════════════════ */
    function handlePage(params, response) {
        const searchId = (params.search || '').trim();
        const mode     = (params.custpage_mode || 'ajax').trim();

        // ── No search ID or numeric ID → show input form ──
        if (!searchId || !isNaN(searchId)) {
            renderInputForm(params, response, searchId);
            return;
        }

        // ── Load saved search & render dashboard ──
        const maxResults = (mode === 'mapreduce') ? 1000 : 5000;
        log.audit('handlePage:beforeLoad', `searchId="${searchId}" mode="${mode}" maxResults=${maxResults}`);

        let records;
        try {
            records = loadSearchResults(searchId, maxResults);
        } catch (e) {
            log.error('handlePage:loadFail', `searchId="${searchId}" → ${e.name}: ${e.message}`);
            renderLoadError(response, searchId, e);
            return;
        }
        log.audit('handlePage', `Search "${searchId}" returned ${records.length} records (mode=${mode})`);

        const suiteletUrl = url.resolveScript({
            scriptId:     runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
            returnExternalUrl: false
        });

        if (mode === 'mapreduce') {
            const html = buildMRConfirmHTML(records, searchId, suiteletUrl);
            response.write(html);
        } else {
            const html = buildDashboardHTML(records, searchId, suiteletUrl, maxResults);
            response.write(html);
        }
    }

    /* ═══════════════════════════════════════════════
     *  LOAD-ERROR PAGE (friendly, instead of raw JSON)
     * ═══════════════════════════════════════════════ */
    function renderLoadError(response, searchId, e) {
        const form = serverWidget.createForm({ title: 'Batch Delete Records — V2' });
        const fld = form.addField({
            id: 'custpage_err', type: serverWidget.FieldType.INLINEHTML, label: ' '
        });
        fld.defaultValue = `
            <div style="max-width:720px;padding:20px;border:1px solid #f85149;border-radius:10px;background:#1c0d0e;font-family:-apple-system,sans-serif;">
                <h2 style="color:#f85149;margin:0 0 12px;">⚠ ไม่สามารถโหลด Saved Search ได้</h2>
                <p style="color:#e7e9ea;margin:0 0 8px;"><b>Search ID ที่ใช้:</b> <code style="background:#21262d;padding:2px 6px;border-radius:4px;">${searchId}</code></p>
                <p style="color:#e7e9ea;margin:0 0 8px;"><b>NetSuite ตอบกลับ:</b> ${e.name} — ${e.message}</p>
                <hr style="border:none;border-top:1px solid #30363d;margin:14px 0;">
                <p style="color:#8b949e;margin:0 0 6px;font-weight:600;">เช็คทีละข้อ:</p>
                <ol style="color:#8b949e;margin:0;padding-left:20px;line-height:1.7;">
                    <li>ใช้ค่าจากช่อง <b>ID</b> ของ search (ไม่ใช่ Title) — ดูที่ Lists → Search → Saved Searches → Edit</li>
                    <li>Saved Search ต้อง <b>Public</b> หรือ audience รวม Role ที่รัน Suitelet นี้</li>
                    <li>เปิด <code>/app/common/search/searchresults.nl?searchid=${searchId}</code> ใน tab ใหม่ — ถ้าเปิดไม่ได้ = ปัญหาที่ตัว search</li>
                </ol>
            </div>`;
        form.addSubmitButton({ label: '← ลองใหม่' });
        response.writePage(form);
    }

    /* ═══════════════════════════════════════════════
     *  INPUT FORM
     * ═══════════════════════════════════════════════ */
    function renderInputForm(params, response, searchId) {
        const form = serverWidget.createForm({ title: 'Batch Delete Records — V2' });
        form.addFieldGroup({ id: 'g_input', label: 'Enter Saved Search' }).isSingleColumn = true;

        const fld = form.addField({
            id: 'search', type: serverWidget.FieldType.TEXT,
            label: 'Saved Search ID (text)', container: 'g_input'
        });
        fld.isMandatory = true;
        if (searchId) fld.defaultValue = searchId;

        // ── Delete Mode ──
        const modeFld = form.addField({
            id: 'custpage_mode', type: serverWidget.FieldType.SELECT,
            label: 'Delete Mode', container: 'g_input'
        });
        modeFld.addSelectOption({ value: 'ajax', text: '⚡ AJAX (Real-time — ลบจากหน้าจอ ดู progress ได้ทันที)' });
        modeFld.addSelectOption({ value: 'mapreduce', text: '🔄 Map/Reduce (Background — เหมาะกับข้อมูลเยอะ 5,000+)' });
        modeFld.defaultValue = params.custpage_mode || 'ajax';

        if (searchId && !isNaN(searchId)) {
            const msg = form.addField({
                id: 'custpage_msg', type: serverWidget.FieldType.INLINEHTML,
                label: ' ', container: 'g_input'
            });
            msg.defaultValue = '<p style="color:#dc3545;font-weight:600;margin-top:8px;">⚠ Search ID must be text (e.g. customsearch_xxx), not a number.</p>';
        }

        form.addSubmitButton({ label: 'Load Search →' });
        response.writePage(form);
    }

    /* ═══════════════════════════════════════════════
     *  LOAD SAVED SEARCH RESULTS
     * ═══════════════════════════════════════════════ */
    function loadSearchResults(searchId, maxResults) {
        const limit = maxResults || MAX_SEARCH_RESULTS;
        const results = [];
        const ss = search.load({ id: searchId });
        const pagedData = ss.runPaged({ pageSize: SEARCH_PAGE_SIZE });

        // Helper: safely read a column value (column may not exist in the search)
        const safeVal = (result, colId) => {
            try { return result.getValue(colId) || ''; }
            catch (e) { return ''; }
        };

        let done = false;
        for (let i = 0; i < pagedData.pageRanges.length && !done; i++) {
            const page = pagedData.fetch({ index: i });
            for (let j = 0; j < page.data.length; j++) {
                if (results.length >= limit) { done = true; break; }
                const result = page.data[j];
                results.push({
                    id:         result.id,
                    recordType: result.recordType,
                    tranid:     safeVal(result, 'tranid') || safeVal(result, 'name'),
                    trandate:   safeVal(result, 'trandate')
                });
            }
        }

        return results;
    }

    /* ═══════════════════════════════════════════════
     *  BUILD DASHBOARD HTML
     * ═══════════════════════════════════════════════ */
    function buildDashboardHTML(records, searchId, deleteBaseUrl, maxResults) {
        const sep      = deleteBaseUrl.includes('?') ? '&' : '?';
        const ajaxBase = `${deleteBaseUrl}${sep}step=delete`;
        const reloadUrl = `${deleteBaseUrl}${sep}search=${encodeURIComponent(searchId)}&custpage_mode=ajax&autostart=1`;
        const recordsJSON = JSON.stringify(records);

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Batch Delete — ${records.length} Records</title>
<style>
/* ── Reset & Base ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    background: #0f1419;
    color: #e7e9ea;
    line-height: 1.5;
    min-height: 100vh;
}
a { color: #1d9bf0; text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Layout ── */
.shell { max-width: 1280px; margin: 0 auto; padding: 20px; }

/* ── Header ── */
.hdr {
    background: linear-gradient(135deg, #1a1f2e 0%, #0d1117 100%);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 24px 28px;
    margin-bottom: 16px;
}
.hdr h1 {
    font-size: 20px; font-weight: 700; color: #f0f6fc;
    display: flex; align-items: center; gap: 10px;
}
.hdr h1 .icon { font-size: 24px; }
.hdr .meta { font-size: 13px; color: #8b949e; margin-top: 6px; }
.hdr .meta b { color: #c9d1d9; }

/* ── Stats Row ── */
.stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
}
.stat-card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 16px;
    text-align: center;
}
.stat-card .num {
    font-size: 28px; font-weight: 700;
    font-variant-numeric: tabular-nums;
}
.stat-card .lbl { font-size: 12px; color: #8b949e; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
.c-total .num { color: #c9d1d9; }
.c-ok .num { color: #3fb950; }
.c-err .num { color: #f85149; }
.c-pend .num { color: #d29922; }
.c-rate .num { color: #58a6ff; }
.c-time .num { color: #bc8cff; font-size: 18px; }

/* ── Progress Bar ── */
.prog-wrap {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
}
.prog-bar-bg {
    height: 8px; background: #21262d; border-radius: 4px; overflow: hidden;
}
.prog-bar-fill {
    height: 100%; background: linear-gradient(90deg, #238636, #3fb950);
    border-radius: 4px; transition: width 0.3s ease; width: 0%;
}
.prog-label { font-size: 12px; color: #8b949e; margin-top: 6px; text-align: right; }

/* ── Toolbar ── */
.toolbar {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    margin-bottom: 12px;
    padding: 12px 16px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
}
.toolbar .sep { width: 1px; height: 24px; background: #30363d; }

/* ── Buttons ── */
.btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 6px;
    font-size: 13px; font-weight: 600;
    border: 1px solid transparent;
    cursor: pointer; transition: all 0.15s;
    font-family: inherit;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger { background: #da3633; color: #fff; border-color: #f85149; }
.btn-danger:hover:not(:disabled) { background: #f85149; }
.btn-ghost { background: transparent; color: #c9d1d9; border-color: #30363d; }
.btn-ghost:hover:not(:disabled) { background: #21262d; border-color: #8b949e; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* ── Concurrency Slider ── */
.slider-group { display: flex; align-items: center; gap: 8px; }
.slider-group label { font-size: 12px; color: #8b949e; white-space: nowrap; }
.slider-group input[type="range"] { width: 80px; accent-color: #58a6ff; }
.slider-group .val { font-size: 13px; font-weight: 700; color: #58a6ff; min-width: 24px; text-align: center; }

/* ── Chart ── */
.chart-wrap {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
    height: 140px;
    position: relative;
}
.chart-wrap canvas { width: 100% !important; height: 100% !important; }

/* ── Table ── */
.tbl-wrap {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    overflow: hidden;
}
.tbl-scroll { max-height: 55vh; overflow-y: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead { position: sticky; top: 0; z-index: 2; }
thead th {
    background: #1c2128;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    color: #8b949e;
    border-bottom: 1px solid #30363d;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
}
tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid #21262d;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
tbody tr:hover { background: #1c2128; }
tbody tr.row-ok { opacity: 0.35; }
tbody tr.row-ok td:nth-child(7) { color: #3fb950; }
tbody tr.row-err td:nth-child(7) { color: #f85149; }
tbody tr.row-running td:nth-child(7) { color: #d29922; }

/* ── Checkbox ── */
input[type="checkbox"] { accent-color: #58a6ff; width: 15px; height: 15px; cursor: pointer; }

/* ── Status Badge ── */
.badge {
    display: inline-block; padding: 2px 8px; border-radius: 12px;
    font-size: 11px; font-weight: 600;
}
.badge-ok { background: #0d2818; color: #3fb950; }
.badge-err { background: #3d1114; color: #f85149; }
.badge-run { background: #2e1d05; color: #d29922; }
.badge-wait { background: #21262d; color: #8b949e; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #161b22; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #484f58; }

/* ── Error Summary Panel ── */
.err-panel {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
    display: none;
}
.err-panel.show { display: block; }
.err-panel h3 { font-size: 14px; color: #f85149; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.err-cats { display: flex; flex-wrap: wrap; gap: 8px; }
.err-cat {
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 10px 16px;
    cursor: pointer;
    transition: all 0.15s;
    min-width: 120px;
}
.err-cat:hover { border-color: #f85149; background: #2d1114; }
.err-cat.active { border-color: #f85149; background: #3d1114; }
.err-cat .cat-count { font-size: 22px; font-weight: 700; color: #f85149; }
.err-cat .cat-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.3px; }
.err-cat .cat-hint { font-size: 10px; color: #484f58; margin-top: 2px; }

/* ── Error Detail Modal ── */
.modal-bg {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    z-index: 100; align-items: center; justify-content: center;
}
.modal-bg.show { display: flex; }
.modal {
    background: #161b22; border: 1px solid #30363d; border-radius: 12px;
    max-width: 640px; width: 90%; max-height: 80vh; overflow-y: auto;
    padding: 24px;
}
.modal h3 { font-size: 16px; color: #f0f6fc; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.modal .close-btn {
    margin-left: auto; background: none; border: 1px solid #30363d; color: #8b949e;
    border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 13px;
}
.modal .close-btn:hover { background: #21262d; color: #c9d1d9; }
.modal-row { padding: 10px 0; border-bottom: 1px solid #21262d; }
.modal-row:last-child { border-bottom: none; }
.modal-row .lbl { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
.modal-row .val { font-size: 13px; color: #e7e9ea; word-break: break-word; }
.modal-row .val.err-msg { color: #f85149; background: #1c0d0e; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
.modal-row .val .cat-badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700;
    background: #3d1114; color: #f85149; margin-left: 8px;
}
.modal-row .val .hint { color: #8b949e; font-size: 12px; margin-top: 4px; }

/* ── Clickable Error Cell ── */
td.err-click { cursor: pointer; }
td.err-click:hover { text-decoration: underline; text-decoration-color: #f85149; }

/* ── Responsive ── */
@media (max-width: 768px) {
    .stats { grid-template-columns: repeat(3, 1fr); }
    .stat-card .num { font-size: 20px; }
}
</style>
</head>
<body>
<div class="shell">

    <!-- Header -->
    <div class="hdr">
        <h1><span class="icon">🗑️</span> Batch Delete Records</h1>
        <div class="meta">
            Search: <b>${searchId}</b> &nbsp;|&nbsp;
            Total: <b>${records.length}</b> records &nbsp;|&nbsp;
            Max per page: <b>${MAX_SEARCH_RESULTS}</b>
        </div>
    </div>

    <!-- Stats -->
    <div class="stats">
        <div class="stat-card c-total"><div class="num" id="sTotal">${records.length}</div><div class="lbl">Total</div></div>
        <div class="stat-card c-ok"><div class="num" id="sOk">0</div><div class="lbl">Deleted</div></div>
        <div class="stat-card c-err" style="cursor:pointer;" onclick="scrollToErrorPanel()"><div class="num" id="sErr">0</div><div class="lbl">Errors ↓</div></div>
        <div class="stat-card c-pend"><div class="num" id="sPend">${records.length}</div><div class="lbl">Pending</div></div>
        <div class="stat-card c-rate"><div class="num" id="sRate">0.0</div><div class="lbl">Items/sec</div></div>
        <div class="stat-card c-time"><div class="num" id="sElapsed">00:00</div><div class="lbl">Elapsed</div></div>
    </div>

    <!-- Progress -->
    <div class="prog-wrap">
        <div class="prog-bar-bg"><div class="prog-bar-fill" id="progBar"></div></div>
        <div class="prog-label" id="progLabel">0 / ${records.length}</div>
    </div>

    <!-- Error Summary Panel (hidden until errors occur) -->
    <div class="err-panel" id="errPanel">
        <h3>⚠️ Error Summary <span style="font-weight:400;font-size:12px;color:#8b949e;">(click a category to filter table)</span></h3>
        <div class="err-cats" id="errCats"></div>
    </div>

    <!-- Chart -->
    <div class="chart-wrap"><canvas id="chartCanvas"></canvas></div>

    <!-- Toolbar -->
    <div class="toolbar">
        <button class="btn btn-danger" id="btnStart" onclick="confirmStart()">▶ Start Delete</button>
        <button class="btn btn-ghost" id="btnStop" onclick="stopProcess()" disabled>⏸ Stop</button>
        <div class="sep"></div>
        <button class="btn btn-ghost btn-sm" onclick="toggleSelectAll(true)">☑ Select All</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleSelectAll(false)">☐ Deselect All</button>
        <div class="sep"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
            <input type="checkbox" id="ckHideOk" checked onchange="filterRows()"> Hide OK
        </label>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
            <input type="checkbox" id="ckAutoScroll" checked> Auto Scroll
        </label>
        <div class="sep"></div>
        <button class="btn btn-ghost btn-sm" id="btnShowAll" onclick="showAllErrors()" style="display:none;">Show All Errors</button>
        <div class="slider-group">
            <label>Concurrency:</label>
            <input type="range" id="sliderConc" min="5" max="50" value="20" oninput="updateConcLabel()">
            <span class="val" id="concVal">20</span>
        </div>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-sm" onclick="exportErrors()">📥 Export Errors</button>
    </div>

    <!-- Table -->
    <div class="tbl-wrap">
        <div class="tbl-scroll" id="tblScroll">
            <table>
                <thead>
                    <tr>
                        <th style="width:36px;"><input type="checkbox" id="ckAll" checked onchange="toggleSelectAll(this.checked)"></th>
                        <th>#</th>
                        <th>Internal ID</th>
                        <th>Record Type</th>
                        <th>Number / Name</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Detail</th>
                    </tr>
                </thead>
                <tbody id="tbody"></tbody>
            </table>
        </div>
    </div>

</div><!-- .shell -->

<!-- Error Detail Modal -->
<div class="modal-bg" id="modalBg" onclick="if(event.target===this)closeModal()">
    <div class="modal" id="modalContent"></div>
</div>

<script>
/* ════════════════════════════════════════════
 *  DATA & STATE
 * ════════════════════════════════════════════ */
const RECORDS   = ${recordsJSON};
const AJAX_BASE = '${ajaxBase}';
const RELOAD_URL = '${reloadUrl}';
const BATCH_MAX  = ${maxResults};

let state = {
    running:    false,
    stopped:    false,
    okCount:    0,
    errCount:   0,
    processed:  0,
    startTime:  null,
    // Per-second throughput for chart
    tps:        [],         // array of { t: seconds_since_start, count: items_this_second }
    lastSecond: -1,
    // Track each record status: null | 'running' | 'ok' | 'error'
    statuses:   new Array(RECORDS.length).fill(null),
    errors:     new Array(RECORDS.length).fill(null),  // error messages
    errorCats:  new Array(RECORDS.length).fill(null),  // error categories from server
    activeFilter: null,  // current error category filter (null = show all)
};

/* ── Chart globals (declared BEFORE the init IIFE that uses them,
 *    otherwise initChart()/recordTPS() hit a temporal-dead-zone error) ── */
let chartCtx, chartW, chartH;
const CHART_SECONDS = 60; // show last 60 seconds

/* ════════════════════════════════════════════
 *  INIT: Build table rows
 * ════════════════════════════════════════════ */
(function init() {
    const tbody = document.getElementById('tbody');
    const frag  = document.createDocumentFragment();

    RECORDS.forEach((rec, i) => {
        const tr = document.createElement('tr');
        tr.id = 'row_' + i;
        tr.innerHTML =
            '<td><input type="checkbox" class="ck" data-idx="' + i + '" checked></td>' +
            '<td>' + (i + 1) + '</td>' +
            '<td><a href="/app/common/search/searchresults.nl?rectype=' + esc(rec.recordType) + '&searchid=' + rec.id + '" target="_blank">' + esc(String(rec.id)) + '</a></td>' +
            '<td>' + esc(rec.recordType) + '</td>' +
            '<td>' + esc(rec.tranid) + '</td>' +
            '<td>' + esc(rec.trandate) + '</td>' +
            '<td id="st_' + i + '"><span class="badge badge-wait">Pending</span></td>' +
            '<td id="det_' + i + '"></td>';
        frag.appendChild(tr);
    });

    tbody.appendChild(frag);
    initChart();
})();

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ════════════════════════════════════════════
 *  CONTROLS
 * ════════════════════════════════════════════ */
function updateConcLabel() {
    document.getElementById('concVal').textContent = document.getElementById('sliderConc').value;
}

function toggleSelectAll(checked) {
    document.getElementById('ckAll').checked = checked;
    document.querySelectorAll('.ck').forEach(c => {
        if (state.statuses[c.dataset.idx] === null) c.checked = checked;
    });
}

function filterRows() {
    const hideOk = document.getElementById('ckHideOk').checked;
    RECORDS.forEach((_, i) => {
        const row = document.getElementById('row_' + i);
        if (hideOk && state.statuses[i] === 'ok') {
            row.style.display = 'none';
        } else {
            row.style.display = '';
        }
    });
}

function confirmStart() {
    const selected = getSelectedIndices();
    if (selected.length === 0) { alert('No records selected.'); return; }
    if (!confirm('⚠️  DELETE ' + selected.length + ' records?\\n\\nThis cannot be undone!')) return;
    startProcess(selected);
}

function getSelectedIndices() {
    const indices = [];
    document.querySelectorAll('.ck').forEach(c => {
        if (c.checked && state.statuses[c.dataset.idx] === null) {
            indices.push(Number(c.dataset.idx));
        }
    });
    return indices;
}

/* ════════════════════════════════════════════
 *  PROCESS ENGINE — Concurrency Pool
 *  Uses a simple async semaphore pattern:
 *  - Queue all selected indices
 *  - N workers pull from queue concurrently
 * ════════════════════════════════════════════ */
async function startProcess(indices) {
    state.running   = true;
    state.stopped   = false;
    state.startTime = Date.now();
    state.tps       = [];
    state.lastSecond = -1;

    document.getElementById('btnStart').disabled = true;
    document.getElementById('btnStop').disabled  = false;
    window.onbeforeunload = () => 'Deletion in progress!';

    const concurrency = Number(document.getElementById('sliderConc').value);
    const queue = [...indices]; // clone
    let qIdx = 0;

    // Start elapsed timer
    const elapsedTimer = setInterval(updateElapsed, 1000);

    // Worker function
    async function worker() {
        while (qIdx < queue.length && !state.stopped) {
            const idx = queue[qIdx++];
            await deleteOne(idx);
        }
    }

    // Launch N workers
    const workers = [];
    for (let w = 0; w < Math.min(concurrency, queue.length); w++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    // Done
    state.running = false;
    clearInterval(elapsedTimer);
    updateElapsed();
    window.onbeforeunload = null;
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStop').disabled  = true;

    if (state.stopped) {
        document.getElementById('btnStart').textContent = '▶ Resume';
        document.getElementById('btnStart').disabled = false;
    } else if (state.okCount > 0 && RECORDS.length >= BATCH_MAX) {
        // Batch เต็ม → อาจมี records เหลือใน Saved Search → auto reload batch ถัดไป
        const errOnly = state.errCount > 0 ? ' (' + state.errCount + ' errors)' : '';
        document.getElementById('progLabel').textContent =
            '✅ Batch ' + RECORDS.length + ' done' + errOnly + ' — Loading next batch in 3s...';
        setTimeout(() => { window.location.href = RELOAD_URL; }, 3000);
    }
}

function stopProcess() {
    state.stopped = true;
    document.getElementById('btnStop').disabled = true;
}

/* ════════════════════════════════════════════
 *  DELETE ONE RECORD
 * ════════════════════════════════════════════ */
async function deleteOne(idx) {
    if (state.stopped) return;

    const rec = RECORDS[idx];
    setRowStatus(idx, 'running', 'Deleting...');

    try {
        const reqUrl = AJAX_BASE + '&recordId=' + rec.id + '&recordType=' + encodeURIComponent(rec.recordType);
        const resp = await fetch(reqUrl);
        const data = await resp.json();

        if (data.success) {
            state.okCount++;
            state.processed++;
            setRowStatus(idx, 'ok', fmtMs(data.elapsed));
            // Chart is cosmetic — never let a chart error mark a delete as failed
            try { recordTPS(); } catch (chartErr) { /* ignore */ }
            updateStats();
        } else {
            // Server returned error
            state.errCount++;
            state.processed++;
            state.errors[idx]    = data.error;
            state.errorCats[idx] = data.category || 'OTHER';
            setRowStatus(idx, 'error', data.error, true);
            updateStats();
            updateErrorSummary();
        }
    } catch (netErr) {
        // Network / timeout error
        state.errCount++;
        state.processed++;
        state.errors[idx]    = netErr.message || 'Network error';
        state.errorCats[idx] = 'NETWORK';
        setRowStatus(idx, 'error', netErr.message || 'Network error', true);
        updateStats();
        updateErrorSummary();
    }
}

/* ════════════════════════════════════════════
 *  UI UPDATE HELPERS
 * ════════════════════════════════════════════ */
function setRowStatus(idx, status, detail, isError) {
    state.statuses[idx] = status;

    const stEl  = document.getElementById('st_' + idx);
    const detEl = document.getElementById('det_' + idx);
    const row   = document.getElementById('row_' + idx);

    const badges = {
        running: '<span class="badge badge-run">Running</span>',
        ok:      '<span class="badge badge-ok">Deleted</span>',
        error:   '<span class="badge badge-err">Error</span>',
    };

    stEl.innerHTML = badges[status] || '';
    row.className  = status === 'ok' ? 'row-ok' : status === 'error' ? 'row-err' : status === 'running' ? 'row-running' : '';

    // Error detail: clickable to open modal with full info
    if (isError) {
        const shortMsg = (detail || '').length > 60 ? (detail || '').substring(0, 57) + '...' : (detail || '');
        detEl.innerHTML = '<span style="cursor:pointer;text-decoration:underline dotted #f85149;" onclick="showErrorModal(' + idx + ')" title="Click for full error detail">' + esc(shortMsg) + ' 🔍</span>';
        detEl.classList.add('err-click');
    } else {
        detEl.textContent = detail || '';
        detEl.classList.remove('err-click');
    }

    // Auto-hide OK rows
    if (status === 'ok' && document.getElementById('ckHideOk').checked) {
        row.style.display = 'none';
    }

    // Auto-scroll
    if (document.getElementById('ckAutoScroll').checked && status === 'running') {
        row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
}

function updateStats() {
    const total   = RECORDS.length;
    const pending = total - state.okCount - state.errCount;
    const pct     = total > 0 ? ((state.processed / total) * 100) : 0;

    document.getElementById('sOk').textContent    = state.okCount;
    document.getElementById('sErr').textContent   = state.errCount;
    document.getElementById('sPend').textContent  = pending;
    document.getElementById('progBar').style.width = pct.toFixed(1) + '%';
    document.getElementById('progLabel').textContent = state.processed + ' / ' + total + ' (' + pct.toFixed(1) + '%)';

    // Rate
    if (state.startTime) {
        const sec = (Date.now() - state.startTime) / 1000;
        const rate = sec > 0 ? (state.processed / sec) : 0;
        document.getElementById('sRate').textContent = rate.toFixed(1);
    }
}

function updateElapsed() {
    if (!state.startTime) return;
    const sec = Math.floor((Date.now() - state.startTime) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    document.getElementById('sElapsed').textContent =
        h > 0 ? h + ':' + String(mm).padStart(2, '0') + ':' + String(s).padStart(2, '0')
               : String(mm).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function fmtMs(ms) { return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(2) + 's'; }

/* ════════════════════════════════════════════
 *  THROUGHPUT CHART (Canvas — no dependencies)
 *  (chartCtx/chartW/chartH/CHART_SECONDS declared near the top)
 * ════════════════════════════════════════════ */
function initChart() {
    const canvas = document.getElementById('chartCanvas');
    const wrap   = canvas.parentElement;
    canvas.width  = wrap.clientWidth - 32;
    canvas.height = wrap.clientHeight - 32;
    chartW = canvas.width;
    chartH = canvas.height;
    chartCtx = canvas.getContext('2d');
    drawChart();
}

function recordTPS() {
    if (!state.startTime) return;
    const sec = Math.floor((Date.now() - state.startTime) / 1000);
    if (sec !== state.lastSecond) {
        state.tps.push({ t: sec, count: 0 });
        state.lastSecond = sec;
    }
    state.tps[state.tps.length - 1].count++;

    // Keep last N seconds
    if (state.tps.length > CHART_SECONDS) state.tps = state.tps.slice(-CHART_SECONDS);

    drawChart();
}

function drawChart() {
    if (!chartCtx) return;
    const ctx = chartCtx;
    const data = state.tps;
    const w = chartW, h = chartH;
    const pad = { top: 10, right: 10, bottom: 20, left: 36 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) {
        ctx.fillStyle = '#484f58';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Throughput chart will appear once processing starts...', w / 2, h / 2);
        return;
    }

    const maxVal = Math.max(...data.map(d => d.count), 1);
    const stepX  = plotW / (Math.max(data.length - 1, 1));

    // Grid lines
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
        const y = pad.top + plotH - (plotH * g / 4);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#484f58';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * g / 4), pad.left - 4, y + 3);
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + plotH);
    data.forEach((d, i) => {
        const x = pad.left + i * stepX;
        const y = pad.top + plotH - (plotH * d.count / maxVal);
        if (i === 0) ctx.lineTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + (data.length - 1) * stepX, pad.top + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, 'rgba(88, 166, 255, 0.3)');
    grad.addColorStop(1, 'rgba(88, 166, 255, 0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((d, i) => {
        const x = pad.left + i * stepX;
        const y = pad.top + plotH - (plotH * d.count / maxVal);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // X label
    ctx.fillStyle = '#484f58';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('items / second (last ' + CHART_SECONDS + 's)', w / 2, h - 2);
}

/* ════════════════════════════════════════════
 *  EXPORT ERRORS TO CSV
 * ════════════════════════════════════════════ */
function exportErrors() {
    const rows = [['Index', 'InternalID', 'RecordType', 'TranID', 'Date', 'Category', 'Error']];
    RECORDS.forEach((rec, i) => {
        if (state.statuses[i] === 'error') {
            rows.push([i + 1, rec.id, rec.recordType, rec.tranid, rec.trandate,
                        state.errorCats[i] || '', state.errors[i] || '']);
        }
    });
    if (rows.length <= 1) { alert('No errors to export.'); return; }

    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'batch_delete_errors_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

/* ════════════════════════════════════════════
 *  ERROR SUMMARY PANEL
 *  Groups errors by category, shows counts,
 *  clickable to filter table.
 * ════════════════════════════════════════════ */
const CAT_META = {
    DEPENDENCY:  { label: 'Dependency',  hint: 'Record has linked/dependent records — delete children first' },
    PERMISSION:  { label: 'Permission',  hint: 'Role lacks permission to delete this record type' },
    LOCKED:      { label: 'Locked',      hint: 'Record is locked by another user or process' },
    NOT_FOUND:   { label: 'Not Found',   hint: 'Record was already deleted or ID is invalid' },
    GOVERNANCE:  { label: 'Governance',  hint: 'Script usage limit exceeded — try smaller batch' },
    NETWORK:     { label: 'Network',     hint: 'Connection lost — check network or retry' },
    OTHER:       { label: 'Other',       hint: 'Unclassified error — see detail for specifics' },
};

function updateErrorSummary() {
    // Count by category
    const counts = {};
    RECORDS.forEach((_, i) => {
        const cat = state.errorCats[i];
        if (cat) counts[cat] = (counts[cat] || 0) + 1;
    });

    const panel = document.getElementById('errPanel');
    const container = document.getElementById('errCats');
    if (Object.keys(counts).length === 0) { panel.classList.remove('show'); return; }

    panel.classList.add('show');
    container.innerHTML = '';

    // Sort by count descending
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([cat, count]) => {
        const meta = CAT_META[cat] || CAT_META.OTHER;
        const div = document.createElement('div');
        div.className = 'err-cat' + (state.activeFilter === cat ? ' active' : '');
        div.onclick = () => filterByCategory(cat);
        div.innerHTML =
            '<div class="cat-count">' + count + '</div>' +
            '<div class="cat-label">' + esc(meta.label) + '</div>' +
            '<div class="cat-hint">' + esc(meta.hint) + '</div>';
        container.appendChild(div);
    });
}

function filterByCategory(cat) {
    if (state.activeFilter === cat) {
        // Toggle off — show all
        state.activeFilter = null;
        filterRows();
        document.getElementById('btnShowAll').style.display = 'none';
    } else {
        state.activeFilter = cat;
        document.getElementById('btnShowAll').style.display = '';
        RECORDS.forEach((_, i) => {
            const row = document.getElementById('row_' + i);
            if (state.statuses[i] === 'error' && state.errorCats[i] === cat) {
                row.style.display = '';
            } else if (state.statuses[i] === 'ok' && document.getElementById('ckHideOk').checked) {
                row.style.display = 'none';
            } else if (state.statuses[i] === 'error') {
                row.style.display = 'none';  // hide other error categories
            }
            // Keep pending/running visible
        });
    }
    updateErrorSummary(); // refresh active state
}

function showAllErrors() {
    state.activeFilter = null;
    filterRows();
    document.getElementById('btnShowAll').style.display = 'none';
    updateErrorSummary();
}

function scrollToErrorPanel() {
    const panel = document.getElementById('errPanel');
    if (panel.classList.contains('show')) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/* ════════════════════════════════════════════
 *  ERROR DETAIL MODAL
 *  Shows full error info for a single record.
 * ════════════════════════════════════════════ */
function showErrorModal(idx) {
    const rec  = RECORDS[idx];
    const cat  = state.errorCats[idx] || 'OTHER';
    const meta = CAT_META[cat] || CAT_META.OTHER;
    const err  = state.errors[idx] || 'Unknown error';

    const modal = document.getElementById('modalContent');
    modal.innerHTML =
        '<h3>Error Detail <button class="close-btn" onclick="closeModal()">✕ Close</button></h3>' +

        '<div class="modal-row">' +
            '<div class="lbl">Record</div>' +
            '<div class="val">' + esc(rec.recordType) + ' #' + esc(String(rec.id)) +
                (rec.tranid ? ' — ' + esc(rec.tranid) : '') + '</div>' +
        '</div>' +

        '<div class="modal-row">' +
            '<div class="lbl">Error Category</div>' +
            '<div class="val">' + esc(meta.label) + ' <span class="cat-badge">' + esc(cat) + '</span>' +
                '<div class="hint">' + esc(meta.hint) + '</div></div>' +
        '</div>' +

        '<div class="modal-row">' +
            '<div class="lbl">Full Error Message</div>' +
            '<div class="val err-msg">' + esc(err) + '</div>' +
        '</div>' +

        '<div class="modal-row">' +
            '<div class="lbl">How to Fix</div>' +
            '<div class="val"><div class="hint">' + getFixSuggestion(cat) + '</div></div>' +
        '</div>';

    document.getElementById('modalBg').classList.add('show');
}

function closeModal() {
    document.getElementById('modalBg').classList.remove('show');
}

function getFixSuggestion(cat) {
    const tips = {
        DEPENDENCY:  '1. Go to the record in NetSuite and check the Related Records / Activity tab.\\n' +
                     '2. Delete child/dependent records first (e.g. Item Fulfillment, Journal Entry).\\n' +
                     '3. Check Custom Record references that link to this record.',
        PERMISSION:  '1. Verify your Role has Delete permission for this record type.\\n' +
                     '2. Check if a Workflow or User Event script is blocking deletion.\\n' +
                     '3. Ask your NetSuite admin to review role restrictions.',
        LOCKED:      '1. Wait a moment and retry — another user may be editing.\\n' +
                     '2. Check if a Scheduled Script or Map/Reduce is processing this record.\\n' +
                     '3. In extreme cases, ask admin to unlock the record.',
        NOT_FOUND:   '1. The record may have already been deleted — no action needed.\\n' +
                     '2. Verify the internal ID is correct in the original Saved Search.\\n' +
                     '3. If the record type changed (e.g. merged), update the search.',
        GOVERNANCE:  '1. Reduce the Concurrency slider to a lower value (e.g. 5-10).\\n' +
                     '2. Wait a few minutes for governance to reset, then click Resume.\\n' +
                     '3. Consider running in smaller batches.',
        NETWORK:     '1. Check your internet connection.\\n' +
                     '2. The NetSuite server may be temporarily overloaded — wait and retry.\\n' +
                     '3. If using VPN, try disconnecting and reconnecting.',
        OTHER:       '1. Read the full error message above for clues.\\n' +
                     '2. Try deleting this record manually in NetSuite to see the UI error.\\n' +
                     '3. Check the SuiteScript Execution Log for more detail.',
    };
    return tips[cat] || tips.OTHER;
}

// ── Auto-start if redirected from previous batch ──
(function() {
    if (new URLSearchParams(window.location.search).get('autostart') === '1' && RECORDS.length > 0) {
        const allIndices = RECORDS.map((_, i) => i);
        startProcess(allIndices);
    }
})();
</script>
</body>
</html>`;
    }

    /* ═══════════════════════════════════════════════
     *  MAP/REDUCE: START (AJAX endpoint)
     *  Receives JSON body of selected record IDs,
     *  saves to file, triggers M/R, returns taskId
     * ═══════════════════════════════════════════════ */
    function handleMRStart(request, response) {
        response.setHeader({ name: 'Content-Type', value: 'application/json' });

        try {
            const searchId    = request.parameters.search || '';
            const bodyStr     = request.body;
            if (!bodyStr) {
                response.write(JSON.stringify({ success: false, error: 'No records provided' }));
                return;
            }

            const records = JSON.parse(bodyStr);
            log.audit('handleMRStart', `${records.length} records from search "${searchId}"`);

            // Save to File Cabinet
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName  = `batch_delete_${timestamp}.json`;
            const jsonFile  = file.create({
                name:        fileName,
                fileType:    file.Type.JSON,
                contents:    JSON.stringify(records),
                folder:      MR_FILE_FOLDER,
                description: `Batch Delete: ${records.length} records from ${searchId} by ${runtime.getCurrentUser().name}`
            });
            const fileId = jsonFile.save();
            log.audit('handleMRStart', `Saved file #${fileId}: ${fileName}`);

            // Try each deployment until one is available
            let taskId = null;
            let usedDeploy = '';
            for (let i = 0; i < MR_DEPLOY_IDS.length; i++) {
                try {
                    const mrTask = task.create({
                        taskType:     task.TaskType.MAP_REDUCE,
                        scriptId:     MR_SCRIPT_ID,
                        deploymentId: MR_DEPLOY_IDS[i],
                        params:       { custscript_bd_mr_file_id: fileId }
                    });
                    taskId = mrTask.submit();
                    usedDeploy = MR_DEPLOY_IDS[i];
                    log.audit('handleMRStart', `Triggered M/R task: ${taskId} (deploy: ${usedDeploy})`);
                    break;
                } catch (ex) {
                    log.debug('handleMRStart', `Deploy ${MR_DEPLOY_IDS[i]} busy: ${ex.message}`);
                }
            }

            if (!taskId) {
                response.write(JSON.stringify({ success: false, error: `Deploy ทั้ง ${MR_DEPLOY_IDS.length} ตัวกำลังรันอยู่ กรุณารอสักครู่แล้วลองใหม่` }));
                return;
            }

            response.write(JSON.stringify({
                success: true,
                taskId,
                fileId,
                deploymentId: usedDeploy,
                recordCount: records.length
            }));
        } catch (e) {
            log.error('handleMRStart', e);
            response.write(JSON.stringify({ success: false, error: e.message }));
        }
    }

    /* ═══════════════════════════════════════════════
     *  MAP/REDUCE: STATUS CHECK (AJAX endpoint)
     *  Returns JSON with task status + result if done
     * ═══════════════════════════════════════════════ */
    function handleMRStatus(params, response) {
        response.setHeader({ name: 'Content-Type', value: 'application/json' });

        const taskId = params.taskId;
        const fileId = params.fileId;
        if (!taskId) {
            response.write(JSON.stringify({ success: false, error: 'Missing taskId' }));
            return;
        }

        try {
            const status = task.checkStatus({ taskId });
            const result = {
                success:    true,
                status:     status.status,
                stage:      status.stage || '',
                percentage: status.getPercentageCompleted() || 0
            };

            // If complete, try to load result file
            if (status.status === 'COMPLETE' || status.status === 'FAILED') {
                try {
                    const resultFileName = `batch_delete_result_${fileId}.json`;
                    // Search for the result file
                    const ss = search.create({
                        type: 'file',
                        filters: [['name', 'is', resultFileName]],
                        columns: ['internalid']
                    });
                    const fileResults = ss.run().getRange({ start: 0, end: 1 });
                    if (fileResults.length > 0) {
                        const rf = file.load({ id: fileResults[0].id });
                        result.resultData = JSON.parse(rf.getContents());
                    }
                } catch (ex) {
                    log.debug('handleMRStatus', `Result file not found yet: ${ex.message}`);
                }
            }

            response.write(JSON.stringify(result));
        } catch (e) {
            log.error('handleMRStatus', e);
            response.write(JSON.stringify({ success: false, error: e.message }));
        }
    }

    /* ═══════════════════════════════════════════════
     *  MAP/REDUCE: CONFIRMATION + PROGRESS PAGE
     *  Shows record list → user confirms → triggers M/R → polls status
     * ═══════════════════════════════════════════════ */
    function buildMRConfirmHTML(records, searchId, suiteletUrl) {
        const sep      = suiteletUrl.includes('?') ? '&' : '?';
        const ajaxBase = `${suiteletUrl}${sep}`;
        const recordsJSON = JSON.stringify(records);

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Batch Delete (Map/Reduce) — ${records.length} Records</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f1419; color: #e7e9ea; line-height: 1.5; min-height: 100vh;
}
a { color: #1d9bf0; text-decoration: none; }
.shell { max-width: 1280px; margin: 0 auto; padding: 20px; }

.hdr {
    background: linear-gradient(135deg, #1a1f2e 0%, #0d1117 100%);
    border: 1px solid #30363d; border-radius: 12px;
    padding: 24px 28px; margin-bottom: 16px;
}
.hdr h1 { font-size: 20px; font-weight: 700; color: #f0f6fc; display: flex; align-items: center; gap: 10px; }
.hdr .meta { font-size: 13px; color: #8b949e; margin-top: 6px; }
.hdr .meta b { color: #c9d1d9; }

.card {
    background: #161b22; border: 1px solid #30363d; border-radius: 10px;
    padding: 20px; margin-bottom: 16px;
}
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px; text-align: center; }
.stat-card .num { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat-card .lbl { font-size: 12px; color: #8b949e; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
.c-total .num { color: #c9d1d9; }
.c-ok .num { color: #3fb950; }
.c-err .num { color: #f85149; }
.c-stage .num { color: #58a6ff; font-size: 18px; }
.c-pct .num { color: #d29922; }

.prog-bar-bg { height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; }
.prog-bar-fill { height: 100%; background: linear-gradient(90deg, #238636, #3fb950); border-radius: 4px; transition: width 0.5s ease; width: 0%; }
.prog-label { font-size: 12px; color: #8b949e; margin-top: 6px; text-align: right; }

.btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 10px 20px; border-radius: 8px;
    font-size: 14px; font-weight: 600;
    border: 1px solid transparent; cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger { background: #da3633; color: #fff; border-color: #f85149; }
.btn-danger:hover:not(:disabled) { background: #f85149; }
.btn-ghost { background: transparent; color: #c9d1d9; border-color: #30363d; }
.btn-ghost:hover:not(:disabled) { background: #21262d; }
.btn-sm { padding: 5px 12px; font-size: 12px; }

.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }

.tbl-wrap { background: #161b22; border: 1px solid #30363d; border-radius: 10px; overflow: hidden; }
.tbl-scroll { max-height: 50vh; overflow-y: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead { position: sticky; top: 0; z-index: 2; }
thead th { background: #1c2128; padding: 10px 12px; text-align: left; font-weight: 600; color: #8b949e; border-bottom: 1px solid #30363d; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
tbody td { padding: 8px 12px; border-bottom: 1px solid #21262d; font-variant-numeric: tabular-nums; }
tbody tr:hover { background: #1c2128; }
input[type="checkbox"] { accent-color: #58a6ff; width: 15px; height: 15px; cursor: pointer; }

/* Phase panels */
#phaseConfirm, #phaseProgress, #phaseResult { display: none; }
#phaseConfirm.active, #phaseProgress.active, #phaseResult.active { display: block; }

.badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.badge-ok { background: #0d2818; color: #3fb950; }
.badge-err { background: #3d1114; color: #f85149; }
.badge-run { background: #2e1d05; color: #d29922; }
.badge-info { background: #0d1d30; color: #58a6ff; }

.err-table { margin-top: 12px; }
.err-table td { color: #f85149; font-size: 12px; word-break: break-word; white-space: normal; }

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #161b22; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
</style>
</head>
<body>
<div class="shell">
    <!-- Header -->
    <div class="hdr">
        <h1><span>🔄</span> Batch Delete — Map/Reduce Mode</h1>
        <div class="meta">
            Search: <b>${searchId}</b> &nbsp;|&nbsp;
            Total: <b>${records.length}</b> records &nbsp;|&nbsp;
            Mode: <b>Map/Reduce (Background)</b>
        </div>
    </div>

    <!-- ════ PHASE 1: Confirm ════ -->
    <div id="phaseConfirm" class="active">
        <div class="card">
            <h3 style="color:#d29922;margin-bottom:12px;">⚠️ ยืนยันการลบ</h3>
            <p style="color:#8b949e;margin-bottom:16px;">
                เลือก records ที่ต้องการลบ แล้วกด Start เพื่อส่งไปลบแบบ Background (Map/Reduce)<br>
                <span style="color:#f85149;font-weight:600;">การลบไม่สามารถย้อนกลับได้!</span>
            </p>
            <div class="toolbar">
                <button class="btn btn-danger" onclick="confirmMRStart()">🚀 Start Map/Reduce Delete</button>
                <button class="btn btn-ghost btn-sm" onclick="toggleAll(true)">☑ Select All</button>
                <button class="btn btn-ghost btn-sm" onclick="toggleAll(false)">☐ Deselect All</button>
                <span style="color:#8b949e;font-size:13px;margin-left:12px;" id="selectedCount">${records.length} selected</span>
            </div>
        </div>
        <div class="tbl-wrap">
            <div class="tbl-scroll">
                <table>
                    <thead><tr>
                        <th style="width:36px;"><input type="checkbox" id="ckAll" checked onchange="toggleAll(this.checked)"></th>
                        <th>#</th><th>Internal ID</th><th>Record Type</th><th>Number / Name</th><th>Date</th>
                    </tr></thead>
                    <tbody id="tbody"></tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- ════ PHASE 2: Progress ════ -->
    <div id="phaseProgress">
        <div class="stats">
            <div class="stat-card c-total"><div class="num" id="mrTotal">0</div><div class="lbl">Total</div></div>
            <div class="stat-card c-stage"><div class="num" id="mrStage">—</div><div class="lbl">Stage</div></div>
            <div class="stat-card c-pct"><div class="num" id="mrPct">0%</div><div class="lbl">Progress</div></div>
            <div class="stat-card c-ok"><div class="num" id="mrStatus">PENDING</div><div class="lbl">Task Status</div></div>
        </div>
        <div class="card">
            <div class="prog-bar-bg"><div class="prog-bar-fill" id="mrProgBar"></div></div>
            <div class="prog-label" id="mrProgLabel">Waiting for Map/Reduce to start...</div>
        </div>
        <div class="card" id="mrLogPanel">
            <h3 style="color:#8b949e;margin-bottom:8px;">📋 Activity Log</h3>
            <div id="mrLog" style="font-family:monospace;font-size:12px;color:#8b949e;max-height:200px;overflow-y:auto;"></div>
        </div>
    </div>

    <!-- ════ PHASE 3: Result ════ -->
    <div id="phaseResult">
        <div class="stats" id="resultStats"></div>
        <div class="card" id="resultDetail"></div>
        <div class="toolbar" style="margin-top:12px;">
            <button class="btn btn-ghost" onclick="exportMRErrors()">📥 Export Errors CSV</button>
            <button class="btn btn-ghost" onclick="location.reload()">🔄 Run Again</button>
        </div>
    </div>
</div>

<script>
const RECORDS   = ${recordsJSON};
const AJAX_BASE = '${ajaxBase}';
let mrTaskId = null, mrFileId = null, mrPollTimer = null;
let mrResultData = null;

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ── Build table ── */
(function init() {
    const tbody = document.getElementById('tbody');
    const frag  = document.createDocumentFragment();
    RECORDS.forEach((rec, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td><input type="checkbox" class="ck" data-idx="' + i + '" checked onchange="updateSelectedCount()"></td>' +
            '<td>' + (i + 1) + '</td>' +
            '<td>' + esc(String(rec.id)) + '</td>' +
            '<td>' + esc(rec.recordType) + '</td>' +
            '<td>' + esc(rec.tranid) + '</td>' +
            '<td>' + esc(rec.trandate) + '</td>';
        frag.appendChild(tr);
    });
    tbody.appendChild(frag);
})();

function toggleAll(checked) {
    document.getElementById('ckAll').checked = checked;
    document.querySelectorAll('.ck').forEach(c => c.checked = checked);
    updateSelectedCount();
}

function updateSelectedCount() {
    const count = document.querySelectorAll('.ck:checked').length;
    document.getElementById('selectedCount').textContent = count + ' selected';
}

function getSelectedRecords() {
    const selected = [];
    document.querySelectorAll('.ck:checked').forEach(c => {
        selected.push(RECORDS[Number(c.dataset.idx)]);
    });
    return selected;
}

/* ── Confirm & Start ── */
function confirmMRStart() {
    const selected = getSelectedRecords();
    if (selected.length === 0) { alert('No records selected.'); return; }
    if (!confirm('⚠️ DELETE ' + selected.length + ' records via Map/Reduce?\\n\\nThis cannot be undone!')) return;
    startMR(selected);
}

async function startMR(records) {
    showPhase('phaseProgress');
    document.getElementById('mrTotal').textContent = records.length;
    addLog('Sending ' + records.length + ' records to Map/Reduce...');

    try {
        const reqUrl = AJAX_BASE + 'step=mrstart&search=${searchId}';
        const resp = await fetch(reqUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(records)
        });
        const data = await resp.json();

        if (!data.success) {
            addLog('❌ ERROR: ' + data.error);
            document.getElementById('mrStatus').textContent = 'ERROR';
            document.getElementById('mrStatus').style.color = '#f85149';
            return;
        }

        mrTaskId = data.taskId;
        mrFileId = data.fileId;
        addLog('✅ M/R Task started: ' + mrTaskId);
        addLog('📁 File ID: ' + mrFileId + ' | Deploy: ' + data.deploymentId);

        // Start polling
        mrPollTimer = setInterval(pollMRStatus, 3000);
        pollMRStatus(); // immediate first check
    } catch (e) {
        addLog('❌ Network error: ' + e.message);
    }
}

async function pollMRStatus() {
    if (!mrTaskId) return;
    try {
        const reqUrl = AJAX_BASE + 'step=mrstatus&taskId=' + encodeURIComponent(mrTaskId) + '&fileId=' + mrFileId;
        const resp = await fetch(reqUrl);
        const data = await resp.json();

        if (!data.success) { addLog('⚠️ Status check error: ' + data.error); return; }

        // Update UI
        document.getElementById('mrStage').textContent = data.stage || '—';
        document.getElementById('mrPct').textContent = Math.round(data.percentage) + '%';
        document.getElementById('mrProgBar').style.width = data.percentage + '%';
        document.getElementById('mrStatus').textContent = data.status;
        document.getElementById('mrProgLabel').textContent = data.status + ' — ' + Math.round(data.percentage) + '%';

        const statusColor = { PENDING: '#d29922', PROCESSING: '#58a6ff', COMPLETE: '#3fb950', FAILED: '#f85149' };
        document.getElementById('mrStatus').style.color = statusColor[data.status] || '#8b949e';

        addLog('Poll: ' + data.status + ' | Stage: ' + (data.stage || '—') + ' | ' + Math.round(data.percentage) + '%');

        // If done, show results
        if (data.status === 'COMPLETE' || data.status === 'FAILED') {
            clearInterval(mrPollTimer);
            mrResultData = data.resultData || null;
            showResults(data);
        }
    } catch (e) {
        addLog('⚠️ Poll error: ' + e.message);
    }
}

function showResults(data) {
    showPhase('phaseResult');

    const rd = data.resultData || {};
    const ok  = rd.okCount || 0;
    const err = rd.errCount || 0;
    const total = rd.totalProcessed || (ok + err);

    document.getElementById('resultStats').innerHTML =
        '<div class="stat-card c-total"><div class="num">' + total + '</div><div class="lbl">Processed</div></div>' +
        '<div class="stat-card c-ok"><div class="num">' + ok + '</div><div class="lbl">Deleted</div></div>' +
        '<div class="stat-card c-err"><div class="num">' + err + '</div><div class="lbl">Errors</div></div>' +
        '<div class="stat-card c-stage"><div class="num" style="font-size:16px;">' + (data.status || '—') + '</div><div class="lbl">Status</div></div>';

    let detailHtml = '<h3 style="color:#f0f6fc;margin-bottom:12px;">📊 Result Summary</h3>';
    detailHtml += '<p style="color:#8b949e;">Usage: ' + (rd.usage || 'N/A') + ' | Concurrency: ' + (rd.concurrency || 'N/A') + '</p>';

    if (rd.errors && rd.errors.length > 0) {
        detailHtml += '<h4 style="color:#f85149;margin:16px 0 8px;">Errors (' + rd.errors.length + ')</h4>';
        detailHtml += '<div class="tbl-wrap"><div class="tbl-scroll" style="max-height:300px;"><table class="err-table">';
        detailHtml += '<thead><tr><th>ID</th><th>Type</th><th>Name</th><th>Error</th></tr></thead><tbody>';
        rd.errors.forEach(e => {
            detailHtml += '<tr><td>' + esc(String(e.id)) + '</td><td>' + esc(e.recordType || '') + '</td><td>' + esc(e.tranid || '') + '</td><td>' + esc(e.error || '') + '</td></tr>';
        });
        detailHtml += '</tbody></table></div></div>';
    } else if (err === 0) {
        detailHtml += '<p style="color:#3fb950;margin-top:12px;">✅ ลบสำเร็จทั้งหมด!</p>';
    }

    document.getElementById('resultDetail').innerHTML = detailHtml;
}

function exportMRErrors() {
    if (!mrResultData || !mrResultData.errors || mrResultData.errors.length === 0) { alert('No errors to export.'); return; }
    const rows = [['InternalID', 'RecordType', 'Name', 'Error']];
    mrResultData.errors.forEach(e => {
        rows.push([e.id || '', e.recordType || '', e.tranid || '', e.error || '']);
    });
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'batch_delete_mr_errors_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

function showPhase(id) {
    ['phaseConfirm', 'phaseProgress', 'phaseResult'].forEach(p => {
        document.getElementById(p).classList.toggle('active', p === id);
    });
}

function addLog(msg) {
    const el = document.getElementById('mrLog');
    const ts = new Date().toLocaleTimeString();
    el.innerHTML += '<div>[' + ts + '] ' + esc(msg) + '</div>';
    el.scrollTop = el.scrollHeight;
}
</script>
</body>
</html>`;
    }

    /* ═══════════════════════════════════════════════ */
    return { onRequest };
});