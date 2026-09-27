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

async function loadData() {
  try {
    const res = await fetch("exams.json", { cache: "no-store" });
    if (!res.ok) throw new Error("exams.json fetch failed");
    DATA = await res.json();
    renderLetterhead(DATA.school);
    setupExamSelect(DATA.exams || []);
  } catch (err) {
    console.error(err);
    showError("রেজাল্ট ডেটা লোড করা যায়নি। exams.json ফাইলটি ঠিক আছে কিনা যাচাই করুন।");
  }
}

// Fetches results/<id>.json the first time an exam is selected, then caches it.
async function loadExamStudents(examMeta) {
  if (examCache[examMeta.id]) return examCache[examMeta.id];
  if (!examMeta.file) return null;
  try {
    const res = await fetch(examMeta.file, { cache: "no-store" });
    if (!res.ok) throw new Error(`${examMeta.file} fetch failed`);
    const full = await res.json();
    examCache[examMeta.id] = full;
    return full;
  } catch (err) {
    console.error(err);
    return null;
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

  const examMeta = getCurrentExamMeta();
  const examTag = el("examTag");
  examTag.textContent = examMeta ? [examMeta.examClass, examMeta.label].filter(Boolean).join(" • ") : "";

  const emptyMsg = el("examEmptyMsg");
  const hasData = examMeta && (examMeta.studentCount || 0) > 0;
  emptyMsg.style.display = hasData ? "none" : "block";

  // pre-fetch this exam's result file in the background so the search feels instant
  if (examMeta && hasData) {
    loadExamStudents(examMeta);
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

function renderResult(student) {
  const r = calcResult(student);

  el("studentName").textContent = student.name;
  el("metaRoll").textContent = student.roll;
  el("metaClass").textContent = [student.class, student.section].filter(Boolean).join(" - ");
  const metaGPA = el("metaGPA");
  metaGPA.textContent = r.gpa;
  metaGPA.className = r.pass ? "status-pass" : "status-fail";

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
  searchBtn.disabled = true;
  const exam = await loadExamStudents(examMeta);
  searchBtn.disabled = false;

  if (!exam || !Array.isArray(exam.students) || exam.students.length === 0) {
    showError("এই পরীক্ষার ফলাফল লোড করা যায়নি। ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন।");
    return;
  }

  const student = exam.students.find((s) => String(s.roll).trim() === roll);
  if (!student) {
    showError("এই Roll Number-এ কোনো ফলাফল পাওয়া যায়নি। Roll Number আবার যাচাই করুন।");
    return;
  }

  renderResult(student);
}

el("searchBtn").addEventListener("click", search);
el("rollInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});
el("printBtn").addEventListener("click", () => window.print());

loadData();
