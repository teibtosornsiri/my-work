# NS Deployment Change Log — คู่มือติดตั้ง

ชุดสคริปต์ตาม spec "NetSuite Deployment Change Log & Reconciliation" สำหรับตอบผู้สอบบัญชีเรื่อง ITGC Change Management
ทุกการเปลี่ยนแปลงใน PROD ต้องมี CR ที่อนุมัติแล้ว และรายงานกระทบยอดรายเดือนจับการเปลี่ยนแปลงที่ไม่มี CR ได้

สถานะ: เขียนเสร็จ ผ่าน `node --check` และ unit test ของ logic จับคู่ (E1–E6) **ยังไม่ได้รันใน NetSuite จริง**

## ไฟล์

| ไฟล์ | ประเภท | หน้าที่ |
| --- | --- | --- |
| `TB_DL_Config.js` | Module | ค่าตั้งต่อบัญชี แก้ไฟล์นี้ไฟล์เดียว |
| `TB_DL_Lib.js` | Module | ชื่อ field, ดึง System Notes / Change Log, SHA-1, `reconcile()` |
| `TB_DL_UE_ChangeLog.js` | User Event บน `customrecord_tb_deploy_log` | ปุ่มเปลี่ยนสถานะ · ห้ามลบ · ล็อก field |
| `TB_DL_UE_Object.js` | User Event บน `customrecord_tb_deploy_obj` | ล็อก object ตามสถานะ CR · หา PROD Internal ID เอง · ตรวจรูปแบบ SHA-1 |
| `TB_DL_CS_ChangeLog.js` | Client (แนบจาก UE) | ปุ่ม → ยืนยัน/ถามเหตุผล → เรียก Suitelet |
| `TB_DL_SL_Action.js` | Suitelet | เปลี่ยนสถานะ + ตรวจ Segregation of Duties + stamp ผู้ทำ/เวลา + History |
| `TB_DL_SL_Recon.js` | Suitelet | รายงานกระทบยอด, Probe, อธิบาย Exception, Sign-off, Export CSV |
| `TB_DL_SS_MonthlySnapshot.js` | Scheduled | วันที่ 1: snapshot CSV + Sign-off record (Pending) + อีเมลผู้ review |
| `SETUP_Records.md` | — | custom record / list / field ที่ต้องสร้าง |

ต้องใช้ `Lib_Report_UI.js` (Report CI จาก [`../report-ci/`](../report-ci/)) อยู่โฟลเดอร์เดียวกับ `TB_DL_SL_Recon.js` ถ้าบัญชีมี lib นี้อยู่แล้วที่อื่น ให้แก้ path ใน `define` ของ Suitelet แทนการก๊อปซ้ำ

## ขั้นติดตั้ง (ทำใน SB ก่อน)

1. **สร้าง custom list และ record** ตาม `SETUP_Records.md` (Script ID และชื่อค่าใน list ต้องตรงตัว)
2. **อัปไฟล์** ทั้งหมดไว้โฟลเดอร์เดียว เช่น `SuiteScripts/TB_DeployLog/` (รวม `Lib_Report_UI.js`)
3. **สร้าง Script record + Deployment**

    | Script | Script ID | Deployment ID | ตั้งค่า |
    | --- | --- | --- | --- |
    | UE ChangeLog | `customscript_tbdl_ue_log` | `customdeploy_tbdl_ue_log` | Applies to: Deployment Change Log · Status: Released · Execute as Role: Administrator |
    | UE Object | `customscript_tbdl_ue_obj` | `customdeploy_tbdl_ue_obj` | Applies to: Affected Object · Released |
    | SL Action | `customscript_tbdl_sl_action` | `customdeploy_tbdl_sl_action` | Released · Execute as Role: Administrator · Audience: ทุก role ที่ใช้ Change Log |
    | SL Recon | `customscript_tbdl_sl_recon` | `customdeploy_tbdl_sl_recon` | Released · Audience: IT, ผู้ review, Deployer · ใส่ลิงก์ในเมนู |
    | SS Snapshot | `customscript_tbdl_ss_snapshot` | `customdeploy_tbdl_ss_snapshot` | Schedule: Monthly วันที่ 1 เวลา 02:00 · parameter `custscript_tbdl_ss_period` (Free-Form Text, ไม่บังคับ) |

    Script ID ของ 2 Suitelet ต้องตรงกับ `SL_ACTION` / `SL_RECON` ใน `TB_DL_Config.js` ไม่งั้นปุ่มและลิงก์ในอีเมลจะเปิดไม่ได้
    `Execute as Role = Administrator` บน UE จำเป็น เพราะ UE อ่าน custom list และ System Notes ด้วย SuiteQL

4. **ตั้ง `TB_DL_Config.js`** ของบัญชีนั้น
    - `DEPLOYER_ROLE_IDS` / `DEPLOYER_EMPLOYEE_IDS` — ใครกด Mark Deployed ได้
    - `REVIEWER_EMPLOYEE_IDS` — ใคร sign-off ได้ และได้อีเมลรายเดือน
    - `EMAIL_AUTHOR_ID`, `SNAPSHOT_FOLDER_ID`
    - `RECTYPE_MAP` — ทำในข้อ 5

5. **หา `recordtypeid` ด้วยโหมด Probe** (สำคัญที่สุด ยังไม่รู้ค่าจริงของบัญชี)
    1. แก้ object ที่รู้จักทีละประเภท เช่น อัปไฟล์ทับ 1 ไฟล์, แก้ description ของ script 1 ตัว, แก้ label ของ custom field 1 ตัว, แก้ role 1 ตัว
    2. เปิด Suitelet Recon ต่อท้าย `&view=probe` เลือกช่วงวันที่วันนั้น
    3. ดูแถวที่ `recordid ตัวอย่าง` ตรงกับ internal id ของ object ที่เพิ่งแก้ แล้วใส่ `recordtypeid` ลง `RECTYPE_MAP`
    4. ประเภทที่ไม่โผล่ใน probe = SuiteQL `systemnote` มองไม่เห็นการเปลี่ยนของ object ประเภทนั้น → จดไว้ใน Open Questions ของ spec และใช้ Saved Search บน record นั้นเสริม

6. **ทดสอบ flow** ใน SB ด้วย 3 user (Developer, Approver, Deployer)
    - สร้าง CR → เพิ่ม Affected Object → Submit → Approve (ด้วย Developer ต้องถูกปฏิเสธ) → UAT Passed → Mark Deployed → Verify
    - ลองแก้ Status / Approver ตรง ๆ, ลบ CR, แก้ object หลัง Approve → ต้องถูกปฏิเสธทุกกรณี
    - แก้ไฟล์ตรง ๆ โดยไม่มี CR → เปิดรายงานต้องเห็น E1
    - อธิบาย Exception → Sign-off ได้ · ยังมี Exception รออธิบาย → Sign-off ต้องถูกปฏิเสธ

7. **ขึ้น PROD**: สร้าง record/list ซ้ำ, ตั้ง `TB_DL_Config.js` ของ PROD ใหม่ (role/employee id และ recordtypeid ของ PROD ห้ามก๊อปจาก SB), Probe ซ้ำใน PROD

## SHA-1 ของไฟล์

ใส่ใน Affected Object ประเภท File ก่อนกด Mark Deployed (ระบบบังคับ)

```bash
shasum -a 1 "SuiteScripts/Project/xxx.js"
```

หรือดู File Content Hash ใน System Notes ของไฟล์ใน SB ระบบเทียบกับ SHA-1 ของไฟล์ใน PROD ตอนเปิดรายงาน ไม่ตรง = E4

## ข้อจำกัดที่รู้แล้ว

- **ยังไม่ยืนยันว่ามีตาราง `systemnote`** ใน SuiteQL ของทุกบัญชี และเห็น object ตั้งค่าครบทุกประเภท (catalog ที่มีอยู่แสดงแค่ `SystemNote2`) ต้องผ่านข้อ 5 ก่อนใช้จริง
- `Script Deployment` หา PROD Internal ID อัตโนมัติด้วยตาราง `scriptdeployment` ซึ่งยังไม่ยืนยัน ถ้าหาไม่ได้ให้ใส่เอง
- SHA-1 ตรวจเฉพาะไฟล์ข้อความ (JS, HTML, XML, CSV, JSON ฯลฯ) และตรวจได้ `HASH_MAX_FILES_SUITELET` ไฟล์ต่อการเปิดรายงาน ที่เหลืออยู่ในแท็บ "ไฟล์ที่ยังไม่ได้ตรวจ SHA-1" (scheduled ตรวจได้มากกว่า)
- เวลาเทียบกันด้วยค่าจาก `TO_CHAR` ในบัญชีเดียวกันทั้งสองฝั่ง จึงไม่ต้องแปลง timezone แต่เวลาที่แสดงอาจเป็น timezone ของ server
- ปุ่ม Sign-off ทำงานผ่าน GET พร้อม confirm (ไม่มี CSRF token แยก) — ผู้ที่ทำได้จำกัดด้วย `REVIEWER_EMPLOYEE_IDS`

## ดู log

```sql
SELECT title, detail, TO_CHAR(date,'YYYY-MM-DD HH24:MI:SS') AS tm FROM scriptnote WHERE title LIKE 'TBDL %' ORDER BY internalid DESC FETCH FIRST 30 ROWS ONLY
```
