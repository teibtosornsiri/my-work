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
     *   ตัวเลข หรือ array        เช่น 'Script': [-417]
     *   { rt: null, fieldPrefix } สำหรับประเภทที่ recordtypeid เป็น null เช่น File = { rt: null, fieldPrefix: 'MEDIAITEM.' }
     *   false                    = ตั้งใจไม่ติดตามประเภทนี้ (ไม่ขึ้นคำเตือน)
     *   null                     = ยังไม่ได้หาค่า (ขึ้นคำเตือน)
     * ค่าที่พบจริงในบัญชีหนึ่ง (11/2026): Script (Suitelet) -417 · Script Deployment -418 · File null + MEDIAITEM.
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

    /**
     * ติดธงแดงเมื่อผู้แก้ไม่อยู่ในรายชื่อผู้มีสิทธิ์ deploy
     * false = ยังไม่ได้วางเรื่อง role — ทุกคนที่แก้ได้ถือว่าปกติ (ธงเขียว) และไม่ขึ้นคำเตือน
     */
    FLAG_UNAUTHORIZED: false,

    /** ผู้มีสิทธิ์ deploy ขึ้น PROD — ใช้เมื่อ FLAG_UNAUTHORIZED = true */
    DEPLOYER_ROLE_IDS: [],
    DEPLOYER_EMPLOYEE_IDS: [],

    /** role สิทธิ์สูงที่แสดงรายชื่อคนถือให้ผู้ review ทบทวน (3 = Administrator) */
    PRIVILEGED_ROLE_IDS: [3],

    /**
     * ขอบเขตของ File ที่นับ
     *   'suitescripts' = เฉพาะไฟล์ใต้โฟลเดอร์ SuiteScripts (รวม lib, HTML/template ที่ script ใช้) — แนะนำ
     *   'scriptfile'   = เฉพาะไฟล์ที่เป็น Script File ของ Script record (แคบสุด ไม่รวม lib)
     *   'all'          = ทุกไฟล์ใน File Cabinet
     */
    FILE_SCOPE: 'suitescripts',

    /**
     * นับเฉพาะไฟล์โปรแกรม (ดูจากนามสกุล) — .doc รูป .pdf .csv ไม่นับ
     * .json ไม่ใส่เป็นค่าเริ่มต้น เพราะ script มักเขียนไฟล์ข้อมูล .json ลง SuiteScripts เอง · [] = นับทุกนามสกุล
     */
    CODE_FILE_EXTENSIONS: ['js', 'html', 'htm', 'xml', 'css', 'scss', 'ftl', 'ts'],

    /** internal id ของโฟลเดอร์ SuiteScripts (มาตรฐาน NetSuite = -15) */
    SUITESCRIPTS_FOLDER_ID: -15,

    /** context ของ System Note ที่ไม่นับ (เช่น การแก้โดย script ของระบบเอง) — ว่าง = นับทั้งหมด */
    EXCLUDE_CONTEXTS: [],

    /** อีเมลรายเดือน: ผู้รับ (employee id), ผู้ส่ง (employee id), โฟลเดอร์เก็บไฟล์ */
    REVIEWER_EMPLOYEE_IDS: [],
    EMAIL_AUTHOR_ID: null,
    SNAPSHOT_FOLDER_ID: null,

    /** เขตเวลาของผู้ใช้ ใช้คำนวณ "วันนี้" (server NetSuite อยู่ฝั่งอเมริกา) · ไทย = 7 · null = ใช้เวลา server */
    TIMEZONE_OFFSET_HOURS: 7,

    THEME: 'tremor',

    /** ต้องตรงกับ Script ID / Deployment ID ที่สร้างจริง (ใช้ทำลิงก์ในอีเมล) */
    SL_REPORT: { scriptId: 'customscript_tbdll_sl_report', deploymentId: 'customdeploy_tbdll_sl_report' },

    LOG_PREFIX: 'TBDLL'
}));
