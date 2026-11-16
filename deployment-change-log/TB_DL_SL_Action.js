/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * TB_DL_SL_Action — เปลี่ยนสถานะ Deployment Change Log (ทางเดียวที่เปลี่ยนสถานะได้)
 * GET ?id=<change log id>&act=<submit|approve|reject|reopen|uat|deploy|verify|rollback>&reason=
 * ตรวจสถานะต้นทาง + Segregation of Duties → stamp ผู้ทำ/เวลา (เวลาจากระบบ แก้เองไม่ได้) → ต่อท้าย History → กลับหน้า record
 *
 * Deployment: Execute as Role = Administrator (หรือ role ที่แก้ record ได้) · Audience = ทุก role ที่ใช้ Change Log
 *             ตัวตรวจสิทธิ์จริงอยู่ในไฟล์นี้ ไม่ได้พึ่ง role ของผู้กด
 */
define(['N/record', 'N/runtime', 'N/redirect', 'N/format', 'N/ui/serverWidget', './TB_DL_Lib'],
    (record, runtime, redirect, format, serverWidget, L) => {

        const F = L.F, S = L.S;

        class Refuse extends Error { }
        const refuse = msg => { throw new Refuse(msg); };

        function need(cond, msg) { if (!cond) refuse(msg); }

        /** กติกาต่อ action: from = สถานะต้นทางที่ยอมรับ, check = ตรวจเพิ่ม, apply = ค่าที่เขียน */
        function plan(act, c) {
            const me = c.me, now = new Date();
            const notSelf = (who, label) => need(!who || who !== me, 'คุณเป็น' + label + 'ของ CR นี้ จึงทำขั้นนี้ไม่ได้ (Segregation of Duties)');
            switch (act) {
                case 'submit':
                    need(c.status === S.DRAFT, 'ส่งอนุมัติได้เฉพาะ CR สถานะ Draft');
                    need(c.v.desc && c.v.type && c.v.risk && c.v.requester && c.v.developer && c.v.rollback, 'กรอก Description, Change Type, Risk, Requester, Developer และ Rollback Plan ให้ครบก่อนส่ง');
                    need(c.objects.length > 0, 'ต้องมี Affected Object อย่างน้อย 1 รายการ');
                    need(c.objects.every(o => o.objType && o.objKey), 'Affected Object ทุกรายการต้องมี Object Type และ Script ID / Path');
                    return { status: S.PENDING };
                case 'approve':
                case 'reject':
                    need(c.status === S.PENDING, (act === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ') + 'ได้เฉพาะ CR สถานะ Pending Approval');
                    notSelf(c.v.developer, ' Developer ');
                    notSelf(c.v.requester, 'ผู้ขอ');
                    return { status: act === 'approve' ? S.APPROVED : S.REJECTED, set: { [F.approver]: me, [F.approveDate]: now } };
                case 'reopen':
                    need([S.PENDING, S.APPROVED, S.UAT].indexOf(c.status) >= 0, 'ตีกลับเป็น Draft ได้เฉพาะ CR ที่ยังไม่ deploy');
                    need([c.v.developer, c.v.requester, c.v.approver].indexOf(me) >= 0, 'ตีกลับได้เฉพาะ Developer, ผู้ขอ หรือผู้อนุมัติของ CR นี้');
                    return { status: S.DRAFT, set: { [F.approver]: null, [F.approveDate]: null, [F.uatBy]: null, [F.uatDate]: null } };
                case 'uat': {
                    const emergencyLate = c.status === S.DEPLOYED && c.isEmergency && !c.v.uatDate;
                    need(c.status === S.APPROVED || emergencyLate, 'ยืนยัน UAT ได้เมื่อ CR อนุมัติแล้ว (หรือ Emergency fix ที่ deploy ไปก่อน)');
                    notSelf(c.v.developer, ' Developer ');
                    return { status: emergencyLate ? S.DEPLOYED : S.UAT, set: { [F.uatBy]: me, [F.uatDate]: now } };
                }
                case 'deploy':
                    need(c.status === S.UAT || (c.status === S.APPROVED && c.isEmergency), 'Mark Deployed ได้เมื่อ UAT ผ่านแล้ว (Emergency fix: เมื่ออนุมัติแล้ว)');
                    need(!c.deployers || c.deployers[me], 'คุณไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy ขึ้น PROD (DEPLOYER_ROLE_IDS / DEPLOYER_EMPLOYEE_IDS)');
                    notSelf(c.v.approver, 'ผู้อนุมัติ');
                    need(c.v.method, 'เลือก Deploy Method ก่อน');
                    need(c.objects.filter(o => o.objType === 'File').every(o => /^[0-9a-f]{40}$/i.test(o.sha1)), 'Affected Object ประเภท File ทุกรายการต้องมี SHA-1 ของไฟล์ที่ทดสอบใน SB');
                    return { status: S.DEPLOYED, set: { [F.deployer]: me, [F.deployDate]: now } };
                case 'verify':
                    need(c.status === S.DEPLOYED, 'Verify ได้เฉพาะ CR สถานะ Deployed');
                    need(!c.isEmergency || c.v.uatDate, 'Emergency fix ต้องยืนยัน UAT ก่อน Verify');
                    need([c.v.requester, c.v.deployer, c.v.approver].indexOf(me) >= 0, 'Verify ได้เฉพาะผู้ขอ ผู้ deploy หรือผู้อนุมัติของ CR นี้');
                    return { status: S.VERIFIED, set: { [F.verifiedBy]: me, [F.verifiedDate]: now }, resolveIds: true };
                case 'rollback':
                    need(c.status === S.DEPLOYED || c.status === S.VERIFIED, 'Rolled Back ได้เฉพาะ CR ที่ deploy แล้ว');
                    need((!c.deployers || c.deployers[me]) || me === c.v.approver, 'Rolled Back ได้เฉพาะผู้มีสิทธิ์ deploy หรือผู้อนุมัติ');
                    return { status: S.ROLLED_BACK };
                default:
                    return refuse('ไม่รู้จัก action "' + act + '"');
            }
        }

        const REASON_REQUIRED = ['reject', 'reopen', 'rollback'];

        function onRequest(ctx) {
            const p = ctx.request.parameters;
            const id = p.id, act = String(p.act || ''), reason = String(p.reason || '').trim().slice(0, 1000);
            try {
                need(id, 'ไม่มี id ของ Change Log');
                need(REASON_REQUIRED.indexOf(act) < 0 || reason, 'ขั้นนี้ต้องใส่เหตุผล');
                const user = runtime.getCurrentUser();
                const me = String(user.id);
                const rec = record.load({ type: L.REC.LOG, id });
                const val = f => { const x = rec.getValue(f); return x === null || x === undefined || x === '' ? '' : (x instanceof Date ? x : String(x)); };
                const v = {
                    desc: val(F.desc), type: val(F.type), risk: val(F.risk), requester: val(F.requester), developer: val(F.developer),
                    approver: val(F.approver), deployer: val(F.deployer), rollback: val(F.rollback), method: val(F.method), uatDate: val(F.uatDate)
                };
                const dset = L.deployerSet();
                const c = {
                    me, v, status: L.listName('status', rec.getValue(F.status)) || S.DRAFT,
                    isEmergency: L.listName('type', rec.getValue(F.type)) === L.EMERGENCY,
                    objects: L.objectsOf(id),
                    deployers: Object.keys(dset).length ? dset : null
                };
                const pl = plan(act, c);

                rec.setValue({ fieldId: F.status, value: L.listId('status', pl.status) });
                Object.keys(pl.set || {}).forEach(f => rec.setValue({ fieldId: f, value: pl.set[f] === null ? null : (f.indexOf('date') >= 0 ? pl.set[f] : Number(pl.set[f])) }));
                const stamp = format.format({ value: new Date(), type: format.Type.DATETIME });
                const line = stamp + ' | ' + c.status + ' → ' + pl.status + ' | ' + user.name + (reason ? ' | ' + reason : '');
                const prev = rec.getValue(F.history) || '';
                rec.setValue({ fieldId: F.history, value: (prev ? prev + '\n' : '') + line });
                rec.save({ enableSourcing: false, ignoreMandatoryFields: false });
                L.log('action ' + act, 'CR ' + id + ' ' + line);

                if (pl.resolveIds) {
                    c.objects.filter(o => !o.prodId).forEach(o => {
                        const rid = L.resolveProdId(o.objType, o.objKey);
                        if (rid) record.submitFields({ type: L.REC.OBJ, id: o.id, values: { [F.oProdId]: Number(rid) } });
                    });
                }
                redirect.toRecord({ type: L.REC.LOG, id });
            } catch (e) {
                const known = e instanceof Refuse;
                if (!known) L.log('action error ' + act + ' ' + id, e.message + ' ' + (e.stack || ''));
                const form = serverWidget.createForm({ title: 'Deployment Change Log' });
                const fld = form.addField({ id: 'custpage_msg', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
                const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
                fld.defaultValue = '<div style="font:14px/1.6 sans-serif;max-width:640px;padding:16px;border:1px solid #e5a3a3;background:#fdf1f1;border-radius:8px">'
                    + '<b>ทำรายการไม่สำเร็จ</b><br>' + esc(known ? e.message : 'เกิดข้อผิดพลาด: ' + e.message) + '</div>'
                    + '<p style="font:14px sans-serif"><a href="javascript:history.back()">← กลับไปที่ CR</a></p>';
                ctx.response.writePage(form);
            }
        }

        return { onRequest };
    });
