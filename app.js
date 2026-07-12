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
let selectedFile = null;

// ====== 起動時 ======
document.addEventListener("DOMContentLoaded", () => {
  if (!CONFIG || !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("YOUR-PROJECT")) {
    $("#configWarning").classList.remove("hidden");
  }
  $("#threshold").value = threshold;
  setupUpload();
  bindButtons();
});

// ====== 小道具 ======
function $(sel) { return document.querySelector(sel); }
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of [].concat(children)) e.append(c);
  return e;
}
async function callFn(path, { method = "POST", body } = {}) {
  const res = await fetch(`${FN_BASE}/${path}`, {
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

// ====== アップロード ======
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
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ====== ボタン ======
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
    tr.append(el("td", { className: "confcell", textContent: isFinite(conf) ? conf + "%" : "-" }));
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
  if (currentRows.length === 0) { alert("ダウンロードする行がありません"); return; }
  const blob = new Blob([buildTxt()], { type: "text/plain" });
  const a = el("a", { href: URL.createObjectURL(blob), download: sanitize($("#filename").value) });
  document.body.append(a); a.click(); a.remove();
}

// ====== ユーティリティ ======
function sanitize(name) {
  let n = (name || "coords.txt").replace(/[\/\\:*?"<>|]/g, "_").trim();
  if (!n.toLowerCase().endsWith(".txt")) n += ".txt";
  return n;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
