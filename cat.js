"use strict";
// 右上のお部屋で暮らすドット絵ラグドール。回し車・ベッド・餌場を行き来し、
// 走る/寝る/食べる/毛づくろい/ひとやすみ を自然に繰り返す。クリックでへそてん。
// 右上のボタンで表示/非表示を切替できる。
(function () {
  function px(x, y, w, h, f) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`; }

  // ---- 猫(ドット絵・横向き・右向き) ----
  const CAT_SVG = `
  <svg class="catsvg" viewBox="0 0 22 15" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    <g class="tail">
      ${px(1, 3, 2, 1, "#6f5b4e")}${px(1, 4, 2, 2, "#8a7566")}${px(1, 6, 2, 2, "#8a7566")}${px(2, 8, 2, 2, "#8a7566")}
    </g>
    <rect class="leg legBF" x="6" y="9" width="2" height="5" fill="#6f5b4e"/>
    <rect class="leg legBN" x="8" y="9" width="2" height="5" fill="#8a7566"/>
    <rect class="leg legFF" x="12" y="9" width="2" height="5" fill="#6f5b4e"/>
    <rect class="leg legFN" x="14" y="9" width="2" height="5" fill="#8a7566"/>
    ${px(4, 5, 12, 5, "#f4ead9")}${px(5, 4, 10, 1, "#f4ead9")}${px(5, 10, 10, 1, "#f4ead9")}${px(5, 8, 9, 2, "#fbf5ec")}
    <g class="head">
      ${px(14, 4, 7, 7, "#f4ead9")}${px(15, 3, 5, 1, "#f4ead9")}
      <rect x="14" y="4" width="7" height="3" fill="#8a7566" opacity="0.35"/>
      ${px(14, 2, 2, 2, "#8a7566")}${px(14, 1, 1, 1, "#8a7566")}${px(19, 2, 2, 2, "#8a7566")}${px(20, 1, 1, 1, "#8a7566")}
      ${px(15, 2, 1, 1, "#e6b7ae")}${px(19, 2, 1, 1, "#e6b7ae")}
      ${px(16, 8, 5, 3, "#fbf5ec")}
      <rect class="eye eyeOpen" x="18" y="6" width="2" height="2" fill="#5b93b3"/>
      <rect class="eye eyeOpen" x="18" y="6" width="1" height="1" fill="#cfe8f5"/>
      <rect class="eye eyeClosed" x="18" y="7" width="2" height="1" fill="#33261d"/>
      ${px(20, 9, 1, 1, "#e89aa6")}
      <rect class="tongue" x="20" y="10" width="1" height="1" fill="#e06a86"/>
    </g>
  </svg>`;

  // ---- 回し車(ドット絵・木製リング＋灰トラック＋台) ----
  function genWheel() {
    const cx = 14, cy = 13;
    let ring = "", inner = "";
    for (let y = 0; y < 27; y++) for (let x = 0; x < 28; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= 11 && d <= 13.6) ring += px(x, y, 1, 1, ((x + y) % 2) ? "#dcb886" : "#c99f6d");
      else if (d >= 8 && d <= 9.5) inner += px(x, y, 1, 1, "#9aa0a8");
    }
    const spokes = px(cx, cy - 9, 1, 18, "#7e848c") + px(cx - 9, cy, 18, 1, "#7e848c");
    const stand = px(5, 28, 18, 2, "#c69a63") + px(10, 23, 2, 6, "#cba06a") + px(16, 23, 2, 6, "#cba06a");
    return `<svg width="84" height="90" viewBox="0 0 28 30" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${stand}${ring}<g class="wheelinner">${inner}${spokes}</g></svg>`;
  }

  const BED_SVG = `<svg width="60" height="24" viewBox="0 0 20 8" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    ${px(1, 4, 18, 3, "#b98a6a")}${px(0, 5, 20, 2, "#a97e5f")}${px(3, 3, 14, 2, "#eccfa9")}</svg>`;

  const BOWL_SVG = `<svg width="36" height="18" viewBox="0 0 12 6" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    ${px(1, 1, 10, 1, "#7a4a24")}${px(0, 2, 12, 1, "#cf7a33")}${px(1, 3, 10, 2, "#cf7a33")}${px(3, 5, 6, 1, "#b3652a")}</svg>`;

  const widget = document.createElement("div");
  widget.id = "catWidget";
  widget.innerHTML =
    `<div class="stage">
       <div class="floor"></div>
       <div class="furni wheel">${genWheel()}</div>
       <div class="furni bed">${BED_SVG}</div>
       <div class="furni bowl">${BOWL_SVG}</div>
       <span class="zzz">Zzz</span>
       <div class="cat" title="なでる">${CAT_SVG}</div>
     </div>`;

  const toggle = document.createElement("button");
  toggle.id = "catToggle";

  let stage, cat, wheel, zzz, curX = 20, busy = false, walkTimer = null, actTimer = null;
  const rand = (n) => Math.random() * n;
  const clampX = (x) => Math.max(6, Math.min(232, x));

  function setFacing(dir) { cat.classList.toggle("flip", dir === -1); }
  function clearActs() {
    cat.classList.remove("walking", "act-run", "act-eat", "act-sleep", "act-groom", "act-heso");
    wheel.classList.remove("spin"); zzz.classList.remove("on");
  }

  function plan() {
    const r = Math.random();
    if (r < 0.22) return { x: 20, act: "run", dur: 4000 + rand(4500), face: 1, bottom: 36 };
    if (r < 0.52) return { x: 122, act: "sleep", dur: 9000 + rand(8000), face: 1, bottom: 14 };
    if (r < 0.70) return { x: 214, act: "eat", dur: 3000 + rand(3000), face: 1, bottom: 14 };
    if (r < 0.86) return { x: clampX(40 + rand(150)), act: "groom", dur: 3000 + rand(3000), face: Math.random() < 0.5 ? 1 : -1, bottom: 14 };
    return { x: clampX(30 + rand(170)), act: "sit", dur: 2200 + rand(2600), face: Math.random() < 0.5 ? 1 : -1, bottom: 14 };
  }

  function walkTo(x, cb) {
    clearActs();
    cat.style.bottom = "14px";
    const dir = x > curX ? 1 : (x < curX ? -1 : 1);
    setFacing(dir);
    cat.classList.add("walking");
    const dist = Math.abs(x - curX);
    const dur = Math.max(0.5, dist / 50);
    cat.style.transition = `left ${dur}s linear, bottom .35s ease`;
    requestAnimationFrame(() => { cat.style.left = x + "px"; });
    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => { curX = x; cat.classList.remove("walking"); cb(); }, dur * 1000 + 40);
  }

  function go() {
    if (busy) return;
    const p = plan();
    walkTo(p.x, () => {
      setFacing(p.face);
      cat.style.bottom = (p.bottom || 14) + "px";
      cat.classList.add("act-" + p.act);
      if (p.act === "run") wheel.classList.add("spin");
      if (p.act === "sleep") zzz.classList.add("on");
      clearTimeout(actTimer);
      actTimer = setTimeout(() => { clearActs(); cat.style.bottom = "14px"; go(); }, p.dur);
    });
  }

  function heso() {
    if (busy) return;
    busy = true;
    clearTimeout(walkTimer); clearTimeout(actTimer);
    clearActs(); cat.style.bottom = "14px";
    cat.classList.add("act-heso");
    for (let i = 0; i < 5; i++) spawnHeart(i);
    setTimeout(() => { cat.classList.remove("act-heso"); busy = false; go(); }, 1800);
  }
  function spawnHeart(i) {
    const h = document.createElement("span");
    h.className = "catheart";
    h.textContent = "♥";
    h.style.left = (curX + 22 + rand(20)) + "px";
    h.style.top = (44 + rand(8)) + "px";
    h.style.animationDelay = (i * 0.12) + "s";
    stage.appendChild(h);
    setTimeout(() => h.remove(), 1500);
  }

  function setHidden(h) {
    widget.classList.toggle("hidden", h);
    toggle.textContent = h ? "🐱 猫を表示" : "🐱 猫を隠す";
    try { localStorage.setItem("catHidden", h ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  function start() {
    document.body.appendChild(widget);
    document.body.appendChild(toggle);
    stage = widget.querySelector(".stage");
    cat = widget.querySelector(".cat");
    wheel = widget.querySelector(".furni.wheel");
    zzz = widget.querySelector(".zzz");
    cat.style.left = curX + "px";
    cat.addEventListener("click", (e) => { e.preventDefault(); heso(); });
    toggle.addEventListener("click", () => setHidden(!widget.classList.contains("hidden")));
    let hidden = false;
    try { hidden = localStorage.getItem("catHidden") === "1"; } catch (e) { /* ignore */ }
    setHidden(hidden);
    setTimeout(go, 600);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
