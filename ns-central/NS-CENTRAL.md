
ฮับกลางเรื่อง NetSuite ทั้งหมด — **ความรู้ NS ที่ใช้ซ้ำได้ทุกอย่างอยู่ที่ไฟล์นี้ไฟล์เดียว อ่านไฟล์นี้ก่อน ไม่ต้องไล่เปิดไฟล์โปรเจกต์**
ไฟล์โปรเจกต์ (fast-transfer, <ลูกค้า>-*, twms-*, <โปรเจกต์>-* …) เก็บแค่ scenario/การตัดสินใจ/สถานะงานของโปรเจกต์นั้น
(รวมจาก 8 memory เดิม 2026-09 + กวาดบทเรียนทั่วไปจากทุกไฟล์โปรเจกต์ NS 2026-10-05)
**เรื่อง NS ใหม่ที่ใช้ซ้ำได้ → เขียนลงไฟล์นี้ในหมวดที่ตรง ไม่สร้างไฟล์แยก**

สารบัญ — 1 URL + เครื่องมือต่อบัญชี · 2 form field · 3 อ่าน read-only · 4 เขียน/แก้ (+inline editor list) · 5 custom record
· 5.5 File Cabinet · 6 ตรวจงาน/debug/parity · 7 schema SuiteQL · 8 standard report · 9 workflow · 10 กับดัก NS/SuiteScript
· 10.5 dashboard/role · 11 test data · 12 เอกสารคลัง+perf/governance · 13 TWMS · 14 Suitelet UI · 15 MR/idempotency
· 16 print template · 17 SB vs PROD · 18 SFTP/integration · 19 ทดสอบนอก NS + screenshot

---

## 1. URL

**Host ของ Sandbox = `https://<acct>-sb1.app.netsuite.com/`** (ขีดกลาง ตัวเล็ก) ไม่ใช่ `<acct>_SB1.app…`
แต่ **account id ใน query string ยังเป็น `_SB1`** (`c=<acct-A>_SB1` ของ media.nl, `compid=`, `changerole.nl?id=<acct-A>_SB1~…`)
→ แก้ลิงก์ยกชุดต้อง replace **เฉพาะ host**: `/:\/\/(\d+)_SB(\d+)\./i` → `://$1-sb$2.` ห้าม replace `_SB1` ทั้งสตริง

**Custom record** (ทุก rectype ทุก account)
- List `/app/common/custom/custrecordentrylist.nl?rectype=<N>`
- View `/app/common/custom/custrecordentry.nl?rectype=<N>&id=<id>`
- Edit เติม **`&e=T`** — ตัวใหญ่เท่านั้น `&e=t` render VIEW เงียบ ๆ ไม่ error (เสียเวลาหาสาเหตุนาน)
- หา rectype id: จาก URL ของหน้า list หรือ Customization > Lists, Records, & Fields

**สร้าง/แก้ตัว custom record type**
- สร้าง `/app/common/custom/custrecord.nl` · แก้ `?id=<rectype>` · list ทั้งหมด `/app/common/custom/custrecords.nl?whence=`
- **สร้าง field ของ custom record `/app/common/custom/custreccustfield.nl?rectype=<N>`**
  ⚠️ `custrecordcustfield.nl` / `custrecordcustomfield.nl` = Page not found (ชื่อจริงตัด `ord` ออก)
  ถ้าไม่แน่ใจ อ่าน `String(document.getElementById('newfield').onclick)` แล้ว regex เอา path

**Script / Deployment**
- Script list `/app/common/scripting/scriptlist.nl?scripttype=USEREVENT`
- Script record `/app/common/scripting/script.nl?id=<scriptId>` (id จากคอลัมน์ Edit/View ของ list ไม่ใช่ id ของไฟล์)
- Deployment list `/app/common/scripting/scriptrecordlist.nl?type=&status=&recordtype=&apiversion=&scripttype=&sortcol=name&sortdir=ASC&size=1000&showall=F`
  (`scriptdeploymentlist.nl` / `scriptdeploylist.nl` **ไม่มี** — 404/500)
- Deployment record `/app/common/scripting/scriptrecord.nl?id=<deploymentId>` (+`&e=T`) — ไม่มี `scriptdeployment.nl`
- **cap 1000 แถว** `size>1000`, `page=`, `start=`, `sortcol` ถูกเมิน → แบ่งด้วย `type=` (พารามิเตอร์นี้ใช้ได้จริง)
  ค่าที่ใช้ได้: `USEREVENT CLIENT MAPREDUCE SCRIPTLET`(=Suitelet ไม่ใช่ SUITELET)`SCHEDULED RESTLET MASSUPDATE PORTLET BUNDLEINSTALLATION SDFINSTALLATION` — ค่าผิดคืน 0 แถวเงียบ ๆ

**อื่น ๆ**
- Role list `/app/setup/rolelist.nl?whence=&size=1000` → anchor `role.nl?id=N`
- Workflow list `/app/common/workflow/setup/workflowlist.nl`
- **Transform transaction** ต้องครบเหมือนปุ่มมาตรฐาน เช่น
  `vendbill.nl?transform=purchord&whence=&id=<po>&e=T&memdoc=0`
  ขาด `whence`/`memdoc` = "An unexpected error has occurred"
  วิธีหา: อ่าน `String(window.<btnFn>)` ของปุ่มมาตรฐาน แล้ว regex ชื่อไฟล์ + key ของ param
- **Transform + param ของเราเอง**: `…&memdoc=0&custparam_<x>=<key>` → UE beforeLoad บน record ปลายทางอ่าน `context.request.parameters.custparam_*` แล้ว removeLine/setSublistValue ได้ · คู่กับ N/cache ส่ง "plan" จาก SL → UE (SB1 2026-08-08)
- **Suitelet URL ต้องมี `script`/`deploy`(+`compid`) เสมอ** ไม่งั้น "This request is missing a required parameter." · ในโค้ดเอาจาก `runtime.getCurrentScript()` อย่า hardcode
- **ยิง Suitelet ตรงด้วย script id แบบ string ได้**: `scriptlet.nl?script=customscript_xxx&deploy=1` · POST JSON ได้แม้เมนูถูกซ่อนตามสิทธิ์
- **Suitelet ฟอร์ม `custpage_*` รับค่าทาง URL param ได้เลย** แล้วค่อยกด Submit (เร็วกว่าคลิกทีละช่อง)
- **Saved search + filter ทาง URL**: `searchresults.nl?searchid=<id>&<Rec>_<FIELD>=<value>&style=NORMAL` (เช่น `InventoryBalance_ITEM=<itemid>`)
- **Saved report list**: `/app/reporting/savedreports.nl?whence=&Report_OWNER=&showall=T&size=1000` (default โชว์แค่ของตัวเอง ต้องล้าง `Report_OWNER=`) · ลิงก์เป็น `reportsearchredirect.nl?id=<N>` → `reportcomposer.nl?e=T&cr=<N>` · ไม่มี: `reportcustomizer.nl` `reportslist.nl` `reportaudience.nl`
- **Inventory/WMS**: Bin list `/app/accounting/transactions/inventory/binlist.nl` · Bin `…/inventory/binnumberrecord.nl` (`?id=`/`&e=T`/ไม่ใส่ id=สร้าง) · Inventory Status Change `/app/accounting/transactions/statchng.nl` · Lot/Serial `…/inventory/inventorynumberrecord.nl?id=` · Inventory Transfer `invtrnfr.nl?id=` (ไม่ใช่ `trnfrord.nl`=Transfer Order) · ทางตัน 500: `/app/common/item/bin.nl`, `/app/common/otherlists/bin.nl`, `/app/accounting/otherlists/bin.nl` · global search ไม่ index bin
- หา script/deploy ของ Suitelet: deployment list `type=SCRIPTLET` → fetch `scriptrecord.nl?id=<deployId>` → regex `script=<id>&deploy=<n>`
- Shortcut ที่ชี้ Suitelet: taskid = `EDIT_SCRIPTLET_<scriptInternalId>_<deploy>`

**เครื่องมือ SuiteQL / UPDATE ต่อบัญชี** (Tim Dietrich tool — ดูวิธีขับ §6)
| บัญชี | Query Tool | อื่น ๆ |
|---|---|---|
| ลูกค้า A SB1 | `script=1944&deploy=1` (ดี), 1190 ตัวเดิม | |
| <acct-B>-sb1 | `3203 deploy 1` (มี JSON API), 1190 | UPDATE ตรง `script=2956` · TWMS SPA `2967` (route `/inventory-count`) |
| QA sandbox 2026-08-04 | 3275 | |

## 2. รูปร่าง form field (หน้า edit)

อ่านค่า: `document.forms['main_form'].elements['<fieldid>'].value` — ใช้ได้ทั้ง DOM สดและ HTML ที่ fetch มา parse

| ชนิด | element |
|---|---|
| Select เดี่ยว | `inpt_<id>` (ข้อความที่เห็น) + `<id>` (hidden, internal id) |
| Numeric | `<id>_formattedValue` (ที่แสดง) + `<id>` (hidden, raw) |
| Checkbox | `<id>` (checkbox) + `<id>_send` (hidden `T`/ว่าง) |
| **Multiselect** | **3 ตัวต้อง sync กันหมด** ไม่มี `<select>` เลย |

Multiselect: `<id>` (hidden, internal id คั่นด้วย `\x05`) + `<id>_labels` (hidden, label คั่น `\x05`) + `<id>_display` (textarea, label คั่น `\n`)
`nlapiGetFieldValues()` คืน null · `nlapiGetField().type` บอก `"text"` · ต้องอ่าน/เขียน 3 element ตรง ๆ

**★★ `request.parameters.x` เอาค่า "ตัวแรก" เมื่อ key ซ้ำใน query string** (พิสูจน์ 2026-08-24 script 3269)
`?subsidiary=&subsidiary=2` → server เห็น `""` · `?subsidiary=2&subsidiary=` → เห็น `"2"`
→ **ห้ามสร้าง URL ด้วยการต่อท้าย `window.location.search` เดิม** ถ้า key ที่จะ set มีอยู่แล้วในนั้น ค่าใหม่จะถูกทิ้งเงียบ ๆ ไม่ error
เจอเป็นบั๊กจริงที่ `<ลูกค้า>-inventory-reclass-report` (บันทึกส่วนตัว) — filter ที่ผู้ใช้เลือกไม่มีผลเลยเพราะค่าว่างจากรอบ reload ก่อนหน้ายังคาอยู่ในเส้น URL
ท่าที่ถูก: `new URLSearchParams()` ใหม่ เก็บแค่ `script`/`deploy`/`compid` แล้ว `.set()` ทุกตัวเอง
สัญญาณเตือนเห็นได้ใน URL (`…location=&step=report&subsidiary=2…location=&whence=`) · โดนทุก path (fieldChanged/Load/Back) → ทำ helper `baseUrlParams()`

**List/Record field อ่านผ่าน SuiteQL ได้ internal id ไม่ใช่ label** (`r.lang_text` = undefined เงียบ ๆ) → join custom list แล้วเอา `name`
· อ่าน custom list ด้วย **name ไม่ใช่ id** — account ปลายทางอาจสร้างค่าคนละลำดับ · custom list ที่สร้างผ่าน UI ตั้ง script id ของแต่ละค่าไม่ได้

**★ Chrome MCP `form_input` กับ dropdown ของ NS ใช้ไม่ได้** — ข้อความเปลี่ยนแต่ hidden id ไม่เปลี่ยน → save ได้ค่าผิดเงียบ ๆ
→ ใช้ `nlapiSetFieldValue(fieldid, internalid)` · verify ด้วย SuiteQL เสมอ

**ดึง Field Help ทุก field โดยไม่ต้องคลิก**: ในหน้า record `fetch(getFlhUrl(fieldId))` (ใช้ทำคู่มือ TWMS Setup 2026-09-30)

**custpage MULTISELECT บน Suitelet (SS2.x Client Script) — `getValue()` ใช้ได้ปกติ**
ทดสอบจริง: เลือก 2 location → `rec.getValue('custpage_location')` = `["19","21"]` · ไม่ได้เลือกอะไร = `[""]` (array มี string ว่าง ไม่ใช่ `[]`)
DOM ของ field นี้ (UIF ปัจจุบัน) **ไม่มี `<select>` เลย**: `DIV.ns-multi-dropdown[data-name="<id>"]` + `TD#row_<id>_<n>[aria-selected]` (class `dropdownSelected`/`dropdownNotSelected`)
hidden จริงคือ `id="hddn_<id>_<n>"` แต่ `name="<id>"` (คั่น `\x05`) → ถ้าจะอ่าน DOM ต้องใช้ `getElementsByName('<id>')` ไม่ใช่ `getElementById('hddn_<id>')`
`data-selected` บน wrapper เป็น `[]` ค้างอยู่ **ไม่ sync** อย่าใช้อ่านค่า · `.click()` ด้วย JS ไม่ติด ต้องคลิกจริง

**กับดัก audience field ของ Script Deployment** (`audslctextrole`/`audslctrole`)
อยู่ใน `audience_form` **ไม่ใช่** `main_form` → `main_form.elements['audslctextrole'].value` เป็น `""` เสมอ
ใช้ `document.getElementsByName(...)` (ตัวใน audience_form มีค่า) หรือ `nlapiGetFieldValues()` บนหน้าสด
survey เร็ว: fetch `…&e=T` แล้ว regex `/<input[^>]*name="audslctextrole"[^>]*>/` (~1300 records @concurrency 10 = ~45 วิ)
อย่า survey จากหน้า view — multiselect ยาวจะโดนย่อเป็น `More…` ได้ข้อมูลไม่ครบ

## 3. อ่านแบบ read-only (เร็วและปลอดภัยที่สุด)

จากหน้า NS ที่ login อยู่: `fetch('<url>&e=T',{credentials:'include'})` + `DOMParser` แล้วดึงค่าจาก `main_form`
ยิงขนานได้ ~5 records ไม่ต้อง navigate ไม่เสี่ยง dirty form

⚠️ **harness บล็อก output ที่หน้าตาเหมือน query string / cookie** → `[BLOCKED: Cookie/query string data]`
คืนเฉพาะ "ค่าที่สกัดแล้ว" อย่าคืน HTML ดิบหรือ `location.href` · ถ้าจำเป็นให้ `replace(/=/g,' ⇒ ')` ก่อน print
หรือ **ใช้ค่าในหน้าเลยไม่ต้องคืนออกมา** (เช่น `location.href = urlThatWeFound`)

## 4. เขียน / แก้ record

**ทีละใบ**
1. `navigate` ไป `…&e=T`
2. `javascript_exec` เซ็ตค่า แล้ว `setTimeout(()=>document.getElementById('submitter').click(), 50)`
   — **schedule ไว้ อย่า await** (`.click()` ตรง ๆ บล็อก CDP eval 45 วิ)
3. `wait` **10 วินาที** (max ต่อ call)
   3 วิไม่พอ — `navigate` ถัดไปจะ abort POST ที่ค้างอยู่ แล้ว record เก็บค่าเดิมเงียบ ๆ (เคยเสีย 4 จาก 8 ใบแบบนี้)

**บน form config (custrecord/custfield)** `nlapiSetFieldValue(k, v, true, true)` ใช้ได้ ไม่ต้องคลิกทีละช่อง

**Bulk แบบเร็ว — hidden iframe** (~1.8 วิ/record แทน 10 วิ)
โหลด `…&e=T` ใน iframe → poll จน `contentWindow.nlapiGetFieldValues` + `#submitter` พร้อม → เซ็ตค่า → click
`iframe.onload` ครั้งที่ 2 = save เสร็จ; ถ้า URL ที่ landed ยังมี `e=T` แปลว่า save ไม่ผ่าน
- **memory leak คือขีดจำกัดจริง** แต่ละหน้าที่โหลดใน iframe รั่ว ~20 MB ไม่คืน ที่ ~4 GB renderer จะช้าแล้วแครช
  → ทำเป็นชุดละ ~70 records แล้ว reload host tab · เก็บ worklist ใน `localStorage` (ลบ id ออกเมื่อ save สำเร็จเท่านั้น)
  · เก็บ source ของ setup function ใน localStorage แล้ว `eval` กลับหลัง reload
- concurrency 4–6 iframe (มากกว่านี้ไม่เร็วขึ้น แครชเร็วขึ้น)
- ถ้า host tab ไม่ใช่แท็บที่เห็นอยู่ Chrome throttle timer → ช้าลง ~5 เท่า

**หน้า list ที่แก้ตรงได้ (INLINEEDITOR machine) เช่น Custom Center Links `/app/common/custom/custtasks.nl`**
(ทำจริง 2026-10-05 ลูกค้า C SB1: แก้ URL 131/150 บรรทัด → Save → reload ยืนยันแล้ว)
- ชื่อ machine หาจาก hidden `<m>fields` / `<m>data` · custtasks: machine `external`, field `externalid/externallabel/externalurl` (ไม่ใช่ `url`)
- **`nlapiSetLineItemValue` อย่างเดียวไม่พอ**: `nlapiGetLineItemValue` อ่านได้ค่าใหม่ แต่ hidden `<m>data` (ที่ถูก submit จริง) **ยังเป็นค่าเดิม** และตารางไม่วาดใหม่
  → ต้อง replace `document.querySelector('[name=<m>data]').value` ตรง ๆ ด้วย (บรรทัดคั่น `\u0002` คอลัมน์คั่น `\u0001`) + `window['<m>_machine'].buildtable()` แล้วค่อยกด Save
- verify: reload หน้าแล้วนับจาก `nlapiGetLineItemValue` อีกรอบ
```js
(() => {
  const M='external', re=/:\/\/(\d+)_SB(\d+)\./i, fix=u=>u.replace(re,(m,a,b)=>`://${a}-sb${b}.`);
  let c=0; for(let i=1;i<=nlapiGetLineItemCount(M);i++){const u=nlapiGetLineItemValue(M,'externalurl',i)||'';if(re.test(u)){nlapiSetLineItemValue(M,'externalurl',i,fix(u));c++}}
  const f=document.querySelector(`[name=${M}data]`); f.value=f.value.replace(new RegExp(re.source,'gi'),(m,a,b)=>`://${a}-sb${b}.`);
  window[M+'_machine'].buildtable(); console.log('changed',c);
})();
```

**หา record จากเลขที่เอกสาร (ไม่มี internal id)**
`globalsearchresults.nl?searchtype=Transaction&Uber_NAME=<docnum>` เดี่ยว ๆ = "No Search Results"
ต้องมี `&gskeys=<id>` ซึ่ง **resolve ฝั่ง client โดย autocomplete ของช่อง Search** — fetch เอาเองไม่ได้
→ ต้องขับช่อง Search จริง: triple_click → type เลขเอกสาร → Return แล้วอ่าน id จาก URL ของแท็บ
ทางตัน (ยืนยันแล้ว): `quicksearch=` → 500 · `Transaction_NUMBERTEXT`/`Transaction_TRANID` → ไม่ได้ · network log ไม่จับ XHR autocomplete
ปุ่ม Save ตำแหน่ง y ไม่คงที่ (banner ดันลง y≈293 vs ≈216) — screenshot อ่านพิกัดทุกครั้ง อย่า hardcode

**กับดักร่วมทุกวิธี**
- **dirty form + navigate = beforeunload popup ทำ renderer ค้าง** (CDP time out หมด)
  ก่อนออกเสมอ: `setWindowChanged(window,false); window.onbeforeunload=null;`
- `browser_batch` wait cap 10 วิ เกินกว่านั้น batch abort กลางคัน
- batch ที่รายงาน "did not respond in time" **มักรันต่อจนจบ** → re-survey ก่อนสรุป และเขียน script ให้ idempotent (เคยรันซ้ำแล้วเพิ่ม role ซ้ำ)
- **re-survey ทุกใบตอนจบเสมอ** เช็คทั้ง missing และ duplicate
- อย่าเปิด `<record>.nl` ที่ไม่มี `id` — นั่นคือฟอร์ม new record ออกจากหน้าแล้วติด beforeunload
- **background tab throttle จริงจัง**: สร้าง field 110 วิ/field ตอนอยู่หลังแท็บอื่น vs 9 field ใน ~2 นาทีตอนอยู่หน้า · แท็บซ่อนใน Browser pane timer ~1/s และ screenshot อาจคืนภาพเปล่า → ให้ user คลิกค้างแท็บนั้น / ตรวจ state ด้วย DOM
- `javascript_exec` ที่คืนผล async มักโดนบล็อกเป็น `{}` → เก็บไว้ `window.__x` แล้วอ่าน call ถัดไป (กติกาทั่วไป)
- Chrome MCP บางครั้งไม่ยอมเปิดแท็บใหม่บนโดเมน NS → ใช้ hidden iframe `…&e=T` แทน (ทำจริงกับ deployment `nlapiSetFieldValue('loglevel',…)`)
- **ปุ่ม Inventory Detail** บน transaction line เปิด popup window แยกที่ MCP มองไม่เห็น → ให้คนกรอก lot/bin/qty เอง · ถ้าตั้ง location แบบไม่ trigger sourcing ปุ่มจะกดแล้วนิ่ง
- **Bin ล็อก location หลัง save** แก้ไม่ได้ → ผิดให้ inactive แล้วสร้างใหม่
- `window.confirm` override **ใช้ไม่ได้บนบาง Suitelet** (ลูกค้า A SB1 3037 Bill Payment Confirm & Submit) → ให้ user กด OK เอง
- `tabs_context_mcp createIfEmpty` อาจเปิดแท็บในหน้าต่างของ user → อย่า `resize_window` โดยไม่เช็ค

## 5. สร้าง custom record + fields ยกชุด (ผ่าน browser ไม่ต้องใช้ SDF)

```js
nlapiSetFieldValue('fieldtype','SELECT',true,true);
await new Promise(r=>setTimeout(r,1200));          // รอ dropdown record type โหลด
nlapiSetFieldValue('selectrecordtype','-30',true,true);
await new Promise(r=>setTimeout(r,600));
nlapiSetFieldValue('label','Vendor Bill',true,true);
nlapiSetFieldValue('scriptid','_xx_alloc_bill',true,true);
nlapiSetFieldValue('storevalue','T',true,true);
setTimeout(()=>document.getElementById('submitter').click(),50);   // แล้ว wait 10 วิ
```
- **scriptid พิมพ์แค่ `_xx_alloc_bill`** NetSuite เติม `custrecord` ให้เอง (record type เติม `customrecord`) พิมพ์เต็มจะได้ prefix ซ้อน
- `fieldtype`: `TEXT`(Free-Form) `SELECT`(List/Record) `INTEGER` `FLOAT`(Decimal) `CURRENCY` `CHECKBOX` `DATE`
- `selectrecordtype`: `-30` Transaction · `-10` Item · `-117` Subsidiary · `-242` Bin · `-103` Location · **`-9` Entity/Employee (ไม่ใช่ -4)** · `-221` Units · custom record/list = rectype id ของมันเอง (SB1 2026-08-28)
  หาค่าของ field ที่มีอยู่: fetch `custrecord.nl?id=<rectype>` → หา `<tr>` ของ scriptid → fetch `custreccustfield.nl?id=<fieldId>&e=T` → `main_form.elements['selectrecordtype'].value`
- SELECT ในงานจริงต้องรอ **~2.5 วิ** หลังเซ็ต fieldtype (1200ms บางทีไม่พอ)
- `accesstype` บน record type: `NONENEEDED` = No Permissions Required (default `CUSTRECORDENTRYPERM`)
- ⚠️ **อย่าปิด Allow UI Access** ถ้าอยากให้คนกดดู record จาก saved search ได้

กับดัก: POST ฟอร์มตรงด้วย fetch → **HTTP 500** เสมอ (ต่อให้ยก `_csrf` มาครบ) · ขับผ่าน iframe ได้ครั้งเดียวแล้ว `onload` ไม่ยิง
· วน 3 fields ใน eval เดียว **เกิน CDP 45 วิ** ทำทีละ field · ถ้า renderer ค้างให้เปิดแท็บใหม่ทำต่อ ของที่ save แล้วไม่หาย
· กันไว้ก่อนด้วย `window.alert=function(){}; window.confirm=function(){return true;};`
· ตรวจผลด้วย fetch หน้า record type แล้ว regex ชื่อ field ที่ตั้งใจสร้าง เทียบหาตัวที่ `missing`

**สร้าง field ยกชุดผ่าน hidden iframe ทำได้จริง** (17 field บน rectype 1379, 2026-08-28) ถ้า:
- worker fire-and-forget (`setTimeout(async…)`) แล้ว poll ตัวแปรผล (ไม่ชน CDP 45 วิ)
- 🔴 **ห้ามถอด iframe หลัง click ด้วย sleep คงที่** — POST ถูก abort เงียบ ๆ (รอบแรกได้ 4/17 ทั้งที่ log ว่า SENT) → poll จน `iframe.contentWindow.location.href` มี `id=<n>` ก่อนถอด
- ตั้ง `w().alert/confirm` ทับก่อน · ตรวจผลเทียบด้วย **field internal id** ไม่ใช่ข้อความ (บางแถวโผล่ 2 ที่)

**ออกแบบ custom record**
- child custom record: `record.load(parent)` แล้วอ่าน sublist **`recmach<parentFieldId>`** → ไม่ต้องรู้ script id ของ child
- **กันแถวซ้ำด้วย External ID** (`<plan>|<bin>|<item>`) NS บังคับ unique ให้ · ⚠️ ถ้าวันหน้าต้องเก็บหลายรอบต่อ key ต้องมีมิติ attempt ตั้งแต่แรก
- **ต้อง index ข้อมูลที่เก็บเป็น JSON blob** → child record ของ record ที่ถือ blob (save เดียวกัน = atomic + cascade delete) ไม่ใช่ standalone index / csv+LIKE
- custom record ที่ใช้คุมสิทธิ์ query ต้องกรอง `isinactive='F'` ไม่งั้น inactive แล้วสิทธิ์ไม่หาย
- setting ที่ "ว่าง = ตกไปชั้นถัดไป" อย่าทำเป็น checkbox (ไม่ติ๊ก=`F` บังคับทุกคน) → List/Text · feature toggle ใช้ checkbox แยกทีละ rule ไม่ใช่ multi-select (เพราะ `IN (?)` §7)
- **log/child record ให้ `record.create` ตรง ๆ ห้ามเขียนผ่าน `recmach` ของ transaction** (save tx ติด period ปิด) · field **Record is Parent** → ได้ subtab บนเอกสารเอง · custom record ที่มี List/Record field ชี้ transaction โผล่ใต้ Related Records ของ tx อัตโนมัติ

## 5.5 อัปไฟล์ทับใน File Cabinet เอง (ไม่ต้องให้ user ลากไฟล์)

**ท่าที่ใช้ได้จริง (พิสูจน์ 2026-08-28 บน SB1 ไฟล์ 781927)** — แก้ไฟล์แบบ *patch* ไม่ใช่ upload ทั้งก้อน
เพราะเนื้อไฟล์ไม่ต้องผ่าน context ของเรา (ไฟล์ 70KB = 20k+ token ถ้าจะพิมพ์ใหม่)

1. เปิดหน้า **edit** ของไฟล์: `/app/common/media/mediaitem.nl?id=<fileId>&e=T` (ต้อง `e=T` ไม่งั้นไม่มี input)
2. บนหน้านั้นมี **ลิงก์ดาวน์โหลดไฟล์ปัจจุบัน** อยู่แล้ว — `a[href^="https://…/core/media/media.nl?id="]`
   (มี `h=` hash มาให้ ไม่ต้องไปหา url จาก SuiteQL)
3. `fetch(link,{credentials:'include'})` → ได้เนื้อไฟล์ปัจจุบันเป็น text
4. แก้ด้วย string replace **ตรวจว่า anchor เจอ 1 ครั้งเป๊ะ** ก่อนแทน (เจอ 0 หรือ >1 = หยุด อย่าเดา)
5. ยัดกลับเข้า `input[type=file][name="mediafile"]` ด้วย **DataTransfer**:
   ```js
   const file = new File([out], f.elements['name'].value, {type:'text/html'});
   const dt = new DataTransfer(); dt.items.add(file);
   inp.files = dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));
   setTimeout(()=>document.getElementById('submitter').click(), 60);
   ```
   (`input.files` เซ็ตด้วย DataTransfer ได้จริงใน Chrome — เป็นทางเดียวที่ทำได้ฝั่ง JS)
6. `wait 10 วิ` แล้ว **verify ด้วยการ fetch ลิงก์เดิมอ่านกลับ** เช็คว่าข้อความใหม่มา/ของเก่าหาย
   (ห้ามเชื่อว่า submit ผ่านเพราะไม่ error — กับดักเดิมของ §4)

⚠️ `beforeLen` เป็น **จำนวนตัวอักษร ไม่ใช่ไบต์** ไฟล์ที่มีภาษาไทยจะน้อยกว่าขนาดบนดิสก์มาก อย่าเอาไปเทียบกับ `ls -l`
⚠️ ไฟล์ id เดิม/URL เดิมหลังอัป → Suitelet ที่ `file.load({id})` ไม่ต้องแก้อะไร
helper `window.__nsPatch(edits, {dryRun})` เคยใช้จริง แต่**ตัวโค้ดไม่ได้บันทึกไว้ที่ไหน** — เขียนใหม่ตามขั้น 1–6 ข้างบน
⚠️ `file.load()` ด้วย relative path หาเฉพาะในโฟลเดอร์ของสคริปต์เอง · `mediaitem.nl?id=` คืน HTML ไม่ใช่ตัวไฟล์

**ถ้าต้องอัปไฟล์ใหม่ทั้งก้อน** (ไม่มีของเดิมให้ patch) ยังต้องให้ user ลากเอง หรือ chunk เนื้อไฟล์เข้า
`window.__buf` หลายรอบแล้วค่อยประกอบ — ยังไม่ได้ทดสอบ

## 6. ตรวจงาน — สองท่านี้เปลี่ยนวิธีทำงานเลย

**อ่าน Script Execution Log ด้วย SuiteQL** (แท็บ Execution Log บนหน้า Script มัก "No records to show" ทั้งที่มี log — อย่าเชื่อ)
```sql
SELECT title, detail, TO_CHAR(date,'HH24:MI:SS') AS tm, BUILTIN.DF(type) AS lvl
FROM scriptnote WHERE title LIKE 'XX %' ORDER BY internalid DESC FETCH FIRST 15 ROWS ONLY
```
→ **ตั้ง prefix เดียวกันให้ทุก log ตั้งแต่เขียนโค้ด** จะ query ง่ายมาก

**ยืนยันว่าไฟล์ที่ deploy คือเวอร์ชันล่าสุดจริง** (อย่าเดาว่า upload แล้ว)
```sql
SELECT url FROM file WHERE id = <fileId>   -- fileId จากลิงก์ mediaitem.nl?id= ใน scriptlist
```
แล้วใน page context `await (await fetch(url,{credentials:'include'})).text()` → grep ชื่อฟังก์ชันใหม่
**หรือเทียบ hash**: File record → System Notes → **File Content Hash** = SHA-1 → เทียบ `shasum -a 1 <local>` (ลูกค้า A PROD 2026-09-29)
**Deploy drift** เคยเป็นสาเหตุ "redirect ไม่เกิด/field ไม่ถูก set" (แก้ `.v2` แต่ deploy ตัวเดิม) · Suitelet ที่ serve HTML จาก File Cabinet ต้องอัปทั้ง HTML และ .js

**Log หาย → เช็ค Log Level ของ deployment ก่อน** (ERROR = audit/debug ถูกทิ้งหมด) เปลี่ยน DEBUG ชั่วคราว (ขอ user) แล้วตั้งกลับ · ⚠️ save deployment = ล้าง cache (§12 cold start)
scriptnote กรองต่อ script ได้: `WHERE scripttype = <scriptId>` · หน้า Script Notes โหลด ajax ดึงตรงไม่ได้
**MR รันซ้อนไหม**: export Execution Log CSV ดู `getInputData` แยก deployment — สอง deployment รัน key เดียวกันห่างกันไม่กี่วิ = ซ้อน
**Timing log**: log ms ต่อ phase (ไม่ใช่สะสมจาก `_tStart`) · ห้าม log ทั้ง array (236KB) ใช้ count + sample 2 แถว · พิสูจน์ cache hit = log ของ query นั้น**ไม่โผล่** · อย่าเชื่อ cold run เทียบ warm
**Suitelet ตายคืน HTML ไม่ใช่ JSON** (`ScriptNullObjectAdapter@…`) — เคสจริง `WHERE id IN (...)` 3,101 ตัว → cap + ครอบ handler ด้วย try/catch คืน JSON envelope เสมอ · client แยก non-JSON (ไม่ deploy/crash/session หมด) ออกจาก "not found"
🔴 **`ok:true` ≠ งานเกิด** ดู counter (`applied`) เสมอ · เคสจริง payload ไม่ copy ธง `dirty` → items ว่าง → `ok:true applied:0` จอบอกบันทึกแล้ว · server ควรตอบ `noop` + flag `partial`
**บั๊ก integration เจอจากการเดินจอจริง ไม่ใช่อ่านโค้ด** (6+3 บั๊ก 2026-08-28) → endpoint ใหม่ต้องเดินจนสถานะปลายทางเปลี่ยนแล้วเช็ค DB
**ทดสอบ server ของ SPA ด้วย hook `fetch`/XHR**: ดัก payload จริงแล้ว replay แบบดัดแปลง (เทส error/ช่องโหว่) หรือบล็อก action ที่เขียนระหว่างสำรวจ · ⚠️ อย่าติด hook ซ้ำ (ดูเหมือนยิงซ้ำ) · SPA พิกัดเพี้ยนบ่อยใช้ `find` ref
ค่า config ที่ script cache ไว้ (N/cache) มีผลช้า 30 วิ – 4.5 นาที → เทสหลังเปลี่ยน config ต้องรอ
ไฟล์ SuiteScript บางไฟล์เป็น CRLF + มีไทย → python เปิดด้วย `newline=""` และเช็ค UTF-8 หลังแก้

**Parity Lab (ก่อนย้าย saved search → SuiteQL)**: รัน SS กับ SQL คู่กัน เทียบราย key (round 4dp) เก็บ onlySs/onlySql/valueDiff → `log.audit('PARITY | …')` + panel HTML · เปิดด้วย `&parity=T` · ฟังก์ชัน prod มี param `forceSs` (หลัง cutover ไม่งั้นเทียบ SQL กับ SQL ได้ MATCH ปลอม) · parity bypass cache อัตโนมัติ
**mirror SS ด้วย SQL ต้องไล่ parity 2 ทิศ**: SQL แคบกว่า = ตอบ "ไม่พบปัญหา" ทั้งที่ระบบบล็อก (เงียบสนิท) · เคสจริง 3/5 จุดที่ patch คือ**ลบ** `isinactive` ที่ SS ไม่มี · criteria static ล้วน = parity ได้ 100%

**SuiteQL Query Tool JSON API** (เร็วกว่าขับหน้าจอ): `POST <tool-url>&function=queryExecute` body `{function:'queryExecute',query:'…'}` → `{records}` (ยืนยันบน 3203)

**helper ขับ SuiteQL Query Tool** (Tim Dietrich — บน SB1 มีสอง deployment: **script=1944&deploy=1** ใช้ได้ดี, 1190 ตัวเดิม)
⚠️ บน 1944 `responseData.value` **ว่างเปล่า** ต้องอ่านผลจาก `resultsDiv.innerText` แทน
⚠️ `await` คิวรีตรง ๆ ใน `javascript_exec` ชน CDP 45 วิ → ยิงแบบ fire-and-forget เก็บผลไว้ที่ `window.__out` แล้ว `wait` + อ่านทีหลัง
```js
window.__sql = async function(sql){
  const q=document.getElementById('query'); q.value=sql; q.dispatchEvent(new Event('input',{bubbles:true}));
  const before=(document.getElementById('resultsDiv')||{}).innerHTML;
  Array.from(document.querySelectorAll('button,input[type=button],a'))
    .find(x=>/run query/i.test(x.value||x.textContent||'')).click();
  for(let i=0;i<70;i++){ await new Promise(r=>setTimeout(r,400));
    const d=document.getElementById('resultsDiv');
    if(d && d.innerHTML!==before && d.innerText.trim() && !/Running query/i.test(d.innerText))
      return d.innerText.slice(0,1600); }
  return 'TIMEOUT';
};
```
ปุ่มชื่อ **"Run Query"** ("Go" คือ global search) · ผลอยู่ `#resultsDiv` · `FETCH FIRST` พังบางเคส → ใช้ `ROWNUM <= n`
· query ที่ scan ทั้ง transactionline กิน 30–40 วิ, มี filter `= <id>` ~200ms

## 7. schema SuiteQL ที่เจอบ่อย

**ไม่มี**: `transaction.subsidiary` (NOT_EXPOSED) · `transaction.createdfrom` · `transactionline.orderline` · `transactionline.quantityuom`
**มี**: `transactionline.createdfrom` · `.uniquekey` · `.quantitybilled` · `.quantityshiprecv` · `.units` · `.linesequencenumber`

- subsidiary ของ transaction → join `transactionline` ที่ `mainline='T'`
  ⚠️ **`JOIN transactionline ... mainline='T'` คูณแถว** สำหรับ JE/custom transaction (NS ตั้ง `mainline='T'` ให้ทุกบรรทัด)
  พิสูจน์ 2026-09-14: นับ `customrecord_thl_vatsummary` ได้ 102,854 แถว พอ join ตัวนี้กลายเป็น **732,030** (~7 เท่า) ช้าลง 1s→13s
  `FETCH FIRST n` บังอาการไว้ ดูเหมือนปกติ → **ต้องนับ COUNT(\*) เทียบก่อน/หลัง join เสมอ**
  ทางแก้: ใช้ `EXISTS (SELECT 1 FROM transactionline tl WHERE tl.transaction=t.id AND tl.subsidiary=?)`
  หรือดีกว่านั้น หา field subsidiary บน custom record เอง (VAT Summary มี `custrecord_vs_subsidiary`)
- saved search ที่มี filter `<transaction join>.linesequencenumber = 0` คือ **กันผลคูณฝั่ง line** ไม่ใช่เงื่อนไขทางธุรกิจ
  แปลเป็น SuiteQL ให้ตัดทิ้งแล้ว join `transaction` (header) แทน — แต่ถ้าเผลอ join line กลับเข้าไปจะได้อาการข้างบน
- **`transactionline.quantity` เป็นหน่วยฐาน ไม่ใช่หน่วยที่ผู้ใช้เห็น**
  → หารด้วย `unitstypeuom.conversionrate` (`SELECT conversionrate, unitname FROM unitstypeuom WHERE internalid = <tl.units>`)
  rate ต่อหน่วย transaction = `tl.rate * conversionrate` · `quantityuom` มีเฉพาะใน saved-search layer
- ผูก PO↔IR↔Bill ใช้ `nexttransactionlinelink` (previousdoc/previousline → nextdoc/nextline)
  ไม่ต้อง filter `linktype` (ชื่อค่าต่าง version) ใช้ `type` ของ transaction ปลายทางแทน
- custom field ที่ multi-select เก็บเป็น string คั่น comma → SuiteQL `IN (?)` คืน 0 แถวเงียบ ๆ ต้อง scan + `split(',')`
- **catalog ของ skill `netsuite-suiteql-tables-reference` เป็น Analytics catalog ไม่ใช่รายการ table ของ SuiteQL**
  มี `UnrealizedGainLoss` แต่ SuiteQL ตอบ "Record not found" · ไม่มี `transactionline` ทั้งที่ SuiteQL ใช้ได้
  → ก่อนยื่น query ให้เช็คปุ่ม **Tables Reference** ในหน้า SuiteQL Query Tool
- **หน้า SuiteQL Query Tool (script=1190)**: cap **5000 แถว** ตัดเงียบ ๆ (ใส่ `COUNT(*)` เช็คก่อน) ·
  `SELECT *` → "Invalid or unsupported search" · `LIMIT` ใช้ไม่ได้ ใช้ `FETCH FIRST n ROWS ONLY` ·
  **"An unexpected SuiteScript error has occurred" = parse ไม่ผ่าน** (คอลัมน์ไม่มีจริง) ไม่บอกว่าตัวไหน → ไล่ทีละ join ·
  `NVL()` ใน ON clause → full scan ช้ามาก ใช้ `UNION` แทน ·
  ขับด้วย JS: `document.getElementById('query').value=<sql>; querySubmit();`
  อ่านผล `responseData.value` (CSV ดิบ) สถานะ `resultsDiv.innerText` (คลิกปุ่มบางทีไม่ติด)
  ⚠️ **`window.responseData` = undefined บน <acct-B> script=1190** (เช็ค 2026-09-17) → ท่าที่ชัวร์กว่าคือ parse ตาราง
  `resultsDiv.querySelector('table')` แถวแรก = header แล้ว map เป็น object — ได้ข้อมูลเป็น array ใน page
  แล้ว **คำนวณต่อในหน้าเลย** (เช่น FIFO 378 เอกสาร) คืนออกมาแค่ผลสรุป ไม่ต้องลากทุกแถวผ่าน context
- `transactionline.account` = NOT_EXPOSED (ใช้ `transactionaccountingline.account` แทน)
- **ใน query ที่มี GROUP BY: `BUILTIN.DF(...)` และ `LISTAGG(DISTINCT ...)` = "Invalid or unsupported search"**
  (พิสูจน์ 2026-09-13 acct <acct-B>) → select `t.status` ดิบแล้วแปลงเอง · แทน LISTAGG ด้วย `MIN(x)` + `COUNT(DISTINCT id)`
- **IF ที่มาจาก Transfer Order**: `t.type='ItemShip'` + `JOIN transaction tor ON tor.id = tl.createdfrom AND tor.type='TrnfrOrd'`
  (`transaction.createdfrom` ไม่มี ต้องใช้ฝั่ง line) · กรอง `tl.mainline='F' AND tl.taxline='F' AND tl.item IS NOT NULL` เสมอ
- **ดึงผลเยอะออกมาเป็นไฟล์ อย่าผ่าน context**: สร้าง Blob + `<a download>` แล้ว `.click()` ใน page → ไฟล์ลง ~/Downloads
  ⚠️ Chrome ยอม **ดาวน์โหลดอัตโนมัติได้ใบเดียวต่อหน้า** ใบที่ 2 ถูกบล็อกเงียบ ๆ (ไม่ error ไม่มีไฟล์) ต้องให้ user กด Allow

**schema / ทริกเพิ่มเติม**
- **ทดสอบว่ามีคอลัมน์จริง**: `SELECT <col> FROM <table> WHERE id=0` → "No Records Were Found" = parse ผ่าน มีคอลัมน์ · error = ไม่มี (ใช้ทำ `probeColumn()` ในโค้ด)
- **`=` บน string แยกตัวพิมพ์** → input ที่ normalize เป็นตัวใหญ่ไม่ match ค่าที่มีตัวเล็ก → `UPPER(col)=?`
- `BUILTIN.DF` + GROUP BY / **DISTINCT** ก็พัง → ดึง id แล้วแปลชื่อด้วยอีก query (`zoneNameMap()`) (พิสูจน์ ลูกค้า A SB1 2026-08-25 ด้วย)
- **BUILTIN.DF quirks**: location คืนแค่ชื่อ leaf (SS ได้ "Parent : Child") → `COALESCE(l.fullname, BUILTIN.DF(l.id))` · `BUILTIN.DF(po.status)` มี prefix "Purchase Order : " · `BUILTIN.DF(employee)` = entityid; **`altname` อยู่ตาราง `entity`** ไม่ใช่ employee
- **Chunk `IN (...)` ทีละ 200 id** (เกิน 200 เคยถูกข้ามเงียบ ๆ) + ใช้ bind `?`
- **N+1**: อย่า resolve lot ทีละบรรทัด → query InventoryBalance ครั้งเดียวคืน `inv.id` คู่ยอด (key `item|lot`)
- **SuiteQL ไม่ได้เร็วกว่า SS เสมอ**: join transactionLine 2 ชั้น + DF ต่อแถว SQL 837ms vs SS 72ms · TaxSchedule 1 แถว 147 vs 15 · subquery→UNION ช้าลง · SQL ชนะชัด: exchange rate, open qty (1263→68ms), location (110→14), vendor field (26ms vs SS 11,500ms)
- **อย่า group `transactionline` ทั้ง account ใน Suitelet รายงาน** (timeout) → คำนวณเฉพาะ subset แล้วโชว์ "—" ที่เหลือ
- **Item/sub**: `item` ไม่มีคอลัมน์ subsidiary → `itemsubsidiarymap` (ไม่อยู่ใน catalog แต่ใช้ได้) · location↔sub = `LocationSubsidiaryMap`
- **ItemAccountMapping native** = "Record not found" ใน SuiteQL ทั้งที่มีใน catalog (กลับกัน `transactionaccountingline`/`itemsubsidiarymap` ไม่อยู่ใน catalog แต่ใช้ได้) · catalog dump อาจเก่า custom field ใหม่ไม่มี / field ที่ user บอกชื่ออาจไม่มีจริง → grep โค้ดจริงก่อน
- **`customgl` ไม่มีใน SuiteQL** (มีแค่ `AccountPeriodActivity.isCustomGlLine` ระดับงวด) · บรรทัด Custom GL อยู่ใน transactionline/tal แต่ `item IS NULL` ไม่มี qty → แยกด้วย memo + `TO_NUMBER(REGEXP_SUBSTR(memo,'[0-9]+'))`
- **InventoryBalance** มีแค่ `quantityonhand`/`quantityavailable` (หน่วยฐาน) ไม่มีมูลค่า/as-of → แทน Inventory Valuation ไม่ได้ · available = onhand − commit (SO/TO/WO) และ **= 0 ได้กับของยืม** → เช็คของมีจริงใช้ onhand · `inventorystatus` มีเฉพาะบัญชีเปิด feature (try/catch) · status Good = 1 · on-hand ต่อ bin `SUM(quantityOnHand) WHERE binNumber=?`
- lot `inventoryNumber`(`inventorynumber`,`item`) · bin `bin`(`binnumber`,`location`) · หน่วย `unitsTypeUom`(`unitname`,`conversionrate`) · หา tran ด้วย `transaction.externalId` ได้
- **inventory assignment (lot/bin/qty ต่อ line ของ IT) SuiteQL ไม่ expose** → `record.load` + subrecord `inventorydetail`
- **As-of Inventory Valuation ด้วย SuiteQL** (ตรง cr=650 ถึงทศนิยม 7/8 item, 2026-08-21):
  ```sql
  SELECT i.itemid, SUM(NVL(tl.quantity,0)) qty, SUM(NVL(tal.debit,0)-NVL(tal.credit,0)) val
  FROM transactionaccountingline tal
  JOIN transactionline tl ON tal.transaction=tl.transaction AND tal.transactionline=tl.id
  JOIN transaction t ON t.id=tal.transaction JOIN item i ON i.id=tl.item
  WHERE t.posting='T' AND t.trandate<=:asOf AND tl.subsidiary=:subs AND tal.accountingbook=1
    AND tal.account IN (<inventory asset accounts>)  -- ★★ ต้องมี ไม่งั้น revenue/COGS ปน
  GROUP BY i.itemid
  ```
  `tal.transactionline = tl.id` join ได้ถูก · ทุก account 15s / ทีละ account 3.5s → chunk ตาม account
- **Item key ให้ตรงคอลัมน์ Item ของ standard report** (matrix child = `PARENT:CHILD`): `CASE WHEN i.parent IS NULL THEN i.itemid ELSE p.itemid||':'||i.itemid END`
- custom segment = คอลัมน์ `cseg_<name>` บน record (ตาราง `CUSTOMRECORD_CSEG_<NAME>`) · stock unit `BUILTIN.DF(i.stockunit)`
- exchange rate ล่าสุดต่อสกุล: `ROW_NUMBER() OVER (PARTITION BY currency ORDER BY effdate DESC)` rn=1 · open qty PR→PO ผ่าน `previousTransactionLineLink`
- **Bill ผูก PO ตรง ๆ** ผ่าน `previoustransactionlinelink` (`prev_type=PurchOrd`) ไม่ผ่าน IR · บิล 1 ใบเฉลี่ย 3–5 PO · record API: `vendorbill.getValue('createdfrom')` ว่าง → line `orderdoc`/`orderline` (orderline = PO `linesequencenumber`) · `ItemReceipt.createdFrom` → PO เชื่อได้ 100%
- **custom transaction**: `mainline='T'` คืน 1 แถวต่อบรรทัด, **`mainline='F'` คืน 0 แถว** → อ่านบรรทัดห้ามใส่ filter mainline · custbody ตัวเดียวใช้ร่วมหลาย type → กรอง recordtype ทุกครั้ง
- **Multi-Book**: GL รายเล่มอยู่ `transactionaccountingline` (`accountingbook`, debit/credit, `posting`, `exchangerate`) body/line = primary book เท่านั้น
- multi-select ค่ากลับมาเป็น `'785,786'` → SuiteQL กรอง `IS NOT NULL` แล้ว `split(',')` ใน JS · N/search `anyof` ใช้ตรงได้ · SS join ผ่าน field นี้ปกติ (เช่น `location.custrecord_loc_department` <acct-B>)
- **EFT SuiteApp (TH)**: payee bank `customrecord_eft_payeebankinfo` (Preferred + Subsidiary ตรง, Preferred ซ้ำเอา ID แรก) · `custrecord_eftpb_selectbank` → `customrecord_thl_eftbanks` (`name`, `custrecord_thl_thb_bankcode`, `custrecord_thl_thb_bankshortname`) · Service Method `custrecord_eftpb_eftbankservicemethod` · Enable `custrecord_eftpb_enablebankservicemethod`
- THL WHT payable `customrecord_thl_whtpayable` · vendor alt email `custentity_alt_email`

**line-level: transactionaccountingline ↔ previoustransactionlinelink จับคู่ตรง ๆ ไม่ได้**
- `tal.transactionline` = **internal line id** (49,51,53…) · `l.nextline`/`previousline` = **ลำดับบรรทัด** (1,2,3…)
- `ON tal.transactionline = l.nextline` → 0 แถว และ query **ค้างยาวไม่คืนผล** (ไม่ error)
- → ดึง 2 query แยกแล้ว join ตามตำแหน่งใน JS (จำนวนแถวต่อ doc เท่ากันเสมอ)
  **ต้องพิสูจน์**: เอกสารที่รู้ว่าปิดแล้วต้องได้ 0.00 เป๊ะ
- `vendorBill` **ไม่มี** `createdFrom` (แต่ `ItemReceipt.createdFrom` / `PurchaseOrder.createdFrom` มี)
- บิล 1 ใบผูกได้ **หลาย PO** → ห้ามเอายอดทั้งใบไปให้ PO ใดใบเดียว
- PO status: `A`PendingApproval `B`PendingReceipt `D`PartiallyReceived
  `E`PendingBilling/PartiallyReceived `F`PendingBill(รับครบยังไม่ตั้งหนี้) `G`FullyBilled `H`Closed
- งาน GR/IR reconcile ดู `grir-reconcile` (บันทึกส่วนตัว)

**Currency Revaluation (FxReval) — Details grid ดึงด้วย SuiteQL ไม่ครบ**
- `transaction WHERE type='FxReval'` · ใบ reval งวดนี้คู่กับใบ reversal งวดถัดไป (line ของใบแรกมี `createdfrom` = id ใบ reversal)
- SuiteQL ได้เฉพาะบรรทัดที่ **gain/loss ≠ 0** เท่านั้น (เคส JCR-5165: grid 1445 แถว แต่ GL 295 / `nexttransactionlinelink WHERE nextdoc=<id>` 294)
  ลิงก์กลับเอกสารต้นทางใช้ `nexttransactionlinelink.previousdoc` (ฝั่ง `previousdoc=<id>` ได้ 0)
- **ครบ 1445 ต้องอ่านจาก client-side ของหน้า record**: `lineFields.openrecv` (+ `openpay` `foreignaccts` `appliedrules`)
  field ต่อ 1 แถว: `type ddate entity kentity currency tfxrate(transaction rate) cfxrate(ending rate) balance variance(gain/loss) previous(prior) netvar(net) acct accttype origdoc origline typeurl`
  ⚠️ ฝั่ง receivable **grid flip sign** — `netvar` เป็นลบ แต่หน้าจอโชว์บวก · `SUM(netvar)` = -TOTAL VARIANCE

## 8. Standard report (reportrunner.nl)

NetSuite **ไม่มี API อ่าน native report** — ต้อง render ในหน้าจริงก่อนถึงจะ export ได้
โค้ด production ของทีม: `sl_convert_report_to_csv (prdo20260703).js` + ตัว CS

flow: Suitelet สร้าง hidden iframe ชี้ไป `reportrunner.nl?cr=<id>&crit_…` → CS poll ทุก **400ms** จน
`contentWindow.reportTable.oContentProvider.oHierarchy` พร้อม → ประกอบ URL เอง
`?id=<sExecutionId>&reportaction=exportcsv` + `NLReportWidgets_getGridDisplayPreferenceAsParam()`
+ `visibleranges=<getVisibleRowRangesStringMergeAdjacent()>` → `nlapiRequestURL` ได้ CSV ดิบ

★ **iframe เลี่ยงไม่ได้** (ทดสอบสด 2026-08-21 ล้มทั้ง 3 วิธี): export ตรงไม่มี exec id → 500 ·
ดึง exec id จาก `executemodified` → "The report has expired." · `reportaction=reportdata` ก่อน → expired เหมือนกัน

กับดัก: `getVisibleRowRangesStringMergeAdjacent()` export **เฉพาะแถวที่กางอยู่** → ต้อง `expandlevel=100` ·
crit แต่ละตัวรับคนละชนิด (location รับ **ชื่อ**, subsidiary รับ **id**) ส่งผิดชนิด **คืนศูนย์ทั้งใบไม่ error** ·
หาค่าที่ถูกด้วย `new FormData(document.forms['footerform'])` ·
**ห้ามรัน iframe ของรายงานเดียวกันขนานกัน** (NS cancel instance แรก) MAXTHREAD=1 มีเหตุผล ·
client-only รันใน scheduled/MR ไม่ได้ · CSV บรรทัด 0–5 = header block, บรรทัด 6 = column header

- **`cr=<N>` ที่เป็น saved report customization มี Audience ของตัวเอง** — user นอก audience: iframe render หน้า notice, CS poll `reportTable` วนจน timeout 180s **ไม่ error** · แก้ role ไม่ช่วย ต้องแก้ Audience ใน Report Builder (XHR โหลด อ่านจาก fetch ไม่ได้) · CS กันไว้: ~10s ไม่มี `reportTable` → อ่าน `frame.contentDocument.body.innerText` โชว์ + ดึง iframe เข้าจอ + ลิงก์เปิดรายงานตรง (role 1038 <acct-B> 2026-09-18) · role ไม่มี Export Lists ก็ `exportcsv` ได้
- **Inventory Valuation cr=650**: location = `crit_2` รับ **ชื่อเดียวต่อรอบ** → หลาย location = iframe ต่อ location ทีละตัว · มี Show Zeros → CSV คืนทุก item (10,228 แถว) แม้ location ไม่มีของ อย่าเอาจำนวนแถวตัดสิน
- **Total ของรายงาน ≠ ผลรวมแถวที่ export** (qty export 4dp, NS รวมเต็มความละเอียดแล้วปัด) แก้ไม่ได้ · เทียบ 0 ด้วย epsilon (ครึ่งหน่วยแสดงผล) ไม่ใช่ `!== 0`
- Account Detail `.xls` = **SpreadsheetML (XML)** ไม่ใช่ xls binary → parse แบบ XML (`grir_check.py`)
- scrape native aging: merge ด้วย Document Number · แถว total AR=`'Total'` AP=`'Grand Total'`
- CSV ที่ SL สร้าง → เก็บ File Cabinet ก่อนแล้ว step SFTP ใช้ fileId เดียวกัน (แก้ format ที่เดียว) · ชื่อไฟล์ไม่มี period = เดือนใหม่ทับเดือนเก่า
- reconcile บัญชีพัก: สรุปตามผู้ขายก่อน แล้วยอดสุทธิ posting จริงต่อ PO · ★ ห้ามจับคู่ด้วย "ยอดตรงข้ามเท่ากัน + ผู้ขายเดียวกัน" (ยอดรวมถูกแต่ชี้ผิดใบ) — รายละเอียด `grir-reconcile` (บันทึกส่วนตัว)

## 9. Workflow — อ่าน action ทุกตัวแบบ read-only

1. `/app/common/workflow/setup/workflowlist.nl` → `<tr>` cell[1]=id cell[2]=name
2. `…/nextgen/data/workflowdesktopdata.nl?id=<WF>&path=structure` → JSON `{states:[{name,key}]}` (`key` = STATE_KEY)
   มีแค่ `path=structure` กับ `path=panel` ที่ 200 ที่เหลือ 500
3. `…/workflowstate.nl?workflow=<WF>&id=<STATE_KEY>&ifrmcntnr=T` → HTML ~1.2MB มี sublist Actions ครบ
   แถวที่ cell[0] match `/^workflowaction\d+$/` → [id, type, parameters, triggerOn, eventTypes, contexts, condition]

`workflow.nl?id=` = 500 · `workflowmanager.nl?id=` redirect ไป shell ที่โหลด action ทีหลัง
ยิงพร้อมกันหมดจะหลุด → แบ่งชุดละ 12–28 · output ยาวโดน truncate → slice ทีละ ~50 แถว
ค้นชื่อ field ต้องเผื่อสะกดผิด (เจอ `Subsidary` ใน account <acct-C>)
คู่มือเต็ม: `ns-workflow-bulk-read-standard.md`

## 10. พฤติกรรม NetSuite / SuiteScript ที่เป็นกับดัก

- **ตัวแปร module-level ไม่ข้าม execution ระหว่าง beforeSubmit → afterSubmit** ต้องฝากผ่าน `N/cache`
  (พิสูจน์จาก log จริง: จดตอน 06:17:53 → afterSubmit อ่านไม่เจอตอน 06:18:15)
  N/cache scope มีแค่ PRIVATE/PROTECTED/PUBLIC (**ไม่มี MODULE**) · PRIVATE แยกต่อ script (lib ใช้ร่วม 38 endpoint = 38 cache) · ใช้ทำ claim/idempotency ได้แค่ best effort **ไม่ atomic**
  master list ที่เปลี่ยนช้า: PUBLIC + ชื่อมี version (`…_v23`) เก็บ `[{value,text}]` ที่แปลงแล้ว · TTL master 3600s, ค่าการเงิน (exchange rate) 300s · มี `&nocache=T` bypass (Search 14.5s/515 units → 0.53s/83)
- **ลบ tx แล้วจัดการ record ที่อ้างถึง** (ทางที่ใช้ได้): beforeSubmit(DELETE) จด id ลง N/cache → afterSubmit (ยิงเฉพาะเมื่อลบสำเร็จ) ลบตาม · reader กรอง `IS NOT NULL`
- **UE afterSubmit DELETE**: อ่าน `newRecord.id` ตรง ๆ throw → handle delete ไว้บนสุด try/catch แยก · perf guard: ตัดสินว่า "ใช่ของเรา" ก่อน load/query ใด ๆ แล้ว return เร็ว
- void (ไม่มี reversing journal) → beforeSubmit ต้องข้ามการ process line เมื่อยอดรวม = 0 ไม่งั้นลบ stamp ก่อน afterSubmit
- **`new Date()` ใน SuiteScript = เวลา server** (04:59 ตอนไทย 19:12) → ส่ง epoch ให้ client · `lastmodified` render เป็นเวลา user แต่ `SYSDATE` เวลา server แม้แถวเดียวกัน → เก็บ epoch เองใน field แยก
- **SuiteScript ไม่มี fire-and-forget ใน request เดียว** — งานเสริม (logging query) = +1 query sync เสมอ
- UE throw error แบบ JSON → หน้า Notice โชว์ JSON ดิบ ต้อง throw ข้อความอ่านได้
- ข้อความ server ที่แทรกชื่อ item/lot ห้าม render เป็น HTML (injection) ใช้ `text`
- **ทศนิยม**: JS diff `1.5999999999999996` → round ก่อนเก็บ · qty round ภายใน 5dp, `EPS=1e-6` (0.001 ซ่อนค่าจริง) · แสดง 2dp ซ่อน 10,991.317→.32 · PROD ลูกค้า B เปลี่ยน `.toFixed(2)` → `toFixed2()` + VAT bottom-up — VAT ต่างทีละสตางค์ดูตรงนี้ก่อน · ⚠️ `toFixed2()` ตัวเดิม (THL lib) ปัดซ้อน: ปัด 4dp ก่อนแล้วค่อย 2dp → .5450–.5499 ขึ้นผิดเป็น +0.01 (BP-ลูกค้า A-26100538 Offset Letter .56 vs .55 → บรรทัด Rounding 0.01); แก้เป็น `Math.round(Number((num*factor).toFixed(6)))` แล้ว (2026-10-07, ลูกค้า A InputVAT CustomGL for Bill Payment)
- **★ field Currency บน custom record (เขียนผ่าน recmach ของ tx) ถูกปัดตามสกุลของ tx** — JPY 733576.50 → 733577 → เทียบกับ `toFixed(2)` ไม่เท่าทุกครั้ง (loop approve ไม่จบ) · fix: อ่าน body `currencysymbol` (fallback `currencyprecision`==0) JPY/KRW/VND/IDR → `Math.round` ทั้งสองฝั่ง · ดีกว่า: เปลี่ยน field เป็น Decimal
- **Saved search summary ไม่ตรง**: SS column เป็น MAX แต่โค้ด `getValue({summary:'AVG'})` → **0 ไม่ throw** + `x || '1'` → rate ทุกสกุล = 1 (USD เพี้ยน ~34 เท่า) · ใช้ `??` กับตัวเลข ไม่ใช่ `||`
- SS **ไม่มี sort** = "แถวแรกต่อ key" ไม่ใช่ล่าสุด · `getRange(0,200)` ตัดเงียบ ๆ (282→200) → runPaged/each หรือ SuiteQL · filter `internalid anyof` ของ record type หนึ่งใช้กับ SS อีก type = match 0 ไม่ error
- `absoluteValue` ใน SS formula บ้างมีบ้างไม่มี → `Math.abs()` แล้วใส่เครื่องหมายจากคอลัมน์ `type` เอง
- reversal ด้วย `record.copy` ได้ memo เหมือนต้นทางแต่ dr/cr สลับ → รวมสุทธิทุกใบที่ไม่ void ได้ยอดจริง · ⚠️ set แค่ trandate ไม่ set postingperiod (dynamic) อาจลงงวดเดิม (ยังไม่พิสูจน์)
- NS **ไม่เก็บวันที่ apply จริง** ของ Payment/CM/BC/JV — aging ย้อนหลังใช้ trandate ของเอกสารที่มา apply · Payment ไม่บอกว่า credit ไหนตัด invoice ไหน → track เป็น ledger delta ต่อบรรทัด (`applied-date-tracking` (บันทึกส่วนตัว))
- **Item costing Group Average**: NS ไม่ผูกยอดกับ receipt → สรุปไม่ได้ว่ายอดมาจาก IR ไหน (FIFO trace = สมมติฐานเรา ต้องให้ stock ติดลบกิน lot ถัดไป)
- item ที่คุม lot/serial: ยอดนับระดับ item ปันกลับลง lot ไม่ได้ → IA ต้องมี lot
- **2.x → 2.1**: assign ไม่มี `var` พัง strict · กลับกัน ไฟล์ `@NApiVersion 2.x` ที่ใช้ `let`/arrow upload ไม่ผ่าน "missing ; before statement" · SS2.x ไม่มี `String.replaceAll`
- **relative `require`** resolve จากตัวไฟล์ → ย้ายโฟลเดอร์ `../../LIB/x` พัง `MODULE_DOES_NOT_EXIST` · script record ใหม่ = scriptId ใหม่ → แก้ทุก nav/redirect/`CLIENTSCRIPT_ID` · อย่าพึ่ง global ที่ module อื่นปล่อย (เช่น `file`) ใส่ `N/file` ใน define เอง
- `response.writePage(form)` สองครั้ง = ฟอร์มเปล่าซ้ำ
- **`https.requestSuitelet` จาก scheduled/MR รันเป็น -System-** → Suitelet คืน Notice 500 (browser เปิดปกติ) · fix: `url.resolveScript({…,returnExternalUrl:true})` + `https.get` + deployment **Available Without Login=T** + audience กว้าง + retry 1 + log body
- Suitelet แบบ external: `runtime.getCurrentUser().id` = guest → set ลง employee field แล้ว save throw → fallback · audit ใน render path ห่อ try/catch
- **`email.send` รวมผู้รับ ≤ 10** เกินใช้ `email.sendBulk` · pattern `TEST_MODE` const ต้นไฟล์ (ส่งหาตัวเอง ตัด CC log ผู้รับจริง) — เช็คเป็น `false` ก่อน go-live
- **ห้ามเชื่อ validation ฝั่ง client** (location permission/status/subsidiary) — ยิง payload ตรงเข้า Suitelet แล้วของย้ายจริง 3 เคส → server คำนวณใหม่จาก DB เสมอ
- **ลบ transaction แล้ว custom record ที่อ้างถึงจะถูกล้าง field เป็น null ไม่ได้ถูกลบตาม**
  → ค้น `WHERE <field> = <id>` ใน afterSubmit จะไม่เจอ ต้องจด id ตั้งแต่ beforeSubmit (ฝากผ่าน cache)
  → และควรกรอง `AND <field> IS NOT NULL` ในทุก query ที่รวมยอด ไม่งั้นแถวกำพร้าจะล็อกข้อมูลไว้ตลอดไป
- **`setSublistValue('quantity')` บน record non-dynamic ไม่ recalc `amount`** (กด Recalc ก็ไม่ช่วย)
  → เซ็ต amount เองด้วยสัดส่วน `oldAmt * newQty / oldQty` (อย่าใช้ rate เพราะอาจคนละ UOM)
- **`removeLine`/`setSublistValue` ใน beforeLoad ของ transform ทำงานได้จริง** (ไม่ต้องกลัว)
- **`addButton` + `functionName`**: รูปแบบ assignment (`window.location.href=...`) ไม่ทำงาน
  และถ้าฟอร์มตั้ง `clientScriptModulePath` ไว้ NetSuite จะเรียก functionName เป็น **member ของ CS module นั้น**
  ฟังก์ชันบน window จะไม่ถูกเรียกและ error ถูก try/finally กลืน (ปุ่มกดแล้วนิ่ง)
  → ผูก `onclick` เองจาก inlinehtml ทับทั้ง `custpage_*` **และ** `secondarycustpage_*`
  ⚠️ **แต่ถ้าใส่ `functionName:'void(0)'`** บนฟอร์มที่มี `clientScriptModulePath` → `Uncaught TypeError: mod.void is not a function` ตอน **module init** (ไม่ใช่ตอนคลิก) และพัง CS อื่นในหน้า (prod PO 2026-08-31)
  กติกา: ปุ่มที่ผูกเอง **ไม่ใส่ functionName** · inline JS `el.removeAttribute('onclick')` ก่อน set `el.onclick` · ผูก 2 ทาง: `getElementById` + ธง `el.__bound` และ `document.addEventListener('click',fn,true)` ไล่ขึ้น 4 parent match **label text** · ปิดด้วย `console.log('bound =',n)` · ใช้ functionName เฉพาะเมื่อ CS export ฟังก์ชันนั้นจริง
- `form.getButton({id:'bill'})` เข้าถึงปุ่มมาตรฐานได้ ใช้ผูกเงื่อนไขแสดงปุ่มเราให้ตรงกับ NetSuite (PO billed ครบปุ่มมาตรฐานหาย แต่เช็ค status ยังผ่าน → ใช้ status เป็น fallback เท่านั้น)
- **void ในบัญชีที่ไม่ได้เปิด reversing journal = ลบ item line ทิ้งทั้งหมด** เหลือแค่ OthCharge + TaxItem
  → custom column บน line หายไปด้วย ห้าม rebuild อะไรจากค่าบน line ให้เช็ค **ยอดรวม = 0** แล้วจัดการก่อน
- SS2.x: ช่อง Before Load / Before Submit / After Submit Function บน Script record **ว่างเป็นเรื่องปกติ**
  (NetSuite อ่าน entry point จาก object ที่ `return`)

- - **★ NS ยุบช่องว่างซ้ำใน `inventoryNumber` เหลือ 1 เคาะตอน save** → ข้อความสแกนจากป้าย (2 เคาะ) ≠ DB, `WHERE inventorynumber=?` คืน 0 เงียบ ๆ · ถอดช่องว่างทิ้งชนกันจริง → ใช้หาผู้สมัครเท่านั้น · ต้องผูก `item` เสมอ (ไม่งั้น `REPLACE()` full scan 1.8M แถว) · IA จับด้วย internal id ของ inventorynumber · รายละเอียด TWMS §13
- **lot/serial และชื่อ bin เป็นเลขล้วนได้** (241224011950002) → อย่าใช้ `/^\d+$/` เดาว่าเป็น internal id · query `inventoryNumber + item` เสมอ
- **★ dynamic record: `setCurrentSublistValue` กับ field id ที่ไม่มีจริงไม่ error และ `getCurrentSublistValue` อ่านกลับได้ค่าที่ set** → read-back พิสูจน์ field ไม่ได้ ใช้ `rec.getSublistFields({sublistId})` กรองก่อน
- **ชื่อ bin / pallet ซ้ำข้าม location ได้** → lookup ด้วยชื่อต้องกรอง location (+sub) เสมอ (หยิบแถวแรก = ของไปผิด location จริง)

**Role ที่ใช้ custom center (`centertype=CUSTOMn`) แต่ parent เป็น standard role (เช่น ACCOUNTANT) save ไม่ได้เลย**
  แม้แค่เปลี่ยนชื่อ → "The center type of your customized role must match the center type of the parent role."
  (เจอ 2026-09-28 acct <acct-C> เปลี่ยนชื่อ RPT role) · role ที่ center เป็น standard save ผ่าน
  · **SDF deploy ก็ติด error เดียวกัน** (ทดสอบ customrole1159 2026-09-28) — ไม่ใช่ทางเลี่ยง
  · SDF export role แล้ว validate ไม่ผ่านเองได้: permlevel `EDIT` ของ `REPO_RECONCILE`/`ADMI_ACCOUNTING` ถูกปฏิเสธ
  · role ที่สร้างใหม่ไม่มี parent (`parentrolescriptid` ว่าง) ไม่ติดเงื่อนไขนี้
  · rename role ขนานหลาย iframe → onload ครั้งที่ 2 คือหน้า Notice error ไม่ใช่ save สำเร็จ → ต้อง fetch อ่านชื่อกลับทุกครั้ง

**ฟอร์ม transaction หนัก (เช่น Vendor Bill HTML 8.6 MB)**
- renderer ค้างหลังโหลด → click/screenshot/eval time out เป็นนาที · รอเป็นชุด `wait 10s` โดยไม่ยิง CDP แล้วค่อยลองใหม่
- Save: `document.forms['main_form'].submit()` ใช้ได้ (คลิกปุ่มไม่ติด)
  **แต่ถ้าแก้ค่า sublist ฝั่ง client ก่อน ค่าจะไม่ถูก serialize ลง POST** และ `NLDoMainFormButtonAction` ก็ไม่ยิง
  → เคส "แก้ค่าแล้ว save" ต้องให้คนกดเอง
- **ปุ่ม Delete อยู่ในโหมด Edit เท่านั้น** (`?id=x&e=T`, element `secondarydelete`) เมนู Actions หน้า view ไม่มี
  · เมนู Actions เป็น lazy ต้องคลิกก่อนถึงจะมี item ใน DOM · บิลที่ void แล้วจะไม่มี Delete เลย
  · ก่อนคลิก Delete: `window.confirm=function(){return true;}`

**เพิ่ม Subsidiary ให้ Item/Account ยกชุด** (ทำจริง 2026-10-05 ลูกค้า C SB1 เพิ่ม sub 21 ให้ 166 item + 61 account)
- Item save ไม่ผ่านถ้าบัญชี GL ของ item (income/expense/deferred rev ใน `accounting_form` ไม่ใช่ `main_form`) ไม่ครอบ sub ใหม่ → Notice "subsidiary restrictions … incompatible with … account" → **แก้ account ก่อน item**
- "ครอบ" = มี sub นั้นตรง ๆ หรือ Include Children + มี parent (เช็ค parent จาก `subsidiarytype.nl?id=N&e=T`)
- `nlapiSetFieldValues('subsidiary', cur.concat([new]), true, true)` ใช้ได้ทั้ง item/account
- **hidden iframe ใช้ไม่ได้กับ item/account** (ค่าเข้าแต่กด submitter ไม่ติด / onload ครั้งที่ 2 หลอกว่า done) → ทำในแท็บหลักทีละใบ: เก็บ worklist + snippet ใน localStorage, browser_batch วน `eval(A)`→wait 5→`eval(B)`→wait 8 × 7 ใบ/batch (~13 วิ/ใบ)
- snapshot ค่าก่อนแก้ลง localStorage เสมอ (ตัวแปร window หายตอน navigate) แล้ว re-survey เทียบ lost/extra/dup
- Account: type อ่านจาก `accttype` (Bank/COGS/...) — คอลัมน์ในหน้า list `accounts.nl` เลื่อน อย่า parse ตาราง · บัญชีระบบ NonPosting (Opportunities, Estimates, PO…) ไม่มี Number → save ไม่ได้ (Number บังคับ)
- "edit แล้ว save เฉย ๆ ให้ UE ทำงาน" ตรวจผลด้วย `lastmodifieddate` (hidden ในหน้า `&e=T`) ว่าเป็นวันนี้
- หลัง save NS เด้งกลับ `whence` = หน้าที่เปิดมาก่อน (อาจเป็นหน้า edit ของ record อื่น) → เช็ค "ยังอยู่ e=T" จาก URL หลอกได้ ให้ verify จากค่าจริง

## 10.5 Dashboard / Publish Dashboard / Role ของ Employee (ทำจริง 2026-09-28 acct <acct-C>)

**สลับ Role ด้วย URL** `/app/login/secure/changerole.nl?id=<acct>%7E<employeeId>%7E<roleId>%7EN`
⚠️ Role เป็นของทั้ง session คนใช้สลับใน Chrome = แท็บเราสลับตาม (เจอ 2 ครั้งกลางงาน)
→ **เช็คชื่อ Role ก่อนทุกขั้นที่เขียน** (`document.body.innerText.match(/Limited\s*-\s*([^\n]+)/)`) ไม่ตรงให้หยุด
· screenshot บนโดเมน NS โดน "Permission denied" (บางครั้ง) → ทำด้วย JS หรือใช้ทางใน §19

**Add Role ให้ Employee** หน้า `employee.nl?id=<emp>&e=T` sublist `roles` field `selectedrole`
`nlapiSelectNewLineItem('roles'); nlapiSetCurrentLineItemValue('roles','selectedrole',id,true,true); nlapiCommitLineItem('roles')` → submitter + wait 10s
ข้าม id ที่มีอยู่แล้ว · verify: เปิด `&e=T` ใหม่แล้วนับ line (หน้า view ไม่มี sublist API คืน -1)
⚠️ บอก user ว่าหน้า edit ที่เขาเปิดค้างอยู่ห้ามกด Save (เขียนทับ role ที่เราเพิ่ม)
หา id role ตามชื่อ: fetch `/app/setup/rolelist.nl?whence=&size=1000` → `a[href*="role.nl?id="]`

**อ่าน dashboard** (`/app/center/card.nl?sc=-29` = Home) → `div.ns-portlet-wrapper[data-portlet-type]`
attr `data-portlet-id` · คอลัมน์ = `closest('[id^="dashboard-column"]').id`
- **ลบ portlet**: `li[data-action="close"]` ในเมนู overflow `.click()` ได้เลย (ติดถาวร reload แล้วยังหาย)
- **เพิ่ม portlet**: คลิก `#ns-dashboard-personalize-link` → item `div.ns-content-manager-item` (id `portlet-group-...`) `.click()` = เพิ่ม
  (Subsidiary Navigator = `portlet-group-HTML_895_2`)
- **Reminders**: `li[data-action="setup"]` → popup `.ns-reminders-popup` (div ในหน้า ไม่ใช่ iframe)
  ซ้าย `.ns-dragable-panel-left` คลิก item = เพิ่ม · ขวา `.ns-dragable-panel-right .ns-setup-item` คลิก = ลบ
  custom reminder id = `SEARCH<savedsearchId>` · Save = `span[data-type="save"]`
  ☑ "Show reminders with zero results": คลิก `span` ที่ครอบ input (onclick=NLCheckboxOnClick) ไม่ใช่ input เอง
  ถ้าไม่ติ๊ก reminder ที่ผลเป็น 0 จะขึ้น "No content" (ไม่ใช่บั๊ก)
  ⚠️ `reminders.nl` เปิดตรง/iframe ค้าง "Loading" ตลอด ต้องใช้ popup จาก portlet
- **Shortcut** อ่าน: fetch `/app/center/setup/shortcuts.nl?sectionid=-29&qelem=servercontentneg58` → `shortcutdata`
  (seq|enable|label|url|newwindow|taskid|params|dashboard)
  เพิ่มแบบ task-based (เหมือนกดดาว): navigate `/core/pages/addShortcut.nl?label=<>&taskid=<taskid>&params=<urlencoded>` → submitter
  taskid หาได้จาก `String(window.addShortcut)` บนหน้านั้น · `addshortcut.nl` ของ portlet = ได้แค่ External URL
  ⚠️ ถ้า role ไม่อยู่ใน audience ของ Suitelet → "You do not have privileges" ต้องเพิ่มที่ deployment ก่อน (shortcut ยังโผล่บน dashboard แต่กดแล้ว error → เช็ค audience หลังก๊อป dashboard ทุกครั้ง)
  portlet SuiteApp ที่เสีย: "Source script or script deployment is missing"

**Publish Dashboard** `/app/center/setup/savedashboard.nl` (list `savedashboards.nl`)
dropdown Role = เฉพาะ role Center เดียวกัน **และ** (น่าจะ) subsidiary ไม่กว้างกว่าคน publish — role ใหม่ที่เห็น sub เกินไม่โผล่
→ ทางออก: login ด้วย role ปลายทาง จัด dashboard เอง แล้ว publish ให้ตัวเอง (role ตัวเองอยู่ใน dropdown เสมอ)
field: `dashname` · sublist `rolemaps` (`selectrole`,`overwrite`) · sublist `sectionmaps` (`sectionshow` T/F, `dashmode` UNLOCKED/LOCKED/…, `sectionkey`; Home=-29)
published dashboard apply **ครบทุก tab** (เช่น 10 tab) ไม่ใช่แค่ Home — ก๊อปแค่ Home ต้องบอก user
`overwrite` อ่านกลับเป็น F เสมอ (ของเดิม id 67 ก็ F) — น่าจะเป็น action ครั้งเดียว ไม่ใช่ค่าที่เก็บ
⚠️ `dashname` ยาวสุด **30 ตัว** และ **ห้ามซ้ำ** (alert แล้วไม่ save เงียบ ๆ) → ใช้ `<roleId> <ชื่อย่อ>`.slice(0,30)
ต้อง hook `window.alert` เก็บข้อความไว้ ไม่งั้นไม่รู้ว่าทำไมไม่ save · ผ่าน = URL กลายเป็น `?id=<n>`

**กับดักตอนทำยกชุด (19 role)**
- ลบ portlet รอบแรกบางทีไม่ติด (หน้ายังโหลดไม่เสร็จ) → ลบ 2 รอบ แล้ว reload เช็คเสมอ
- popup reminder: ต้องรอจน `.ns-dragable-panel-left .ns-setup-item` > 5 ก่อนเลือก ไม่งั้นหาไม่เจอ/ติ๊ก zero ไม่ติด
- changerole แล้วเจอ `enterpriselogin.nl` = session หลุด ต้องให้ user login เอง (eval โดน CSP บนหน้านั้น)
- ชื่อ role ที่มี `&` ทำ output โดน `[BLOCKED: Cookie/query string]` → `.replace(/&/g,' AND ')` ก่อนคืน
- เช็คสิทธิ์ Suitelet ต่อ role เร็ว ๆ: `fetch(changerole)` → `fetch(scriptlet.nl?...)` แล้ว grep "do not have privileges" (ไม่ต้อง navigate)
- เก็บ helper ไว้ใน `localStorage` แล้ว `eval('('+localStorage.x+')')` หลังเปลี่ยนหน้า (ใช้ได้บนหน้า NS ปกติ)
งานจริง: `rpt-26-dashboard-copy` (บันทึกส่วนตัว)

## 11. หา record ตัวอย่างสำหรับเทสเคสยาก

```sql
-- PO ที่มี 1 line รับหลายรอบ (เคสที่บั๊กชอบซ่อน)
SELECT ln.previousdoc, ln.previousline, COUNT(DISTINCT ln.nextdoc) AS irs
FROM nexttransactionlinelink ln
JOIN transaction ir ON ir.id=ln.nextdoc AND ir.type='ItemRcpt' AND ir.voided='F'
GROUP BY ln.previousdoc, ln.previousline HAVING COUNT(DISTINCT ln.nextdoc) > 1
```
เลือกใบที่ **line น้อยแต่เงื่อนไขครบ** จะเทสเร็ว · และต้องมีใบที่ **UOM conversionrate ≠ 1** ด้วย
ไม่งั้นบั๊กเรื่องหน่วยจะไม่โผล่เลย (ใบที่ conv=1 ผ่านหมดทั้งที่โค้ดผิด)
- item **stock unit ≠ base unit** (เช่น 73465 `2PRD-PM-BL-00-004` บน <acct-B>-sb1) · lot ที่มีของ: SS 6773 + filter URL (§1)
- **เทสทุก subsidiary** — บั๊ก `NVL(i.parent,i.id)` ซ่อนบน sub 2 (ไม่มี matrix child) โผล่บน sub 4 → ต้องมี matrix child + conv≠1
- status ≠ Good ถ้าไม่มีต้องทำ Inventory Status Change เอง · บั๊กเรื่องลำดับซ่อนในข้อมูล item เดียว/2 bin ต้องหาเคสที่ลำดับสวนกัน
- <acct-B>-sb1 = data ระดับ prod (387 location / 208,208 bin / 26,460 IT / OneWorld)

---

## 12. SuiteScript สร้างเอกสารคลัง (IT / Bin Transfer / InventoryBalance)

- **Inventory Transfer (dynamic)**: `record.create({type:INVENTORY_TRANSFER,isDynamic:true})` · header `location` + `transferlocation` · `trandate` = Date · sublist `inventory`: `item`, `adjustqtyby` · subrecord `inventorydetail` → `inventoryassignment`: `issueinventorynumber` (internal id ของ lot), `binnumber`, `tobinnumber`, `quantity` (+`frombinnumber`, `inventorystatus` แบบ soft) (SB1 2026-07-20)
- **Bin Transfer** `BIN_TRANSFER`: ไม่มี `transferlocation` · line ใช้ `quantity` · set `subsidiary` ได้ · **หน่วยบน line ชื่อ `itemunits` ไม่ใช่ `units`**
- **★ หน่วย line default = stock unit แต่ InventoryBalance/transactionline เป็นหน่วยฐาน** → ส่งเลขฐานโดยไม่ set หน่วย = ย้ายผิดเป็นเท่าตัว (12×, KG/MT 1000×; IA <acct-D> UI 21.25 MT = SQL 21250 KG) · fix: stock=base ไม่แตะ / ไม่เท่า → pin หน่วยฐานที่ `itemunits`/`units` (กรองด้วย `getSublistFields()`) ไม่ได้ค่อยแปลง qty เอง
- `subsidiary` บน IT: set เมื่อ `runtime.isFeatureInEffect('SUBSIDIARIES')` · **set ก่อน location** · subsidiary ว่าง → `Invalid Field Value <locid> for … location` ทั้งที่ location ถูก → derive sub จาก location ฝั่ง server
- **externalid ของ IT อาจถูก customization เขียนทับด้วย tranid** (<acct-B>-sb1; BT ไม่โดน) → idempotency ด้วย externalid พัง → ใช้ custom record ของเรา (clientReq → resultTran) เป็นกุญแจ
- สร้าง record ประกอบ (bin) ก่อน save เอกสารหลัก → save ล้มเหลือ orphan → `rollbackCreatedBins()` (delete ก่อน ไม่ได้ค่อย inactive)
- เอกสารคู่ (IT เข้า/ออก) → build ทั้งสองใบให้ผ่าน validation ก่อนค่อย save · write-back `submitFields({…,options:{ignoreMandatoryFields:true}})` ใน try/catch คืน flag `wroteBack`
- error ดิบ `The following Inventory numbers are not available: …` → map ข้อความก่อนส่ง user
- Governance guard `runtime.getCurrentScript().getRemainingUsage() < 200` → throw ให้กดซ้ำ (คู่ idempotency)

**Performance / governance (วัดจริง <acct-B>-sb1 / SB1 2026-08)**
- `recordSave` กิน 59–98%: **BT ≈ 3.0s + 0.45s/บรรทัด, IT ≈ 5.0s + 0.92s/บรรทัด** · validate/permission/query ถูกมาก (20–113ms) · governance เหลือ 852–970/1000 แม้ 24 บรรทัด → แลก query เพิ่มเพื่อลด record op ได้ · concurrent 10 submit wall 6.3s
- **`record.create`+save ~52 บรรทัด/คำขอ** ก่อนชน governance → client ตัดชุด 40 · **`submitFields` 125 บรรทัดรอบเดียวผ่าน** · ยิง 98 พร้อมกัน = เข้า 52 ค้าง 46 → server รายงาน `pending` · ส่งเฉพาะบรรทัด `dirty`
- **Cold start**: ครั้งแรกหลัง deploy ช้ามาก, idle **6 นาที** ก็เย็น (checkBin 15.6s, submit 1 บรรทัด ~240s) · สาเหตุ DB plan cache **ไม่ใช่ขนาดไฟล์** · **save Script Deployment = ล้าง cache** (call ถัดไป 68.6s) · อุ่น endpoint หนึ่งไม่ทำให้อีกตัวอุ่น → warm-up ต้องแตะทุก query path ทุก 3–5 นาที
- Suitelet page จาก `writePage(form)` มี inline script ของ UIF **~1,765KB** (91% ของหน้า) cache ไม่ได้ · เลี่ยงได้ทางเดียว `response.write()` HTML เอง · หน้า filter warm ~600ms (SQL ~150ms ที่เหลือ render)
- DOM ใหญ่ทำ UI ตาย: 4,546 บรรทัด → 173,092 nodes, heap 1.7GB, พิมพ์ 1 ช่อง 1,905ms → pagination

## 13. TWMS (custom WMS ของทีม — schema/พฤติกรรมที่ใช้ซ้ำทุกโปรเจกต์)

- Preference singleton `customrecord_twms_wmspreference` (<acct-B> `rectype=2512&id=1`, 82 fields; ปกติ id 1 / MIN(id) active) · User & Permission rectype 2533 · Item WMS subtab `custom338`
- **Barcode pattern** `CUSTOMRECORD_TWMS_CONFIG_PATTERN_BARCODE` field `custrecord_twms_cpb_` + `name/pattern_type/prefix_pattern/delimiter/item/lot/pallet/json/preference` · `pattern_type` BUILTIN.DF → Lot/Pallet/Json · `'N/A'` = null · json `"structure":[…]` → `JSON.parse('{'+json+'}').structure` · FE ต้องอ่าน `BOOT.patterns` จาก SL ไม่ hardcode
- **กติกา pattern engine**: delimiter → fixed-length ยาวเป๊ะ → prefix ล้วนไว้ท้าย (prefix 1 ตัวชน item code จริง เช่น `1FMA0A,,,,2412…`) · คืน candidates หลายตัวให้เทียบ item+alias · `includePrefix:true` = ไม่ตัด prefix · length `"max"`/`"*"`/ว่าง = กินที่เหลือ · match prefix ยาวสุดก่อน · Pallet ไม่มี prefix/delimiter = catch-all ท้าย · delimiter: lot = field ไม่ว่างตัวสุดท้าย · fixed-width ช่องว่างนับตำแหน่ง ห้าม trim (ตัดแค่ `\r\n`) · fallback lot↔pallet สองทาง · serial เลขล้วนขึ้นต้นตรง prefix → item ผิด → ถ้าไม่ตรงบรรทัดไหนอ่านใหม่แบบเลขล้วน · prefix+includePrefix+max กิน `lot|item` ทั้งก้อน · fallback เช็คแค่ `alt.ok` กลบ error สำคัญเป็น NOT_FOUND → จัดลำดับ error
- Item alias `custitem_twms_item_barcode1..5` (เทียบ `itemid` ก่อน ไล่ 1..5 trim ไม่สนตัวพิมพ์)
- **Pallet** = bin ที่ `custrecord_twms_binpallet=2` (1=bin ปกติ) · `custrecord_twms_refbin` ชี้ zone bin — **ว่าง = pallet หายจาก available** (operand ใน `libStockOnHand.js`) · ย้ายใน location = re-point refbin · ข้าม location = สร้าง pallet-bin ชื่อเดิมที่ปลายทาง · เทียบชื่อไม่สนตัวพิมพ์ · ลำดับเดิน `custrecord_twms_binpick_sequence` (ว่างไปท้าย, ใน bin FIFO)
- **Location permission**: parent `customrecord_twms_irdoclot_sppo` (`custrecord_twms_userpermission`=emp, `_userpermission_sub`) · child `customrecord_twms_locationpermission` sublist `recmachcustrecord_twms_locpermis_parent` (`_location`, `_permislv` (กรองระดับ Create ให้ตรง `useProfile` FE), `_subsidiary`) · เมนู `custrecord_twms_up_*` (`_bin_trasnfer` สะกดผิดในระบบจริง) · ไม่มี record → เมนู "No data" · **ต้องกรอง isinactive**
- Job Center `customrecord_twms_hh_job`: `custrecord_twms_hhjob_client_req` (กุญแจ idempotency `TWMS_FT_<batchId>_<groupIdx>`) + `_result_tran` · body `custbody_twms_create_by_wms`, `custbody_twms_user_create` · lib `LIB/libHHJob.js`
- Inventory Number: `custitemnumber_lot_vendorcode1/2` · `custitemnumber_twms_count_lot_spacebar` (`"[2]"`,`"[2,3]"`,`["2"]`) — print label regex `/(\d+)/g` อ่าน `["2"]` ได้ แต่ libStockOnHand `/\[([\d,\s]+)\]/` อ่านไม่ได้ → ยึดฝั่งป้าย, ต้อง **rebuild ไม่ใช่ strip** (`expandLot(stored,cfg)` ผ่าน 419/419) · `twms-lot-spacebar` (บันทึกส่วนตัว)
- **TWMS Inventory Transfer**: header `customrecord_twms_inventorytransfer` (`custrecord_twms_ivs_*`) + line `customrecord_twms_palletandlotinfo` (sublist `recmachcustrecord_twms_pl_invtransfer`) · PL `custrecord_twms_pl_reflotid` = internal id ของ inventoryNumber (join `inventorynumber.id` ตรง ๆ) · PL vendor code `custrecord_melft_twms_pl_vendorcode1/2` · status `customlist_twms_invtransferstatus` Draft/Confirm/Completed/Cancel (1/2/3/…) · pending `ivs_status IN (1,2)` · gate `_transfercommit` = `IN (1,2,3) AND refinvtransfer IS NULL` ไม่มี isinactive
- **ITC ค้างกินเพดาน**: `customscript_twms_sl_list_item_onhand` + `subtract_to_commit:true` → cap ต่อ item+location = onhand − TO committed − ITC pending (ทุก lot) · ITC ที่ lot ว่างไม่เจอถ้ากรองด้วย lot → "<lot> not found" ทั้งที่ของมี · ไล่: Network payload → log `SL List Item Onhand perf`/`getStockOnHands perf` (`onhand_rows`,`to_commit_groups`,`itc_rows`,`commit_blockers`) สัญญาณ `to_commit_groups>0 && commit_blockers=0` → ITC กรอง item+location (ห้ามกรอง lot) · `twms-itc-cap-not-found` (บันทึกส่วนตัว)
- **Wave**: blob `customrecord_twms_wave_palltet_lot_data` ไม่มี writer → ตารางจริง `customrecord_twms_outboundtrack_detail` (SUM `custrecord_twms_wlottracking_qtystockuom` key `item|bin|lot|invenstatus`) · lot exclude status `[5,13]` · Pack/Ship ที่ wave status 9 · gate ต้อง `refifno IS NULL`
- Saved search gate: `_wavecommit`, `_transfercommit` (`customsearch_twms_ss_transfercommit`), `_packstockonhand` (onhand>0 + `inventorystatus.inventoryavailable='T'`) · lot/pallet on-hand SS `6773`
- **TWMS ไม่เคยสร้าง lot เอง** — lot ไม่มี = ยังไม่มี IR · อ่าน `custrecord_twms_j2p_process_status` คู่ `custrecord_twms_j2p_status`
- **Counting**: `customrecord_twms_inventorycountingplan` + line `customrecord_twms_countplandlt` → SL Inventory Counting Process → SL Gen Inventory Adjustment · ⚠️ สะกด 2 แบบ `custrecord_twms_countplandlt_item` แต่ `custrecord_twms_contingplandlt_lot` (lot จริงอยู่นี่ ไม่ใช่ `_contingplan_lottext`) · `libCountingUpdate.js` `applyContractV2()` draft→2 submit→3 · หัวแผน 5 = นับครบ · ยอดระบบ = SUM(curonhand)
- **SPA**: home `customscript_twms_homescreen` serve index.html + `DB_AssetURL` · style `TWMS APP/index.css` · envelope `{success,message,data}` (`libResponse`) field ต้องอยู่ใน `data` · pattern แกะที่ client ส่ง `parsed` · client ส่ง `locationIds`/`infoUserSend` เอง → server ตรวจซ้ำ
- RESTlet/SL ฝาแฝด drift ได้ (`API List Bin.js` คืน `{error}` ไม่ใช่ `message`) · feature ข้ามหลายจุดทำเป็น lib entry เดียว + fallback ที่ปิดแล้ว byte-identical
- config ที่ ops แก้ได้: ข้อห้ามจาก**พฤติกรรมระบบ**ห้ามมีปุ่มเปลี่ยน · ข้อห้ามจาก**นโยบาย ops** แก้ได้

## 14. Suitelet UI / client patterns
- **หน้าตารายงาน/ฟอร์ม Suitelet ใหม่ → เริ่มจาก Report CI เสมอ**: [`report-ci/`](../report-ci/) (`Lib_Report_UI.js` + `SL_Report_Template.js`), ธีม tremor | tabler | hybrid (ผู้ใช้เลือกแล้ว 08/10/2026) — ดู `report-ci-standard` (บันทึกส่วนตัว)

- **Router บน param `action`**: GET โหลด HTML จาก File Cabinet แล้ว inject `window.WMS_BOOTSTRAP`/`BOOT` (slUrl/emp/sub/patterns) · action อื่นคืน JSON · ไม่มี bootstrap = mock mode · client `api()` fetch + AbortController 120s + กันกดซ้ำ · submit แยกกลุ่มส่งตามลำดับพร้อม `batchId`+`groupIdx` (retry บางส่วนได้)
- **แทน native sublist ด้วย INLINEHTML**: render ตารางเอง เก็บ selection เป็น JSON ใน **hidden LONGTEXT `custpage_*`** (ตัวที่ถูก POST) · validate ใน `saveRecord` · detail JSON ใหญ่ chunk ลง child record
- **Custom async submit**: `saveRecord` เรียก `startSubmit()` แล้ว `return false` → fetch validate → server re-validate → idempotency uuid + lock record (IDLE/INQUEUE/INPROGRESS) → overlay ตอน navigate
- CS `setValue` ของ field sync/filter ใส่ `ignoreFieldChange:true` ไม่งั้น fieldChanged ยิงซ้ำ navigate 2 รอบ
- หน้าแรกช้าเพราะ SuiteQL หนัก → ย้ายไป AJAX handler (`?ajax=fltopts`) + N/cache 1h ให้หน้า render ก่อน
- `addSubmitButton` = POST (filter ไม่อยู่ใน URL) · อยาก bookmark ได้ → `addButton` + CS navigate GET (`url.resolveScript`) และ auto-POST เมื่อ URL > ~1800 ตัว
- **ชื่อ `custpage_*` อาจเป็น URL param ที่ Suitelet อื่นอ่าน** (`custpage_dicno` ถูกอ่าน 70+ ไฟล์) → grep ทั้ง codebase ก่อน rename
- ค้นเลขเอกสารหลายเลข: textarea · 1 ค่า = contains, >1 = exact → resolve tranid → id
- select2 `dropdownParent: body` หลุด CSS prefix ติด bullet ของ NS → `body > .select2-container .select2-results__option{list-style:none}`
- dropdown Currency "THB, THB, THB" (หลาย record symbol ซ้ำ) → dedupe id ต่อ ' — name' เฉพาะตัวซ้ำ
- status จาก SS เป็น camelCase (`pendingBillPartiallyReceived`) → map ให้ครบ + fallback camel→words
- popup Suitelet ใน iframe modal ใช้ `window.opener`/`close` ไม่ได้ → helper `_getParentWindow()`/`_closePopup()`
- chain งานด้วย URL param ใน browser (`autostartprocess=T&ids=5,6,7&idx=0`) ไม่ใช่ server-side → ปิดแท็บ/session หมด = งานที่เหลือไม่รัน ต้องมีปุ่ม Continue · page ข้อมูลด้วยตำแหน่ง array ไม่ใช่ idx เดิม
- **Excel export จาก HTML**: reuse `exportTableOuterHTMLToExcel()` (ใน `sl_convert_report_to_csv(CS)`) · sanitize ชื่อไฟล์/ชีต `[:\\/?*[]<>|"]` ชีต ≤31 ตัว · `mso-number-format` ให้เป็นตัวเลข · แถว `display:none` ไม่ถูก export → กางก่อน · ใส่ header/filter เป็นแถว colspan
- **มือถือ/เครื่องยิง**: `action=manifest` + `<link rel="manifest">` → Add to Home screen standalone · CipherLab 480x800 dpr ไม่แน่นอน → media query `(max-width:479px),(max-height:700px)` + `(max-width:360px)` · `body{height:100dvh;overflow:hidden}` + `.content` scroll · viewport `viewport-fit=cover, interactive-widget=resizes-content` · Fullscreen ต้องขอที่ touch แรก · `screen.orientation.lock()` เชื่อไม่ได้ → ตัดสินจาก `innerWidth>innerHeight && min≤560` หมุน UI ด้วย CSS (เช็คซ้ำ 0/60/180/400/800ms) · ทางสุดท้าย kiosk APK (Fully Kiosk)

## 15. Map/Reduce, task และ idempotency

- **MR หลาย deployment + `task.submit` ถูกเรียก 2 ครั้ง = สอง deployment รัน input เดียวกันขนาน → record ซ้ำ** (BP ซ้ำ ลูกค้า A 2026-09-08, create_task ห่าง 34 วิ) · fix: SL ตั้งธง `InQueue` บน log ก่อน submit · MR อ่าน log สดก่อนสร้าง + ตั้ง `InProgress` (commit 05b2802 repo Tha-Tum-District)
- **ห้าม `task.submit` จาก UE** — UE เขียนแค่ queue record ให้ MR (deployment เดียว, key = เอกสารต้นทาง) ทำ · state = Σ log (คำนวณซ้ำได้ผลเดิม) · `externalid` กันซ้ำ · มี sweep/reconciler เก็บเคสที่ UE พลาด/void

## 16. Advanced PDF / FreeMarker / BFO / Word-XML

- **find/replace บน template string ก่อน `renderAsString()`** → ค่าแทนเป็น FreeMarker ได้ · SS2.x ไม่มี `replaceAll` และ `${` พิเศษใน regex → `split().join()` · โหมดข้อความตาย: escape `& < >` ก่อน แล้ว `$`→`&#36;` · แถว mapping ที่ templatetext ซ้อนกัน ผลขึ้นกับลำดับ (`ORDER BY d.id`)
- ใน `<#list pdf.FORM as record>` ต้อง `${record.X}` · เติม `!""` ท้าย placeholder กันพัง
- **BFO: ย่อเฉพาะบล็อก ห้าม override class ที่ใช้ทั้งเอกสาร** (`.ST12` 64 จุด) → JS ส่งชิ้น css ต่อท้าย `style` ของ `<p>` (ว่างเมื่อไม่ย่อ) · `header-height` คงที่ เนื้อหาเกินล้นทับตาราง · พื้นที่ td = width − padding
- **นับความกว้างข้อความไทย**: ตัดสระบน/ล่าง/วรรณยุกต์ (`ั ิ-ฺ ็-๎`) ก่อนนับ · 12pt ในกรอบ 96mm ≈ TH 62 / ENG 69 ตัว/บรรทัด (ประมาณจาก PDF จริง) · `pfts-cashsales-autofont` (บันทึกส่วนตัว)
- **Word (.doc จาก `*_XML.xml`)**: Word แยกข้อความหลาย `<w:t>` → templatetext ต้องกิน XML ทั้งช่วงรวม `<w:r>`/`<w:rPr>` · token `{X}` ต้องลงทะเบียนใน `data` ของ `formatMapping` (คนละชุดกับ `recordObj` ของ PDF) ไม่งั้นได้ `undefined` · HTML entity (`&#8203;`) โผล่เป็นข้อความดิบ
- โคลนโฟลเดอร์สคริปต์ print form: `file.load()` relative path หาในโฟลเดอร์ตัวเอง → แก้ทุก const path/script id · Lib ใช้ path ร่วม อย่าก๊อป (fork drift) · โค้ด hardcode `deploymentId:'customdeploy1'` ต้องตั้งให้ตรง · `pfts-26-print-form-set` (บันทึกส่วนตัว)

## 17. SB vs PROD

- **Host sandbox `-sb1`** ดู §1
- **role/employee internal ID ของ SB กับ PROD ต่างชุดกัน** (สร้างแยกไม่ผ่าน SDF) เช่น RPT-AR SB 1330 vs PROD 1159 → ห้ามก๊อปไฟล์ทั้งไฟล์ข้าม env merge เฉพาะ logic คง ID ปลายทาง · ชื่อ role ต่าง convention โค้ดเทียบชื่อพังเงียบ ๆ · [[ลูกค้า B-sb-prod-divergence]]
- เทียบโค้ด: `python3 codecmp.py <SB> <PROD> --by-path --ignore-ws -o <out>` (ต้อง `--by-path`) · `summary.json` tag logic/script-id-url/field-id/debug-flag/comment/whitespace

## 18. SFTP (N/sftp) และ integration

- N/sftp ต่อได้แต่ host public (10.x ไม่ถึง) → NAT/public IP + whitelist · **ไม่รองรับ FTP** · host key จาก `ssh-keyscan` · `var myHostKey` ประกาศซ้ำตัวสุดท้ายชนะ
- password ใน **API Secret** (`custsecret_…` มีวันหมดอายุ) · "Allow for all domains" ชั่วคราวแล้วเปลี่ยนเป็น Restrict to Domains · ห้าม deploy ถ้า user/url/hostKey ปนคนละ server
- **NSPB Sync / EPM connector ดึงด้วย Saved Search** → ได้แค่ primary book · multi-book: SS ต่อเล่ม (filter Accounting Book) หรือ custom record staging ที่ MR สรุปจาก tal · `epm-fccs-netsuite-multibook` (บันทึกส่วนตัว)

## 19. ทดสอบนอก NS + screenshot ทำคู่มือ

- **Harness จำลอง NS บน node**: fake `N/query` (router ตาม SQL) + fake `N/record` จด create/submitFields/save แล้ว eval ไฟล์ด้วย `global.define` · เทส CONFIG ด้วย `loadAPI({patch})` · stub DOM + log/query/search, จำลอง fieldChanged ตาม `ignoreFieldChange` · `node --check` ทุกไฟล์
- ทดสอบการผูกปุ่มด้วย Chrome headless: mock page 2 ปุ่ม handler เขียน `#HIT` → `--dump-dom` เช็ค hash
- **screencapture หน้าต่าง Chrome**: `screencapture -x -o -l <windowId>` (id จาก swift `CGWindowListCopyWindowInfo`) · viewport เริ่ม `y = windowH − innerHeight` · scroll แล้วรอ ~900ms ก่อนวัด rect · crop ป้าย "Claude is active" (ล่างกลาง) · ⚠️ `-l` จับแท็บหน้าสุด → เช็ค title มี "NetSuite" ทุกรูป + เปิดดูทุกรูป
- Claude Code เด้งขึ้นหน้าทุกครั้งที่รัน Bash → activate+capture คำสั่งเดียว: `osascript -e 'tell application "Google Chrome" to activate'; sleep 2; screencapture -x -R x,y,w,h out.png`
- Chrome MCP `computer zoom` + `save_to_disk:true` แคปแท็บเราได้แม้อยู่เบื้องหลัง (2026-09-30; รุ่น 08-08 เคยไม่ได้ — ลองรูปแรกก่อน)
- Chrome profile หลักปิด `--remote-debugging-port` → agent-browser ต่อ Chrome ที่ login อยู่ไม่ได้ · ห้าม System Events keystroke · `set bounds` ต้อง `set zoomed to false` ก่อน · ก่อนทับ .docx เช็ค lock `~$…`
