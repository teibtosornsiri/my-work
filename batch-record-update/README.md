# Batch Record Update

Suitelet สำหรับแก้ค่า field ของ record ทีละหลายใบ ทั้ง field หัวเอกสารและ field ระดับบรรทัด รวมถึง Inventory Detail สำหรับคนที่ต้องแก้ข้อมูลยกชุด แต่ CSV Import ปกติของ NetSuite ทำไม่ได้หรือทำยาก

| ไฟล์ | ประเภท |
|---|---|
| `SL_IR_Transfer_Update.js` | Suitelet (SuiteScript 2.1) ในหัวไฟล์ชื่อ "Generic Batch Record Update v2.1" ชื่อไฟล์ยังคงตามที่ deploy อยู่ เพราะเวอร์ชันแรกทำไว้แก้ Item Receipt ของ Transfer Order |

## สองโหมด

| โหมด | ขั้นตอน |
|---|---|
| **CSV** | อัปโหลด CSV → ลากคอลัมน์ไปจับคู่กับ field id (หัวเอกสาร / บรรทัด) → ระบุคอลัมน์ internal id ของ record และคอลัมน์ที่ใช้หาบรรทัด → กดรัน |
| **Query** | เขียน SuiteQL เองหรือใช้ Visual Builder → ติ๊กเลือก record จากผล → กรอกค่าที่จะ set → กดรัน |

ทั้งสองโหมดส่งไปที่ปุ่มรันชุดเดียวกัน ซึ่งเรียก `?action=update` ทีละ record พร้อมกันได้ 1–10 request (ค่าเริ่มต้น 5) และมี log บอกผลทีละใบ

record ที่เลือกได้: Item Receipt · Item Fulfillment · Transfer Order · Sales Order · Purchase Order · Vendor Bill · Invoice · Inventory Adjustment · Journal Entry ถ้าต้องการชนิดอื่น ให้เพิ่มใน `RECORD_TYPES` หัวไฟล์ ส่วน sublist ค่าเริ่มต้นคือ `item` เปลี่ยนได้ที่หน้าจอ

## ติดตั้ง

1. แก้ `FILE_FOLDER` หัวไฟล์ให้เป็น folder id ใน File Cabinet ของ account ที่จะใช้ (ใช้เก็บ CSV ที่อัปโหลด) ค่าในไฟล์ตอนนี้เป็น folder ของ account ที่พัฒนา
2. อัปโหลดไฟล์ไปที่ File Cabinet แล้วสร้าง Script record แบบ Suitelet และ Deployment
3. ให้สิทธิ์เฉพาะคนที่แก้ record ชนิดนั้นได้อยู่แล้ว เพราะสคริปต์ save ด้วยสิทธิ์ของ deployment

## พฤติกรรมที่ต้องรู้ก่อนรัน

- **ข้าม field บังคับและไม่ดึงค่าอัตโนมัติ:** save ด้วย `ignoreMandatoryFields: true` และ `enableSourcing: false` ค่าที่ปกติ NetSuite เติมให้เองจะไม่ถูกเติม และ field บังคับที่ว่างอยู่จะไม่เตือน
- **ไม่ระบุคอลัมน์หาบรรทัด = แก้ทุกบรรทัด:** ถ้าไม่ได้ระบุคอลัมน์ที่ใช้หาบรรทัด (line id) ค่าระดับบรรทัดจะถูก set ให้ทุกบรรทัดของ sublist
- **ค่าว่างถูกข้าม:** ใช้เครื่องมือนี้ล้างค่า field ให้ว่างไม่ได้
- **ค่าที่หน้าตาเป็นตัวเลขถูกแปลงเป็น number:** รหัสที่ขึ้นต้นด้วย 0 เช่น `00123` จะกลายเป็น `123` ถ้า field เป็นข้อความ ให้ตรวจผลหลังรันทุกครั้ง
- **Inventory Detail ถูกลบแล้วใส่ใหม่ทั้งหมด:** บรรทัด assignment เดิมถูกลบก่อนใส่ชุดใหม่ ถ้าใส่ไม่สำเร็จ error จะเข้าแค่ log ระดับ debug แต่ record ยังถูก save และหน้าจอขึ้นว่าสำเร็จ ให้เช็ก Inventory Detail ของใบที่แก้เอง

ก่อนรันจริง ให้ลองกับ 1–2 record ใน Sandbox แล้วเปิด record ดูค่าที่เปลี่ยนก่อน

---

แก้พฤติกรรมในโค้ดเมื่อไหร่ ให้แก้หัวข้อ "พฤติกรรมที่ต้องรู้ก่อนรัน" ใน commit เดียวกัน
