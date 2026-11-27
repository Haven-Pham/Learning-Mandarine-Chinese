"use strict";
// Offline Chinese Handwriting Recognition Pad powered by gugray/HanziLookupJS (Make Me a Hanzi dataset).
// Zero external dependencies (no jQuery). Supports mouse, touch, and stylus via Pointer Events.
(function () {
  const DATA_URL = "data/hanzilookup-mmah.json";
  const LIB_URL = "vendor/hanzilookup.min.js";
  let loadPromise = null;
  let matcher = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.HanziLookup && typeof window.HanziLookup.init === "function") {
        resolve();
        return;
      }
      const existing = document.querySelector(`script[data-hw-lib="1"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Không tải được thư viện viết tay")), { once: true });
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.hwLib = "1";
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error("Không tải được thư viện viết tay")); };
      document.head.appendChild(s);
    });
  }

  function ensureReady() {
    if (matcher) return Promise.resolve(matcher);
    if (loadPromise) return loadPromise;
    loadPromise = loadScript(LIB_URL)
      .then(() => new Promise((resolve, reject) => {
        if (!window.HanziLookup || typeof window.HanziLookup.init !== "function") {
          reject(new Error("HanziLookup chưa sẵn sàng"));
          return;
        }
        if (window.HanziLookup.data && window.HanziLookup.data.mmah) {
          matcher = new window.HanziLookup.Matcher("mmah");
          resolve(matcher);
          return;
        }
        window.HanziLookup.init("mmah", DATA_URL, (ok) => {
          if (ok && window.HanziLookup.data && window.HanziLookup.data.mmah) {
            matcher = new window.HanziLookup.Matcher("mmah");
            resolve(matcher);
          } else {
            loadPromise = null;
            reject(new Error("Không tải được dữ liệu nét chữ (mmah)"));
          }
        });
      }))
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
    return loadPromise;
  }

  function getCharPinyin(ch) {
    try {
      if (typeof window.pyOf === "function") {
        const p = window.pyOf(ch);
        if (p) return p;
      }
      if (window.pinyinPro && typeof window.pinyinPro.pinyin === "function") {
        return window.pinyinPro.pinyin(ch, { toneType: "symbol" }) || "";
      }
    } catch (e) {}
    return "";
  }

  function rankTraditionalCandidates(rawMatches) {
    const out = [];
    const seen = new Set();
    const toTrad = typeof window.toTraditionalTw === "function" ? window.toTraditionalTw : (s) => s;

    // Preserve recognition order while surfacing Traditional Taiwan equivalents first when a match is Simplified
    for (const m of rawMatches || []) {
      const ch = m && m.character;
      if (!ch) continue;
      const trad = toTrad(ch);
      if (trad && trad !== ch && !seen.has(trad)) {
        seen.add(trad);
        out.push({ ch: trad, py: getCharPinyin(trad) });
        if (out.length >= 12) break;
      }
      if (!seen.has(ch)) {
        seen.add(ch);
        out.push({ ch, py: getCharPinyin(ch) });
        if (out.length >= 12) break;
      }
    }
    return out;
  }

  function escHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    const onPick = typeof opts.onPick === "function" ? opts.onPick : () => {};
    const hint = opts.hint || "Vẽ chữ Hán vào ô lưới bên trái, sau đó bấm chữ gợi ý để chèn.";
    const autoClearOnPick = opts.autoClearOnPick !== false;

    host.innerHTML = `
      <div class="hw-pad">
        <div class="hw-pad-canvas-col">
          <div class="hw-pad-stage">
            <canvas class="hw-pad-canvas" width="256" height="256" aria-label="Bảng vẽ chữ Hán viết tay"></canvas>
            <div class="hw-pad-placeholder" data-hw-ph>Vẽ nét chữ tại đây</div>
          </div>
          <div class="hw-pad-toolbar">
            <button type="button" class="hw-pad-btn" data-hw-undo disabled aria-label="Hoàn tác nét vừa vẽ">
              <span class="material-symbols-outlined text-[18px]">undo</span>
              <span>Hoàn tác</span>
            </button>
            <button type="button" class="hw-pad-btn" data-hw-clear disabled aria-label="Xóa toàn bộ bảng vẽ">
              <span class="material-symbols-outlined text-[18px]">delete_outline</span>
              <span>Xóa</span>
            </button>
          </div>
        </div>
        <div class="hw-pad-results-col">
          <div class="hw-pad-status" data-hw-status role="status">Đang khởi tạo bộ nhận dạng chữ viết tay offline…</div>
          <div class="hw-pad-candidates" data-hw-cands aria-label="Chữ Hán gợi ý"></div>
          <p class="hw-pad-hint">${escHtml(hint)}</p>
        </div>
      </div>
    `;

    const canvas = host.querySelector(".hw-pad-canvas");
    const ph = host.querySelector("[data-hw-ph]");
    const btnUndo = host.querySelector("[data-hw-undo]");
    const btnClear = host.querySelector("[data-hw-clear]");
    const statusEl = host.querySelector("[data-hw-status]");
    const candsEl = host.querySelector("[data-hw-cands]");

    const LOGICAL = 256;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = LOGICAL * dpr;
    canvas.height = LOGICAL * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    let strokes = [];
    let currentStroke = null;
    let drawing = false;
    let activePointerId = null;
    let lastPtTime = 0;
    let isReady = false;

    function isDark() {
      return document.documentElement.dataset.theme === "dark";
    }

    function drawGrid() {
      ctx.clearRect(0, 0, LOGICAL, LOGICAL);
      ctx.save();
      ctx.strokeStyle = isDark() ? "rgba(214, 202, 196, 0.22)" : "rgba(141, 112, 108, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(LOGICAL / 2, 0); ctx.lineTo(LOGICAL / 2, LOGICAL);
      ctx.moveTo(0, LOGICAL / 2); ctx.lineTo(LOGICAL, LOGICAL / 2);
      ctx.moveTo(0, 0); ctx.lineTo(LOGICAL, LOGICAL);
      ctx.moveTo(LOGICAL, 0); ctx.lineTo(0, LOGICAL);
      ctx.stroke();
      ctx.restore();
    }

    function drawAllStrokes() {
      drawGrid();
      const ink = isDark() ? "#F5EFEB" : "#1d1b1a";
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      for (const st of strokes) {
        if (!st.length) continue;
        ctx.beginPath();
        ctx.moveTo(st[0][0], st[0][1]);
        if (st.length === 1) {
          ctx.lineTo(st[0][0] + 0.1, st[0][1] + 0.1);
        } else {
          for (let i = 1; i < st.length; i++) ctx.lineTo(st[i][0], st[i][1]);
        }
        ctx.stroke();
      }
      ctx.restore();
      if (ph) ph.hidden = strokes.length > 0;
      if (btnUndo) btnUndo.disabled = strokes.length === 0;
      if (btnClear) btnClear.disabled = strokes.length === 0;
    }

    function runMatch() {
      if (!strokes.length) {
        if (candsEl) candsEl.innerHTML = "";
        if (statusEl && isReady) statusEl.textContent = "Sẵn sàng nhận dạng offline · Vẽ chữ để xem gợi ý";
        return;
      }
      if (!matcher) {
        if (statusEl) statusEl.textContent = "Đang tải dữ liệu nét chữ…";
        ensureReady().then(() => { isReady = true; runMatch(); }).catch((e) => {
          if (statusEl) statusEl.textContent = "Lỗi tải dữ liệu viết tay: " + e.message;
        });
        return;
      }
      try {
        const analyzed = new window.HanziLookup.AnalyzedCharacter(strokes);
        matcher.match(analyzed, 14, (matches) => {
          const list = rankTraditionalCandidates(matches);
          if (statusEl) {
            statusEl.textContent = list.length
              ? `Gợi ý (${strokes.length} nét) — bấm vào chữ để chèn:`
              : `Chưa nhận ra chữ (${strokes.length} nét) — thử vẽ rõ nét hơn.`;
          }
          if (candsEl) {
            candsEl.innerHTML = list.map((item) => `
              <button type="button" class="hw-cand-btn" data-hw-pick="${escHtml(item.ch)}" title="${escHtml(item.ch + (item.py ? " · " + item.py : ""))}">
                <span class="hw-cand-han" lang="zh-Hant">${escHtml(item.ch)}</span>
                ${item.py ? `<span class="hw-cand-py">${escHtml(item.py)}</span>` : ""}
              </button>
            `).join("");
          }
        });
      } catch (err) {
        if (statusEl) statusEl.textContent = "Không nhận dạng được nét vừa vẽ, hãy thử lại.";
      }
    }

    function getPoint(ev) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(LOGICAL, ((ev.clientX - rect.left) / Math.max(1, rect.width)) * LOGICAL));
      const y = Math.max(0, Math.min(LOGICAL, ((ev.clientY - rect.top) / Math.max(1, rect.height)) * LOGICAL));
      return [Math.round(x), Math.round(y)];
    }

    canvas.addEventListener("pointerdown", (ev) => {
      if (ev.button && ev.button !== 0) return;
      if (drawing) return;
      ev.preventDefault();
      activePointerId = ev.pointerId;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      drawing = true;
      const pt = getPoint(ev);
      currentStroke = [pt];
      strokes.push(currentStroke);
      lastPtTime = Date.now();
      drawAllStrokes();
    });

    canvas.addEventListener("pointermove", (ev) => {
      if (!drawing || ev.pointerId !== activePointerId || !currentStroke) return;
      ev.preventDefault();
      const now = Date.now();
      const pt = getPoint(ev);
      const prev = currentStroke[currentStroke.length - 1];
      const dx = pt[0] - prev[0], dy = pt[1] - prev[1];
      if (dx === 0 && dy === 0) return;
      if ((dx * dx + dy * dy) < 9 && now - lastPtTime < 28) return;
      lastPtTime = now;
      currentStroke.push(pt);
      drawAllStrokes();
    });

    function finishStroke(ev) {
      if (!drawing || ev.pointerId !== activePointerId) return;
      ev.preventDefault();
      drawing = false;
      activePointerId = null;
      if (currentStroke && currentStroke.length) {
        const p0 = currentStroke[0];
        const hasMove = currentStroke.some((p) => p[0] !== p0[0] || p[1] !== p0[1]);
        if (!hasMove) {
          currentStroke.push([p0[0] < LOGICAL ? p0[0] + 2 : p0[0] - 2, p0[1] < LOGICAL ? p0[1] + 2 : p0[1] - 2]);
        }
      }
      currentStroke = null;
      drawAllStrokes();
      runMatch();
    }

    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);

    if (btnUndo) {
      btnUndo.onclick = () => {
        if (!strokes.length) return;
        strokes.pop();
        drawAllStrokes();
        runMatch();
      };
    }

    const clearAll = () => {
      strokes = [];
      currentStroke = null;
      drawing = false;
      drawAllStrokes();
      runMatch();
    };
    if (btnClear) btnClear.onclick = clearAll;

    if (candsEl) {
      candsEl.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-hw-pick]");
        if (!btn) return;
        const ch = btn.dataset.hwPick;
        if (!ch) return;
        onPick(ch);
        if (autoClearOnPick) clearAll();
      });
    }

    drawAllStrokes();
    ensureReady().then(() => {
      isReady = true;
      if (statusEl && !strokes.length) {
        statusEl.textContent = "Sẵn sàng nhận dạng offline · Vẽ chữ để xem gợi ý";
      } else if (strokes.length) {
        runMatch();
      }
    }).catch((err) => {
      if (statusEl) statusEl.textContent = "Lỗi tải dữ liệu viết tay: " + err.message;
    });

    const api = {
      clear: clearAll,
      redraw: drawAllStrokes,
      testStrokes(mockStrokes) {
        strokes = mockStrokes;
        drawAllStrokes();
        return ensureReady().then(() => { isReady = true; runMatch(); });
      }
    };
    host._hwPad = api;
    return api;
  }

  window.HanziPad = { mount, ensureReady };
})();
