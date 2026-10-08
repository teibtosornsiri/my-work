# NS Central

คู่มือรวมความรู้ NetSuite ที่ใช้ซ้ำได้ สำหรับคนเขียน SuiteScript, SuiteQL และคนที่ต้องแก้ข้อมูลผ่านหน้าจอ อ่านแล้วเลี่ยงกับดักที่ทีมเจอมาแล้วได้ ไม่ต้องเสียเวลาไล่หาสาเหตุซ้ำ

เนื้อหาเต็มอยู่ที่ [`NS-CENTRAL.md`](NS-CENTRAL.md) ไฟล์เดียว ส่วนวิธีอ่าน Workflow ทั้ง account แบบ read-only แยกไว้ที่ [`ns-workflow-bulk-read-standard.md`](ns-workflow-bulk-read-standard.md) เพราะเป็นขั้นตอนยาวที่รันใน console ได้ทันที เป็นบันทึกจากงานจริงตั้งแต่ 2026-08 จนถึงปัจจุบัน แต่ละข้อมีวันที่หรือบอกไว้ว่าพิสูจน์จากอะไร

## หมวดในไฟล์

| หมวด | เนื้อหา |
|---|---|
| 1 URL | host ของ Sandbox (`-sb1` vs `_SB1`) · URL ของ custom record · Suitelet ต้องมี `script`/`deploy` |
| 2–5.5 อ่าน/เขียน record | รูปร่าง form field หน้า edit · อ่านแบบ read-only · แก้ record ยกชุด · สร้าง custom record · อัปไฟล์ทับใน File Cabinet |
| 6 ตรวจงาน | วิธี debug และเทียบไฟล์ SB กับ PROD (เทียบ hash ของ File Cabinet) |
| 7 SuiteQL | schema ที่ใช้บ่อย · join ที่ทำให้แถวบวม · `BUILTIN.DF` กับ `GROUP BY` · multi-select |
| 8–9 report / workflow | standard report และการอ่าน workflow action |
| 10 กับดัก | พฤติกรรม NetSuite และ SuiteScript ที่ทำให้ผลผิดแบบเงียบ ๆ |
| 10.5 dashboard / role | สลับ role ด้วย URL · copy และ publish dashboard |
| 11–13 คลังสินค้า | หา test data · สร้างเอกสารคลัง · หน่วย stock vs base · TWMS |
| 14 Suitelet UI | pattern ฝั่ง client · มาตรฐานหน้าตาอยู่ที่ [`../report-ci`](../report-ci/) |
| 15 Map/Reduce | หลาย deployment กับ idempotency (กันเอกสารซ้ำ) |
| 16 print template | Advanced PDF · FreeMarker · Word XML · ความกว้างข้อความไทย |
| 17–18 SB vs PROD / SFTP | ID ที่ต่างกันระหว่าง environment · N/sftp และ API Secret |
| 19 ทดสอบนอก NS | วิธีทดสอบนอก NetSuite และเก็บ screenshot ทำคู่มือ |

## อ่านให้ถูก

- **`<acct-A>` ถึง `<acct-D>`** คือ account NetSuite คนละบัญชี ปิดเลขจริงไว้ ใช้แยกว่าพฤติกรรมไหนเจอบัญชีเดียวกัน
- **`ลูกค้า A/B/C`** คือชื่อลูกค้าที่ปิดไว้ ส่วน internal id ของ script, record และ role อ้างอิงบัญชีนั้น ๆ ใช้ตรง ๆ กับบัญชีอื่นไม่ได้
- **คำว่า "(บันทึกส่วนตัว)"** ต่อท้ายชื่อ เป็นบันทึกงานรายโปรเจกต์ที่ไม่ได้อยู่ใน repo นี้
- **ไฟล์ที่อ้างชื่อ:** `codecmp.py` อยู่ที่ [`../tools/codecmp`](../tools/codecmp/) ส่วน `grir_check.py` อยู่ใน repo private ของลูกค้า

## วิธีอัปเดต

ต้นฉบับอยู่ในเครื่องผู้เขียนและอัปเดตตลอด ไฟล์ใน repo นี้คือสำเนาที่ปิดข้อมูลลูกค้าแล้ว ถ้าจะอัปเดต ให้ copy จากต้นฉบับแล้วปิดเลข account กับชื่อลูกค้าซ้ำทุกครั้งก่อน commit

---

เจอข้อที่ไม่จริงแล้ว หรือ NetSuite เปลี่ยนพฤติกรรม ให้แก้ข้อนั้นใน `NS-CENTRAL.md` แล้วใส่วันที่ที่ตรวจไว้ในบรรทัดเดียวกัน
