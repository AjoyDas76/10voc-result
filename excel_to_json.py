"""
excel_to_json.py
-----------------
Converts a school mark-entry Excel sheet (subject blocks of
মোট নম্বর / প্রাপ্ত নম্বর / গ্রেড [/ পয়েন্ট বা জি.পি.]) into a **separate
result file per exam** for the Result Portal:

    results/<exam-id>.json   → that one exam's student data
    exams.json                → the index (school info + list of exams,
                                 each pointing at its own file) that the
                                 website reads first

Each run only touches the ONE exam's file (--exam-id) and that one entry
in exams.json — every other exam's file and index entry is left alone.

Robust to different sheet layouts:
- Works with or without a "Roll" column in the marks sheet itself.
- Reads each subject's actual pass/grade cut-offs directly from that
  column's Excel IF-formula (so it matches the sheet exactly, even if
  different exams/classes use different grading scales).
- If the marks sheet has no Roll column, Roll numbers can be pulled from
  a separate roster file/sheet (name + roll list), matched by row order.

Usage:
    python3 excel_to_json.py <marks.xlsx> --exam-id first_assessment
        [--sheet SHEET_NAME]
        [--roll-file ROSTER.xlsx --roll-sheet SHEET_NAME]
        [--exam-name "..."] [--exam-class "..."] [--section "..."]
        [--exam-label "..."]
        [--school-name "..."] [--school-address "..."]
        [--results-dir results] [--index exams.json]

Re-run this any time after filling in a new exam's marks to regenerate
that exam's file. No code changes needed.
"""
import os
import sys
import re
import json
import argparse
import openpyxl

STOP_WORDS = ("জি.পি.এ", "সর্বমোট", "failed", "gpa")

# fallback boundaries (used only if a subject's grade cell has no formula
# to read cut-offs from)
FALLBACK_BOUNDARIES = {
    30: [(23, "A+"), (21, "A"), (17, "A-"), (14, "B"), (11, "C"), (8.5, "D")],
    25: [(17, "A+"), (14.5, "A"), (12.5, "A-"), (10.5, "B"), (8.5, "C"), (6.5, "D")],
    15: [(11, "A+"), (10, "A"), (8, "A-"), (7, "B"), (6, "C"), (4, "D")],
}

FORMULA_RULE_RE = re.compile(r'[A-Z]+\d+\s*(>=|<=|>|<)\s*([\d.]+)\s*,\s*"([^"]*)"')


def parse_grade_rules(ws, sample_row, grade_col):
    """Extract (operator, threshold, label) rules from a grade cell's IF formula."""
    if not grade_col:
        return None
    formula = ws.cell(row=sample_row, column=grade_col).value
    if not isinstance(formula, str) or not formula.startswith("="):
        return None
    rules = [(op, float(val), label) for op, val, label in FORMULA_RULE_RE.findall(formula)]
    return rules or None


def eval_grade(rules, obtained, total):
    if obtained is None:
        obtained = 0
    if rules:
        for op, threshold, label in rules:
            if op == ">=" and obtained >= threshold: return label or "F"
            if op == ">" and obtained > threshold: return label or "F"
            if op == "<=" and obtained <= threshold: return label or "F"
            if op == "<" and obtained < threshold: return label or "F"
        return "F"
    # fallback table
    table = FALLBACK_BOUNDARIES.get(total) or [(t / 30 * total, g) for t, g in FALLBACK_BOUNDARIES[30]]
    for cutoff, letter in table:
        if obtained > cutoff:
            return letter
    return "F"


def find_best_sheet(wb, forced_name=None):
    if forced_name:
        return wb[forced_name]
    best, best_score = None, -1
    for sn in wb.sheetnames:
        ws = wb[sn]
        score = 0
        for r in range(1, min(ws.max_row, 6) + 1):
            for c in range(1, min(ws.max_column, 5) + 1):
                if str(ws.cell(row=r, column=c).value or "").strip() == "নাম":
                    score = ws.max_column  # wider name-bearing sheets win
        if score > best_score:
            best, best_score = ws, score
    if best is None:
        raise ValueError("Could not find a sheet with a 'নাম' header row.")
    return best


def find_layout(ws):
    header_row = sub_row = None
    name_col = roll_col = None
    for r in range(1, min(ws.max_row, 8) + 1):
        for c in range(1, min(ws.max_column, 6) + 1):
            v = str(ws.cell(row=r, column=c).value or "").strip()
            if v == "নাম":
                header_row, name_col = r, c
            elif v.lower() in ("roll", "রোল"):
                roll_col = c
    if header_row is None:
        raise ValueError("Could not find a 'নাম' header cell.")
    sub_row = header_row + 1

    subject_starts = []
    for c in range(name_col + 1, ws.max_column + 1):
        v = ws.cell(row=header_row, column=c).value
        if v is None:
            continue
        text = str(v).strip()
        if any(sw in text.lower() for sw in STOP_WORDS):
            break
        subject_starts.append((c, text))

    subjects = []
    for i, (start_col, subj_name) in enumerate(subject_starts):
        end_col = subject_starts[i + 1][0] if i + 1 < len(subject_starts) else ws.max_column + 1
        total_col = obtained_col = grade_col = None
        for c in range(start_col, end_col):
            label = ws.cell(row=sub_row, column=c).value
            if label is None:
                continue
            label = str(label).strip()
            if "মোট" in label:
                total_col = c
            elif "প্রাপ্ত" in label:
                obtained_col = c
            elif "গ্রেড" in label:
                grade_col = c
        if total_col and obtained_col:
            subjects.append((subj_name.strip(), total_col, obtained_col, grade_col))

    return roll_col, name_col, header_row + 2, subjects


def load_roll_map(path, sheet_name):
    """Return an ordered list of (roll, name) from a roster file."""
    wb = openpyxl.load_workbook(path, data_only=False)
    ws = wb[sheet_name] if sheet_name else wb[wb.sheetnames[0]]
    pairs = []
    for r in range(1, ws.max_row + 1):
        a = ws.cell(row=r, column=1).value
        b = ws.cell(row=r, column=2).value
        if a is not None and b is not None and str(b).strip():
            pairs.append((str(a).strip(), str(b).strip()))
    return pairs


def convert_exam(
    input_path,
    exam_id,
    sheet=None,
    roll_file=None,
    roll_sheet=None,
    exam_name=None,
    exam_class=None,
    section=None,
    exam_label=None,
    exam_class_full=None,
    school_name="প্রবর্তক স্কুল এন্ড কলেজ",
    school_address="পাঁচলাইশ, চট্টগ্রাম",
    results_dir="results",
    index_path="exams.json",
):
    """
    Core conversion logic, reusable from both the CLI (main(), below) and
    scripts/sync_marks.py (the GitHub Actions entry point). Reads
    `input_path`, writes `results_dir/<exam_id>.json` and updates
    `index_path`. Returns a report dict describing what happened.
    """
    wb = openpyxl.load_workbook(input_path, data_only=False)
    ws = find_best_sheet(wb, sheet)

    title_cell = ""
    for c in range(1, 4):
        v = ws.cell(row=1, column=c).value
        if v:
            title_cell = str(v)
            break
    exam_name = exam_name or title_cell.split("ফলাফল")[0].strip()
    m_class = re.search(r"শ্রেণিঃ\s*([^\s]+)", title_cell)
    m_sec = re.search(r"শাখাঃ\s*(.+)", title_cell)
    exam_class = exam_class or (m_class.group(1).strip() if m_class else "")
    section = section or (re.sub(r"\s+", " ", m_sec.group(1).strip()) if m_sec else "")

    roll_col, name_col, first_data_row, subjects = find_layout(ws)
    if not subjects:
        print("Could not detect subject headers — check the sheet layout.")
        sys.exit(1)

    warnings = []  # collected admin-facing warnings, printed as a summary at the end

    # pre-parse grade formula rules per subject (from the first data row)
    subj_rules = {}
    for subj_name, total_col, obtained_col, grade_col in subjects:
        rules = parse_grade_rules(ws, first_data_row, grade_col)
        subj_rules[subj_name] = rules
        if not rules:
            warnings.append(
                f"বিষয় '{subj_name}': গ্রেড কলামে কোনো IF-ফর্মুলা পাওয়া যায়নি, তাই ডিফল্ট গ্রেডিং টেবিল ব্যবহার হয়েছে — "
                f"এই বিষয়ের পাস/গ্রেড সীমা যাচাই করে নিন।"
            )

    roll_lookup = None
    if not roll_col and roll_file:
        roll_lookup = load_roll_map(roll_file, roll_sheet)
    if not roll_col and not roll_lookup:
        warnings.append(
            "শিটে কোনো Roll কলাম পাওয়া যায়নি এবং কোনো --roll-file দেওয়া হয়নি — তাই সারি অনুযায়ী "
            "স্বয়ংক্রিয়ভাবে (1, 2, 3...) Roll বসানো হয়েছে। এটা প্রকৃত Roll Number না-ও মিলতে পারে।"
        )

    students = []
    auto_roll = 1
    roll_idx = 0
    blank_mark_counts = {subj_name: 0 for subj_name, *_ in subjects}
    blank_total_subjects = set()
    for row in range(first_data_row, ws.max_row + 1):
        name = ws.cell(row=row, column=name_col).value
        if name is None or str(name).strip() == "":
            continue
        name = str(name).strip()

        if roll_col:
            roll_val = ws.cell(row=row, column=roll_col).value
            roll = str(roll_val).strip() if roll_val not in (None, "") else str(auto_roll)
        elif roll_lookup and roll_idx < len(roll_lookup):
            r_roll, r_name = roll_lookup[roll_idx]
            if r_name != name:
                warnings.append(
                    f"সারি {row}: শিটের নাম '{name}' রোস্টারের নাম '{r_name}' (অবস্থান {roll_idx}) থেকে আলাদা — "
                    f"তবুও রোস্টারের Roll ব্যবহার করা হয়েছে, একবার মিলিয়ে দেখুন।"
                )
            roll = r_roll
        else:
            roll = str(auto_roll)
        roll_idx += 1

        subj_rows = []
        for subj_name, total_col, obtained_col, grade_col in subjects:
            total = ws.cell(row=row, column=total_col).value
            obtained = ws.cell(row=row, column=obtained_col).value
            total = total if isinstance(total, (int, float)) else 0
            obtained = obtained if isinstance(obtained, (int, float)) else None
            if obtained is None:
                blank_mark_counts[subj_name] += 1
            if total == 0:
                blank_total_subjects.add(subj_name)
            grade = eval_grade(subj_rules.get(subj_name), obtained, total)
            subj_rows.append({
                "name": subj_name,
                "total": total,
                "obtained": obtained if obtained is not None else 0,
                "grade": grade
            })

        students.append({
            "roll": roll,
            "name": name,
            "class": exam_class,
            "section": section,
            "subjects": subj_rows
        })
        auto_roll += 1

    # --- admin checks: run after all rows are read ---

    # 1) duplicate roll numbers
    roll_to_names = {}
    for s in students:
        roll_to_names.setdefault(s["roll"], []).append(s["name"])
    for roll, names in roll_to_names.items():
        if len(names) > 1:
            warnings.append(f"ডুপ্লিকেট Roll '{roll}': {', '.join(names)} — একই Roll একাধিক শিক্ষার্থীর নামে ব্যবহৃত হয়েছে।")

    # 2) subjects where a total number of marks was never set (whole column looks unconfigured)
    for subj_name in blank_total_subjects:
        warnings.append(f"বিষয় '{subj_name}': 'মোট নম্বর' কলামে কোনো মান পাওয়া যায়নি (0 ধরা হয়েছে) — কলাম ম্যাপিং যাচাই করুন।")

    # 3) subjects with a lot of blank obtained-marks cells
    for subj_name, blanks in blank_mark_counts.items():
        if blanks > 0:
            warnings.append(
                f"বিষয় '{subj_name}': {blanks} জন শিক্ষার্থীর 'প্রাপ্ত নম্বর' খালি পাওয়া গেছে (0 ধরে গ্রেড হিসাব হয়েছে) — "
                f"ইচ্ছাকৃত না হলে শিট আবার দেখুন।"
            )

    # 4) no students detected at all
    if not students:
        warnings.append("কোনো শিক্ষার্থীর ডেটা পাওয়া যায়নি — 'নাম' কলামের নিচের সারিগুলো ফাঁকা কিনা যাচাই করুন।")

    exam_label = exam_label or exam_name or exam_id
    # exam_class_full lets a caller (e.g. scripts/sync_marks.py, reusing an
    # existing exams.json entry) pass the already-formatted class string
    # directly, instead of having it rebuilt from exam_class + section.
    if not exam_class_full:
        exam_class_full = f"{exam_class} শ্রেণি" + (f" ({section})" if section else "")

    # --- 1) write this exam's OWN file: results/<exam-id>.json ---
    os.makedirs(results_dir, exist_ok=True)
    exam_file_rel = f"{results_dir}/{exam_id}.json"
    exam_file_data = {
        "id": exam_id,
        "label": exam_label,
        "examClass": exam_class_full,
        "students": students
    }
    with open(exam_file_rel, "w", encoding="utf-8") as f:
        json.dump(exam_file_data, f, ensure_ascii=False, indent=2)

    # --- 2) update (or create) the index file, touching only this exam's entry ---
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            index_data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        index_data = None

    if not index_data or "exams" not in index_data:
        index_data = {
            "school": {
                "name": school_name,
                "address": school_address,
                "logo": "logo.png"
            },
            "exams": []
        }
    else:
        index_data["school"]["name"] = school_name or index_data["school"].get("name")
        index_data["school"]["address"] = school_address or index_data["school"].get("address")

    index_entry = {
        "id": exam_id,
        "label": exam_label,
        "examClass": exam_class_full,
        "file": exam_file_rel,
        "studentCount": len(students)
    }
    exams_index = index_data["exams"]
    idx = next((i for i, e in enumerate(exams_index) if e["id"] == exam_id), None)
    if idx is not None:
        # আগের এন্ট্রির publishAt (প্রকাশের সময়) যেন আপডেটে মুছে না যায়
        if exams_index[idx].get("publishAt"):
            index_entry["publishAt"] = exams_index[idx]["publishAt"]
        # কাউন্টডাউন ব্যানারের ছোট নাম (bannerLabel)-ও যেন মুছে না যায়
        if exams_index[idx].get("bannerLabel"):
            index_entry["bannerLabel"] = exams_index[idx]["bannerLabel"]
        exams_index[idx] = index_entry
    else:
        exams_index.append(index_entry)

    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    return {
        "exam_id": exam_id,
        "exam_label": exam_label,
        "exam_class_full": exam_class_full,
        "exam_file_rel": exam_file_rel,
        "index_path": index_path,
        "student_count": len(students),
        "roll_source": "sheet column" if roll_col else ("roster file" if roll_lookup else "auto-numbered"),
        "subjects": [s[0] for s in subjects],
        "warnings": warnings,
    }


def print_report(report):
    print(f"Wrote {report['student_count']} students -> {report['exam_file_rel']}")
    print(f"Updated index -> {report['index_path']}")
    print(f"Roll source: {report['roll_source']}")
    print(f"Subjects detected: {report['subjects']}")

    print()
    warnings = report["warnings"]
    if warnings:
        print(f"⚠️  {len(warnings)}টা সতর্কতা পাওয়া গেছে — ওয়েবসাইটে আপলোডের আগে যাচাই করে নিন:")
        for i, w in enumerate(warnings, 1):
            print(f"  {i}. {w}")
    else:
        print("✅ কোনো সমস্যা পাওয়া যায়নি — ডেটা যাচাই সম্পন্ন।")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--sheet")
    ap.add_argument("--roll-file")
    ap.add_argument("--roll-sheet")
    ap.add_argument("--exam-name", default=None)
    ap.add_argument("--exam-class", default=None)
    ap.add_argument("--section", default=None)
    ap.add_argument("--exam-id", required=True, help="stable id for this exam, e.g. first_assessment")
    ap.add_argument("--exam-label", default=None, help="text shown in the dropdown, defaults to --exam-name")
    ap.add_argument("--school-name", default="প্রবর্তক স্কুল এন্ড কলেজ")
    ap.add_argument("--school-address", default="পাঁচলাইশ, চট্টগ্রাম")
    ap.add_argument("--results-dir", default="results", help="folder that holds each exam's own JSON file")
    ap.add_argument("--index", default="exams.json", help="the index file the website loads first")
    args = ap.parse_args()

    report = convert_exam(
        args.input,
        args.exam_id,
        sheet=args.sheet,
        roll_file=args.roll_file,
        roll_sheet=args.roll_sheet,
        exam_name=args.exam_name,
        exam_class=args.exam_class,
        section=args.section,
        exam_label=args.exam_label,
        school_name=args.school_name,
        school_address=args.school_address,
        results_dir=args.results_dir,
        index_path=args.index,
    )
    print_report(report)


if __name__ == "__main__":
    main()
