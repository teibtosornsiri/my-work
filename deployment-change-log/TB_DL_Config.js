/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * TB_DL_Config — ค่าตั้งต่อบัญชีของชุด Deployment Change Log
 * แก้ไฟล์นี้ไฟล์เดียวต่อบัญชี (SB กับ PROD ใช้ค่าคนละชุด เพราะ internal ID ไม่ตรงกัน)
 * ค่าที่เป็น null / [] = ยังไม่ได้ตั้ง → รายงานจะแจ้งเตือนด้านบน
 */
define([], () => ({

    /** หลัง deploy กี่ชั่วโมงที่การแก้ object เดียวกันยังนับว่าอยู่ใน CR เดียวกัน */
    WINDOW_HOURS: 24,

    /**
     * ประเภท object → recordtypeid ใน SuiteQL `systemnote`
     * ยังไม่รู้ค่า: เปิดรายงานด้วย &view=probe แล้วแก้ไฟล์จริงสักตัวในช่วงวันที่เลือก จะเห็น recordtypeid ที่โผล่
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

    /** ผู้มีสิทธิ์ deploy ขึ้น PROD: role id (ดึงคนที่ถือ role) และ/หรือ employee id โดยตรง */
    DEPLOYER_ROLE_IDS: [],
    DEPLOYER_EMPLOYEE_IDS: [],

    /** role ที่ถือว่าเป็นสิทธิ์สูง แสดงรายชื่อคนถือในรายงานให้ผู้ sign-off ทบทวน (3 = Administrator) */
    PRIVILEGED_ROLE_IDS: [3],

    /** ผู้ review/sign-off รายงานรายเดือน (employee id) — ได้อีเมลจาก scheduled script และกด sign-off ได้ */
    REVIEWER_EMPLOYEE_IDS: [],

    /** ผู้ส่งอีเมล (employee id) และโฟลเดอร์ File Cabinet ที่เก็บ snapshot รายเดือน */
    EMAIL_AUTHOR_ID: null,
    SNAPSHOT_FOLDER_ID: null,

    /** ตรวจ SHA-1 ไฟล์ได้สูงสุดกี่ไฟล์ต่อการเปิดรายงาน (file.load = 10 unit ต่อไฟล์) */
    HASH_MAX_FILES_SUITELET: 40,
    HASH_MAX_FILES_SCHEDULED: 400,

    /** ธีม Report CI: tremor | tabler | hybrid | ocean */
    THEME: 'tremor',

    /** script id / deployment id ของ Suitelet — ต้องตั้งตอนสร้าง script record ให้ตรงกับนี้ */
    SL_ACTION: { scriptId: 'customscript_tbdl_sl_action', deploymentId: 'customdeploy_tbdl_sl_action' },
    SL_RECON: { scriptId: 'customscript_tbdl_sl_recon', deploymentId: 'customdeploy_tbdl_sl_recon' },

    /** prefix ของ log ทุกตัว ใช้ query scriptnote ได้ง่าย */
    LOG_PREFIX: 'TBDL'
}));
