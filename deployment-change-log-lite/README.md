# Deployment Change Log (Lite)

เวอร์ชันย่อของ [`deployment-change-log/`](../deployment-change-log/): **ไม่มี custom record หรือ custom list** มีแค่รายงานการเปลี่ยนแปลงใน PROD จาก System Notes ส่วน CR และการอนุมัติเก็บนอก NetSuite (Jira, Excel หรืออีเมล) แล้วกระทบยอดใน Excel ที่ export จากรายงาน

สถานะ: เขียนเสร็จ ผ่าน `node --check` และ unit test ของ `summarize()` / `toCsv()` **ยังไม่ได้รันใน NetSuite จริง**

## เทียบกับเวอร์ชันเต็ม

| | Lite | เต็ม |
| --- | --- | --- |
| Custom record / list | ไม่มี | 4 record + 6 list |
| Script record | 1–2 ตัว | 5 ตัว |
| บังคับอนุมัติก่อน deploy ในระบบ | ไม่มี (ตรวจย้อนหลังอย่างเดียว) | มี (ปุ่ม + SoD + stamp เวลา) |
| จับคู่กับ CR | คนกรอกเลข CR ใน Excel | อัตโนมัติ (E1–E6) |
| ติดธงผู้แก้ไม่มีสิทธิ์ deploy | มี | มี (E3) |
| ตรวจ SHA-1 ไฟล์ | ไม่มี | มี (E4) |
| อธิบาย exception + sign-off | ใน Excel ที่เซ็นแล้ว | ในระบบ |

## ไฟล์

| ไฟล์ | ประเภท | Script ID | Deployment ID |
| --- | --- | --- | --- |
| `TB_DLL_Config.js` | Module (ค่าตั้งต่อบัญชี) | — | — |
| `TB_DLL_Lib.js` | Module | — | — |
| `Lib_Report_UI.js` | Module จาก [`../report-ci/`](../report-ci/) | — | — |
| `TB_DLL_SL_Report.js` | Suitelet | `customscript_tbdll_sl_report` | `customdeploy_tbdll_sl_report` |
| `TB_DLL_SS_MonthlySnapshot.js` | Scheduled (ไม่ใส่ก็ได้) | `customscript_tbdll_ss_snapshot` | `customdeploy_tbdll_ss_snapshot` |

ใช้ prefix `tbdll` ต่างจากเวอร์ชันเต็ม (`tbdl`) จึงลงคู่กันในบัญชีเดียวได้

## ขั้นติดตั้ง

1. อัป 5 ไฟล์ไว้โฟลเดอร์เดียว เช่น `SuiteScripts/TB_DeployLogLite/`
2. สร้าง Script record + Deployment
    - **Suitelet:** Status Released · Log Level: Audit · Audience: IT, ผู้ review · ใส่ลิงก์ในเมนู · Execute as Role: Administrator (ต้องอ่าน `systemnote` และรายชื่อ role ได้)
    - **Scheduled:** Log Level: Audit · Monthly วันที่ 1 เวลา 02:00 · parameter `custscript_tbdll_ss_period` (Free-Form Text, ไม่บังคับ ใช้ทดสอบเดือนอื่นด้วยค่า `YYYY-MM`)
    - Script ID และ Deployment ID ของ Suitelet ต้องตรงกับ `SL_REPORT` ใน Config (ใช้ทำลิงก์ในอีเมล)
3. ตั้ง `TB_DLL_Config.js`: `DEPLOYER_ROLE_IDS` / `DEPLOYER_EMPLOYEE_IDS`, `FILE_SCOPE` (`suitescripts` ค่าเริ่มต้น = เฉพาะไฟล์ใต้ SuiteScripts · `scriptfile` = เฉพาะ Script File ของ Script record · `all`) และถ้าใช้ Scheduled: `REVIEWER_EMPLOYEE_IDS`, `EMAIL_AUTHOR_ID`, `SNAPSHOT_FOLDER_ID`
    - อยากดูแค่ script กับไฟล์ของ script: map ใน `RECTYPE_MAP` แค่ Script, Script Deployment, File แล้วปล่อยที่เหลือเป็น `null`
    - `LOAD_CONCURRENCY` (ค่าเริ่มต้น 3) = จำนวนวันที่ browser ดึงพร้อมกัน · `1` = ทีละวัน (เบาที่สุด ช้าที่สุด)
    - `RECORD_TYPE_NAMES` = ตั้งชื่อ record type เองเมื่อระบบแปลงไม่ได้ (ดูชื่อจริงจากช่อง APPLIES TO ของ deployment) — record ของ SuiteApp มักไม่อยู่ในตาราง `customrecordtype`
4. **หา `recordtypeid` ด้วย Probe** (เปิด Suitelet ต่อท้าย `&view=probe`)
    - **File:** กด "ตรวจหา File อัตโนมัติ" ระบบดูไฟล์ใต้ SuiteScripts ที่แก้ล่าสุด 5 ไฟล์ แล้วบอกค่าที่แนะนำ
    - **ประเภทอื่น:** แก้ object นั้นด้วย user ตัวเอง (เช่น แก้ description ของ script) → เลือกวันนั้น + ใส่ Internal ID ของ object (เร็วสุด) → กด "เริ่มสแกน" → แถวที่ recordid ตรง = ค่าของประเภทนั้น
    - สแกนทีละวัน มีแถบความคืบหน้า (วันที่กำลังสแกน, record type ที่พบ, จำนวนแถว, เวลาที่ใช้) และปุ่มหยุด วันที่ error จะลองใหม่ 1 ครั้งแล้วข้าม · ค่าเริ่มต้น 7 วันล่าสุด สูงสุด 92 วัน
    - ใส่ค่าที่ได้ลง `RECTYPE_MAP` · ประเภทที่ไม่โผล่ = SuiteQL มองไม่เห็น ต้องใช้ Saved Search บน record นั้นเสริม
5. ทดสอบ: แก้ไฟล์ด้วย user ที่ไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy → รายงานต้องติดธง

## Process รายเดือน

1. วันที่ 1: Scheduled ส่งอีเมลพร้อม CSV ของเดือนก่อน (หรือกด Export CSV เอง)
2. ภายในวันที่ 5: ทีม NetSuite กรอก `CR No.` ทุกแถว แถวที่ไม่มี CR หรือติดธงให้เขียน `คำอธิบาย`
3. ภายในวันที่ 10: ผู้ review ตรวจแท็บ "ผู้ถือสิทธิ์สูง" และไฟล์ที่กรอกแล้ว เซ็นชื่อ/วันที่ เก็บไฟล์เป็น evidence

## การทำงานของรายงาน

1. เปิดหน้าครั้งแรก → วาดเปลือก (header, ตัวกรองวันที่, แถบความคืบหน้า) แล้ว browser ดึงทีละวันผ่าน `&ajax=day` **พร้อมกัน `LOAD_CONCURRENCY` วัน** (ค่าเริ่มต้น 3) · retry 2 ครั้ง · กดหยุดแล้วรอคำขอที่ค้างให้จบก่อนสรุปเท่าที่ได้
2. ดึงครบ → POST `&ajax=render` → server วาด KPI / ไดอะแกรมตาม script / ตาราง แล้วคืน CSV สองชุด
3. ไดอะแกรมตาม Script: node ของแต่ละ object มีปุ่ม **"ดูค่าเดิม → ใหม่"** → `&ajax=detail&type=…&id=…` query เฉพาะ object นั้น (เร็ว) แล้วแสดงในกล่องซ้อน
4. ป้าย "deploy บน" แปลง record type เป็นชื่อที่อ่านรู้เรื่อง (`JOURNALENTRY` → Journal Entry · `CUSTOMRECORD_X` → ชื่อจาก `customrecordtype` · ไม่รู้จัก → แปลง `_` เป็นช่องว่าง)

## ข้อจำกัด

- ยังไม่ยืนยันว่ามีตาราง `systemnote` ใน SuiteQL ของทุกบัญชี และเห็น object ตั้งค่าครบทุกประเภท ต้องผ่านขั้นที่ 4 ก่อน
- ไม่มีหลักฐานการอนุมัติในระบบ ผู้สอบบัญชีจะดูจาก log CR ภายนอกประกอบ
- Query หลักรวมการ save เป็นรายการเดียวเพื่อความเร็ว จึงไม่มีคอลัมน์ค่าเดิม → ใหม่ในตารางรวม — กดปุ่ม "ดูค่าเดิม → ใหม่" ที่ node ของ object นั้นแทน (จำกัด 800 แถวแรกต่อ object ต่อครั้ง)

## ดู log

```sql
SELECT title, detail, TO_CHAR(date,'YYYY-MM-DD HH24:MI:SS') AS tm FROM scriptnote WHERE title LIKE 'TBDLL %' ORDER BY internalid DESC FETCH FIRST 30 ROWS ONLY
```
