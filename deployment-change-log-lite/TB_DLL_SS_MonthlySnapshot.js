/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 *
 * TB_DLL_SS_MonthlySnapshot — รันวันที่ 1 ของเดือน (ไม่ใส่ก็ได้)
 *   1. ดึงการเปลี่ยนแปลงใน PROD ของเดือนก่อน
 *   2. เก็บ CSV ลง File Cabinet (SNAPSHOT_FOLDER_ID) เป็นหลักฐาน ณ วันที่ดึง
 *   3. อีเมลผู้ review พร้อมไฟล์แนบและตัวเลขสรุป
 * รันซ้ำได้ (ไฟล์ชื่อเดิมถูกเขียนทับ) · ทดสอบเดือนอื่น: parameter custscript_tbdll_ss_period = YYYY-MM
 */
define(['N/runtime', 'N/file', 'N/email', 'N/url', './TB_DLL_Lib'], (runtime, file, email, url, L) => {

    const CFG = L.CFG;

    function period() {
        let y, m;
        const param = runtime.getCurrentScript().getParameter({ name: 'custscript_tbdll_ss_period' });
        const hit = param && String(param).match(/^(\d{4})-(\d{2})$/);
        if (hit) { y = +hit[1]; m = +hit[2] - 1; } else {
            const now = new Date();
            y = now.getFullYear(); m = now.getMonth() - 1;
            if (m < 0) { m = 11; y--; }
        }
        const from = new Date(y, m, 1), to = new Date(y, m + 1, 0);
        return { fromYmd: L.ymd(from), toYmd: L.ymd(to), label: y + '-' + String(m + 1).padStart(2, '0') };
    }

    function reportUrl(per) {
        let host = '';
        try { host = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION }); } catch (e) { /* ใช้ path อย่างเดียว */ }
        return host + url.resolveScript({ scriptId: CFG.SL_REPORT.scriptId, deploymentId: CFG.SL_REPORT.deploymentId, params: { f_from: per.fromYmd, f_to: per.toYmd } });
    }

    function execute() {
        const per = period();
        const res = L.run(per.fromYmd, per.toYmd);
        const opts = {
            name: 'prod_changes_' + per.label + '.csv',
            fileType: file.Type.CSV,
            contents: L.toCsv(per.fromYmd, per.toYmd, res),
            encoding: file.Encoding.UTF_8
        };
        if (CFG.SNAPSHOT_FOLDER_ID) opts.folder = Number(CFG.SNAPSHOT_FOLDER_ID);
        const csv = file.create(opts);
        let fileId = null;
        if (CFG.SNAPSHOT_FOLDER_ID) fileId = csv.save();
        else L.log('snapshot', 'ไม่ได้ตั้ง SNAPSHOT_FOLDER_ID — ไม่ได้เก็บไฟล์ใน File Cabinet (ยังแนบอีเมลได้)');

        const reviewers = L.ids(CFG.REVIEWER_EMPLOYEE_IDS);
        if (reviewers.length && CFG.EMAIL_AUTHOR_ID) {
            email.send({
                author: Number(CFG.EMAIL_AUTHOR_ID),
                recipients: reviewers,
                subject: '[NetSuite] การเปลี่ยนแปลงใน PROD เดือน ' + per.label + ' — ' + res.total + ' รายการ, ติดธง ' + res.flagged,
                body: [
                    'สรุปการเปลี่ยนแปลงใน PROD เดือน ' + per.label + ' (ไฟล์ CSV แนบ)',
                    '',
                    'การเปลี่ยนแปลงทั้งหมด: ' + res.total,
                    'Object ที่ถูกแก้: ' + res.objects,
                    'ผู้แก้ไม่มีสิทธิ์ deploy: ' + res.flagged,
                    'คำเตือนการตั้งค่า: ' + (L.configWarnings().join(' | ') || '-'),
                    '',
                    'ขั้นถัดไป: ทีม NetSuite กรอกเลข CR ทุกแถวในไฟล์ แถวที่ไม่มี CR ให้เขียนคำอธิบาย แล้วส่งให้ผู้ review เซ็นภายในวันที่ 10',
                    'เปิดรายงาน: ' + reportUrl(per)
                ].join('\n'),
                attachments: [fileId ? file.load({ id: fileId }) : csv]
            });
        } else {
            L.log('snapshot', 'ไม่ได้ส่งอีเมล (ตั้ง REVIEWER_EMPLOYEE_IDS และ EMAIL_AUTHOR_ID)');
        }
        L.log('snapshot done', per.label + ' changes=' + res.total + ' flagged=' + res.flagged + ' file=' + fileId);
    }

    return { execute };
});
