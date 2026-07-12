"use strict";

// ====== 設定 ======
const CONFIG = window.APP_CONFIG || null;
const FN_BASE = CONFIG ? `${CONFIG.SUPABASE_URL.replace(/\/$/, "")}/functions/v1` : "";
const ANON = CONFIG ? CONFIG.SUPABASE_ANON_KEY : "";
let threshold = CONFIG?.CONFIDENCE_THRESHOLD ?? 90;

// 状態
let currentRows = [];
let currentOverall = null;
let currentSource = "";
let selectedFile = null;
let isPdf = false;
let loadedImg = null;      // 読み込んだ画像
let rotation = 0;          // 0/90/180/270

document.addEventListener("DOMContentLoaded", () => {
  if (!CONFIG || !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("YOUR-PROJECT")) {
    $("#configWarning").classList.remove("hidden");
  }
  $("#threshold").value = threshold;
  setupUpload();
  bindButtons();
});

// ====== 小道具 ======
function $(s) { return document.querySelector(s); }
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of [].concat(children)) e.append(c);
  return e;
}
async function callFn(path, { method = "POST", body } = {}) {
  const res = await fetch(`${FN_BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ANON}`, "apikey": ANON },
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
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  input.addEventListener("change", () => { if (input.files[0]) handleFile(input.files[0]); });
}

function handleFile(file) {
  const ok = file.type.startsWith("image/") || file.type === "application/pdf";
  if (!ok) { alert("画像か PDF を選んでください"); return; }
  selectedFile = file;
  currentSource = file.name;
  isPdf = file.type === "application/pdf";
  rotation = 0;
  $("#fileInfo").textContent = `選択中: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  $("#extractBtn").disabled = false;

  if (isPdf) {
    loadedImg = null;
    $("#rotateBar").classList.add("hidden");
    $("#pdfNote").classList.remove("hidden");
  } else {
    $("#rotateBar").classList.remove("hidden");
    $("#pdfNote").classList.add("hidden");
    const img = new Image();
    img.onload = () => { loadedImg = img; updateRotLabel(); redraw(); $("#compare").classList.remove("hidden"); };
    img.src = URL.createObjectURL(file);
  }
}

// ====== 回転・描画 ======
function setRotation(deg) { rotation = ((deg % 360) + 360) % 360; updateRotLabel(); redraw(); }
function updateRotLabel() { const l = $("#rotLabel"); if (l) l.textContent = rotation + "°"; }

function redraw() {
  const canvas = $("#imgCanvas");
  if (!loadedImg || !canvas) return;
  const swap = rotation === 90 || rotation === 270;
  const maxDim = 2200;
  const iw = loadedImg.naturalWidth, ih = loadedImg.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const w = Math.round(iw * scale), h = Math.round(ih * scale);
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(loadedImg, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// ====== ボタン ======
function bindButtons() {
  $("#extractBtn").addEventListener("click", runExtract);
  $("#rotLeft").addEventListener("click", () => setRotation(rotation - 90));
  $("#rotRight").addEventListener("click", () => setRotation(rotation + 90));
  $("#rotLeft2").addEventListener("click", () => setRotation(rotation - 90));
  $("#rotRight2").addEventListener("click", () => setRotation(rotation + 90));
  $("#zoom").addEventListener("input", (e) => { $("#imgCanvas").style.width = e.target.value + "%"; });
  $("#threshold").addEventListener("input", (e) => { threshold = Number(e.target.value) || 0; renderTable(); });
  $("#addRowBtn").addEventListener("click", () => { currentRows.push({ x: "", y: "", confidence: 100, note: "手動追加" }); renderTable(); });
  $("#downloadBtn").addEventListener("click", downloadTxt);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// 抽出に送るデータ(画像は今の向きで再エンコード)
async function getExtractData() {
  if (isPdf) return { fileBase64: await fileToBase64(selectedFile), mediaType: "application/pdf" };
  const canvas = $("#imgCanvas");
  const b64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  return { fileBase64: b64, mediaType: "image/jpeg" };
}

// ====== 抽出 ======
async function runExtract() {
  if (!selectedFile) return;
  if (!CONFIG) { alert("config.js が未設定です"); return; }
  const btn = $("#extractBtn");
  btn.disabled = true;
  $("#extractStatus").textContent = "抽出中… (10〜60秒)";
  try {
    const payload = await getExtractData();
    const data = await callFn("extract", { body: payload });
    currentRows = data.rows || [];
    currentOverall = data.overall_confidence ?? null;
    $("#extractStatus").textContent = `抽出完了: ${currentRows.length} 点 (モデル: ${data.model || "-"})`;
    $("#compare").classList.remove("hidden");
    showResult(data.warnings || []);
  } catch (err) {
    $("#extractStatus").textContent = "";
    alert("抽出に失敗しました: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

function showResult(warnings) {
  const b = $("#overallBanner");
  b.className = "banner " + (currentOverall >= threshold ? "ok" : "warn");
  b.textContent = `全体信頼度: ${currentOverall ?? "-"}% ／ 抽出点数: ${currentRows.length}`;
  $("#warnings").innerHTML = warnings.length ? "注意: " + warnings.map(escapeHtml).join(" / ") : "";
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

// ====== txt ======
function buildTxt() { return currentRows.map((r) => `${(r.x ?? "").trim()} ${(r.y ?? "").trim()}`).join("\r\n") + "\r\n"; }
function updatePreview() { $("#txtPreview").value = buildTxt(); }
function downloadTxt() {
  if (currentRows.length === 0) { alert("ダウンロードする行がありません"); return; }
  const blob = new Blob([buildTxt()], { type: "text/plain" });
  const a = el("a", { href: URL.createObjectURL(blob), download: sanitize($("#filename").value) });
  document.body.append(a); a.click(); a.remove();
}

// ====== util ======
function sanitize(name) { let n = (name || "coords.txt").replace(/[\/\\:*?"<>|]/g, "_").trim(); if (!n.toLowerCase().endsWith(".txt")) n += ".txt"; return n; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
