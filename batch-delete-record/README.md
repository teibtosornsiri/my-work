# Batch Delete Record (SL V2 + MR)

เอกสารนี้สำหรับคนที่จะติดตั้งและใช้ชุดลบ record ยกชุดจาก Saved Search อ่านแล้วตั้ง script/deploy ได้ถูก ID และเลือกโหมดลบได้ถูกงาน

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `SL_Batch_Delete_Record_V2.js` | Suitelet | หน้าจอกรอก Saved Search · ลบแบบ AJAX · สั่งรัน MR และติดตามสถานะ |
| `MR_Batch_Delete_Record.js` | Map/Reduce | อ่านไฟล์ JSON รายการ record แล้วลบทีละตัวใน `map` · เขียนไฟล์ผลลัพธ์ใน `summarize` |

---

## ID ที่ต้องใช้ตอนติดตั้ง

ID ทั้งหมดต้องตรงกับค่าคงที่ใน `SL_Batch_Delete_Record_V2.js` บรรทัด 48–56 ไม่ใช่ตามคอมเมนต์หัวไฟล์ MR (หัวไฟล์ MR เขียนว่า `customscript_mr_batch_delete` ซึ่ง **ผิด** ห้ามใช้)

### Suitelet

| ช่อง | ค่า |
|---|---|
| Script File | `SL_Batch_Delete_Record_V2.js` |
| Script ID | `customscript_sl_batch_delete_v2` |
| Deploy ID | `customdeploy_sl_batch_delete_v2` |
| Status | Released |
| Available Without Login | ไม่ติ๊ก |
| Audience | เฉพาะ role ที่มีสิทธิ์ลบ record ประเภทที่จะลบ |

### Map/Reduce

| ช่อง | ค่า |
|---|---|
| Script File | `MR_Batch_Delete_Record.js` |
| Script ID | `customscript_mr_batch_delete_transaction` |
| Script Parameter | ID `custscript_bd_mr_file_id` · Type Integer Number · ไม่ต้องใส่ค่า default |

Deployment ต้องสร้าง **ครบ 5 ตัว** Suitelet จะลองใช้ตามลำดับ ถ้าตัวแรกกำลังรันอยู่จะข้ามไปตัวถัดไป ทำให้สั่งลบพร้อมกันได้สูงสุด 5 งาน

| ลำดับ | Deploy ID | Status |
|---|---|---|
| 1 | `customdeploy_mr_batch_delete_transaction` | Not Scheduled |
| 2 | `customdeploy_mr_batch_delete_trans_2` | Not Scheduled |
| 3 | `customdeploy_mr_batch_delete_trans_3` | Not Scheduled |
| 4 | `customdeploy_mr_batch_delete_trans_4` | Not Scheduled |
| 5 | `customdeploy_mr_batch_delete_trans_5` | Not Scheduled |

ตอนกรอกในหน้า NetSuite ให้พิมพ์เฉพาะส่วนหลัง prefix เช่น `_mr_batch_delete_transaction` และ `_mr_batch_delete_trans_2` เพราะ NetSuite เติม `customscript` / `customdeploy` ให้เอง ถ้าพิมพ์เต็มจะได้ ID ซ้ำ prefix สองชั้น

### Folder ใน File Cabinet

Suitelet เซฟไฟล์ input ลง folder internal ID `482` (`MR_FILE_FOLDER` บรรทัด 56) และ MR เขียนไฟล์ผลลง folder เดียวกัน

- ก่อน deploy ข้าม account (SB ↔ PROD) ต้องเช็กว่า folder `482` มีอยู่จริงและเป็น folder ที่ตั้งใจ ถ้าไม่ใช่ ให้แก้ค่าคงที่ก่อนอัปโหลด
- role ที่รัน Suitelet ต้องมีสิทธิ์สร้างไฟล์ใน folder นี้

## วิธีใช้

1. เตรียม Saved Search ที่ผลลัพธ์เป็น record ที่ต้องการลบ แนะนำใส่ column `tranid` หรือ `name` และ `trandate` เพื่อให้หน้าจอแสดงเลขเอกสาร
2. ตั้ง Saved Search เป็น Public หรือให้ audience ครอบคลุม role ที่ใช้งาน
3. เปิด Suitelet `customdeploy_sl_batch_delete_v2`
4. กรอก **Saved Search ID แบบข้อความ** เช่น `customsearch_po_to_delete` ใส่เป็นตัวเลข internal ID ไม่ได้ ระบบจะเตือนและไม่โหลด
5. เลือก Delete Mode แล้วกด **Load Search →**

### โหมด AJAX

ลบจาก browser โดยตรง เห็นผลทีละแถวทันที

- โหลดได้สูงสุด 5,000 record ต่อครั้ง
- ปรับจำนวนลบพร้อมกันด้วย slider (5–50 ค่าเริ่มต้น 20)
- เลือก/ยกเลิกเลือกได้รายแถว กรองตามสถานะ และ Export Errors CSV
- error ถูกจัดกลุ่มเป็น `PERMISSION` · `DEPENDENCY` · `LOCKED` · `NOT_FOUND` · `GOVERNANCE` · `OTHER`
- **ต้องเปิดหน้าจอค้างไว้จนจบ** ปิด tab หรือเน็ตหลุดการลบจะหยุด (กลับมาโหลดใหม่แล้วลบต่อได้ เพราะตัวที่ลบแล้วจะไม่อยู่ในผล search)

### โหมด Map/Reduce

ลบเบื้องหลัง ปิดหน้าจอได้

1. หน้ายืนยันแสดงรายการ เลือก record แล้วกด **Start Map/Reduce Delete**
2. Suitelet เซฟรายการเป็น `batch_delete_<timestamp>.json` ลง folder `482` แล้วสั่งรัน MR พร้อมส่ง file ID ผ่าน `custscript_bd_mr_file_id`
3. หน้าจอ poll สถานะทุก 3 วินาที (stage · % · status)
4. MR จบแล้วเขียน `batch_delete_result_<fileId>.json` หน้าจอจะดึงมาแสดงจำนวนสำเร็จ/ล้มเหลว และ Export Errors CSV ได้
5. ถ้าปิดหน้าจอไปก่อน ดูผลได้จากไฟล์ result ใน folder `482` หรือ Execution Log ของ deployment ที่ใช้ (log `summarize`)

| | AJAX | Map/Reduce |
|---|---|---|
| จำนวนสูงสุดต่อรอบ | 5,000 | 1,000 (ดูข้อสังเกตด้านล่าง) |
| ต้องเปิดหน้าจอค้าง | ใช่ | ไม่ต้อง |
| ใช้ governance ของ | Suitelet (ต่อ request) | MR |
| ไฟล์ค้างใน File Cabinet | ไม่มี | input + result รอบละ 2 ไฟล์ |

## ข้อสังเกตและกับดัก

- **โหมด MR โหลดได้แค่ 1,000 record** (`maxResults = 1000` บรรทัด 151) ทั้งที่ dropdown เขียนว่า "เหมาะกับข้อมูลเยอะ 5,000+" ถ้ามีมากกว่านั้นต้องรันหลายรอบ
- **ถ้า Script ID / Deploy ID ไม่ตรง** `task.create` จะ error ทุกตัว แล้ว Suitelet ขึ้นข้อความ "Deploy ทั้ง 5 ตัวกำลังรันอยู่" ซึ่งชวนเข้าใจผิด เจอข้อความนี้ทั้งที่ไม่มีงานรันอยู่ ให้เช็ก ID ก่อน (ดู log `handleMRStart` ระดับ Debug จะเห็นข้อความ error จริงของแต่ละ deploy)
- deployment ห้ามตั้งเป็น Scheduled เพราะจะรันเองโดยไม่มี file ID parameter (`getInputData` จะ log error แล้วจบเปล่า)
- ไฟล์ input/result ไม่ถูกลบอัตโนมัติ ควรเคลียร์ folder `482` เป็นระยะ
- MR ลบ record ด้วยสิทธิ์ของ owner/role ของ deployment ไม่ใช่ role ของคนกดในหน้า Suitelet
- การลบเป็นการลบถาวร ทดสอบใน Sandbox และตรวจผล Saved Search ก่อนรันใน Production ทุกครั้ง

---

เมื่อแก้ค่าคงที่ใน `SL_Batch_Delete_Record_V2.js` (Script ID · Deploy ID · folder) ให้แก้ตารางในเอกสารนี้ในรอบเดียวกัน และควรแก้คอมเมนต์หัวไฟล์ `MR_Batch_Delete_Record.js` ให้ตรงกับ `customscript_mr_batch_delete_transaction`
