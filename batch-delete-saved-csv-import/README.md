# Batch Delete Saved CSV Import

Suitelet สำหรับลบ Saved CSV Import Template ทีละหลายตัว สำหรับคนดูแล account ที่มี template ค้างเยอะจาก go-live หรือ rollout ถ้าลบผ่านหน้า NetSuite ปกติ ต้องกดลบทีละตัว

| ไฟล์ | ประเภท |
|---|---|
| `SL_Batch_Delete_Saved_Import.js` | Suitelet (SuiteScript 2.1) หน้าจอเดียว ไม่มี Map/Reduce |

## วิธีทำงาน

ทุกขั้นตอนทำงานในเบราว์เซอร์ด้วยสิทธิ์ของคนที่เปิดหน้า ฝั่ง server แค่ส่งหน้าจอให้

1. ดึงหน้า `savedimports.nl` ทุกหน้า แล้วอ่านตารางเอา ID · Name · Type · Owner · Created
2. แสดงตารางพร้อมตัวกรอง: Owner · Record Type · ชื่อ template
3. ผู้ใช้ติ๊กเลือก แล้วกด "ลบที่เลือก" จะมีหน้าต่างยืนยันก่อนลบ
4. ลบทีละตัวผ่าน `savedimports.nl?method=delete&recid=<id>` เว้น 0.5 วินาทีต่อตัว แถวที่ลบแล้วจะขีดฆ่า และมี log บอกผลทีละตัว

template ที่ไม่มีลิงก์ Delete ในหน้า NetSuite (เช่น มาจาก bundle หรือไม่มีสิทธิ์) จะติ๊กเลือกไม่ได้

## ติดตั้ง

1. อัปโหลด `SL_Batch_Delete_Saved_Import.js` ไปที่ File Cabinet
2. สร้าง Script record แบบ Suitelet แล้วสร้าง Deployment
3. ให้สิทธิ์เฉพาะ role ที่ลบ Saved CSV Import ได้อยู่แล้ว (Administrator หรือ role ที่มีสิทธิ์ Import CSV File แบบ Full)

## ข้อควรระวัง

- **ลบแล้วกู้คืนไม่ได้:** ก่อนลบให้ export รายชื่อ template หรือจด Script ID ของตัวที่จะลบไว้ก่อน
- **อ่านจากหน้า HTML:** ถ้า NetSuite เปลี่ยนลำดับคอลัมน์ในหน้า `savedimports.nl` การอ่าน ID จะเพี้ยน ลำดับที่ใช้อยู่เขียนไว้ใน comment หัวไฟล์ ก่อนลบจำนวนมาก ให้ลองลบ 1–2 ตัวก่อนแล้วเช็กในหน้า NetSuite
- **ปิดหน้าระหว่างลบ:** ถ้าปิดหน้าก่อนลบเสร็จ ตัวที่ยังไม่ถึงคิวจะไม่ถูกลบ เปิดหน้าใหม่แล้วเลือกที่เหลือได้

---

NetSuite เปลี่ยนหน้า `savedimports.nl` จนสคริปต์อ่านผิด ให้แก้ลำดับคอลัมน์ทั้งใน comment หัวไฟล์และในโค้ด แล้วแก้ README นี้ใน commit เดียวกัน
