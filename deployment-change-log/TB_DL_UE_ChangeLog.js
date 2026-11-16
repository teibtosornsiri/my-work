/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * TB_DL_UE_ChangeLog — deploy บน customrecord_tb_deploy_log
 *   beforeLoad   : ปุ่มเปลี่ยนสถานะตามสถานะปัจจุบัน (ตัวตัดสินสิทธิ์จริงอยู่ที่ TB_DL_SL_Action)
 *   beforeSubmit : ห้ามลบ · สร้างใหม่ = Draft เสมอ · ห้ามแก้ field ที่ระบบ stamp เอง · ล็อก field หลักหลังส่งอนุมัติ
 *
 * การเปลี่ยนสถานะทำได้ทางเดียวคือ TB_DL_SL_Action (execution context = SUITELET)
 */
define(['N/runtime', 'N/ui/serverWidget', './TB_DL_Lib'], (runtime, serverWidget, L) => {

    const F = L.F, S = L.S;

    /** field ที่ระบบเป็นคนใส่ — คนแก้เองไม่ได้ */
    const PROTECTED = [F.status, F.approver, F.approveDate, F.uatBy, F.uatDate, F.deployer, F.deployDate, F.verifiedBy, F.verifiedDate, F.history];
    /** ล็อกเมื่อพ้น Draft */
    const KEY_FIELDS = [F.desc, F.type, F.risk, F.requester, F.developer, F.rollback, 'name'];
    /** ล็อกเมื่อ deploy แล้ว */
    const DEPLOY_FIELDS = [F.method, F.sdfRef];
    const CLOSED = [S.DEPLOYED, S.VERIFIED, S.ROLLED_BACK, S.REJECTED];

    const BUTTONS = {
        [S.DRAFT]: [['submit', 'Submit for Approval']],
        [S.PENDING]: [['approve', 'Approve'], ['reject', 'Reject'], ['reopen', 'Back to Draft']],
        [S.APPROVED]: [['uat', 'UAT Passed'], ['deploy', 'Mark Deployed'], ['reopen', 'Back to Draft']],
        [S.UAT]: [['deploy', 'Mark Deployed'], ['reopen', 'Back to Draft']],
        [S.DEPLOYED]: [['verify', 'Verify'], ['uat', 'UAT Passed'], ['rollback', 'Rolled Back']],
        [S.VERIFIED]: [['rollback', 'Rolled Back']]
    };

    function beforeLoad(ctx) {
        if (ctx.type !== ctx.UserEventType.VIEW) return;
        try {
            const rec = ctx.newRecord;
            const status = L.listName('status', rec.getValue(F.status)) || S.DRAFT;
            const isEmergency = L.listName('type', rec.getValue(F.type)) === L.EMERGENCY;
            const hasUat = !!rec.getValue(F.uatDate);
            ctx.form.clientScriptModulePath = './TB_DL_CS_ChangeLog.js';
            (BUTTONS[status] || []).forEach(([act, label]) => {
                if (act === 'deploy' && status === S.APPROVED && !isEmergency) return;
                if (act === 'uat' && status === S.DEPLOYED && (!isEmergency || hasUat)) return;
                ctx.form.addButton({ id: 'custpage_tbdl_' + act, label, functionName: 'tbdlAct("' + act + '")' });
            });
        } catch (e) {
            L.log('UE beforeLoad', e.message);
        }
    }

    const norm = v => v instanceof Date ? String(v.getTime()) : (v === null || v === undefined ? '' : String(v));

    function changedFields(ctx, list) {
        const oldR = ctx.oldRecord, newR = ctx.newRecord;
        const submitted = ctx.type === ctx.UserEventType.XEDIT ? newR.getFields() : null;
        return list.filter(f => {
            if (submitted && submitted.indexOf(f) < 0) return false;
            return norm(oldR.getValue(f)) !== norm(newR.getValue(f));
        });
    }

    function beforeSubmit(ctx) {
        const T = ctx.UserEventType;
        if (ctx.type === T.DELETE) {
            throw new Error('ลบ Deployment Change Log ไม่ได้ (ต้องเก็บครบทุกใบเพื่อการตรวจสอบ) — ถ้าไม่ใช้แล้วให้กด Reject หรือ Back to Draft แล้ว Reject');
        }
        const fromAction = runtime.executionContext === runtime.ContextType.SUITELET;

        if (ctx.type === T.CREATE || ctx.type === T.COPY) {
            if (fromAction) return;
            const rec = ctx.newRecord;
            PROTECTED.forEach(f => { try { rec.setValue({ fieldId: f, value: null }); } catch (e) { /* field อาจไม่มีบนฟอร์ม */ } });
            rec.setValue({ fieldId: F.status, value: L.listId('status', S.DRAFT) });
            return;
        }

        if (ctx.type !== T.EDIT && ctx.type !== T.XEDIT) return;
        if (fromAction) return;

        const oldStatus = L.listName('status', ctx.oldRecord.getValue(F.status)) || S.DRAFT;
        const bad = changedFields(ctx, PROTECTED);
        if (bad.length) {
            throw new Error('แก้ field ที่ระบบเป็นคนใส่ไม่ได้ (' + bad.join(', ') + ') — ใช้ปุ่มบนหน้า record เพื่อเปลี่ยนสถานะ');
        }
        if (oldStatus !== S.DRAFT) {
            const k = changedFields(ctx, KEY_FIELDS);
            if (k.length) throw new Error('CR สถานะ ' + oldStatus + ' แก้ข้อมูลหลักไม่ได้ (' + k.join(', ') + ') — กด Back to Draft แล้วส่งอนุมัติใหม่');
        }
        if (CLOSED.indexOf(oldStatus) >= 0) {
            const d = changedFields(ctx, DEPLOY_FIELDS);
            if (d.length) throw new Error('CR สถานะ ' + oldStatus + ' แก้ข้อมูลการ deploy ไม่ได้ (' + d.join(', ') + ')');
        }
    }

    return { beforeLoad, beforeSubmit };
});
