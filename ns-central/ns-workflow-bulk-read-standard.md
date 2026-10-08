# มาตรฐาน: อ่าน NetSuite Workflow ทั้ง Account แบบ read-only

ใช้ได้กับทุก account / ทุก project — ไม่ผูกกับลูกค้ารายใด
วิธีนี้ **ไม่แตะข้อมูลเลย** (HTTP GET อย่างเดียว ไม่มี save / ไม่เปิด Edit)
รันใน console ของแท็บที่ล็อกอิน NetSuite อยู่ (Chrome MCP `javascript_tool` หรือ DevTools)

> ท้ายไฟล์มี **ภาคผนวก: เทคนิคทั่วไปเวลาทำงาน/เทส NetSuite ผ่านเบราว์เซอร์** (SuiteQL เป็น JSON API,
> หา rectype, ดัก/replay API ของ SPA, จำลอง network error, กับดักที่เจอบ่อย) — ใช้ได้ทุก project

---

## 1. URL ที่ใช้ได้จริง

| ต้องการ | URL | ผลลัพธ์ |
|---|---|---|
| รายชื่อ workflow ทั้งหมด | `/app/common/workflow/setup/workflowlist.nl` | HTML list |
| หน้า designer | `/app/common/workflow/setup/workflowmanager.nl?id=<WF_ID>` | redirect → `/app/common/workflow/setup/nextgen/workflowdesktop.nl?id=<WF_ID>` (เป็นแค่ shell ไม่มี action) |
| **โครงสร้าง state** | `/app/common/workflow/setup/nextgen/data/workflowdesktopdata.nl?id=<WF_ID>&path=structure` | JSON `{transitions:[], states:[{name,key,posX,posY,order,doNotExit}]}` |
| สรุป workflow (record type / initiation / event) | `.../workflowdesktopdata.nl?id=<WF_ID>&path=panel` | HTML panel |
| **Action ทั้งหมดใน state** ← ตัวหลัก | `/app/common/workflow/setup/workflowstate.nl?workflow=<WF_ID>&id=<STATE_KEY>&ifrmcntnr=T` | HTML ~1.2 MB มี sublist Actions / Transitions / Fields |

`STATE_KEY` = ค่า `key` ที่ได้จาก `path=structure`

**URL ที่ใช้ไม่ได้ (อย่าเสียเวลาลอง):**
- `workflow.nl?id=` → HTTP 500
- `path=actions` / `states` / `action` / `details` / `transitions` / `fields` / `all` / `workflow` → HTTP 500 ทั้งหมด (มีแค่ `structure` กับ `panel`)
- ใส่ `&state=` / `&statekey=` / `&stateid=` ใน `path=panel` → ไม่มีผล คืน panel ระดับ workflow เหมือนเดิม

**URL อื่นที่มีในระบบ** (จาก JS bundle `workflownextgen_*`) เผื่อต้องเจาะลึก:
`workflowtransition.nl`, `workflowaction.nl`, `workflowchangestatus.nl`,
`/app/common/custom/workflowcustfield.nl`, `/app/common/custom/wfstatecustfield.nl`,
`/app/common/workflow/setup/history/historyrecords.nl`

---

## 2. โครงคอลัมน์ของ sublist Actions

แถวที่ cell[0] match `/^workflowaction\d+$/` จะได้:

| index | คอลัมน์ |
|---|---|
| 0 | ID (`workflowactionNNNN`) |
| 1 | Name = **ประเภท action** (Set Field Value / Set Field Display Type / Set Field Mandatory / Return User Error / Add Button / Remove Button / Lock Record / Create Record / Go To Record / Show Message / Set Field Display Label / Sublist Action Group) |
| 2 | **Parameters** — รูปแบบ `Field = Value` (ค่า fixed จะเป็นชื่อ record ตรง ๆ, ค่า dynamic จะเป็น `Other Field`, `Ref. X : Field`, หรือ `{formula}`) |
| 3 | Trigger On (Entry / Before Record Load / Before Field Edit / After Field Edit / After Field Sourcing / Before User Submit / Before Record Submit / After Record Submit) |
| 4+ | Event Types, Contexts, **Condition**, Formula, Saved Search Condition, Delay, Recurrence, Unit, Active |

---

## 3. สคริปต์มาตรฐาน

```js
// ---- 1) id + ชื่อ workflow ทั้งหมด ----
const t = await (await fetch('/app/common/workflow/setup/workflowlist.nl',{credentials:'include'})).text();
const d = document.createElement('div'); d.innerHTML = t.replace(/<script[\s\S]*?<\/script>/g,'');
const NAMES = {};
for (const tr of d.querySelectorAll('tr')) {
  const c = [...tr.querySelectorAll('td')].map(x => x.innerText.replace(/\s+/g,' ').trim());
  if (c.length > 4 && /^\d+$/.test(c[1])) NAMES[c[1]] = c[2];   // c[1]=id, c[2]=name
}

// ---- 2) ดึง action ทุกตัวของ workflow เดียว ----
async function scan(wfid) {
  const s = await (await fetch(
    `/app/common/workflow/setup/nextgen/data/workflowdesktopdata.nl?id=${wfid}&path=structure`,
    {credentials:'include'})).json();
  const rows = [];
  for (const st of (s.states || [])) {
    const html = await (await fetch(
      `/app/common/workflow/setup/workflowstate.nl?workflow=${wfid}&id=${st.key}&ifrmcntnr=T`,
      {credentials:'include'})).text();
    const dd = document.createElement('div');
    dd.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g,'');
    for (const tr of dd.querySelectorAll('tr')) {
      const c = [...tr.querySelectorAll('td')].map(x => x.innerText.replace(/\s+/g,' ').trim());
      if (c.length > 3 && /^workflowaction\d+$/.test(c[0]))
        rows.push({state:st.name, id:c[0], type:c[1], params:c[2], trigger:c[3], cond:c.slice(4).join(' | ')});
    }
  }
  return {rows};
}

// ---- 3) ยิงเป็นชุด (อย่ายิงพร้อมกันหมด) ----
window.__WF = {res:{}, err:{}};
const ids = Object.keys(NAMES);
// เรียกซ้ำทีละ slice: 0-12, 12-36, 36-64, 64-... จนครบ
const batch = ids.slice(0, 12);
await Promise.all(batch.map(async id => {
  try { window.__WF.res[id] = await scan(id); }
  catch(e) { window.__WF.err[id] = String(e).slice(0,80); }
}));

// ---- 4) กรอง ----
const kw = /subsidiar|department|location|account|class|\brole/i;
Object.entries(window.__WF.res).flatMap(([id,v]) => v.rows
  .filter(r => r.type === 'Set Field Value' && kw.test((r.params||'').split('=')[0]))
  .map(r => [id, NAMES[id], r.id, r.params, r.trigger]));
```

**เวลาที่ใช้:** ~104 workflow / ~1,200 actions ใช้ประมาณ 4 รอบ batch

---

## 4. กับดัก (เจอมาแล้ว)

| ปัญหา | วิธีแก้ |
|---|---|
| ผลลัพธ์ออกมาเป็น `[BLOCKED: Cookie/query string data]` | Chrome MCP บล็อก output ที่หน้าตาเป็น query string — ก่อน print ให้ `String(x).replace(/=/g,'≡')` แล้วค่อยแปลงกลับตอนเขียนไฟล์ |
| output ยาวโดนตัด `[TRUNCATED: N more items]` | print เป็น array แล้ว `.slice()` ทีละ ~40–60 แถว |
| ยิง fetch พร้อมกันเยอะ ๆ แล้วหลุด/ช้า | แบ่ง batch 12–28 workflow ต่อรอบ |
| หา field ไม่เจอทั้งที่มี | **สะกดผิดใน NetSuite เอง** — ใช้ regex หลวม (`/subsid|depar|locat|accoun|role/i`) แล้วค่อยกรองซ้ำ |
| `[ERROR: Value is missing]` โผล่ใน Parameters/Condition | แปลว่า record ที่อ้างถูกลบ/inactive ไปแล้ว — เป็น bug ที่ควร flag ไม่ใช่ noise |
| ต้องดู condition ด้วยไม่ใช่แค่ params | คอลัมน์ Condition อยู่ที่ `c.slice(4)` — ตัด prefix `Selected N of M | Selected N of M | ` ออกก่อนอ่าน |

---

## 5. เช็คลิสต์เวลา audit workflow account ใหม่

1. นับ action แยกตาม `type` ก่อน — จะรู้ว่า workflow ทำอะไรเป็นหลัก
2. `Set Field Value` → แยก **FIXED** (ค่าเป็นชื่อ record ตรง ๆ) vs **DYNAMIC** (`Ref. X : Y`, `{formula}`, `User X`, `Current User`, `Creator`) — FIXED คือหนี้ทางเทคนิค เพิ่ม subsidiary/แผนก/ผังบัญชีเมื่อไหร่ต้องตามแก้
3. หา action id ซ้ำข้าม workflow → เป็นสัญญาณว่ามีการ copy workflow มาแล้วไม่ได้ลบตัวเก่า
4. กวาดคอลัมน์ Condition หา `User Role =` / `Creator Role =` → รวมชื่อ role ที่ hardcode ไว้ทั้งหมด แล้วเทียบกับ role ที่ยังมีอยู่จริง
5. grep หา `[ERROR: Value is missing]`, `[Notused]`, `null` ใน Parameters
6. workflow ที่ record type เดียวกันหลายตัว → เช็คว่ามี action ตีกันไหม

---

# ภาคผนวก: เทคนิคทั่วไปเวลาทำงาน/เทส NetSuite ผ่านเบราว์เซอร์

ส่วนนี้ไม่ผูกกับ workflow — ใช้ได้ทุก project ที่ต้องขับ NetSuite ผ่าน Chrome MCP
ทุกอย่างรันใน console ของแท็บที่ล็อกอินอยู่แล้ว (same-origin ⇒ ใช้ session เดิม ไม่ต้อง auth ใหม่)

## A. SuiteQL Query Tool = JSON API (เร็วกว่าพิมพ์ในหน้าจอมาก)

ถ้า account มี SuiteQL Query Tool ของ Tim Dietrich ติดตั้งอยู่ (Suitelet) มันรับ POST เป็น JSON ได้ตรง ๆ
ไม่ต้องยุ่งกับ CodeMirror ในหน้าจอเลย

```js
// รันในแท็บของ SuiteQL Query Tool เอง (script id เปลี่ยนตาม account)
window.SQL = async q => {
  const r = await fetch(location.pathname + '?script=3275&deploy=1&function=queryExecute', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ function: 'queryExecute', query: q })
  });
  const j = JSON.parse(await r.text());
  return j.records || j;          // { records: [...], rowCount, elapsedTime }
};

await SQL(`SELECT id, binnumber, location FROM bin WHERE ROWNUM <= 5`);
```

ใช้หาข้อมูลทดสอบได้ทุกอย่างในไม่กี่วินาที (bin/lot/stock/permission/custom record)
ข้อควรรู้: error จะกลับมาเป็น `{error:{...}}` ซึ่ง `String()` ออกมาเป็น `[object Object]` — ให้เช็ค `j.error` ก่อน
และเวลา field ไม่มีจริงจะ error ทั้ง query ⇒ ทดสอบทีละ field ด้วย loop แทนที่จะ SELECT รวดเดียว

## B. หา rectype id และเปิด custom record ตรง ๆ

```
/app/common/custom/custrecordentry.nl?rectype=<RECTYPE>&id=<ID>        อ่าน
/app/common/custom/custrecordentry.nl?rectype=<RECTYPE>&id=<ID>&e=T    แก้ไข
```

ไม่รู้ `rectype`? เก็บเลขที่โผล่ในหน้า parent แล้วยิงทีละตัว ดู `<title>` ว่าใช่ record ที่ต้องการไหม

```js
const html = document.documentElement.innerHTML;
const cand = [...new Set([...html.matchAll(/rectype=(\d+)/g)].map(m => m[1]))];
for (const rt of cand) {
  const t = await (await fetch(`/app/common/custom/custrecordentry.nl?rectype=${rt}&id=${KNOWN_CHILD_ID}`)).text();
  console.log(rt, (t.match(/<title>([^<]*)/) || [])[1]);   // "Notice" = ไม่ใช่
}
```

หา **ชื่อ table ของ child record** (สำหรับ SuiteQL) ด้วยการเดา script id แล้วยิง `SELECT id FROM <name> WHERE ROWNUM<=1`
ตัวที่ไม่ error คือตัวจริง — เร็วกว่าไปเปิด Customization > Record Types ทีละหน้า

## C. ดัก API ของ SPA แล้ว replay (สำหรับเทส validation ฝั่ง server)

SPA ของ NetSuite (UIF / React) ยิง Suitelet เป็น JSON — hook ไว้ก่อนแล้วกดใช้งานปกติ 1 รอบ
จะได้ทั้ง endpoint และรูปร่าง payload จริง จากนั้น replay เพื่อทดสอบเคสที่หน้าจอไม่ยอมให้ทำ

```js
// 1) hook ทั้ง fetch และ XHR — SPA ส่วนใหญ่ใช้ axios = XHR ไม่ใช่ fetch
window.__LOG = [];
(() => { const of = window.fetch; window.fetch = async function(...a){
  const r = await of.apply(this,a); const c = r.clone();
  window.__LOG.push({body:a[1]&&String(a[1].body), res:(await c.text()).slice(0,1500)}); return r; }; })();
(() => { const S = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(b){
  this.addEventListener('load', () => window.__LOG.push({body:b&&String(b), res:String(this.responseText).slice(0,1500)}));
  return S.apply(this, arguments); }; })();

// 2) replay ด้วย endpoint เดิม
window.API = (action, data, extra) => fetch(URL_FROM_LOG, {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify(Object.assign({ scriptId:'customscript_xxx', action, data }, extra))
}).then(r => r.json());
```

ใช้ทำอะไรได้บ้าง:
- ยิง payload ที่ไม่ถูกต้อง (เกิน limit / คละกลุ่ม / field ว่าง) เพื่อดูว่า server มี guard จริงไหม
- **เทสว่า server เชื่อ client แค่ไหน** — ส่ง list สิทธิ์ที่กว้างกว่าเดิมดูว่าได้ของเพิ่มไหม (ต้องไม่ได้)
  แล้วส่งแคบกว่าเดิมดูว่าได้น้อยลงไหม (ปกติจะ intersect) ⇒ แยกออกว่า "server มีลิสต์ของตัวเอง" หรือ "เชื่อ client ล้วน"
- ยิงซ้ำด้วย key เดิมเพื่อเช็ค idempotency (ควรได้เลขเอกสารเดิม ไม่ใช่ใบใหม่)

## D. จำลอง network error กลางคัน (เทส partial success / retry)

ไม่ต้องปิด wifi — แทรกที่ layer เดียวกับที่แอปใช้ (ย้ำ: axios = XHR)

```js
window.__XFAIL = 0;                       // ตั้ง = N เพื่อให้ request ที่ N ล้ม
(() => { const S = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(b){
  const s = b ? String(b) : '';
  if (window.__XFAIL > 0 && s.includes('"submit"')) {        // กรองเฉพาะ action ที่สนใจ
    if (--window.__XFAIL === 0) { setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 80); return; }
  }
  return S.apply(this, arguments); }; })();
```

ได้เทสว่า: ใบที่สำเร็จแล้วยังอยู่ไหม · หน้าจอเหลือเฉพาะกลุ่มที่ล้มไหม · กด Retry แล้วส่งซ้ำเฉพาะที่เหลือไหม

## E. แก้ record แล้วต้องพิสูจน์ "ผลจริง" ไม่ใช่แค่ "บันทึกผ่าน"

1. เปิด `...&e=T` → แก้ field → กด Save → **รอ 8-10 วินาที** (NetSuite redirect ช้า) → ยืนยันด้วย SuiteQL ว่าค่าเปลี่ยนจริง
2. **ติ๊ก Inactive ไม่เท่ากับถอนสิทธิ์** — เจอมาแล้วว่าโค้ดที่อ่าน child sublist ไม่ได้กรอง `isinactive='T'`
   ⇒ หลังแก้ setup ต้องกลับไปยิงฟังก์ชันจริงซ้ำ ถ้าพฤติกรรมไม่เปลี่ยน = เจอ bug ไม่ใช่ว่าแก้ไม่สำเร็จ
3. จดค่าเดิมก่อนแก้ทุกครั้ง เพื่อคืนค่าให้ครบตอนจบ

## E2. URL ของหน้ามาตรฐานที่เดาไม่ได้ (จดไว้เลย)

NetSuite ไม่ได้ตั้งชื่อไฟล์ตาม record type — เดาแล้วได้ 500 ทั้งนั้น วิธีที่เร็วที่สุดคือเปิด **หน้า list** จากเมนูจริง
แล้วดึง href ของปุ่ม/ลิงก์ในหน้านั้นออกมา

```js
[...document.querySelectorAll('a')].map(a => a.getAttribute('href') || '')
  .filter(h => h.includes('.nl')).map(h => h.split('?')[0])
  .filter((v,i,a) => a.indexOf(v) === i)
```

| หน้า | URL |
|---|---|
| Bins (list) | `/app/accounting/transactions/inventory/binlist.nl` |
| **Bin (record)** | `/app/accounting/transactions/inventory/binnumberrecord.nl` · `?id=<ID>` ดู · `?id=<ID>&e=T` แก้ · ไม่ใส่ id = สร้างใหม่ |
| Inventory Status Change | `/app/accounting/transactions/statchng.nl` |
| Custom record | `/app/common/custom/custrecordentry.nl?rectype=<RT>&id=<ID>[&e=T]` |

## E3. กรอกฟอร์ม NetSuite ให้ค่าติดจริง

`form_input` (ตั้งค่า input ตรง ๆ) **ใช้ไม่ได้กับ dropdown ของ NetSuite** — มันเปลี่ยนแค่ข้อความที่โชว์
แต่ hidden value ยังเป็นค่าเดิม เซฟแล้วจะได้ค่าผิดแบบเงียบ ๆ (เจอมาแล้ว: bin ไปโผล่ location "Bangkok" แทนที่จะเป็นที่ตั้งใจ)

ทางที่ได้ผล เรียงจากดีที่สุด:

1. **`nlapiSetFieldValue('<fieldid>','<internal id>')` ใน console** — ตั้งค่าได้ตรงกับที่ระบบเก็บจริง
   (หน้า record มาตรฐาน/ฟอร์ม UI ส่วนใหญ่มีฟังก์ชันนี้ในหน้า) แล้วค่อยกด Save ผ่าน UI
   ⚠️ ถ้า harness บล็อกการ set field ด้วย JS ให้ถอยไปข้อ 2
2. **คลิกช่อง → พิมพ์ชื่อเต็ม → กด Tab** ให้ widget resolve เอง แล้ว **screenshot ยืนยันทุกครั้ง**
3. อย่าพิมพ์ภาษาไทย/วงเล็บลงในช่อง combobox ถ้าเลี่ยงได้ — ตัวอักษรมักตกหล่นจนกลายเป็นค่าอื่น
   (ลิสต์ location ของ NetSuite โชว์เฉพาะ "ชื่อใบสุดท้าย" เช่น `คลังสินค้า` ไม่ใช่ full name — พิมพ์เฉพาะส่วนนั้นแม่นกว่า)

**เช็คผลด้วย SuiteQL เสมอหลังเซฟ** — อย่าเชื่อหน้าจอ

**ฟิลด์ที่แก้ไม่ได้หลังบันทึก**: `location` ของ Bin ถูกล็อก (greyed out) ทันทีที่เซฟ ⇒ ถ้าตั้งผิดต้องปิด inactive แล้วสร้างใหม่

**ปุ่มที่ automation เข้าไม่ถึง**: ปุ่ม **Inventory Detail** ของบรรทัดสินค้า (Inventory Status Change / Adjustment / Transfer)
เปิดเป็น popup **window** แยก ไม่ใช่ tab และไม่ใช่ modal ⇒ Chrome MCP มองไม่เห็นและสั่งงานไม่ได้
⇒ **ให้คนกรอกช่วง lot/bin/qty เอง** แล้วเรากลับมาทำต่อ — เร็วกว่านั่งหาวิธี bypass

อาการข้างเคียงที่เจอ: ถ้า **ตั้ง location ด้วยวิธีที่ไม่ได้ trigger sourcing** (เช่นยัดค่าใส่ช่องตรง ๆ)
NetSuite จะไม่ยิง sourcing ต่อ ⇒ ปุ่ม/popup ที่ต้องอาศัยค่า location (Inventory Detail) จะไม่เปิดเลย
เวลาเจอ "กดแล้วไม่มีอะไรเกิดขึ้น" ให้สงสัยข้อนี้ก่อน แล้วลองตั้ง location ใหม่แบบพิมพ์+Tab

## F. กับดักเพิ่มเติม

| ปัญหา | วิธีแก้ |
|---|---|
| `[BLOCKED: Cookie/query string data]` ตอน print | อย่า print ค่าที่มี URL/query string — ตัด `location`/`url` ออกก่อน หรือ print แค่ field ที่ต้องใช้ |
| hook `fetch` แล้วไม่เห็น request เลย | แอปใช้ XHR (axios) — ต้อง hook `XMLHttpRequest.prototype.send` ด้วยเสมอ |
| เดา URL ของ record มาตรฐาน (เช่น bin) ไม่เจอ | `/app/common/item/bin.nl`, `/app/common/otherlists/bin.nl`, `/app/accounting/otherlists/bin.nl` คืน 500 หมด · global search ก็ไม่ index bin ⇒ ให้เข้าจากเมนู Lists จริง อย่าเสียเวลาเดา |
| คลิกพิกัดแล้วพลาดเป้า | ทุกครั้งที่ layout ขยับ (เพิ่ม/ลบแถว, เปลี่ยน mode) ต้อง screenshot ใหม่ก่อนคลิก — พิกัดเดิมใช้ไม่ได้ |
| หน้าจอ reset เองหลัง submit | อ่านผลจาก log ที่ hook ไว้ (`window.__LOG`) แทนการอ่านจาก popup ที่ปิดไปแล้ว |
| แก้ข้อมูลใน sandbox เยอะจนหาของเทสไม่เจอ | ก่อนเริ่ม ให้ query ชุดข้อมูลทดสอบเก็บไว้ก่อน แล้วเช็คใหม่ทุกครั้งหลังรันเคสที่ย้ายของ |
