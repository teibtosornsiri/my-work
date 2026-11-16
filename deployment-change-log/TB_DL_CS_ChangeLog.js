/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 *
 * TB_DL_CS_ChangeLog — ปุ่มบน Deployment Change Log (แนบผ่าน form.clientScriptModulePath จาก UE)
 * ส่งไป TB_DL_SL_Action ซึ่งเป็นตัวตรวจสิทธิ์และเปลี่ยนสถานะจริง
 */
define(['N/url', 'N/currentRecord', './TB_DL_Config'], (url, currentRecord, CFG) => {

    const NEED_REASON = { reject: 'เหตุผลที่ไม่อนุมัติ', reopen: 'เหตุผลที่ตีกลับเป็น Draft', rollback: 'เหตุผลและสิ่งที่ rollback' };
    const CONFIRM = {
        submit: 'ส่ง CR นี้ขออนุมัติ? หลังส่งแล้วแก้ข้อมูลหลักไม่ได้จนกว่าจะตีกลับ',
        approve: 'อนุมัติ CR นี้ในชื่อของคุณ?',
        uat: 'ยืนยันว่า UAT ผ่านแล้วในชื่อของคุณ?',
        deploy: 'ยืนยันว่า deploy ขึ้น PROD แล้วในชื่อของคุณ? ระบบจะบันทึกเวลาปัจจุบันเป็นเวลา deploy',
        verify: 'ยืนยันว่าตรวจหลัง deploy เรียบร้อยแล้ว?'
    };

    function pageInit() { /* ต้องมี entry point อย่างน้อยหนึ่งตัว */ }

    function tbdlAct(act) {
        let reason = '';
        if (NEED_REASON[act]) {
            reason = window.prompt(NEED_REASON[act] + ' (บังคับ)', '');
            if (reason === null) return;
            reason = reason.trim();
            if (!reason) { window.alert('ต้องใส่เหตุผล'); return; }
        } else if (CONFIRM[act] && !window.confirm(CONFIRM[act])) {
            return;
        }
        const rec = currentRecord.get();
        window.location.href = url.resolveScript({
            scriptId: CFG.SL_ACTION.scriptId,
            deploymentId: CFG.SL_ACTION.deploymentId,
            params: { id: rec.id, act, reason }
        });
    }

    return { pageInit, tbdlAct };
});
