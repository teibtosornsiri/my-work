# -*- coding: utf-8 -*-
"""
สร้าง User Guide (.docx) ตาม template มาตรฐาน Teibto จากไฟล์ Markdown + config

    python build_userguide.py guide.md --config customer.json -o "FS - User Guide_<ชื่อ>.docx"

ไฟล์ที่ได้มีครบตาม layout มาตรฐาน: ปก (โลโก้ + ชื่อเรื่อง) · Project Information ·
Document Version History · สารบัญอัตโนมัติ (script bake เลขหน้าให้ถ้ามี MS Word) ·
header โลโก้ทุกหน้า · footer ชื่อเอกสาร + เลขหน้า · ตาราง Fields/Description หัวส้ม

Markdown ที่รองรับ (subset):
    # หัวข้อใหญ่           -> Heading 1 (ขึ้นรายการสารบัญ; มี icon ได้ผ่าน config.chapter_icons)
    ## หัวข้อรอง            -> Heading 2
    ## ขั้นที่ N ...          -> Heading 2 พร้อม badge วงกลมเลขสีเขียวหน้าข้อความ
    ### หัวข้อย่อย           -> Heading 3
    ย่อหน้าปกติ (**ตัวหนา**, `code`, [btn:ชื่อปุ่ม], [pill:ชื่อป้าย] ได้)
    - รายการ               -> bullet list
    1. รายการ              -> numbered list (คงเลขที่พิมพ์)
    ![คำอธิบาย](path.png)   -> รูปกลางหน้า กว้าง 6.3 นิ้ว + caption "ภาพที่ n: คำอธิบาย"
    | หัว | ตาราง |          -> ตารางหัวส้ม + zebra stripe (cell รองรับ inline token ทั้งหมด)
    > หมายเหตุ: ข้อความ      -> กล่อง note ฟ้า (icon i)
    > ข้อควรระวัง: ข้อความ   -> กล่องเตือนเหลือง (icon !)   (คำว่า "คำเตือน:" ก็ได้)
    > ทริค: ข้อความ          -> กล่องเขียว (icon ✓)         (คำว่า "เคล็ดลับ:" ก็ได้)

inline token:
    `code`          -> ตัวอักษร Consolas พื้นเทาอ่อน (ตัด backtick ออก)
    [btn:Load]      -> ป้ายปุ่ม: ตัวหนา พื้นเทา ขอบมน (ให้ผู้อ่านรู้ว่าเป็นปุ่มบนจอ)
    [pill:ครบ]      -> รูปป้ายสถานะจาก assets/pill-<ชื่อ>.png (ข้างไฟล์ .md; เว้นวรรค -> _)

config JSON (เพิ่มจากเดิม):
    "customer_logo": "logo.jpg",       # (ไม่บังคับ) โลโก้มุมขวา header; ไม่ใส่ = ช่องว่างขาว (ไม่มีกล่อง placeholder)
    "cover_image":   "cover-hero.png", # (ไม่บังคับ) รูปแถบกลางปก แทนภาพ stock ของ template
    "chapter_icons": { "ภาพรวมระบบ": "assets/ic-overview.png", ... }  # (ไม่บังคับ) icon หน้า Heading 1
"""
import argparse, copy, io, json, os, re, sys, zipfile
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TPL = os.path.join(HERE, '..', 'templates', 'TEIBTO-USERGUIDE.template.docx')
ASSETS = os.path.join(HERE, '..', 'assets', 'docx')   # badge-N.png / note-*.png (shared)
IMG_W = Inches(6.3)
MAX_IMG_H_IN = 3.8   # เพดานความสูงรูป (นิ้ว) — กันรูปแนวตั้ง/จัตุรัสกินเต็มหน้า (override ผ่าน config: max_image_height_in)
HDR_FILL = '1F4E79'   # หัวตารางน้ำเงินเข้ม ตัวอักษรขาว (เปลี่ยนจากส้ม 12/07/2026)
ZEBRA_FILL = 'F5F7FA'
LOGO_PART = 'word/media/image83.jpg'    # โลโก้ลูกค้า (มุมขวาของ header ทุกหน้า)
COVER_PART = 'word/media/image62.jpg'   # ภาพแถบกลางหน้าปก

NOTE_TYPES = {   # คำขึ้นต้น -> (fill, accent, icon)
    'หมายเหตุ':    ('EAF3FF', '2F6FE3', 'note-info.png'),
    'ข้อควรระวัง': ('FBF0E0', 'B45309', 'note-warn.png'),
    'คำเตือน':     ('FBF0E0', 'B45309', 'note-warn.png'),
    'ทริค':        ('E7F4EC', '1E8E5A', 'note-tip.png'),
    'เคล็ดลับ':    ('E7F4EC', '1E8E5A', 'note-tip.png'),
}


def parse_args():
    ap = argparse.ArgumentParser(description='Markdown + config -> Teibto standard user-guide .docx')
    ap.add_argument('markdown')
    ap.add_argument('--config', required=True)
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--template', default=DEFAULT_TPL)
    return ap.parse_args()


# ── โครงสร้างเอกสาร ─────────────────────────────────────────────────────────
def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear'); shd.set(qn('w:fill'), fill)
    tcPr.append(shd)


CONTENT_W = 10016   # twips: A4 11906 - margin ซ้าย 1170 - ขวา 720 (ตาม sectPr ของ template)


def set_table_width(table, col_widths):
    """บังคับความกว้างตารางเท่าหน้ากระดาษเนื้อหาเสมอ (ทุกตารางในเล่มกว้างเท่ากัน)"""
    table.autofit = False
    tblPr = table._tbl.tblPr
    tblW = tblPr.find(qn('w:tblW'))
    if tblW is None:
        tblW = OxmlElement('w:tblW')
        tblPr.append(tblW)
    tblW.set(qn('w:w'), str(CONTENT_W)); tblW.set(qn('w:type'), 'dxa')
    layout = OxmlElement('w:tblLayout'); layout.set(qn('w:type'), 'fixed')
    tblPr.append(layout)
    for row in table.rows:
        for j, cell in enumerate(row.cells):
            if j < len(col_widths):
                tcPr = cell._tc.get_or_add_tcPr()
                tcW = tcPr.find(qn('w:tcW'))
                if tcW is None:
                    tcW = OxmlElement('w:tcW')
                    tcPr.append(tcW)
                tcW.set(qn('w:w'), str(col_widths[j])); tcW.set(qn('w:type'), 'dxa')


def table_col_widths(ncols):
    """2 คอลัมน์ = คอลัมน์แรกแคบ (สไตล์ Fields/Description) · อื่นๆ แบ่งเท่ากัน"""
    if ncols == 2:
        return [3000, CONTENT_W - 3000]
    base = CONTENT_W // ncols
    return [base] * (ncols - 1) + [CONTENT_W - base * (ncols - 1)]


def grid_borders(table):
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), '4')
        el.set(qn('w:space'), '0');    el.set(qn('w:color'), '808080')
        borders.append(el)
    table._tbl.tblPr.append(borders)


def note_borders(table, accent):
    """กล่อง note: ขอบซ้ายหนาสี accent ที่เหลือกลืนกับพื้น"""
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        el = OxmlElement(f'w:{edge}')
        if edge == 'left':
            el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), '24'); el.set(qn('w:color'), accent)
        else:
            el.set(qn('w:val'), 'none'); el.set(qn('w:sz'), '0'); el.set(qn('w:color'), 'auto')
        el.set(qn('w:space'), '0')
        borders.append(el)
    table._tbl.tblPr.append(borders)


# ── inline tokens: **bold**, `code`, [btn:..], [pill:..] ────────────────────
TOKEN_RE = re.compile(r'\*\*(?P<bold>.+?)\*\*|`(?P<code>[^`]+)`|\[btn:(?P<btn>[^\]]+)\]|\[pill:(?P<pill>[^\]]+)\]')


def _style_code(r):
    r.font.name = 'Consolas'
    r._element.rPr.rFonts.set(qn('w:cs'), 'Consolas')
    r.font.size = Pt(9.5)
    rPr = r._element.get_or_add_rPr()
    shd = OxmlElement('w:shd'); shd.set(qn('w:val'), 'clear'); shd.set(qn('w:fill'), 'F2F4F7')
    rPr.append(shd)


def _style_btn(r):
    r.bold = True
    r.font.size = Pt(10)
    rPr = r._element.get_or_add_rPr()
    shd = OxmlElement('w:shd'); shd.set(qn('w:val'), 'clear'); shd.set(qn('w:fill'), 'EEF1F4')
    rPr.append(shd)
    bdr = OxmlElement('w:bdr')
    bdr.set(qn('w:val'), 'single'); bdr.set(qn('w:sz'), '8')
    bdr.set(qn('w:space'), '2');    bdr.set(qn('w:color'), 'AEB9C4')
    rPr.append(bdr)


def add_runs(p, text, base):
    """เติม run ลงย่อหน้า รองรับ **ตัวหนา** `code` [btn:..] [pill:..]"""
    pos = 0
    for m in TOKEN_RE.finditer(text):
        if m.start() > pos:
            p.add_run(text[pos:m.start()])
        if m.group('bold') is not None:
            r = p.add_run(m.group('bold')); r.bold = True
        elif m.group('code') is not None:
            _style_code(p.add_run(m.group('code')))
        elif m.group('btn') is not None:
            # non-breaking space กันป้ายปุ่มหักบรรทัดกลางคำ
            _style_btn(p.add_run(' ' + m.group('btn').strip().replace(' ', ' ') + ' '))
        else:
            name = m.group('pill').strip().replace(' ', '_').replace('>', '')
            path = os.path.join(base, 'assets', f'pill-{name}.png')
            if os.path.exists(path):
                p.add_run().add_picture(path, height=Inches(0.17))
            else:
                r = p.add_run(m.group('pill')); r.bold = True
        pos = m.end()
    if pos < len(text):
        p.add_run(text[pos:])


def fill_cell(cell, text, base):
    p = cell.paragraphs[0]
    add_runs(p, text, base)


def img_kwargs(path, max_h_in=MAX_IMG_H_IN):
    """คืน kwargs สำหรับ add_picture โดยจำกัดทั้งความกว้าง (150dpi, ≤6.3") และความสูง (≤max_h_in)
    — คุมความสูงด้วยเพื่อกันรูปแนวตั้ง/จัตุรัสกินเต็มหน้า (คงสัดส่วนด้วยการส่งมิติเดียว)"""
    try:
        from PIL import Image
        w, h = Image.open(path).size
        disp_w = min(IMG_W, Inches(w / 150.0))
        disp_h = int(disp_w * h / w)          # ความสูงถ้าคุมด้วยความกว้าง
        max_h = Inches(max_h_in)
        if disp_h > max_h:
            return {'height': max_h}          # สูงเกินเพดาน → คุมด้วยความสูง (กว้างย่อตาม)
        return {'width': disp_w}
    except Exception:
        return {'width': IMG_W}


def mark_header_row(table):
    """แถวหัวตาราง: ทำซ้ำทุกหน้าเมื่อตารางถูกแบ่ง + เกาะกับแถวแรกเสมอ"""
    tr = table.rows[0]._tr
    trPr = tr.get_or_add_trPr()
    th = OxmlElement('w:tblHeader'); th.set(qn('w:val'), 'true')
    trPr.append(th)
    for cell in table.rows[0].cells:
        for p in cell.paragraphs:
            p.paragraph_format.keep_with_next = True


def no_row_split(table):
    """ห้ามตัดกลางแถวข้ามหน้า (แถวยาวย้ายไปหน้าใหม่ทั้งแถว)"""
    for row in table.rows:
        trPr = row._tr.get_or_add_trPr()
        cs = OxmlElement('w:cantSplit')
        trPr.append(cs)


def render_markdown(d, md_path, cfg):
    base = os.path.dirname(os.path.abspath(md_path))
    ch_icons = cfg.get('chapter_icons') or {}
    max_h_in = cfg.get('max_image_height_in', MAX_IMG_H_IN)
    lines = io.open(md_path, encoding='utf-8').read().splitlines()
    fig = [0]
    i, n = 0, len(lines)
    while i < n:
        line = lines[i].rstrip()
        if not line.strip():
            i += 1; continue
        m = re.match(r'^(#{1,3})\s+(.*)', line)
        if m:
            lvl, text = len(m.group(1)), m.group(2).strip()
            p = d.add_paragraph(style=f'Heading {lvl}')
            p.paragraph_format.keep_with_next = True   # หัวข้อไม่ค้างท้ายหน้าโดดจากเนื้อหา
            if lvl == 1 and text in ch_icons:
                icp = os.path.join(base, ch_icons[text])
                if os.path.exists(icp):
                    p.add_run().add_picture(icp, height=Inches(0.21))
                    p.add_run(' ')
            sm = re.match(r'^ขั้นที่\s*(\d+)\s*(.*)', text) if lvl == 2 else None
            if sm and 1 <= int(sm.group(1)) <= 9:
                bp = os.path.join(ASSETS, f'badge-{int(sm.group(1))}.png')
                if os.path.exists(bp):
                    p.add_run().add_picture(bp, height=Inches(0.24))
                    p.add_run(' ')
            p.add_run(text)
            i += 1; continue
        m = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)\s*$', line)
        if m:
            alt, rel = m.group(1).strip(), m.group(2)
            img_path = os.path.join(base, rel)
            # ย่อหน้านำหน้ารูป (ข้อความอธิบาย) เกาะกับรูป ไม่ค้างท้ายหน้า
            if d.paragraphs and d.paragraphs[-1].text.strip():
                d.paragraphs[-1].paragraph_format.keep_with_next = True
            d.add_picture(img_path, **img_kwargs(img_path, max_h_in))
            d.paragraphs[-1].alignment = 1
            if alt:
                d.paragraphs[-1].paragraph_format.keep_with_next = True   # รูปเกาะกับ caption
                fig[0] += 1
                cap = d.add_paragraph()
                cap.alignment = 1
                r = cap.add_run(f'ภาพที่ {fig[0]}: {alt}')
                r.font.size = Pt(9); r.font.color.rgb = RGBColor(0x64, 0x74, 0x8B); r.italic = True
            i += 1; continue
        if line.lstrip().startswith('|'):
            rows = []
            while i < n and lines[i].lstrip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-{3,}:?', c) for c in cells):   # ข้ามเส้นคั่น header
                    rows.append(cells)
                i += 1
            if rows:
                t = d.add_table(rows=1, cols=len(rows[0]))
                grid_borders(t)
                for j, h in enumerate(rows[0]):
                    c = t.rows[0].cells[j]
                    fill_cell(c, h, base)
                    for r in c.paragraphs[0].runs:
                        r.bold = True
                        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                    shade(c, HDR_FILL)
                for ridx, row in enumerate(rows[1:]):
                    cells = t.add_row().cells
                    for j in range(min(len(row), len(cells))):
                        fill_cell(cells[j], row[j], base)
                        if ridx % 2 == 1:
                            shade(cells[j], ZEBRA_FILL)
                set_table_width(t, table_col_widths(len(rows[0])))
                mark_header_row(t)
                no_row_split(t)
            continue
        if line.lstrip().startswith('>'):
            text = line.lstrip()[1:].strip()
            # รวมบรรทัด '>' ต่อเนื่องเป็นกล่องเดียว
            i += 1
            while i < n and lines[i].lstrip().startswith('>'):
                text += ' ' + lines[i].lstrip()[1:].strip()
                i += 1
            head, rest = (text.split(':', 1) + [''])[:2] if ':' in text[:40] else ('', text)
            head = head.strip()
            fillc, accent, icon = NOTE_TYPES.get(head, NOTE_TYPES['หมายเหตุ'])
            t = d.add_table(rows=1, cols=1)
            note_borders(t, accent)
            set_table_width(t, [CONTENT_W])
            no_row_split(t)   # กล่อง note ไม่ถูกผ่าข้ามหน้า
            cell = t.rows[0].cells[0]
            shade(cell, fillc)
            p = cell.paragraphs[0]
            icp = os.path.join(ASSETS, icon)
            if os.path.exists(icp):
                p.add_run().add_picture(icp, height=Inches(0.17))
                p.add_run('  ')
            if head:
                r = p.add_run(head + ': '); r.bold = True
                add_runs(p, rest.strip(), base)
            else:
                add_runs(p, text, base)
            d.add_paragraph()   # ระยะห่างใต้กล่อง
            continue
        m = re.match(r'^(-|\d+\.)\s+(.*)', line.strip())
        if m:
            p = d.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.45)
            p.paragraph_format.first_line_indent = Inches(-0.2)
            p.paragraph_format.space_after = Pt(3)
            marker = '•' if m.group(1) == '-' else m.group(1)
            r = p.add_run(marker + '  ')
            if m.group(1) != '-':
                r.bold = True
            add_runs(p, m.group(2), base)
            i += 1; continue
        # ย่อหน้าปกติ — รวมบรรทัดต่อเนื่องเป็นย่อหน้าเดียว
        buf = [line.strip()]
        i += 1
        while i < n and lines[i].strip() and not re.match(r'^(#{1,3}\s|!\[|\||>|-\s|\d+\.\s)', lines[i].lstrip()):
            buf.append(lines[i].strip())
            i += 1
        p = d.add_paragraph()
        add_runs(p, ' '.join(buf), base)


# ── token + version history ─────────────────────────────────────────────────
def apply_config(d, cfg):
    hist = cfg.get('history') or [{}]
    tokens = {
        '{{TITLE_TH}}':      cfg['title_th'],
        '({{TITLE_EN}})':    '(' + cfg['title_en'] + ')',
        '{{CUSTOMER_FULL}}': cfg.get('customer_full', cfg['customer']),
        '{{PROJECT}}':       cfg.get('project', 'Oracle NetSuite Implementation'),
        '{{PHASE}}':         str(cfg.get('phase', '1.0')),
        '{{CUSTOMER}}':      cfg['customer'],
        '{{OWNER}}':         cfg['owner'],
        '{{REV}}':           hist[0].get('rev', '0.1'),
        '{{DATE}}':          hist[0].get('date', ''),
        '{{AUTHOR}}':        hist[0].get('author', cfg['owner']),
        '{{SUMMARY}}':       hist[0].get('summary', 'Initial version'),
    }
    body = d.element.body
    # แถวเพิ่มของ version history: clone แถวที่มี {{REV}} ก่อนแทนค่า
    if len(hist) > 1:
        for t in body.iter(qn('w:t')):
            if (t.text or '').strip() == '{{REV}}':
                tr = t.getparent()
                while tr is not None and tr.tag != qn('w:tr'):
                    tr = tr.getparent()
                anchor = tr
                for h in hist[1:]:
                    row = copy.deepcopy(tr)
                    vals = {'{{REV}}': h.get('rev', ''), '{{DATE}}': h.get('date', ''),
                            '{{AUTHOR}}': h.get('author', ''), '{{SUMMARY}}': h.get('summary', '')}
                    for tt in row.iter(qn('w:t')):
                        k = (tt.text or '').strip()
                        if k in vals:
                            tt.text = vals[k]
                    anchor.addnext(row)
                    anchor = row
                break
    for t in body.iter(qn('w:t')):
        key = (t.text or '').strip()
        if key in tokens:
            t.text = tokens[key]


def _to_jpeg(path):
    """คืน bytes JPEG จากไฟล์ภาพใดๆ (PNG แปลงผ่าน Pillow)"""
    if path.lower().endswith(('.jpg', '.jpeg')):
        return open(path, 'rb').read()
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.open(path).convert('RGB').save(buf, 'JPEG', quality=92)
        return buf.getvalue()
    except ImportError:
        sys.exit(f'{os.path.basename(path)} ต้องเป็น .jpg (หรือติดตั้ง Pillow: pip install pillow)')


# JPEG ขาวล้วน 16x8 px (base64) — fallback เมื่อเครื่องไม่มี Pillow
# Word ยืดภาพให้เต็มกรอบเองอยู่แล้ว ภาพขาวจึงไม่ต้องมีความละเอียดสูง
_WHITE_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQAASABIAAD/4QBeRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA5KGAAcAAAASAAAARKACAAQAAAABAAAAEKADAAQAAAABAAAACAAAAABBU0NJSQAAAFNjcmVlbnNob3T/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/+ICIElDQ19QUk9GSUxFAAEBAAACEGFwcGwEAAAAbW50clJHQiBYWVogB+oACAAUAAgALgARYWNzcEFQUEwAAAAAQVBQTAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1hcHBsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAA2Y3BydAAAATQAAABQd3RwdAAAAYQAAAAUclhZWgAAAZgAAAAUZ1hZWgAAAawAAAAUYlhZWgAAAcAAAAAUclRSQwAAAdQAAAAQY2hhZAAAAeQAAAAsYlRSQwAAAdQAAAAQZ1RSQwAAAdQAAAAQbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABEAEUATABMACAAUwBFADIANAAxADkASABSAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADQAAAAcAEMAbwBwAHkAcgBpAGcAaAB0ACAAQQBwAHAAbABlACAASQBuAGMALgAsACAAMgAwADIANlhZWiAAAAAAAAD21gABAAAAANMtWFlaIAAAAAAAAGTlAAAzbQAAAShYWVogAAAAAAAAahAAALv2AAARtVhZWiAAAAAAAAAn4QAAEJ0AAMBQcGFyYQAAAAAAAAAAAAH2BHNmMzIAAAAAAAELtwAABZb///NXAAAHKQAA/df///u3///9pgAAA9oAAMD2/8AAEQgACAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/fyiiigD/9k="
)


def _blank_jpeg():
    """JPEG ขาวล้วน — ใช้แทนกล่อง CUSTOMER LOGO placeholder เมื่อไม่ได้ตั้งโลโก้

    ต้องคืนไบต์เสมอ ห้ามคืน None: จุดเรียกใช้เช็ค `if logo_bytes and ...` ถ้าคืน None
    จะข้ามการแทนภาพ แล้วกล่อง placeholder ของ template จะติดไปถึงมือลูกค้า
    (บทเรียน 20-Aug-2026: เครื่องที่ไม่มี Pillow ส่งเล่มที่ยังมีกล่อง CUSTOMER LOGO)
    """
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGB', (400, 205), (255, 255, 255)).save(buf, 'JPEG', quality=90)
        return buf.getvalue()
    except ImportError:
        import base64
        return base64.b64decode(_WHITE_JPEG_B64)


def finalize_zip(out, cfg, base):
    """footer tokens + updateFields + โลโก้ลูกค้า/ภาพปกใน header/ปก"""
    hist = cfg.get('history') or [{}]
    logo = cfg.get('customer_logo')
    logo_bytes = _to_jpeg(os.path.join(base, logo)) if logo else _blank_jpeg()
    cover = cfg.get('cover_image')
    cover_bytes = _to_jpeg(os.path.join(base, cover)) if cover else None
    tmp = out + '.tmp'
    with zipfile.ZipFile(out) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ('word/footer1.xml', 'word/footer2.xml'):
                s = data.decode('utf-8')
                # footer ปก (footer2) มีช่องว่างคงที่ยาว — ชื่อยาวจะตกบรรทัด ใช้ doc_short ถ้ามี
                name = cfg.get('doc_short', cfg['doc_name']) if item.filename == 'word/footer2.xml' else cfg['doc_name']
                s = s.replace('{{DOC_NAME}}', name)
                s = s.replace('{{REV}}', hist[-1].get('rev', '0.1'))   # ปก = rev ล่าสุด
                data = s.encode('utf-8')
            elif item.filename == 'word/settings.xml':
                # TOC ใน template เป็น field ที่ cache ผลลัพธ์ของเอกสารต้นฉบับไว้ —
                # ตั้ง updateFields ให้ Word คำนวณ field ทั้งหมดใหม่ตอนเปิดไฟล์ทุกครั้ง
                s = data.decode('utf-8')
                if '<w:updateFields' not in s and '<w:settings' in s:
                    idx = s.find('>', s.find('<w:settings'))
                    s = s[:idx + 1] + '<w:updateFields w:val="true"/>' + s[idx + 1:]
                data = s.encode('utf-8')
            elif logo_bytes and item.filename == LOGO_PART:
                data = logo_bytes
            elif cover_bytes and item.filename == COVER_PART:
                data = cover_bytes
            zout.writestr(item, data)
    os.replace(tmp, out)


def bake_fields_with_word(out):
    """เปิดไฟล์ด้วย Word COM แล้ว update field ทั้งหมด (TOC ได้เลขหน้าจริง) — best-effort:
    เครื่องไม่มี Word ก็ข้ามได้ เพราะ settings.xml ถูกตั้ง updateFields ไว้แล้ว"""
    import subprocess
    path = os.path.abspath(out)
    ps = (
        "$w = New-Object -ComObject Word.Application; $w.Visible = $false; "
        "try { $d = $w.Documents.Open('" + path.replace("'", "''") + "'); "
        "$d.Fields.Update() | Out-Null; "
        "foreach ($t in $d.TablesOfContents) { $t.Update() | Out-Null }; "
        "$d.Save(); $d.Close() } finally { $w.Quit() }"
    )
    for shell in ('pwsh', 'powershell'):
        try:
            r = subprocess.run([shell, '-NoProfile', '-Command', ps],
                               capture_output=True, timeout=120)
            if r.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return False


def strip_toc_images(out):
    """ลบรูป (icon บท / badge ขั้นตอน) ที่ Word คัดลอกจากหัวข้อเข้าไปในสารบัญตอน update field —
    สารบัญสะอาดเป็นตัวอักษรล้วน ส่วนหัวข้อในเนื้อหายังมี icon ตามเดิม (รันหลัง bake เท่านั้น)"""
    with zipfile.ZipFile(out) as zin:
        items = zin.infolist()
        parts = {i.filename: zin.read(i.filename) for i in items}
    s = parts['word/document.xml'].decode('utf-8')
    # หา sdt block ที่เป็น TOC (มี instrText ' TOC ')
    changed = False
    pos = 0
    while True:
        a = s.find('<w:sdt>', pos)
        if a < 0:
            break
        b = s.find('</w:sdt>', a)
        depth_guard = s.find('<w:sdt>', a + 7)
        while depth_guard != -1 and depth_guard < b:   # sdt ซ้อน — ขยับจุดปิดออกไป
            b = s.find('</w:sdt>', b + 8)
            depth_guard = s.find('<w:sdt>', depth_guard + 7)
        block = s[a:b]
        if ' TOC ' in block and '<w:drawing>' in block:
            cleaned = re.sub(r'<w:drawing>.*?</w:drawing>', '', block, flags=re.S)
            s = s[:a] + cleaned + s[b:]
            changed = True
            break
        pos = a + 7
    if not changed:
        return False
    parts['word/document.xml'] = s.encode('utf-8')
    tmp = out + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for i in items:
            zout.writestr(i, parts[i.filename])
    os.replace(tmp, out)
    return True


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass
    a = parse_args()
    cfg = json.load(io.open(a.config, encoding='utf-8'))
    base = os.path.dirname(os.path.abspath(a.markdown))
    d = docx.Document(a.template)
    apply_config(d, cfg)
    render_markdown(d, a.markdown, cfg)
    d.save(a.out)
    finalize_zip(a.out, cfg, base)
    baked = bake_fields_with_word(a.out)
    if baked:
        strip_toc_images(a.out)
    print('OK ->', os.path.abspath(a.out))
    if baked:
        print('สารบัญถูกอัปเดตในไฟล์แล้ว (Word COM, ไม่มี icon ในสารบัญ)')
    else:
        print('ไม่พบ MS Word บนเครื่อง — สารบัญจะอัปเดตเองเมื่อเปิดใน Word (updateFields) '
              'หรือกด Ctrl+A ตามด้วย F9')


if __name__ == '__main__':
    main()
