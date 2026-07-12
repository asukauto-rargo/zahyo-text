"use strict";

// ====== 設定読み込み ======
const CONFIG = window.APP_CONFIG || null;
const FN_BASE = CONFIG ? `${CONFIG.SUPABASE_URL.replace(/\/$/, "")}/functions/v1` : "";
const ANON = CONFIG ? CONFIG.SUPABASE_ANON_KEY : "";
let threshold = CONFIG?.CONFIDENCE_THRESHOLD ?? 90;

// 抽出結果の状態
let currentRows = []; // [{x,y,confidence,note}]
let currentOverall = null;
let currentSource = "";

// ====== 起動時チェック ======
document.addEventListener("DOMContentLoaded", () => {
  if (!CONFIG || !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("YOUR-PROJECT")) {
    $("#configWarning").classList.remove("hidden");
  }
  $("#threshold").value = threshold;
  setupTabs();
  setupUpload();
  bindButtons();
  loadMailTarget();
});

// ====== 小道具 ======
function $(sel) { return document.querySelector(sel); }
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of [].concat(children)) e.append(c);
  return e;
}
async function callFn(path, { method = "POST", body, query } = {}) {
  const url = new URL(`${FN_BASE}/${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON}`,
      "apikey": ANON,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}` + (data.detail ? `: ${data.detail}` : ""));
  return data;
}

// ====== タブ ======
function setupTabs() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.querySelectorAll(".tabpanel").forEach((p) => p.classList.add("hidden"));
      $(`#tab-${t.dataset.tab}`).classList.remove("hidden");
      if (t.dataset.tab === "history") loadHistory();
      if (t.dataset.tab === "admin") loadMailStatus();
    });
  });
}

// ====== アップロード ======
let selectedFile = null;
function setupUpload() {
  const dz = $("#dropzone");
  const input = $("#fileInput");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => { if (input.files[0]) handleFile(input.files[0]); });
}
function handleFile(file) {
  const ok = file.type.startsWith("image/") || file.type === "application/pdf";
  if (!ok) { alert("画像か PDF を選んでください"); return; }
  selectedFile = file;
  currentSource = file.name;
  $("#fileInfo").textContent = `選択中: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  $("#extractBtn").disabled = false;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]); // data URL の後半
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ====== ボタン束ね ======
function bindButtons() {
  $("#extractBtn").addEventListener("click", runExtract);
  $("#threshold").addEventListener("input", (e) => {
    threshold = Number(e.target.value) || 0;
    renderTable();
  });
  $("#addRowBtn").addEventListener("click", () => {
    currentRows.push({ x: "", y: "", confidence: 100, note: "手動追加" });
    renderTable();
  });
  $("#downloadBtn").addEventListener("click", downloadTxt);
  $("#sendBtn").addEventListener("click", sendMail);
  $("#reloadHistory").addEventListener("click", loadHistory);
  $("#corrSubmit").addEventListener("click", submitCorrection);
  $("#saveEmailBtn").addEventListener("click", saveEmail);
}

// ====== 抽出 ======
async function runExtract() {
  if (!selectedFile) return;
  if (!CONFIG) { alert("config.js が未設定です"); return; }
  const btn = $("#extractBtn");
  btn.disabled = true;
  $("#extractStatus").textContent = "抽出中… (数十秒かかることがあります)";
  try {
    const b64 = await fileToBase64(selectedFile);
    const data = await callFn("extract", {
      body: { fileBase64: b64, mediaType: selectedFile.type },
    });
    currentRows = data.rows || [];
    currentOverall = data.overall_confidence ?? null;
    $("#extractStatus").textContent = `抽出完了: ${currentRows.length} 点 (モデル: ${data.model || "-"})`;
    showResult(data.warnings || []);
  } catch (err) {
    $("#extractStatus").textContent = "";
    alert("抽出に失敗しました: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

function showResult(warnings) {
  $("#resultCard").classList.remove("hidden");
  $("#outputCard").classList.remove("hidden");
  const b = $("#overallBanner");
  const cls = currentOverall >= threshold ? "ok" : "warn";
  b.className = "banner " + cls;
  b.textContent = `全体信頼度: ${currentOverall ?? "-"}% ／ 抽出点数: ${currentRows.length}`;
  $("#warnings").innerHTML = warnings.length
    ? "注意: " + warnings.map((w) => escapeHtml(w)).join(" / ") : "";
  renderTable();
}

function renderTable() {
  const tb = $("#coordTable").querySelector("tbody");
  tb.innerHTML = "";
  let low = 0;
  currentRows.forEach((r, i) => {
    const conf = Number(r.confidence);
    const tr = el("tr");
    if (conf < threshold) { tr.classList.add(conf < threshold - 15 ? "low" : "mid"); low++; }
    tr.append(el("td", { textContent: String(i + 1) }));
    tr.append(tdInput(r, "x"));
    tr.append(tdInput(r, "y"));
    const c = el("td", { className: "confcell", textContent: isFinite(conf) ? conf + "%" : "-" });
    tr.append(c);
    tr.append(tdInput(r, "note"));
    const del = el("td");
    const db = el("button", { className: "delbtn", textContent: "削除" });
    db.addEventListener("click", () => { currentRows.splice(i, 1); renderTable(); });
    del.append(db);
    tr.append(del);
    tb.append(tr);
  });
  $("#lowCount").textContent = low ? `要チェック: ${low} 行` : "要チェックなし";
  updatePreview();
}

function tdInput(row, key) {
  const td = el("td");
  const inp = el("input", { value: row[key] ?? "", type: "text" });
  inp.addEventListener("input", () => { row[key] = inp.value; if (key !== "note") updatePreview(); });
  td.append(inp);
  return td;
}

// ====== txt 出力 ======
function buildTxt() {
  return currentRows.map((r) => `${(r.x ?? "").trim()} ${(r.y ?? "").trim()}`).join("\r\n") + "\r\n";
}
function updatePreview() { $("#txtPreview").value = buildTxt(); }

function downloadTxt() {
  const blob = new Blob([buildTxt()], { type: "text/plain" });
  const a = el("a", { href: URL.createObjectURL(blob), download: sanitize($("#filename").value) });
  document.body.append(a); a.click(); a.remove();
}

// ====== メール送信 ======
async function loadMailTarget() {
  if (!CONFIG) return;
  try {
    const s = await callFn("settings", { method: "GET" });
    $("#mailTarget").textContent = s.configured
      ? `送信先: ${s.masked}` : "送信先メールが未登録です(③設定タブで登録)";
  } catch (e) {
    $("#mailTarget").textContent = "送信先の取得に失敗: " + e.message;
  }
}

async function sendMail() {
  if (currentRows.length === 0) { alert("送信する行がありません"); return; }
  const btn = $("#sendBtn");
  btn.disabled = true;
  $("#sendStatus").textContent = "送信中…";
  try {
    const data = await callFn("send", {
      body: {
        rows: currentRows,
        filename: sanitize($("#filename").value),
        source_name: currentSource,
        overall_confidence: currentOverall,
      },
    });
    $("#sendStatus").textContent = `送信完了 (記録ID: ${data.record?.id?.slice(0, 8) ?? "-"})`;
  } catch (e) {
    $("#sendStatus").textContent = "";
    alert("送信に失敗しました: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ====== 履歴・修正 ======
let historyRecords = [];
async function loadHistory() {
  try {
    const data = await callFn("records", { method: "GET", query: { corrections: "1" } });
    historyRecords = data.records || [];
    renderHistory(historyRecords);
    fillCorrectionSelect(historyRecords);
    renderCorrections(data.corrections || [], historyRecords);
  } catch (e) {
    alert("履歴の取得に失敗: " + e.message);
  }
}
function renderHistory(records) {
  const tb = $("#historyTable").querySelector("tbody");
  tb.innerHTML = "";
  records.forEach((r) => {
    tb.append(el("tr", {}, [
      el("td", { textContent: fmtDate(r.created_at) }),
      el("td", { textContent: r.filename }),
      el("td", { textContent: r.recipient }),
      el("td", { textContent: String(r.row_count) }),
      el("td", { textContent: r.overall_confidence != null ? r.overall_confidence + "%" : "-" }),
      el("td", { textContent: r.source_name || "-" }),
    ]));
  });
  if (!records.length) tb.append(el("tr", {}, [el("td", { colSpan: 6, textContent: "履歴はまだありません" })]));
}
function fillCorrectionSelect(records) {
  const sel = $("#corrRecord");
  sel.innerHTML = "";
  records.forEach((r) => {
    sel.append(el("option", { value: r.id, textContent: `${fmtDate(r.created_at)} ${r.filename} (${r.row_count}点)` }));
  });
}
function renderCorrections(corrections, records) {
  const map = Object.fromEntries(records.map((r) => [r.id, r.filename]));
  const tb = $("#corrTable").querySelector("tbody");
  tb.innerHTML = "";
  corrections.forEach((c) => {
    tb.append(el("tr", {}, [
      el("td", { textContent: fmtDate(c.created_at) }),
      el("td", { textContent: map[c.sent_record_id] || "-" }),
      el("td", { textContent: c.line_number ?? "-" }),
      el("td", { textContent: c.current_value || "-" }),
      el("td", { textContent: c.desired_value || "-" }),
      el("td", { textContent: c.comment || "-" }),
      el("td", { textContent: c.status }),
    ]));
  });
  if (!corrections.length) tb.append(el("tr", {}, [el("td", { colSpan: 7, textContent: "修正依頼はまだありません" })]));
}

async function submitCorrection() {
  const recId = $("#corrRecord").value;
  if (!recId) { alert("対象ファイルを選んでください"); return; }
  $("#corrStatus").textContent = "登録中…";
  try {
    await callFn("correction", {
      body: {
        sent_record_id: recId,
        line_number: Number($("#corrLine").value) || null,
        current_value: $("#corrCurrent").value || null,
        desired_value: $("#corrDesired").value || null,
        comment: $("#corrComment").value || null,
      },
    });
    $("#corrStatus").textContent = "登録しました";
    $("#corrLine").value = ""; $("#corrCurrent").value = "";
    $("#corrDesired").value = ""; $("#corrComment").value = "";
    loadHistory();
  } catch (e) {
    $("#corrStatus").textContent = "";
    alert("登録に失敗: " + e.message);
  }
}

// ====== 設定(メール登録) ======
async function loadMailStatus() {
  const b = $("#mailStatus");
  try {
    const s = await callFn("settings", { method: "GET" });
    b.className = "banner " + (s.configured ? "ok" : "warn");
    b.textContent = s.configured
      ? `登録済み: ${s.masked} (更新: ${fmtDate(s.updated_at)})`
      : "まだ登録されていません";
  } catch (e) {
    b.className = "banner warn";
    b.textContent = "状態取得に失敗: " + e.message;
  }
}
async function saveEmail() {
  const email = $("#adminEmail").value.trim();
  const key = $("#adminKey").value;
  if (!email || !key) { alert("メールと管理キーを入力してください"); return; }
  $("#adminSaveStatus").textContent = "登録中…";
  try {
    const r = await callFn("settings", { body: { admin_key: key, email } });
    $("#adminSaveStatus").textContent = `登録しました: ${r.masked}`;
    $("#adminEmail").value = ""; $("#adminKey").value = "";
    loadMailStatus(); loadMailTarget();
  } catch (e) {
    $("#adminSaveStatus").textContent = "";
    alert("登録に失敗: " + e.message);
  }
}

// ====== ユーティリティ ======
function sanitize(name) {
  let n = (name || "coords.txt").replace(/[\/\\:*?"<>|]/g, "_").trim();
  if (!n.toLowerCase().endsWith(".txt")) n += ".txt";
  return n;
}
function fmtDate(s) {
  if (!s) return "-";
  const d = new Date(s);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
