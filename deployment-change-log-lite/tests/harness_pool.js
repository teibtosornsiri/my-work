/**
 * harness_pool.js — รัน REPORT_JS (browser side) ใน node ด้วย DOM/fetch ปลอม
 * ตรวจ: ดึงครบทุกวันคนละครั้ง · concurrency ไม่เกินค่าที่ตั้ง · render ครั้งเดียวตอนจบ · กดหยุดแล้วยังสรุปผลบางส่วน
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.DLL_DIR || path.resolve(__dirname, '..');
const UIC = path.resolve(__dirname, '../../report-ci/Lib_Report_UI.js');
const CONFIG = process.env.HARNESS_CONFIG || path.resolve(__dirname, 'fixture-config.js');

const queryModule = { runSuiteQL: () => ({ asMappedResults: () => [] }), runSuiteQLPaged: () => ({ pageRanges: [], fetch: () => ({ data: { asMappedResults: () => [] } }) }) };
const runtimeModule = { getCurrentScript: () => ({ id: 'cs', deploymentId: 'cd' }), getCurrentUser: () => ({ id: 1, getPreference: () => 'DD/MM/YYYY' }) };
const formatModule = { Type: { DATE: 'date' }, parse: () => new Date(2026, 9, 1), format: ({ value }) => '01/10/2026' };
const urlModule = { resolveScript: () => 'https://a/scriptlet.nl?script=1&deploy=1' };
const widget = () => ({ createForm: () => ({ fields: {}, addField({ id }) { const f = { id, defaultValue: '' }; this.fields[id] = f; return f; } }), FieldType: { INLINEHTML: 'x' } });

const cache = {};
function load(file) {
  const abs = path.resolve(file);
  if (cache[abs]) return cache[abs];
  const src = fs.readFileSync(abs, 'utf8');
  let out;
  new Function('define', 'log', src)((deps, factory) => {
    const resolved = deps.map(d => {
      if (d === 'N/query') return queryModule;
      if (d === 'N/runtime') return runtimeModule;
      if (d === 'N/format') return formatModule;
      if (d === 'N/url') return urlModule;
      if (d === 'N/ui/serverWidget') return widget();
      if (d.indexOf('N/') === 0) return {};
      const p = path.resolve(path.dirname(abs), d) + '.js';
      if (/TB_DLL_Config\.js$/.test(p) && CONFIG) return load(CONFIG);
      return load(fs.existsSync(p) ? p : UIC);
    });
    out = factory.apply(null, resolved);
  }, { audit: () => {}, error: () => {}, debug: () => {} });
  cache[abs] = out;
  return out;
}

const SL = load(path.join(DIR, 'TB_DLL_SL_Report.js'));

function shellHtml(params) {
  const ctx = { request: { parameters: params || {}, body: '' }, response: { setHeader() {}, write(s) { this.out = (this.out || '') + s; }, writePage(f) { const x = f.fields.custpage_rui; this.out = x ? x.defaultValue : ''; } } };
  SL.onRequest(ctx);
  return ctx.response.out;
}

function extract(html, marker) {
  const parts = html.split('<script>');
  return parts.filter(x => x.indexOf(marker) > 0)[0].split('</script>')[0];
}

/** รัน REPORT_JS ด้วย DOM/fetch ปลอม แล้วคืนสถิติ */
function runReport(html, opts) {
  const o = Object.assign({ conc: 3, days: 12, stopAfter: 0, failDays: [] }, opts || {});
  const boot = JSON.parse(html.match(/window\.TBDLL_REPORT=(\{[\s\S]*?\});<\/script>/)[1]);
  boot.days = Array.from({ length: o.days }, (_, i) => '2026-10-' + String((i % 28) + 1).padStart(2, '0') + '#' + i);
  boot.conc = o.conc;

  const stats = { requested: [], maxActive: 0, active: 0, renders: [], statusLog: [] };
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, innerHTML: '', textContent: '', value: '', style: {}, hidden: false,
    addEventListener(ev, fn) { (this._h = this._h || {})[ev] = fn; },
    querySelectorAll: () => [], querySelector: () => null,
    getAttribute: () => '', setAttribute: () => {}, closest: () => null,
    _fire(ev, arg) { if (this._h && this._h[ev]) this._h[ev](arg || {}); }
  });

  const fakeFetch = (url, init) => {
    stats.active++;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    if (/ajax=day/.test(url)) {
      const d = String(url).split('day=')[1];
      stats.requested.push(d);
      if (o.stopAfter && stats.requested.length === o.stopAfter) els['tbdll-stop'] && els['tbdll-stop']._fire('click');
      const fail = o.failDays.indexOf(d) >= 0;
      return new Promise(res => setTimeout(() => {
        stats.active--;
        res({ text: () => Promise.resolve(JSON.stringify(fail
          ? { ok: false, error: 'boom' }
          : { ok: true, day: d, changes: [{ objType: 'Script', objId: '1', actor: '9', ts: 1, fields: ['F'], details: [], scripts: [], scriptText: 'x' }], noteRows: 2, ms: 10 })) });
      }, o.delay || 1));
    }
    stats.active--;
    return Promise.resolve({
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        html: '<div>RESULT ' + statics.changes + '</div>',
        csvGroup: 'g',
        csvAll: 'a'
      }))
    });
  };
  const statics = { changes: 0 };

  const sandbox = {
    window: { TBDLL_REPORT: boot },
    document: {
      getElementById: el,
      addEventListener: () => {},
      querySelectorAll: () => []
    },
    fetch: fakeFetch,
    setInterval: () => 1,
    clearInterval: () => {},
    URL: { createObjectURL: () => 'blob:' },
    Blob: function () {},
    Date, JSON, Math, Number, String, Object, Array, encodeURIComponent, console,
    setTimeout
  };
  sandbox.window.addEventListener = () => {};

  const code = extract(html, 'function pump()');
  // render ส่ง changes ไป POST — นับจำนวนการเรียก
  const origFetch = sandbox.fetch;
  sandbox.fetch = (u, i) => {
    if (/ajax=render/.test(u)) {
      try { statics.changes = JSON.parse(i.body).changes.length; } catch (e) { statics.changes = -1; }
      stats.renders.push(statics.changes);
    }
    return origFetch(u, i);
  };

  const fn = new Function('window', 'document', 'fetch', 'setInterval', 'clearInterval', 'URL', 'Blob', 'setTimeout', code);
  fn(sandbox.window, sandbox.document, sandbox.fetch, sandbox.setInterval, sandbox.clearInterval, sandbox.URL, sandbox.Blob, sandbox.setTimeout);
  return { stats, boot, el };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  ← ' + x : '')); } };

  const html = shellHtml({ f_from: '01/10/2026', f_to: '31/10/2026' });
  console.log('days ใน boot:', JSON.parse(html.match(/window\.TBDLL_REPORT=(\{[\s\S]*?\});<\/script>/)[1]).days.length);

  // --- A) ปกติ 12 วัน, conc 3
  console.log('\n--- A) 12 วัน · conc 3 ---');
  const A = runReport(html, { days: 12, conc: 3, delay: 2 });
  await wait(400);
  ok('ดึงครบ 12 วัน', A.stats.requested.length === 12, A.stats.requested.length);
  ok('แต่ละวันถูกเรียกครั้งเดียว', new Set(A.stats.requested).size === 12, new Set(A.stats.requested).size);
  ok('concurrency ไม่เกิน 3', A.stats.maxActive <= 3, A.stats.maxActive);
  ok('มี concurrency มากกว่า 1 (ทำงานขนานจริง)', A.stats.maxActive > 1, A.stats.maxActive);
  ok('render ครั้งเดียว', A.stats.renders.length === 1, A.stats.renders.length);
  ok('render ด้วยข้อมูลครบ 12 รายการ', A.stats.renders[0] === 12, A.stats.renders[0]);

  // --- B) conc 1 = ทีละวัน
  console.log('\n--- B) conc 1 ---');
  const B = runReport(html, { days: 5, conc: 1, delay: 1 });
  await wait(300);
  ok('conc 1 → ทีละคำขอ', B.stats.maxActive === 1, B.stats.maxActive);
  ok('ครบ 5 วัน', B.stats.requested.length === 5, B.stats.requested.length);

  // --- C) วันที่พัง 2 วัน
  console.log('\n--- C) 2 วันดึงไม่สำเร็จ ---');
  const C = runReport(html, { days: 6, conc: 2, delay: 1, failDays: ['2026-10-02#1', '2026-10-03#2'] });
  await wait(1200);
  ok('ยังดึงวันอื่นครบ (วันละครั้ง + retry 2 ครั้งของวันที่พัง)', new Set(C.stats.requested).size === 6, new Set(C.stats.requested).size);
  ok('วันที่พังถูก retry 3 ครั้งรวม', C.stats.requested.filter(d => d === '2026-10-02#1').length === 3, C.stats.requested.filter(d => d === '2026-10-02#1').length);
  ok('render ยังเกิดขึ้น (ไม่ค้าง)', C.stats.renders.length === 1, C.stats.renders.length);
  ok('รายการที่สำเร็จ 4 รายการ', C.stats.renders[0] === 4, C.stats.renders[0]);

  // --- D) กดหยุดกลางคัน
  console.log('\n--- D) กดหยุดหลังคำขอที่ 3 ---');
  const D = runReport(html, { days: 20, conc: 2, delay: 2, stopAfter: 3 });
  await wait(600);
  ok('หยุดแล้วไม่ดึงวันใหม่ทั้งหมด', D.stats.requested.length < 20, D.stats.requested.length);
  ok('หยุดแล้วยังสรุปผล', D.stats.renders.length === 1, D.stats.renders.length);

  console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail ? 1 : 0);
})();
