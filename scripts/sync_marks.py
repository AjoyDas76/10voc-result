"""
sync_marks.py
--------------
Entry point for the GitHub Actions workflow (.github/workflows/sync-marks.yml).
Not meant to be run by hand — just drop a filled marksheet into marks/<exam-id>.xlsx
and push; the workflow runs this script, which:

  1. finds every marks/*.xlsx file
  2. for each, works out the exam's id/label/class/section (see below)
  3. calls excel_to_json.convert_exam() to (re)write results/<exam-id>.json
     and update exams.json
  4. prints a combined report; the workflow commits whatever changed

Where exam-id / label / class / section come from, in priority order:

  1. marks/<exam-id>.meta.json, if present:
       { "label": "...", "class": "...", "section": "..." }
     Only needed once per exam — add it the first time you introduce a new
     exam id. Re-uploading the same .xlsx later does not need it again.
  2. the matching entry already in exams.json (so re-uploading an exam's
     .xlsx to update marks keeps its existing label/class unchanged)
  3. built-in defaults (১০ম / ভোকেশনাল), with a warning asking the admin
     to add a .meta.json for a nicer dropdown label.

exam-id itself is always the .xlsx file's name without the extension —
keep it short, stable, English, e.g. first_assessment.xlsx, half_yearly.xlsx.
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import excel_to_json  # noqa: E402

MARKS_DIR = "marks"
RESULTS_DIR = "results"
INDEX_PATH = "exams.json"
DEFAULT_CLASS = "১০ম"
DEFAULT_SECTION = "ভোকেশনাল"


def load_existing_index():
    try:
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def find_existing_entry(index_data, exam_id):
    if not index_data or "exams" not in index_data:
        return None
    return next((e for e in index_data["exams"] if e["id"] == exam_id), None)


def resolve_exam_meta(exam_id, existing_entry):
    """Returns (label, class_full, warnings) for this exam id."""
    meta_path = os.path.join(MARKS_DIR, f"{exam_id}.meta.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        label = meta.get("label") or exam_id
        klass = meta.get("class", DEFAULT_CLASS)
        section = meta.get("section", "")
        class_full = f"{klass} শ্রেণি" + (f" ({section})" if section else "")
        return label, class_full, []

    if existing_entry:
        return existing_entry["label"], existing_entry["examClass"], []

    # brand-new exam id, no meta file — fall back to sensible defaults
    warning = (
        f"'{exam_id}' একটা নতুন Exam ID মনে হচ্ছে এবং marks/{exam_id}.meta.json পাওয়া যায়নি, "
        f"তাই ডিফল্ট ক্লাস/লেবেল ব্যবহার হয়েছে। সঠিক নাম দেখাতে marks/{exam_id}.meta.json "
        f'বানিয়ে {{"label": "...", "class": "...", "section": "..."}} দিন, তারপর আবার পুশ করুন।'
    )
    class_full = f"{DEFAULT_CLASS} শ্রেণি ({DEFAULT_SECTION})"
    return exam_id, class_full, [warning]


def apply_publish_at(exam_id):
    """marks/<exam-id>.meta.json-এ "publishAt" থাকলে সেটা exams.json-এ বসায়।
    (মুছে দিলে বা "" দিলে exams.json থেকেও সরে যায় — মানে সাথে সাথে প্রকাশ।)"""
    meta_path = os.path.join(MARKS_DIR, f"{exam_id}.meta.json")
    if not os.path.exists(meta_path):
        return
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    if "publishAt" not in meta:
        return
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        index_data = json.load(f)
    entry = find_existing_entry(index_data, exam_id)
    if not entry:
        return
    if meta["publishAt"]:
        entry["publishAt"] = meta["publishAt"]
    else:
        entry.pop("publishAt", None)
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)


def main():
    xlsx_files = sorted(glob.glob(os.path.join(MARKS_DIR, "*.xlsx")))
    if not xlsx_files:
        print(f"'{MARKS_DIR}/' ফোল্ডারে কোনো .xlsx ফাইল পাওয়া যায়নি — কিছু করার নেই।")
        return

    any_errors = False
    for path in xlsx_files:
        exam_id = os.path.splitext(os.path.basename(path))[0]
        print(f"\n=== {path}  (exam-id: {exam_id}) ===")

        index_data = load_existing_index()
        existing_entry = find_existing_entry(index_data, exam_id)
        label, class_full, meta_warnings = resolve_exam_meta(exam_id, existing_entry)

        try:
            report = excel_to_json.convert_exam(
                path,
                exam_id,
                exam_label=label,
                exam_class_full=class_full,
                results_dir=RESULTS_DIR,
                index_path=INDEX_PATH,
            )
        except Exception as err:  # noqa: BLE001 — surface any parse error per-file, keep going
            print(f"❌ '{path}' প্রসেস করা যায়নি: {err}")
            any_errors = True
            continue

        apply_publish_at(exam_id)

        report["warnings"] = meta_warnings + report["warnings"]
        excel_to_json.print_report(report)

    if any_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
