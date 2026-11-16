/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * TB_DLL_Lib — ของกลางของ Deployment Change Log (Lite)
 *   - ดึง System Notes ของ object ตาม RECTYPE_MAP แล้วรวมเป็น "การเปลี่ยนแปลง" (object + ผู้แก้ + นาทีเดียวกัน)
 *   - ติดธงการเปลี่ยนแปลงที่ผู้แก้ไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy
 *   - CSV สำหรับกระทบยอดใน Excel (มีช่องว่าง CR No. / คำอธิบาย / ผู้ตรวจ)
 *   - summarize() เป็น pure function ทดสอบนอก NetSuite ได้
 *
 * ตัวแปรระดับไฟล์ขึ้นต้น tbdll เพื่อไม่ชนกับไฟล์ผู้เรียก
 */
define(['N/query', './TB_DLL_Config'], (tbdllQuery, CFG) => {

    const tbdllLog = (title, detail) => log.audit(CFG.LOG_PREFIX + ' ' + title, detail);

    function runAll(sql, params) {
        const out = [];
        const paged = tbdllQuery.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000 });
        paged.pageRanges.forEach(r => paged.fetch({ index: r.index }).data.asMappedResults().forEach(x => out.push(x)));
        return out;
    }

    function chunk(arr, n) {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    }

    const ids = arr => (arr || []).map(Number).filter(n => Number.isFinite(n));

    /** 'YYYY-MM-DD HH24:MI:SS' → epoch ms แบบ naive (ใช้เทียบ/แสดงเท่านั้น) */
    function parseTs(s) {
        if (!s) return null;
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
    }

    function fmtTs(ms) {
        if (ms === null || ms === undefined) return '';
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }

    function ymd(d) {
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    // ---------- config ----------

    function rectypes() {
        const toType = {}, all = [];
        Object.keys(CFG.RECTYPE_MAP).forEach(t => {
            const v = CFG.RECTYPE_MAP[t];
            [].concat(v === null || v === undefined ? [] : v).forEach(x => {
                const n = Number(x);
                if (Number.isFinite(n)) { toType[String(n)] = t; all.push(n); }
            });
        });
        return { toType, all };
    }

    function configWarnings() {
        const w = [];
        const rt = rectypes();
        const missing = Object.keys(CFG.RECTYPE_MAP).filter(t => CFG.RECTYPE_MAP[t] === null || CFG.RECTYPE_MAP[t] === undefined);
        if (!rt.all.length) w.push('ยังไม่ได้ตั้ง RECTYPE_MAP ใน TB_DLL_Config — รายงานยังไม่เห็นการเปลี่ยนแปลง เปิด &view=probe เพื่อหาค่า');
        else if (missing.length) w.push('ยังไม่ได้ map recordtypeid ของ: ' + missing.join(', ') + ' — การเปลี่ยนแปลงของประเภทนี้ไม่อยู่ในรายงาน');
        if (!CFG.DEPLOYER_ROLE_IDS.length && !CFG.DEPLOYER_EMPLOYEE_IDS.length) w.push('ยังไม่ได้ตั้งผู้มีสิทธิ์ deploy — ระบบติดธง "ผู้แก้ไม่มีสิทธิ์" ไม่ได้');
        return w;
    }

    // ---------- people ----------

    function employeesWithRoles(roleIds) {
        const r = ids(roleIds);
        if (!r.length) return [];
        try {
            return runAll(
                'SELECT er.entity AS id, BUILTIN.DF(er.entity) AS name, er.role AS role, BUILTIN.DF(er.role) AS rolename ' +
                'FROM employeerolesforsearch er JOIN employee e ON e.id = er.entity ' +
                "WHERE e.isinactive = 'F' AND e.giveaccess = 'T' AND er.role IN (" + r.join(',') + ') ORDER BY name');
        } catch (e) {
            tbdllLog('employeesWithRoles failed', e.message);
            return [];
        }
    }

    function deployerSet() {
        const set = {};
        ids(CFG.DEPLOYER_EMPLOYEE_IDS).forEach(id => { set[String(id)] = true; });
        employeesWithRoles(CFG.DEPLOYER_ROLE_IDS).forEach(r => { set[String(r.id)] = true; });
        return set;
    }

    // ---------- System Notes ----------

    function fetchSystemNotes(fromYmd, toYmd) {
        const rt = rectypes();
        if (!rt.all.length) return [];
        const where = "sn.date >= TO_DATE(?, 'YYYY-MM-DD') AND sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1 AND sn.recordtypeid IN (" + rt.all.join(',') + ')';
        const full = 'SELECT sn.id, sn.recordid, sn.recordtypeid, sn.field, sn.context, sn.type, sn.oldvalue, sn.newvalue, sn.name AS actor, BUILTIN.DF(sn.name) AS actorname, ' +
            "sn.role, BUILTIN.DF(sn.role) AS rolename, TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI:SS') AS ts FROM systemnote sn WHERE " + where + ' ORDER BY sn.date';
        const minimal = 'SELECT sn.id, sn.recordid, sn.recordtypeid, sn.field, sn.context, sn.name AS actor, ' +
            "TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI:SS') AS ts FROM systemnote sn WHERE " + where + ' ORDER BY sn.date';
        let rows;
        try { rows = runAll(full, [fromYmd, toYmd]); } catch (e) {
            tbdllLog('systemnote full query failed, retry minimal', e.message);
            rows = runAll(minimal, [fromYmd, toYmd]);
        }
        const skip = (CFG.EXCLUDE_CONTEXTS || []).map(String);
        return rows.filter(r => skip.indexOf(String(r.context || '')) < 0).map(r => ({
            objType: rt.toType[String(r.recordtypeid)] || ('rectype ' + r.recordtypeid),
            objId: String(r.recordid),
            field: r.field || '',
            oldValue: r.oldvalue === null || r.oldvalue === undefined ? '' : String(r.oldvalue),
            newValue: r.newvalue === null || r.newvalue === undefined ? '' : String(r.newvalue),
            context: r.context || '',
            noteType: r.type || '',
            actor: r.actor === null || r.actor === undefined ? '' : String(r.actor),
            actorName: r.actorname || (r.actor ? '#' + r.actor : ''),
            role: r.role === null || r.role === undefined ? '' : String(r.role),
            roleName: r.rolename || '',
            ts: parseTs(r.ts)
        }));
    }

    /** รวมแถวที่เป็นการ save ครั้งเดียวกัน (object + ผู้แก้ + นาทีเดียวกัน) */
    function groupChanges(notes) {
        const map = {}, out = [];
        notes.forEach(n => {
            const minute = Math.floor((n.ts || 0) / 60000);
            const k = n.objType + '|' + n.objId + '|' + n.actor + '|' + minute;
            let g = map[k];
            if (!g) {
                g = map[k] = { key: k, objType: n.objType, objId: n.objId, objName: '', actor: n.actor, actorName: n.actorName, role: n.role, roleName: n.roleName, context: n.context, ts: n.ts, fields: [], details: [] };
                out.push(g);
            }
            if (n.field && g.fields.indexOf(n.field) < 0) g.fields.push(n.field);
            if (n.field && (n.oldValue || n.newValue) && g.details.length < 5) g.details.push(n.field + ': ' + n.oldValue.slice(0, 60) + ' → ' + n.newValue.slice(0, 60));
        });
        return out;
    }

    function attachObjectNames(changes) {
        const NAME_SQL = {
            'Script': 'SELECT id, scriptid AS skey, name FROM script WHERE id IN ',
            'File': 'SELECT id, name AS skey, name FROM file WHERE id IN ',
            'Custom Field': 'SELECT internalid AS id, scriptid AS skey, name FROM customfield WHERE internalid IN ',
            'Custom Record Type': 'SELECT internalid AS id, scriptid AS skey, name FROM customrecordtype WHERE internalid IN ',
            'Role': 'SELECT id, scriptid AS skey, name FROM role WHERE id IN '
        };
        const byType = {};
        changes.forEach(c => { (byType[c.objType] = byType[c.objType] || {})[c.objId] = true; });
        const names = {};
        Object.keys(byType).forEach(t => {
            if (!NAME_SQL[t]) return;
            chunk(ids(Object.keys(byType[t])), 200).forEach(part => {
                try {
                    tbdllQuery.runSuiteQL({ query: NAME_SQL[t] + '(' + part.join(',') + ')' }).asMappedResults().forEach(r => {
                        names[t + '|' + r.id] = r.skey && r.skey !== r.name ? r.name + ' (' + r.skey + ')' : r.name;
                    });
                } catch (e) { tbdllLog('attachObjectNames ' + t, e.message); }
            });
        });
        changes.forEach(c => { c.objName = names[c.objType + '|' + c.objId] || ('#' + c.objId); });
        return changes;
    }

    function probeRecordTypes(fromYmd, toYmd, limit) {
        const rows = tbdllQuery.runSuiteQL({
            query: 'SELECT sn.recordtypeid AS rt, COUNT(*) AS cnt, MIN(sn.recordid) AS samplerec, MIN(sn.field) AS samplefield, MAX(sn.date) AS lastdate ' +
                "FROM systemnote sn WHERE sn.date >= TO_DATE(?, 'YYYY-MM-DD') AND sn.date < TO_DATE(?, 'YYYY-MM-DD') + 1 " +
                'GROUP BY sn.recordtypeid ORDER BY cnt DESC',
            params: [fromYmd, toYmd]
        }).asMappedResults().slice(0, limit || 30);
        const mapped = rectypes().toType;
        rows.forEach(r => {
            r.mappedAs = mapped[String(r.rt)] || '';
            try {
                const x = tbdllQuery.runSuiteQL({ query: 'SELECT BUILTIN.DF(sn.recordtypeid) AS label FROM systemnote sn WHERE sn.recordtypeid = ? FETCH FIRST 1 ROWS ONLY', params: [r.rt] }).asMappedResults();
                r.label = x.length ? x[0].label : '';
            } catch (e) { r.label = ''; }
        });
        return rows;
    }

    // ---------- สรุป (pure) ----------

    /**
     * ติดธงและสรุป
     * @param {Array} changes จาก groupChanges + attachObjectNames
     * @param {Object} deployers set ของ employee id ที่มีสิทธิ์ deploy ({} = ไม่ได้ตั้ง → ไม่ติดธง)
     */
    function summarize(changes, deployers) {
        const hasList = Object.keys(deployers || {}).length > 0;
        const byType = {}, byActor = {};
        let flagged = 0;
        changes.forEach(c => {
            c.tsText = fmtTs(c.ts);
            c.flag = hasList && !deployers[c.actor] ? 'ผู้แก้ไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy' : '';
            if (c.flag) flagged++;
            byType[c.objType] = (byType[c.objType] || 0) + 1;
            byActor[c.actorName || '-'] = (byActor[c.actorName || '-'] || 0) + 1;
        });
        const top = o => Object.keys(o).map(k => ({ label: k, value: o[k] })).sort((a, b) => b.value - a.value);
        return { changes, total: changes.length, flagged, objects: Object.keys(changes.reduce((m, c) => (m[c.objType + '|' + c.objId] = 1, m), {})).length, byType: top(byType), byActor: top(byActor) };
    }

    function run(fromYmd, toYmd) {
        const notes = fetchSystemNotes(fromYmd, toYmd);
        const res = summarize(attachObjectNames(groupChanges(notes)), deployerSet());
        res.noteRows = notes.length;
        return res;
    }

    /** CSV สำหรับกระทบยอดใน Excel — 3 คอลัมน์ท้ายให้ IT / ผู้ review กรอก */
    function toCsv(fromYmd, toYmd, res) {
        const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
        const head = ['Changed At', 'Object Type', 'Object', 'Object ID', 'Changed By', 'Role', 'Context', 'Fields', 'Old → New (ตัวอย่าง)', 'Flag',
            'CR No.', 'คำอธิบาย (กรณีไม่มี CR)', 'ผู้ตรวจ / วันที่'];
        const lines = [
            ['Period', fromYmd + ' to ' + toYmd, 'Changes', res.total, 'Flagged', res.flagged].map(q).join(','),
            head.map(q).join(',')
        ];
        res.changes.forEach(c => lines.push([c.tsText, c.objType, c.objName, c.objId, c.actorName, c.roleName, c.context, c.fields.join(' '), c.details.join(' | '), c.flag, '', '', ''].map(q).join(',')));
        return '﻿' + lines.join('\r\n');
    }

    return {
        CFG, runAll, chunk, ids, parseTs, fmtTs, ymd,
        rectypes, configWarnings, employeesWithRoles, deployerSet,
        fetchSystemNotes, groupChanges, attachObjectNames, probeRecordTypes,
        summarize, run, toCsv,
        log: tbdllLog
    };
});
