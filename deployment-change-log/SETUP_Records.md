# Deployment Change Log — Custom Records และ Lists

สร้างตามตารางนี้ทั้งใน SB และ PROD โดยใช้ Script ID ให้ตรงตัว เพราะโค้ดอ้างตาม Script ID
ชื่อค่าใน Custom List ต้องสะกดตรงตัวอักษร เพราะโค้ดแปลงจากชื่อเป็น internal id (internal id ของ SB กับ PROD ไม่ตรงกัน)

ตอนพิมพ์ Script ID ใน NetSuite ให้พิมพ์แค่ส่วนหลัง prefix เช่น `_tbdl_desc` เพราะ NetSuite เติม `custrecord` / `customrecord` / `customlist` ให้เอง

## 1. Custom Lists

| Script ID | ค่า (สะกดตามนี้) |
| --- | --- |
| `customlist_tbdl_status` | Draft, Pending Approval, Approved, UAT Passed, Deployed, Verified, Rolled back, Rejected |
| `customlist_tbdl_type` | New, Enhancement, Bug fix, Emergency fix, Config |
| `customlist_tbdl_risk` | Low, Medium, High |
| `customlist_tbdl_method` | SDF, Bundle, Copy to Account, Manual |
| `customlist_tbdl_objtype` | Script, Script Deployment, File, Custom Field, Custom Record Type, Workflow, Role, Saved Search, Form, Template |
| `customlist_tbdl_action` | Create, Update, Delete, Inactivate |

## 2. `customrecord_tb_deploy_log` — Deployment Change Log (Header)

ตั้งค่า record type: Include Name Field = T (ใช้เป็น CR No.), Show ID = T, Allow Delete ห้ามให้ role ไหนมีสิทธิ์ Full, Allow Attachments = T, Enable System Notes (มีเป็นค่าเริ่มต้น)

| Label | Script ID | Type | หมายเหตุ |
| --- | --- | --- | --- |
| CR No. | `name` | — | Name field ของ record |
| Description | `custrecord_tbdl_desc` | Long Text | Mandatory |
| Change Type | `custrecord_tbdl_type` | List/Record → `customlist_tbdl_type` | Mandatory |
| Risk | `custrecord_tbdl_risk` | List/Record → `customlist_tbdl_risk` | Mandatory |
| Requester | `custrecord_tbdl_requester` | List/Record → Employee | Mandatory |
| Developer | `custrecord_tbdl_developer` | List/Record → Employee | Mandatory |
| Approver | `custrecord_tbdl_approver` | List/Record → Employee | Display Type = Inline Text (ระบบใส่ให้) |
| Approved Date | `custrecord_tbdl_approve_date` | Date/Time | Inline Text |
| UAT Signed By | `custrecord_tbdl_uat_by` | List/Record → Employee | Inline Text |
| UAT Date | `custrecord_tbdl_uat_date` | Date/Time | Inline Text |
| Deployer | `custrecord_tbdl_deployer` | List/Record → Employee | Inline Text |
| Deployed Date | `custrecord_tbdl_deploy_date` | Date/Time | Inline Text |
| Deploy Method | `custrecord_tbdl_method` | List/Record → `customlist_tbdl_method` | ต้องมีก่อนกด Deploy |
| SDF / Bundle Ref | `custrecord_tbdl_sdf_ref` | Free-Form Text | |
| Rollback Plan | `custrecord_tbdl_rollback` | Long Text | Mandatory |
| Verified By | `custrecord_tbdl_verified_by` | List/Record → Employee | Inline Text |
| Verified Date | `custrecord_tbdl_verified_date` | Date/Time | Inline Text |
| Status | `custrecord_tbdl_status` | List/Record → `customlist_tbdl_status` | Inline Text, ค่าเริ่มต้น Draft |
| History | `custrecord_tbdl_history` | Long Text | Inline Text — ระบบต่อท้ายทุกครั้งที่เปลี่ยนสถานะ |

## 3. `customrecord_tb_deploy_obj` — Affected Object (Child)

| Label | Script ID | Type | หมายเหตุ |
| --- | --- | --- | --- |
| Change Log | `custrecord_tbdo_parent` | List/Record → Deployment Change Log | **Record is Parent = T**, Mandatory (ได้ sublist บน Header) |
| Object Type | `custrecord_tbdo_objtype` | List/Record → `customlist_tbdl_objtype` | Mandatory |
| Script ID / Path | `custrecord_tbdo_objkey` | Free-Form Text | Mandatory เช่น `customscript_xxx` หรือ `SuiteScripts/Project/xxx.js` |
| PROD Internal ID | `custrecord_tbdo_prod_id` | Integer | เว้นว่างได้ ระบบพยายามหาให้จาก Script ID / Path |
| Action | `custrecord_tbdo_action` | List/Record → `customlist_tbdl_action` | Mandatory |
| SHA-1 (tested in SB) | `custrecord_tbdo_sha1` | Free-Form Text | บังคับสำหรับ File ก่อนกด Deploy |

## 4. `customrecord_tb_deploy_exc` — Exception Explanation

Include Name Field = T (เก็บ exception key ที่ระบบสร้าง ห้ามแก้เอง)

| Label | Script ID | Type |
| --- | --- | --- |
| Exception Code | `custrecord_tbde_code` | Free-Form Text |
| Object | `custrecord_tbde_object` | Free-Form Text |
| Change Time | `custrecord_tbde_change_ts` | Free-Form Text |
| Actor | `custrecord_tbde_actor` | List/Record → Employee |
| Explanation | `custrecord_tbde_explain` | Long Text |
| Resolution | `custrecord_tbde_resolution` | Free-Form Text |
| Related CR | `custrecord_tbde_cr` | List/Record → Deployment Change Log |
| Explained By | `custrecord_tbde_by` | List/Record → Employee |
| Explained Date | `custrecord_tbde_date` | Date/Time |

## 5. `customrecord_tb_deploy_signoff` — Monthly Sign-off

Include Name Field = T (เช่น `2026-10`)

| Label | Script ID | Type |
| --- | --- | --- |
| Period From | `custrecord_tbds_from` | Date |
| Period To | `custrecord_tbds_to` | Date |
| Total Changes | `custrecord_tbds_total` | Integer |
| Matched | `custrecord_tbds_matched` | Integer |
| Exceptions | `custrecord_tbds_exceptions` | Integer |
| Snapshot File | `custrecord_tbds_file` | Document |
| Reviewer | `custrecord_tbds_reviewer` | List/Record → Employee |
| Signed Date | `custrecord_tbds_signed_date` | Date/Time |
| Status | `custrecord_tbds_status` | Free-Form Text (Pending / Signed) |
| Note | `custrecord_tbds_note` | Long Text |

## 6. สิทธิ์ (Role permission ต่อ record type)

| Record | Developer | Approver / Business user | Deployer | IT Manager (reviewer) |
| --- | --- | --- | --- | --- |
| Deployment Change Log | Create | Edit | Edit | View |
| Affected Object | Create | View | Edit | View |
| Exception Explanation | Create | View | Create | Edit |
| Monthly Sign-off | View | View | View | Edit |

ไม่มี role ไหนได้ Full (= ลบได้) และ UE ก็กันการลบอีกชั้น
