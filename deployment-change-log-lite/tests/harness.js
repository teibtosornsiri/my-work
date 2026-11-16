/**
 * harness.js — รัน TB_DLL_* นอก NetSuite ด้วย define/N-* ปลอม
 * ใช้ตรวจ: ชื่อ record type ที่อ่านรู้เรื่อง · objectDetail · ปุ่มดูรายละเอียด · fetch แบบขนาน
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.DLL_DIR || path.resolve(__dirname, '..');
const UIC = path.resolve(__dirname, '../../report-ci/Lib_Report_UI.js');
const CONFIG = process.env.HARNESS_CONFIG || path.resolve(__dirname, 'fixture-config.js');

const logs = [];
const queries = [];

// ---------- fake SuiteQL ----------
const DB = {
  grouped: [
    { recordid: 6883, recordtypeid: -418, actor: 24079204, role: 3, context: 'UI', tsmin: '2026-10-01 17:44', cnt: 2, f1: 'SUITELETDEPLOY.STATUS', f2: 'SUITELETDEPLOY.TITLE' }
  ],
  detail: [
    { id: 1, field: 'SUITELETDEPLOY.STATUS', context: 'UI', oldvalue: 'Testing', newvalue: 'Released', actor: 24079204, role: 3, ts: '2026-10-01 17:44:10' },
    { id: 2, field: 'SUITELETDEPLOY.TITLE', context: 'UI', oldvalue: 'old', newvalue: 'TWMS - Inventory Counting Plan', actor: 24079204, role: 3, ts: '2026-10-01 17:44:11' }
  ],
  deployment: [{ id: 6883, script: 3476, scriptid: 'customdeploy1', title: 'Deploy: TWMS', recordtype: 'CUSTOMRECORD_TWMS_INVENTORYCOUNTINGPLAN', isdeployed: 'T' }],
  script: [{ id: 3476, scriptid: 'customscript_da_ue_invenoty_count', name: 'DA - UE Inventory Counting Plan', scripttype: 'USEREVENT', scriptfile: '' }],
  entity: [{ id: 24079204, entityid: '24079204', firstname: 'Sornsiri', lastname: 'Teibto', altname: '' }],
  role: [{ id: 3, name: 'Administrator' }],
  customrecordtype: [
    { scriptid: 'customrecord_twms_inventorycountingplan', name: 'TWMS - Inventory Counting Plan' },
    { scriptid: 'customrecord_ams_revaluation', name: 'AMS Revaluation (from table)' }
  ],
  customlist: [],
  mediaitemfolder: [],
  file: []
};

function pick(sql, params) {
  const s = String(sql);
  if (/sn\.recordid = \?/i.test(s)) return DB.detail;
  if (/GROUP BY sn\.recordid/i.test(s)) return DB.grouped;
  if (/FROM scriptdeployment/i.test(s)) return DB.deployment;
  if (/FROM script WHERE/i.test(s)) return DB.script;
  if (/FROM entity WHERE/i.test(s)) return DB.entity;
  if (/FROM role WHERE/i.test(s)) return DB.role;
  if (/FROM customrecordtype/i.test(s)) {
    const like = (params || []).filter(p => typeof p === 'string' && p.indexOf('%') === 0)[0];
    if (!like) return DB.customrecordtype;
    const core = like.replace(/%/g, '').toUpperCase();
    return DB.customrecordtype.filter(r => String(r.scriptid).toUpperCase().replace(/_/g, '').indexOf(core) >= 0);
  }
  if (/FROM customlist/i.test(s)) return DB.customlist;
  if (/FROM mediaitemfolder/i.test(s)) return DB.mediaitemfolder;
  if (/FROM file WHERE/i.test(s)) return DB.file;
  return [];
}

const queryModule = {
  runSuiteQL({ query, params }) {
    queries.push({ query, params });
    return { asMappedResults: () => pick(query, params).slice() };
  },
  runSuiteQLPaged({ query, params }) {
    queries.push({ query, params });
    const rows = pick(query, params).slice();
    return {
      pageRanges: [{ index: 0 }],
      fetch: () => ({ data: { asMappedResults: () => rows } })
    };
  }
};

const runtimeModule = {
  getCurrentScript: () => ({ id: 'customscript_tbdll_sl_report', deploymentId: 'customdeploy_tbdll_sl_report' }),
  getCurrentUser: () => ({ id: 24079204, getPreference: () => 'DD/MM/YYYY' })
};

const formatModule = {
  Type: { DATE: 'date' },
  parse: ({ value }) => {
    const m = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) throw new Error('bad date');
    return new Date(+m[3], +m[2] - 1, +m[1]);
  },
  format: ({ value }) => {
    const p = n => String(n).padStart(2, '0');
    return p(value.getDate()) + '/' + p(value.getMonth() + 1) + '/' + value.getFullYear();
  }
};

const urlModule = { resolveScript: () => 'https://acct.app.netsuite.com/app/site/hosting/scriptlet.nl?script=3680&deploy=1' };

function fakeWidget() {
  const form = {
    fields: {},
    addField({ id }) { const f = { id, defaultValue: '' }; this.fields[id] = f; return f; },
    addButton() { return {}; }
  };
  return { createForm: () => form, FieldType: { INLINEHTML: 'inlinehtml' } };
}

// ---------- define shim ----------
const cache = {};

function load(file) {
  const abs = path.resolve(file);
  if (cache[abs]) return cache[abs];
  const src = fs.readFileSync(abs, 'utf8');
  let out;
  const define = (deps, factory) => {
    const resolved = deps.map(d => {
      if (d === 'N/query') return queryModule;
      if (d === 'N/runtime') return runtimeModule;
      if (d === 'N/format') return formatModule;
      if (d === 'N/url') return urlModule;
      if (d === 'N/ui/serverWidget') return fakeWidget();
      if (d.indexOf('N/') === 0) return {};
      const p = path.resolve(path.dirname(abs), d) + '.js';
      if (/TB_DLL_Config\.js$/.test(p)) return load(CONFIG);
      return load(fs.existsSync(p) ? p : UIC);
    });
    out = factory.apply(null, resolved);
  };
  const log = { audit: (t, d) => logs.push([t, d]), error: (t, d) => logs.push(['ERR ' + t, d]), debug: () => {} };
  new Function('define', 'log', src)(define, log);
  cache[abs] = out;
  return out;
}

const L = load(path.join(DIR, 'TB_DLL_Lib.js'));
const SL = load(path.join(DIR, 'TB_DLL_SL_Report.js'));
const CFG = L.CFG;

// ---------- helpers ----------
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  ← ' + extra : '')); }
}
function ctx(params, body) {
  const res = {};
  return {
    request: { parameters: params || {}, body: body || '' },
    response: {
      headers: {},
      out: '',
      setHeader(h) { Object.assign(this.headers, h); },
      write(s) { this.out += s; },
      writePage(form) { const f = form.fields && form.fields.custpage_rui; this.out += (f ? f.defaultValue : ''); }
    },
    res
  };
}

// ================= 1) ชื่อ record type ที่อ่านรู้เรื่อง =================
console.log('\n--- 1) record type name ---');
ok('map มาตรฐาน JOURNALENTRY', L.recordTypeName('JOURNALENTRY') === 'Journal Entry', L.recordTypeName('JOURNALENTRY'));
ok('fallback แปลง _ เป็นช่องว่าง', L.recordTypeName('CUSTOMRECORD_SOMETHING_NEW') === 'Something New', L.recordTypeName('CUSTOMRECORD_SOMETHING_NEW'));

L.fetchRecordTypeNames(['CUSTOMRECORD_TWMS_INVENTORYCOUNTINGPLAN']);
ok('query customrecordtype ถูกเรียก', queries.some(q => /FROM customrecordtype/.test(q.query)));
ok('ดึงชื่อจริงจาก customrecordtype', L.recordTypeName('CUSTOMRECORD_TWMS_INVENTORYCOUNTINGPLAN') === 'TWMS - Inventory Counting Plan', L.recordTypeName('CUSTOMRECORD_TWMS_INVENTORYCOUNTINGPLAN'));
ok('cache: query รอบสองไม่ยิงซ้ำ', (() => { const n = queries.filter(q => /customrecordtype/.test(q.query)).length; L.fetchRecordTypeNames(['CUSTOMRECORD_TWMS_INVENTORYCOUNTINGPLAN']); return queries.filter(q => /customrecordtype/.test(q.query)).length === n; })());

// ประเภทที่เจอจริงใน DA แต่เดิมหลุดเป็นคำติดกัน
ok('CUSTOMERREFUND → Customer Refund', L.recordTypeName('CUSTOMERREFUND') === 'Customer Refund', L.recordTypeName('CUSTOMERREFUND'));
ok('ADVINTERCOMPANYJOURNALENTRY → Intercompany Journal Entry', L.recordTypeName('ADVINTERCOMPANYJOURNALENTRY') === 'Intercompany Journal Entry', L.recordTypeName('ADVINTERCOMPANYJOURNALENTRY'));
ok('EXPENSEREPORT → Expense Report', L.recordTypeName('EXPENSEREPORT') === 'Expense Report', L.recordTypeName('EXPENSEREPORT'));
ok('RETURNAUTHORIZATION → Return Authorization', L.recordTypeName('RETURNAUTHORIZATION') === 'Return Authorization', L.recordTypeName('RETURNAUTHORIZATION'));
ok('WORKORDERCOMPLETION → Work Order Completion', L.recordTypeName('WORKORDERCOMPLETION') === 'Work Order Completion', L.recordTypeName('WORKORDERCOMPLETION'));
ok('WORKORDERCLOSE → Work Order Close', L.recordTypeName('WORKORDERCLOSE') === 'Work Order Close', L.recordTypeName('WORKORDERCLOSE'));
ok('WORKORDERISSUE → Work Order Issue', L.recordTypeName('WORKORDERISSUE') === 'Work Order Issue', L.recordTypeName('WORKORDERISSUE'));

// ชื่อที่ตั้งเองใน Config ชนะทุกทาง (ใช้กับ record ของ SuiteApp ที่หาในตารางไม่เจอ)
ok('RECORD_TYPE_NAMES ใน Config ชนะ STD map', L.recordTypeName('AMS_WRITEOFF') === 'AMS Write-Off', L.recordTypeName('AMS_WRITEOFF'));
ok('override ไม่ต้องยิง query', queries.filter(q => /customrecordtype/.test(q.query)).length === queries.length - queries.filter(q => !/customrecordtype/.test(q.query)).length);

// record type ของ SuiteApp ที่ id ไม่มี prefix และขีดล่างไม่ตรงกับตาราง → ต้องเจอทาง LIKE เท่านั้น
L.fetchRecordTypeNames(['AMS_REVALUATION']);
ok('query ลองเติม prefix CUSTOMRECORD_ ให้ id ที่ไม่มี prefix', queries.some(q => /customrecordtype/.test(q.query) && /CUSTOMRECORD_AMS_REVALUATION/.test(q.query)));
ok('LIKE แบบตัด _ ออกเจอชื่อในตาราง', L.recordTypeName('AMS_REVALUATION') === 'AMS Revaluation (from table)', L.recordTypeName('AMS_REVALUATION'));

// ================= 2) run() ต่อวัน + scriptText =================
console.log('\n--- 2) L.run(day) ---');
const res = L.run('2026-10-01', '2026-10-01');
ok('ได้ 1 change', res.total === 1, res.total);
ok('scriptText ใช้ชื่อ record type ที่อ่านรู้เรื่อง', /deploy บน TWMS - Inventory Counting Plan/.test(res.changes[0].scriptText), res.changes[0].scriptText);
ok('scriptText ไม่มี CUSTOMRECORD_', res.changes[0].scriptText.indexOf('CUSTOMRECORD_') < 0, res.changes[0].scriptText);
ok('node ในกลุ่มมี objId/objType (สำหรับปุ่มดูรายละเอียด)', (() => {
  const g = res.groups[0];
  const n = g.children.filter(x => x.objType === 'Script Deployment')[0];
  return !!n && n.objId === '6883' && n.objType === 'Script Deployment';
})());
ok('group.deployedOn เป็นชื่ออ่านรู้เรื่อง', res.groups[0].deployedOn.join(',') === 'TWMS - Inventory Counting Plan', res.groups[0].deployedOn.join(','));

// ================= 3) objectDetail =================
console.log('\n--- 3) objectDetail ---');
const d = L.objectDetail('Script Deployment', '6883', '2026-10-01', '2026-10-01');
ok('ได้ 2 แถว', d.rows.length === 2, d.rows.length);
ok('มี old → new', d.rows[0].oldValue === 'Testing' && d.rows[0].newValue === 'Released');
ok('มีชื่อผู้แก้', d.rows[0].actorName === 'Sornsiri Teibto (24079204)', d.rows[0].actorName);
ok('มีชื่อ role', d.rows[0].roleName === 'Administrator', d.rows[0].roleName);
ok('กรอง recordtypeid ของประเภทนั้น', queries.some(q => /sn\.recordid = \?/.test(q.query) && /recordtypeid IN \(-418\)/.test(q.query)));
ok('ไม่ truncated', d.truncated === false);

// ================= 4) shell: modal + conc + JS parses =================
console.log('\n--- 4) buildShell (HTML หน้าแรก) ---');
const c1 = ctx({});
SL.onRequest(c1);
const shell = c1.response.out;
ok('มีกล่อง tbdll-detail', shell.indexOf('id="tbdll-detail"') > 0);
ok('มี boot.conc', /"conc":3/.test(shell), (shell.match(/"conc":\d+/) || ['-'])[0]);
const m = shell.match(/window\.TBDLL_REPORT=(\{[\s\S]*?\});<\/script>/);
ok('boot JSON parse ได้', (() => { try { JSON.parse(m[1]); return true; } catch (e) { return false; } })());
const rjs = shell.split('<script>').filter(x => x.indexOf('function pump()') > 0)[0] || '';
ok('REPORT_JS มี pump/CONC', /function pump\(\)/.test(rjs) && /CONC=/.test(rjs));
ok('REPORT_JS syntax ใช้ได้', (() => { try { new Function(rjs.split('</script>')[0]); return true; } catch (e) { console.log('   syntax: ' + e.message); return false; } })());

// ================= 5) ajax=detail =================
console.log('\n--- 5) ajax=detail ---');
const c2 = ctx({ ajax: 'detail', type: 'Script Deployment', id: '6883', from: '2026-10-01', to: '2026-10-01' });
SL.onRequest(c2);
let j2 = {};
try { j2 = JSON.parse(c2.response.out); } catch (e) { /* ignore */ }
ok('ok=true', j2.ok === true, c2.response.out.slice(0, 200));
ok('html มีค่าเดิม/ใหม่', /Testing/.test(j2.html || '') && /Released/.test(j2.html || ''));
ok('id ผิดรูปแบบ → ok=false', (() => { const c = ctx({ ajax: 'detail', type: 'Script', id: 'abc', from: '2026-10-01', to: '2026-10-01' }); SL.onRequest(c); return JSON.parse(c.response.out).ok === false; })());

// ================= 6) ajax=render =================
console.log('\n--- 6) ajax=render ---');
const twoChanges = [
  { objType: 'Script', objId: '3476', objName: 'DA - UE Inventory Counting Plan', actor: '24079204', actorName: 'Sornsiri Teibto (24079204)', role: '3', roleName: 'Administrator', context: 'UI', ts: Date.parse('2026-10-02T03:00:00Z'), fields: ['SCRIPT.NAME'], details: [], scripts: [], scriptText: '' },
  { objType: 'Script Deployment', objId: '6883', objName: 'Deploy: TWMS', actor: '24079204', actorName: 'Sornsiri Teibto (24079204)', role: '3', roleName: 'Administrator', context: 'UI', ts: Date.parse('2026-10-01T03:00:00Z'), fields: ['SUITELETDEPLOY.STATUS'], details: [], scripts: [{ id: '3476', scriptid: 'customscript_da_ue_invenoty_count', name: 'DA - UE Inventory Counting Plan', type: 'User Event', deployedOn: ['CUSTOMRECORD_TWMS_INVENTORYCOUNTINGPLAN'], deployedOnText: ['TWMS - Inventory Counting Plan'] }], scriptText: 'x' }
];
const c3 = ctx({ ajax: 'render' }, JSON.stringify({ from: '2026-10-01', to: '2026-10-31', noteRows: 10, ms: 1000, changes: twoChanges }));
SL.onRequest(c3);
let j3 = {};
try { j3 = JSON.parse(c3.response.out); } catch (e) { /* ignore */ }
ok('ok=true', j3.ok === true, c3.response.out.slice(0, 300));
ok('มีปุ่ม data-obj', /data-obj="Script Deployment\|6883"/.test(j3.html || ''));
ok('diagram ใช้ชื่อ record type อ่านรู้เรื่อง', /TWMS - Inventory Counting Plan/.test(j3.html || ''));
ok('csv ตาม script มีคอลัมน์ Deployed On + ชื่ออ่านรู้เรื่อง', (j3.csvGroup || '').indexOf('TWMS - Inventory Counting Plan') > 0);
ok('csv ทุก log ครบ 2 แถว', (j3.csvAll || '').trim().split('\r\n').length === 4, (j3.csvAll || '').trim().split('\r\n').length);

// ================= 7) sortByTs =================
console.log('\n--- 7) เรียงตามเวลา ---');
ok('finish เรียงจากเก่าไปใหม่', (() => {
  const f = L.finish(twoChanges.slice(), {});
  return f.changes[0].ts < f.changes[1].ts;
})());

// ================= 8) log ที่เขียนออกมา =================
console.log('\n--- 8) audit log ---');
ok('มี TBDLL run', logs.some(l => /TBDLL run/.test(l[0])));
ok('ไม่มี fallback warning', !logs.some(l => /grouped query failed/.test(l[0] + l[1])));

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
