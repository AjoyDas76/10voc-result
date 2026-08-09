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

let DATA = null;

const el = (id) => document.getElementById(id);

async function loadData() {
  try {
    const res = await fetch("results.json", { cache: "no-store" });
    if (!res.ok) throw new Error("results.json fetch failed");
    DATA = await res.json();
    renderLetterhead(DATA.school);
  } catch (err) {
    console.error(err);
    showError("রেজাল্ট ডেটা লোড করা যায়নি। results.json ফাইলটি ঠিক আছে কিনা যাচাই করুন।");
  }
}

function renderLetterhead(school) {
  if (!school) return;
  el("schoolName").textContent = school.name || "";
  el("schoolAddress").textContent = school.address || "";
  el("examTag").textContent = [school.examClass, school.examName].filter(Boolean).join(" • ");
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

  const seal = el("seal");
  seal.classList.toggle("fail", !r.pass);
  el("sealValue").textContent = r.gpa;

  const statusEl = el("statusValue");
  statusEl.textContent = r.pass ? "উত্তীর্ণ" : "অনুত্তীর্ণ";
  statusEl.className = "value " + (r.pass ? "status-pass" : "status-fail");

  el("gpaValue").textContent = r.gpa;
  el("failValue").textContent = r.failCount;

  el("resultCard").style.display = "block";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function search() {
  hideError();
  el("resultCard").style.display = "none";

  const roll = el("rollInput").value.trim();
  if (!roll) {
    showError("অনুগ্রহ করে একটি Roll Number লিখুন।");
    return;
  }
  if (!DATA || !Array.isArray(DATA.students)) {
    showError("রেজাল্ট ডেটা এখনো লোড হয়নি, একটু পর আবার চেষ্টা করুন।");
    return;
  }

  const student = DATA.students.find((s) => String(s.roll).trim() === roll);
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
