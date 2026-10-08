#!/usr/bin/env python3
"""
codecmp — เทียบโค้ดทั้งโปรเจกต์ระหว่างสองโฟลเดอร์ (เช่น Sandbox vs Production)

จับคู่ไฟล์ "ชื่อเดียวกัน" (basename) ข้ามโครงสร้างโฟลเดอร์ที่ต่างกันได้
ผลลัพธ์: report.md (คนอ่าน) + summary.json (agent อ่าน) + diffs/*.diff (ของจริง)

ใช้งาน:
    python3 codecmp.py                        # เปิด Finder ให้เลือก 2 โฟลเดอร์
    python3 codecmp.py <SB_DIR> <PROD_DIR>    # ระบุเอง
    python3 codecmp.py A B -o /path/out       # กำหนดที่เก็บผล
    python3 codecmp.py A B --ext .js .ts      # จำกัดนามสกุล
    python3 codecmp.py A B --by-path          # จับคู่ด้วย relative path แทน basename
"""

import argparse
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime

CODE_EXT = {
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".json", ".html", ".htm",
    ".css", ".scss", ".xml", ".py", ".sh", ".sql", ".md", ".txt", ".yml",
    ".yaml", ".ftl", ".vue", ".java", ".cs", ".rb", ".php",
}
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".DS_Store", "dist", "build",
    ".venv", "venv", ".idea", ".vscode", "coverage", ".next", ".cache",
}
MAX_BYTES = 4 * 1024 * 1024  # ไฟล์ใหญ่กว่านี้เทียบแค่ hash


# ---------- helpers ----------

def choose_folder(prompt):
    """เปิด Finder ให้เลือกโฟลเดอร์ (macOS)"""
    script = f'POSIX path of (choose folder with prompt "{prompt}")'
    try:
        out = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True, check=True
        )
        return out.stdout.strip().rstrip("/")
    except subprocess.CalledProcessError:
        sys.exit("ยกเลิกการเลือกโฟลเดอร์")


def walk_files(root, exts, skip_dirs):
    """คืน dict: relpath -> abspath"""
    found = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            ext = os.path.splitext(fn)[1].lower()
            if exts and ext not in exts:
                continue
            ap = os.path.join(dirpath, fn)
            found[os.path.relpath(ap, root)] = ap
    return found


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read_lines(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read().splitlines(keepends=True)


def norm(lines, ignore_ws):
    """normalize สำหรับตรวจว่า 'ต่างจริง' ไหม (ตัด trailing ws / บรรทัดว่าง)"""
    if not ignore_ws:
        return [l.rstrip("\r\n") for l in lines]
    return [l.strip() for l in lines if l.strip()]


NS_SCRIPT_ID = re.compile(r"(customscript\w+|customdeploy\w+|custscript\w+)", re.I)
NS_INTERNAL_URL = re.compile(r"(script=\d+|deploy=\d+|\bid=\d+\b)")


def classify(diff_lines):
    """เดา 'ชนิดของความต่าง' แบบหยาบ ๆ เพื่อช่วยจัดลำดับความสำคัญ"""
    tags = set()
    for l in diff_lines:
        if not (l.startswith("+") or l.startswith("-")) or l.startswith(("+++", "---")):
            continue
        body = l[1:]
        s = body.strip()
        if not s:
            tags.add("whitespace")
            continue
        if s.startswith(("//", "/*", "*", "#", "<!--")):
            tags.add("comment")
            continue
        if NS_SCRIPT_ID.search(s) or NS_INTERNAL_URL.search(s):
            tags.add("script-id/url")
        if re.search(r"\b(TEST_MODE|DEBUG|console\.log|log\.debug)\b", s):
            tags.add("debug/flag")
        if re.search(r"\b(if|for|while|return|throw|function|=>|await|try)\b", s):
            tags.add("logic")
        if re.search(r"custrecord\w+|custbody\w+|custcol\w+|custentity\w+", s):
            tags.add("field-id")
        tags.add("code")
    for weak in ("code",):
        if len(tags) > 1 and weak in tags:
            tags.discard(weak)
    return sorted(tags) or ["code"]


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser(description="เทียบโค้ดสองโฟลเดอร์ (SB vs Production)")
    ap.add_argument("left", nargs="?", help="โฟลเดอร์ฝั่งซ้าย (เช่น Sandbox)")
    ap.add_argument("right", nargs="?", help="โฟลเดอร์ฝั่งขวา (เช่น Production)")
    ap.add_argument("-o", "--out", help="โฟลเดอร์เก็บผลลัพธ์")
    ap.add_argument("--left-name", default="SB")
    ap.add_argument("--right-name", default="PROD")
    ap.add_argument("--ext", nargs="*", help="จำกัดนามสกุล เช่น --ext .js .html (ไม่ใส่ = ชุด default)")
    ap.add_argument("--all-ext", action="store_true", help="เทียบทุกนามสกุล")
    ap.add_argument("--by-path", action="store_true", help="จับคู่ด้วย relative path แทน basename")
    ap.add_argument("--ignore-ws", action="store_true", help="มองข้ามช่องว่าง/บรรทัดว่างเวลาตัดสินว่าต่าง")
    ap.add_argument("--context", type=int, default=3, help="บรรทัด context ใน unified diff")
    ap.add_argument("--max-diff-lines", type=int, default=400, help="ตัด diff ต่อไฟล์ที่กี่บรรทัด")
    args = ap.parse_args()

    left = args.left or choose_folder("เลือกโฟลเดอร์ฝั่งซ้าย (Sandbox)")
    right = args.right or choose_folder("เลือกโฟลเดอร์ฝั่งขวา (Production)")
    for p in (left, right):
        if not os.path.isdir(p):
            sys.exit(f"ไม่พบโฟลเดอร์: {p}")
    left, right = os.path.abspath(left), os.path.abspath(right)

    exts = None if args.all_ext else {e if e.startswith(".") else "." + e
                                      for e in (args.ext or CODE_EXT)}

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = os.path.abspath(args.out or os.path.join(
        os.path.dirname(left), f"codecmp-{stamp}"))
    diffdir = os.path.join(out, "diffs")
    os.makedirs(diffdir, exist_ok=True)

    lf = walk_files(left, exts, SKIP_DIRS)
    rf = walk_files(right, exts, SKIP_DIRS)

    if args.by_path:
        lkeys = {k: [v] for k, v in lf.items()}
        rkeys = {k: [v] for k, v in rf.items()}
    else:
        lkeys, rkeys = defaultdict(list), defaultdict(list)
        for rel, ap_ in lf.items():
            lkeys[os.path.basename(rel)].append(ap_)
        for rel, ap_ in rf.items():
            rkeys[os.path.basename(rel)].append(ap_)

    keys = sorted(set(lkeys) | set(rkeys), key=str.lower)

    same, differ, only_left, only_right, ambiguous, binaryish = [], [], [], [], [], []

    for key in keys:
        L, R = lkeys.get(key, []), rkeys.get(key, [])
        if L and not R:
            only_left.append({"name": key, "paths": [os.path.relpath(p, left) for p in L]})
            continue
        if R and not L:
            only_right.append({"name": key, "paths": [os.path.relpath(p, right) for p in R]})
            continue
        if len(L) > 1 or len(R) > 1:
            ambiguous.append({
                "name": key,
                "left": [os.path.relpath(p, left) for p in L],
                "right": [os.path.relpath(p, right) for p in R],
            })
        lp, rp = L[0], R[0]

        if os.path.getsize(lp) > MAX_BYTES or os.path.getsize(rp) > MAX_BYTES:
            if sha256(lp) == sha256(rp):
                same.append(key)
            else:
                binaryish.append({"name": key, "reason": "ไฟล์ใหญ่ — เทียบด้วย hash เท่านั้น"})
            continue

        if sha256(lp) == sha256(rp):
            same.append(key)
            continue

        ll, rl = read_lines(lp), read_lines(rp)
        if norm(ll, args.ignore_ws) == norm(rl, args.ignore_ws):
            same.append(key)  # ต่างแค่ whitespace/EOL
            continue

        diff = list(difflib.unified_diff(
            ll, rl,
            fromfile=f"{args.left_name}/{os.path.relpath(lp, left)}",
            tofile=f"{args.right_name}/{os.path.relpath(rp, right)}",
            n=args.context, lineterm="\n",
        ))
        added = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
        removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
        hunks = sum(1 for l in diff if l.startswith("@@"))

        safe = re.sub(r"[^A-Za-z0-9._-]", "_", key)
        dpath = os.path.join(diffdir, safe + ".diff")
        body = diff if len(diff) <= args.max_diff_lines else \
            diff[:args.max_diff_lines] + [f"\n... ตัดที่ {args.max_diff_lines} บรรทัด "
                                          f"(diff เต็มมี {len(diff)} บรรทัด) ...\n"]
        with open(dpath, "w", encoding="utf-8") as f:
            f.writelines(body)

        differ.append({
            "name": key,
            "left_path": os.path.relpath(lp, left),
            "right_path": os.path.relpath(rp, right),
            "added": added, "removed": removed, "hunks": hunks,
            "left_lines": len(ll), "right_lines": len(rl),
            "churn": added + removed,
            "tags": classify(diff),
            "diff_file": os.path.relpath(dpath, out),
            "truncated": len(diff) > args.max_diff_lines,
        })

    differ.sort(key=lambda d: -d["churn"])

    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "left": {"name": args.left_name, "root": left, "files": len(lf)},
        "right": {"name": args.right_name, "root": right, "files": len(rf)},
        "match_mode": "relative-path" if args.by_path else "basename",
        "ignore_whitespace": args.ignore_ws,
        "counts": {
            "identical": len(same), "different": len(differ),
            "only_left": len(only_left), "only_right": len(only_right),
            "ambiguous": len(ambiguous), "hash_only": len(binaryish),
        },
        "different": differ,
        "only_left": only_left,
        "only_right": only_right,
        "ambiguous": ambiguous,
        "hash_only": binaryish,
        "identical": same,
    }
    with open(os.path.join(out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    # ---------- report.md ----------
    L, R = args.left_name, args.right_name
    md = [
        f"# Code compare: {L} vs {R}",
        "",
        f"- {L}: `{left}` — {len(lf)} ไฟล์",
        f"- {R}: `{right}` — {len(rf)} ไฟล์",
        f"- จับคู่ด้วย: {summary['match_mode']}"
        + ("  (ignore whitespace)" if args.ignore_ws else ""),
        f"- สร้างเมื่อ: {summary['generated_at']}",
        "",
        "| สถานะ | จำนวน |",
        "|---|---:|",
        f"| เหมือนกัน | {len(same)} |",
        f"| ต่างกัน | {len(differ)} |",
        f"| มีแค่ใน {L} | {len(only_left)} |",
        f"| มีแค่ใน {R} | {len(only_right)} |",
        f"| ชื่อซ้ำหลายที่ (ต้องดูเอง) | {len(ambiguous)} |",
        "",
    ]

    if differ:
        md += ["## ไฟล์ที่ต่างกัน (เรียงตามปริมาณการเปลี่ยน)", "",
               "| ไฟล์ | +/- | hunks | ชนิด | diff |", "|---|---|---:|---|---|"]
        for d in differ:
            md.append(
                f"| `{d['name']}` | +{d['added']} / -{d['removed']} | {d['hunks']} "
                f"| {', '.join(d['tags'])} | `{d['diff_file']}` |"
            )
        md.append("")

    if only_left:
        md += [f"## มีแค่ใน {L} ({len(only_left)})", ""]
        md += [f"- `{x['name']}` — {', '.join(x['paths'])}" for x in only_left] + [""]
    if only_right:
        md += [f"## มีแค่ใน {R} ({len(only_right)})", ""]
        md += [f"- `{x['name']}` — {', '.join(x['paths'])}" for x in only_right] + [""]
    if ambiguous:
        md += ["## ชื่อไฟล์ซ้ำหลายตำแหน่ง — เทียบตัวแรกให้ ตรวจเองอีกรอบ", ""]
        md += [f"- `{x['name']}`: {L}={x['left']} / {R}={x['right']}" for x in ambiguous] + [""]
    if binaryish:
        md += ["## เทียบด้วย hash เท่านั้น", ""]
        md += [f"- `{x['name']}` — {x['reason']}" for x in binaryish] + [""]

    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md))

    print(f"เสร็จ → {out}")
    print(f"  report.md    (สรุปให้คนอ่าน)")
    print(f"  summary.json (ให้ Claude อ่านสรุป)")
    print(f"  diffs/       ({len(differ)} ไฟล์)")
    print(f"เหมือน {len(same)} | ต่าง {len(differ)} | เฉพาะ {L} {len(only_left)} "
          f"| เฉพาะ {R} {len(only_right)}")


if __name__ == "__main__":
    main()
