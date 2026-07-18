"use strict";
// 画面を遊びまわる猫ちゃん。クリックでへそてん(お腹を見せて喜ぶ)。
// チェック作業の邪魔をしないよう小さめ・半透明・クリック以外は透過。
(function () {
  // スノーシュー風(クリーム地＋シール色の耳/顔、青い目)の猫SVG
  const CAT_SVG = `
  <svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="36" cy="66" rx="18" ry="4" fill="rgba(0,0,0,.12)"/>
    <!-- しっぽ -->
    <path d="M54 52 q16 2 12 -14 q-2 -8 -8 -6 q5 3 3 10 q-2 7 -9 6z" fill="#8a6650"/>
    <!-- からだ -->
    <ellipse cx="34" cy="50" rx="20" ry="16" fill="#f4e7d5"/>
    <!-- 前足 -->
    <ellipse cx="26" cy="63" rx="5" ry="4" fill="#f7edde"/>
    <ellipse cx="40" cy="63" rx="5" ry="4" fill="#f7edde"/>
    <!-- 頭 -->
    <circle cx="34" cy="30" r="19" fill="#f4e7d5"/>
    <!-- 耳 -->
    <path d="M18 18 L20 4 L33 15 Z" fill="#8a6650"/>
    <path d="M50 18 L48 4 L35 15 Z" fill="#8a6650"/>
    <path d="M21 15 L22 8 L29 14 Z" fill="#d99b8f"/>
    <path d="M47 15 L46 8 L39 14 Z" fill="#d99b8f"/>
    <!-- 顔のマスク(シール色) -->
    <path d="M34 14 q13 2 12 16 q-1 10 -12 12 q-11 -2 -12 -12 q-1 -14 12 -16z" fill="#7a5a44" opacity="0.92"/>
    <!-- 白いマズル -->
    <ellipse cx="34" cy="37" rx="9" ry="7" fill="#f7efe2"/>
    <!-- 目 -->
    <ellipse class="eye" cx="27" cy="30" rx="4.2" ry="4.6" fill="#6db6e0"/>
    <ellipse class="eye" cx="41" cy="30" rx="4.2" ry="4.6" fill="#6db6e0"/>
    <circle cx="27" cy="30" r="2" fill="#1e2a33"/>
    <circle cx="41" cy="30" r="2" fill="#1e2a33"/>
    <circle cx="26" cy="29" r="0.8" fill="#fff"/>
    <circle cx="40" cy="29" r="0.8" fill="#fff"/>
    <!-- 鼻・口 -->
    <path d="M31.5 36 L36.5 36 L34 39 Z" fill="#e79aa6"/>
    <path d="M34 39 q-3 3 -6 1 M34 39 q3 3 6 1" stroke="#7a5a44" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <!-- ヒゲ -->
    <g stroke="#cbb9a3" stroke-width="1" stroke-linecap="round">
      <path d="M22 35 L10 33 M22 38 L11 39"/>
      <path d="M46 35 L58 33 M46 38 L57 39"/>
    </g>
  </svg>`;

  const wrap = document.createElement("div");
  wrap.id = "catRoam";
  const cat = document.createElement("button");
  cat.id = "catBtn";
  cat.setAttribute("aria-label", "猫ちゃん");
  cat.innerHTML = CAT_SVG;
  wrap.appendChild(cat);

  function start() {
    document.body.appendChild(wrap);
    place(window.innerWidth * 0.5, window.innerHeight * 0.5, false);
    scheduleMove();
  }

  let posX = 100, posY = 100, facing = 1, busy = false, timer = null;

  function place(x, y, flip) {
    const m = 20, w = 64, h = 64;
    posX = Math.max(m, Math.min(window.innerWidth - w - m, x));
    posY = Math.max(m, Math.min(window.innerHeight - h - m, y));
    if (flip !== undefined) facing = flip ? -1 : 1;
    cat.style.transform = `translate(${posX}px, ${posY}px) scaleX(${facing})`;
  }

  function scheduleMove() {
    clearTimeout(timer);
    timer = setTimeout(step, 2200 + Math.random() * 2200);
  }
  function step() {
    if (busy) { scheduleMove(); return; }
    const nx = 20 + Math.random() * (window.innerWidth - 104);
    const ny = 20 + Math.random() * (window.innerHeight - 104);
    facing = nx < posX ? -1 : 1;
    cat.classList.add("walking");
    place(nx, ny);
    setTimeout(() => cat.classList.remove("walking"), 2000);
    scheduleMove();
  }

  // クリック → へそてん(喜ぶ)
  cat.addEventListener("click", (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    cat.classList.add("hesoten");
    for (let i = 0; i < 5; i++) spawnHeart();
    setTimeout(() => { cat.classList.remove("hesoten"); busy = false; scheduleMove(); }, 1700);
  });

  function spawnHeart() {
    const hz = document.createElement("span");
    hz.className = "catheart";
    hz.textContent = "♥";
    hz.style.left = (posX + 20 + (Math.random() * 24 - 12)) + "px";
    hz.style.top = (posY + 6) + "px";
    hz.style.animationDelay = (Math.random() * 0.3) + "s";
    wrap.appendChild(hz);
    setTimeout(() => hz.remove(), 1400);
  }

  window.addEventListener("resize", () => place(posX, posY));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
