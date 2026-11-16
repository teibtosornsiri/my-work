/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * TB_DLL_Config — ค่าตั้งต่อบัญชีของ Deployment Change Log (Lite)
 * Lite ไม่มี custom record: CR และการอนุมัติเก็บนอก NetSuite แล้วกระทบยอดใน Excel ที่ export จากรายงาน
 * SB กับ PROD ใช้ค่าคนละชุด (internal id ไม่ตรงกัน)
 */
define([], () => ({

    /**
     * ประเภท object → recordtypeid ใน SuiteQL `systemnote`
     * ยังไม่รู้ค่า: เปิดรายงานด้วย &view=probe (ดู README)
     * ใส่เป็นตัวเลขหรือ array ก็ได้ เช่น 'Script': [-417, -418]
     */
    RECTYPE_MAP: {
        'Script': null,
        'Script Deployment': null,
        'File': null,
        'Custom Field': null,
        'Custom Record Type': null,
        'Workflow': null,
        'Role': null,
        'Saved Search': null,
        'Form': null,
        'Template': null
    },

    /** ผู้มีสิทธิ์ deploy ขึ้น PROD — คนอื่นแก้ = ติดธง */
    DEPLOYER_ROLE_IDS: [],
    DEPLOYER_EMPLOYEE_IDS: [],

    /** role สิทธิ์สูงที่แสดงรายชื่อคนถือให้ผู้ review ทบทวน (3 = Administrator) */
    PRIVILEGED_ROLE_IDS: [3],

    /** context ของ System Note ที่ไม่นับ (เช่น การแก้โดย script ของระบบเอง) — ว่าง = นับทั้งหมด */
    EXCLUDE_CONTEXTS: [],

    /** อีเมลรายเดือน: ผู้รับ (employee id), ผู้ส่ง (employee id), โฟลเดอร์เก็บไฟล์ */
    REVIEWER_EMPLOYEE_IDS: [],
    EMAIL_AUTHOR_ID: null,
    SNAPSHOT_FOLDER_ID: null,

    THEME: 'tremor',

    /** ต้องตรงกับ Script ID / Deployment ID ที่สร้างจริง (ใช้ทำลิงก์ในอีเมล) */
    SL_REPORT: { scriptId: 'customscript_tbdll_sl_report', deploymentId: 'customdeploy_tbdll_sl_report' },

    LOG_PREFIX: 'TBDLL'
}));
