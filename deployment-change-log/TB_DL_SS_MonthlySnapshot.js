/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 *
 * TB_DL_SS_MonthlySnapshot — รันวันที่ 1 ของเดือน (spec หัวข้อ 6.1)
 *   1. กระทบยอดเดือนก่อนทั้งเดือน
 *   2. เก็บ snapshot เป็น CSV ใน File Cabinet (SNAPSHOT_FOLDER_ID) — หลักฐานว่าผู้ review เห็นอะไร ณ วันนั้น
 *   3. สร้าง/อัปเดต Monthly Sign-off record สถานะ Pending (ถ้า sign-off ไปแล้วจะไม่แตะ)
 *   4. อีเมลผู้ review พร้อมตัวเลขสรุปและลิงก์รายงาน
 *
 * รันซ้ำได้ (ผลเดิม): ไฟล์ชื่อเดิมถูกเขียนทับ, record เดิมถูกอัปเดต
 * ทดสอบเดือนอื่น: ตั้ง script parameter custscript_tbdl_ss_period = YYYY-MM (ไม่บังคับ)
 */
define(['N/runtime', 'N/file', 'N/record', 'N/email', 'N/url', 'N/query', './TB_DL_Lib'],
    (runtime, file, record, email, url, query, L) => {

        const CFG = L.CFG, F = L.F;

        function period() {
            let y, m;
            const param = runtime.getCurrentScript().getParameter({ name: 'custscript_tbdl_ss_period' });
            const hit = param && String(param).match(/^(\d{4})-(\d{2})$/);
            if (hit) { y = +hit[1]; m = +hit[2] - 1; } else {
                const now = new Date();
                y = now.getFullYear(); m = now.getMonth() - 1;
                if (m < 0) { m = 11; y--; }
            }
            const from = new Date(y, m, 1), to = new Date(y, m + 1, 0);
            return { from, to, fromYmd: L.ymd(from), toYmd: L.ymd(to), label: y + '-' + String(m + 1).padStart(2, '0') };
        }

        function findSignoff(per) {
            const r = query.runSuiteQL({
                query: 'SELECT s.id, s.' + F.sStatus + ' AS st FROM ' + L.REC.SIGN + ' s WHERE s.' + F.sFrom + " = TO_DATE(?, 'YYYY-MM-DD') AND s." + F.sTo + " = TO_DATE(?, 'YYYY-MM-DD') AND s.isinactive = 'F' ORDER BY s.id DESC",
                params: [per.fromYmd, per.toYmd]
            }).asMappedResults();
            return r.length ? r[0] : null;
        }

        function reportUrl(per) {
            let host = '';
            try { host = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION }); } catch (e) { /* ไม่มีก็ใช้ path */ }
            return host + url.resolveScript({ scriptId: CFG.SL_RECON.scriptId, deploymentId: CFG.SL_RECON.deploymentId, params: { f_from: per.fromYmd, f_to: per.toYmd } });
        }

        function execute() {
            const per = period();
            const existing = findSignoff(per);
            if (existing && existing.st === 'Signed') {
                L.log('snapshot skip', per.label + ' sign-off แล้ว (record ' + existing.id + ')');
                return;
            }

            const res = L.runReconciliation({ fromYmd: per.fromYmd, toYmd: per.toYmd, maxHashFiles: CFG.HASH_MAX_FILES_SCHEDULED });
            const s = res.summary;

            let fileId = null;
            if (CFG.SNAPSHOT_FOLDER_ID) {
                const f = file.create({
                    name: 'change_reconciliation_' + per.label + '.csv',
                    fileType: file.Type.CSV,
                    contents: L.toCsv(per.fromYmd, per.toYmd, res),
                    folder: Number(CFG.SNAPSHOT_FOLDER_ID),
                    encoding: file.Encoding.UTF_8
                });
                fileId = f.save();
            } else {
                L.log('snapshot', 'ไม่ได้ตั้ง SNAPSHOT_FOLDER_ID — ไม่ได้เก็บไฟล์');
            }

            const rec = existing ? record.load({ type: L.REC.SIGN, id: existing.id }) : record.create({ type: L.REC.SIGN });
            rec.setValue({ fieldId: 'name', value: per.label });
            rec.setValue({ fieldId: F.sFrom, value: per.from });
            rec.setValue({ fieldId: F.sTo, value: per.to });
            rec.setValue({ fieldId: F.sTotal, value: s.changes });
            rec.setValue({ fieldId: F.sMatched, value: s.matched });
            rec.setValue({ fieldId: F.sExceptions, value: s.exceptions });
            if (fileId) rec.setValue({ fieldId: F.sFile, value: fileId });
            rec.setValue({ fieldId: F.sStatus, value: 'Pending' });
            rec.setValue({ fieldId: F.sNote, value: 'snapshot ' + new Date().toISOString() + ' · System Notes ' + res.noteRows + ' แถว · รออธิบาย ' + s.unexplained + ' · warnings: ' + (L.configWarnings().join(' | ') || '-') });
            const signId = rec.save();

            const reviewers = L.ids(CFG.REVIEWER_EMPLOYEE_IDS);
            if (reviewers.length && CFG.EMAIL_AUTHOR_ID) {
                const byCode = Object.keys(s.byCode).sort().map(k => k + ' ' + s.byCode[k]).join(', ') || '-';
                email.send({
                    author: Number(CFG.EMAIL_AUTHOR_ID),
                    recipients: reviewers,
                    subject: '[NetSuite] Change Reconciliation ' + per.label + ' — Exception ' + s.exceptions + ' รายการ',
                    body: [
                        'รายงานกระทบยอดการเปลี่ยนแปลงใน PROD เดือน ' + per.label,
                        '',
                        'การเปลี่ยนแปลงทั้งหมด: ' + s.changes,
                        'Matched กับ CR: ' + s.matched,
                        'Exception: ' + s.exceptions + ' (' + byCode + ')',
                        'รออธิบาย: ' + s.unexplained,
                        'CR ในช่วง: ' + s.crs,
                        '',
                        'ขั้นถัดไป: ทีม NetSuite อธิบาย Exception ให้ครบภายในวันที่ 5 แล้วผู้ review กด Sign-off ภายในวันที่ 10',
                        'เปิดรายงาน: ' + reportUrl(per)
                    ].join('\n'),
                    relatedRecords: { customRecord: { id: signId, recordType: L.REC.SIGN } }
                });
            } else {
                L.log('snapshot', 'ไม่ได้ส่งอีเมล (ตั้ง REVIEWER_EMPLOYEE_IDS และ EMAIL_AUTHOR_ID)');
            }
            L.log('snapshot done', per.label + ' changes=' + s.changes + ' exceptions=' + s.exceptions + ' signoff=' + signId + ' file=' + fileId);
        }

        return { execute };
    });
