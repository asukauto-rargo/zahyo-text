"use strict";

// ====== 設定 ======
const CONFIG = window.APP_CONFIG || null;
const FN_BASE = CONFIG ? `${CONFIG.SUPABASE_URL.replace(/\/$/, "")}/functions/v1` : "";
const ANON = CONFIG ? CONFIG.SUPABASE_ANON_KEY : "";
let threshold = CONFIG?.CONFIDENCE_THRESHOLD ?? 90;

// 状態
let blocks = [];           // [{title, bbox, rows:[{name,x,y,confidence,dup}]}]
let hasNames = false;
let overall = null;
let selectedFile = null;
let isPdf = false;
let loadedImg = null;
let rotation = 0;

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
  for (const c of [].concat(children)) if (c != null) e.append(c);
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
  isPdf = file.type === "application/pdf";
  rotation = 0;
  $("#fileInfo").textContent = `選択中: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  $("#extractBtn").disabled = false;
  $("#previewArea").classList.remove("hidden");

  if (isPdf) {
    loadedImg = null;
    $("#imgCanvas").classList.add("hidden");
    $("#pdfNote").classList.remove("hidden");
  } else {
    $("#imgCanvas").classList.remove("hidden");
    $("#pdfNote").classList.add("hidden");
    const img = new Image();
    img.onload = () => { loadedImg = img; updateRotLabel(); redraw(); };
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
  $("#threshold").addEventListener("input", (e) => { threshold = Number(e.target.value) || 0; renderResults(); });
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
async function getExtractData() {
  if (isPdf) return { fileBase64: await fileToBase64(selectedFile), mediaType: "application/pdf" };
  const b64 = $("#imgCanvas").toDataURL("image/jpeg", 0.92).split(",")[1];
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
    payload.notes = $("#notes").value || "";
    const data = await callFn("extract", { body: payload });
    blocks = (data.blocks || []).map((b) => ({
      title: b.title || "",
      bbox: b.bbox || null,
      rows: (b.rows || []).map((r) => ({ name: r.name || "", x: r.x || "", y: r.y || "", confidence: r.confidence, dup: false })),
    }));
    // ブロックを左優先→上優先で並べ替え(bboxがある場合)
    blocks.sort((a, b) => {
      if (!a.bbox || !b.bbox) return 0;
      return (a.bbox[0] - b.bbox[0]) || (a.bbox[1] - b.bbox[1]);
    });
    hasNames = !!data.has_names;
    overall = data.overall_confidence ?? null;
    const total = blocks.reduce((s, b) => s + b.rows.length, 0);
    $("#extractStatus").textContent = `抽出完了: ${total} 点 / ${blocks.length} ブロック (モデル: ${data.model || "-"})`;
    $("#results").classList.remove("hidden");
    showWarnings(data.warnings || []);
    renderResults();
  } catch (err) {
    $("#extractStatus").textContent = "";
    alert("抽出に失敗しました: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

function showWarnings(warnings) {
  $("#warnings").innerHTML = warnings.length ? "注意: " + warnings.map(escapeHtml).join(" / ") : "";
}

// 元画像から、あるブロックの i 行目を切り抜く
function cropRow(bbox, rowIndex, rowCount) {
  const canvas = $("#imgCanvas");
  if (isPdf || !loadedImg || !bbox || bbox.length !== 4) return null;
  const W = canvas.width, H = canvas.height;
  const x0 = bbox[0] / 1000 * W, x1 = bbox[2] / 1000 * W;
  const y0 = bbox[1] / 1000 * H, y1 = bbox[3] / 1000 * H;
  const rowH = (y1 - y0) / Math.max(1, rowCount);
  const pad = rowH * 0.18;
  const top = Math.max(0, y0 + rowIndex * rowH - pad);
  const bot = Math.min(H, y0 + (rowIndex + 1) * rowH + pad);
  const cw = Math.max(2, x1 - x0), ch = Math.max(2, bot - top);
  const c = el("canvas");
  c.width = cw; c.height = ch;
  c.getContext("2d").drawImage(canvas, x0, top, cw, ch, 0, 0, cw, ch);
  try { return c.toDataURL("image/png"); } catch { return null; }
}

// ====== 結果表示 ======
function renderResults() {
  const cont = $("#blocks");
  cont.innerHTML = "";
  const seen = new Set();
  let total = 0, low = 0, dup = 0;

  blocks.forEach((bl) => {
    const rc = bl.rows.length;
    const sec = el("div", { className: "block" });
    const label = bl.title || "(見出しなし)";
    sec.append(el("div", { className: "blocktitle", textContent: `${label}　(${rc}点)` }));

    bl.rows.forEach((r, i) => {
      total++;
      const key = (r.x || "") + "|" + (r.y || "");
      r.dup = !!(r.x || r.y) && seen.has(key);
      if (!r.dup) seen.add(key); else dup++;
      const conf = Number(r.confidence);
      const lowRow = conf < threshold && !r.dup;
      if (lowRow) low++;

      const unit = el("div", { className: "unit" + (r.dup ? " dup" : (lowRow ? (conf < threshold - 15 ? " low" : " mid") : "")) });

      // ヘッダ行: 点名 / 信頼度 / 重複 / 削除
      const head = el("div", { className: "unit-head" });
      if (hasNames) head.append(el("span", { className: "pname", textContent: r.name || "(名称なし)" }));
      head.append(el("span", { className: "conf", textContent: isFinite(conf) ? conf + "%" : "-" }));
      if (r.dup) head.append(el("span", { className: "dupbadge", textContent: "重複・出力除外" }));
      const spacer = el("span", { className: "flex1" });
      head.append(spacer);
      const del = el("button", { className: "delbtn", textContent: "削除" });
      del.addEventListener("click", () => { bl.rows.splice(i, 1); renderResults(); });
      head.append(del);
      unit.append(head);

      // 上段: 元画像の切り抜き
      const src = cropRow(bl.bbox, i, rc);
      if (src) unit.append(el("img", { className: "crop", src, alt: "元画像" }));
      else if (!isPdf) unit.append(el("div", { className: "nocrop", textContent: "(切り抜き位置を取得できませんでした)" }));

      // 下段: 読み取り値 X / Y
      const vals = el("div", { className: "vals" });
      vals.append(makeVal("X", r, "x"));
      vals.append(makeVal("Y", r, "y"));
      unit.append(vals);

      sec.append(unit);
    });
    cont.append(sec);
  });

  const b = $("#overallBanner");
  b.className = "banner " + (overall >= threshold ? "ok" : "warn");
  b.textContent = `全体信頼度: ${overall ?? "-"}% ／ 抽出点数: ${total} ／ ブロック: ${blocks.length}`;
  $("#lowCount").textContent = low ? `要チェック: ${low} 点` : "要チェックなし";
  $("#dupCount").textContent = dup ? `重複(除外): ${dup} 点` : "";
  updatePreview();
}

function makeVal(labelText, row, key) {
  const wrap = el("label", { className: "val" });
  wrap.append(el("span", { className: "vlabel", textContent: labelText }));
  const inp = el("input", { type: "text", value: row[key] ?? "" });
  inp.addEventListener("input", () => { row[key] = inp.value; updatePreview(); });
  wrap.append(inp);
  return wrap;
}

// ====== txt(重複除外) ======
function buildTxt() {
  const seen = new Set();
  const lines = [];
  blocks.forEach((bl) => bl.rows.forEach((r) => {
    const x = (r.x || "").trim(), y = (r.y || "").trim();
    if (!x && !y) return;
    const key = x + "|" + y;
    if (seen.has(key)) return; // 重複除外
    seen.add(key);
    lines.push(`${x} ${y}`);
  }));
  return lines.join("\r\n") + (lines.length ? "\r\n" : "");
}
function updatePreview() { $("#txtPreview").value = buildTxt(); }
function downloadTxt() {
  const txt = buildTxt();
  if (!txt.trim()) { alert("ダウンロードする行がありません"); return; }
  const blob = new Blob([txt], { type: "text/plain" });
  const a = el("a", { href: URL.createObjectURL(blob), download: sanitize($("#filename").value) });
  document.body.append(a); a.click(); a.remove();
}

// ====== util ======
function sanitize(name) { let n = (name || "coords.txt").replace(/[\/\\:*?"<>|]/g, "_").trim(); if (!n.toLowerCase().endsWith(".txt")) n += ".txt"; return n; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
