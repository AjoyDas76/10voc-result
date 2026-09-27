// ===== Grade point map (edit here if your board uses different values) =====
const GRADE_POINTS = {
  "A+": 5.0,
  "A": 4.0,
  "A-": 3.5,
  "B": 3.0,
  "C": 2.0,
  "D": 1.0,
  "F": 0.0
};

let DATA = null; // { school, exams: [{id,label,examClass,file}] } — index only, no students
const examCache = {}; // examId -> full exam object (with students), filled in lazily
let currentExamId = null;

const el = (id) => document.getElementById(id);

function showLoading() {
  el("loadingBar").classList.add("active");
}

function hideLoading() {
  el("loadingBar").classList.remove("active");
}

async function loadData() {
  showLoading();
  try {
    const res = await fetch("exams.json", { cache: "no-store" });
    if (!res.ok) throw new Error("exams.json fetch failed");
    DATA = await res.json();
    renderLetterhead(DATA.school);
    setupExamSelect(DATA.exams || []);
  } catch (err) {
    console.error(err);
    showError("রেজাল্ট ডেটা লোড করা যায়নি। exams.json ফাইলটি ঠিক আছে কিনা যাচাই করুন।");
  } finally {
    hideLoading();
  }
}

// Fetches results/<id>.json the first time an exam is selected, then caches it.
async function loadExamStudents(examMeta, { silent } = {}) {
  if (examCache[examMeta.id]) return examCache[examMeta.id];
  if (!examMeta.file) return null;
  if (!silent) showLoading();
  try {
    const res = await fetch(examMeta.file, { cache: "no-store" });
    if (!res.ok) throw new Error(`${examMeta.file} fetch failed`);
    const full = await res.json();
    examCache[examMeta.id] = full;
    return full;
  } catch (err) {
    console.error(err);
    return null;
  } finally {
    if (!silent) hideLoading();
  }
}

function renderLetterhead(school) {
  if (!school) return;
  el("schoolName").textContent = school.name || "";
  el("schoolAddress").textContent = school.address || "";
  document.title = (school.name ? school.name + " - " : "") + "Result Portal";

  const logoImg = el("schoolLogo");
  const fallback = el("schoolLogoFallback");
  if (school.logo) {
    logoImg.src = school.logo;
    logoImg.style.display = "block";
    fallback.style.display = "none";
    logoImg.onerror = () => {
      logoImg.style.display = "none";
      fallback.style.display = "flex";
    };
  } else {
    logoImg.style.display = "none";
    fallback.style.display = "flex";
  }
  fallback.textContent = (school.name || "?").trim().charAt(0);
}

function setupExamSelect(exams) {
  const select = el("examSelect");
  select.innerHTML = "";

  if (!exams.length) {
    const opt = document.createElement("option");
    opt.textContent = "কোনো পরীক্ষা পাওয়া যায়নি";
    select.appendChild(opt);
    return;
  }

  exams.forEach((exam) => {
    const opt = document.createElement("option");
    opt.value = exam.id;
    opt.textContent = exam.label || exam.id;
    select.appendChild(opt);
  });

  // default to the last exam that actually has published results, else the first
  const withData = exams.filter((e) => (e.studentCount || 0) > 0);
  const defaultExam = withData.length ? withData[withData.length - 1] : exams[0];
  select.value = defaultExam.id;

  onExamChange();
  select.addEventListener("change", onExamChange);
}

function getCurrentExamMeta() {
  if (!DATA || !Array.isArray(DATA.exams)) return null;
  return DATA.exams.find((e) => e.id === currentExamId) || null;
}

async function onExamChange() {
  currentExamId = el("examSelect").value;
  hideError();
  el("resultCard").style.display = "none";
  el("rollInput").value = "";
  hideMeritList();

  const examMeta = getCurrentExamMeta();
  const examTag = el("examTag");
  examTag.textContent = examMeta ? [examMeta.examClass, examMeta.label].filter(Boolean).join(" • ") : "";

  const emptyMsg = el("examEmptyMsg");
  const hasData = examMeta && (examMeta.studentCount || 0) > 0;
  emptyMsg.style.display = hasData ? "none" : "block";

  // pre-fetch this exam's result file in the background so the search feels instant
  const loadingMsg = el("examLoadingMsg");
  if (examMeta && hasData && !examCache[examMeta.id]) {
    loadingMsg.classList.add("active");
    await loadExamStudents(examMeta, { silent: true });
    loadingMsg.classList.remove("active");
  } else {
    loadingMsg.classList.remove("active");
  }
}

function showError(msg) {
  const box = el("errorMsg");
  box.textContent = msg;
  box.style.display = "block";
}

function hideError() {
  el("errorMsg").style.display = "none";
}

function calcResult(student) {
  const subjects = student.subjects || [];
  let hasFail = false;
  let failCount = 0;
  let total = 0;

  const rows = subjects.map((s) => {
    const point = GRADE_POINTS[s.grade];
    const point_ = point === undefined ? 0 : point;
    const isFail = s.grade === "F";
    if (isFail) {
      hasFail = true;
      failCount++;
    }
    total += point_;
    return {
      name: s.name,
      total: s.total !== undefined ? s.total : null,
      obtained: s.obtained !== undefined ? s.obtained : null,
      grade: s.grade,
      point: point_,
      isFail
    };
  });

  const rawAvg = subjects.length ? total / subjects.length : 0;
  const gpa = hasFail ? 0 : rawAvg;

  return {
    rows,
    gpa: gpa.toFixed(2),
    pass: !hasFail,
    failCount
  };
}

// Ranks students within an exam by GPA (passed students only; ties share a rank).
// Returns a Map of roll -> { rank, totalPassed, totalStudents }.
function computeRanks(students) {
  const withResult = students.map((s) => ({ student: s, r: calcResult(s) }));
  const passed = withResult
    .filter((x) => x.r.pass)
    .sort((a, b) => parseFloat(b.r.gpa) - parseFloat(a.r.gpa));

  const rankMap = new Map();
  let rank = 0;
  let prevGpa = null;
  let position = 0;
  passed.forEach((x) => {
    position++;
    if (x.r.gpa !== prevGpa) {
      rank = position;
      prevGpa = x.r.gpa;
    }
    rankMap.set(String(x.student.roll).trim(), rank);
  });

  return { rankMap, totalPassed: passed.length, totalStudents: students.length };
}

let lastRenderedStudent = null;
let lastRenderedExamMeta = null;

function renderResult(student, exam, examMeta) {
  const r = calcResult(student);
  lastRenderedStudent = student;
  lastRenderedExamMeta = examMeta;

  el("studentName").textContent = student.name;
  el("metaRoll").textContent = student.roll;
  el("metaClass").textContent = [student.class, student.section].filter(Boolean).join(" - ");
  const metaGPA = el("metaGPA");
  metaGPA.textContent = r.gpa;
  metaGPA.className = r.pass ? "status-pass" : "status-fail";

  const metaRank = el("metaRank");
  if (r.pass && Array.isArray(exam.students)) {
    const { rankMap, totalPassed } = computeRanks(exam.students);
    const rank = rankMap.get(String(student.roll).trim());
    metaRank.textContent = rank ? `${rank} / ${totalPassed} জনের মধ্যে` : "-";
  } else {
    metaRank.textContent = "প্রযোজ্য নয়";
  }

  const tbody = el("subjectRows");
  tbody.innerHTML = "";
  r.rows.forEach((row) => {
    const tr = document.createElement("tr");
    const totalCell = row.total !== null ? row.total : "—";
    const obtainedCell = row.obtained !== null ? row.obtained : "—";
    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(totalCell)}</td>
      <td>${escapeHtml(obtainedCell)}</td>
      <td><span class="grade-pill ${row.isFail ? "fail" : ""}">${escapeHtml(row.grade)}</span></td>
      <td>${row.point.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });

  const statusEl = el("statusValue");
  statusEl.textContent = r.pass ? "উত্তীর্ণ" : "অনুত্তীর্ণ";
  statusEl.className = "value " + (r.pass ? "status-pass" : "status-fail");

  el("gpaValue").textContent = r.gpa;
  el("failValue").textContent = r.failCount;

  const failBox = el("failBox");
  const summaryGrid = failBox.parentElement;
  if (r.pass) {
    failBox.style.display = "none";
    summaryGrid.classList.add("two-col");
  } else {
    failBox.style.display = "";
    summaryGrid.classList.remove("two-col");
  }

  el("resultCard").style.display = "block";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function search() {
  hideError();
  el("resultCard").style.display = "none";

  const roll = el("rollInput").value.trim();
  if (!roll) {
    showError("অনুগ্রহ করে একটি Roll Number লিখুন।");
    return;
  }

  const examMeta = getCurrentExamMeta();
  if (!examMeta) {
    showError("পরীক্ষা নির্বাচন করা যায়নি, একটু পর আবার চেষ্টা করুন।");
    return;
  }
  if (!(examMeta.studentCount > 0)) {
    showError("এই পরীক্ষার ফলাফল এখনো প্রকাশিত হয়নি।");
    return;
  }

  const searchBtn = el("searchBtn");
  const originalBtnText = searchBtn.textContent;
  searchBtn.disabled = true;
  searchBtn.textContent = "খুঁজছি...";
  const exam = await loadExamStudents(examMeta);
  searchBtn.disabled = false;
  searchBtn.textContent = originalBtnText;

  if (!exam || !Array.isArray(exam.students) || exam.students.length === 0) {
    showError("এই পরীক্ষার ফলাফল লোড করা যায়নি। ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন।");
    return;
  }

  const student = exam.students.find((s) => String(s.roll).trim() === roll);
  if (!student) {
    showError("এই Roll Number-এ কোনো ফলাফল পাওয়া যায়নি। Roll Number আবার যাচাই করুন।");
    return;
  }

  renderResult(student, exam, examMeta);
}

// ===== Share result =====
async function shareResult() {
  if (!lastRenderedStudent) return;
  const r = calcResult(lastRenderedStudent);
  const examLabel = lastRenderedExamMeta ? lastRenderedExamMeta.label : "";
  const lines = [
    examLabel,
    `${lastRenderedStudent.name} (Roll: ${lastRenderedStudent.roll})`,
    `GPA: ${r.gpa} — ${r.pass ? "উত্তীর্ণ" : "অনুত্তীর্ণ"}`,
    location.href.split("?")[0].split("#")[0]
  ].filter(Boolean);
  const text = lines.join("\n");

  if (navigator.share) {
    try {
      await navigator.share({ title: "রেজাল্ট", text });
    } catch (err) {
      // user cancelled the native share sheet — nothing to do
    }
    return;
  }

  const waUrl = "https://wa.me/?text=" + encodeURIComponent(text);
  window.open(waUrl, "_blank", "noopener");
}

// ===== Merit list (full class result sheet) =====
function hideMeritList() {
  el("meritSection").style.display = "none";
  el("meritToggleBtn").textContent = "📋 সম্পূর্ণ মেধাতালিকা দেখুন";
}

async function toggleMeritList() {
  const section = el("meritSection");
  const btn = el("meritToggleBtn");

  if (section.style.display !== "none") {
    hideMeritList();
    return;
  }

  const examMeta = getCurrentExamMeta();
  if (!examMeta || !(examMeta.studentCount > 0)) {
    showError("এই পরীক্ষার ফলাফল এখনো প্রকাশিত হয়নি।");
    return;
  }

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "লোড হচ্ছে...";
  const exam = await loadExamStudents(examMeta);
  btn.disabled = false;

  if (!exam || !Array.isArray(exam.students) || exam.students.length === 0) {
    btn.textContent = originalText;
    showError("মেধাতালিকা লোড করা যায়নি। ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন।");
    return;
  }

  renderMeritList(exam, examMeta);
  btn.textContent = "🔼 মেধাতালিকা বন্ধ করুন";
  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderMeritList(exam, examMeta) {
  const { rankMap } = computeRanks(exam.students);

  const rowsData = exam.students.map((s) => {
    const r = calcResult(s);
    const rank = r.pass ? rankMap.get(String(s.roll).trim()) : null;
    return { student: s, r, rank };
  });

  // passed students first (by rank), then failed students (by roll)
  rowsData.sort((a, b) => {
    if (a.r.pass !== b.r.pass) return a.r.pass ? -1 : 1;
    if (a.r.pass) return a.rank - b.rank;
    return String(a.student.roll).localeCompare(String(b.student.roll), "en", { numeric: true });
  });

  el("meritTitle").textContent = `মেধাতালিকা — ${examMeta.label || ""}`;

  const tbody = el("meritRows");
  tbody.innerHTML = "";
  rowsData.forEach(({ student, r, rank }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rank !== null ? rank : "—"}</td>
      <td>${escapeHtml(student.roll)}</td>
      <td>${escapeHtml(student.name)}</td>
      <td class="${r.pass ? "status-pass" : "status-fail"}">${r.gpa}</td>
      <td class="${r.pass ? "status-pass" : "status-fail"}">${r.pass ? "উত্তীর্ণ" : "অনুত্তীর্ণ"}</td>
    `;
    tbody.appendChild(tr);
  });
}

el("searchBtn").addEventListener("click", search);
el("rollInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});
el("printBtn").addEventListener("click", () => window.print());
el("shareBtn").addEventListener("click", shareResult);
el("meritToggleBtn").addEventListener("click", toggleMeritList);
el("meritCloseBtn").addEventListener("click", hideMeritList);

loadData();
