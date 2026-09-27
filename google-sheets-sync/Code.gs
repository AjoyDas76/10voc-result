/**
 * Code.gs
 * -------
 * Google Apps Script version of excel_to_json.py — syncs a marks Google
 * Sheet DIRECTLY to results/<exam-id>.json and exams.json on GitHub, so a
 * teacher only has to type marks into the Sheet and click one menu button.
 * No local Python, no manual file uploads.
 *
 * SETUP (one time): see google-sheets-sync/README.md in this folder.
 *
 * Sheet layout expected (same as the Excel files excel_to_json.py reads):
 *   - a header row with a "নাম" cell (student name column)
 *   - optionally a "Roll" / "রোল" cell in the same header row
 *   - subject blocks to the right, each with a sub-header row containing
 *     "মোট নম্বর" / "প্রাপ্ত নম্বর" / "গ্রেড" (গ্রেড is optional; if its
 *     cell has an IF-formula, that formula's cutoffs are used, otherwise a
 *     fallback grading table is used)
 */

// ===== Grade point map (keep in sync with script.js) =====
const GRADE_POINTS = { "A+": 5.0, "A": 4.0, "A-": 3.5, "B": 3.0, "C": 2.0, "D": 1.0, "F": 0.0 };

const STOP_WORDS = ["জি.পি.এ", "সর্বমোট", "failed", "gpa"];

const FALLBACK_BOUNDARIES = {
  30: [[23, "A+"], [21, "A"], [17, "A-"], [14, "B"], [11, "C"], [8.5, "D"]],
  25: [[17, "A+"], [14.5, "A"], [12.5, "A-"], [10.5, "B"], [8.5, "C"], [6.5, "D"]],
  15: [[11, "A+"], [10, "A"], [8, "A-"], [7, "B"], [6, "C"], [4, "D"]]
};

const FORMULA_RULE_RE = /[A-Z]+\d+\s*(>=|<=|>|<)\s*([\d.]+)\s*,\s*"([^"]*)"/g;

const SETTINGS_SHEET_NAME = "Settings";
const MAPPING_HEADER_ROW = 8; // row that holds the exam-mapping table's column headers
const MAPPING_FIRST_DATA_ROW = MAPPING_HEADER_ROW + 1;

// ===================================================================
// Menu
// ===================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎓 রেজাল্ট পোর্টাল")
    .addItem("🚀 এই শিট ওয়েবসাইটে সিঙ্ক করুন", "syncActiveSheet")
    .addSeparator()
    .addItem("🔑 GitHub টোকেন সেট করুন", "promptForToken")
    .addItem("⚙️ সেটিংস শিট খুলুন/বানান", "openSettingsSheet")
    .addToUi();
}

// ===================================================================
// GitHub token (stored in Script Properties, never written to a cell)
// ===================================================================

function promptForToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    "GitHub Personal Access Token",
    "GitHub-এ Settings → Developer settings → Personal access tokens থেকে " +
      "'repo' (অথবা fine-grained হলে এই repo-র Contents: Read & Write) পারমিশনসহ একটা টোকেন বানিয়ে এখানে পেস্ট করুন:",
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = res.getResponseText().trim();
  if (!token) {
    ui.alert("খালি টোকেন সেভ করা হয়নি।");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("GITHUB_TOKEN", token);
  ui.alert("✅ টোকেন সেভ হয়েছে। এটা স্প্রেডশিটের কোনো সেলে দেখা যাবে না, নিরাপদে স্ক্রিপ্ট প্রপার্টিতে থাকবে।");
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
}

// ===================================================================
// Settings sheet (repo config + exam-id mapping table)
// ===================================================================

function openSettingsSheet() {
  const sheet = ensureSettingsSheet_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
}

function ensureSettingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
  sheet.getRange("A1:B5").setValues([
    ["GitHub owner (ব্যবহারকারী/organization নাম)", ""],
    ["GitHub repository নাম", ""],
    ["Branch", "main"],
    ["স্কুলের নাম", "প্রবর্তক স্কুল এন্ড কলেজ"],
    ["স্কুলের ঠিকানা", "পাঁচলাইশ, চট্টগ্রাম"]
  ]);
  sheet.getRange("A1:A5").setFontWeight("bold");
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 260);

  sheet.getRange("A7").setValue("পরীক্ষার তালিকা — প্রথমবার সিঙ্ক করলে নিচের সারি অটো যোগ হবে, চাইলে নিজে হাতেও এডিট করতে পারেন:");
  sheet.getRange("A7").setFontWeight("bold");

  sheet.getRange(MAPPING_HEADER_ROW, 1, 1, 5).setValues([
    ["শিট ট্যাবের নাম", "Exam ID", "Exam Label", "Exam Class", "Section"]
  ]);
  sheet.getRange(MAPPING_HEADER_ROW, 1, 1, 5).setFontWeight("bold").setBackground("#EAF3EC");
  for (let c = 1; c <= 5; c++) sheet.setColumnWidth(c, 200);

  return sheet;
}

function getConfig_() {
  const sheet = ensureSettingsSheet_();
  const vals = sheet.getRange("B1:B5").getValues();
  const config = {
    owner: String(vals[0][0]).trim(),
    repo: String(vals[1][0]).trim(),
    branch: (String(vals[2][0]).trim() || "main"),
    schoolName: String(vals[3][0]).trim(),
    schoolAddress: String(vals[4][0]).trim()
  };
  if (!config.owner || !config.repo) {
    throw new Error(
      "'Settings' শিটে GitHub owner ও repository নাম দেওয়া হয়নি। মেনু থেকে 'সেটিংস শিট খুলুন/বানান' এ গিয়ে পূরণ করুন।"
    );
  }
  return config;
}

function getExamMappingRow_(sheetName) {
  const sheet = ensureSettingsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < MAPPING_FIRST_DATA_ROW) return null;
  const rows = sheet.getRange(MAPPING_FIRST_DATA_ROW, 1, lastRow - MAPPING_FIRST_DATA_ROW + 1, 5).getValues();
  for (const row of rows) {
    if (String(row[0]).trim() === sheetName) {
      return { examId: String(row[1]).trim(), examLabel: String(row[2]).trim(), examClass: String(row[3]).trim(), section: String(row[4]).trim() };
    }
  }
  return null;
}

function appendExamMappingRow_(sheetName, mapping) {
  const sheet = ensureSettingsSheet_();
  sheet.appendRow([sheetName, mapping.examId, mapping.examLabel, mapping.examClass, mapping.section]);
}

// Asks the teacher, one field at a time, for the exam's id/label/class/section
// the first time a given sheet tab is synced. Returns null if cancelled.
function promptForExamMapping_(sheetName) {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    "প্রথমবার এই শিট সিঙ্ক করছেন",
    `'${sheetName}' ট্যাবের জন্য পরীক্ষার তথ্য একবার দিতে হবে — পরের বার থেকে আর জিজ্ঞাসা করা হবে না।`,
    ui.ButtonSet.OK
  );

  const examId = promptOne_(`Exam ID (স্থায়ী, ইংরেজিতে, যেমন: half_yearly)`, slugify_(sheetName));
  if (examId === null) return null;

  const examLabel = promptOne_(`Exam Label (ড্রপডাউনে যা দেখাবে)`, sheetName);
  if (examLabel === null) return null;

  const examClass = promptOne_(`Exam Class (যেমন: ১০ম)`, "১০ম");
  if (examClass === null) return null;

  const section = promptOne_(`Section (যেমন: ভোকেশনাল, ঐচ্ছিক)`, "ভোকেশনাল");
  if (section === null) return null;

  const mapping = { examId: examId, examLabel: examLabel, examClass: examClass, section: section };
  appendExamMappingRow_(sheetName, mapping);
  return mapping;
}

function promptOne_(label, defaultValue) {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(label, `ডিফল্ট: ${defaultValue}  (খালি রাখলে ডিফল্টই ব্যবহার হবে)`, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  const text = res.getResponseText().trim();
  return text || defaultValue;
}

function slugify_(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "exam";
}

// ===================================================================
// Sheet layout detection (mirrors excel_to_json.py's find_layout)
// ===================================================================

function findLayout_(sheet) {
  const maxRow = Math.min(sheet.getLastRow(), 8);
  const maxCol = Math.min(sheet.getLastColumn(), 6);
  let headerRow = null, nameCol = null, rollCol = null;

  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const v = String(sheet.getRange(r, c).getValue() || "").trim();
      if (v === "নাম") { headerRow = r; nameCol = c; }
      else if (v.toLowerCase() === "roll" || v === "রোল") { rollCol = c; }
    }
  }
  if (headerRow === null) {
    throw new Error("'নাম' হেডার কলাম পাওয়া যায়নি — শিটের লেআউট যাচাই করুন।");
  }
  const subRow = headerRow + 1;
  const lastCol = sheet.getLastColumn();

  const subjectStarts = [];
  for (let c = nameCol + 1; c <= lastCol; c++) {
    const v = sheet.getRange(headerRow, c).getValue();
    if (v === null || v === "") continue;
    const text = String(v).trim();
    if (STOP_WORDS.some((sw) => text.toLowerCase().indexOf(sw) !== -1)) break;
    subjectStarts.push([c, text]);
  }

  const subjects = [];
  for (let i = 0; i < subjectStarts.length; i++) {
    const startCol = subjectStarts[i][0];
    const subjName = subjectStarts[i][1];
    const endCol = i + 1 < subjectStarts.length ? subjectStarts[i + 1][0] : lastCol + 1;
    let totalCol = null, obtainedCol = null, gradeCol = null;
    for (let c = startCol; c < endCol; c++) {
      const label = sheet.getRange(subRow, c).getValue();
      if (label === null || label === "") continue;
      const l = String(label).trim();
      if (l.indexOf("মোট") !== -1) totalCol = c;
      else if (l.indexOf("প্রাপ্ত") !== -1) obtainedCol = c;
      else if (l.indexOf("গ্রেড") !== -1) gradeCol = c;
    }
    if (totalCol && obtainedCol) subjects.push({ name: subjName.trim(), totalCol, obtainedCol, gradeCol });
  }

  return { rollCol, nameCol, firstDataRow: headerRow + 2, subjects };
}

function parseGradeRules_(sheet, sampleRow, gradeCol) {
  if (!gradeCol) return null;
  const formula = sheet.getRange(sampleRow, gradeCol).getFormula();
  if (!formula || !formula.startsWith("=")) return null;
  const rules = [];
  let m;
  FORMULA_RULE_RE.lastIndex = 0;
  while ((m = FORMULA_RULE_RE.exec(formula)) !== null) {
    rules.push({ op: m[1], threshold: parseFloat(m[2]), label: m[3] });
  }
  return rules.length ? rules : null;
}

function evalGrade_(rules, obtained, total) {
  const o = obtained === null ? 0 : obtained;
  if (rules) {
    for (const rule of rules) {
      if (rule.op === ">=" && o >= rule.threshold) return rule.label || "F";
      if (rule.op === ">" && o > rule.threshold) return rule.label || "F";
      if (rule.op === "<=" && o <= rule.threshold) return rule.label || "F";
      if (rule.op === "<" && o < rule.threshold) return rule.label || "F";
    }
    return "F";
  }
  let table = FALLBACK_BOUNDARIES[total];
  if (!table) table = FALLBACK_BOUNDARIES[30].map(([t, g]) => [(t / 30) * total, g]);
  for (const [cutoff, letter] of table) {
    if (o > cutoff) return letter;
  }
  return "F";
}

// ===================================================================
// Parse the active sheet into { students, warnings }
// ===================================================================

function parseMarksSheet_(sheet) {
  const layout = findLayout_(sheet);
  const { rollCol, nameCol, firstDataRow, subjects } = layout;
  if (!subjects.length) {
    throw new Error("কোনো বিষয়ের কলাম (মোট নম্বর/প্রাপ্ত নম্বর) খুঁজে পাওয়া যায়নি — শিটের লেআউট যাচাই করুন।");
  }

  const warnings = [];

  const subjRules = {};
  subjects.forEach((s) => {
    const rules = parseGradeRules_(sheet, firstDataRow, s.gradeCol);
    subjRules[s.name] = rules;
    if (!rules) {
      warnings.push(`বিষয় '${s.name}': গ্রেড কলামে IF-ফর্মুলা পাওয়া যায়নি, ডিফল্ট গ্রেডিং টেবিল ব্যবহার হয়েছে — সীমা যাচাই করুন।`);
    }
  });
  if (!rollCol) {
    warnings.push("শিটে Roll কলাম পাওয়া যায়নি — সারি অনুযায়ী স্বয়ংক্রিয়ভাবে (1,2,3...) Roll বসানো হয়েছে।");
  }

  const lastRow = sheet.getLastRow();
  const students = [];
  const blankMarkCounts = {};
  const blankTotalSubjects = new Set();
  subjects.forEach((s) => (blankMarkCounts[s.name] = 0));

  let autoRoll = 1;
  for (let row = firstDataRow; row <= lastRow; row++) {
    const nameVal = sheet.getRange(row, nameCol).getValue();
    if (nameVal === null || String(nameVal).trim() === "") continue;
    const name = String(nameVal).trim();

    let roll;
    if (rollCol) {
      const rollVal = sheet.getRange(row, rollCol).getValue();
      roll = rollVal !== null && rollVal !== "" ? String(rollVal).trim() : String(autoRoll);
    } else {
      roll = String(autoRoll);
    }

    const subjRows = [];
    subjects.forEach((s) => {
      let total = sheet.getRange(row, s.totalCol).getValue();
      let obtained = sheet.getRange(row, s.obtainedCol).getValue();
      total = typeof total === "number" ? total : 0;
      obtained = typeof obtained === "number" ? obtained : null;
      if (obtained === null) blankMarkCounts[s.name]++;
      if (total === 0) blankTotalSubjects.add(s.name);
      const grade = evalGrade_(subjRules[s.name], obtained, total);
      subjRows.push({ name: s.name, total: total, obtained: obtained !== null ? obtained : 0, grade: grade });
    });

    students.push({ roll, name, subjects: subjRows });
    autoRoll++;
  }

  // duplicate roll check
  const rollToNames = {};
  students.forEach((s) => {
    (rollToNames[s.roll] = rollToNames[s.roll] || []).push(s.name);
  });
  Object.keys(rollToNames).forEach((roll) => {
    if (rollToNames[roll].length > 1) {
      warnings.push(`ডুপ্লিকেট Roll '${roll}': ${rollToNames[roll].join(", ")}।`);
    }
  });

  blankTotalSubjects.forEach((s) => warnings.push(`বিষয় '${s}': 'মোট নম্বর' কলামে কোনো মান পাওয়া যায়নি (0 ধরা হয়েছে)।`));
  Object.keys(blankMarkCounts).forEach((s) => {
    if (blankMarkCounts[s] > 0) {
      warnings.push(`বিষয় '${s}': ${blankMarkCounts[s]} জনের 'প্রাপ্ত নম্বর' খালি পাওয়া গেছে (0 ধরা হয়েছে)।`);
    }
  });
  if (!students.length) warnings.push("কোনো শিক্ষার্থীর ডেটা পাওয়া যায়নি — 'নাম' কলামের নিচের সারিগুলো যাচাই করুন।");

  return { students, warnings };
}

// ===================================================================
// GitHub REST API helpers
// ===================================================================

function githubGetFile_(config, token, path) {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`;
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) {
    throw new Error(`GitHub থেকে ${path} পড়া যায়নি (HTTP ${res.getResponseCode()}): ${res.getContentText()}`);
  }
  const body = JSON.parse(res.getContentText());
  const bytes = Utilities.base64Decode(body.content.replace(/\n/g, ""));
  const text = Utilities.newBlob(bytes).getDataAsString("UTF-8");
  return { sha: body.sha, data: JSON.parse(text) };
}

function githubPutFile_(config, token, path, jsonObj, message, sha) {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
  const content = JSON.stringify(jsonObj, null, 2);
  const payload = {
    message: message,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: config.branch
  };
  if (sha) payload.sha = sha;
  const res = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error(`GitHub-এ ${path} লেখা যায়নি (HTTP ${res.getResponseCode()}): ${res.getContentText()}`);
  }
}

// ===================================================================
// Main sync action (menu entry point)
// ===================================================================

function syncActiveSheet() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();

  if (sheetName === SETTINGS_SHEET_NAME) {
    ui.alert("এটা Settings শিট। যে শিটে নম্বর আছে, সেটা খুলে আবার মেনু থেকে চালান।");
    return;
  }

  const token = getToken_();
  if (!token) {
    ui.alert("প্রথমে মেনু থেকে '🔑 GitHub টোকেন সেট করুন' দিয়ে একটা টোকেন সেভ করুন।");
    return;
  }

  let config;
  try {
    config = getConfig_();
  } catch (err) {
    ui.alert(err.message);
    return;
  }

  let mapping = getExamMappingRow_(sheetName);
  if (!mapping) {
    mapping = promptForExamMapping_(sheetName);
    if (!mapping) return; // cancelled
  }

  let parsed;
  try {
    parsed = parseMarksSheet_(sheet);
  } catch (err) {
    ui.alert("শিট পড়তে সমস্যা হয়েছে", err.message, ui.ButtonSet.OK);
    return;
  }

  if (parsed.warnings.length) {
    const msg = parsed.warnings.map((w, i) => `${i + 1}. ${w}`).join("\n");
    const res = ui.alert(
      `⚠️ ${parsed.warnings.length}টা সতর্কতা পাওয়া গেছে`,
      msg + "\n\nএগুলো সত্ত্বেও ওয়েবসাইটে সিঙ্ক করতে চান?",
      ui.ButtonSet.YES_NO
    );
    if (res !== ui.Button.YES) return;
  }

  const examClassFull = mapping.examClass + " শ্রেণি" + (mapping.section ? ` (${mapping.section})` : "");
  const examFilePath = `results/${mapping.examId}.json`;
  const examFileData = { id: mapping.examId, label: mapping.examLabel, examClass: examClassFull, students: parsed.students };

  try {
    // 1) exam's own file
    const existingExamFile = githubGetFile_(config, token, examFilePath);
    githubPutFile_(
      config,
      token,
      examFilePath,
      examFileData,
      `Sync ${mapping.examId} from Google Sheets (${parsed.students.length} students)`,
      existingExamFile ? existingExamFile.sha : null
    );

    // 2) index file (exams.json) — only touch this exam's entry
    const indexPath = "exams.json";
    const existingIndex = githubGetFile_(config, token, indexPath);
    const indexData = existingIndex
      ? existingIndex.data
      : { school: { name: config.schoolName, address: config.schoolAddress, logo: "logo.png" }, exams: [] };
    if (config.schoolName) indexData.school.name = config.schoolName;
    if (config.schoolAddress) indexData.school.address = config.schoolAddress;

    const entry = {
      id: mapping.examId,
      label: mapping.examLabel,
      examClass: examClassFull,
      file: examFilePath,
      studentCount: parsed.students.length
    };
    const idx = indexData.exams.findIndex((e) => e.id === mapping.examId);
    if (idx >= 0) indexData.exams[idx] = entry;
    else indexData.exams.push(entry);

    githubPutFile_(config, token, indexPath, indexData, `Update exams.json for ${mapping.examId}`, existingIndex ? existingIndex.sha : null);
  } catch (err) {
    ui.alert("GitHub-এ সিঙ্ক ব্যর্থ হয়েছে", err.message, ui.ButtonSet.OK);
    return;
  }

  ui.alert(
    "✅ সিঙ্ক সম্পন্ন হয়েছে",
    `${parsed.students.length} জন শিক্ষার্থীর ডেটা '${mapping.examLabel}'-এ আপডেট হয়েছে। ১-২ মিনিট পর ওয়েবসাইট রিফ্রেশ করে দেখুন।`,
    ui.ButtonSet.OK
  );
}
