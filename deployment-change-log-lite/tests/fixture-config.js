/**
 * fixture-config.js — Config สำหรับรันเทสต์ใน node (ค่าแบบบัญชีจริงที่ probe ได้)
 * ไม่ใช้ใน NetSuite · เทสต์อิงค่าชุดนี้เพื่อให้ query/แปลงประเภททำงานครบเส้น
 */
define([], () => ({
    RECTYPE_MAP: {
        'Script': [-417],
        'Script Deployment': [-418],
        'File': { rt: null, fieldPrefix: 'MEDIAITEM.' },
        'Custom Field': false,
        'Custom Record Type': false,
        'Workflow': false,
        'Role': false,
        'Saved Search': false,
        'Form': false,
        'Template': false
    },
    FLAG_UNAUTHORIZED: false,
    DEPLOYER_ROLE_IDS: [3],
    DEPLOYER_EMPLOYEE_IDS: [],
    PRIVILEGED_ROLE_IDS: [3],
    FILE_SCOPE: 'suitescripts',
    CODE_FILE_EXTENSIONS: ['js', 'html', 'htm', 'xml', 'css', 'scss', 'ftl', 'ts'],
    SUITESCRIPTS_FOLDER_ID: -15,
    LOAD_CONCURRENCY: 3,
    RECORD_TYPE_NAMES: {
        'AMS_LEASERECOGNIZE': 'AMS Lease Recognize',
        'AMS_WRITEOFF': 'AMS Write-Off'
    },
    EXCLUDE_CONTEXTS: [],
    REVIEWER_EMPLOYEE_IDS: [],
    EMAIL_AUTHOR_ID: null,
    SNAPSHOT_FOLDER_ID: null,
    TIMEZONE_OFFSET_HOURS: 7,
    THEME: 'tremor',
    SL_REPORT: { scriptId: 'customscript_tbdll_sl_report', deploymentId: 'customdeploy_tbdll_sl_report' },
    LOG_PREFIX: 'TBDLL'
}));
