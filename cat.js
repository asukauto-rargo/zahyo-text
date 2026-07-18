"use strict";
// 右上のお部屋で暮らすラグドール猫。回し車・ベッド・餌場を行き来し、
// 走る/寝る/食べる/毛づくろい/ひとやすみ を自然なタイミングで繰り返す。
// クリックすると背中をつけてへそてん(ゴロゴロ)して喜ぶ。
(function () {
  const CAT_SVG = `
  <svg class="catsvg" viewBox="0 0 46 30" xmlns="http://www.w3.org/2000/svg">
    <path class="tail" d="M11 13 C3 12 1.5 4 6 2.5 C8.5 1.7 9.5 5 8 7 C6 10 8 12 12 11.5 Z" fill="#9a8676"/>
    <rect class="leg legBF" x="12.5" y="16" width="3" height="10" rx="1.5" fill="#6f5b4e"/>
    <rect class="leg legBN" x="16" y="16" width="3" height="10" rx="1.5" fill="#8a7566"/>
    <rect class="leg legFF" x="29" y="16" width="3" height="10" rx="1.5" fill="#6f5b4e"/>
    <rect class="leg legFN" x="32.5" y="16" width="3" height="10" rx="1.5" fill="#8a7566"/>
    <ellipse class="body" cx="23" cy="14" rx="14" ry="8.6" fill="#f4ead9"/>
    <ellipse cx="24" cy="17" rx="11" ry="5" fill="#fbf5ec"/>
    <g class="head">
      <path d="M33.5 5 L34.5 0.5 L38 4.5 Z" fill="#8a7566"/>
      <path d="M43 5 L42.5 0.5 L39 4.5 Z" fill="#8a7566"/>
      <path d="M34.7 4.3 L35.2 2 L37 4 Z" fill="#e6b7ae"/>
      <path d="M41.8 4.3 L41.3 2 L39.5 4 Z" fill="#e6b7ae"/>
      <circle cx="38" cy="10.5" r="7.3" fill="#f4ead9"/>
      <path d="M38 4 c6.5 1 6.5 13 0 14 c-6.5 -1 -6.5 -13 0 -14z" fill="#9a8676" opacity=".4"/>
      <ellipse class="muzzle" cx="40.5" cy="13.5" rx="4.6" ry="3.6" fill="#fbf5ec"/>
      <circle class="eye eyeOpen" cx="40.7" cy="9.8" r="1.9" fill="#5b93b3"/>
      <circle class="eye eyeOpen" cx="41.3" cy="9.2" r="0.6" fill="#fff"/>
      <path class="eye eyeClosed" d="M39 9.8 q1.6 1.6 3.4 0" stroke="#3a2e26" stroke-width="0.9" fill="none"/>
      <path class="nose" d="M43.2 12.4 l1.9 0 l-0.95 1.4 z" fill="#e89aa6"/>
      <path class="tongue" d="M44 14 q1.7 1.8 0 3" stroke="#e06a86" stroke-width="1.3" fill="none"/>
    </g>
  </svg>`;

  const WHEEL_SVG = `
  <svg width="86" height="86" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 40 L14 26" stroke="#cba06a" stroke-width="3" stroke-linecap="round"/>
    <path d="M35 40 L30 26" stroke="#cba06a" stroke-width="3" stroke-linecap="round"/>
    <rect x="7" y="39" width="30" height="4" rx="2" fill="#c69a63"/>
    <circle cx="22" cy="21" r="18" fill="none" stroke="#dcb886" stroke-width="4.6"/>
    <circle cx="22" cy="21" r="18" fill="none" stroke="#c69a63" stroke-width="1"/>
    <g class="wheelinner">
      <circle cx="22" cy="21" r="14" fill="none" stroke="#9aa0a8" stroke-width="3.4"/>
      <g stroke="#7e848c" stroke-width="0.8">
        <line x1="22" y1="7" x2="22" y2="35"/><line x1="8" y1="21" x2="36" y2="21"/>
        <line x1="12" y1="11" x2="32" y2="31"/><line x1="32" y1="11" x2="12" y2="31"/>
      </g>
    </g>
  </svg>`;

  const BED_SVG = `
  <svg width="58" height="26" viewBox="0 0 44 20" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="22" cy="14" rx="20" ry="5.6" fill="#b98a6a"/>
    <ellipse cx="22" cy="12" rx="15" ry="4.2" fill="#eccfa9"/>
  </svg>`;

  const BOWL_SVG = `
  <svg width="36" height="20" viewBox="0 0 26 14" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="13" cy="6" rx="10" ry="2.6" fill="#8a5a2a"/>
    <path d="M4 6 q9 7 18 0 z" fill="#cf7a33"/>
    <ellipse cx="13" cy="6" rx="7" ry="1.6" fill="#7a4a24"/>
  </svg>`;

  const widget = document.createElement("div");
  widget.id = "catWidget";
  widget.innerHTML =
    `<div class="stage">
       <div class="floor"></div>
       <div class="furni wheel">${WHEEL_SVG}</div>
       <div class="furni bed">${BED_SVG}</div>
       <div class="furni bowl">${BOWL_SVG}</div>
       <span class="zzz">Zzz</span>
       <div class="cat" title="なでる">${CAT_SVG}</div>
     </div>`;

  let stage, cat, wheel, zzz, curX = 20, busy = false, walkTimer = null, actTimer = null;
  const rand = (n) => Math.random() * n;
  const clampX = (x) => Math.max(6, Math.min(236, x));

  function setFacing(dir) { cat.classList.toggle("flip", dir === -1); }
  function clearActs() { cat.classList.remove("walking", "act-run", "act-eat", "act-sleep", "act-groom", "act-heso"); wheel.classList.remove("spin"); zzz.classList.remove("on"); }

  function plan() {
    const r = Math.random();
    if (r < 0.22) return { x: 16, act: "run", dur: 4000 + rand(4000), face: 1 };
    if (r < 0.52) return { x: 128, act: "sleep", dur: 9000 + rand(8000), face: 1 };
    if (r < 0.70) return { x: 214, act: "eat", dur: 3000 + rand(3000), face: 1 };
    if (r < 0.86) return { x: clampX(40 + rand(160)), act: "groom", dur: 3000 + rand(3000), face: Math.random() < 0.5 ? 1 : -1 };
    return { x: clampX(30 + rand(180)), act: "sit", dur: 2200 + rand(2600), face: Math.random() < 0.5 ? 1 : -1 };
  }

  function walkTo(x, cb) {
    clearActs();
    const dir = x > curX ? 1 : (x < curX ? -1 : 1);
    setFacing(dir);
    cat.classList.add("walking");
    const dist = Math.abs(x - curX);
    const dur = Math.max(0.5, dist / 50);
    cat.style.transition = `left ${dur}s linear`;
    requestAnimationFrame(() => { cat.style.left = x + "px"; });
    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => { curX = x; cat.classList.remove("walking"); cb(); }, dur * 1000 + 40);
  }

  function go() {
    if (busy) return;
    const p = plan();
    walkTo(p.x, () => {
      setFacing(p.face);
      cat.classList.add("act-" + p.act);
      if (p.act === "run") wheel.classList.add("spin");
      if (p.act === "sleep") zzz.classList.add("on");
      clearTimeout(actTimer);
      actTimer = setTimeout(() => { clearActs(); go(); }, p.dur);
    });
  }

  function heso() {
    if (busy) return;
    busy = true;
    clearTimeout(walkTimer); clearTimeout(actTimer);
    clearActs();
    cat.classList.add("act-heso");
    for (let i = 0; i < 5; i++) spawnHeart(i);
    setTimeout(() => { cat.classList.remove("act-heso"); busy = false; go(); }, 1800);
  }
  function spawnHeart(i) {
    const h = document.createElement("span");
    h.className = "catheart";
    h.textContent = "♥";
    h.style.left = (curX + 24 + rand(20)) + "px";
    h.style.top = (44 + rand(8)) + "px";
    h.style.animationDelay = (i * 0.12) + "s";
    stage.appendChild(h);
    setTimeout(() => h.remove(), 1500);
  }

  function start() {
    document.body.appendChild(widget);
    stage = widget.querySelector(".stage");
    cat = widget.querySelector(".cat");
    wheel = widget.querySelector(".furni.wheel");
    zzz = widget.querySelector(".zzz");
    cat.style.left = curX + "px";
    cat.addEventListener("click", (e) => { e.preventDefault(); heso(); });
    setTimeout(go, 600);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
