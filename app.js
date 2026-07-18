"use strict";

// ====== 設定 ======
const CONFIG = window.APP_CONFIG || null;
const FN_BASE = CONFIG ? `${CONFIG.SUPABASE_URL.replace(/\/$/, "")}/functions/v1` : "";
const ANON = CONFIG ? CONFIG.SUPABASE_ANON_KEY : "";
let threshold = CONFIG?.CONFIDENCE_THRESHOLD ?? 90;

// 状態
let blocks = [];           // [{title,bbox,rows,cal,xImgs,yImgs}]
let hasNames = false;
let overall = null;
let selectedFile = null;
let isPdf = false;
let loadedImg = null;
let rotation = 0;
let sheetURL = null;       // 回転後シート画像(切り抜き用の表示元)

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
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
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
  const maxDim = 2400;
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
  $("#threshold").addEventListener("input", (e) => { threshold = Number(e.target.value) || 0; updateHighlights(); });
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
    sheetURL = isPdf ? null : $("#imgCanvas").toDataURL("image/jpeg", 0.9);
    const data = await callFn("extract", { body: payload });
    blocks = (data.blocks || []).map((b) => makeBlock(b));
    blocks.sort((a, b) => (a.bbox && b.bbox) ? ((a.bbox[0] - b.bbox[0]) || (a.bbox[1] - b.bbox[1])) : 0);
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

function makeBlock(b) {
  const bbox = Array.isArray(b.bbox) && b.bbox.length === 4 ? b.bbox.map(Number) : null;
  let cal;
  if (bbox) {
    const l = clamp(bbox[0] / 1000, 0, 0.95), t = clamp(bbox[1] / 1000, 0, 0.95);
    const r = clamp(bbox[2] / 1000, l + 0.05, 1), bo = clamp(bbox[3] / 1000, t + 0.03, 1);
    cal = { left: l, top: t, right: r, bottom: bo, split: l + (r - l) * 0.6 };
  } else {
    cal = { left: 0.05, top: 0.2, right: 0.6, bottom: 0.92, split: 0.33 };
  }
  return {
    title: b.title || "",
    bbox,
    cal,
    xImgs: [], yImgs: [], units: [],
    rows: (b.rows || []).map((r) => ({ name: r.name || "", x: r.x || "", y: r.y || "", confidence: r.confidence, dup: false })),
  };
}

function showWarnings(warnings) {
  $("#warnings").innerHTML = warnings.length ? "注意: " + warnings.map(escapeHtml).join(" / ") : "";
}

// ====== 切り抜き ======
function cropFrac(l, t, r, b) {
  const canvas = $("#imgCanvas");
  if (isPdf || !loadedImg) return "";
  const W = canvas.width, H = canvas.height;
  const px = clamp(l, 0, 1) * W, py = clamp(t, 0, 1) * H;
  const pw = Math.max(2, (clamp(r, 0, 1) - clamp(l, 0, 1)) * W);
  const ph = Math.max(2, (clamp(b, 0, 1) - clamp(t, 0, 1)) * H);
  const c = el("canvas"); c.width = pw; c.height = ph;
  try { c.getContext("2d").drawImage(canvas, px, py, pw, ph, 0, 0, pw, ph); return c.toDataURL("image/png"); }
  catch { return ""; }
}
function rowBounds(bl, i) {
  const rc = Math.max(1, bl.rows.length);
  const h = (bl.cal.bottom - bl.cal.top) / rc;
  const pad = h * 0.15;
  return { top: bl.cal.top + i * h - pad, bot: bl.cal.top + (i + 1) * h + pad };
}
function renderCrops(bi) {
  const bl = blocks[bi];
  bl.rows.forEach((r, i) => {
    const { top, bot } = rowBounds(bl, i);
    if (bl.xImgs[i]) bl.xImgs[i].src = cropFrac(bl.cal.left, top, bl.cal.split, bot);
    if (bl.yImgs[i]) bl.yImgs[i].src = cropFrac(bl.cal.split, top, bl.cal.right, bot);
  });
}

// ====== 位置合わせ枠 ======
function buildCalStage(bl, bi) {
  const stage = el("div", { className: "calstage" });
  const img = el("img", { className: "calimg", src: sheetURL });
  const ov = el("div", { className: "caloverlay" });
  const rect = el("div", { className: "calrect" });
  const hL = el("div", { className: "h hL" }), hR = el("div", { className: "h hR" });
  const hT = el("div", { className: "h hT" }), hB = el("div", { className: "h hB" });
  const split = el("div", { className: "calsplit" });
  rect.append(hL, hR, hT, hB, split);
  ov.append(rect);
  stage.append(img, ov);
  const place = () => {
    const c = bl.cal;
    rect.style.left = (c.left * 100) + "%"; rect.style.top = (c.top * 100) + "%";
    rect.style.width = ((c.right - c.left) * 100) + "%"; rect.style.height = ((c.bottom - c.top) * 100) + "%";
    split.style.left = (((c.split - c.left) / Math.max(1e-4, c.right - c.left)) * 100) + "%";
  };
  place();
  attachDrag(stage, bl, bi, place, rect, split, { hL, hR, hT, hB });
  return stage;
}
function attachDrag(stage, bl, bi, place, rect, split, h) {
  let mode = null, sx = 0, sy = 0, s0 = null;
  const move = (e) => {
    const r = stage.getBoundingClientRect();
    const dx = (e.clientX - sx) / r.width, dy = (e.clientY - sy) / r.height;
    const c = { ...s0 };
    if (mode === "move") {
      const w = s0.right - s0.left, ht = s0.bottom - s0.top;
      c.left = clamp(s0.left + dx, 0, 1 - w); c.top = clamp(s0.top + dy, 0, 1 - ht);
      c.right = c.left + w; c.bottom = c.top + ht; c.split = clamp(s0.split + dx, c.left + 0.02, c.right - 0.02);
    } else if (mode === "L") { c.left = clamp(s0.left + dx, 0, s0.right - 0.05); c.split = clamp(s0.split, c.left + 0.02, c.right - 0.02); }
    else if (mode === "R") { c.right = clamp(s0.right + dx, s0.left + 0.05, 1); c.split = clamp(s0.split, c.left + 0.02, c.right - 0.02); }
    else if (mode === "T") { c.top = clamp(s0.top + dy, 0, s0.bottom - 0.03); }
    else if (mode === "B") { c.bottom = clamp(s0.bottom + dy, s0.top + 0.03, 1); }
    else if (mode === "split") { c.split = clamp(s0.split + dx, c.left + 0.02, c.right - 0.02); }
    bl.cal = c; place();
  };
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); renderCrops(bi); };
  const down = (m) => (e) => { e.preventDefault(); e.stopPropagation(); mode = m; sx = e.clientX; sy = e.clientY; s0 = { ...bl.cal }; document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); };
  rect.addEventListener("pointerdown", down("move"));
  h.hL.addEventListener("pointerdown", down("L")); h.hR.addEventListener("pointerdown", down("R"));
  h.hT.addEventListener("pointerdown", down("T")); h.hB.addEventListener("pointerdown", down("B"));
  split.addEventListener("pointerdown", down("split"));
}

// ====== 結果表示 ======
function renderResults() {
  const cont = $("#blocks");
  cont.innerHTML = "";
  blocks.forEach((bl, bi) => {
    bl.xImgs = []; bl.yImgs = []; bl.units = [];
    const sec = el("div", { className: "block" });
    sec.append(el("div", { className: "blocktitle", textContent: `${bl.title || "(見出しなし)"}　(${bl.rows.length}点)` }));

    if (!isPdf && sheetURL) {
      const det = el("details", { className: "cal", open: bi === 0 });
      det.append(el("summary", { textContent: "位置合わせ(元画像) — 枠を数値の行全体に合わせ、縦線でX列とY列を分ける" }));
      det.append(buildCalStage(bl, bi));
      sec.append(det);
    }

    bl.rows.forEach((r, i) => {
      const unit = el("div", { className: "unit" });
      r._unit = unit;

      const head = el("div", { className: "unit-head" });
      if (hasNames) head.append(el("span", { className: "pname", textContent: r.name || "(名称なし)" }));
      const conf = el("span", { className: "conf", textContent: isFinite(Number(r.confidence)) ? r.confidence + "%" : "-" });
      head.append(conf);
      const dupBadge = el("span", { className: "dupbadge hidden", textContent: "重複・出力除外" });
      head.append(dupBadge);
      r._dupBadge = dupBadge;
      head.append(el("span", { className: "flex1" }));
      const del = el("button", { className: "delbtn", textContent: "削除" });
      del.addEventListener("click", () => { bl.rows.splice(i, 1); renderResults(); });
      head.append(del);
      unit.append(head);

      // 比較グリッド: 左=X(切り抜き↑ / 値↓)、右=Y(切り抜き↑ / 値↓)
      const grid = el("div", { className: "cmpgrid" });
      const colX = el("div", { className: "cmpcol" });
      const colY = el("div", { className: "cmpcol" });
      const xImg = el("img", { className: "crop", alt: "元X" });
      const yImg = el("img", { className: "crop", alt: "元Y" });
      bl.xImgs[i] = xImg; bl.yImgs[i] = yImg;
      colX.append(xImg, makeVal("X", r, "x"));
      colY.append(yImg, makeVal("Y", r, "y"));
      if (isPdf || !sheetURL) { xImg.classList.add("hidden"); yImg.classList.add("hidden"); }
      grid.append(colX, colY);
      unit.append(grid);

      sec.append(unit);
    });
    cont.append(sec);
    if (!isPdf && sheetURL) renderCrops(bi);
  });
  updateHighlights();
}

function makeVal(labelText, row, key) {
  const wrap = el("label", { className: "val" });
  wrap.append(el("span", { className: "vlabel", textContent: labelText }));
  const inp = el("input", { type: "text", value: row[key] ?? "" });
  inp.addEventListener("input", () => { row[key] = inp.value; updateHighlights(); });
  wrap.append(inp);
  return wrap;
}

// 重複・信頼度ハイライト・件数・txtプレビューを更新(DOMは作り直さない)
function updateHighlights() {
  const seen = new Set();
  let total = 0, low = 0, dup = 0;
  blocks.forEach((bl) => bl.rows.forEach((r) => {
    total++;
    const key = (r.x || "") + "|" + (r.y || "");
    r.dup = !!(r.x || r.y) && seen.has(key);
    if (!r.dup) seen.add(key); else dup++;
    const conf = Number(r.confidence);
    const lowRow = conf < threshold && !r.dup;
    if (lowRow) low++;
    if (r._unit) {
      r._unit.classList.remove("dup", "low", "mid");
      if (r.dup) r._unit.classList.add("dup");
      else if (lowRow) r._unit.classList.add(conf < threshold - 15 ? "low" : "mid");
    }
    if (r._dupBadge) r._dupBadge.classList.toggle("hidden", !r.dup);
  }));
  const b = $("#overallBanner");
  b.className = "banner " + (overall >= threshold ? "ok" : "warn");
  b.textContent = `全体信頼度: ${overall ?? "-"}% ／ 抽出点数: ${total} ／ ブロック: ${blocks.length}`;
  $("#lowCount").textContent = low ? `要チェック: ${low} 点` : "要チェックなし";
  $("#dupCount").textContent = dup ? `重複(除外): ${dup} 点` : "";
  updatePreview();
}

// ====== txt(重複除外) ======
function buildTxt() {
  const seen = new Set();
  const lines = [];
  blocks.forEach((bl) => bl.rows.forEach((r) => {
    const x = (r.x || "").trim(), y = (r.y || "").trim();
    if (!x && !y) return;
    const key = x + "|" + y;
    if (seen.has(key)) return;
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
