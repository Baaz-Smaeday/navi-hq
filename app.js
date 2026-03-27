/* ============================================================
   XEagle ComplianceOS v10 — Premium Edition
   Apple/Linear design · Dark/Light mode · Firebase
   ============================================================ */
"use strict";

/* ═══ FIREBASE CONFIG ═════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAKF15iHwuBfkCv5fPS9Veq2HHI2dO3k6A",
  authDomain: "xeagle-compliance.firebaseapp.com",
  projectId: "xeagle-compliance",
  storageBucket: "xeagle-compliance.firebasestorage.app",
  messagingSenderId: "866853942732",
  appId: "1:866853942732:web:b736e3e8f0d16c865ed969"
};

let fb, auth, db, storage;
let CU = null, CUDoc = null, D = {}, unsubs = [], docCache = [];
let selOffice = "ALL", soundOn = false, calYear, calMonth, curPage = "dashboard";

/* ═══ HELPERS ═════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const h = s => s == null ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function fd(d) { if (!d) return "—"; const x = new Date(d); return isNaN(x) ? "—" : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }
function iso() { return new Date().toISOString().slice(0, 10) }
function dfn(d) { if (!d) return Infinity; const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0); return Math.round((x - t) / 864e5) }
function en(e) { return e.firstName + " " + e.lastName }
function ebi(id) { return (D.employees || []).find(e => e.id === id) }
function uid(p) { return p + "-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase() }
function settled(e) { const n = (e.nationality || "").toLowerCase(), s = (e.immigrationStatus || "").toLowerCase(); return n === "british" || n === "irish" || s.includes("british") || s.includes("settled") }
function fmtSz(b) { if (b < 1024) return b + "B"; if (b < 1048576) return (b / 1024).toFixed(1) + "KB"; return (b / 1048576).toFixed(1) + "MB" }
function fIco(t) { if (!t) return "&#128196;"; if (t.startsWith("image/")) return "&#128247;"; if (t.includes("pdf")) return "&#128213;"; return "&#128196;" }
function ic(l, v, m) { return `<div class="ii"><div class="il">${l}</div><div class="iv${m ? ' mono' : ''}">${v}</div></div>` }
function offName(id) { const o = (D.offices || []).find(x => x.id === id); return o ? o.name : "—" }
function isAdmin() { return CUDoc && CUDoc.role === "admin" }
function filtEmp() { let list = (D.employees || []).filter(e => e.status !== "Deleted"); if (!isAdmin() && CUDoc && CUDoc.employeeId) return list.filter(e => e.id === CUDoc.employeeId); if (selOffice !== "ALL") list = list.filter(e => e.office === selOffice); return list }
function syncStatus(s) { const dot = $("#sync-dot"), txt = $("#sync-text"); if (dot) dot.className = "sync-dot " + s; if (txt) txt.textContent = s === "online" ? "Connected" : s === "syncing" ? "Syncing…" : "Offline" }

/* ═══ FIREBASE INIT ═══════════════════════════════════════════ */
function initFirebase() {
  if (FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
    $("#loading").innerHTML = `<div style="text-align:center;max-width:500px;padding:24px"><div style="font-size:1.4rem;font-weight:700;margin-bottom:12px">&#9888; Firebase Not Configured</div><div style="font-size:.9rem;opacity:.8;line-height:1.6">Open <b>app.js</b> and replace <b>FIREBASE_CONFIG</b> with your Firebase project credentials.</div></div>`;
    return false;
  }
  fb = firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth(); db = firebase.firestore(); storage = firebase.storage();
  db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn("Persistence:", e));
  return true;
}

/* ═══ AUTH ═════════════════════════════════════════════════════ */
const ACCESS_PIN = "25784";
function doLogin() {
  const pin = ($("#l-pin") || {}).value || "";
  if (!pin) { $("#l-err").textContent = "Enter PIN."; return }
  if (pin !== ACCESS_PIN) { $("#l-err").textContent = "Incorrect PIN."; return }
  $("#l-err").textContent = "Signing in…";
  CU = { uid: "local-admin", email: "admin@navihq.local" };
  CUDoc = { id: "local-admin", displayName: "Admin", role: "admin", employeeId: "", office: "OFF01" };
  sessionStorage.setItem("navi-pin-auth", "true");
  showApp();
}
function logout() { unsubs.forEach(fn => fn()); unsubs = []; sessionStorage.removeItem("navi-pin-auth"); CU = null; CUDoc = null; $("#loading").classList.add("login-hidden"); $("#app-wrap").classList.add("login-hidden"); $("#login-screen").classList.remove("login-hidden"); }
function onAuthChange(user) {
  if (user || sessionStorage.getItem("navi-pin-auth")) {
    if (!CU) { CU = user || { uid: "local-admin", email: "admin@navihq.local" }; }
    if (!CUDoc) { CUDoc = { id: CU.uid, displayName: "Admin", role: "admin", employeeId: "", office: "OFF01" }; }
    showApp();
  } else {
    CU = null; CUDoc = null;
    $("#loading").classList.add("login-hidden");
    $("#app-wrap").classList.add("login-hidden");
    $("#login-screen").classList.remove("login-hidden");
  }
}

/* ═══ FIRESTORE LAYER ═════════════════════════════════════════ */
function initD() { D = { company: {}, offices: [], transportManager: {}, employees: [], attendanceRecords: [], reportingLog: [], vehicles: [], vehicleActions: [], training: [], hrCases: [], cosRecords: [], sponsorHub: {} } }

function listenAll() {
  unsubs.forEach(fn => fn()); unsubs = []; syncStatus("syncing");
  unsubs.push(db.collection("settings").doc("company").onSnapshot(doc => { D.company = doc.exists ? doc.data() : {}; ra() }));
  unsubs.push(db.collection("settings").doc("transportManager").onSnapshot(doc => { D.transportManager = doc.exists ? doc.data() : {}; ra() }));
  unsubs.push(db.collection("settings").doc("sponsorHub").onSnapshot(doc => { D.sponsorHub = doc.exists ? doc.data() : {}; ra() }));
  unsubs.push(db.collection("offices").orderBy("name").onSnapshot(snap => {
    D.offices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (D.offices.length === 0 && isAdmin()) seedDefaults();
    buildOfficeSelect(); ra();
  }));
  unsubs.push(db.collection("employees").onSnapshot(snap => { D.employees = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  unsubs.push(db.collection("attendance").onSnapshot(snap => { D.attendanceRecords = snap.docs.map(d => d.data()); ra() }));
  unsubs.push(db.collection("reportingLog").onSnapshot(snap => { D.reportingLog = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  unsubs.push(db.collection("vehicles").onSnapshot(snap => { D.vehicles = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  unsubs.push(db.collection("vehicleActions").onSnapshot(snap => { D.vehicleActions = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  unsubs.push(db.collection("docMeta").orderBy("uploadDate", "desc").onSnapshot(snap => { docCache = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  unsubs.push(db.collection("training").onSnapshot(snap => { D.training = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  unsubs.push(db.collection("hrCases").onSnapshot(snap => { D.hrCases = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  unsubs.push(db.collection("cosRecords").onSnapshot(snap => { D.cosRecords = snap.docs.map(d => ({ id: d.id, ...d.data() })); ra() }));
  syncStatus("online");
}

/* Write helpers */
function saveCompanyFS(data) { return db.collection("settings").doc("company").set(data, { merge: true }) }
function saveTMFS(data) { return db.collection("settings").doc("transportManager").set(data) }
function saveEmployeeFS(emp) { return db.collection("employees").doc(emp.id).set(emp) }
function deleteEmployeeFS(id) { return db.collection("employees").doc(id).update({ status: "Deleted" }) }
function saveAttFS(eid, date, status, notes) {
  const docId = eid + "_" + date;
  if (status === "Present" && !notes) return db.collection("attendance").doc(docId).delete().catch(() => {});
  return db.collection("attendance").doc(docId).set({ employeeId: eid, date, status, notes: notes || "" });
}
function saveReportFS(r) { return db.collection("reportingLog").doc(r.id).set(r) }
function closeReportFS(id) { return db.collection("reportingLog").doc(id).update({ status: "Closed" }) }
function saveVehicleFS(v) { return db.collection("vehicles").doc(v.id).set(v) }
function deleteVehicleFS(id) { return db.collection("vehicles").doc(id).delete() }
function saveVehActionFS(a) { return db.collection("vehicleActions").doc(a.id).set(a) }
function closeVehActionFS(id) { return db.collection("vehicleActions").doc(id).update({ status: "Closed", closedDate: iso() }) }
function deleteVehActionFS(id) { return db.collection("vehicleActions").doc(id).delete() }

async function uploadDocFS(file, meta) {
  const docId = uid("DOC"); const ref = storage.ref(`documents/${docId}/${file.name}`);
  const snap = await ref.put(file); const url = await snap.ref.getDownloadURL();
  await db.collection("docMeta").doc(docId).set({ ...meta, id: docId, name: file.name, type: file.type, size: file.size, uploadDate: iso(), url });
}
async function deleteDocFS(id) {
  const meta = docCache.find(d => d.id === id);
  if (meta) { try { await storage.ref(`documents/${id}/${meta.name}`).delete() } catch (e) {} }
  await db.collection("docMeta").doc(id).delete();
}
/* Training */
function saveTrainingFS(t) { return db.collection("training").doc(t.id).set(t) }
function deleteTrainingFS(id) { return db.collection("training").doc(id).delete() }
/* HR Cases */
function saveHRCaseFS(c) { return db.collection("hrCases").doc(c.id).set(c) }
function closeHRCaseFS(id) { return db.collection("hrCases").doc(id).update({ status: "Closed", closedDate: iso() }) }
function deleteHRCaseFS(id) { return db.collection("hrCases").doc(id).delete() }
/* CoS */
function saveCosFS(c) { return db.collection("cosRecords").doc(c.id).set(c) }
function deleteCosFS(id) { return db.collection("cosRecords").doc(id).delete() }
function saveSponsorHubFS(data) { return db.collection("settings").doc("sponsorHub").set(data, { merge: true }) }

async function seedDefaults() {
  syncStatus("syncing"); const batch = db.batch();
  batch.set(db.collection("settings").doc("company"), { name: "XEagle Ltd", companyNumber: "15823876", registeredAddress: "1 Huddersfield Road, Bradford, England, BD6 1DH", phone: "", email: "", website: "", pensionScheme: "NEST", pensionStatus: "Compliant", sponsorLicenceNumber: "", licenceExpiry: "", authorisedOfficer: "", keyContact: "" });
  batch.set(db.collection("settings").doc("transportManager"), { name: "", dob: "", startDate: "", cpcNumber: "", phone: "", email: "" });
  [{ id: "OFF01", name: "Bradford HQ", address: "1 Huddersfield Road, Bradford, BD6 1DH", country: "UK" }, { id: "OFF02", name: "London Office", address: "", country: "UK" }, { id: "OFF03", name: "India Office", address: "", country: "India" }].forEach(o => batch.set(db.collection("offices").doc(o.id), o));
  await batch.commit(); syncStatus("online");
}

/* ═══ ALERT SOUND ═════════════════════════════════════════════ */
let audioCtx = null;
function playAlert() {
  if (!soundOn) return;
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination); o.frequency.value = 880; o.type = "sine"; g.gain.setValueAtTime(.3, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.01, audioCtx.currentTime + .5); o.start(audioCtx.currentTime); o.stop(audioCtx.currentTime + .5);
    setTimeout(() => { const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain(); o2.connect(g2); g2.connect(audioCtx.destination); o2.frequency.value = 660; o2.type = "sine"; g2.gain.setValueAtTime(.3, audioCtx.currentTime); g2.gain.exponentialRampToValueAtTime(.01, audioCtx.currentTime + .4); o2.start(audioCtx.currentTime); o2.stop(audioCtx.currentTime + .4) }, 300);
  } catch (e) {}
}
function toggleSound() { soundOn = !soundOn; const b = $("#alert-bell"); b.classList.toggle("silent", !soundOn); if (soundOn) playAlert() }
function checkAlerts() { const n = getAllAlerts().length; const b = $("#ab-count"); if (b) { b.textContent = n; b.style.display = n > 0 ? "" : "none" } const bb = $("#alert-bell"); if (bb) bb.classList.toggle("silent", !soundOn || n === 0); if (n > 0 && soundOn) playAlert() }

/* ═══ METRICS & ALL ALERTS ════════════════════════════════════ */
function cntVisa() { let n = 0; (D.employees || []).forEach(e => { if (e.status === "Deleted") return; if (settled(e) && !e.isSponsored) return; if (e.visaExpiry && dfn(e.visaExpiry) <= 90) n++; if (e.shareCodeExpiry && dfn(e.shareCodeExpiry) <= 30) n++; if (e.rtwCheckDate && dfn(e.rtwCheckDate) < -365) n++ }); return n }
function cntEmpAlerts() { let n = 0; (D.employees || []).forEach(e => { if (e.status === "Deleted") return; if (!e.rtwEvidenceFile && e.office !== "OFF03") n++; if (e.visaExpiry && dfn(e.visaExpiry) <= 30) n++; if (e.shareCodeExpiry && dfn(e.shareCodeExpiry) <= 14) n++ }); return n }
function cntOpen() { return (D.reportingLog || []).filter(r => r.status === "Open").length }
function cntVehAlerts() { let n = 0; (D.vehicles || []).forEach(v => { if (v.motDueDate && dfn(v.motDueDate) <= 30) n++; if (v.sixWeekDate && dfn(v.sixWeekDate) <= 14) n++; if (v.taxExpiry && dfn(v.taxExpiry) <= 30) n++; if (v.tachoDueDate && dfn(v.tachoDueDate) <= 30) n++ }); n += (D.vehicleActions || []).filter(a => a.status === "Open").length; return n }
function cntTraining() { return (D.training || []).filter(t => t.expiryDate && dfn(t.expiryDate) <= 30).length }
function cntHRCases() { return (D.hrCases || []).filter(c => c.status === "Open").length }
function getRisk() { const s = cntVisa() * 3 + cntOpen() * 3 + cntVehAlerts() + cntEmpAlerts() * 2 + cntTraining() * 2 + cntHRCases(); return s >= 10 ? "High" : s >= 4 ? "Medium" : "Low" }
function badges() { const set = (id, n) => { const el = $(id); if (el) { el.textContent = n; el.style.display = n > 0 ? "" : "none" } }; set("#nb-emp", cntEmpAlerts()); set("#nb-visa", cntVisa()); set("#nb-rpt", cntOpen()); set("#nb-veh", cntVehAlerts()); set("#nb-doc", docCache.length); set("#nb-trn", cntTraining()); set("#nb-hrc", cntHRCases()) }

function getAllAlerts() {
  const alerts = [];
  (D.employees || []).forEach(e => {
    if (e.status === "Deleted") return;
    if (!e.rtwEvidenceFile && e.office !== "OFF03") alerts.push({ type: "cr", cat: "Employee", msg: `${en(e)} — RTW evidence missing`, page: "employees" });
    if (e.visaExpiry) { const d = dfn(e.visaExpiry); if (d < 0) alerts.push({ type: "cr", cat: "Visa", msg: `${en(e)} — Visa EXPIRED`, page: "visa" }); else if (d <= 30) alerts.push({ type: "cr", cat: "Visa", msg: `${en(e)} — Visa expires in ${d}d`, page: "visa" }); else if (d <= 90) alerts.push({ type: "wn", cat: "Visa", msg: `${en(e)} — Visa expires in ${d}d`, page: "visa" }) }
    if (e.shareCodeExpiry) { const d = dfn(e.shareCodeExpiry); if (d < 0) alerts.push({ type: "cr", cat: "Visa", msg: `${en(e)} — Share code EXPIRED`, page: "visa" }); else if (d <= 30) alerts.push({ type: "wn", cat: "Visa", msg: `${en(e)} — Share code expires in ${d}d`, page: "visa" }) }
    if (e.rtwCheckDate && dfn(e.rtwCheckDate) < -365) alerts.push({ type: "wn", cat: "RTW", msg: `${en(e)} — RTW check overdue`, page: "visa" });
  });
  (D.reportingLog || []).forEach(r => { if (r.status !== "Open") return; const emp = r.employeeId ? ebi(r.employeeId) : null; const od = dfn(r.deadline) < 0; alerts.push({ type: od ? "cr" : "wn", cat: "Reporting", msg: `${r.eventType}${emp ? ' — ' + en(emp) : ''} ${od ? 'OVERDUE' : 'due ' + fd(r.deadline)}`, page: "reporting" }) });
  (D.vehicles || []).forEach(v => {
    if (v.motDueDate && dfn(v.motDueDate) <= 30) alerts.push({ type: dfn(v.motDueDate) < 0 ? "cr" : "wn", cat: "Vehicle", msg: `${v.registration} — MOT ${dfn(v.motDueDate) < 0 ? 'EXPIRED' : 'due ' + fd(v.motDueDate)}`, page: "vehicles" });
    if (v.taxExpiry && dfn(v.taxExpiry) <= 30) alerts.push({ type: dfn(v.taxExpiry) < 0 ? "cr" : "wn", cat: "Vehicle", msg: `${v.registration} — Tax ${dfn(v.taxExpiry) < 0 ? 'EXPIRED' : 'due ' + fd(v.taxExpiry)}`, page: "vehicles" });
    if (v.sixWeekDate && dfn(v.sixWeekDate) <= 14) alerts.push({ type: "wn", cat: "Vehicle", msg: `${v.registration} — 6-week due ${fd(v.sixWeekDate)}`, page: "vehicles" });
    if (v.tachoDueDate && dfn(v.tachoDueDate) <= 30) alerts.push({ type: dfn(v.tachoDueDate) < 0 ? "cr" : "wn", cat: "Vehicle", msg: `${v.registration} — Tacho ${dfn(v.tachoDueDate) < 0 ? 'OVERDUE' : 'due ' + fd(v.tachoDueDate)}`, page: "vehicles" });
  });
  (D.vehicleActions || []).forEach(a => { if (a.status !== "Open") return; alerts.push({ type: a.priority === "Urgent" ? "cr" : "wn", cat: "Action", msg: `${a.registration || ''} — ${a.actionType}: ${a.description}`, page: "vehicles" }) });
  // Training expiry
  (D.training || []).forEach(t => {
    if (!t.expiryDate) return; const d = dfn(t.expiryDate); const emp = t.employeeId ? ebi(t.employeeId) : null; const nm = emp ? en(emp) : "Unknown";
    if (d < 0) alerts.push({ type: "cr", cat: "Training", msg: `${nm} — ${t.courseName} EXPIRED`, page: "training" });
    else if (d <= 30) alerts.push({ type: "wn", cat: "Training", msg: `${nm} — ${t.courseName} expires in ${d}d`, page: "training" });
  });
  // Open HR cases
  (D.hrCases || []).forEach(c => {
    if (c.status !== "Open") return; const emp = c.employeeId ? ebi(c.employeeId) : null;
    alerts.push({ type: c.severity === "Serious" ? "cr" : "wn", cat: "HR", msg: `${c.caseType}${emp ? ' — ' + en(emp) : ''}: ${c.subject}`, page: "hrCases" });
  });
  alerts.sort((a, b) => (a.type === "cr" ? 0 : 1) - (b.type === "cr" ? 0 : 1));
  return alerts;
}

function showAlerts() {
  const alerts = getAllAlerts();
  if (alerts.length === 0) { modal("All Clear", `<div style="text-align:center;padding:20px"><div style="font-size:2rem;margin-bottom:8px">&#10003;</div><div style="font-size:1.05rem;font-weight:600;color:var(--ok-fg)">No alerts — everything looks good!</div></div>`); return }
  const rows = alerts.map(a => `<div class="alr ${a.type === 'cr' ? 'alr-r' : 'alr-a'}" style="cursor:pointer" onclick="closeM();go('${a.page}')"><span class="b ${a.type === 'cr' ? 'b-cr' : 'b-wn'}" style="margin-right:6px">${a.cat}</span> ${h(a.msg)}</div>`).join("");
  const crCnt = alerts.filter(a => a.type === "cr").length, wnCnt = alerts.filter(a => a.type === "wn").length;
  modal(`All Alerts (${alerts.length})`, `<div style="display:flex;gap:14px;margin-bottom:14px"><span class="b b-cr">&#9888; ${crCnt} Critical</span><span class="b b-wn">&#9888; ${wnCnt} Warning</span><button class="btn btn-s" style="margin-left:auto" onclick="toggleSound()">&#128264; ${soundOn ? 'Mute' : 'Unmute'}</button></div>${rows}`);
}

/* ═══ NAV ══════════════════════════════════════════════════════ */
const PT = { dashboard: "Dashboard Overview", employees: "Employee Records", visa: "Visa & Right to Work", attendance: "Attendance & Leave", reporting: "Sponsor Reporting", vehicles: "Vehicles / Fleet", documents: "Documents", training: "Training & Certificates", hrCases: "HR Cases", cos: "CoS Tracking", sponsorHub: "Sponsor Licence Hub", reports: "Compliance Reports", users: "User Accounts" };
const NAV_A = [{ p: "dashboard", icon: "&#9632;", label: "Dashboard" }, { p: "employees", icon: "&#9823;", label: "Employees", badge: "nb-emp" }, { p: "visa", icon: "&#10003;", label: "Visa & RTW", badge: "nb-visa" }, { p: "attendance", icon: "&#9998;", label: "Attendance" }, { p: "training", icon: "&#127891;", label: "Training", badge: "nb-trn" }, { p: "hrCases", icon: "&#128220;", label: "HR Cases", badge: "nb-hrc" }, { p: "cos", icon: "&#127963;", label: "CoS Tracking" }, { p: "sponsorHub", icon: "&#127963;", label: "Sponsor Hub" }, { p: "reporting", icon: "&#9872;", label: "Sponsor Reporting", badge: "nb-rpt" }, { p: "vehicles", icon: "&#128666;", label: "Fleet", badge: "nb-veh" }, { p: "documents", icon: "&#128451;", label: "Documents", badge: "nb-doc" }, { p: "reports", icon: "&#128202;", label: "Reports" }, { p: "users", icon: "&#128100;", label: "Users" }];
const NAV_S = [{ p: "dashboard", icon: "&#9632;", label: "Dashboard" }, { p: "employees", icon: "&#9823;", label: "My Profile" }, { p: "attendance", icon: "&#9998;", label: "Attendance" }, { p: "training", icon: "&#127891;", label: "My Training" }, { p: "documents", icon: "&#128451;", label: "My Documents" }];

function buildNav() { const items = isAdmin() ? NAV_A : NAV_S; $("#sb-nav").innerHTML = items.map(n => `<div class="nav-i" data-p="${n.p}"><span class="ni">${n.icon}</span> ${n.label}${n.badge ? ` <span class="nb" id="${n.badge}" style="display:none">0</span>` : ''}</div>`).join(""); $$(".nav-i").forEach(n => n.addEventListener("click", () => go(n.dataset.p))) }
function buildOfficeSelect() { const sel = $("#office-sel"); if (!sel) return; if (!isAdmin()) { sel.innerHTML = `<option>${offName(CUDoc.office)}</option>`; sel.disabled = true; selOffice = CUDoc.office; return } let opts = '<option value="ALL">All Offices</option>'; (D.offices || []).forEach(o => { opts += `<option value="${o.id}">${h(o.name)} (${o.country})</option>` }); sel.innerHTML = opts; sel.disabled = false }
function officeChanged() { selOffice = $("#office-sel").value; ra() }
function go(p, o) { curPage = p; $$(".nav-i").forEach(n => n.classList.toggle("active", n.dataset.p === p)); $$(".pg").forEach(x => x.classList.toggle("active", x.id === "p-" + p)); $("#pg-title").textContent = PT[p] || ""; rp(p, o) }
function rp(p, o) { const fn = { dashboard: rDash, employees: rEmp, visa: rVisa, attendance: rAtt, reporting: rRpt, vehicles: rVeh, documents: rDoc, training: rTraining, hrCases: rHRCases, cos: rCos, sponsorHub: rSponsorHub, reports: rReports, users: rUsers }; if (fn[p]) fn[p](o) }
function ra() { if (!CUDoc) return; rp(curPage); badges(); checkAlerts() }

/* ═══ SHOW APP ════════════════════════════════════════════════ */
function showApp() {
  $("#loading").classList.add("login-hidden"); $("#login-screen").classList.add("login-hidden"); $("#app-wrap").classList.remove("login-hidden");
  $("#su-avatar").textContent = (CUDoc.displayName || "U").charAt(0).toUpperCase();
  $("#su-name").textContent = CUDoc.displayName || CU.email;
  $("#su-role").textContent = isAdmin() ? "Administrator" : "Staff";
  $("#hd-date").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  initD(); buildNav(); listenAll(); go("dashboard");
}
function expJSON() { const b = new Blob([JSON.stringify(D, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "xeagle_" + iso() + ".json"; a.click() }

/* ═══ DASHBOARD ═══════════════════════════════════════════════ */
function rDash() {
  const emps = filtEmp(); const va = cntVisa(), oa = cntOpen(), sp = emps.filter(e => e.isSponsored).length, vh = cntVehAlerts(), ea = cntEmpAlerts(), tc = cntTraining(), hc = cntHRCases();
  const risk = getRisk(), rc = "risk-" + risk.toLowerCase(); const tm = D.transportManager || {}; const co = D.company || {};
  let welcome = "";
  if (isAdmin() && emps.length === 0) { welcome = `<div class="card" style="border-left:4px solid var(--accent)"><div class="card-b" style="text-align:center;padding:30px"><div style="font-size:1.8rem;margin-bottom:8px">&#128075;</div><div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">Welcome to ComplianceOS!</div><div class="sm muted mb3">Your database is connected. Start adding your data.</div><div class="btn-grp" style="justify-content:center"><button class="btn btn-p" onclick="go('employees');setTimeout(()=>editEmp(''),100)">+ Add First Employee</button><button class="btn" onclick="editCompany()">&#9998; Company Info</button></div></div></div>` }
  let ac = "";
  if (isAdmin()) { ac = `<div class="card"><div class="card-h flex-b"><span>Company Information</span><button class="btn btn-s" onclick="editCompany()">&#9998; Edit</button></div><div class="card-b"><div class="ig">${ic("Company", co.name || "—")}${ic("Number", co.companyNumber || "—", 1)}${ic("Licence", co.sponsorLicenceNumber || "—", 1)}${ic("Licence Exp", fd(co.licenceExpiry))}${ic("Address", co.registeredAddress || "—")}${ic("Auth Officer", co.authorisedOfficer || "—")}${ic("Key Contact", co.keyContact || "—")}${ic("Phone", co.phone || "—")}${ic("Email", co.email || "—")}${ic("Pension", (co.pensionScheme || "—") + " — " + (co.pensionStatus || ""))}</div></div></div><div class="card"><div class="card-h flex-b"><span>Transport Manager</span><button class="btn btn-s" onclick="editTM()">&#9998; Edit</button></div><div class="card-b"><div class="ig">${ic("Name", tm.name || "— Not set —")}${ic("DOB", fd(tm.dob))}${ic("CPC", tm.cpcNumber || "—", 1)}${ic("Phone", tm.phone || "—")}</div></div></div>` }
  $("#c-dashboard").innerHTML = `${welcome}<div class="stats">
    <div class="tile t-bl" onclick="go('employees')"><span class="t-icon">&#9823;</span><div class="tl">Employees</div><div class="tv">${emps.length}</div><div class="ts">${sp} sponsored${ea > 0 ? ' · <span style="color:var(--cr-fg)">' + ea + ' alerts</span>' : ''}</div></div>
    ${isAdmin() ? `<div class="tile ${va > 0 ? 't-rd' : 't-gn'}" onclick="go('visa',{ao:true})"><span class="t-icon">&#10003;</span><div class="tl">Visa</div><div class="tv">${va}</div><div class="ts">Alerts</div></div>
    <div class="tile ${oa > 0 ? 't-rd' : 't-gn'}" onclick="go('reporting',{oo:true})"><span class="t-icon">&#9872;</span><div class="tl">Actions</div><div class="tv">${oa}</div><div class="ts">Open</div></div>
    <div class="tile ${vh > 0 ? 't-am' : 't-gn'}" onclick="go('vehicles')"><span class="t-icon">&#128666;</span><div class="tl">Vehicle</div><div class="tv">${vh}</div><div class="ts">Alerts</div></div>
    <div class="tile ${tc > 0 ? 't-am' : 't-gn'}" onclick="go('training')"><span class="t-icon">&#127891;</span><div class="tl">Training</div><div class="tv">${(D.training||[]).length}</div><div class="ts">${tc > 0 ? tc + ' expiring' : 'All current'}</div></div>
    <div class="tile ${hc > 0 ? 't-rd' : 't-gn'}" onclick="go('hrCases')"><span class="t-icon">&#128220;</span><div class="tl">HR Cases</div><div class="tv">${hc}</div><div class="ts">Open</div></div>` : ''}
    <div class="tile t-bl" onclick="go('documents')"><span class="t-icon">&#128451;</span><div class="tl">Docs</div><div class="tv">${docCache.length}</div><div class="ts">Stored</div></div>
  </div>${isAdmin() ? `<div class="card"><div class="card-h">Risk</div><div class="card-b flex-b"><span>Assessment:</span><span class="risk ${rc}">${risk === "Low" ? "&#10003;" : "&#9888;"} ${risk}</span></div></div>` : ''}${ac}
  <div class="card"><div class="card-h">Quick Actions</div><div class="card-b btn-grp">${isAdmin() ? `<button class="btn" onclick="showAlerts()">&#128276; All Alerts</button><button class="btn" onclick="go('visa')">&#10003; RTW</button><button class="btn" onclick="go('training')">&#127891; Training</button><button class="btn" onclick="go('hrCases')">&#128220; HR Cases</button><button class="btn" onclick="go('cos')">&#127963; CoS</button><button class="btn" onclick="go('reports')">&#128202; Reports</button>` : ''}<button class="btn" onclick="go('documents')">&#128451; Docs</button>${isAdmin() ? `<button class="btn" onclick="expJSON()">&#128190; Export</button>` : ''}</div></div>`;
}
function editCompany() { const co = D.company || {}; modal("Edit Company", `<div class="fr"><div class="fg"><label>Name</label><input id="co-nm" value="${h(co.name || "")}"></div><div class="fg"><label>Number</label><input id="co-cn" value="${h(co.companyNumber || "")}"></div></div><div class="fr"><div class="fg" style="flex:2"><label>Address</label><input id="co-ad" value="${h(co.registeredAddress || "")}"></div></div><div class="fr"><div class="fg"><label>Licence</label><input id="co-sl" value="${h(co.sponsorLicenceNumber || "")}"></div><div class="fg"><label>Licence Exp</label><input id="co-le" type="date" value="${h(co.licenceExpiry || "")}"></div></div><div class="fr"><div class="fg"><label>Auth Officer</label><input id="co-ao" value="${h(co.authorisedOfficer || "")}"></div><div class="fg"><label>Key Contact</label><input id="co-kc" value="${h(co.keyContact || "")}"></div></div><div class="fr"><div class="fg"><label>Phone</label><input id="co-ph" value="${h(co.phone || "")}"></div><div class="fg"><label>Email</label><input id="co-em" value="${h(co.email || "")}"></div></div><div class="fr"><div class="fg"><label>Website</label><input id="co-ws" value="${h(co.website || "")}"></div><div class="fg"><label>Pension</label><input id="co-ps" value="${h(co.pensionScheme || "")}"></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveCompany()">&#10003; Save</button></div>`) }
function saveCompany() { const g = x => ($(x) || {}).value || ""; saveCompanyFS({ name: g("#co-nm"), companyNumber: g("#co-cn"), registeredAddress: g("#co-ad"), sponsorLicenceNumber: g("#co-sl"), licenceExpiry: g("#co-le"), authorisedOfficer: g("#co-ao"), keyContact: g("#co-kc"), phone: g("#co-ph"), email: g("#co-em"), website: g("#co-ws"), pensionScheme: g("#co-ps"), pensionStatus: D.company.pensionStatus || "Compliant" }); closeM() }
function editTM() { const tm = D.transportManager || {}; modal("Edit Transport Manager", `<div class="fr"><div class="fg"><label>Name</label><input id="tm-n" value="${h(tm.name || "")}"></div><div class="fg"><label>CPC</label><input id="tm-cpc" value="${h(tm.cpcNumber || "")}"></div></div><div class="fr"><div class="fg"><label>DOB</label><input id="tm-dob" type="date" value="${h(tm.dob || "")}"></div><div class="fg"><label>Start</label><input id="tm-sd" type="date" value="${h(tm.startDate || "")}"></div></div><div class="fr"><div class="fg"><label>Phone</label><input id="tm-ph" value="${h(tm.phone || "")}"></div><div class="fg"><label>Email</label><input id="tm-em" value="${h(tm.email || "")}"></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveTM()">&#10003; Save</button></div>`) }
function saveTM() { const g = x => ($(x) || {}).value || ""; saveTMFS({ name: g("#tm-n"), cpcNumber: g("#tm-cpc"), dob: g("#tm-dob"), startDate: g("#tm-sd"), phone: g("#tm-ph"), email: g("#tm-em") }); closeM() }

/* ═══ EMPLOYEES ═══════════════════════════════════════════════ */
function empBdg(e) { if (!e.rtwEvidenceFile && e.office !== "OFF03") return { c: "b-cr", l: "RTW Missing" }; if (e.visaExpiry) { const d = dfn(e.visaExpiry); if (d < 0) return { c: "b-cr", l: "Expired" }; if (d <= 30) return { c: "b-cr", l: "≤30d" }; if (d <= 90) return { c: "b-wn", l: "≤90d" } } if (e.shareCodeExpiry) { const d = dfn(e.shareCodeExpiry); if (d < 0) return { c: "b-cr", l: "Code Exp" }; if (d <= 30) return { c: "b-wn", l: "Code≤30d" } } if (e.rtwCheckDate && dfn(e.rtwCheckDate) < -365) return { c: "b-wn", l: "RTW Rev" }; return { c: "b-ok", l: "OK" } }
function rEmp() {
  const sv = ($("#emp-s") || {}).value || ""; let list = filtEmp();
  if (sv) { const q = sv.toLowerCase(); list = list.filter(e => en(e).toLowerCase().includes(q) || e.jobTitle.toLowerCase().includes(q) || (e.department || "").toLowerCase().includes(q)) }
  const rows = list.map(e => { const b = empBdg(e); return `<tr><td class="sm muted">${h(e.id)}</td><td><strong>${h(en(e))}</strong></td><td>${h(e.jobTitle)}</td><td>${h(offName(e.office))}</td><td>${e.isSponsored ? '<span class="b b-sp">Sponsored</span>' : '—'}</td><td><span class="b ${b.c}">${b.l}</span></td><td class="btn-grp"><button class="btn btn-s" onclick="viewEmp('${e.id}')">View</button>${isAdmin() ? `<button class="btn btn-s" onclick="editEmp('${e.id}')">Edit</button>` : ''}</td></tr>` }).join("");
  $("#c-employees").innerHTML = `<div class="srow"><input id="emp-s" type="text" placeholder="Search…" value="${h(sv)}" oninput="rEmp()">${isAdmin() ? `<button class="btn btn-p" onclick="editEmp('')">+ Add</button>` : ''}</div><div class="card"><div class="card-h">Employees<span class="sub">${list.length}</span></div><div class="tw"><table><thead><tr><th>ID</th><th>Name</th><th>Title</th><th>Office</th><th>Sponsored</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="tc muted">No results.</td></tr>'}</tbody></table></div></div>`;
}
function calcLeave(eid) { const y = String(new Date().getFullYear()); return (D.attendanceRecords || []).filter(r => r.employeeId === eid && r.status === "Annual Leave" && r.date.startsWith(y)).length }
function viewEmp(id) {
  const e = ebi(id); if (!e) return; const stl = settled(e) && !e.isSponsored; const b = empBdg(e); const lt = calcLeave(e.id), rem = e.annualLeaveEntitlement - lt; const eDocs = docCache.filter(d => d.employeeId === e.id);
  let t1 = `<div class="ig">${ic("First Name", e.firstName)}${ic("Surname", e.lastName)}${ic("DOB", fd(e.dob))}${ic("NI", e.niNumber, 1)}${ic("Address", e.address)}${ic("Phone", e.phone)}${ic("Email", e.email)}${ic("Emergency", (e.emergencyName || "") + " — " + (e.emergencyPhone || ""))}${ic("Nationality", e.nationality)}${ic("Office", offName(e.office))}</div><div class="sdiv">Employment</div><div class="ig">${ic("Title", e.jobTitle)}${ic("Dept", e.department)}${ic("Manager", e.manager || "—")}${ic("Start", fd(e.startDate))}${ic("Salary", e.salary ? "£" + Number(e.salary).toLocaleString() : "—")}${ic("Sponsored", e.isSponsored ? "Yes" : "No")}${ic("Status", '<span class="b ' + b.c + '">' + b.l + '</span>')}</div>`;
  let t2 = `<div class="ig">${ic("RTW Check", fd(e.rtwCheckDate))}${ic("Method", e.rtwMethod || "—")}${ic("Evidence", e.rtwEvidenceFile || '<span class="b b-cr">MISSING</span>')}${ic("Immigration", e.immigrationStatus || "—")}</div>`;
  if (stl) t2 += `<div class="alr alr-g mt3">No visa tracking — British/Settled.</div>`;
  else t2 += `<div class="sdiv">Visa</div><div class="ig">${ic("Visa", e.visaType || "—")}${ic("Expiry", e.visaExpiry ? fd(e.visaExpiry) + " (" + dfn(e.visaExpiry) + "d)" : "—")}${ic("Code", e.shareCode || "—", 1)}${ic("Code Exp", e.shareCodeExpiry ? fd(e.shareCodeExpiry) + " (" + dfn(e.shareCodeExpiry) + "d)" : "—")}${ic("BRP", e.brpReference || "—", 1)}</div>`;
  let t3 = `<div class="ig">${ic("Entitlement", e.annualLeaveEntitlement + "d")}${ic("Taken", lt + "d")}${ic("Remaining", rem + "d")}</div>`;
  let t4 = `<div class="upload-zone" onclick="uploadForEmp('${e.id}')"><div class="uz-icon">&#128448;</div><div class="uz-text">Upload for ${h(en(e))}</div></div>`;
  if (eDocs.length) t4 += eDocs.map(d => `<div class="doc-list-row"><span class="dl-icon">${fIco(d.type)}</span><div class="dl-info"><div class="dl-name">${h(d.name)}</div><div class="dl-meta">${h(d.category)} · ${fmtSz(d.size)} · ${fd(d.uploadDate)}</div></div><div class="dl-acts"><button class="btn btn-s" onclick="dlDoc('${d.id}')">&#128190;</button>${isAdmin() ? `<button class="btn btn-s" onclick="delDoc('${d.id}')" style="color:var(--cr-fg)">&#10005;</button>` : ''}</div></div>`).join("");
  else t4 += `<div class="tc muted sm" style="padding:16px">No documents.</div>`;
  modal(en(e), `<div class="dtabs"><div class="dtab active" onclick="switchTab(this,0)">Personal</div><div class="dtab" onclick="switchTab(this,1)">RTW/Visa</div><div class="dtab" onclick="switchTab(this,2)">Leave</div><div class="dtab" onclick="switchTab(this,3)">Docs (${eDocs.length})</div></div><div class="dtab-body active">${t1}</div><div class="dtab-body">${t2}</div><div class="dtab-body">${t3}</div><div class="dtab-body">${t4}</div><div class="mt4 btn-grp">${isAdmin() ? `<button class="btn btn-p btn-s" onclick="closeM();editEmp('${e.id}')">&#9998; Edit</button><button class="btn btn-dng btn-s" onclick="deleteEmp('${e.id}')">&#128465; Delete</button>` : ''}</div>`);
}
function switchTab(el, i) { el.parentElement.querySelectorAll(".dtab").forEach((t, j) => t.classList.toggle("active", j === i)); el.parentElement.parentElement.querySelectorAll(".dtab-body").forEach((b, j) => b.classList.toggle("active", j === i)) }
function deleteEmp(id) { if (!confirm("Delete employee?")) return; deleteEmployeeFS(id); closeM() }
function editEmp(id) {
  const e = id ? ebi(id) : null; const v = f => e ? h(e[f] || "") : ""; const s = (f, val) => e && e[f] === val ? "selected" : "";
  const oo = (D.offices || []).map(o => `<option value="${o.id}" ${e && e.office === o.id ? 'selected' : ''}>${o.name}</option>`).join("");
  modal(e ? "Edit — " + en(e) : "Add Employee", `<div class="sdiv">Personal</div><div class="fr"><div class="fg"><label>First *</label><input id="ef-fn" value="${v("firstName")}"></div><div class="fg"><label>Surname *</label><input id="ef-ln" value="${v("lastName")}"></div></div><div class="fr"><div class="fg"><label>DOB</label><input id="ef-dob" type="date" value="${v("dob")}"></div><div class="fg"><label>NI</label><input id="ef-ni" value="${v("niNumber")}"></div></div><div class="fr"><div class="fg" style="flex:2"><label>Address</label><input id="ef-addr" value="${v("address")}"></div></div><div class="fr"><div class="fg"><label>Phone</label><input id="ef-phone" value="${v("phone")}"></div><div class="fg"><label>Email</label><input id="ef-email" value="${v("email")}"></div></div><div class="fr"><div class="fg"><label>Emergency</label><input id="ef-emn" value="${v("emergencyName")}"></div><div class="fg"><label>Emerg Phone</label><input id="ef-emp" value="${v("emergencyPhone")}"></div></div><div class="fr"><div class="fg"><label>Nationality</label><input id="ef-nat" value="${v("nationality") || "British"}"></div><div class="fg"><label>Immigration</label><select id="ef-is"><option value="British/Settled" ${s("immigrationStatus", "British/Settled")}>British/Settled</option><option value="Skilled Worker Visa" ${s("immigrationStatus", "Skilled Worker Visa")}>Skilled Worker</option><option value="EU Settled Status" ${s("immigrationStatus", "EU Settled Status")}>EU Settled</option><option value="N/A" ${s("immigrationStatus", "N/A")}>N/A</option><option value="Other" ${s("immigrationStatus", "Other")}>Other</option></select></div></div><div class="sdiv">Employment</div><div class="fr"><div class="fg"><label>Title</label><input id="ef-jt" value="${v("jobTitle")}"></div><div class="fg"><label>Dept</label><input id="ef-dp" value="${v("department")}"></div></div><div class="fr"><div class="fg"><label>Manager</label><input id="ef-mg" value="${v("manager")}"></div><div class="fg"><label>Start</label><input id="ef-sd" type="date" value="${v("startDate")}"></div></div><div class="fr"><div class="fg"><label>Office</label><select id="ef-of">${oo}</select></div><div class="fg"><label>Salary</label><input id="ef-sa" type="number" value="${v("salary")}"></div></div><div class="fr"><div class="fg"><label>Sponsored</label><select id="ef-sp"><option value="no" ${e && e.isSponsored ? "" : "selected"}>No</option><option value="yes" ${e && e.isSponsored ? "selected" : ""}>Yes</option></select></div><div class="fg"><label>Leave d/yr</label><input id="ef-le" type="number" value="${e ? e.annualLeaveEntitlement : 28}"></div></div><div class="sdiv">RTW</div><div class="fr"><div class="fg"><label>Date</label><input id="ef-rd" type="date" value="${v("rtwCheckDate")}"></div><div class="fg"><label>Method</label><select id="ef-rm"><option value="Manual" ${s("rtwMethod", "Manual")}>Manual</option><option value="Online (Share Code)" ${s("rtwMethod", "Online (Share Code)")}>Online</option></select></div></div><div class="fr"><div class="fg" style="flex:2"><label>Evidence File</label><input id="ef-rf" value="${v("rtwEvidenceFile")}"></div></div><div class="sdiv">Visa</div><div class="fr"><div class="fg"><label>Type</label><input id="ef-vt" value="${v("visaType")}"></div><div class="fg"><label>Expiry</label><input id="ef-ve" type="date" value="${v("visaExpiry")}"></div></div><div class="fr"><div class="fg"><label>Code</label><input id="ef-sc" value="${v("shareCode")}"></div><div class="fg"><label>Code Exp</label><input id="ef-se" type="date" value="${v("shareCodeExpiry")}"></div></div><div class="fr"><div class="fg"><label>BRP</label><input id="ef-br" value="${v("brpReference")}"></div></div><div style="margin-top:18px;text-align:right"><button class="btn btn-ok" onclick="saveEmp('${id || ''}')">&#10003; Save</button></div>`);
}
function saveEmp(eid) { const g = x => ($(x) || {}).value || ""; const o = { id: eid || uid("EMP"), firstName: g("#ef-fn"), lastName: g("#ef-ln"), dob: g("#ef-dob"), niNumber: g("#ef-ni"), address: g("#ef-addr"), phone: g("#ef-phone"), email: g("#ef-email"), emergencyName: g("#ef-emn"), emergencyPhone: g("#ef-emp"), nationality: g("#ef-nat"), immigrationStatus: g("#ef-is"), visaType: g("#ef-vt"), visaExpiry: g("#ef-ve"), shareCode: g("#ef-sc"), shareCodeExpiry: g("#ef-se"), brpReference: g("#ef-br"), rtwCheckDate: g("#ef-rd"), rtwMethod: g("#ef-rm"), rtwEvidenceFile: g("#ef-rf"), jobTitle: g("#ef-jt"), department: g("#ef-dp"), manager: g("#ef-mg"), startDate: g("#ef-sd"), office: g("#ef-of"), salary: g("#ef-sa"), isSponsored: g("#ef-sp") === "yes", annualLeaveEntitlement: parseInt(g("#ef-le")) || 28, status: "Active" }; if (!o.firstName || !o.lastName) { alert("Name required."); return } saveEmployeeFS(o); closeM() }

/* ═══ VISA ════════════════════════════════════════════════════ */
function rVisa(o) { if (!isAdmin()) return; o = o || {}; let ao = o.ao || false, sa = false; const ea = $("#v-ao"), es = $("#v-sa"); if (ea) ao = ea.checked; if (es) sa = es.checked; if (o.ao) ao = true; let list = (D.employees || []).filter(e => e.status !== "Deleted"); if (!sa) list = list.filter(e => !settled(e) || e.isSponsored); if (selOffice !== "ALL") list = list.filter(e => e.office === selOffice); const rows = list.map(e => { const vd = e.visaExpiry ? dfn(e.visaExpiry) : null, sd = e.shareCodeExpiry ? dfn(e.shareCodeExpiry) : null, rd = e.rtwCheckDate && -dfn(e.rtwCheckDate) > 365; let urg = 9999; if (vd !== null && vd < urg) urg = vd; if (sd !== null && sd < urg) urg = sd; return { e, vd, sd, rd, urg, ha: (vd !== null && vd <= 90) || (sd !== null && sd <= 30) || rd } }); let fl = ao ? rows.filter(r => r.ha) : rows; fl.sort((a, b) => a.urg - b.urg); const dc = (d, w, c) => { if (d < 0) return `<span class="b b-cr">Expired</span>`; if (d <= c) return `<span class="b b-cr">${d}d</span>`; if (d <= w) return `<span class="b b-wn">${d}d</span>`; return `<span class="b b-ok">${d}d</span>` }; const vb = r => { if (r.vd !== null && r.vd < 0) return '<span class="b b-cr">Expired</span>'; if (r.vd !== null && r.vd <= 30) return '<span class="b b-cr">Critical</span>'; if (r.vd !== null && r.vd <= 90) return '<span class="b b-wn">Soon</span>'; if (r.sd !== null && r.sd < 0) return '<span class="b b-cr">CodeExp</span>'; if (r.sd !== null && r.sd <= 30) return '<span class="b b-wn">CodeDue</span>'; if (r.rd) return '<span class="b b-wn">RTW</span>'; return '<span class="b b-ok">OK</span>' }; const tr = fl.map(r => { const e = r.e; return `<tr class="${r.ha && r.urg <= 30 ? 'rflag' : ''}"><td><strong>${h(en(e))}</strong></td><td>${h(offName(e.office))}</td><td>${h(e.visaType) || '—'}</td><td>${e.visaExpiry ? fd(e.visaExpiry) : '—'}</td><td>${r.vd !== null ? dc(r.vd, 90, 30) : '—'}</td><td class="sm mono">${h(e.shareCode) || '—'}</td><td>${r.sd !== null ? dc(r.sd, 60, 30) : '—'}</td><td>${vb(r)}</td></tr>` }).join(""); $("#c-visa").innerHTML = `<div class="srow mt3"><label class="sm" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="v-ao" ${ao ? 'checked' : ''} onchange="rVisa()"> Alerts only</label><label class="sm" style="display:flex;align-items:center;gap:4px;margin-left:14px"><input type="checkbox" id="v-sa" ${sa ? 'checked' : ''} onchange="rVisa()"> Inc British</label></div><div class="card"><div class="card-h">Visa & RTW<span class="sub">${fl.length}</span></div><div class="tw"><table><thead><tr><th>Name</th><th>Office</th><th>Visa</th><th>Expiry</th><th>Days</th><th>Code</th><th>CDays</th><th>Status</th></tr></thead><tbody>${tr || '<tr><td colspan="8" class="tc muted">None.</td></tr>'}</tbody></table></div></div>` }

/* ═══ ATTENDANCE ══════════════════════════════════════════════ */
const ST_C = { "Present": { bg: "#d1fae5", fg: "#065f46", cls: "st-present", sh: "P" }, "Annual Leave": { bg: "#bfdbfe", fg: "#1e3a8a", cls: "st-annual", sh: "AL" }, "Sick": { bg: "#fed7aa", fg: "#9a3412", cls: "st-sick", sh: "S" }, "Unpaid Leave": { bg: "#fecaca", fg: "#991b1b", cls: "st-unpaid", sh: "UL" }, "Off": { bg: "#e2e8f0", fg: "#475569", cls: "st-off", sh: "O" }, "Other": { bg: "#fef08a", fg: "#854d0e", cls: "st-other", sh: "OT" } }; const ST_K = Object.keys(ST_C);
function rAtt() {
  const now = new Date(); if (calYear === undefined) { calYear = now.getFullYear(); calMonth = now.getMonth() }
  const dim = new Date(calYear, calMonth + 1, 0).getDate(); const todISO = iso(); const mn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; const dn = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  let thH = '<th class="emp-name">Employee</th>'; const dI = [];
  for (let d = 1; d <= dim; d++) { const dt = new Date(calYear, calMonth, d); const dw = dt.getDay(); dI.push({ day: d, dow: dw, isWk: dw === 0 || dw === 6, iso: dt.toISOString().slice(0, 10), isT: dt.toISOString().slice(0, 10) === todISO }); thH += `<th class="${dI[d - 1].isWk ? 'wkend' : ''}">${dn[dw]}<br>${d}</th>` }
  const recM = {}; (D.attendanceRecords || []).forEach(r => { recM[r.employeeId + "_" + r.date] = r.status });
  const emps = filtEmp(); let tbH = "";
  emps.forEach(e => { let rH = `<td class="emp-name">${h(en(e))}<span class="en-sub">${h(e.jobTitle)}</span></td>`; for (const di of dI) { const k = e.id + "_" + di.iso; const rec = recM[k]; let cls = "", sh2 = ""; if (di.isWk && !rec) { cls = "st-weekend"; sh2 = "W" } else if (rec && ST_C[rec]) { cls = ST_C[rec].cls; sh2 = ST_C[rec].sh } else { cls = "st-present"; sh2 = "P" } const tc = di.isT ? " st-today" : ""; rH += `<td><div class="cal-cell ${cls}${tc}" data-emp="${e.id}" data-date="${di.iso}" onclick="${isAdmin() ? 'cellClick(event,this)' : ''}">${sh2}</div></td>` } tbH += `<tr>${rH}</tr>` });
  const legend = Object.entries(ST_C).map(([k, v]) => `<div class="cl"><div class="cl-box" style="background:${v.bg}"></div>${k}</div>`).join("") + `<div class="cl"><div class="cl-box" style="background:#f1f5f9"></div>Weekend</div>`;
  const yr = String(calYear); const lR = emps.map(e => { const t = (D.attendanceRecords || []).filter(r => r.employeeId === e.id && r.status === "Annual Leave" && r.date.startsWith(yr)).length; return `<tr><td>${h(en(e))}</td><td>${e.annualLeaveEntitlement}</td><td>${t}</td><td><strong>${e.annualLeaveEntitlement - t}</strong></td></tr>` }).join("");
  $("#c-attendance").innerHTML = `<div class="cal-controls"><input type="month" class="cal-month-pick" value="${calYear}-${String(calMonth + 1).padStart(2, '0')}" onchange="calPick(this.value)"><button class="cal-btn" onclick="calToday()">Today</button><div style="flex:1"></div><button class="btn btn-p btn-s" onclick="window.print()">&#128424;</button></div><div class="cal-legend">${legend}</div><div class="att-export"><label>Export:</label><input type="date" id="ex-from" value="${calYear}-${String(calMonth + 1).padStart(2, '0')}-01"><span class="sm">to</span><input type="date" id="ex-to" value="${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(dim).padStart(2, '0')}"><button class="btn btn-s" onclick="exportAtt()">&#128190; CSV</button></div><div class="card"><div class="card-h">${mn[calMonth]} ${calYear}<span class="sub">${isAdmin() ? 'Click to edit' : ''}</span></div><div class="cal-wrap"><table class="cal-table"><thead><tr>${thH}</tr></thead><tbody>${tbH}</tbody></table></div></div><div class="card"><div class="card-h">Leave ${calYear}</div><div class="tw"><table><thead><tr><th>Employee</th><th>Entitlement</th><th>Taken</th><th>Remaining</th></tr></thead><tbody>${lR}</tbody></table></div></div>`;
}
function calPick(v) { if (!v) return; const p = v.split("-"); calYear = parseInt(p[0]); calMonth = parseInt(p[1]) - 1; rAtt() }
function calToday() { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); rAtt() }
function cellClick(evt, el) { if (!isAdmin()) return; const old = document.querySelector(".st-popup"); if (old) old.remove(); const eid = el.dataset.emp, ds = el.dataset.date; const pop = document.createElement("div"); pop.className = "st-popup"; let o = ""; ST_K.forEach(k => { const c = ST_C[k]; o += `<div class="sp-opt" data-st="${k}"><div class="sp-dot" style="background:${c.bg};border:1px solid ${c.fg}"></div>${k}</div>` }); o += `<div class="sp-opt" data-st="_clear"><div class="sp-dot" style="background:#fff;border:1px solid #ccc"></div>Clear</div>`; pop.innerHTML = o; const r = el.getBoundingClientRect(); pop.style.left = Math.min(r.left, innerWidth - 160) + "px"; pop.style.top = (r.bottom + 4) + "px"; document.body.appendChild(pop); pop.querySelectorAll(".sp-opt").forEach(opt => { opt.addEventListener("click", () => { const st = opt.dataset.st; saveAttFS(eid, ds, st === "_clear" ? "Present" : st, ""); pop.remove() }) }); setTimeout(() => { const cl = e => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", cl) } }; document.addEventListener("click", cl) }, 10) }
function exportAtt() { const from = ($("#ex-from") || {}).value || "", to = ($("#ex-to") || {}).value || ""; if (!from || !to) { alert("Select dates."); return } const emps = filtEmp(); const recM = {}; (D.attendanceRecords || []).forEach(r => { recM[r.employeeId + "_" + r.date] = r.status }); let csv = "Employee,Date,Day,Status\n"; const d = new Date(from); const end = new Date(to); while (d <= end) { const ds = d.toISOString().slice(0, 10); const dn2 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]; emps.forEach(e => { const st = recM[e.id + "_" + ds] || (d.getDay() === 0 || d.getDay() === 6 ? "Weekend" : "Present"); csv += `"${en(e)}",${ds},${dn2},${st}\n` }); d.setDate(d.getDate() + 1) } const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `attendance_${from}_to_${to}.csv`; a.click() }

/* ═══ REPORTING ═══════════════════════════════════════════════ */
function rRpt(o) { if (!isAdmin()) return; o = o || {}; let oo = o.oo || false; const ec = $("#rpt-oo"); if (ec) oo = ec.checked; if (o.oo) oo = true; let list = (D.reportingLog || []).slice(); if (oo) list = list.filter(r => r.status === "Open"); list.sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate)); const oc = (D.reportingLog || []).filter(r => r.status === "Open").length; const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}">${en(e)}</option>`).join(""); const evts = ["Absence >10 days", "Change in job title/duties", "Change in salary", "Change in work location", "Termination / Resignation", "Right-to-work recheck", "Other"]; const tr = list.map(r => { const emp = r.employeeId ? ebi(r.employeeId) : null; const od = r.status === "Open" && dfn(r.deadline) < 0; return `<tr class="${od ? 'rflag' : ''}"><td>${emp ? h(en(emp)) : '—'}</td><td>${h(r.eventType)}</td><td>${fd(r.eventDate)}</td><td>${fd(r.deadline)}${od ? ' <span class="b b-cr">Overdue</span>' : ''}</td><td><span class="b ${r.status === 'Open' ? 'b-ac' : 'b-nt'}">${r.status}</span></td><td class="sm">${h(r.notes)}</td><td>${r.status === 'Open' ? `<button class="btn btn-s" onclick="closeRpt('${r.id}')">Close</button>` : ''}</td></tr>` }).join(""); $("#c-reporting").innerHTML = `<div class="card mb3"><div class="card-h">Add</div><div class="card-b"><div class="fr"><div class="fg"><label>Employee</label><select id="rpt-e"><option value="">General</option>${eo}</select></div><div class="fg"><label>Event</label><select id="rpt-ev">${evts.map(t => `<option>${t}</option>`).join("")}</select></div></div><div class="fr"><div class="fg"><label>Date</label><input id="rpt-dt" type="date" value="${iso()}"></div><div class="fg" style="flex:2"><label>Notes</label><input id="rpt-nt"></div></div><button class="btn btn-p mt2" onclick="addRpt()">Add</button></div></div><div class="srow"><label class="sm" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="rpt-oo" ${oo ? 'checked' : ''} onchange="rRpt()"> Open only</label><span class="sm muted" style="margin-left:auto">${oc} open</span></div><div class="card"><div class="card-h">Log<span class="sub">${list.length}</span></div><div class="tw"><table><thead><tr><th>Employee</th><th>Event</th><th>Date</th><th>Deadline</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan="7" class="tc muted">None.</td></tr>'}</tbody></table></div></div>` }
function addRpt() { const eid = $("#rpt-e").value, ev = $("#rpt-ev").value, dt = $("#rpt-dt").value, nt = $("#rpt-nt").value; if (!dt) { alert("Date required."); return } const dl = new Date(dt); dl.setDate(dl.getDate() + 14); saveReportFS({ id: uid("RPT"), employeeId: eid || null, eventType: ev, eventDate: dt, deadline: dl.toISOString().slice(0, 10), status: "Open", notes: nt }) }
function closeRpt(id) { closeReportFS(id) }

/* ═══ VEHICLES ════════════════════════════════════════════════ */
const ACT_TYPES = ["Tyre Replacement", "Curtain Repair", "Tail Lift Service", "Brake Repair", "Windscreen Repair", "Body Repair", "Electrical Repair", "Exhaust Repair", "Suspension Repair", "Air Con Service", "DPF Clean", "AdBlue Top-up", "Wheel Alignment", "Light Repair", "Other"];
function rVeh() {
  if (!isAdmin()) return; const vehs = D.vehicles || []; const acts = (D.vehicleActions || []).filter(a => a.status === "Open"); const tm = D.transportManager || {};
  let alerts = ""; vehs.forEach(v => {
    if (v.motDueDate && dfn(v.motDueDate) <= 30) alerts += `<div class="alr ${dfn(v.motDueDate) < 0 ? 'alr-r' : 'alr-a'}">${h(v.registration)} MOT ${dfn(v.motDueDate) < 0 ? 'EXPIRED' : 'due ' + fd(v.motDueDate)}</div>`;
    if (v.sixWeekDate && dfn(v.sixWeekDate) <= 14) alerts += `<div class="alr alr-a">${h(v.registration)} 6-week due ${fd(v.sixWeekDate)}</div>`;
    if (v.taxExpiry && dfn(v.taxExpiry) <= 30) alerts += `<div class="alr ${dfn(v.taxExpiry) < 0 ? 'alr-r' : 'alr-a'}">${h(v.registration)} Tax ${dfn(v.taxExpiry) < 0 ? 'EXPIRED' : 'due ' + fd(v.taxExpiry)}</div>`;
    if (v.tachoDueDate && dfn(v.tachoDueDate) <= 30) alerts += `<div class="alr ${dfn(v.tachoDueDate) < 0 ? 'alr-r' : 'alr-a'}">${h(v.registration)} Tacho ${dfn(v.tachoDueDate) < 0 ? 'OVERDUE' : 'due ' + fd(v.tachoDueDate)}</div>`;
  }); acts.forEach(a => { alerts += `<div class="alr ${a.priority === 'Urgent' ? 'alr-r' : 'alr-a'}">&#9888; ${h(a.registration)} — ${h(a.actionType)}: ${h(a.description)} ${a.priority === 'Urgent' ? '<strong>URGENT</strong>' : ''}</div>` });
  const cards = vehs.map(v => { const drv = v.assignedDriver ? ebi(v.assignedDriver) : null; const md = v.motDueDate ? dfn(v.motDueDate) : null; const td2 = v.tachoDueDate ? dfn(v.tachoDueDate) : null; const sd = v.sixWeekDate ? dfn(v.sixWeekDate) : null; const txd = v.taxExpiry ? dfn(v.taxExpiry) : null; const vActs = acts.filter(a => a.vehicleId === v.id); const actHtml = vActs.length ? `<div style="border-top:1px solid var(--g100);padding:8px 0 0;margin-top:6px">${vActs.map(a => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.78rem"><span class="b ${a.priority === 'Urgent' ? 'b-cr' : 'b-wn'}" style="font-size:.6rem">${a.priority}</span><span>${h(a.actionType)}</span><button class="btn btn-s" onclick="closeAction('${a.id}')" style="margin-left:auto;font-size:.65rem">Done</button></div>`).join("")}</div>` : ''; return `<div class="veh-card"><div class="vc-hd"><span class="vc-reg">${h(v.registration)}</span><span class="vc-make">${h(v.make)} ${h(v.model)}</span></div><div class="vc-body"><div class="vc-row"><span class="vc-label">Year</span><span class="vc-val">${h(v.year)} ${h(v.colour)}</span></div><div class="vc-row"><span class="vc-label">MOT</span><span class="vc-val">${fd(v.motDueDate)} ${md !== null && md <= 30 ? `<span class="b ${md < 0 ? 'b-cr' : 'b-wn'}">${md}d</span>` : ''}</span></div><div class="vc-row"><span class="vc-label">6-Week</span><span class="vc-val">${fd(v.sixWeekDate)} ${sd !== null && sd <= 14 ? `<span class="b b-wn">${sd}d</span>` : ''}</span></div><div class="vc-row"><span class="vc-label">Tacho</span><span class="vc-val">${fd(v.tachoDueDate)} ${td2 !== null && td2 <= 30 ? `<span class="b ${td2 < 0 ? 'b-cr' : 'b-wn'}">${td2}d</span>` : ''}</span></div><div class="vc-row"><span class="vc-label">Service</span><span class="vc-val">${fd(v.serviceDate)}</span></div><div class="vc-row"><span class="vc-label">Tax</span><span class="vc-val">${fd(v.taxExpiry)} ${txd !== null && txd <= 30 ? `<span class="b ${txd < 0 ? 'b-cr' : 'b-wn'}">${txd}d</span>` : ''}</span></div><div class="vc-row"><span class="vc-label">Odo</span><span class="vc-val">${v.odometer ? Number(v.odometer).toLocaleString() + 'mi' : '—'}</span></div><div class="vc-row"><span class="vc-label">Driver</span><span class="vc-val">${drv ? h(en(drv)) : '—'}</span></div>${actHtml}</div><div class="vc-acts"><button class="btn btn-s" onclick="editVeh('${v.id}')">&#9998;</button><button class="btn btn-s" onclick="addAction('${v.id}','${h(v.registration)}')">+ Action</button><button class="btn btn-s" onclick="delVeh('${v.id}')" style="color:var(--cr-fg)">&#10005;</button></div></div>` }).join("");
  const actRows = acts.map(a => `<tr><td><strong>${h(a.registration)}</strong></td><td>${h(a.actionType)}</td><td>${h(a.description)}</td><td><span class="b ${a.priority === 'Urgent' ? 'b-cr' : a.priority === 'High' ? 'b-wn' : 'b-nt'}">${a.priority}</span></td><td>${fd(a.dueDate)}</td><td class="btn-grp"><button class="btn btn-s btn-ok" onclick="closeAction('${a.id}')">Done</button><button class="btn btn-s" onclick="deleteAction('${a.id}')" style="color:var(--cr-fg)">&#10005;</button></td></tr>`).join("");
  $("#c-vehicles").innerHTML = `${alerts}<div class="srow"><span class="sm muted">${vehs.length} vehicles · ${acts.length} open actions</span><div style="flex:1"></div><button class="btn btn-p" onclick="editVeh('')">+ Add Vehicle</button><button class="btn" onclick="addAction('','')">+ Action</button></div><div class="card"><div class="card-h flex-b"><span>Transport Manager</span><button class="btn btn-s" onclick="editTM()">&#9998;</button></div><div class="card-b"><div class="ig">${ic("Name", tm.name || "—")}${ic("CPC", tm.cpcNumber || "—", 1)}${ic("Phone", tm.phone || "—")}</div></div></div>${acts.length ? `<div class="card"><div class="card-h">&#9888; Actions Required<span class="sub">${acts.length} open</span></div><div class="tw"><table><thead><tr><th>Vehicle</th><th>Type</th><th>Description</th><th>Priority</th><th>Due</th><th></th></tr></thead><tbody>${actRows}</tbody></table></div></div>` : ''}<div class="veh-grid">${cards || '<div class="tc muted" style="padding:40px">No vehicles.</div>'}</div>`;
}
function editVeh(id) { const v = id ? (D.vehicles || []).find(x => x.id === id) : null; const g = f => v ? h(v[f] || "") : ""; const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}" ${v && v.assignedDriver === e.id ? 'selected' : ''}>${en(e)}</option>`).join(""); modal(v ? "Edit Vehicle" : "Add Vehicle", `<div class="fr"><div class="fg"><label>Reg *</label><input id="vf-reg" value="${g("registration")}" style="text-transform:uppercase"></div><div class="fg"><label>Make</label><input id="vf-mk" value="${g("make")}"></div><div class="fg"><label>Model</label><input id="vf-md" value="${g("model")}"></div></div><div class="fr"><div class="fg"><label>Colour</label><input id="vf-cl" value="${g("colour")}"></div><div class="fg"><label>Year</label><input id="vf-yr" type="number" value="${g("year")}"></div><div class="fg"><label>Fuel</label><select id="vf-fl"><option ${v && v.fuelType === 'Diesel' ? 'selected' : ''}>Diesel</option><option ${v && v.fuelType === 'Petrol' ? 'selected' : ''}>Petrol</option><option ${v && v.fuelType === 'Electric' ? 'selected' : ''}>Electric</option><option ${v && v.fuelType === 'Hybrid' ? 'selected' : ''}>Hybrid</option></select></div></div><div class="sdiv">Compliance Dates</div><div class="fr"><div class="fg"><label>MOT Due</label><input id="vf-mot" type="date" value="${g("motDueDate")}"></div><div class="fg"><label>6-Week</label><input id="vf-6w" type="date" value="${g("sixWeekDate")}"></div><div class="fg"><label>Tacho Calibration</label><input id="vf-tc" type="date" value="${g("tachoDueDate")}"></div></div><div class="fr"><div class="fg"><label>Service</label><input id="vf-sv" type="date" value="${g("serviceDate")}"></div><div class="fg"><label>Insurance</label><input id="vf-ins" type="date" value="${g("insuranceExpiry")}"></div><div class="fg"><label>Tax</label><input id="vf-tax" type="date" value="${g("taxExpiry")}"></div></div><div class="sdiv">Other</div><div class="fr"><div class="fg"><label>Odometer</label><input id="vf-od" type="number" value="${g("odometer")}"></div><div class="fg"><label>Driver</label><select id="vf-drv"><option value="">—</option>${eo}</select></div></div><div class="fr"><div class="fg" style="flex:2"><label>Notes</label><input id="vf-nt" value="${g("notes")}"></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveVeh('${id || ''}')">&#10003; Save</button></div>`) }
function saveVeh(id) { const g = x => ($(x) || {}).value || ""; const o = { id: id || uid("VEH"), registration: g("#vf-reg").toUpperCase(), make: g("#vf-mk"), model: g("#vf-md"), colour: g("#vf-cl"), year: g("#vf-yr"), motDueDate: g("#vf-mot"), sixWeekDate: g("#vf-6w"), tachoDueDate: g("#vf-tc"), serviceDate: g("#vf-sv"), odometer: g("#vf-od"), insuranceExpiry: g("#vf-ins"), taxExpiry: g("#vf-tax"), assignedDriver: g("#vf-drv"), fuelType: g("#vf-fl"), notes: g("#vf-nt"), status: "Active" }; if (!o.registration) { alert("Reg required."); return } saveVehicleFS(o); closeM() }
function delVeh(id) { if (!confirm("Delete vehicle?")) return; deleteVehicleFS(id) }
function addAction(vid, reg) { const vOpts = (D.vehicles || []).map(v => `<option value="${v.id}" ${vid === v.id ? 'selected' : ''}>${v.registration} — ${v.make} ${v.model}</option>`).join(""); const tOpts = ACT_TYPES.map(t => `<option>${t}</option>`).join(""); const due = new Date(); due.setDate(due.getDate() + 14); modal("Add Action Required", `<div class="fr"><div class="fg"><label>Vehicle *</label><select id="af-v">${vOpts}</select></div><div class="fg"><label>Type *</label><select id="af-t">${tOpts}</select></div></div><div class="fr"><div class="fg" style="flex:2"><label>Description</label><input id="af-d" placeholder="e.g. Nearside rear tyre worn below legal limit"></div></div><div class="fr"><div class="fg"><label>Priority</label><select id="af-p"><option>Urgent</option><option selected>High</option><option>Medium</option><option>Low</option></select></div><div class="fg"><label>Due Date</label><input id="af-dd" type="date" value="${due.toISOString().slice(0, 10)}"></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveAction()">&#10003; Save</button></div>`) }
function saveAction() { const g = x => ($(x) || {}).value || ""; const vid = g("#af-v"); if (!vid) { alert("Select vehicle."); return } const v = (D.vehicles || []).find(x => x.id === vid); saveVehActionFS({ id: uid("ACT"), vehicleId: vid, registration: v ? v.registration : "", actionType: g("#af-t"), description: g("#af-d"), priority: g("#af-p"), dueDate: g("#af-dd"), createdDate: iso(), status: "Open" }); closeM() }
function closeAction(id) { closeVehActionFS(id) }
function deleteAction(id) { if (!confirm("Delete action?")) return; deleteVehActionFS(id) }

/* ═══ DOCUMENTS ═══════════════════════════════════════════════ */
const DCATS = ["RTW Evidence", "Passport / ID", "Visa Document", "Employment Contract", "Payslip", "Pension", "Home Office Letter", "Vehicle Document", "Training Certificate", "Other"];
function rDoc() { const cf = ($("#dc-cf") || {}).value || ""; const ef = ($("#dc-ef") || {}).value || ""; let list = docCache.slice(); if (!isAdmin() && CUDoc && CUDoc.employeeId) list = list.filter(d => d.employeeId === CUDoc.employeeId); if (cf) list = list.filter(d => d.category === cf); if (ef) list = list.filter(d => d.employeeId === ef); const co2 = DCATS.map(c => `<option value="${c}" ${cf === c ? 'selected' : ''}>${c}</option>`).join(""); const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}" ${ef === e.id ? 'selected' : ''}>${en(e)}</option>`).join(""); const rows = list.map(d => { const emp = d.employeeId ? ebi(d.employeeId) : null; return `<div class="doc-list-row"><span class="dl-icon">${fIco(d.type)}</span><div class="dl-info"><div class="dl-name">${h(d.name)}</div><div class="dl-meta">${h(d.category)} · ${fmtSz(d.size)} · ${fd(d.uploadDate)}${emp ? ' · ' + h(en(emp)) : ''}</div></div><div class="dl-acts"><button class="btn btn-s" onclick="dlDoc('${d.id}')">&#128190;</button>${isAdmin() ? `<button class="btn btn-s" onclick="delDoc('${d.id}')" style="color:var(--cr-fg)">&#10005;</button>` : ''}</div></div>` }).join(""); $("#c-documents").innerHTML = `<div class="upload-zone" id="dz" onclick="trigUpload('')"><div class="uz-icon">&#128448;</div><div class="uz-text">Upload or drag & drop</div></div><div class="btn-grp mb3"><button class="btn" onclick="trigUpload('')">&#128194; Files</button><button class="btn" onclick="trigCamera('')">&#128247; Photo</button></div><div class="srow"><select id="dc-cf" onchange="rDoc()"><option value="">All Categories</option>${co2}</select><select id="dc-ef" onchange="rDoc()"><option value="">All Employees</option>${eo}</select><span class="sm muted" style="margin-left:auto">${docCache.length} docs</span></div><div class="card"><div class="card-h">Documents<span class="sub">${list.length}</span></div><div class="card-b" style="padding:0">${rows || '<div class="tc muted" style="padding:24px">No documents.</div>'}</div></div>`; setupDZ("#dz", "") }
function setupDZ(s, e) { const z = $(s); if (!z) return; z.ondragover = ev => { ev.preventDefault(); z.classList.add("dragover") }; z.ondragleave = () => z.classList.remove("dragover"); z.ondrop = ev => { ev.preventDefault(); z.classList.remove("dragover"); handleFiles(ev.dataTransfer.files, e) } }
function trigUpload(e) { const i = $("#file-input"); i.value = ""; i.onchange = () => handleFiles(i.files, e); i.click() }
function trigCamera(e) { const i = $("#camera-input"); i.value = ""; i.onchange = () => handleFiles(i.files, e); i.click() }
function uploadForEmp(e) { closeM(); trigUpload(e) }
function handleFiles(files, empId) { if (!files || !files.length) return; const fl = Array.from(files); const co2 = DCATS.map(c => `<option>${c}</option>`).join(""); const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}" ${empId === e.id ? 'selected' : ''}>${en(e)}</option>`).join(""); modal("Upload " + fl.length + " file(s)", `${fl.map(f => `<div class="sm">${fIco(f.type)} ${h(f.name)} (${fmtSz(f.size)})</div>`).join("")}<div class="fr mt3"><div class="fg"><label>Category</label><select id="up-cat">${co2}</select></div><div class="fg"><label>Employee</label><select id="up-emp"><option value="">—</option>${eo}</select></div></div><div style="margin-top:14px;text-align:right"><button class="btn btn-ok" onclick="doUpload()">&#10003; Upload</button></div>`); window._pf = fl }
async function doUpload() { const fl = window._pf; if (!fl) return; const cat = ($("#up-cat") || {}).value || "Other", emp = ($("#up-emp") || {}).value || ""; for (const f of fl) { await uploadDocFS(f, { category: cat, employeeId: emp, notes: "" }) } window._pf = null; closeM() }
function dlDoc(id) { const d = docCache.find(x => x.id === id); if (d && d.url) window.open(d.url, "_blank") }
async function delDoc(id) { if (!confirm("Delete?")) return; await deleteDocFS(id); closeM() }

/* ═══ TRAINING & CERTIFICATES ═════════════════════════════════ */
const TRAIN_CATS = ["Health & Safety", "First Aid", "Manual Handling", "Fire Safety", "GDPR / Data Protection", "Safeguarding", "Driver CPC", "Forklift / MHE", "Food Hygiene", "Right to Work", "Equality & Diversity", "Cyber Security", "Company Induction", "Other"];
function rTraining() {
  const sf = ($("#trn-sf") || {}).value || ""; const ef = ($("#trn-ef") || {}).value || "";
  let list = (D.training || []).slice();
  if (!isAdmin() && CUDoc && CUDoc.employeeId) list = list.filter(t => t.employeeId === CUDoc.employeeId);
  if (sf) list = list.filter(t => t.category === sf);
  if (ef) list = list.filter(t => t.employeeId === ef);
  list.sort((a, b) => { const ad = a.expiryDate ? dfn(a.expiryDate) : 9999; const bd = b.expiryDate ? dfn(b.expiryDate) : 9999; return ad - bd });
  const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}" ${ef === e.id ? 'selected' : ''}>${en(e)}</option>`).join("");
  const co = TRAIN_CATS.map(c => `<option value="${c}" ${sf === c ? 'selected' : ''}>${c}</option>`).join("");
  const expiring = list.filter(t => t.expiryDate && dfn(t.expiryDate) <= 30);
  let alerts = expiring.map(t => { const emp = t.employeeId ? ebi(t.employeeId) : null; const d = dfn(t.expiryDate); return `<div class="alr ${d < 0 ? 'alr-r' : 'alr-a'}">${emp ? h(en(emp)) : '—'} — ${h(t.courseName)} ${d < 0 ? 'EXPIRED' : 'expires ' + fd(t.expiryDate)}</div>` }).join("");
  const rows = list.map(t => { const emp = t.employeeId ? ebi(t.employeeId) : null; const d = t.expiryDate ? dfn(t.expiryDate) : null; const st = d === null ? '<span class="b b-nt">No expiry</span>' : d < 0 ? '<span class="b b-cr">Expired</span>' : d <= 30 ? `<span class="b b-wn">${d}d</span>` : `<span class="b b-ok">${d}d</span>`; return `<tr class="${d !== null && d < 0 ? 'rflag' : ''}"><td>${emp ? '<strong>' + h(en(emp)) + '</strong>' : '—'}</td><td>${h(t.courseName)}</td><td>${h(t.category)}</td><td>${fd(t.completedDate)}</td><td>${fd(t.expiryDate)}</td><td>${st}</td><td>${h(t.certNumber || '')}</td><td class="btn-grp">${isAdmin() ? `<button class="btn btn-s" onclick="editTraining('${t.id}')">&#9998;</button><button class="btn btn-s" onclick="delTraining('${t.id}')" style="color:var(--cr)">&#10005;</button>` : ''}</td></tr>` }).join("");
  $("#c-training").innerHTML = `${alerts}<div class="srow"><select id="trn-sf" onchange="rTraining()"><option value="">All Categories</option>${co}</select><select id="trn-ef" onchange="rTraining()"><option value="">All Employees</option>${eo}</select><span class="sm muted" style="margin-left:auto">${list.length} records</span>${isAdmin() ? `<button class="btn btn-p" onclick="editTraining('')">+ Add Training</button>` : ''}</div><div class="card"><div class="card-h">Training & Certificates<span class="sub">${list.length}</span></div><div class="tw"><table><thead><tr><th>Employee</th><th>Course</th><th>Category</th><th>Completed</th><th>Expiry</th><th>Status</th><th>Cert #</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="tc muted">No training records.</td></tr>'}</tbody></table></div></div>`;
}
function editTraining(id) {
  const t = id ? (D.training || []).find(x => x.id === id) : null; const v = f => t ? h(t[f] || "") : "";
  const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}" ${t && t.employeeId === e.id ? 'selected' : ''}>${en(e)}</option>`).join("");
  const co = TRAIN_CATS.map(c => `<option ${t && t.category === c ? 'selected' : ''}>${c}</option>`).join("");
  modal(t ? "Edit Training" : "Add Training", `<div class="fr"><div class="fg"><label>Employee *</label><select id="tf-emp">${eo}</select></div><div class="fg"><label>Category</label><select id="tf-cat">${co}</select></div></div><div class="fr"><div class="fg" style="flex:2"><label>Course Name *</label><input id="tf-cn" value="${v("courseName")}" placeholder="e.g. First Aid at Work Level 3"></div></div><div class="fr"><div class="fg"><label>Completed</label><input id="tf-cd" type="date" value="${v("completedDate") || iso()}"></div><div class="fg"><label>Expiry</label><input id="tf-ed" type="date" value="${v("expiryDate")}"></div></div><div class="fr"><div class="fg"><label>Certificate #</label><input id="tf-cert" value="${v("certNumber")}"></div><div class="fg"><label>Provider</label><input id="tf-prov" value="${v("provider")}"></div></div><div class="fr"><div class="fg" style="flex:2"><label>Notes</label><input id="tf-nt" value="${v("notes")}"></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveTraining('${id || ''}')">&#10003; Save</button></div>`);
}
function saveTraining(id) { const g = x => ($(x) || {}).value || ""; const o = { id: id || uid("TRN"), employeeId: g("#tf-emp"), category: g("#tf-cat"), courseName: g("#tf-cn"), completedDate: g("#tf-cd"), expiryDate: g("#tf-ed"), certNumber: g("#tf-cert"), provider: g("#tf-prov"), notes: g("#tf-nt") }; if (!o.courseName) { alert("Course name required."); return } saveTrainingFS(o); closeM() }
function delTraining(id) { if (!confirm("Delete?")) return; deleteTrainingFS(id) }

/* ═══ HR CASES ════════════════════════════════════════════════ */
const CASE_TYPES = ["Disciplinary", "Grievance", "Performance Improvement", "Absence Management", "Probation Review", "Capability", "Harassment / Bullying", "Whistleblowing", "Other"];
const CASE_STAGES = ["Investigation", "Hearing", "Appeal", "Monitoring", "Closed"];
function rHRCases() {
  if (!isAdmin()) return;
  const oo = ($("#hrc-oo") || {}).checked || false;
  let list = (D.hrCases || []).slice();
  if (oo) list = list.filter(c => c.status === "Open");
  list.sort((a, b) => new Date(b.openedDate || 0) - new Date(a.openedDate || 0));
  const openCnt = (D.hrCases || []).filter(c => c.status === "Open").length;
  const rows = list.map(c => { const emp = c.employeeId ? ebi(c.employeeId) : null; return `<tr><td>${emp ? '<strong>' + h(en(emp)) + '</strong>' : '—'}</td><td>${h(c.caseType)}</td><td>${h(c.subject)}</td><td><span class="b ${c.severity === 'Serious' ? 'b-cr' : c.severity === 'Moderate' ? 'b-wn' : 'b-nt'}">${c.severity}</span></td><td>${h(c.stage)}</td><td>${fd(c.openedDate)}</td><td><span class="b ${c.status === 'Open' ? 'b-ac' : 'b-nt'}">${c.status}</span></td><td class="btn-grp">${c.status === 'Open' ? `<button class="btn btn-s" onclick="editHRCase('${c.id}')">&#9998;</button><button class="btn btn-s btn-ok" onclick="closeHRC('${c.id}')">Close</button>` : ''}<button class="btn btn-s" onclick="viewHRCase('${c.id}')">View</button></td></tr>` }).join("");
  $("#c-hrCases").innerHTML = `<div class="srow"><label class="sm" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="hrc-oo" ${oo ? 'checked' : ''} onchange="rHRCases()"> Open only</label><span class="sm muted" style="margin-left:auto">${openCnt} open · ${(D.hrCases||[]).length} total</span><button class="btn btn-p" onclick="editHRCase('')">+ New Case</button></div><div class="card"><div class="card-h">HR Cases<span class="sub">${list.length}</span></div><div class="tw"><table><thead><tr><th>Employee</th><th>Type</th><th>Subject</th><th>Severity</th><th>Stage</th><th>Opened</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="tc muted">No cases.</td></tr>'}</tbody></table></div></div><div class="card"><div class="card-b sm muted"><strong>Confidential.</strong> HR case records are restricted to administrators only. All actions are logged.</div></div>`;
}
function editHRCase(id) {
  const c = id ? (D.hrCases || []).find(x => x.id === id) : null; const v = f => c ? h(c[f] || "") : "";
  const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}" ${c && c.employeeId === e.id ? 'selected' : ''}>${en(e)}</option>`).join("");
  const tOpts = CASE_TYPES.map(t => `<option ${c && c.caseType === t ? 'selected' : ''}>${t}</option>`).join("");
  const sOpts = CASE_STAGES.map(s => `<option ${c && c.stage === s ? 'selected' : ''}>${s}</option>`).join("");
  modal(c ? "Edit Case" : "New HR Case", `<div class="fr"><div class="fg"><label>Employee *</label><select id="hf-emp">${eo}</select></div><div class="fg"><label>Type *</label><select id="hf-type">${tOpts}</select></div></div><div class="fr"><div class="fg" style="flex:2"><label>Subject *</label><input id="hf-sub" value="${v("subject")}" placeholder="Brief description"></div></div><div class="fr"><div class="fg"><label>Severity</label><select id="hf-sev"><option ${c && c.severity === 'Minor' ? 'selected' : ''}>Minor</option><option ${c && c.severity === 'Moderate' ? 'selected' : ''}>Moderate</option><option ${c && c.severity === 'Serious' ? 'selected' : ''}>Serious</option></select></div><div class="fg"><label>Stage</label><select id="hf-stg">${sOpts}</select></div></div><div class="fr"><div class="fg"><label>Date Opened</label><input id="hf-dt" type="date" value="${v("openedDate") || iso()}"></div><div class="fg"><label>Investigating Officer</label><input id="hf-io" value="${v("investigatingOfficer")}"></div></div><div class="fr"><div class="fg" style="flex:2"><label>Details</label><textarea id="hf-det" rows="3">${v("details")}</textarea></div></div><div class="fr"><div class="fg" style="flex:2"><label>Outcome / Notes</label><textarea id="hf-out" rows="2">${v("outcome")}</textarea></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveHRCase('${id || ''}')">&#10003; Save</button></div>`);
}
function saveHRCase(id) { const g = x => ($(x) || {}).value || ""; const o = { id: id || uid("HRC"), employeeId: g("#hf-emp"), caseType: g("#hf-type"), subject: g("#hf-sub"), severity: g("#hf-sev"), stage: g("#hf-stg"), openedDate: g("#hf-dt"), investigatingOfficer: g("#hf-io"), details: g("#hf-det"), outcome: g("#hf-out"), status: "Open" }; if (!o.subject) { alert("Subject required."); return } saveHRCaseFS(o); closeM() }
function closeHRC(id) { if (!confirm("Close this case?")) return; closeHRCaseFS(id) }
function viewHRCase(id) { const c = (D.hrCases || []).find(x => x.id === id); if (!c) return; const emp = c.employeeId ? ebi(c.employeeId) : null; modal("Case — " + (c.subject || ""), `<div class="ig">${ic("Employee", emp ? en(emp) : "—")}${ic("Type", c.caseType)}${ic("Severity", c.severity)}${ic("Stage", c.stage)}${ic("Status", c.status)}${ic("Opened", fd(c.openedDate))}${ic("Investigating Officer", c.investigatingOfficer || "—")}${c.closedDate ? ic("Closed", fd(c.closedDate)) : ''}</div><div class="sdiv">Details</div><div style="font-size:var(--fs-sm);color:var(--text-secondary);white-space:pre-wrap">${h(c.details || "No details recorded.")}</div>${c.outcome ? `<div class="sdiv">Outcome</div><div style="font-size:var(--fs-sm);color:var(--text-secondary);white-space:pre-wrap">${h(c.outcome)}</div>` : ''}<div class="mt4 btn-grp">${c.status === 'Open' ? `<button class="btn btn-p btn-s" onclick="closeM();editHRCase('${c.id}')">&#9998; Edit</button><button class="btn btn-ok btn-s" onclick="closeHRC('${c.id}');closeM()">Close Case</button>` : ''}</div>`) }

/* ═══ CoS TRACKING ════════════════════════════════════════════ */
const COS_STATUSES = ["Assigned", "Used", "Expired", "Withdrawn", "Pending"];
function rCos() {
  if (!isAdmin()) return;
  let list = (D.cosRecords || []).slice();
  list.sort((a, b) => new Date(b.assignedDate || 0) - new Date(a.assignedDate || 0));
  const sponsored = (D.employees || []).filter(e => e.status !== "Deleted" && e.isSponsored);
  const rows = list.map(c => { const emp = c.employeeId ? ebi(c.employeeId) : null; const expD = c.expiryDate ? dfn(c.expiryDate) : null; return `<tr><td>${emp ? '<strong>' + h(en(emp)) + '</strong>' : '—'}</td><td class="mono sm">${h(c.cosNumber)}</td><td>${h(c.jobTitle)}</td><td>${h(c.socCode)}</td><td>${fd(c.assignedDate)}</td><td>${fd(c.expiryDate)} ${expD !== null && expD <= 30 ? `<span class="b ${expD < 0 ? 'b-cr' : 'b-wn'}">${expD}d</span>` : ''}</td><td><span class="b ${c.cosStatus === 'Used' ? 'b-ok' : c.cosStatus === 'Expired' ? 'b-cr' : c.cosStatus === 'Assigned' ? 'b-ac' : 'b-nt'}">${c.cosStatus}</span></td><td class="btn-grp"><button class="btn btn-s" onclick="editCos('${c.id}')">&#9998;</button><button class="btn btn-s" onclick="delCos('${c.id}')" style="color:var(--cr)">&#10005;</button></td></tr>` }).join("");
  const sponsoredList = sponsored.map(e => `<div class="alr ${e.visaExpiry && dfn(e.visaExpiry) <= 90 ? (dfn(e.visaExpiry) <= 30 ? 'alr-r' : 'alr-a') : 'alr-g'}">${h(en(e))} — ${e.visaType || 'Sponsored'} — Visa ${e.visaExpiry ? fd(e.visaExpiry) : 'No date'}</div>`).join("");
  $("#c-cos").innerHTML = `<div class="card mb3"><div class="card-h">Sponsored Workers<span class="sub">${sponsored.length}</span></div><div class="card-b">${sponsoredList || '<div class="tc muted sm">No sponsored employees.</div>'}</div></div><div class="srow"><span class="sm muted">${list.length} CoS records</span><div style="flex:1"></div><button class="btn btn-p" onclick="editCos('')">+ Add CoS</button></div><div class="card"><div class="card-h">Certificate of Sponsorship Records<span class="sub">${list.length}</span></div><div class="tw"><table><thead><tr><th>Employee</th><th>CoS Number</th><th>Job Title</th><th>SOC Code</th><th>Assigned</th><th>Expiry</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="tc muted">No CoS records.</td></tr>'}</tbody></table></div></div><div class="card"><div class="card-b sm muted"><strong>UKVI Requirement:</strong> CoS must be assigned before a sponsored worker can apply for/extend their visa. Track all certificates here for audit compliance.</div></div>`;
}
function editCos(id) {
  const c = id ? (D.cosRecords || []).find(x => x.id === id) : null; const v = f => c ? h(c[f] || "") : "";
  const eo = (D.employees || []).filter(e => e.status !== "Deleted" && e.isSponsored).map(e => `<option value="${e.id}" ${c && c.employeeId === e.id ? 'selected' : ''}>${en(e)}</option>`).join("");
  const stOpts = COS_STATUSES.map(s => `<option ${c && c.cosStatus === s ? 'selected' : ''}>${s}</option>`).join("");
  modal(c ? "Edit CoS" : "Add CoS", `<div class="fr"><div class="fg"><label>Sponsored Employee *</label><select id="cf-emp">${eo}</select></div><div class="fg"><label>CoS Number *</label><input id="cf-num" value="${v("cosNumber")}" placeholder="e.g. A1B2C3D4E"></div></div><div class="fr"><div class="fg"><label>Job Title (on CoS)</label><input id="cf-jt" value="${v("jobTitle")}"></div><div class="fg"><label>SOC Code</label><input id="cf-soc" value="${v("socCode")}" placeholder="e.g. 2136"></div></div><div class="fr"><div class="fg"><label>Assigned Date</label><input id="cf-ad" type="date" value="${v("assignedDate")}"></div><div class="fg"><label>Expiry Date</label><input id="cf-ed" type="date" value="${v("expiryDate")}"></div></div><div class="fr"><div class="fg"><label>Status</label><select id="cf-st">${stOpts}</select></div><div class="fg"><label>Salary (on CoS)</label><input id="cf-sal" type="number" value="${v("salary")}"></div></div><div class="fr"><div class="fg" style="flex:2"><label>Notes</label><input id="cf-nt" value="${v("notes")}"></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveCos('${id || ''}')">&#10003; Save</button></div>`);
}
function saveCos(id) { const g = x => ($(x) || {}).value || ""; const o = { id: id || uid("COS"), employeeId: g("#cf-emp"), cosNumber: g("#cf-num"), jobTitle: g("#cf-jt"), socCode: g("#cf-soc"), assignedDate: g("#cf-ad"), expiryDate: g("#cf-ed"), cosStatus: g("#cf-st"), salary: g("#cf-sal"), notes: g("#cf-nt") }; if (!o.cosNumber) { alert("CoS number required."); return } saveCosFS(o); closeM() }
function delCos(id) { if (!confirm("Delete CoS?")) return; deleteCosFS(id) }

/* ═══ SPONSOR LICENCE HUB ═════════════════════════════════════ */
const CHECKLIST_ITEMS = [
  { id: "cl01", label: "Business bank statements (last 3-6 months)", cat: "Finance" },
  { id: "cl02", label: "Management accounts / annual accounts", cat: "Finance" },
  { id: "cl03", label: "Evidence of trading (invoices, contracts, delivery records)", cat: "Finance" },
  { id: "cl04", label: "PAYE & HMRC registration / records", cat: "Finance" },
  { id: "cl05", label: "Employer's liability insurance certificate", cat: "Legal" },
  { id: "cl06", label: "Proof of business premises (lease/ownership)", cat: "Legal" },
  { id: "cl07", label: "Operator's Licence (application/granted)", cat: "Legal" },
  { id: "cl08", label: "Fleet ownership / lease / insurance documents", cat: "Fleet" },
  { id: "cl09", label: "Organisational chart / hierarchy chart", cat: "HR" },
  { id: "cl10", label: "Staff list with immigration status, hours, salary", cat: "HR" },
  { id: "cl11", label: "Employment contracts for all staff", cat: "HR" },
  { id: "cl12", label: "Right to work evidence for all staff", cat: "HR" },
  { id: "cl13", label: "Payslips and payroll records (all staff)", cat: "HR" },
  { id: "cl14", label: "Employment contract for sponsored worker", cat: "Sponsored Worker" },
  { id: "cl15", label: "Payslips / RTI for sponsored worker", cat: "Sponsored Worker" },
  { id: "cl16", label: "Right to work evidence for sponsored worker", cat: "Sponsored Worker" },
  { id: "cl17", label: "Degree certificates / qualification evidence", cat: "Sponsored Worker" },
  { id: "cl18", label: "Passport / BRP / eVisa evidence", cat: "Sponsored Worker" },
  { id: "cl19", label: "Job description for sponsored role", cat: "Sponsored Worker" },
  { id: "cl20", label: "Evidence of who carries out sponsor duties", cat: "Sponsor Duties" },
  { id: "cl21", label: "SMS access details documented", cat: "Sponsor Duties" }
];

const INTERVIEW_QA = [
  { s: "Identity", q: "Please confirm your full name, date of birth, nationality, and position within the company?", a: "" },
  { s: "Business", q: "Please confirm your company name?", a: "Xeagle Ltd." },
  { s: "Business", q: "Can you tell me briefly about the business and what it does?", a: "Xeagle Ltd is a UK-registered logistics and road freight transport business providing road haulage, courier and freight services across the UK including same-day/next-day deliveries, general haulage, palletised freight, European courier services, event logistics, refrigerated transport and hazardous goods transport." },
  { s: "Business", q: "Where is the business based and what are your working hours?", a: "Registered office: 1 Huddersfield Road, Bradford, England, BD6 1DH. Working hours: Monday to Saturday 9:00 AM – 6:00 PM. Sunday closed." },
  { s: "Business", q: "When was the company established?", a: "Incorporated 8 July 2024 and trading since establishment." },
  { s: "Business", q: "What sector does the business operate in?", a: "Road freight transport and logistics sector." },
  { s: "Business", q: "What vehicles or operational resources does the business have?", a: "Developing fleet including two HGVs and light commercial vans, plus approved subcontracted transport partners and ad-hoc drivers." },
  { s: "Business", q: "Do you hold or have you applied for an Operator's Licence?", a: "Yes, Xeagle Ltd has applied for a UK Operator's Licence." },
  { s: "Finance", q: "How many business bank accounts does the company have?", a: "One primary business bank account." },
  { s: "Finance", q: "What is the current turnover?", a: "Period ended 31 Dec 2025: £63,410. Period ended 31 Jul 2025: £74,905." },
  { s: "Finance", q: "What is the company's current profit position?", a: "Period ended 31 Dec 2025: operating profit £3,854. Period ended 31 Jul 2025: operating profit £3,567, profit after tax £2,973." },
  { s: "Finance", q: "What are the company's main costs?", a: "Subcontractor costs, wages/salaries, staff training, motor expenses, rent, telephone/internet, insurance, equipment, accountancy fees, advertising and professional costs." },
  { s: "Finance", q: "How do you intend to meet salary costs for the sponsored worker?", a: "From business income generated through freight, courier and haulage operations." },
  { s: "Staff", q: "How many staff currently work for you?", a: "" },
  { s: "Staff", q: "Who manages day-to-day operations?", a: "Manpreet Kaur, Managing Director." },
  { s: "Staff", q: "Who is responsible for HR, recruitment and immigration compliance?", a: "Devanshu Tejpal Kumar, Authorising Officer. Payroll managed by external accountant." },
  { s: "Staff", q: "Who monitors visa expiry dates and right to work compliance?", a: "Authorising Officer monitors internally. Records maintained in HR software system and employee compliance folders." },
  { s: "Licence", q: "Why do you need a sponsor licence?", a: "To retain an existing employee currently on Graduate visa route. Her visa is time-limited and we wish to continue employing her lawfully in a genuine skilled role." },
  { s: "Licence", q: "Are you seeking to sponsor an existing employee or recruit new?", a: "Existing employee." },
  { s: "Licence", q: "Why can this worker not remain without sponsorship?", a: "Currently on Graduate visa which is temporary and does not provide long-term right to work." },
  { s: "Worker", q: "Worker's full name, DOB, nationality, immigration status?", a: "Shrutika Rahul Kachariya, DOB 15/01/1997, Indian, Graduate Visa / Post-Study Work." },
  { s: "Worker", q: "When did she enter the UK?", a: "13 January 2023." },
  { s: "Worker", q: "What qualifications does she hold?", a: "Master's degree from University of Lincoln, Bachelor's degree in Commerce." },
  { s: "Worker", q: "What is her current role and since when?", a: "Accounts Manager since 19 Nov 2025." },
  { s: "Job", q: "What role are you sponsoring? SOC code?", a: "Accounts Manager. SOC 3534 – Financial accounts managers." },
  { s: "Job", q: "What is the salary?", a: "£36,000/year. Meets New Entrant threshold (going rate £44,700 but New Entrant provisions apply)." },
  { s: "Job", q: "Weekly working hours?", a: "37.5 hours per week." },
  { s: "Job", q: "Why is this role a genuine vacancy?", a: "Supports essential commercial/admin functions — account management, invoicing, reconciliation, client billing, financial reporting. Needed ongoing as business expands." },
  { s: "Job", q: "What will the worker do daily?", a: "Manage client accounts, billing records, invoicing, payment schedules, credit control, reconciliations, liaise with operations, maintain financial documents, prepare account summaries, handle client queries, support new client onboarding." },
  { s: "RTW", q: "How do you check right to work?", a: "Before employment: obtain immigration documents or online RTW evidence, verify permission to work, confirm conditions/expiry dates, keep copies of records." },
  { s: "RTW", q: "How do you monitor visa expiry dates?", a: "Systems in place to monitor visa expiry and maintain compliant records. Can demonstrate via screen share of ComplianceOS system." },
  { s: "RTW", q: "What would you do if sponsored worker stopped attending?", a: "Contact worker, investigate absence, maintain records of all communication. If unexplained, report to UKVI via SMS within 10 working days." },
  { s: "RTW", q: "What changes would you report to UKVI?", a: "Job role, salary, hours, work location, employment status, unexplained absences, termination." },
  { s: "Payroll", q: "How are employees paid?", a: "Bank transfer via PAYE. Payroll managed by external accountant." },
  { s: "Payroll", q: "How frequently will sponsored worker be paid?", a: "Monthly from 6 April 2026 (currently weekly)." },
  { s: "Duties", q: "What do you understand your sponsor duties to be?", a: "Employ only in stated role at declared salary/hours, keep required records, monitor immigration status/attendance, report changes to UKVI within required timeframes." },
  { s: "Duties", q: "Who will manage the Sponsor Management System?", a: "Authorising Officer: Devanshu Tejpal Kumar. Key Contact: Devanshu Tejpal Kumar. Level 1 User: Devanshu Tejpal Kumar." }
];

const REPORT_EVENTS = [
  { event: "Worker does not start employment", days: 10, desc: "Report if worker fails to start on expected date" },
  { event: "Worker is absent without permission for 10+ consecutive working days", days: 10, desc: "Unexplained absence — contact worker first, then report" },
  { event: "Sponsorship is withdrawn / employment ends", days: 10, desc: "If you stop sponsoring or worker leaves" },
  { event: "Change to worker's job title or duties", days: 10, desc: "Any change to the role on the CoS" },
  { event: "Change to worker's salary (decrease)", days: 10, desc: "If salary drops below CoS level" },
  { event: "Change to worker's core hours", days: 10, desc: "Significant change in working pattern" },
  { event: "Change to worker's work location", days: 10, desc: "New site or permanent WFH" },
  { event: "Worker's contract end / not renewed", days: 10, desc: "End of fixed-term or permanent role" }
];

function rSponsorHub() {
  if (!isAdmin()) return;
  const hub = D.sponsorHub || {};
  const checklist = hub.checklist || {};
  const emps = (D.employees || []).filter(e => e.status !== "Deleted");
  const co = D.company || {};

  // Checklist stats
  const done = CHECKLIST_ITEMS.filter(c => checklist[c.id] === "ready").length;
  const partial = CHECKLIST_ITEMS.filter(c => checklist[c.id] === "partial").length;
  const missing = CHECKLIST_ITEMS.length - done - partial;
  const pct = Math.round((done / CHECKLIST_ITEMS.length) * 100);

  // Tabs
  const tabs = ["Overview", "Interview Prep", "Checklist", "Staff List", "Reporting Rules"];

  // Tab 0 — Overview
  const t0 = `
    <div class="stats" style="margin-bottom:20px">
      <div class="tile t-bl"><div class="tl">Readiness</div><div class="tv">${pct}%</div><div class="ts">${done}/${CHECKLIST_ITEMS.length} items ready</div></div>
      <div class="tile ${missing > 0 ? 't-rd' : 't-gn'}"><div class="tl">Missing</div><div class="tv">${missing}</div><div class="ts">Documents needed</div></div>
      <div class="tile t-bl"><div class="tl">Staff</div><div class="tv">${emps.length}</div><div class="ts">${emps.filter(e => e.isSponsored).length} to sponsor</div></div>
    </div>
    <div class="card"><div class="card-h">Sponsor Licence Key Contacts</div><div class="card-b"><div class="ig">
      ${ic("Authorising Officer", hub.authOfficer || co.authorisedOfficer || "—")}
      ${ic("Key Contact", hub.keyContact || co.keyContact || "—")}
      ${ic("Level 1 User", hub.level1User || "—")}
      ${ic("Company", co.name || "—")}
      ${ic("Company Number", co.companyNumber || "—", 1)}
      ${ic("Address", co.registeredAddress || "—")}
    </div><div class="mt3"><button class="btn btn-s" onclick="editSponsorContacts()">&#9998; Edit Contacts</button></div></div></div>
    <div class="card"><div class="card-h">Sponsor Duties Summary</div><div class="card-b">
      <div class="alr alr-g">&#10003; <strong>Record Keeping</strong> — Employee records, RTW checks, contracts, payslips stored in this system</div>
      <div class="alr alr-g">&#10003; <strong>Visa Monitoring</strong> — Automated expiry tracking with ${cntVisa()} active alerts</div>
      <div class="alr alr-g">&#10003; <strong>Attendance Tracking</strong> — Monthly calendar with absence monitoring</div>
      <div class="alr alr-g">&#10003; <strong>Reporting Log</strong> — ${(D.reportingLog||[]).length} events logged, ${cntOpen()} open</div>
      <div class="alr ${emps.filter(e=>!e.rtwEvidenceFile&&e.office!=="OFF03").length>0?'alr-a':'alr-g'}">${emps.filter(e=>!e.rtwEvidenceFile&&e.office!=="OFF03").length>0?'&#9888;':'&#10003;'} <strong>RTW Evidence</strong> — ${emps.filter(e=>!e.rtwEvidenceFile&&e.office!=="OFF03").length} employees missing evidence</div>
    </div></div>
    <div class="card"><div class="card-b sm muted"><strong>Tip:</strong> During your UKVI interview, you can share your screen and show this system. Navigate to Visa & RTW to show live visa monitoring, Employee Records for staff profiles, and this Sponsor Hub for your compliance overview.</div></div>`;

  // Tab 1 — Interview Prep
  const sections = [...new Set(INTERVIEW_QA.map(q => q.s))];
  const savedAnswers = hub.answers || {};
  const qaHtml = sections.map(s => {
    const qs = INTERVIEW_QA.filter(q => q.s === s);
    return `<div class="sdiv">${s}</div>${qs.map((q, i) => {
      const idx = INTERVIEW_QA.indexOf(q);
      const saved = savedAnswers["q" + idx] || q.a;
      const auto = autoAnswer(q, emps, co);
      return `<div class="card" style="margin-bottom:10px"><div class="card-b"><div style="font-weight:600;color:var(--text);margin-bottom:6px;font-size:var(--fs-sm)">Q${idx + 1}: ${h(q.q)}</div><textarea id="qa-${idx}" rows="2" style="width:100%;font-size:var(--fs-sm)">${h(saved || auto)}</textarea></div></div>`;
    }).join("")}`;
  }).join("");
  const t1 = `<div class="alr alr-g mb3">&#128161; Review all answers before your interview. Click <strong>Save All Answers</strong> when done. Auto-populated from your system data where possible.</div>${qaHtml}<div class="mt4" style="text-align:right"><button class="btn btn-ok" onclick="saveAllQA()">&#10003; Save All Answers</button></div>`;

  // Tab 2 — Checklist
  const cats = [...new Set(CHECKLIST_ITEMS.map(c => c.cat))];
  const clHtml = cats.map(cat => {
    const items = CHECKLIST_ITEMS.filter(c => c.cat === cat);
    return `<div class="sdiv">${cat}</div>${items.map(c => {
      const st = checklist[c.id] || "missing";
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <select style="width:90px;font-size:var(--fs-xs);padding:3px 6px" onchange="updateChecklist('${c.id}',this.value)">
          <option value="missing" ${st === "missing" ? "selected" : ""}>&#10060; Missing</option>
          <option value="partial" ${st === "partial" ? "selected" : ""}>&#9888; Partial</option>
          <option value="ready" ${st === "ready" ? "selected" : ""}>&#10003; Ready</option>
        </select>
        <span style="font-size:var(--fs-sm);font-weight:500;color:var(--text)">${c.label}</span>
      </div>`;
    }).join("")}`;
  }).join("");
  const t2 = `<div style="display:flex;gap:14px;margin-bottom:16px">
    <div class="b b-ok">&#10003; ${done} Ready</div>
    <div class="b b-wn">&#9888; ${partial} Partial</div>
    <div class="b b-cr">&#10060; ${missing} Missing</div>
    <div style="margin-left:auto;font-weight:700;font-size:var(--fs-lg);color:var(--text)">${pct}%</div>
  </div>
  <div style="height:6px;background:var(--nav-active);border-radius:3px;margin-bottom:20px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--wn)' : 'var(--cr)'};border-radius:3px;transition:width .3s var(--ease)"></div></div>
  ${clHtml}`;

  // Tab 3 — UKVI Staff List
  const staffRows = emps.map(e => `<tr><td><strong>${h(en(e))}</strong></td><td>${h(e.jobTitle)}</td><td>${h(e.nationality)}</td><td>${h(e.immigrationStatus)}</td><td>37.5</td><td>${e.salary ? '£' + Number(e.salary).toLocaleString() : '—'}</td><td>${h(offName(e.office))}</td></tr>`).join("");
  const t3 = `<div class="alr alr-g mb3">&#128161; This is Question 24 — ready to show on screen during interview. Click Export to download as CSV.</div>
    <div style="margin-bottom:12px;text-align:right"><button class="btn btn-s" onclick="expStaffListCSV()">&#128190; Export CSV</button></div>
    <div class="card"><div class="card-h">Staff List (UKVI Format)<span class="sub">${emps.length} employees</span></div><div class="tw"><table><thead><tr><th>Name</th><th>Role</th><th>Nationality</th><th>Immigration Status</th><th>Hours/wk</th><th>Salary</th><th>Office</th></tr></thead><tbody>${staffRows || '<tr><td colspan="7" class="tc muted">No employees.</td></tr>'}</tbody></table></div></div>`;

  // Tab 4 — Reporting Rules
  const repHtml = REPORT_EVENTS.map(r => `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
    <div class="b b-cr" style="flex-shrink:0;min-width:50px;text-align:center">${r.days} days</div>
    <div><div style="font-weight:600;font-size:var(--fs-sm);color:var(--text)">${r.event}</div><div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-top:2px">${r.desc}</div></div>
  </div>`).join("");
  const t4 = `<div class="alr alr-a mb3">&#9888; All reportable events must be reported to UKVI via the Sponsor Management System (SMS) within <strong>10 working days</strong>.</div>
    <div class="card"><div class="card-h">Reportable Events & Deadlines</div><div class="card-b">${repHtml}</div></div>
    <div class="card"><div class="card-b sm muted"><strong>Key Rule:</strong> If a sponsored worker is absent without permission for 10+ consecutive working days and you cannot contact them, you MUST report to UKVI within 10 working days. Always attempt contact first and document all attempts.</div></div>`;

  const tabHtml = tabs.map((t, i) => `<div class="dtab ${i === 0 ? 'active' : ''}" onclick="switchTab(this,${i})">${t}</div>`).join("");
  const bodyHtml = [t0, t1, t2, t3, t4].map((t, i) => `<div class="dtab-body ${i === 0 ? 'active' : ''}">${t}</div>`).join("");

  $("#c-sponsorHub").innerHTML = `<div class="dtabs">${tabHtml}</div>${bodyHtml}`;
}

function autoAnswer(q, emps, co) {
  const qText = q.q.toLowerCase();
  if (qText.includes("how many staff")) return emps.length + " employees.";
  if (qText.includes("company name")) return co.name || "";
  return "";
}

function editSponsorContacts() {
  const hub = D.sponsorHub || {};
  modal("Sponsor Licence Contacts", `<div class="fr"><div class="fg"><label>Authorising Officer</label><input id="sh-ao" value="${h(hub.authOfficer || '')}"></div><div class="fg"><label>Key Contact</label><input id="sh-kc" value="${h(hub.keyContact || '')}"></div></div><div class="fr"><div class="fg"><label>Level 1 User</label><input id="sh-l1" value="${h(hub.level1User || '')}"></div><div class="fg"><label>SMS Login Email</label><input id="sh-sms" value="${h(hub.smsEmail || '')}"></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveSponsorContacts()">&#10003; Save</button></div>`);
}
function saveSponsorContacts() {
  const g = x => ($(x) || {}).value || "";
  saveSponsorHubFS({ authOfficer: g("#sh-ao"), keyContact: g("#sh-kc"), level1User: g("#sh-l1"), smsEmail: g("#sh-sms") });
  closeM();
}

function saveAllQA() {
  const answers = {};
  INTERVIEW_QA.forEach((q, i) => { const el = $(`#qa-${i}`); if (el) answers["q" + i] = el.value });
  saveSponsorHubFS({ answers });
  alert("All answers saved.");
}

function updateChecklist(id, val) {
  const hub = D.sponsorHub || {};
  const checklist = hub.checklist || {};
  checklist[id] = val;
  saveSponsorHubFS({ checklist });
}

function expStaffListCSV() {
  const hdr = ["Name", "Role", "Nationality", "Immigration Status", "Hours/wk", "Salary", "Office"];
  const rows = (D.employees || []).filter(e => e.status !== "Deleted").map(e => [en(e), e.jobTitle, e.nationality, e.immigrationStatus, "37.5", e.salary, offName(e.office)]);
  expCSV("ukvi_staff_list", hdr, rows);
}

/* ═══ COMPLIANCE REPORTS ══════════════════════════════════════ */
function rReports() {
  if (!isAdmin()) return;
  const emps = (D.employees || []).filter(e => e.status !== "Deleted");
  const sponsored = emps.filter(e => e.isSponsored);
  const visaIssues = emps.filter(e => e.visaExpiry && dfn(e.visaExpiry) <= 90);
  const rtwOverdue = emps.filter(e => e.rtwCheckDate && dfn(e.rtwCheckDate) < -365);
  const rtwMissing = emps.filter(e => !e.rtwEvidenceFile && e.office !== "OFF03");
  const trnExpiring = (D.training || []).filter(t => t.expiryDate && dfn(t.expiryDate) <= 30);
  const openCases = (D.hrCases || []).filter(c => c.status === "Open");
  const openRpts = (D.reportingLog || []).filter(r => r.status === "Open");
  const vehAlerts = [];
  (D.vehicles || []).forEach(v => { if (v.motDueDate && dfn(v.motDueDate) <= 30) vehAlerts.push(v); if (v.taxExpiry && dfn(v.taxExpiry) <= 30) vehAlerts.push(v) });

  const genCSV = (name, headers, rows) => {
    let csv = headers.join(",") + "\n";
    rows.forEach(r => { csv += r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(",") + "\n" });
    const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `xeagle_${name}_${iso()}.csv`; a.click();
  };

  const rCard = (title, count, cls, desc, items, cols, btnFn) => {
    const hdr = cols.map(c => `<th>${c}</th>`).join("");
    return `<div class="card"><div class="card-h flex-b"><span>${title} <span class="b ${cls}">${count}</span></span>${btnFn ? `<button class="btn btn-s" onclick="${btnFn}">&#128190; CSV</button>` : ''}</div>${items ? `<div class="tw"><table><thead><tr>${hdr}</tr></thead><tbody>${items}</tbody></table></div>` : `<div class="card-b tc muted sm">${desc}</div>`}</div>`;
  };

  // UKVI Sponsored Workers report
  const spRows = sponsored.map(e => `<tr><td><strong>${h(en(e))}</strong></td><td>${h(e.visaType)}</td><td>${fd(e.visaExpiry)}</td><td>${e.visaExpiry ? dfn(e.visaExpiry) + 'd' : '—'}</td><td>${h(e.shareCode)}</td><td>${h(offName(e.office))}</td></tr>`).join("");

  // RTW Compliance report
  const rtwRows = emps.map(e => `<tr><td>${h(en(e))}</td><td>${h(e.immigrationStatus)}</td><td>${fd(e.rtwCheckDate)}</td><td>${e.rtwEvidenceFile ? '<span class="b b-ok">Yes</span>' : '<span class="b b-cr">Missing</span>'}</td><td>${h(e.rtwMethod || '—')}</td></tr>`).join("");

  // Training compliance
  const trnRows = trnExpiring.map(t => { const emp = t.employeeId ? ebi(t.employeeId) : null; return `<tr><td>${emp ? h(en(emp)) : '—'}</td><td>${h(t.courseName)}</td><td>${fd(t.expiryDate)}</td><td>${dfn(t.expiryDate)}d</td></tr>` }).join("");

  $("#c-reports").innerHTML = `
    <div class="stats" style="margin-bottom:24px">
      <div class="tile t-bl"><div class="tl">Total Staff</div><div class="tv">${emps.length}</div></div>
      <div class="tile ${sponsored.length > 0 ? 't-am' : 't-gn'}"><div class="tl">Sponsored</div><div class="tv">${sponsored.length}</div></div>
      <div class="tile ${visaIssues.length > 0 ? 't-rd' : 't-gn'}"><div class="tl">Visa Issues</div><div class="tv">${visaIssues.length}</div></div>
      <div class="tile ${rtwMissing.length > 0 ? 't-rd' : 't-gn'}"><div class="tl">RTW Missing</div><div class="tv">${rtwMissing.length}</div></div>
    </div>
    ${rCard("UKVI — Sponsored Workers", sponsored.length, "b-ac", "No sponsored workers.", spRows, ["Name", "Visa Type", "Expiry", "Days", "Share Code", "Office"], `expSponsoredCSV()`)}
    ${rCard("Right to Work Compliance", emps.length, "b-nt", "", rtwRows, ["Name", "Immigration", "Last Check", "Evidence", "Method"], `expRTWCSV()`)}
    ${trnExpiring.length ? rCard("Training Expiring (30d)", trnExpiring.length, "b-wn", "", trnRows, ["Employee", "Course", "Expiry", "Days"], null) : ''}
    <div class="card"><div class="card-h">Export Reports</div><div class="card-b btn-grp">
      <button class="btn" onclick="expSponsoredCSV()">&#128190; Sponsored Workers CSV</button>
      <button class="btn" onclick="expRTWCSV()">&#128190; RTW Compliance CSV</button>
      <button class="btn" onclick="expAllEmpCSV()">&#128190; All Employees CSV</button>
      <button class="btn" onclick="expTrainingCSV()">&#128190; Training CSV</button>
      <button class="btn" onclick="expJSON()">&#128190; Full Data JSON</button>
    </div></div>
    <div class="card"><div class="card-b sm muted"><strong>Audit Ready:</strong> These reports are designed for UKVI compliance audits and Home Office inspections. Export as CSV for submission or record-keeping.</div></div>`;
}
function expSponsoredCSV() { const hdr = ["Name","Visa Type","Visa Expiry","Share Code","Share Code Expiry","BRP","RTW Check","RTW Method","Office"]; const rows = (D.employees||[]).filter(e=>e.status!=="Deleted"&&e.isSponsored).map(e=>[en(e),e.visaType,e.visaExpiry,e.shareCode,e.shareCodeExpiry,e.brpReference,e.rtwCheckDate,e.rtwMethod,offName(e.office)]); expCSV("sponsored_workers",hdr,rows) }
function expRTWCSV() { const hdr = ["Name","Nationality","Immigration","RTW Check Date","RTW Method","Evidence","Office"]; const rows = (D.employees||[]).filter(e=>e.status!=="Deleted").map(e=>[en(e),e.nationality,e.immigrationStatus,e.rtwCheckDate,e.rtwMethod,e.rtwEvidenceFile||"MISSING",offName(e.office)]); expCSV("rtw_compliance",hdr,rows) }
function expAllEmpCSV() { const hdr = ["ID","Name","DOB","NI","Job Title","Dept","Office","Start Date","Salary","Nationality","Immigration","Visa Type","Visa Expiry","Sponsored"]; const rows = (D.employees||[]).filter(e=>e.status!=="Deleted").map(e=>[e.id,en(e),e.dob,e.niNumber,e.jobTitle,e.department,offName(e.office),e.startDate,e.salary,e.nationality,e.immigrationStatus,e.visaType,e.visaExpiry,e.isSponsored?"Yes":"No"]); expCSV("all_employees",hdr,rows) }
function expTrainingCSV() { const hdr = ["Employee","Course","Category","Completed","Expiry","Cert #","Provider"]; const rows = (D.training||[]).map(t=>{const e=t.employeeId?ebi(t.employeeId):null;return[e?en(e):"—",t.courseName,t.category,t.completedDate,t.expiryDate,t.certNumber,t.provider]}); expCSV("training",hdr,rows) }
function expCSV(name,hdr,rows) { let csv=hdr.join(",")+"\n"; rows.forEach(r=>{csv+=r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(",")+"\n"}); const b=new Blob([csv],{type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=`xeagle_${name}_${iso()}.csv`; a.click() }

/* ═══ USERS ═══════════════════════════════════════════════════ */
let allUsers = [];
function rUsers() { if (!isAdmin()) return; db.collection("users").get().then(snap => { allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() })); const rows = allUsers.map(u => { const emp = u.employeeId ? ebi(u.employeeId) : null; return `<tr><td><strong>${h(u.displayName)}</strong></td><td class="mono sm">${h(u.email || u.id)}</td><td><span class="b ${u.role === 'admin' ? 'b-ac' : 'b-nt'}">${u.role}</span></td><td>${emp ? h(en(emp)) : '—'}</td><td>${h(offName(u.office))}</td><td><button class="btn btn-s" onclick="editUser('${u.id}')">Edit</button></td></tr>` }).join(""); $("#c-users").innerHTML = `<div class="card mb3"><div class="card-h">Create New User</div><div class="card-b"><div class="fr"><div class="fg"><label>Email *</label><input id="nu-em" type="email" placeholder="user@xeagle.co.uk"></div><div class="fg"><label>Password *</label><input id="nu-pw" type="text" placeholder="Min 6 chars"></div></div><div class="fr"><div class="fg"><label>Display Name</label><input id="nu-dn"></div><div class="fg"><label>Role</label><select id="nu-rl"><option value="staff">Staff</option><option value="admin">Admin</option></select></div></div><div class="fr"><div class="fg"><label>Linked Employee</label><select id="nu-emp"><option value="">—</option>${(D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}">${en(e)}</option>`).join("")}</select></div><div class="fg"><label>Office</label><select id="nu-of">${(D.offices || []).map(o => `<option value="${o.id}">${o.name}</option>`).join("")}</select></div></div><button class="btn btn-p mt2" onclick="createUser()">Create User</button></div></div><div class="card"><div class="card-h">Users<span class="sub">${allUsers.length}</span></div><div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Employee</th><th>Office</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>` }) }
async function createUser() { const em = ($("#nu-em") || {}).value || "", pw = ($("#nu-pw") || {}).value || "", dn = ($("#nu-dn") || {}).value || em, rl = ($("#nu-rl") || {}).value || "staff", emp = ($("#nu-emp") || {}).value || "", of2 = ($("#nu-of") || {}).value || "OFF01"; if (!em || !pw) { alert("Email and password required."); return } if (pw.length < 6) { alert("Min 6 characters."); return } try { const cred = await auth.createUserWithEmailAndPassword(em, pw); await db.collection("users").doc(cred.user.uid).set({ displayName: dn, role: rl, employeeId: emp, office: of2, email: em }); alert("User created: " + em); location.reload() } catch (e) { alert("Error: " + e.message) } }
function editUser(uid2) { const u = allUsers.find(x => x.id === uid2); if (!u) return; const eo = (D.employees || []).filter(e => e.status !== "Deleted").map(e => `<option value="${e.id}" ${u.employeeId === e.id ? 'selected' : ''}>${en(e)}</option>`).join(""); const oo = (D.offices || []).map(o => `<option value="${o.id}" ${u.office === o.id ? 'selected' : ''}>${o.name}</option>`).join(""); modal("Edit — " + (u.displayName || u.email), `<div class="fr"><div class="fg"><label>Display Name</label><input id="uf-dn" value="${h(u.displayName || "")}"></div><div class="fg"><label>Role</label><select id="uf-rl"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option></select></div></div><div class="fr"><div class="fg"><label>Linked Employee</label><select id="uf-emp"><option value="">—</option>${eo}</select></div><div class="fg"><label>Office</label><select id="uf-of">${oo}</select></div></div><div style="margin-top:16px;text-align:right"><button class="btn btn-ok" onclick="saveUser('${uid2}')">&#10003; Save</button></div>`) }
function saveUser(uid2) { const g = x => ($(x) || {}).value || ""; db.collection("users").doc(uid2).update({ displayName: g("#uf-dn"), role: g("#uf-rl"), employeeId: g("#uf-emp"), office: g("#uf-of") }); closeM(); setTimeout(rUsers, 500) }

/* ═══ MODAL ═══════════════════════════════════════════════════ */
function modal(t, b) { $("#mtitle").textContent = t; $("#mbody").innerHTML = b; $("#mbg").classList.add("open") }
function closeM() { $("#mbg").classList.remove("open") }

/* ═══ INIT ════════════════════════════════════════════════════ */
/* ═══ THEME ═══════════════════════════════════════════════════ */
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("xeagle_theme", t);
  const opts = $$("#theme-toggle .tt-opt");
  opts.forEach(o => o.classList.toggle("active", o.dataset.t === t));
}

/* ═══ INIT ════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  // Theme
  const saved = localStorage.getItem("xeagle_theme") || "light";
  setTheme(saved);
  $$("#theme-toggle .tt-opt").forEach(o => o.addEventListener("click", () => setTheme(o.dataset.t)));

  if (!initFirebase()) return;
  $("#mx").addEventListener("click", closeM);
  $("#mbg").addEventListener("click", e => { if (e.target.id === "mbg") closeM() });
  $("#l-btn").addEventListener("click", doLogin);
  $("#l-pass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin() });
  $("#l-user").addEventListener("keydown", e => { if (e.key === "Enter") $("#l-pass").focus() });
  auth.onAuthStateChanged(onAuthChange);
  window.addEventListener("online", () => syncStatus("online"));
  window.addEventListener("offline", () => syncStatus("offline"));
});
