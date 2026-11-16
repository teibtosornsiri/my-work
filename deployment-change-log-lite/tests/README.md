# tests — รัน SuiteScript นอก NetSuite

รันด้วย node เปล่า ๆ ไม่ต้องติดตั้งอะไร (ใช้ `define` ปลอม + `N/query` ปลอม)

```bash
cd deployment-change-log-lite/tests
node harness.js        # Lib + Suitelet: RECTYPE_MAP, ชื่อ record type, objectDetail, ajax=detail/render, CSV
node harness_pool.js   # REPORT_JS ฝั่ง browser: ดึงขนาน, retry, ปุ่มหยุด, render ครั้งเดียว
```

- `harness.js` ใช้ `fixture-config.js` เป็น Config (ค่าแบบบัญชีจริง: Script -417 · Deployment -418 · File MEDIAARTITEM null)
  อยากใช้ Config อื่น: `HARNESS_CONFIG=/path/to/TB_DLL_Config.js node harness.js`
- ข้อมูลตั้งต้นของ SQL อยู่ในตัวแปร `DB` ใน `harness.js` — fake `runSuiteQL` จับคำสั่งด้วย pattern แล้วคืนชุดข้อมูลนั้น
  เพิ่มเคสใหม่ = เพิ่มแถวใน `DB` + เพิ่ม `ok(...)` ท้ายไฟล์
- `harness_pool.js` แยก `<script>` ที่มี `function pump()` ออกจาก HTML ของหน้าแรก แล้วรันด้วย DOM/fetch ปลอม
  ตรวจว่าแต่ละวันถูกเรียกครั้งเดียว, concurrency ไม่เกินค่าที่ตั้ง, retry 3 ครั้งเมื่อพัง, กดหยุดแล้วยังสรุปผล

ทั้งสองไฟล์คืน exit code 1 เมื่อมี FAIL จึงใช้ใน CI ได้
