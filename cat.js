"use strict";
// 右上固定のドット絵猫ちゃん。回し車で走る/餌を食べる/寝る をランダムに繰り返し、
// クリックで背中をつけてへそてん(ゴロゴロ)して喜ぶ。
(function () {
  const PAL = { K: "#33261d", C: "#f4e7d5", S: "#e3cfb4", B: "#7c5a43", P: "#e89aa6", e: "#33261d" };
  // 目あき
  const CAT_OPEN = [
    "..............",
    "..KK......KK..",
    ".KBBK....KBBK.",
    ".KBBKKKKKKBBK.",
    "KCCCCCCCCCCCCK",
    "KCCCCCCCCCCCCK",
    "KCCeeCCCCeeCCK",
    "KCCeeCCCCeeCCK",
    "KCCCCCPPCCCCCK",
    "KCCCCCPPCCCCCK",
    ".KCCCCCCCCCCK.",
    ".KKCCCCCCCCKK.",
    "..KKKKKKKKKK..",
    "..............",
  ];
  // 目とじ(睡眠)
  const CAT_SLEEP = [
    "..............",
    "..KK......KK..",
    ".KBBK....KBBK.",
    ".KBBKKKKKKBBK.",
    "KCCCCCCCCCCCCK",
    "KCCCCCCCCCCCCK",
    "KCCCCCCCCCCCCK",
    "KCCKKCCCCKKCCK",
    "KCCCCCPPCCCCCK",
    "KCCCCCPPCCCCCK",
    ".KCCCCCCCCCCK.",
    ".KKCCCCCCCCKK.",
    "..KKKKKKKKKK..",
    "..............",
  ];
  const BOWL = { o: "#cf7a33", f: "#7a4a24" };
  const BOWL_ART = [
    "....ffff....",
    "..oooooooo..",
    ".oooooooooo.",
    "..oooooooo..",
  ];

  function spriteSVG(grid, pal, px) {
    const h = grid.length, w = grid[0].length;
    let rects = "";
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const col = pal[grid[y][x]];
      if (col) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" width="${w * px}" height="${h * px}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  }
  function wheelSVG() {
    let spokes = "";
    for (let a = 0; a < 360; a += 45) spokes += `<line x1="12" y1="12" x2="${12 + 10 * Math.cos(a * Math.PI / 180)}" y2="${12 + 10 * Math.sin(a * Math.PI / 180)}" stroke="#c2c6cd" stroke-width="1"/>`;
    return `<svg viewBox="0 0 24 24" width="74" height="74" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="none" stroke="#b0b5bd" stroke-width="1.6"/>${spokes}</svg>`;
  }

  const CAT_OPEN_SVG = spriteSVG(CAT_OPEN, PAL, 4);
  const CAT_SLEEP_SVG = spriteSVG(CAT_SLEEP, PAL, 4);
  const BOWL_SVG = spriteSVG(BOWL_ART, BOWL, 3);

  const widget = document.createElement("div");
  widget.id = "catWidget";
  widget.innerHTML =
    `<div class="cat-stage">
       <div class="cat-floor"></div>
       <div class="cat-wheel">${wheelSVG()}</div>
       <span class="cat-zzz">Zzz</span>
       <div class="cat-bowl">${BOWL_SVG}</div>
       <div class="cat-sprite" title="なでる"><div class="cat-inner">${CAT_OPEN_SVG}</div></div>
     </div>`;

  let stage, inner, timer = null, busy = false;
  const STATES = ["run", "eat", "sleep"];

  function setState(s) {
    stage.className = "cat-stage state-" + s;
    inner.innerHTML = (s === "sleep") ? CAT_SLEEP_SVG : CAT_OPEN_SVG;
  }
  function cycle() {
    if (busy) return;
    const s = STATES[Math.floor(Math.random() * STATES.length)];
    setState(s);
    const dur = s === "sleep" ? 4500 + Math.random() * 3000 : 3200 + Math.random() * 2600;
    timer = setTimeout(cycle, dur);
  }
  function hesoten() {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    stage.className = "cat-stage hesoten";
    inner.innerHTML = CAT_OPEN_SVG;
    for (let i = 0; i < 5; i++) spawnHeart(i);
    setTimeout(() => { busy = false; cycle(); }, 1800);
  }
  function spawnHeart(i) {
    const h = document.createElement("span");
    h.className = "catheart";
    h.textContent = "♥";
    h.style.left = (26 + Math.random() * 40) + "px";
    h.style.top = (40 + Math.random() * 8) + "px";
    h.style.animationDelay = (i * 0.12) + "s";
    stage.appendChild(h);
    setTimeout(() => h.remove(), 1500);
  }

  function start() {
    document.body.appendChild(widget);
    stage = widget.querySelector(".cat-stage");
    inner = widget.querySelector(".cat-inner");
    widget.querySelector(".cat-sprite").addEventListener("click", (e) => { e.preventDefault(); hesoten(); });
    cycle();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
