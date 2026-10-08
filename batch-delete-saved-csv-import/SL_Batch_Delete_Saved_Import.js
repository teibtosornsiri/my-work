/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Batch Delete Saved CSV Import Templates
 * ────────────────────────────────────────
 * ใช้สำหรับลบ Saved CSV Import Templates แบบ batch
 *
 * วิธีทำงาน:
 *   1. Client-side JS fetch หน้า savedimports.nl (ทุก page)
 *   2. Parse HTML → ดึง ID, Name, Type, Owner จาก <table id="div__body">
 *   3. แสดงตาราง พร้อม filter by Owner / Record Type / ชื่อ
 *   4. User ติ๊กเลือก → กดลบ → JS navigate ไป delete URL ทีละตัว
 *
 * Column order ใน savedimports.nl:
 *   [0]ID  [1]Name  [2]Translate  [3]Field Map  [4]Description
 *   [5]Type  [6]Owner  [7]Created  [8]Last Modified  [9]Script ID
 *   [10]From Bundle  [11]Access  [12]Delete
 *
 * @author Claude
 */
define(['N/ui/serverWidget', 'N/runtime'], (serverWidget, runtime) => {

    function onRequest(context) {
        if (context.request.method !== 'GET') return;

        const form = serverWidget.createForm({ title: 'Batch Delete Saved CSV Import Templates' });

        const fHtml = form.addField({
            id: 'custpage_html',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });
        fHtml.defaultValue = buildHTML();

        context.response.writePage(form);
    }

    function buildHTML() {
        return /* html */ `
<style>
    .bdi-wrap { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a2e; padding: 0 8px; }
    .bdi-wrap *, .bdi-wrap *::before, .bdi-wrap *::after { box-sizing: border-box; }

    .bdi-status { padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 13px; display: none; }
    .bdi-status.info    { background: #e8f4fd; color: #0c5460; border: 1px solid #b8daff; display: block; }
    .bdi-status.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; display: block; }
    .bdi-status.error   { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; display: block; }
    .bdi-status.loading { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; display: block; }

    .bdi-filters { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px; }
    .bdi-filters label { font-size: 12px; font-weight: 600; color: #555; display: block; margin-bottom: 2px; }
    .bdi-filters select, .bdi-filters input[type="text"] {
        padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; min-width: 180px;
    }

    .bdi-actions { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
    .bdi-btn {
        padding: 7px 16px; border: none; border-radius: 4px; font-size: 13px;
        font-weight: 600; cursor: pointer; transition: opacity .2s;
    }
    .bdi-btn:disabled { opacity: .5; cursor: not-allowed; }
    .bdi-btn.primary   { background: #dc3545; color: #fff; }
    .bdi-btn.primary:hover:not(:disabled) { background: #c82333; }
    .bdi-btn.secondary { background: #6c757d; color: #fff; }
    .bdi-btn.outline   { background: #fff; color: #333; border: 1px solid #ccc; }
    .bdi-btn.outline:hover:not(:disabled) { background: #f5f5f5; }
    .bdi-selected-count { font-size: 13px; color: #555; margin-left: 8px; }

    .bdi-table-wrap { max-height: 65vh; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 6px; }
    .bdi-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
    .bdi-tbl thead { position: sticky; top: 0; z-index: 2; }
    .bdi-tbl th {
        background: #343a40; color: #fff; padding: 8px 10px; text-align: left;
        font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .3px;
        white-space: nowrap;
    }
    .bdi-tbl th:first-child { width: 36px; text-align: center; }
    .bdi-tbl td { padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: middle; }
    .bdi-tbl tbody tr:hover { background: #f8f9fa; }
    .bdi-tbl tbody tr.deleted td { text-decoration: line-through; color: #aaa; }
    .bdi-tbl tbody tr.err td { background: #fff5f5; }
    .bdi-tbl td.st { font-size: 12px; min-width: 80px; }
    .bdi-tbl input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }

    .bdi-progress-wrap { margin-top: 12px; display: none; }
    .bdi-progress-bar-bg { height: 22px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .bdi-progress-bar {
        height: 100%; background: linear-gradient(90deg, #28a745, #20c997);
        transition: width .3s; text-align: center; color: #fff; font-size: 12px;
        line-height: 22px; font-weight: 600; min-width: 30px;
    }
    .bdi-log { margin-top: 8px; font-size: 12px; color: #555; max-height: 150px; overflow-y: auto;
               background: #f8f9fa; padding: 8px; border-radius: 4px; font-family: monospace; }
</style>

<div class="bdi-wrap">
    <div id="bdiStatus" class="bdi-status"></div>

    <div class="bdi-filters">
        <div>
            <label>Owner</label>
            <select id="fOwner" onchange="bdiFilter()"><option value="">— ทั้งหมด —</option></select>
        </div>
        <div>
            <label>Record Type</label>
            <select id="fType" onchange="bdiFilter()"><option value="">— ทั้งหมด —</option></select>
        </div>
        <div>
            <label>ค้นหาชื่อ</label>
            <input type="text" id="fName" placeholder="พิมพ์ชื่อ template..." oninput="bdiFilter()">
        </div>
        <div>
            <button type="button" class="bdi-btn outline" onclick="bdiLoad()">🔄 โหลดใหม่</button>
        </div>
    </div>

    <div class="bdi-actions">
        <button type="button" class="bdi-btn outline" onclick="bdiToggleAll()">☑️ เลือก/ยกเลิกทั้งหมด</button>
        <button type="button" class="bdi-btn primary" id="bdiDelBtn" onclick="bdiDelete()" disabled>🗑️ ลบที่เลือก</button>
        <span class="bdi-selected-count" id="bdiCount">เลือก 0 รายการ</span>
    </div>

    <div class="bdi-table-wrap">
        <table class="bdi-tbl">
            <thead>
                <tr>
                    <th><input type="checkbox" id="chkAll" onchange="bdiToggleAll(this.checked)"></th>
                    <th>#</th>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Owner</th>
                    <th>Created</th>
                    <th>สถานะ</th>
                </tr>
            </thead>
            <tbody id="bdiTb"></tbody>
        </table>
    </div>

    <div class="bdi-progress-wrap" id="bdiProg">
        <div class="bdi-progress-bar-bg">
            <div class="bdi-progress-bar" id="bdiBar" style="width:0%">0%</div>
        </div>
        <div class="bdi-log" id="bdiLog"></div>
    </div>
</div>

<script>
(function() {
    'use strict';

    var allRows = [];     // { id, name, type, owner, created, canDelete }
    var filtered = [];
    var BASE = '/app/setup/assistants/nsimport/savedimports.nl';

    // ─── Expose to onclick ───
    window.bdiLoad      = load;
    window.bdiFilter    = applyFilter;
    window.bdiToggleAll = toggleAll;
    window.bdiDelete    = doDelete;
    window.bdiUpdateCnt = updateCount;

    load();

    // ─── Load all pages ───
    async function load() {
        setStatus('loading', '⏳ กำลังโหลดรายการ Saved Import Templates...');
        allRows = [];
        document.getElementById('bdiTb').innerHTML = '';

        try {
            // Fetch page 0
            var html0 = await fetchPage(BASE);
            parseRows(html0);
            setStatus('loading', '⏳ โหลดหน้า 1 ได้ ' + allRows.length + ' รายการ กำลังตรวจสอบหน้าถัดไป...');

            // Detect pagination: find segment values
            var pages = detectPages(html0);
            for (var p = 1; p < pages.length; p++) {
                // NetSuite pagination uses POST with segment field value
                // But we can also use URL param: savedimports.nl?segment=VALUE
                var segVal = pages[p];
                var pageUrl = BASE + '?segment=' + encodeURIComponent(segVal);
                var htmlN = await fetchPage(pageUrl);
                parseRows(htmlN);
                setStatus('loading', '⏳ โหลดหน้า ' + (p + 1) + '/' + pages.length + ' ได้ ' + allRows.length + ' รายการรวม...');
            }

            populateFilters();
            applyFilter();
            setStatus('success', '✅ โหลดเสร็จ — พบ ' + allRows.length + ' templates');
        } catch (e) {
            setStatus('error', '❌ โหลดไม่สำเร็จ: ' + e.message);
        }
    }

    function fetchPage(url) {
        return fetch(url, { credentials: 'same-origin' })
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            });
    }

    // ─── Detect pagination segment values ───
    function detectPages(html) {
        var pages = [];
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var items = doc.querySelectorAll('[data-pagination-value]');
        items.forEach(function(el) {
            pages.push(el.getAttribute('data-pagination-value'));
        });
        return pages.length > 0 ? pages : ['0'];
    }

    // ─── Parse rows from HTML ───
    function parseRows(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var tbl = doc.getElementById('div__body');
        if (!tbl) {
            // Fallback: find table with uir-list-body
            tbl = doc.querySelector('table.uir-list-body');
        }
        if (!tbl) return;

        var rows = tbl.querySelectorAll('tr.uir-list-row-tr');
        var seen = {};
        allRows.forEach(function(r) { seen[r.id] = true; });

        rows.forEach(function(tr) {
            var cells = tr.querySelectorAll('td');
            if (cells.length < 7) return;

            // Column order: [0]ID [1]Name [2]Translate [3]FieldMap [4]Desc [5]Type [6]Owner [7]Created [8]Modified [9]ScriptID [10]Bundle [11]Access [12]Delete
            var id = cells[0].textContent.trim();
            if (!id || seen[id]) return;
            seen[id] = true;

            var nameCell = cells[1];
            var nameLink = nameCell.querySelector('a');
            var name = nameLink ? nameLink.textContent.trim() : nameCell.textContent.trim();

            var type    = cells[5].textContent.trim();
            var owner   = cells[6].textContent.trim();
            var created = cells[7] ? cells[7].textContent.trim() : '';

            // Check if this row has a delete link (column 12)
            var canDelete = false;
            if (cells.length > 12) {
                var delCell = cells[12];
                canDelete = delCell.innerHTML.indexOf('method=delete') >= 0;
            }

            allRows.push({
                id: id,
                name: name,
                type: type,
                owner: owner,
                created: created,
                canDelete: canDelete
            });
        });
    }

    // ─── Populate filter dropdowns ───
    function populateFilters() {
        var owners = unique(allRows.map(function(r) { return r.owner; })).sort();
        var types  = unique(allRows.map(function(r) { return r.type; })).sort();

        var selOwner = document.getElementById('fOwner');
        selOwner.innerHTML = '<option value="">— ทั้งหมด (' + owners.length + ' คน) —</option>';
        owners.forEach(function(o) {
            var cnt = allRows.filter(function(r) { return r.owner === o; }).length;
            var opt = document.createElement('option');
            opt.value = o;
            opt.textContent = o + ' (' + cnt + ')';
            selOwner.appendChild(opt);
        });

        var selType = document.getElementById('fType');
        selType.innerHTML = '<option value="">— ทั้งหมด —</option>';
        types.forEach(function(t) {
            var opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            selType.appendChild(opt);
        });
    }

    // ─── Filter & render ───
    function applyFilter() {
        var owner = document.getElementById('fOwner').value;
        var type  = document.getElementById('fType').value;
        var name  = (document.getElementById('fName').value || '').toLowerCase();

        filtered = allRows.filter(function(r) {
            if (owner && r.owner !== owner) return false;
            if (type  && r.type !== type) return false;
            if (name  && r.name.toLowerCase().indexOf(name) < 0) return false;
            return true;
        });

        renderTable();
    }

    function renderTable() {
        var tb = document.getElementById('bdiTb');
        tb.innerHTML = '';
        filtered.forEach(function(r, i) {
            var tr = document.createElement('tr');
            tr.id = 'r-' + r.id;
            tr.innerHTML =
                '<td style="text-align:center;"><input type="checkbox" class="chk" data-id="' + r.id + '" onchange="bdiUpdateCnt()"' +
                    (r.canDelete ? '' : ' title="ไม่มีสิทธิ์ลบ (ไม่ใช่ owner)" style="opacity:.4"') + '></td>' +
                '<td>' + (i + 1) + '</td>' +
                '<td>' + esc(r.id) + '</td>' +
                '<td>' + esc(r.name) + '</td>' +
                '<td>' + esc(r.type) + '</td>' +
                '<td>' + esc(r.owner) + '</td>' +
                '<td style="font-size:11px;color:#777;">' + esc(r.created) + '</td>' +
                '<td class="st" id="st-' + r.id + '"></td>';
            tb.appendChild(tr);
        });
        updateCount();
    }

    // ─── Select / Deselect ───
    function toggleAll(checked) {
        var boxes = document.getElementById('bdiTb').querySelectorAll('.chk');
        if (typeof checked !== 'boolean') {
            var any = Array.prototype.some.call(boxes, function(cb) { return !cb.checked; });
            checked = any;
            document.getElementById('chkAll').checked = checked;
        }
        boxes.forEach(function(cb) { cb.checked = checked; });
        updateCount();
    }

    function updateCount() {
        var n = document.getElementById('bdiTb').querySelectorAll('.chk:checked').length;
        document.getElementById('bdiCount').textContent = 'เลือก ' + n + ' รายการ';
        document.getElementById('bdiDelBtn').disabled = n === 0;
    }

    // ─── Delete ───
    async function doDelete() {
        var boxes = Array.prototype.slice.call(document.getElementById('bdiTb').querySelectorAll('.chk:checked'));
        var ids = boxes.map(function(cb) { return cb.dataset.id; });
        if (ids.length === 0) return;

        if (!confirm('⚠️ ยืนยันลบ ' + ids.length + ' templates?\\n\\nการลบไม่สามารถย้อนกลับได้!')) return;

        // Disable controls
        document.getElementById('bdiDelBtn').disabled = true;
        document.getElementById('fOwner').disabled = true;
        document.getElementById('fType').disabled = true;
        document.getElementById('fName').disabled = true;

        var progWrap = document.getElementById('bdiProg');
        var progBar  = document.getElementById('bdiBar');
        var progLog  = document.getElementById('bdiLog');
        progWrap.style.display = 'block';
        progLog.innerHTML = '';

        var done = 0, ok = 0, fail = 0;
        var total = ids.length;

        setStatus('loading', '⏳ กำลังลบ 0/' + total + '...');

        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            var stCell = document.getElementById('st-' + id);
            var row    = document.getElementById('r-' + id);
            if (stCell) stCell.textContent = '⏳...';

            try {
                var resp = await fetch(
                    BASE + '?method=delete&recid=' + id,
                    { credentials: 'same-origin' }
                );
                // NS returns 200 even on success (redirects back to list)
                // We consider any 2xx/3xx as success
                if (resp.ok || resp.status === 302) {
                    ok++;
                    if (stCell) stCell.innerHTML = '<span style="color:#28a745;">✅</span>';
                    if (row) row.classList.add('deleted');
                    addLog('✅ ID ' + id + ' — ลบสำเร็จ');
                } else {
                    fail++;
                    if (stCell) stCell.innerHTML = '<span style="color:#dc3545;">❌ ' + resp.status + '</span>';
                    if (row) row.classList.add('err');
                    addLog('❌ ID ' + id + ' — HTTP ' + resp.status);
                }
            } catch (e) {
                fail++;
                if (stCell) stCell.innerHTML = '<span style="color:#dc3545;">❌</span>';
                if (row) row.classList.add('err');
                addLog('❌ ID ' + id + ' — ' + e.message);
            }

            done++;
            var pct = Math.round(done / total * 100);
            progBar.style.width = pct + '%';
            progBar.textContent = done + '/' + total + ' (' + pct + '%)';
            setStatus('loading', '⏳ กำลังลบ ' + done + '/' + total + '...');

            // Delay between requests
            if (done < total) await sleep(500);
        }

        // Re-enable
        document.getElementById('fOwner').disabled = false;
        document.getElementById('fType').disabled = false;
        document.getElementById('fName').disabled = false;

        if (fail === 0) {
            setStatus('success', '✅ ลบสำเร็จทั้งหมด ' + ok + ' รายการ');
        } else {
            setStatus('error', '⚠️ สำเร็จ ' + ok + ' / ล้มเหลว ' + fail);
        }

        addLog('─── สรุป: สำเร็จ ' + ok + ' / ล้มเหลว ' + fail + ' / ทั้งหมด ' + total + ' ───');

        // Remove deleted from allRows
        var deletedSet = {};
        document.querySelectorAll('.deleted').forEach(function(tr) {
            var c = tr.querySelector('.chk');
            if (c) deletedSet[c.dataset.id] = true;
        });
        allRows = allRows.filter(function(r) { return !deletedSet[r.id]; });
    }

    // ─── Helpers ───
    function setStatus(cls, msg) {
        var el = document.getElementById('bdiStatus');
        el.className = 'bdi-status ' + cls;
        el.innerHTML = msg;
    }

    function addLog(msg) {
        var el = document.getElementById('bdiLog');
        el.innerHTML += msg + '<br>';
        el.scrollTop = el.scrollHeight;
    }

    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function unique(arr) {
        var s = {};
        return arr.filter(function(v) { if (!v || s[v]) return false; s[v] = true; return true; });
    }

})();
</script>
        `;
    }

    return { onRequest };
});