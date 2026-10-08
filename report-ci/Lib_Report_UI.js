/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Report_UI — มาตรฐานหน้าตารายงาน/ฟอร์ม Suitelet ของ Teibto (Report CI)
 *
 * ธีมที่ใช้ได้ (เลือกแล้ว 08/10/2026):
 *   'tabler'  — Tabler (tabler/tabler) โทนกรม/น้ำเงิน การ์ดมีแถบสีด้านบน หัวตารางตัวพิมพ์ใหญ่
 *   'tremor'  — Tremor (tremorlabs/tremor) เน้นกราฟ ฟอนต์ Prompt
 *   'hybrid'  — Tabler × Tremor สีหลักเขียวน้ำทะเล
 *
 * วิธีใช้ใน Suitelet (แสดงผ่าน INLINEHTML ให้ยังอยู่ใต้เมนู NetSuite):
 *   const ui = UI.create({ theme: 'tremor', density: 'normal' });
 *   field.defaultValue = ui.render([
 *       ui.header({ crumb: 'Payables', title: 'AP Aging', meta: 'As of 30/09/2026', actions: [ui.button('Export', { href: csvUrl })] }),
 *       ui.kpis([{ label: 'ยอดคงค้าง', value: '1.46', unit: 'ลบ.', spark: [..], delta: '+1.5%', tone: 'flat' }]),
 *       ui.card({ title: 'รายละเอียด', body: ui.table({ columns, rows, groupBy: 'sub', total: true }) })
 *   ]);
 *
 * ทุกข้อความที่รับเข้ามาถูก escape ให้แล้ว ยกเว้นพารามิเตอร์ที่ชื่อ body/html (ส่ง HTML ที่ประกอบจาก lib นี้เท่านั้น)
 * CSS ทั้งหมดอยู่ใต้ .rui จึงไม่ชนกับ CSS ของ NetSuite
 */
define([], () => {

    // ---------- design tokens ----------
    const THEMES = {
        tabler: {
            font: "'DM Sans','IBM Plex Sans Thai',system-ui,sans-serif",
            bg: '#f6f8fb', surface: '#ffffff', surface2: '#f6f8fb', line: '#e6e8eb', lineStrong: '#c9d0d8',
            text: '#182433', muted: '#667382', faint: '#9aa6b4',
            primary: '#066fd1', onPrimary: '#ffffff', primarySoft: '#e6f1fa',
            neg: '#d63939', pos: '#2fb344', warn: '#f76707',
            buckets: ['#2fb344', '#74b816', '#f59f00', '#f76707', '#d63939'],
            radius: '6px', radiusSm: '4px', shadow: '0 2px 4px rgba(24,36,51,.04)',
            thBg: '#f6f8fb', thInk: '#667382', thSize: '.78em', thCase: 'uppercase', thTrack: '.04em',
            kpiStripe: true, kpiIcon: 'solid'
        },
        tremor: {
            font: "'Prompt',system-ui,sans-serif",
            bg: '#f9fafb', surface: '#ffffff', surface2: '#f3f4f6', line: '#e5e7eb', lineStrong: '#d1d5db',
            text: '#111827', muted: '#6b7280', faint: '#9ca3af',
            primary: '#3b82f6', onPrimary: '#ffffff', primarySoft: '#eff6ff',
            neg: '#e11d48', pos: '#059669', warn: '#d97706',
            buckets: ['#10b981', '#06b6d4', '#f59e0b', '#f97316', '#f43f5e'],
            radius: '8px', radiusSm: '6px', shadow: '0 1px 2px rgba(0,0,0,.05)',
            thBg: '#ffffff', thInk: '#374151', thSize: '.86em', thCase: 'none', thTrack: '0',
            kpiStripe: true, kpiIcon: 'none'
        },
        hybrid: {
            font: "'Outfit','Noto Sans Thai',system-ui,sans-serif",
            bg: '#f8fafc', surface: '#ffffff', surface2: '#f1f5f9', line: '#e2e8f0', lineStrong: '#cbd5e1',
            text: '#0f172a', muted: '#64748b', faint: '#94a3b8',
            primary: '#0e7490', onPrimary: '#ffffff', primarySoft: '#ecfeff',
            neg: '#e11d48', pos: '#059669', warn: '#d97706',
            buckets: ['#14b8a6', '#38bdf8', '#fbbf24', '#fb923c', '#f43f5e'],
            radius: '12px', radiusSm: '8px', shadow: '0 1px 3px rgba(15,23,42,.06)',
            thBg: '#f8fafc', thInk: '#475569', thSize: '.86em', thCase: 'none', thTrack: '0',
            kpiStripe: true, kpiIcon: 'round'
        }
    };

    const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700'
        + '&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Prompt:wght@300;400;500;600'
        + '&family=Outfit:wght@400;500;600;700&family=Noto+Sans+Thai:wght@400;500;600&display=swap';

    // ---------- helpers ----------
    const esc = v => String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const sum = a => a.reduce((x, y) => x + (Number(y) || 0), 0);

    /** 1234.5 → "1,234.50"; ติดลบ → "(1,234.50)"; 0 → "–" */
    function amount(n, opt) {
        const o = opt || {};
        const v = Number(n) || 0;
        if (v === 0 && !o.showZero) return '–';
        const d = o.decimals === undefined ? 2 : o.decimals;
        const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
        return v < 0 ? '(' + s + ')' : s;
    }
    const int = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

    const ICONS = {
        download: '<path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10"/>',
        mail: '<path d="M2 4l6 4 6-4M2 4h12v8H2z"/>',
        doc: '<path d="M3 2h7l3 3v9H3z"/><path d="M6 8h4M6 11h4"/>',
        warn: '<path d="M8 2l6.5 11.5h-13z"/><path d="M8 7v3M8 12h0"/>',
        clock: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/>',
        pause: '<circle cx="8" cy="8" r="6"/><path d="M6.5 6v4M9.5 6v4"/>',
        check: '<circle cx="8" cy="8" r="6"/><path d="M5.5 8l2 2 3-3.5"/>',
        error: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h0"/>',
        search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
        calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>',
        lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
        chevron: '<path d="M4 6l4 4 4-4"/>',
        upload: '<path d="M8 11V3m0 0L5 6m3-3l3 3M3 11v2h10v-2"/>'
    };
    const icon = name => '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

    // ---------- CSS ----------
    function css(t) {
        const b = t.buckets;
        return `
.rui{--font:${t.font};--bg:${t.bg};--surface:${t.surface};--surface-2:${t.surface2};--line:${t.line};--line-strong:${t.lineStrong};
--text:${t.text};--muted:${t.muted};--faint:${t.faint};--primary:${t.primary};--on-primary:${t.onPrimary};--primary-soft:${t.primarySoft};
--neg:${t.neg};--pos:${t.pos};--warn:${t.warn};--b0:${b[0]};--b1:${b[1]};--b2:${b[2]};--b3:${b[3]};--b4:${b[4]};
--radius:${t.radius};--radius-sm:${t.radiusSm};--shadow:${t.shadow};--th-bg:${t.thBg};--th-ink:${t.thInk};--th-size:${t.thSize};--th-case:${t.thCase};--th-track:${t.thTrack};
font-family:var(--font);color:var(--text);background:var(--bg);font-size:13.5px;line-height:1.45;padding:20px;border-radius:var(--radius);display:grid;gap:16px;width:100%;box-sizing:border-box}
.rui *,.rui *::before,.rui *::after{box-sizing:border-box}
.rui.compact{font-size:12.5px}
.rui svg{width:15px;height:15px;flex:none}
.rui a{color:var(--primary)}
.rui .ph{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.rui .ph .t{flex:1;min-width:240px}
.rui .crumb{font-size:.86em;color:var(--muted);margin-bottom:4px}
.rui .crumb b{color:var(--text);font-weight:500}
.rui h2.title{margin:0;font-size:1.7em;font-weight:600;letter-spacing:-.015em;color:var(--text)}
.rui .meta{margin-top:4px;color:var(--muted);font-size:.93em}
.rui .btn{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:var(--radius-sm);font:inherit;font-weight:600;font-size:.93em;border:1px solid var(--line-strong);background:var(--surface);color:var(--text);white-space:nowrap;box-shadow:var(--shadow);cursor:pointer;text-decoration:none;line-height:1.2}
.rui .btn.primary{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}
.rui .btn.ghost{border-color:transparent;background:transparent;box-shadow:none;color:var(--muted)}
.rui .btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.rui .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);min-width:0}
.rui .card-h{display:flex;align-items:center;gap:10px;padding:14px 16px 0}
.rui .card-h h3{margin:0;font-size:1.02em;font-weight:600}
.rui .card-h .sp{flex:1}
.rui .card-h small{color:var(--muted)}
.rui .card-b{padding:14px 16px 16px}
.rui .card-b.flush{padding:0}
.rui .grid{display:grid;gap:14px;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr))}
.rui .grid.wide-left{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)}
@media (max-width:960px){.rui .grid,.rui .grid.wide-left{grid-template-columns:1fr}}
/* filter bar */
.rui .fbar{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:14px 16px}
.rui .fbar .fld{flex:1 1 160px;max-width:260px}
.rui .fbar .actions{display:flex;gap:8px;margin-left:auto}
/* kpi */
.rui .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.rui .kpi{padding:16px;display:grid;gap:10px;position:relative;overflow:hidden}
${t.kpiStripe ? '.rui .kpi{border-top:3px solid var(--primary)}.rui .kpi.bad{border-top-color:var(--neg)}' : ''}
.rui .kpi .top{display:flex;align-items:center;gap:10px}
.rui .kpi .ic{width:34px;height:34px;border-radius:${t.kpiIcon === 'round' ? '50%' : 'var(--radius-sm)'};display:${t.kpiIcon === 'none' ? 'none' : 'grid'};place-items:center;
  background:${t.kpiIcon === 'solid' ? 'var(--primary)' : 'var(--primary-soft)'};color:${t.kpiIcon === 'solid' ? '#fff' : 'var(--primary)'}}
.rui .kpi.bad .ic{background:${t.kpiIcon === 'solid' ? 'var(--neg)' : 'color-mix(in srgb,var(--neg) 12%,transparent)'};color:${t.kpiIcon === 'solid' ? '#fff' : 'var(--neg)'}}
.rui .kpi .k{color:var(--muted);font-weight:500;font-size:.93em}
.rui .kpi .vrow{display:flex;align-items:flex-end;justify-content:space-between;gap:8px}
.rui .kpi .v{font-size:1.85em;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.rui .kpi .v small{font-size:.5em;font-weight:500;color:var(--muted);letter-spacing:0;margin-left:3px}
.rui .kpi .spark{width:96px;height:34px}
.rui .kpi .d{display:flex;align-items:center;gap:6px;font-size:.86em;color:var(--muted)}
.rui .delta{display:inline-flex;font-weight:600;padding:1px 6px;border-radius:999px;font-size:.95em}
.rui .delta.bad{color:var(--neg);background:color-mix(in srgb,var(--neg) 10%,transparent)}
.rui .delta.good{color:var(--pos);background:color-mix(in srgb,var(--pos) 10%,transparent)}
.rui .delta.flat{color:var(--muted);background:var(--surface-2)}
/* distribution + bar list */
.rui .stack{display:flex;height:14px;border-radius:${t.radius === '6px' ? '3px' : '999px'};overflow:hidden;gap:2px;background:var(--surface-2)}
.rui .stack span{display:block;height:100%}
.rui .legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:14px}
.rui .lg{display:grid;gap:2px;padding-left:10px;border-left:3px solid var(--c)}
.rui .lg .l{font-size:.84em;color:var(--muted)}
.rui .lg .a{font-weight:600;font-variant-numeric:tabular-nums}
.rui .lg .p{font-size:.8em;color:var(--faint)}
.rui .bars{display:grid;gap:10px}
.rui .bl .r{display:flex;justify-content:space-between;gap:8px;font-size:.9em;margin-bottom:4px}
.rui .bl .r span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rui .bl .r b{font-weight:600;font-variant-numeric:tabular-nums}
.rui .bl .track{height:8px;border-radius:999px;background:var(--surface-2);overflow:hidden}
.rui .bl .fill{height:100%;border-radius:inherit;background:var(--c,var(--b4))}
/* tabs + table */
.rui .tabs{display:flex;gap:4px;padding:6px 16px 0;border-bottom:1px solid var(--line);overflow-x:auto}
.rui .tab{all:unset;cursor:pointer;padding:10px 4px;margin-right:16px;color:var(--muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;display:inline-flex;gap:6px;align-items:center}
.rui .tab[aria-selected="true"]{color:var(--text);border-bottom-color:var(--primary)}
.rui .tab:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.rui .count{font-size:.78em;padding:1px 7px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-weight:500}
.rui .tbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;color:var(--muted);font-size:.9em}
.rui .tbar .sp{flex:1}
.rui .tbar input{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--radius-sm);padding:6px 10px;width:220px;max-width:100%}
.rui .scroll{overflow:auto;max-height:var(--table-h,520px);border-top:1px solid var(--line)}
.rui table.rt{border-collapse:separate;border-spacing:0;width:100%;font:inherit;color:inherit}
.rui table.rt th,.rui table.rt td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap;font:inherit;color:inherit;vertical-align:middle}
.rui.compact table.rt th,.rui.compact table.rt td{padding:6px 12px}
.rui table.rt th{position:sticky;top:0;z-index:1;background:var(--th-bg);color:var(--th-ink);font-weight:600;font-size:var(--th-size);text-transform:var(--th-case);letter-spacing:var(--th-track)}
.rui table.rt .n{text-align:right;font-variant-numeric:tabular-nums}
.rui table.rt td.neg{color:var(--neg)}
.rui table.rt td.zero{color:var(--faint)}
.rui table.rt td.heat{background:color-mix(in srgb,var(--c) var(--a),transparent)}
.rui table.rt td.heat.hot{color:var(--neg);font-weight:600}
.rui table.rt td.wrap{white-space:normal;min-width:220px}
.rui table.rt tbody tr:hover td{background-color:color-mix(in srgb,var(--primary) 5%,var(--surface))}
.rui table.rt tr.grp td{background:var(--surface-2);font-weight:600;font-size:.9em;color:var(--muted);padding-top:7px;padding-bottom:7px}
.rui table.rt tr.sub td{font-weight:600;border-bottom:1px solid var(--line-strong)}
.rui table.rt tfoot td{position:sticky;bottom:0;background:var(--surface-2);font-weight:700;border-top:1px solid var(--line-strong);border-bottom:0}
.rui .sub-t{display:block;color:var(--muted);font-size:.86em}
.rui .badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:${t.radius === '6px' ? '4px' : '999px'};font-size:.82em;font-weight:500;white-space:nowrap}
.rui .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.rui .b-neg{color:var(--neg);background:color-mix(in srgb,var(--neg) 10%,transparent)}
.rui .b-warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.rui .b-pos{color:var(--pos);background:color-mix(in srgb,var(--pos) 10%,transparent)}
.rui .b-info{color:var(--primary);background:var(--primary-soft)}
.rui .b-muted{color:var(--muted);background:var(--surface-2)}
.rui .foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center;padding:12px 16px;color:var(--muted);font-size:.9em}
.rui .empty{display:grid;justify-items:center;gap:8px;padding:48px 16px;text-align:center;color:var(--muted)}
.rui .empty b{color:var(--text);font-size:1.05em}
.rui .empty .eic{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:var(--surface-2)}
.rui .toast{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:var(--radius-sm);border:1px solid color-mix(in srgb,var(--c) 30%,transparent);background:color-mix(in srgb,var(--c) 6%,var(--surface));font-size:.92em}
.rui .toast svg{color:var(--c);margin-top:2px}
/* form */
.rui .steps{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rui .step{display:flex;align-items:center;gap:8px;color:var(--muted);font-weight:500;font-size:.93em}
.rui .step .dot{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--line-strong);font-size:.85em;font-weight:600;background:var(--surface)}
.rui .step.done .dot{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.rui .step.cur{color:var(--text)}
.rui .step.cur .dot{border-color:var(--primary);color:var(--primary);box-shadow:0 0 0 4px color-mix(in srgb,var(--primary) 14%,transparent)}
.rui .step-line{width:44px;height:2px;background:var(--line-strong)}
.rui .step-line.done{background:var(--primary)}
.rui .fsec{padding:18px}
.rui .fsec>header{display:grid;gap:2px;margin-bottom:16px}
.rui .fsec>header h3{margin:0;font-size:1.05em;font-weight:600}
.rui .fsec>header p{margin:0;color:var(--muted);font-size:.9em}
.rui .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}
.rui .fields .full{grid-column:1/-1}
@media (max-width:640px){.rui .fields{grid-template-columns:1fr}}
.rui .fld{display:grid;gap:6px;min-width:0}
.rui .fld>label{font-weight:500;font-size:.92em}
.rui .fld .req{color:var(--neg);margin-left:2px}
.rui .fld .help{font-size:.84em;color:var(--muted)}
.rui .fld .err{font-size:.84em;color:var(--neg)}
.rui .inp{display:flex;align-items:center;gap:8px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:var(--surface);padding:0 10px;min-height:38px;box-shadow:var(--shadow)}
.rui.compact .inp{min-height:32px}
.rui .inp:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 18%,transparent)}
.rui .inp.bad{border-color:var(--neg);box-shadow:0 0 0 3px color-mix(in srgb,var(--neg) 12%,transparent)}
.rui .inp.dis{background:var(--surface-2);color:var(--muted);box-shadow:none}
.rui .inp input,.rui .inp select,.rui .inp textarea{all:unset;flex:1;min-width:0;padding:8px 0;font:inherit;color:inherit;width:100%}
.rui .inp textarea{min-height:64px;white-space:pre-wrap}
.rui .inp svg{color:var(--faint)}
.rui .inp .ad{align-self:stretch;display:flex;align-items:center;margin-right:-10px;padding:0 10px;border-left:1px solid var(--line);background:var(--surface-2);color:var(--muted);border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.rui .swrow{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2)}
.rui .swrow .tx{flex:1;display:grid;gap:2px}
.rui .swrow .tx span{font-size:.86em;color:var(--muted)}
.rui .switch{position:relative;width:38px;height:22px;flex:none;margin-top:2px}
.rui .switch input{position:absolute;inset:0;opacity:0;cursor:pointer;margin:0;z-index:1}
.rui .switch i{position:absolute;inset:0;border-radius:999px;background:var(--line-strong)}
.rui .switch i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.rui .switch input:checked+i{background:var(--primary)}
.rui .switch input:checked+i::after{transform:translateX(16px)}
.rui .rcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.rui .rcard{display:grid;gap:2px;padding:12px 14px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);cursor:pointer;position:relative;background:var(--surface)}
.rui .rcard span{font-size:.86em;color:var(--muted)}
.rui .rcard input{position:absolute;opacity:0}
.rui .rcard:has(input:checked){border-color:var(--primary);background:color-mix(in srgb,var(--primary) 5%,var(--surface));box-shadow:0 0 0 1px var(--primary)}
.rui .actbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 16px;position:sticky;bottom:0;background:color-mix(in srgb,var(--surface) 94%,transparent);border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 -4px 16px rgba(0,0,0,.04);z-index:2}
.rui .actbar .sp{flex:1}
.rui .actbar .note{color:var(--muted);font-size:.88em}
.rui .kv{display:flex;justify-content:space-between;gap:10px;font-size:.93em;padding:3px 0}
.rui .kv span:first-child{color:var(--muted)}
.rui .kv b{font-weight:500;font-variant-numeric:tabular-nums}
.rui .net{display:grid;gap:2px;padding:14px;border-radius:var(--radius-sm);background:var(--primary-soft);margin-top:8px}
.rui .net span{color:var(--muted);font-size:.86em}
.rui .net b{font-size:1.7em;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.rui .switch i::after{transition:none}}
`;
    }

    // tabs + table quick search; รันฝั่ง browser
    const SCRIPT = `<script>(function(){
document.querySelectorAll('.rui [data-tabs]').forEach(function(box){
  box.addEventListener('click',function(e){var t=e.target.closest('.tab');if(!t)return;
    box.querySelectorAll('.tab').forEach(function(x){x.setAttribute('aria-selected',x===t)});
    var root=box.parentNode;root.querySelectorAll('[data-pane]').forEach(function(p){p.hidden=p.getAttribute('data-pane')!==t.getAttribute('data-tab')});});
});
document.querySelectorAll('.rui [data-filter-for]').forEach(function(inp){
  inp.addEventListener('input',function(){var q=inp.value.toLowerCase(),tb=document.getElementById(inp.getAttribute('data-filter-for'));
    if(!tb)return;tb.querySelectorAll('tbody tr:not(.grp):not(.sub)').forEach(function(r){r.hidden=q&&r.textContent.toLowerCase().indexOf(q)<0;});});
});
})();</script>`;

    // ---------- factory ----------
    function create(opts) {
        const o = opts || {};
        const themeName = THEMES[o.theme] ? o.theme : 'tremor';
        const t = THEMES[themeName];
        let uid = 0;
        const nextId = p => (p || 'rui') + '_' + (++uid);

        const ui = {
            theme: themeName, tokens: t, esc, amount, int, icon,

            /** ห่อทุกส่วนเป็นหน้าเดียว: fonts + CSS + เนื้อหา + script */
            render(parts) {
                return '<link rel="stylesheet" href="' + FONTS + '"><style>' + css(t).replace(/\.rui(?=[\s.{:*,])/g, '.rui[data-skin="' + themeName + '"]') + '</style>'
                    + '<div class="rui' + (o.density === 'compact' ? ' compact' : '') + '" data-skin="' + themeName + '">'
                    + [].concat(parts).filter(Boolean).join('') + '</div>' + SCRIPT;
            },

            /** หัวหน้า: { crumb, title, meta, actions: [html], steps: html } */
            header(h) {
                return '<div class="ph"><div class="t">'
                    + (h.crumb ? '<div class="crumb">' + esc(h.crumb) + (h.crumbCurrent ? ' / <b>' + esc(h.crumbCurrent) + '</b>' : '') + '</div>' : '')
                    + '<h2 class="title">' + esc(h.title) + '</h2>'
                    + (h.meta ? '<div class="meta">' + esc(h.meta) + '</div>' : '')
                    + '</div>' + (h.steps || '') + (h.actions || []).join('') + '</div>';
            },

            /** ปุ่ม: ui.button('Export', { href, icon: 'download', kind: 'primary'|'ghost', type: 'submit', id }) */
            button(label, b) {
                const x = b || {};
                const cls = 'btn' + (x.kind ? ' ' + x.kind : '');
                const ic = x.icon ? icon(x.icon) : '';
                if (x.href) return '<a class="' + cls + '" href="' + esc(x.href) + '"' + (x.target ? ' target="' + esc(x.target) + '"' : '') + '>' + ic + esc(label) + '</a>';
                return '<button class="' + cls + '" type="' + (x.type || 'button') + '"' + (x.id ? ' id="' + esc(x.id) + '"' : '') + (x.onclick ? ' onclick="' + esc(x.onclick) + '"' : '') + '>' + ic + esc(label) + '</button>';
            },

            /** การ์ดทั่วไป: { title, aside, body(html), flush } */
            card(c) {
                return '<section class="card">'
                    + (c.title ? '<div class="card-h"><h3>' + esc(c.title) + '</h3><span class="sp"></span>' + (c.aside ? '<small>' + esc(c.aside) + '</small>' : '') + '</div>' : '')
                    + '<div class="card-b' + (c.flush ? ' flush' : '') + '">' + (c.body || '') + '</div></section>';
            },

            /** เรียงการ์ดเป็นคอลัมน์: ui.grid([a, b], { layout: 'wide-left' | cols: 3 }) */
            grid(items, g) {
                const x = g || {};
                return '<div class="grid' + (x.layout ? ' ' + x.layout : '') + '"' + (x.cols ? ' style="--cols:' + Number(x.cols) + '"' : '') + '>' + items.join('') + '</div>';
            },

            /**
             * แถบ filter เป็น HTML form แบบ GET กลับมาที่ Suitelet เดิม
             * { action, hidden: {script, deploy}, fields: [ui.field(...)], submitLabel }
             */
            filterBar(f) {
                const hidden = Object.keys(f.hidden || {}).map(k => '<input type="hidden" name="' + esc(k) + '" value="' + esc(f.hidden[k]) + '">').join('');
                return '<form class="card fbar" method="GET" action="' + esc(f.action || '') + '">' + hidden + f.fields.join('')
                    + '<div class="actions">' + (f.resetHref ? ui.button('ล้าง', { href: f.resetHref, kind: 'ghost' }) : '')
                    + ui.button(f.submitLabel || 'แสดงรายงาน', { kind: 'primary', type: 'submit' }) + '</div></form>';
            },

            /**
             * ช่องกรอก: { id, name, label, type: text|date|number|select|textarea, value, options: [{value,text}],
             *            required, help, error, locked, suffix, placeholder, full, icon }
             */
            field(fd) {
                const id = esc(fd.id || nextId('f'));
                const name = esc(fd.name || fd.id || '');
                const dis = fd.locked ? ' disabled' : '';
                const ph = fd.placeholder ? ' placeholder="' + esc(fd.placeholder) + '"' : '';
                let ctrl;
                if (fd.type === 'select') {
                    ctrl = '<select id="' + id + '" name="' + name + '"' + dis + '>' + (fd.options || []).map(op =>
                        '<option value="' + esc(op.value) + '"' + (String(op.value) === String(fd.value) ? ' selected' : '') + '>' + esc(op.text) + '</option>').join('') + '</select>' + icon(fd.locked ? 'lock' : 'chevron');
                } else if (fd.type === 'textarea') {
                    ctrl = '<textarea id="' + id + '" name="' + name + '"' + ph + dis + '>' + esc(fd.value) + '</textarea>';
                } else {
                    const ic = fd.icon || (fd.type === 'date' ? 'calendar' : '');
                    ctrl = (ic ? icon(ic) : '') + '<input id="' + id + '" name="' + name + '" type="' + (fd.type === 'number' ? 'text" inputmode="decimal' : 'text') + '" value="' + esc(fd.value) + '"' + ph + dis
                        + (fd.type === 'number' ? ' style="text-align:right"' : '') + '>' + (fd.locked && !ic ? icon('lock') : '');
                }
                const inpCls = 'inp' + (fd.error ? ' bad' : '') + (fd.locked ? ' dis' : '');
                return '<div class="fld' + (fd.full ? ' full' : '') + '"><label for="' + id + '">' + esc(fd.label) + (fd.required ? '<span class="req">*</span>' : '') + '</label>'
                    + '<div class="' + inpCls + '">' + ctrl + (fd.suffix ? '<span class="ad">' + esc(fd.suffix) + '</span>' : '') + '</div>'
                    + (fd.error ? '<span class="err">' + esc(fd.error) + '</span>' : fd.help ? '<span class="help">' + esc(fd.help) + '</span>' : '') + '</div>';
            },

            /** ส่วนของฟอร์ม: { title, desc, fields: [ui.field()], body } */
            formSection(s) {
                return '<section class="card fsec"><header><h3>' + esc(s.title) + '</h3>' + (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') + '</header>'
                    + (s.fields ? '<div class="fields">' + s.fields.join('') + '</div>' : '') + (s.body || '') + '</section>';
            },

            /** สวิตช์: { id, name, label, desc, checked } */
            toggle(s) {
                const id = esc(s.id || nextId('sw'));
                return '<div class="swrow"><span class="switch"><input type="checkbox" id="' + id + '" name="' + esc(s.name || s.id || '') + '"' + (s.checked ? ' checked' : '')
                    + ' aria-label="' + esc(s.label) + '"><i></i></span><span class="tx"><b>' + esc(s.label) + '</b>' + (s.desc ? '<span>' + esc(s.desc) + '</span>' : '') + '</span></div>';
            },

            /** ตัวเลือกแบบการ์ด: { name, value, options: [{value, title, desc}] } */
            radioCards(r) {
                return '<div class="rcards" role="radiogroup">' + r.options.map(op =>
                    '<label class="rcard"><input type="radio" name="' + esc(r.name) + '" value="' + esc(op.value) + '"' + (String(op.value) === String(r.value) ? ' checked' : '') + '><b>' + esc(op.title) + '</b>'
                    + (op.desc ? '<span>' + esc(op.desc) + '</span>' : '') + '</label>').join('') + '</div>';
            },

            /** แถบขั้นตอน: ui.steps(['เลือก IR','ตรวจรายการ','ยืนยัน'], 1)  (current = index เริ่ม 0) */
            steps(labels, current) {
                return '<div class="steps">' + labels.map((l, i) => {
                    const st = i < current ? 'done' : i === current ? 'cur' : '';
                    return (i ? '<span class="step-line' + (i <= current ? ' done' : '') + '"></span>' : '')
                        + '<span class="step ' + st + '"><span class="dot">' + (i + 1) + '</span>' + esc(l) + '</span>';
                }).join('') + '</div>';
            },

            /** แถบปุ่มติดล่าง: { note, buttons: [html] } */
            actionBar(a) {
                return '<div class="actbar">' + (a.note ? '<span class="note">' + esc(a.note) + '</span>' : '') + '<span class="sp"></span>' + a.buttons.join('') + '</div>';
            },

            /** แถวสรุปยอด: [{label, value, neg}] + net: {label, value} */
            summary(rows, net) {
                return rows.map(r => '<div class="kv"><span>' + esc(r.label) + '</span><b' + (r.neg ? ' style="color:var(--neg)"' : '') + '>' + esc(r.value) + '</b></div>').join('')
                    + (net ? '<div class="net"><span>' + esc(net.label) + '</span><b>' + esc(net.value) + '</b></div>' : '');
            },

            /**
             * การ์ดตัวเลข: [{ label, value, unit, icon, spark: [n..], delta, deltaTone: good|bad|flat, note, bad }]
             */
            kpis(items) {
                return '<div class="kpis">' + items.map(k =>
                    '<div class="card kpi' + (k.bad ? ' bad' : '') + '"><div class="top"><span class="ic">' + icon(k.icon || (k.bad ? 'warn' : 'doc')) + '</span><span class="k">' + esc(k.label) + '</span></div>'
                    + '<div class="vrow"><span class="v">' + esc(k.value) + (k.unit ? '<small>' + esc(k.unit) + '</small>' : '') + '</span>' + (k.spark ? spark(k.spark, k.bad) : '') + '</div>'
                    + ((k.delta || k.note) ? '<div class="d">' + (k.delta ? '<span class="delta ' + (k.deltaTone || 'flat') + '">' + esc(k.delta) + '</span>' : '') + esc(k.note || '') + '</div>' : '')
                    + '</div>').join('') + '</div>';
            },

            /** แถบสัดส่วนตามช่วงอายุ: [{label, amount}] สีไล่จาก --b0 ถึง --b4 */
            distribution(buckets) {
                const pos = buckets.map(b => Math.max(0, Number(b.amount) || 0));
                const tot = sum(pos) || 1;
                return '<div class="stack">' + pos.map((a, i) => '<span style="width:' + (a / tot * 100).toFixed(2) + '%;background:var(--b' + Math.min(i, 4) + ')" title="' + esc(buckets[i].label) + '"></span>').join('') + '</div>'
                    + '<div class="legend">' + buckets.map((b, i) => '<div class="lg" style="--c:var(--b' + Math.min(i, 4) + ')"><span class="l">' + esc(b.label) + '</span><span class="a">' + int(b.amount) + '</span><span class="p">'
                        + (pos[i] / tot * 100).toFixed(1) + '%</span></div>').join('') + '</div>';
            },

            /** รายการแท่ง: [{label, value}], { color: 'var(--b4)' } */
            barList(items, b) {
                const mx = Math.max.apply(null, items.map(i => Number(i.value) || 0)) || 1;
                return '<div class="bars">' + items.map(i => '<div class="bl"><div class="r"><span>' + esc(i.label) + '</span><b>' + int(i.value) + '</b></div>'
                    + '<div class="track"><div class="fill" style="width:' + ((Number(i.value) || 0) / mx * 100).toFixed(1) + '%' + (b && b.color ? ';--c:' + esc(b.color) : '') + '"></div></div></div>').join('') + '</div>';
            },

            /**
             * ตาราง
             * columns: [{ key, label, type: text|amount|int|date|badge|wrap, sub: key (บรรทัดรองสีเทา), heat: 0-4, total: true, link: row => url }]
             * rows: [{...}]   groupBy: key   subtotal: true   total: true|'label'   search: true   emptyText
             */
            table(tb) {
                const cols = tb.columns, rows = tb.rows || [];
                const id = esc(tb.id || nextId('tbl'));
                if (!rows.length) return ui.empty(tb.emptyTitle || 'ไม่พบข้อมูล', tb.emptyText || 'ลองเปลี่ยนตัวกรองแล้วแสดงรายงานอีกครั้ง');
                const numeric = c => c.type === 'amount' || c.type === 'int';
                const maxHeat = Math.max.apply(null, rows.flatMap(r => cols.filter(c => c.heat !== undefined).map(c => Number(r[c.key]) || 0)).concat([1]));
                const cell = (c, r) => {
                    const v = r[c.key];
                    if (c.type === 'amount' || c.type === 'int') {
                        const n = Number(v) || 0;
                        let cls = 'n' + (n < 0 ? ' neg' : '') + (n === 0 ? ' zero' : ''), st = '';
                        if (c.heat !== undefined && n > 0 && tb.heat !== false) {
                            cls += ' heat' + (c.heat >= 4 ? ' hot' : '');
                            st = ' style="--c:var(--b' + c.heat + ');--a:' + Math.round(6 + 26 * Math.sqrt(n / maxHeat)) + '%"';
                        }
                        return '<td class="' + cls + '"' + st + '>' + (c.type === 'int' ? (n ? int(n) : '–') : amount(n)) + '</td>';
                    }
                    if (c.type === 'badge') return '<td>' + (v ? ui.badge(v.text || v, v.tone) : '') + '</td>';
                    let inner = esc(v);
                    if (c.link) { const href = c.link(r); if (href) inner = '<a href="' + esc(href) + '" target="_blank">' + inner + '</a>'; }
                    if (c.sub) inner += '<span class="sub-t">' + esc(r[c.sub]) + '</span>';
                    return '<td class="' + (c.type === 'date' ? 'n' : '') + (c.type === 'wrap' || c.sub ? ' wrap' : '') + '">' + inner + '</td>';
                };
                const totals = rs => cols.map(c => (c.total && numeric(c)) ? sum(rs.map(r => r[c.key])) : null);
                const totalRow = (cls, label, tot) => {
                    const first = cols.findIndex(c => c.total);
                    const span = first < 0 ? cols.length : first;
                    return '<tr class="' + cls + '"><td colspan="' + span + '">' + esc(label) + '</td>' + cols.slice(span).map((c, i) => {
                        const v = tot[span + i];
                        return v === null ? '<td></td>' : '<td class="n' + (v < 0 ? ' neg' : '') + '">' + (c.type === 'int' ? int(v) : amount(v)) + '</td>';
                    }).join('') + '</tr>';
                };
                let body = '';
                if (tb.groupBy) {
                    const groups = [];
                    rows.forEach(r => { const g = r[tb.groupBy]; let x = groups.find(y => y.k === g); if (!x) groups.push(x = { k: g, rows: [] }); x.rows.push(r); });
                    groups.forEach(g => {
                        body += '<tr class="grp"><td colspan="' + cols.length + '">' + esc(g.k) + ' · ' + g.rows.length + ' รายการ</td></tr>';
                        body += g.rows.map(r => '<tr>' + cols.map(c => cell(c, r)).join('') + '</tr>').join('');
                        if (tb.subtotal) body += totalRow('sub', 'รวม ' + g.k, totals(g.rows));
                    });
                } else {
                    body = rows.map(r => '<tr>' + cols.map(c => cell(c, r)).join('') + '</tr>').join('');
                }
                const foot = tb.total ? '<tfoot>' + totalRow('', typeof tb.total === 'string' ? tb.total : 'รวมทั้งหมด', totals(rows)).replace('<tr class="">', '<tr>') + '</tfoot>' : '';
                const bar = (tb.note || tb.search !== false) ? '<div class="tbar"><span>' + esc(tb.note || rows.length + ' รายการ') + '</span><span class="sp"></span>'
                    + (tb.search !== false ? '<input type="search" placeholder="ค้นหาในตาราง" aria-label="ค้นหาในตาราง" data-filter-for="' + id + '">' : '') + '</div>' : '';
                return bar + '<div class="scroll"><table class="rt" id="' + id + '"><thead><tr>' + cols.map(c => '<th' + (numeric(c) || c.type === 'date' ? ' class="n"' : '') + '>' + esc(c.label) + '</th>').join('')
                    + '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table></div>';
            },

            /** แท็บ: [{ id, label, count, body }] — สลับฝั่ง browser ไม่ต้องโหลดใหม่ */
            tabs(list) {
                return '<section class="card"><div class="tabs" role="tablist" data-tabs>' + list.map((x, i) =>
                    '<button class="tab" type="button" role="tab" data-tab="' + esc(x.id) + '" aria-selected="' + (i === 0) + '">' + esc(x.label)
                    + (x.count !== undefined ? ' <span class="count">' + esc(x.count) + '</span>' : '') + '</button>').join('') + '</div>'
                    + list.map((x, i) => '<div data-pane="' + esc(x.id) + '"' + (i ? ' hidden' : '') + '>' + x.body + '</div>').join('') + '</section>';
            },

            /** ป้ายสถานะ: tone = pos | neg | warn | info | muted */
            badge(text, tone) { return '<span class="badge b-' + esc(tone || 'muted') + '">' + esc(text) + '</span>'; },

            empty(title, text) {
                return '<div class="empty"><span class="eic">' + icon('search') + '</span><b>' + esc(title) + '</b><span>' + esc(text || '') + '</span></div>';
            },

            /** ข้อความแจ้ง: tone = neg | pos | warn | info */
            alert(text, tone) {
                const c = { neg: 'var(--neg)', pos: 'var(--pos)', warn: 'var(--warn)', info: 'var(--primary)' }[tone || 'info'];
                return '<div class="toast" style="--c:' + c + '">' + icon(tone === 'pos' ? 'check' : 'error') + '<span>' + esc(text) + '</span></div>';
            }
        };
        return ui;
    }

    function spark(vals, bad) {
        if (!vals || vals.length < 2) return '';
        const w = 96, h = 34, p = 3, mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
        const pts = vals.map((v, i) => [p + i * (w - 2 * p) / (vals.length - 1), h - p - (v - mn) / ((mx - mn) || 1) * (h - 2 * p)]);
        const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
        const c = bad ? 'var(--neg)' : 'var(--primary)', last = pts[pts.length - 1];
        return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + ' L' + last[0].toFixed(1) + ' ' + h + ' L' + p + ' ' + h + 'Z" fill="color-mix(in srgb, ' + c + ' 14%, transparent)"/>'
            + '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.6" stroke-linejoin="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6" fill="' + c + '"/></svg>';
    }

    return { create, THEMES, esc, amount, int };
});
