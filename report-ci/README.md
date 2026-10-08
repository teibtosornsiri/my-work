# Report CI

มาตรฐานหน้าตารายงานและฟอร์ม Suitelet สำหรับ NetSuite อ่านแล้วเริ่มรายงานใหม่ที่หน้าตาตรงกับงานเดิมได้ทันที

รายงานเดิมแต่ละตัวใช้สีของตัวเอง เช่น มีสีหลักอย่างน้อย 7 เฉด สีแดงติดลบ 5 เฉด และใช้หน่วยฟอนต์ทั้ง px และ pt ปนกัน ชุดนี้รวมทุกอย่างไว้ในไฟล์เดียว ถ้าจะเปลี่ยนสี แก้ที่ `Lib_Report_UI.js` ที่เดียว

## ธีม

ทั้ง 3 ธีมเลือกเมื่อ 2026-10-08

| id | ชื่อ | อ้างอิง | ลักษณะ |
|---|---|---|---|
| `tremor` | Tremor | [tremorlabs/tremor](https://github.com/tremorlabs/tremor-npm) | เน้นกราฟ · ฟอนต์ Prompt ตัวเดียวทั้งไทยและอังกฤษ · ค่าเริ่มต้น |
| `tabler` | Tabler | [tabler/tabler](https://github.com/tabler/tabler) | น้ำเงินกรม · การ์ดมีแถบสีด้านบน · หัวตารางตัวพิมพ์ใหญ่ |
| `hybrid` | Tabler × Tremor | ทั้งสองแบบ | สีหลักเขียวน้ำทะเล `#0e7490` · การ์ดแบบ Tremor |

ดูหน้าตัวอย่างได้ที่ [`preview/index.html`](preview/index.html) (ดาวน์โหลดแล้วเปิดในเบราว์เซอร์) มีทั้งหน้ารายงานและหน้าฟอร์ม

## ไฟล์

| ไฟล์ | บทบาท |
|---|---|
| `Lib_Report_UI.js` | AMD module (SuiteScript 2.1) เก็บค่าสีของ 3 ธีมและฟังก์ชันสร้าง HTML ทุกชิ้นส่วน CSS ทั้งหมดอยู่ใต้ `.rui[data-skin=…]` จึงไม่ชนกับ CSS ของ NetSuite |
| `SL_Report_Template.js` | Suitelet ตั้งต้น ตัวอย่างเป็นรายงาน AP Aging แสดงผลผ่าน `INLINEHTML` ใต้เมนูปกติของ NetSuite มีปุ่ม Export CSV |
| `preview/index.html` | หน้าตัวอย่าง 3 ธีมที่เลือก |
| `preview/round1-options.html` | ตัวเลือกรอบแรก 5 แบบ เก็บไว้ดูเป็นประวัติ |

## วิธีใช้

1. อัปโหลด `Lib_Report_UI.js` และ `SL_Report_Template.js` ไว้ในโฟลเดอร์เดียวกันใน File Cabinet
2. ก๊อป `SL_Report_Template.js` เป็นรายงานใหม่ แล้วแก้ 3 จุดที่มีป้าย `[แก้ตรงนี้]`
   - `readFilters` ตัวกรอง
   - `fetchRows` SuiteQL
   - `buildPage` หน้าตา
3. สร้าง Script record และ Deployment ตามปกติ
4. ถ้าอยากลองธีมอื่น ให้ต่อ `&theme=tabler` หรือ `&theme=hybrid` ท้าย URL ส่วน `&density=compact` ทำให้ตารางแน่นขึ้น

ตัวอย่างการเรียกใช้ library:

```js
const ui = UI.create({ theme: 'tremor' });
field.defaultValue = ui.render([
    ui.header({ crumb: 'Payables', crumbCurrent: 'AP Aging', title: 'อายุเจ้าหนี้', meta: 'ทุกบริษัท' }),
    ui.kpis([{ label: 'ยอดคงค้าง', value: '1.46', unit: 'ลบ.', spark: [1.2, 1.3, 1.46] }]),
    ui.card({ title: 'รายละเอียด', flush: true, body: ui.table({ columns, rows, groupBy: 'sub', subtotal: true, total: true }) })
]);
```

รายชื่อฟังก์ชันทั้งหมดและ parameter อยู่ใน comment หัวฟังก์ชันใน `Lib_Report_UI.js`:
- **หน้ารายงาน:** `header`, `filterBar`, `field`, `kpis`, `distribution`, `barList`, `tabs`, `table`, `badge`, `empty`, `alert`
- **หน้าฟอร์ม:** `formSection`, `toggle`, `radioCards`, `steps`, `actionBar`, `summary`

## ข้อจำกัดที่ยังไม่ได้ทดสอบ

ชุดนี้ทดสอบแค่นอก NetSuite ด้วยการ render ใน Node แล้วเปิดในเบราว์เซอร์ ก่อนใช้งานจริงต้องเช็กใน SB1:

- **ฟอนต์:** โหลดจาก Google Fonts ถ้า Suitelet โหลดไม่ได้ จะแสดงเป็นฟอนต์ระบบแทน
- **CSS ของ NetSuite:** ต้องดูว่ามีส่วนไหนถูกทับหรือเปล่า
- **SuiteQL ใน template:** ใช้ `foreignamountunpaid` ซึ่งเป็นยอดตามสกุลเงินของเอกสาร ยังไม่แปลงเป็น base currency
- **ไม่ใส่เมนูซ้ายใน NetSuite:** หน้าตัวอย่างมีเมนูซ้ายไว้ให้เห็นภาพรวมเท่านั้น ใน NetSuite ใช้เมนูของระบบ
- **ข้อมูลในตัวอย่าง:** ชื่อบริษัท ผู้ขาย และตัวเลขในหน้าตัวอย่างเป็นข้อมูลสมมติ

---

พบจุดที่เอกสารไม่ตรงกับโค้ด แก้ทั้งโค้ดและ README นี้ใน commit เดียวกัน
