# my-work

รวมงานที่ใช้ซ้ำได้ของ Sornsiri (Teibto) สำหรับทีมพัฒนา NetSuite: เปิดดูหรือหยิบไปใช้ต่อได้เลย

| โฟลเดอร์ | เนื้อหา |
|---|---|
| [`report-ci/`](report-ci/) | มาตรฐานหน้าตารายงานและฟอร์ม Suitelet: library กลาง `Lib_Report_UI.js` · Suitelet template · หน้าตัวอย่าง 3 ธีม |
| [`ns-central/`](ns-central/) | คู่มือรวมความรู้ NetSuite ที่ใช้ซ้ำได้: URL · SuiteQL · กับดัก SuiteScript · print template · SB vs PROD (ปิดเลข account และชื่อลูกค้าแล้ว) · มาตรฐานอ่าน Workflow ทั้ง account แบบ read-only |
| [`batch-delete-record/`](batch-delete-record/) | Suitelet + Map/Reduce สำหรับลบ record ยกชุดจาก Saved Search |
| [`batch-delete-saved-csv-import/`](batch-delete-saved-csv-import/) | Suitelet สำหรับลบ Saved CSV Import Template ทีละหลายตัว พร้อมตัวกรอง Owner / Record Type / ชื่อ |
| [`batch-record-update/`](batch-record-update/) | Suitelet แก้ field หัวเอกสาร บรรทัด และ Inventory Detail ทีละหลาย record จาก CSV หรือ SuiteQL |
| [`tools/codecmp/`](tools/codecmp/) | สคริปต์ Python เทียบโค้ดสองโฟลเดอร์ (SB vs PROD) ได้ report.md · summary.json · diff |
| [`doc-style/`](doc-style/) | สำนวนภาษาไทยสำหรับ User Guide ส่งลูกค้า · ชุดสร้าง User Guide .docx จาก Markdown |

แต่ละโฟลเดอร์มี README ของตัวเองบอกวิธีใช้และข้อจำกัด
