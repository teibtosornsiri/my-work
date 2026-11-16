/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * TB_DL_UE_Object — deploy บน customrecord_tb_deploy_obj (Affected Object)
 *   - แก้/เพิ่ม/ลบได้อิสระเฉพาะตอน CR เป็น Draft
 *   - Pending Approval / Approved / UAT Passed: แก้ได้แค่ PROD Internal ID
 *   - Deployed: เติม PROD Internal ID ได้เฉพาะตอนยังว่าง
 *   - สถานะอื่น: ล็อกทั้งหมด
 *   - PROD Internal ID ว่าง → ลองหาเองจาก Script ID / Path
 */
define(['N/runtime', './TB_DL_Lib'], (runtime, L) => {

    const F = L.F, S = L.S;
    const EDIT_PROD_ONLY = [S.PENDING, S.APPROVED, S.UAT];
    const ALL_FIELDS = [F.oParent, F.oType, F.oKey, F.oProdId, F.oAction, F.oSha1];

    const norm = v => v === null || v === undefined ? '' : String(v).trim();

    function beforeSubmit(ctx) {
        const T = ctx.UserEventType;
        const isDelete = ctx.type === T.DELETE;
        const rec = isDelete ? ctx.oldRecord : ctx.newRecord;
        const parentId = rec.getValue(F.oParent) || (ctx.oldRecord && ctx.oldRecord.getValue(F.oParent));
        if (!parentId) throw new Error('Affected Object ต้องผูกกับ Deployment Change Log');
        const status = L.headerStatus(parentId) || S.DRAFT;

        if (status !== S.DRAFT) {
            if (isDelete || ctx.type === T.CREATE || ctx.type === T.COPY) {
                throw new Error('CR สถานะ ' + status + ' เพิ่มหรือลบ object ไม่ได้ — กด Back to Draft ก่อน');
            }
            const submitted = ctx.type === T.XEDIT ? ctx.newRecord.getFields() : null;
            const changed = ALL_FIELDS.filter(f => (!submitted || submitted.indexOf(f) >= 0) && norm(ctx.oldRecord.getValue(f)) !== norm(ctx.newRecord.getValue(f)));
            const others = changed.filter(f => f !== F.oProdId);
            const prodChanged = changed.indexOf(F.oProdId) >= 0;
            const canProd = EDIT_PROD_ONLY.indexOf(status) >= 0 || (status === S.DEPLOYED && !norm(ctx.oldRecord.getValue(F.oProdId)));
            if (others.length || (prodChanged && !canProd)) {
                throw new Error('CR สถานะ ' + status + ' แก้ object นี้ไม่ได้' + (canProd ? ' (แก้ได้แค่ PROD Internal ID)' : ''));
            }
        }
        if (isDelete) return;

        // หา internal id ให้ ถ้ายังว่าง (สถานะที่อนุญาตให้แก้ PROD ID เท่านั้น)
        if (!norm(rec.getValue(F.oProdId)) && (status === S.DRAFT || EDIT_PROD_ONLY.indexOf(status) >= 0 || status === S.DEPLOYED)) {
            const objType = L.listName('objtype', rec.getValue(F.oType));
            const id = L.resolveProdId(objType, rec.getValue(F.oKey));
            if (id) rec.setValue({ fieldId: F.oProdId, value: Number(id) });
        }
        const sha = norm(rec.getValue(F.oSha1)).toLowerCase();
        if (sha && !/^[0-9a-f]{40}$/.test(sha)) throw new Error('SHA-1 ต้องเป็นเลขฐาน 16 ยาว 40 ตัว (ได้จาก shasum -a 1 หรือ File Content Hash ใน System Notes ของไฟล์)');
        if (sha) rec.setValue({ fieldId: F.oSha1, value: sha });
    }

    return { beforeSubmit };
});
