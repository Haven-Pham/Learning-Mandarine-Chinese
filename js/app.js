"use strict";
// Sổ học tiếng Hoa — runs fully in the browser. Data: TOCFL 2024 list, CC-CEDICT, Make Me a Hanzi, our own cards.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[\s'’·\-0-9]/g, "");
const clean = (s) => String(s || "").normalize("NFC").replace(/[\s,，.。;；:：!！?？、「」"“”]+/g, "");
const isHan = (s) => /[㐀-鿿豈-﫿]/.test(s);
const hanOnly = (s) => [...String(s || "")].filter((c) => /[㐀-鿿豈-﫿]/.test(c)).join("");
const fmt = (n) => Number(n).toLocaleString("vi-VN");
const BAND_INFO = { "Novice 1": "Chuẩn bị 1", "Novice 2": "Chuẩn bị 2", "A1": "Band A · cấp 1", "A2": "Band A · cấp 2", "B1": "Band B · cấp 3", "B2": "Band B · cấp 4", "C": "Band C · cấp 5" };
const VOCAB_TYPES = [["rec", "Nhận diện"], ["lis", "Nghe"], ["wri", "Nói và viết"], ["clo", "Điền từ"]];
const GRAMMAR_TYPES = [["rec", "Nhận diện mẫu câu"], ["bui", "Đặt câu"], ["clo", "Điền chỗ trống"]];

// ---------------- state ----------------
const S = {
  bands: [], tocfl: [], decks: [], notes: [], noteByWord: new Map(), noteByKey: new Map(),
  ced: null, cedList: null, vi: new Map(), abbrS: new Map(), abbrF: new Map(), packs: [],
  srs: new Map(), stats: new Map(), inbox: new Map(),
  settings: { newPerDay: 20, reviewPerDay: 50, decks: {}, bands: {}, extra: {}, ruby: true },
  session: null, dict: { mode: "han", src: "word" },
};

// ---------------- speech ----------------
let voice = null;
function pickVoice() {
  try { const vs = speechSynthesis.getVoices(); voice = vs.find((v) => /zh[-_]TW/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null; } catch (e) { voice = null; }
}
if ("speechSynthesis" in window) { pickVoice(); try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {} }
function say(text, rate) {
  try { if (!("speechSynthesis" in window) || !text) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "zh-TW"; if (voice) u.voice = voice; u.rate = rate || 0.9; speechSynthesis.speak(u); } catch (e) {}
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-say]"); if (b) { e.preventDefault(); say(b.dataset.say, Number(b.dataset.rate) || 0.9); } });
const sp = (t, label) => t ? `<button type="button" class="speak" data-say="${esc(t)}" aria-label="Nghe">▶ ${esc(label || "nghe")}</button>` : "";

// ---------------- data loading ----------------
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
function formsOf(w) {
  const out = [];
  for (let f of String(w).split("/")) { f = f.trim(); if (!f) continue;
    if (f.includes("(")) { out.push(f.replace(/[()]/g, "")); out.push(f.replace(/\([^)]*\)/g, "")); } else out.push(f); }
  return [...new Set(out)];
}
function buildNotes() {
  S.notes = []; S.noteByWord = new Map(); S.noteByKey = new Map();
  const add = (n) => { S.notes.push(n); S.noteByKey.set(n.key, n); };
  for (const d of S.decks) (d.items || []).forEach((it, i) => {
    const n = { key: `${d.id}~${i}`, deck: d, i, kind: d.kind, rich: true, w: it.w, band: it.band, it };
    add(n); if (d.kind === "vocab" && !S.noteByWord.has(it.w)) S.noteByWord.set(it.w, n);
  });
  S.tocfl.forEach(([w, py, band, pos, theme], idx) => {
    const forms = formsOf(w);
    const richNote = forms.map((f) => S.noteByWord.get(f)).find((n) => n && n.rich);
    if (richNote) { for (const f of forms) if (!S.noteByWord.has(f)) S.noteByWord.set(f, richNote); richNote.official = richNote.official || { w, py, band, pos }; (richNote.bands = richNote.bands || new Set()).add(band); return; }
    // the same word listed again at another band: one note that belongs to both bands
    const existing = S.noteByKey.get(`t~${forms[0]}`) || forms.map((f) => S.noteByWord.get(f)).find((x) => x && x.basic);
    if (existing) { existing.bands.add(band); return; }
    const n = { key: `t~${forms[0]}`, kind: "vocab", basic: true, w: forms[0], forms, display: w, py, band, bands: new Set([band]), pos, theme, idx };
    add(n); for (const f of forms) if (!S.noteByWord.has(f)) S.noteByWord.set(f, n);
  });
}
// CC-CEDICT entries for a word, common readings first (lower-case pinyin before surnames and proper names)
function cedFirst(w) {
  const e = S.ced && S.ced.get(w); if (!e) return null;
  return e.slice().sort((a, b) => (/^[A-ZĀÁǍÀĒÉĚÈŌÓǑÒ]/.test(a[0]) - /^[A-ZĀÁǍÀĒÉĚÈŌÓǑÒ]/.test(b[0])) || (/^surname/.test(a[1]) - /^surname/.test(b[1])));
}
function enOf(w) {
  const e = cedFirst(w); if (!e) return "";
  return e.map(([, defs]) => defs.split("/").filter((d) => !/^(variant of|old variant|see |CL:|surname )/.test(d)).slice(0, 3).join("; ")).filter(Boolean).slice(0, 2).join(" | ");
}
// The content shown on a card. Rich notes have full content; basic notes are built from the official list + CEDICT + Vietnamese batches.
function itemOf(n) {
  if (n.rich) return n.it;
  const v = S.vi.get(n.w) || {};
  return Object.assign({ w: n.w, py: n.py, pos: n.pos, band: n.band, en: enOf(n.w), vn: "", hv: "" }, v);
}
function typesOf(n) {
  if (n.kind === "grammar") return GRAMMAR_TYPES;
  let t;
  if (n.rich) t = VOCAB_TYPES.slice();
  else {
    const it = itemOf(n); t = [["rec", "Nhận diện"], ["lis", "Nghe"]];
    if (it.vn || it.en) t.push(["wri", "Nói và viết"]);
    if (it.e2 && it.e2.includes(n.w)) t.push(["clo", "Điền từ"]);
  }
  if (S.abbrS.has(n.w)) t.push(["abr", "Từ viết tắt"]);
  return t;
}
const inBand = (n, b) => !!(n.bands && n.bands.has(b));
const bandsOf = (n) => n.bands ? [...n.bands] : [];
const bandLabel = (n) => { const b = bandsOf(n); return b.length ? "TOCFL " + b.join(" · ") : (n.rich ? n.deck.name : "ngoài bảng TOCFL"); };
const cardId = (n, t) => n.rich ? `${n.deck.id}~${n.i}~${t}` : `t~${n.w}~${t}`;
function noteLevel(n) {
  const ls = typesOf(n).map(([t]) => S.srs.get(cardId(n, t))).filter((s) => s && s.state !== "new").map(cardLevel);
  return ls.length ? Math.min(...ls) : 0;
}
function noteLapses(n) { return typesOf(n).reduce((a, [t]) => a + ((S.srs.get(cardId(n, t)) || {}).lapses || 0), 0); }
function levelPill(n) { const l = noteLevel(n); return `<span class="pill lv-${l}">${esc(LEVELS[l])}</span>` + (noteLapses(n) >= 4 ? ` <span class="pill forget">Hay quên</span>` : ""); }
function levelOptions(selected, withHint = false) {
  const hints = ["", "ôn lại ngay", "ôn sau 1 ngày", "ôn sau 7 ngày", "ôn sau 21 ngày", "ôn sau 90 ngày"];
  return LEVELS.slice(1).map((label, i) => {
    const val = i + 1;
    const txt = withHint ? `${label} (${hints[val]})` : label;
    return `<option value="${val}"${selected === val ? " selected" : ""}>${esc(txt)}</option>`;
  }).join("");
}
function levelPicker(n) {
  const current = noteLevel(n);
  const lvlHints = ["Đặt lại", "Ôn lại ngay", "1 ngày", "7 ngày", "21 ngày", "90 ngày"];
  return `<div class="panel">
    <div class="grade-box-head" style="margin-bottom:10px;">
      <b>Đặt mức nhớ cho cả từ</b>
      <span class="grade-box-meta">Mức hiện tại: ${levelPill(n)}</span>
    </div>
    <div class="grades-6">
      ${[0, 1, 2, 3, 4, 5].map((lvl) => {
        const isCur = current === lvl;
        return `<button type="button" class="lvl-btn lvl-btn-${lvl} ${isCur ? "is-current" : ""}" data-word-level="${lvl}" title="Đặt ${esc(n.w)} ở mức ${esc(LEVELS[lvl])}">
          <span class="lvl-title">${isCur ? "✓ " : ""}${esc(LEVELS[lvl])}</span>
          <small class="lvl-sub">${esc(lvlHints[lvl])}</small>
        </button>`;
      }).join("")}
    </div>
    <div class="sub" style="margin-top:8px;">Áp dụng cho mọi dạng thẻ của từ và tính vào mục tiêu học hôm nay.</div>
    <div role="status" id="levelStatus"></div>
  </div>`;
}
function cardGradingBox(r, now) {
  const current = noteLevel(r.n);
  const lvlHints = ["Đặt lại", "Ôn lại ngay", "1 ngày", "7 ngày", "21 ngày", "90 ngày"];
  return `<div class="grade-box">
    <div class="grade-box-head">
      <span class="grade-box-title">Chấm điểm ghi nhớ cho cả từ</span>
      <span class="grade-box-meta">Mức hiện tại: ${levelPill(r.n)}</span>
    </div>
    <div class="grades-6">
      ${[0, 1, 2, 3, 4, 5].map((lvl) => {
        const isCur = current === lvl;
        return `<button type="button" class="lvl-btn lvl-btn-${lvl} ${isCur ? "is-current" : ""}" data-word-level="${lvl}" title="Đặt ${esc(r.n.w)} ở mức ${esc(LEVELS[lvl])}">
          <span class="lvl-title">${isCur ? "✓ " : ""}${esc(LEVELS[lvl])}</span>
          <small class="lvl-sub">${esc(lvlHints[lvl])}</small>
        </button>`;
      }).join("")}
    </div>
    <div class="keys">Bàn phím: 1 Mới học · 2 Nhớ tạm · 3 Nhớ lâu · 4 Thuộc lòng · 5 Thông thạo · 0 Chưa học</div>
    <div class="sub" style="text-align:center;">Áp dụng cho mọi dạng thẻ của từ và tính vào mục tiêu học hôm nay.</div>
    <div role="status" id="levelStatus"></div>
  </div>`;
}
// --- Stroke Data Loader (for HanziWriter in #hoc & #tu) ---
const strokeCache = new Map();
async function strokeData(c) {
  const k = String(c.codePointAt(0) % 64).padStart(2, "0");
  if (!strokeCache.has(k)) strokeCache.set(k, getJSON(`data/strokes/${k}.json`));
  const chunk = await strokeCache.get(k);
  if (!chunk || !chunk[c]) throw new Error("no data");
  return chunk[c];
}

// --- SRS Core Functions (SM-2 Spaced Repetition & Calibrated Levels) ---
const cardKey = (key, t) => `${key}~${t}`;
async function bumpReviewStats(now, grade, wasNew) {
  const key = dayKey(now);
  if (!S.stats) S.stats = new Map();
  const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats.get(key));
  st.reviews++;
  if (wasNew) st.newCards++;
  if (grade === 1) st.again++;
  S.stats.set(key, st);
  if (S.session) S.session.answered = (S.session.answered || 0) + 1;
  try { await Store.put("stats", key, st); } catch (e) {}
  if (window.Sync && typeof Sync.onCardGraded === "function") Sync.onCardGraded();
}

// 1. Grade single card via SM-2: grade 1 (Quên), 2 (Khó), 3 (Nhớ tốt), 4 (Dễ)
async function applyCardGrade(n, type, grade, afterSave) {
  if (!grade || grade < 1 || grade > 4) return;
  const now = Date.now();
  if (!S.srs) S.srs = new Map();
  if (!S.cards) S.cards = new Map();
  const cid = cardId(n, type);
  const prev = S.srs.get(cid);
  const wasNew = !prev || prev.state === "new";
  let s = Object.assign(typeof freshState === "function" ? freshState() : { due: now, ivl: 0, reps: 0, ease: 250, lapses: 0, state: "new" }, prev, { w: n.w });
  if (window.SRS && typeof window.SRS.schedule === "function") {
    s = window.SRS.schedule(s, grade, now);
  } else if (typeof schedule === "function") {
    s = schedule(s, grade, now);
  } else {
    if (grade === 1) {
      s.state = "learn";
      s.step = 0;
      s.due = now + 10 * 60000;
      s.lapses = (s.lapses || 0) + 1;
    } else {
      s.state = "review";
      s.ivl = grade === 2 ? Math.max(1, (s.ivl || 1) * 1.2) : (grade === 3 ? Math.max(1, (s.ivl || 1) * 2.5) : Math.max(2, (s.ivl || 1) * 3));
      s.due = now + s.ivl * 86400000;
    }
  }
  s.w = n.w;
  if (wasNew && S.session) {
    if (!S.session.newKeys) S.session.newKeys = new Set();
    S.session.newKeys.add(n.key);
  }
  if (grade === 1 && S.session && Array.isArray(S.session.queue)) {
    S.session.queue.push({ n, t: type, type });
  }
  S.srs.set(cid, s);
  S.cards.set(cid, s);
  await Store.put("srs", cid, s);

  await bumpReviewStats(now, grade, wasNew);
  updateBadge();
  if (typeof afterSave === "function") afterSave();
}

async function applyCardLevel(n, type, targetLvl, applyToAllOrCb, maybeCb) {
  const now = Date.now();
  targetLvl = Number(targetLvl);
  if (isNaN(targetLvl) || targetLvl < 0 || targetLvl > 5) return;
  let applyToAll = false;
  let afterSave = maybeCb;
  if (typeof applyToAllOrCb === "function") {
    afterSave = applyToAllOrCb;
  } else {
    applyToAll = !!applyToAllOrCb;
  }
  if (!S.srs) S.srs = new Map();
  if (!S.cards) S.cards = new Map();
  const intervals = [0, 0, 1, 7, 21, 90];
  const ivl = intervals[targetLvl] || 0;
  const targets = applyToAll ? typesOf(n).map(([t]) => t) : [type];
  let anyWasNew = false;
  const entries = targets.map((t) => {
    const cid = cardId(n, t);
    const prev = S.srs.get(cid);
    if (!prev || prev.state === "new") anyWasNew = true;
    if (targetLvl === 0) {
      const s = typeof freshState === "function" ? freshState() : { state: "new", ivl: 0, due: now };
      s.w = n.w;
      return [cid, s];
    }
    const s = Object.assign(typeof freshState === "function" ? freshState() : {}, prev, {
      state: targetLvl === 1 ? "learn" : "review",
      ivl,
      step: 0,
      due: targetLvl >= 2 ? dayStart(now) + ivl * DAY : now + (typeof STEPS !== "undefined" ? STEPS[0] : 1 * MIN),
      firstSeen: (prev && (prev.firstSeen || prev.last)) || now,
      last: now,
      w: n.w
    });
    return [cid, s];
  });
  for (const [cid, s] of entries) {
    S.srs.set(cid, s);
    S.cards.set(cid, s);
  }
  if (entries.length === 1) {
    await Store.put("srs", entries[0][0], entries[0][1]);
  } else if (entries.length > 1) {
    await Store.putMany("srs", entries);
  }
  if (anyWasNew && targetLvl > 0 && S.session) {
    if (!S.session.newKeys) S.session.newKeys = new Set();
    S.session.newKeys.add(n.key);
  }
  if (targetLvl > 0) {
    await bumpReviewStats(now, targetLvl === 1 ? 1 : 3, anyWasNew);
  } else if (S.session) {
    S.session.answered = (S.session.answered || 0) + 1;
  }
  updateBadge();
  if (typeof afterSave === "function") afterSave();
}

// 2. Manual Level Override (Sets word level & updates SRS interval baseline safely)
async function applyWordLevel(n, level, afterSave) {
  if (level === undefined || level < 0 || level > 5) return;
  const now = Date.now();
  const ivl = [0, 0, 1, 7, 21, 90][level];
  const wasNew = noteLevel(n) === 0;

  const entries = typesOf(n).map(([type]) => {
    const id = cardId(n, type);
    if (level === 0) {
      const state = freshState();
      state.w = n.w;
      return [id, state];
    }
    const state = Object.assign(freshState(), S.srs ? S.srs.get(id) : null);
    Object.assign(state, {
      state: level === 1 ? "learn" : "review",
      ivl,
      step: 0,
      due: level === 1 ? now + (typeof STEPS !== "undefined" ? STEPS[0] : 1 * MIN) : dayStart(now) + ivl * DAY,
      firstSeen: state.firstSeen || state.last || now,
      last: now,
      w: n.w
    });
    return [id, state];
  });

  if (S.srs) for (const [id, s] of entries) S.srs.set(id, s);
  if (S.cards) for (const [id, s] of entries) S.cards.set(id, s);
  await Store.putMany("srs", entries);

  if (level > 0 && wasNew) {
    const key = dayKey(now);
    const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats ? S.stats.get(key) : null);
    st.newCards++;
    if (S.stats) S.stats.set(key, st);
    await Store.put("stats", key, st);
  }
  updateBadge();
  if (typeof afterSave === "function") afterSave();
}

function bindLevelPicker(n, afterSave, target = document) {
  if (target && target.tagName === "SELECT") {
    target.onchange = async () => {
      const lvl = Number(target.value);
      target.disabled = true;
      try {
        await applyWordLevel(n, lvl, afterSave);
      } finally {
        target.disabled = false;
      }
    };
    return;
  }
  const root = target || document;
  const btns = root.querySelectorAll ? root.querySelectorAll("[data-word-level]") : [];
  btns.forEach((btn) => {
    btn.onclick = async () => {
      root.querySelectorAll("[data-word-level]").forEach((b) => (b.disabled = true));
      const lvl = Number(btn.dataset.wordLevel);
      await applyWordLevel(n, lvl, afterSave);
    };
  });
  const sel = root.querySelector ? root.querySelector("#wordLevel") : null;
  if (sel && sel.tagName === "SELECT") {
    sel.onchange = async () => {
      const lvl = Number(sel.value);
      sel.disabled = true;
      try {
        await applyWordLevel(n, lvl, afterSave);
      } finally {
        sel.disabled = false;
      }
    };
  }
}
function meaningOf(n) { const it = itemOf(n); return it.vn || it.en || ""; }

// ---------------- study queue ----------------
const deckOn = (id) => S.settings.decks[id] !== false;
const bandOn = (n) => bandsOf(n).some((b) => S.settings.bands[b]);
const inLearning = (n) => n.rich ? (deckOn(n.deck.id) || bandOn(n)) : (bandOn(n) || !!S.settings.extra[n.w]);
function activeNotes() { return S.notes.filter(inLearning); }
function todayStats() { return S.stats.get(dayKey(Date.now())) || { reviews: 0, newCards: 0, again: 0 }; }
function buildQueue(now) {
  const learn = [], review = [], fresh = []; const end = dayStart(now) + DAY, today0 = dayStart(now);
  const seen = new Set();
  // reviews: every card with a state, whatever deck or band is switched on
  for (const [id, s] of S.srs) {
    if (!s || s.state === "new") continue;
    const n = noteFromCard(id); if (!n) continue;
    const ref = { id, n, t: id.split("~").pop(), s };
    if (s.state === "learn" || s.state === "relearn") learn.push(ref); else if (s.due < end) review.push(ref);
    seen.add(id);
  }
  for (const n of activeNotes()) {
    const types = typesOf(n); const first = S.srs.get(cardId(n, types[0][0]));
    types.forEach(([t], k) => {
      const id = cardId(n, t); if (seen.has(id)) return;
      if (k === 0 || (first && first.state !== "new" && dayStart(first.firstSeen || first.last) < today0)) fresh.push({ id, n, t, s: null });
    });
  }
  learn.sort((a, b) => a.s.due - b.s.due); review.sort((a, b) => a.s.due - b.s.due);
  const left = Math.max(0, Number(S.settings.newPerDay || 8) - todayStats().newCards);
  return { learn, review, fresh: fresh.slice(0, left), freshTotal: fresh.length };
}
function noteFromCard(id) {
  const parts = id.split("~"); parts.pop();
  if (parts[0] === "t") return S.noteByKey.get(`t~${parts.slice(1).join("~")}`);
  return S.noteByKey.get(parts.join("~"));
}
function nextCard(now) {
  const q = buildQueue(now); const last = S.session && S.session.lastNote;
  const filterFolder = S.session && S.session.folderFilter;
  const pick = (arr) => arr.find((r) => r.n.key !== last) || arr[0];
  if (filterFolder) {
    const fNotes = new Set(folderNotes(filterFolder).map(n => n.key));
    const fLearn = q.learn.filter(r => fNotes.has(r.n.key));
    const fReview = q.review.filter(r => fNotes.has(r.n.key));
    const fFresh = q.fresh.filter(r => fNotes.has(r.n.key));
    const fDueLearn = fLearn.filter((r) => r.s.due <= now);
    if (fDueLearn.length) return pick(fDueLearn);
    if (fReview.length) return pick(fReview);
    if (fFresh.length) return pick(fFresh);
    const fAhead = fLearn.filter((r) => r.s.due <= now + 20 * MIN);
    if (fAhead.length) return fAhead[0];
    return null;
  }
  const dueLearn = q.learn.filter((r) => r.s.due <= now);
  if (dueLearn.length) return pick(dueLearn);
  if (q.review.length) return pick(q.review);
  if (q.fresh.length) return pick(q.fresh);
  const ahead = q.learn.filter((r) => r.s.due <= now + 20 * MIN);
  return ahead[0] || null;
}
function todayCounts() {
  const now = Date.now(); const q = buildQueue(now);
  const due = q.review.length + q.learn.filter((r) => r.s.due < dayStart(now) + DAY).length;
  return { q, due, fresh: q.fresh.length, total: due + q.fresh.length };
}

// ---------------- card rendering ----------------
function frontHTML(r) {
  const n = r.n, it = itemOf(n);
  if (n.kind === "grammar") {
    if (r.t === "rec") return `<div class="front"><div class="big gram">${esc(it.w)}</div><div class="task">Mẫu này nghĩa là gì? Thử đặt một câu với nó.</div></div>`;
    if (r.t === "bui") return `<div class="front"><div class="prompt">${esc(it.e1v)}</div><div class="task">Nói câu này bằng tiếng Trung, dùng mẫu <span class="han">${esc(it.w)}</span></div></div>`;
    return `<div class="front"><div class="cz">${esc(it.cz)}</div><div class="task">${esc(it.e2v)}<br>Điền phần còn thiếu</div></div>`;
  }
  if (r.t === "rec") {
    const ex = it.e1 || it.e2;
    return `<div class="front">
      <div class="big" lang="zh-Hant">${esc(it.w)}</div>
      ${ex ? `<div class="front-sentence han">${esc(ex)}</div>` : ""}
      <div class="front-audio-btn">${sp(ex || it.w, ex ? "▶ Nghe câu" : "▶ Nghe phát âm")}</div>
      <div class="task">🎧 Nghe audio → 📖 Đọc chữ → 💡 Hiểu nghĩa</div>
    </div>`;
  }
  if (r.t === "lis") return `<div class="front"><div class="emoji" aria-hidden="true">🎧</div><div class="prompt">Nghe và đoán nghĩa</div>
    <div class="actions center">${sp(it.w, "nghe từ")}${it.e1 ? sp(it.e1, "nghe câu") : ""}</div><div class="task">Nói nghĩa của từ${it.e1 ? " và của câu ví dụ" : ""}</div></div>`;
  if (r.t === "wri") return `<div class="front">${it.img ? `<div class="emoji" aria-hidden="true">${esc(it.img)}</div>` : ""}<div class="prompt">${esc(it.vn || it.en)}</div>
    <div class="task">${it.vn && it.en ? esc(it.en) + " · " : ""}${esc(it.pos || "")}<br>Nói to rồi viết từ này ra giấy</div></div>`;
  if (r.t === "abr") return `<div class="front"><div class="big">${esc(it.w)}</div><div class="task">Đây là cách nói tắt. Dạng đầy đủ là gì? Nghĩa là gì?</div></div>`;
  const cz = it.e2.split(it.w).join("＿".repeat([...it.w].length));
  return `<div class="front"><div class="cz">${esc(cz)}</div><div class="task">${esc(it.e2v || "")}<br>Điền từ còn thiếu</div></div>`;
}
// Pinyin over every Chinese word in mixed text (answers, notes, details). Not used on the question side of a card.
const TONE_MARK = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
function pyOf(w) {
  const n = S.noteByWord.get(w); if (n) return itemOf(n).py || "";
  const e = cedFirst(w); return e ? e[0][0].replace(/\s+/g, "").toLowerCase() : "";
}
function ruby(text) {
  const s = String(text ?? "");
  if (!S.settings.ruby) return esc(s);
  let out = "", last = 0; const re = /[㐀-鿿豈-﫿]+/g; let m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    const run = m[0]; const next = (s.slice(m.index + run.length).match(/^\s*([^\s,，;；:：()（）·]+)/) || ["", ""])[1];
    if (TONE_MARK.test(next)) out += esc(run); // pinyin is already written right after it
    else out += segment(run).map((k) => { const p = pyOf(k.t); return p ? `<ruby>${esc(k.t)}<rt>${esc(p)}</rt></ruby>` : esc(k.t); }).join("");
    last = m.index + run.length;
  }
  return out + esc(s.slice(last));
}
function kv(rows) {
  return rows.map(([label, value], i) => value ? `<div class="detail-tone-${i}"><span class="k">${esc(label)}</span><span class="mix">${ruby(value)}</span></div>` : "").join("");
}
function abbrHTML(w) {
  const a = S.abbrS.get(w), f = S.abbrF.get(w); let h = "";
  if (a) h += `<div class="abbr"><b>Nói tắt của</b> <a class="han" href="#tu/${encodeURIComponent(a.f)}"><ruby>${esc(a.f)}<rt>${esc(a.pyf)}</rt></ruby></a>
    <div class="sub">Nguồn: <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.src === "cedict" ? "CC-CEDICT" : "教育部《重編國語辭典修訂本》(萌典)")}</a> — <span class="han">${esc(a.note.replace(/^[^：:]+[：:]\s*/, ""))}</span></div></div>`;
  if (f) h += `<div class="abbr"><b>Thường nói tắt là</b> <a class="han" href="#tu/${encodeURIComponent(f.s)}"><ruby>${esc(f.s)}<rt>${esc(f.pys)}</rt></ruby></a>
    <div class="sub">Nguồn: <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.src === "cedict" ? "CC-CEDICT" : "教育部《重編國語辭典修訂本》(萌典)")}</a></div></div>`;
  return h;
}
// Split view on wide screens: head (word, reading, meaning) and body (mnemonics, examples, details).
function detailParts(n, opts = {}) {
  const html = detailHTML(n, opts);
  const i = html.indexOf("<!--body-->"); const j = html.lastIndexOf("</div>");
  return { head: html.slice(0, i).replace('<div class="ans">', ""), body: html.slice(i + 11, j) };
}
function detailHTML(n, opts = {}) {
  const it = itemOf(n);
  if (n.kind === "grammar") {
    return `<div class="ans">
      <div class="head"><div class="w gram">${esc(it.w)}</div><div class="py">${esc(it.py)}</div><div class="vn">${esc(it.vn)}</div><div class="sub">${esc(it.en)}</div>
        ${opts.answer ? `<div class="pill lv-3" style="margin-top:6px">${esc(it.ans)}</div>` : ""}</div><!--body-->
      <div class="tip"><b>Cấu trúc</b><span class="mix">${ruby(it.st)}</span></div>
      ${[1, 2, 3].map((k) => it["e" + k] ? `<div class="ex"><div class="zh">${esc(it["e" + k])} ${sp(it["e" + k])}</div><div class="exs">${esc(it["e" + k + "p"])}<br>${esc(it["e" + k + "v"])}</div></div>` : "").join("")}
      ${it.tw ? `<div class="tw"><b>Người Đài nói thế nào</b><span class="mix">${ruby(it.tw)}</span></div>` : ""}
      <div class="miss"><b>Lỗi hay gặp:</b> ${ruby(it.mk)}</div>
      <details class="more" open><summary>Xem thêm</summary><div class="kv">${kv([["Cách dùng", it.us], ["So sánh với mẫu gần giống", it.cmp], ["Nguồn", it.src]])}</div></details></div>`;
  }
  const metadata = [["Từ loại", it.pos], ["Hán Việt", it.hv], ["Cấp TOCFL", bandsOf(n).join(" · ") || "Ngoài bảng TOCFL"]];
  return `<div class="ans">
    <div class="head">${it.img ? `<div class="emoji-s" aria-hidden="true">${esc(it.img)}</div>` : ""}<div class="w" lang="zh-Hant">${esc(it.w)}</div>
      <div class="py">${esc(it.py)} ${sp(it.w)}</div>
      <dl class="word-meta">${metadata.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value || "—")}</dd></div>`).join("")}</dl>
      <dl class="word-meanings"><div><dt>Nghĩa tiếng Việt</dt><dd>${esc(it.vn || "Chưa có nghĩa tiếng Việt")}</dd></div>
      <div><dt>Nghĩa tiếng Anh</dt><dd lang="en">${esc(it.en || "—")}</dd></div></dl></div><!--body-->
    ${abbrHTML(it.w)}
    ${it.mi || it.mh || it.ms ? `<div class="tip"><b>Mẹo nhớ</b>${it.mi ? `<div><b>Hình:</b> ${ruby(it.mi)}</div>` : ""}${it.mh ? `<div><b>Hán Việt:</b> ${ruby(it.mh)}</div>` : ""}${it.ms ? `<div><b>Chuyện:</b> ${ruby(it.ms)}</div>` : ""}</div>` : ""}
    ${it.e1 ? `<div class="ex"><div class="zh">${esc(it.e1)} ${sp(it.e1)}</div><div class="exs">${esc(it.e1p || "")}<br>${esc(it.e1v || "")}</div></div>` : ""}
    ${it.e2 ? `<div class="ex"><div class="zh">${esc(it.e2)} ${sp(it.e2)}</div><div class="exs">${esc(it.e2p || "")}<br>${esc(it.e2v || "")}</div></div>` : ""}
    ${it.tw ? `<div class="tw"><b>Người Đài nói thế nào</b><span class="mix">${ruby(it.tw)}</span></div>` : ""}
    ${it.mk ? `<div class="miss"><b>Lỗi hay gặp:</b> ${ruby(it.mk)}</div>` : ""}
    ${(it.us || it.co || it.sy || it.an || it.cf || it.pa || it.fa || it.lt) ? `<details class="more" open><summary>Xem thêm</summary><div class="kv">${kv([["Lượng từ", it.lt], ["Cách dùng", it.us], ["Cụm hay gặp", it.co], ["Đồng nghĩa, gần nghĩa", it.sy], ["Trái nghĩa", it.an], ["Dễ nhầm với", it.cf], ["Cấu tạo chữ", it.pa], ["Họ từ", it.fa], ["Nguồn", it.src]])}</div></details>` : ""}
    ${opts.link !== false && n.kind === "vocab" ? `<a class="link" href="#tu/${encodeURIComponent(it.w)}">Mở trong từ điển: nét viết, chữ cấu thành →</a>` : ""}
  </div>`;
}

// ---------------- views ----------------
const VIEWS = {};
function setView(html) { $("#view").innerHTML = html; }
async function handleSyncSetup(rawHash) {
  const queryStr = rawHash.includes("?") ? rawHash.slice(rawHash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(queryStr);
  const token = params.get("t");
  const gistId = params.get("g");
  if (token && gistId) {
    history.replaceState(null, "", location.pathname + "#cai-dat");
    setView(`<section class="view"><div class="panel center"><h2 class="h2">Đang kết nối đồng bộ...</h2><p class="lead">Đang thiết lập đồng bộ tiến độ từ máy tính sang điện thoại của bạn...</p><div class="sync-spin" style="font-size: 32px; margin: 16px 0;">🔄</div></div></section>`);
    try {
      await Sync.connectWithToken(token, gistId);
      alert("🎉 Kết nối đồng bộ thành công!\n\nĐiện thoại và máy tính của bạn đã được kết nối cùng tiến độ học. Từ bây giờ mỗi khi bạn học, dữ liệu sẽ tự động đồng bộ 2 chiều.");
      route();
    } catch (err) {
      alert("Lỗi khi kết nối đồng bộ: " + err.message);
      route();
    }
  } else {
    location.hash = "#cai-dat";
  }
}
function route() {
  const rawHash = location.hash.slice(1);
  if (rawHash.startsWith("sync-setup")) {
    handleSyncSetup(rawHash);
    return;
  }
  let h = decodeURIComponent(rawHash || "trang-chu");
  if (h === "tra-tu") h = "tu-dien";
  if (h === "tu-vung") h = "thu-muc";
  if (h === "chep-chinh-ta") h = "chinh-ta";
  const [name, ...rest] = h.split("/"); const arg = rest.join("/");
  document.querySelectorAll("[data-view]").forEach((a) => {
    if (a.dataset.view === name || 
       ((name === "tu" || name === "nhap") && a.dataset.view === "tu-dien") ||
       (name === "muc-nho" && a.dataset.view === "trang-chu") ||
       ((name === "thu-muc" || name === "hoc" || name === "loc-nhanh") && a.dataset.view === "thu-muc") ||
       (name === "ngu-phap" && a.dataset.view === "ngu-phap")) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  });
  const fn = VIEWS[name] || VIEWS["trang-chu"];
  if (name !== "hoc") S.session = null;
  fn(arg); window.scrollTo(0, 0); updateBadge();
}
addEventListener("hashchange", route);
function updateBadge() {
  if (!S.ready) return;
  const c = todayCounts().total;
  const b = $("#tabBadge");
  if (b) { b.hidden = !c; b.classList.toggle("hidden", !c); b.textContent = c; }
  const mb = document.querySelector(".tab-badge-mob");
  if (mb) { mb.classList.toggle("hidden", !c); }
}

function studySummary(stats, now) {
  const today = dayKey(now);
  const active = [...stats].filter(([key, value]) => key <= today && value.reviews > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  let previous = -Infinity, run = 0, longest = 0, answers = 0;
  for (const [key, value] of active) {
    const ordinal = Date.parse(key) / DAY;
    run = ordinal === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = ordinal;
    answers += value.reviews;
  }
  const current = Date.parse(today) / DAY - previous <= 1 ? run : 0;
  return { current, longest, activeDays: active.length, answers };
}

function dailyDashboard(c, days) {
  const st = todayStats();
  const summary = studySummary(S.stats, Date.now());
  const metrics = [["Chuỗi hiện tại", summary.current, "ngày"], ["Chuỗi dài nhất", summary.longest, "ngày"],
    ["Tổng ngày học", summary.activeDays, "ngày"], ["Tổng lượt trả lời", summary.answers, "lượt"]];

  const targetNew = Math.max(1, Number(S.settings.newPerDay || 20));
  const targetRev = Math.max(1, Number(S.settings.reviewPerDay || 50));

  // Task 1: Giữ chuỗi ngày học
  const task1Done = st.reviews > 0;
  const task1Pct = task1Done ? 100 : 0;

  // Task 2: Ôn thẻ mỗi ngày
  const reviewedToday = Math.max(0, st.reviews - st.newCards);
  const task2Pct = Math.min(100, Math.round((reviewedToday / targetRev) * 100));
  const task2Done = reviewedToday >= targetRev || (c.due === 0 && reviewedToday > 0);
  let task2Sub = "";
  if (task2Done) {
    task2Sub = reviewedToday >= targetRev
      ? `✓ Đã hoàn thành mục tiêu ôn tập hôm nay (${fmt(reviewedToday)}/${fmt(targetRev)} thẻ)!`
      : `✓ Đã ôn hết thẻ đến hạn trong lịch hôm nay (${fmt(reviewedToday)} thẻ)!`;
  } else if (c.due > 0) {
    task2Sub = `Còn ${fmt(c.due)} thẻ trong lịch hôm nay · Mục tiêu: ${fmt(targetRev)} thẻ`;
  } else {
    task2Sub = `Không còn thẻ đến hạn hôm nay · Đã ôn ${fmt(reviewedToday)}/${fmt(targetRev)} thẻ`;
  }
  const task2Remaining = reviewedToday >= targetRev
    ? `✓ Đạt ${fmt(reviewedToday)} thẻ`
    : `Còn thiếu ${fmt(targetRev - reviewedToday)} thẻ ôn`;

  // Task 3: Học thẻ mới
  const task3Pct = Math.min(100, Math.round((st.newCards / targetNew) * 100));
  const task3Done = st.newCards >= targetNew || (c.fresh === 0 && st.newCards > 0);
  let task3Sub = "";
  if (st.newCards >= targetNew) {
    task3Sub = `✓ Đã hoàn thành chỉ tiêu thẻ mới hôm nay (${fmt(st.newCards)}/${fmt(targetNew)} thẻ)!`;
  } else if (c.fresh > 0) {
    task3Sub = `Còn ${fmt(c.fresh)} thẻ mới chờ trong lịch hôm nay · Mục tiêu: ${fmt(targetNew)} thẻ`;
  } else if (st.newCards === 0 && c.fresh === 0) {
    task3Sub = `Hôm nay không có thẻ mới trong lịch (hãy bật thêm band trong Thư mục)`;
  } else {
    task3Sub = `Đã học hết thẻ mới hôm nay · ${fmt(st.newCards)}/${fmt(targetNew)} thẻ`;
  }
  const task3Remaining = st.newCards >= targetNew
    ? `✓ Đạt ${fmt(st.newCards)} thẻ`
    : `Còn thiếu ${fmt(targetNew - st.newCards)} thẻ mới`;

  const completedCount = (task1Done ? 1 : 0) + (task2Done ? 1 : 0) + (task3Done ? 1 : 0);
  const overallPct = Math.round((task1Pct + task2Pct + task3Pct) / 3);

  return `<section class="panel daily-panel">
    <div class="daily-head">
      <div class="daily-title-group">
        <h2 class="h2">Lộ trình hôm nay</h2>
        <span class="daily-badge-pct ${completedCount === 3 ? "done" : ""}">${completedCount}/3 nhiệm vụ (${overallPct}%)</span>
      </div>
      <button type="button" class="btn-goal-settings" id="btnToggleGoalEdit" title="Tự đặt mục tiêu thẻ mới và thẻ ôn mỗi ngày">
        ⚙️ Đặt mục tiêu
      </button>
    </div>

    <!-- Overall Progress Bar -->
    <div class="daily-overall-bar" title="Tiến độ lộ trình tổng thể: ${overallPct}%">
      <div class="daily-overall-fill" style="width:${overallPct}%"></div>
    </div>

    <!-- Goal Setting Box (collapsible) -->
    <div id="goalEditBox" class="goal-edit-box" style="display:none;">
      <div class="goal-edit-title"><b>🎯 Thiết lập mục tiêu hàng ngày của bạn</b></div>
      <div class="goal-inputs-grid">
        <div class="goal-field">
          <label for="goalNewCards">Thẻ mới mỗi ngày:</label>
          <div class="goal-input-stepper">
            <button type="button" class="btn-stepper" data-step="new" data-delta="-5">−</button>
            <input type="number" id="goalNewCards" min="5" max="100" step="5" value="${targetNew}">
            <button type="button" class="btn-stepper" data-step="new" data-delta="5">+</button>
          </div>
          <small class="sub">Số từ mới bắt đầu học mỗi ngày</small>
        </div>

        <div class="goal-field">
          <label for="goalReviewCards">Thẻ ôn tập mỗi ngày:</label>
          <div class="goal-input-stepper">
            <button type="button" class="btn-stepper" data-step="rev" data-delta="-10">−</button>
            <input type="number" id="goalReviewCards" min="10" max="300" step="10" value="${targetRev}">
            <button type="button" class="btn-stepper" data-step="rev" data-delta="10">+</button>
          </div>
          <small class="sub">Số lượt ôn lại các thẻ đã học mỗi ngày</small>
        </div>
      </div>

      <div class="goal-presets">
        <span>Gợi ý nhanh:</span>
        <button type="button" class="btn-preset" data-new="10" data-rev="30">Nhẹ nhàng (10 mới / 30 ôn)</button>
        <button type="button" class="btn-preset" data-new="20" data-rev="50">Tiêu chuẩn (20 mới / 50 ôn)</button>
        <button type="button" class="btn-preset" data-new="30" data-rev="100">Bứt phá (30 mới / 100 ôn)</button>
      </div>

      <div class="goal-edit-actions">
        <button type="button" class="primary btn-sm" id="btnSaveGoal">Lưu mục tiêu</button>
        <button type="button" class="btn-sm link" id="btnCancelGoal">Đóng</button>
        <span id="goalSaveMsg" class="msg-inline"></span>
      </div>
    </div>

    <!-- 3 Task Cards with Progress Bars -->
    <div class="daily-tasks-list">
      <!-- Task 1: Chuỗi ngày học -->
      <div class="task-card ${task1Done ? "is-done" : ""}">
        <div class="task-card-header">
          <div class="task-info">
            <div class="task-name">
              <span class="task-icon">🔥</span>
              <b>Giữ chuỗi ngày học</b>
            </div>
            <div class="task-sub">${task1Done ? "✓ Đã trả lời thẻ hôm nay, chuỗi được giữ vững!" : "Trả lời ít nhất 1 thẻ trong mục Học để không đứt chuỗi"}</div>
          </div>
          <div class="task-stat">
            <span class="task-fraction">${task1Done ? "1 / 1" : "0 / 1"}</span>
            ${task1Done ? '<span class="task-check-badge">✓ Xong</span>' : '<a class="task-action-btn" href="#hoc">Học ngay</a>'}
          </div>
        </div>
        <div class="task-prog-bar">
          <div class="task-prog-fill fill-streak" style="width:${task1Pct}%"></div>
        </div>
      </div>

      <!-- Task 2: Ôn thẻ mỗi ngày -->
      <div class="task-card ${task2Done ? "is-done" : ""}">
        <div class="task-card-header">
          <div class="task-info">
            <div class="task-name">
              <span class="task-icon">🔄</span>
              <b>Ôn thẻ mỗi ngày</b>
            </div>
            <div class="task-sub">${task2Sub}</div>
          </div>
          <div class="task-stat">
            <span class="task-fraction"><b>${fmt(reviewedToday)}</b> / ${fmt(targetRev)} thẻ</span>
            ${task2Done ? '<span class="task-check-badge">✓ Đạt</span>' : (c.due ? '<a class="task-action-btn" href="#hoc">Ôn ngay</a>' : '<span class="task-check-badge">Hết thẻ</span>')}
          </div>
        </div>
        <div class="task-prog-bar">
          <div class="task-prog-fill fill-review" style="width:${task2Pct}%"></div>
        </div>
        <div class="task-bar-meta">
          <span>Tiến độ: <b>${task2Pct}%</b></span>
          <span>${task2Remaining}</span>
        </div>
      </div>

      <!-- Task 3: Học thẻ mới -->
      <div class="task-card ${task3Done ? "is-done" : ""}">
        <div class="task-card-header">
          <div class="task-info">
            <div class="task-name">
              <span class="task-icon">✨</span>
              <b>Học thẻ mới</b>
            </div>
            <div class="task-sub">${task3Sub}</div>
          </div>
          <div class="task-stat">
            <span class="task-fraction"><b>${fmt(st.newCards)}</b> / ${fmt(targetNew)} thẻ mới</span>
            ${task3Done ? '<span class="task-check-badge">✓ Đạt</span>' : (c.fresh ? '<a class="task-action-btn" href="#hoc">Học mới</a>' : '<span class="task-check-badge">Hết mới</span>')}
          </div>
        </div>
        <div class="task-prog-bar">
          <div class="task-prog-fill fill-new" style="width:${task3Pct}%"></div>
        </div>
        <div class="task-bar-meta">
          <span>Tiến độ: <b>${task3Pct}%</b></span>
          <span>${task3Remaining}</span>
        </div>
      </div>
    </div>
  </section><section class="panel"><h2 class="h2">Chuỗi ngày học</h2>
    <div class="study-metrics">${metrics.map(([label, value, unit]) => `<div><span>${label}</span><strong>${fmt(value)} ${unit}</strong></div>`).join("")}</div>
    <p class="sub">Mỗi ngày có ít nhất một lượt trả lời thẻ được tính vào chuỗi. Ngày học mới bắt đầu lúc 04:00.</p>
    <details class="more"><summary>Chi tiết 14 ngày gần nhất</summary>
      <table class="study-history"><thead><tr><th>Ngày</th><th>Lượt trả lời</th><th>Thẻ mới</th><th>Lượt Quên</th></tr></thead><tbody>
      ${days.slice().reverse().map(([key, date]) => { const row = S.stats.get(key) || {};
        return `<tr><th scope="row"><time datetime="${key}">${date.getDate()}/${date.getMonth()+1}</time></th><td>${fmt(row.reviews || 0)}</td><td>${fmt(row.newCards || 0)}</td><td>${fmt(row.again || 0)}</td></tr>`;
      }).join("")}</tbody></table>
    </details></section>`;
}

// --- Trang chủ ---


function folderNotes(id) {
  if (S.bands.includes(id)) return S.notes.filter((n) => n.kind === "vocab" && inBand(n, id));
  if (id === "cua-toi") return S.notes.filter((n) => n.rich || (S.settings && S.settings.extra && S.settings.extra[n.w]) || (S.inbox && [...S.inbox.values()].some(x => x.w === n.w)));
  if (id === "viet-tat") { const set = new Set(); for (const w of (S.abbrS ? S.abbrS.keys() : [])) { const n = S.noteByWord.get(w); if (n) set.add(n); } return [...set]; }
  return S.notes.filter((n) => n.rich && n.deck && n.deck.id === id);
}
function folderOn(id) {
  if (!S.settings) S.settings = {};
  if (!S.settings.bands) S.settings.bands = {};
  if (!S.settings.decks) S.settings.decks = {};
  if (S.bands.includes(id)) return !!S.settings.bands[id];
  if (id === "cua-toi") return (S.decks || []).every((d) => deckOn(d.id));
  if (id === "viet-tat") return folderNotes(id).every(inLearning);
  return deckOn(id);
}
function setFolderOn(id, v) {
  if (!S.settings) S.settings = {};
  if (!S.settings.bands) S.settings.bands = {};
  if (!S.settings.decks) S.settings.decks = {};
  if (!S.settings.extra) S.settings.extra = {};
  if (S.bands.includes(id)) S.settings.bands[id] = v;
  else if (id === "cua-toi") for (const d of (S.decks || [])) S.settings.decks[d.id] = v;
  else if (id === "viet-tat") { for (const n of folderNotes(id)) { if (n.rich) S.settings.decks[n.deck.id] = v || deckOn(n.deck.id); else if (v) S.settings.extra[n.w] = true; else delete S.settings.extra[n.w]; } }
  else S.settings.decks[id] = v;
}
const hasProgress = (n) => typesOf(n).some(([t]) => (S.cards && S.cards.has(cardId(n, t))) || (S.srs && S.srs.has(cardId(n, t))));

nextCard = function(now) {
  const q = buildQueue(now);
  const ss = S.session;
  const last = ss && ss.lastNote;
  const mode = (ss && ss.mode) || "all";
  const pick = (arr) => arr.find((r) => r.n.key !== last) || arr[0];

  if (ss && ss.folderFilter) {
    const fNotes = folderNotes(ss.folderFilter);
    const fKeys = new Set(fNotes.map((n) => n.key));
    const fDueLearn = q.learn.filter((r) => fKeys.has(r.n.key) && r.s.due <= now);
    if (fDueLearn.length) return pick(fDueLearn);
    const fReview = q.review.filter((r) => fKeys.has(r.n.key));
    if (fReview.length) return pick(fReview);
    const fFresh = [];
    for (const n of fNotes) {
      const types = typesOf(n);
      const firstId = cardId(n, types[0][0]);
      const firstS = S.srs && S.srs.get(firstId);
      if (!firstS || firstS.state === "new") {
        fFresh.push({ id: firstId, n, t: types[0][0], s: null });
      }
    }
    if (fFresh.length) return pick(fFresh);
    const fAhead = q.learn.filter((r) => fKeys.has(r.n.key) && r.s.due <= now + 20 * MIN);
    return fAhead[0] || null;
  }

  const dueLearn = q.learn.filter((r) => r.s.due <= now);
  if (mode === "new") {
    const newKeys = ss && ss.newKeys;
    const newDueLearn = newKeys ? dueLearn.filter((r) => newKeys.has(r.n.key)) : [];
    if (newDueLearn.length) return pick(newDueLearn);
    if (q.fresh.length) return pick(q.fresh);
    const newAhead = newKeys ? q.learn.filter((r) => newKeys.has(r.n.key) && r.s.due <= now + 20 * MIN) : [];
    return newAhead[0] || null;
  }
  if (mode === "review") {
    if (dueLearn.length) return pick(dueLearn);
    if (q.review.length) return pick(q.review);
    const ahead = q.learn.filter((r) => r.s.due <= now + 20 * MIN);
    return ahead[0] || null;
  }

  if (dueLearn.length) return pick(dueLearn);
  if (q.review.length) return pick(q.review);
  if (q.fresh.length) return pick(q.fresh);
  const ahead = q.learn.filter((r) => r.s.due <= now + 20 * MIN);
  return ahead[0] || null;
};

function startStudyFolder(folderId) {
  const notes = folderNotes(folderId);
  const now = Date.now();
  S.session = { folderFilter: folderId, answered: 0, shown: false, start: notes.length, lastNote: null, mode: "all", newKeys: new Set() };
  const card = nextCard(now);
  if (card) {
    S.session.current = card;
  } else if (notes.length) {
    const n = notes[0];
    const t0 = typesOf(n)[0][0];
    const s = (S.srs && S.srs.get(cardId(n, t0))) || freshState();
    S.session.current = { n, t: t0, s };
  }
  location.hash = "#hoc";
}
window.startStudyFolder = startStudyFolder;

// --- Inbox & Learning Auto-Sync ---
function syncInboxWordToLearning(entry, scheduleNow = false) {
  if (!entry || !entry.w) return null;
  const w = entry.w;
  if (!S.settings.extra) S.settings.extra = {};
  S.settings.extra[w] = true;

  let note = S.noteByWord.get(w);
  if (!note) {
    const viInfo = (S.vi && S.vi.get(w)) || {};
    const py = entry.py || viInfo.py || (typeof cedFirst === "function" && cedFirst(w) ? cedFirst(w)[0][0] : "");
    const vn = entry.note || viInfo.vn || (typeof cedFirst === "function" && cedFirst(w) ? cedFirst(w)[0][1].split("/").join("; ") : "");
    note = {
      key: `t~${w}`,
      kind: "vocab",
      basic: true,
      inbox: true,
      w: w,
      forms: [w],
      display: w,
      py: py,
      band: "Hộp thư",
      bands: new Set(["Hộp thư"]),
      pos: "N",
      theme: entry.where || "Hộp thư",
      idx: entry.at || Date.now()
    };
    S.notes.push(note);
    S.noteByKey.set(note.key, note);
    S.noteByWord.set(w, note);
    if (S.vi && !S.vi.has(w)) {
      S.vi.set(w, { vn, py, hv: "" });
    }
  } else {
    if (entry.where && !note.theme) note.theme = entry.where;
  }

  if (scheduleNow) {
    const now = Date.now();
    const types = typesOf(note);
    const entries = [];
    for (const [t] of types) {
      const cid = cardId(note, t);
      const prev = S.srs ? S.srs.get(cid) : null;
      const next = typeof scheduleLevel === "function" ? scheduleLevel(prev, 1, now) : { due: now, ivl: 0, reps: 0, ease: 250, lapses: 0, state: 0 };
      next.w = note.w;
      next.due = now; // Ready to study immediately!
      next.firstSeen = next.firstSeen || (prev && (prev.firstSeen || prev.last)) || now;
      entries.push([cid, next]);
      if (S.srs) S.srs.set(cid, next);
      if (S.cards) S.cards.set(cid, next);
    }
    const key = dayKey(now);
    const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats.get(key));
    st.reviews++;
    st.newCards++;
    S.stats.set(key, st);

    Promise.all([
      Store.putMany("srs", entries),
      Store.put("stats", key, st),
      Store.put("settings", "user", S.settings)
    ]).then(() => {
      updateBadge();
      if (window.Sync && typeof Sync.onCardGraded === "function") Sync.onCardGraded();
    }).catch(() => {});
  }
  return note;
}

function syncAllInboxNotes() {
  if (!S.inbox) return;
  for (const [id, entry] of S.inbox) {
    if (entry && entry.w) syncInboxWordToLearning(entry, false);
  }
  updateBadge();
}

function startStudyWord(word) {
  const n = S.noteByWord.get(word);
  if (!n) return;
  const now = Date.now();
  const s = (S.cards && S.cards.get(cardId(n, "recog"))) || { due: now, ivl: 0, reps: 0, ease: 250, lapses: 0, state: 0 };
  S.session = {
    folderFilter: null,
    current: { n, t: "recog", s },
    count: 0,
    done: 0
  };
  location.hash = "#hoc";
}

window.syncInboxWordToLearning = syncInboxWordToLearning;
window.syncAllInboxNotes = syncAllInboxNotes;
window.startStudyWord = startStudyWord;

function allSentences() {
  const out = [];
  for (const n of S.notes.values()) {
    const it = itemOf(n);
    for (const k of n.kind === "grammar" ? [1, 2, 3] : [1, 2]) if (it["e" + k]) out.push({ zh: it["e" + k], py: it["e" + k + "p"], vn: it["e" + k + "v"], src: n.rich ? (n.deck && n.deck.name || "Cá nhân") : bandLabel(n), own: true, note: n });
  }
  for (const p of S.packs || []) for (const s of p.sentences || []) out.push({ zh: s.zh, py: s.py || "", vn: s.vn || "", src: s.src || p.name, pack: p.name });
  return out;
}
function weightOf(tokens) {
  let w = 0;
  for (const k of tokens) if (k.n) { const l = noteLevel(k.n); if (l > 0) w += 1 + (5 - l) + Math.min(4, noteLapses(k.n)); }
  return w;
}


// =========================================================================
// 1. TRANG CHỦ (Modern Oriental Scholarly - Exact Stitch Design)
// =========================================================================
VIEWS["trang-chu"] = () => {
  const vocab = S.notes.filter((n) => n.kind === "vocab");
  const lv = [0, 0, 0, 0, 0, 0];
  for (const n of vocab) lv[noteLevel(n)]++;
  const learned = vocab.length - lv[0];
  const c = todayCounts();
  const st = todayStats();
  const summary = studySummary(S.stats, Date.now());

  const targetNew = Math.max(1, Number(S.settings.newPerDay || 8));
  const targetRev = Math.max(1, Number(S.settings.reviewPerDay || 30));
  const totalGoal = targetNew + targetRev;
  const reviewedToday = Math.max(0, st.reviews - st.newCards);
  const doneToday = st.reviews;
  const pctOverall = Math.min(100, Math.round((doneToday / Math.max(1, totalGoal)) * 100));
  const studyMinutes = Math.max(1, Math.round(st.reviews * 0.45));
  const estMinutes = Math.max(5, Math.round(c.total * 0.25));

  // 3 Tasks Progress Calculations
  const task1Done = st.reviews > 0;
  const task1Pct = task1Done ? 100 : 0;

  const task2Pct = Math.min(100, Math.round((reviewedToday / targetRev) * 100));
  const task2Done = reviewedToday >= targetRev || (c.due === 0 && reviewedToday > 0);

  const task3Pct = Math.min(100, Math.round((st.newCards / targetNew) * 100));
  const task3Done = st.newCards >= targetNew || (c.fresh === 0 && st.newCards > 0);

  // TOCFL B1 stats for Stitch Pathway widget
  const b1Notes = vocab.filter((n) => inBand(n, "B1"));
  const b1Total = Math.max(1, b1Notes.length);
  const b1Learned = b1Notes.filter((n) => noteLevel(n) > 0).length;
  const b1Pct = Math.round((b1Learned / b1Total) * 100);
  const b1Remain = Math.max(0, b1Total - b1Learned);

  // 30 days matrix for Stitch Heatmap (3 rows x 10 cols = 30 days)
  const today = new Date(dayStart(Date.now()));
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - 29 + i);
    const key = dayKey(d);
    const revs = (S.stats.get(key) || {}).reviews || 0;
    const isToday = i === 29;
    return { key, date: String(d.getDate()).padStart(2, "0"), month: d.getMonth() + 1, revs, isToday };
  });
  const monthTotalRevs = days30.reduce((acc, d) => acc + d.revs, 0);
  const activeDays30 = days30.filter((d) => d.revs > 0).length;
  const habitPct = Math.round((activeDays30 / 30) * 1000) / 10;

  // Weak words count
  let weakCount = 0;
  for (const n of vocab) {
    if ((n.lapses || 0) > 0 || noteLevel(n) === 1) weakCount++;
  }

  // TOCFL Band progress breakdown
  const bandList = ["Novice 1", "Novice 2", "A1", "A2", "B1", "B2", "C"];
  const bandProgressHTML = bandList.map((b) => {
    const ns = vocab.filter((n) => inBand(n, b));
    const l = ns.filter((n) => noteLevel(n) > 0).length;
    const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
    const isLearning = !!S.settings.bands[b];
    return `
      <div class="p-space-md rounded-xl bg-paper-card border border-border-subtle shadow-sm flex flex-col justify-between gap-space-sm hover:shadow-md transition-all">
        <div class="flex items-center justify-between">
          <span class="font-headline-md font-semibold text-on-surface text-base">TOCFL ${b}</span>
          <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${isLearning ? 'bg-jade-subtle text-secondary' : 'bg-surface-container text-on-surface-variant'}">
            ${isLearning ? 'Đang học' : 'Chưa bật'}
          </span>
        </div>
        <div class="text-xs text-on-surface-variant line-clamp-1">
          ${esc(BAND_INFO[b] || '')}
        </div>
        <div class="flex flex-col gap-1.5 mt-1">
          <div class="flex justify-between text-xs font-medium">
            <span class="text-outline font-code">${fmt(l)} / ${fmt(ns.length)} từ</span>
            <span class="text-primary font-bold">${pct}%</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
            <div class="h-full bg-primary-container rounded-full transition-all duration-300" style="width:${pct}%;"></div>
          </div>
        </div>
        <div class="flex items-center justify-between pt-2 border-t border-border-subtle/50 text-xs mt-1">
          <a href="#thu-muc/${encodeURIComponent(b)}" class="text-primary hover:underline font-semibold flex items-center gap-0.5">
            Mở xem từ →
          </a>
          <button type="button" class="text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${isLearning ? 'border-border-subtle hover:bg-surface-container text-on-surface' : 'bg-primary-container text-white border-transparent hover:bg-primary'}" data-toggle-band="${b}">
            ${isLearning ? 'Tạm dừng' : 'Bật học'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  setView(`
    <div class="max-w-7xl mx-auto px-margin w-full py-space-lg flex flex-col gap-space-xl">
      <!-- Top Hero Banner: East Asian Modern Scholar Scroll (Exact Stitch) -->
      <section class="relative w-full rounded-xl overflow-hidden bg-surface-container-low shadow-sm border border-border-subtle/60">
        <div class="absolute -right-16 -bottom-16 w-80 h-80 rounded-full bg-primary-container/5 blur-3xl pointer-events-none"></div>
        <div class="absolute -left-10 -top-10 w-64 h-64 rounded-full bg-secondary/5 blur-2xl pointer-events-none"></div>
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg p-space-lg lg:p-space-xl items-center relative z-10">
          <!-- Calligraphic Quote Block -->
          <div class="lg:col-span-8 flex flex-col gap-space-md">
            <div class="flex items-center gap-space-sm flex-wrap">
              <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
              <span class="font-label-sm text-label-sm text-primary uppercase tracking-widest font-semibold">Khởi tâm mỗi ngày • 每日格言</span>
              <span class="px-space-xs py-0.5 rounded-full bg-cinnabar-subtle text-primary font-code text-code text-[11px]">Luận Ngữ • Học Nhi</span>
            </div>
            <div class="flex flex-col gap-space-xs">
              <div class="flex items-center gap-3 flex-wrap">
                <h1 class="font-display text-3xl md:text-5xl text-on-surface tracking-wide leading-tight font-bold">
                  學而時習之，不亦說乎
                </h1>
                <button type="button" class="w-9 h-9 rounded-full bg-cinnabar-subtle text-primary hover:bg-primary hover:text-white flex items-center justify-center transition-all shadow-xs" onclick="if(typeof say==='function') say('學而時習之，不亦說乎')" title="Phát âm câu cách ngôn">
                  <span class="material-symbols-outlined text-[20px]">volume_up</span>
                </button>
              </div>
              <p class="font-code text-body-md text-primary font-medium tracking-wide">
                Xué ér shí xí zhī, bù yì yuè hū?
              </p>
              <p class="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mt-1">
                "Học tập rồi thường xuyên ôn luyện lại, chẳng cũng vui thích lắm sao?"
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-space-md pt-space-xs">
              <div class="flex items-center gap-space-xs bg-paper-card px-space-md py-space-xs rounded-full shadow-sm border border-border-subtle/50">
                <span class="material-symbols-outlined text-[18px] text-tertiary">local_fire_department</span>
                <span class="font-label-md text-label-md text-on-surface">Đạt chuỗi <strong class="text-primary font-semibold">${summary.current} ngày</strong> chuyên cần</span>
              </div>
              <div class="flex items-center gap-space-xs bg-paper-card px-space-md py-space-xs rounded-full shadow-sm border border-border-subtle/50">
                <span class="material-symbols-outlined text-[18px] text-secondary">verified</span>
                <span class="font-label-md text-label-md text-on-surface">Mục tiêu: <strong class="text-secondary font-semibold">TOCFL B1 (Band 3)</strong></span>
              </div>
            </div>
          </div>
          <!-- Visual Mini Seal & Traditional Taiwanese Motif Card -->
          <div class="lg:col-span-4 flex justify-center lg:justify-end">
            <div class="relative w-full max-w-[280px] p-space-md rounded-xl bg-paper-card shadow-sm border border-border-subtle/60 flex flex-col gap-space-sm items-center text-center">
              <div class="w-full h-32 rounded-lg overflow-hidden relative shadow-inner bg-gradient-to-br from-[#86090a] via-[#a8261f] to-[#176b4b]">
                <img class="w-full h-full object-cover" alt="Traditional Taiwanese scholar academy" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDNrrJS5EWvXrfUfuqf6jRirtcPq8A0T9qskRMGVNUhyBYYX96nFGt7OnHUCJEtD0U0DDWu2wL17K6ib1DMsrYW6kq-V0DxW2-4ONeKvCxjTBS3dDNz4snVBmHqxJtFiQykCNVZK91j2eTjWjdoBftFeg43DtoNilEWexOB9xGWtcBMDHgj3GyjeIw4__p-RPkrwDxIYtMzmvGI_BDf9tNZ-l8NJyMPApV76iWTy1xc" onerror="this.style.display='none'">
                <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
                <div class="absolute bottom-2 left-3 text-left">
                  <span class="font-headline-md text-headline-md text-white font-semibold">臺灣華語</span>
                  <p class="font-label-sm text-label-sm text-white/90">Phồn thể Đài Bắc • 拼音</p>
                </div>
              </div>
              <div class="w-full flex items-center justify-between px-space-xs pt-1">
                <span class="font-label-sm text-label-sm text-outline">Phiên âm song song</span>
                <span class="inline-flex items-center gap-1 font-code text-code text-on-surface-variant font-medium bg-paper-muted px-2 py-0.5 rounded">Pīnyīn</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Key Metrics Bento Row (Exact Stitch 4 Cards) -->
      <section class="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
        <!-- Metric 1: Streak -->
        <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div class="flex items-center justify-between">
            <span class="font-label-md text-label-md text-on-surface-variant">Chuỗi liên tục</span>
            <div class="w-9 h-9 rounded-lg bg-cinnabar-subtle flex items-center justify-center">
              <span class="material-symbols-outlined text-[20px] text-primary" style="font-variation-settings: 'FILL' 1;">local_fire_department</span>
            </div>
          </div>
          <div class="mt-space-md">
            <div class="flex items-baseline gap-space-xs">
              <span class="font-display text-display text-on-surface">${summary.current}</span>
              <span class="font-label-md text-label-md text-on-surface-variant font-medium">ngày</span>
            </div>
            <p class="font-body-sm text-body-sm text-secondary mt-1 flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">trending_up</span> Kỷ lục cá nhân: ${summary.longest} ngày
            </p>
          </div>
        </div>
        <!-- Metric 2: Mastered Words -->
        <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div class="flex items-center justify-between">
            <span class="font-label-md text-label-md text-on-surface-variant">Tổng từ đã thuộc</span>
            <div class="w-9 h-9 rounded-lg bg-jade-subtle flex items-center justify-center">
              <span class="material-symbols-outlined text-[20px] text-secondary" style="font-variation-settings: 'FILL' 1;">auto_stories</span>
            </div>
          </div>
          <div class="mt-space-md">
            <div class="flex items-baseline gap-space-xs">
              <span class="font-display text-display text-on-surface">${fmt(learned)}</span>
              <span class="font-label-md text-label-md text-on-surface-variant font-medium">từ vựng</span>
            </div>
            <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">
              ${fmt(lv[4] + lv[5])} từ mức nhớ lâu & thông thạo
            </p>
          </div>
        </div>
        <!-- Metric 3: Today's Target -->
        <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div class="flex items-center justify-between">
            <span class="font-label-md text-label-md text-on-surface-variant">Mục tiêu hôm nay</span>
            <div class="w-9 h-9 rounded-lg bg-amber-subtle flex items-center justify-center">
              <span class="material-symbols-outlined text-[20px] text-tertiary" style="font-variation-settings: 'FILL' 1;">pie_chart</span>
            </div>
          </div>
          <div class="mt-space-md">
            <div class="flex items-baseline justify-between">
              <div class="flex items-baseline gap-space-xs">
                <span class="font-display text-display text-on-surface">${pctOverall}</span>
                <span class="font-label-md text-label-md text-on-surface-variant font-medium">%</span>
              </div>
              <span class="font-code text-body-sm text-on-surface-variant">${fmt(doneToday)}/${fmt(totalGoal)} thẻ</span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-surface-container mt-2 overflow-hidden">
              <div class="h-full bg-primary-container rounded-full transition-all duration-500" style="width: ${pctOverall}%;"></div>
            </div>
          </div>
        </div>
        <!-- Metric 4: Daily Study Time -->
        <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div class="flex items-center justify-between">
            <span class="font-label-md text-label-md text-on-surface-variant">Thời gian hôm nay</span>
            <div class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center">
              <span class="material-symbols-outlined text-[20px] text-on-surface-variant">timer</span>
            </div>
          </div>
          <div class="mt-space-md">
            <div class="flex items-baseline gap-space-xs">
              <span class="font-display text-display text-on-surface">${studyMinutes}</span>
              <span class="font-label-md text-label-md text-on-surface-variant font-medium">phút</span>
            </div>
            <p class="font-body-sm text-body-sm text-secondary mt-1 flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">check_circle</span> Tổng ${fmt(summary.answers)} câu đã ôn
            </p>
          </div>
        </div>
      </section>

      <!-- Main Dual Panel: Action Center (7 cols) + TOCFL Pathway Progress Widget (5 cols) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-stretch">
        <!-- Primary Action: SRS Quick Launch -->
        <section class="lg:col-span-7 p-space-lg lg:p-space-xl rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between gap-space-md">
          <div class="flex flex-col gap-space-md">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-space-sm">
                <span class="w-1 h-4 rounded-full bg-primary-container"></span>
                <h2 class="font-headline-md text-headline-md text-on-surface">Bắt đầu học ngay</h2>
              </div>
              <span class="font-label-sm text-label-sm text-secondary font-semibold bg-jade-subtle px-space-sm py-0.5 rounded-full flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> Sẵn sàng ôn luyện
              </span>
            </div>
            <p class="font-body-md text-body-md text-on-surface-variant">
              Thuật toán Lặp lại ngắt quãng (Spaced Repetition) đã phân bổ tập thẻ tối ưu cho nhịp sinh học hôm nay của bạn.
            </p>
            <!-- Card Count Visual Breakdown -->
            <div class="grid grid-cols-3 gap-space-sm my-space-xs">
              <div class="p-space-md rounded-lg bg-cinnabar-subtle flex flex-col">
                <span class="font-label-sm text-label-sm text-primary font-semibold">TỪ MỚI</span>
                <span class="font-headline-lg text-headline-lg text-primary font-semibold mt-1">${fmt(c.fresh)}</span>
                <span class="font-body-sm text-body-sm text-on-surface-variant">Mục tiêu: ${fmt(targetNew)}/ngày</span>
              </div>
              <div class="p-space-md rounded-lg bg-amber-subtle flex flex-col">
                <span class="font-label-sm text-label-sm text-tertiary font-semibold">CẦN ÔN TẬP</span>
                <span class="font-headline-lg text-headline-lg text-tertiary font-semibold mt-1">${fmt(c.due)}</span>
                <span class="font-body-sm text-body-sm text-on-surface-variant">Đến hạn nhắc lại</span>
              </div>
              <div class="p-space-md rounded-lg bg-paper-muted flex flex-col">
                <span class="font-label-sm text-label-sm text-on-surface font-semibold">TỔNG CỘNG</span>
                <span class="font-headline-lg text-headline-lg text-on-surface font-semibold mt-1">${fmt(c.total)}</span>
                <span class="font-body-sm text-body-sm text-on-surface-variant">Ước tính: ${estMinutes} phút</span>
              </div>
            </div>
          </div>

          <div class="pt-space-sm flex flex-col sm:flex-row items-center gap-space-md">
            <button type="button" class="w-full sm:w-auto flex-1 h-12 px-space-xl rounded-lg bg-primary-container text-on-primary font-label-md text-label-md font-semibold hover:bg-primary transition-all duration-200 shadow-sm flex items-center justify-center gap-space-sm" id="btn-start-study">
              <span class="material-symbols-outlined text-[20px]">play_circle</span>
              <span>Bắt đầu ôn tập (${fmt(c.total)} thẻ)</span>
            </button>
            <button type="button" class="w-full sm:w-auto h-12 px-space-lg rounded-lg bg-paper-muted text-on-surface font-label-md text-label-md font-medium hover:bg-surface-container-high transition-colors flex items-center justify-center gap-space-xs" id="btnToggleGoalEdit">
              <span class="material-symbols-outlined text-[18px] text-outline">tune</span>
              <span>Tùy chỉnh số lượng</span>
            </button>
          </div>

          <!-- Collapsible Goal Edit Box -->
          <div class="p-space-md rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-space-md" id="goalEditBox" hidden>
            <div class="flex items-center justify-between">
              <span class="font-label-md text-sm font-semibold text-on-surface">Đặt mục tiêu học tập mỗi ngày:</span>
              <span class="text-xs text-outline">Tự do tăng/giảm thẻ theo thời gian của bạn</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
              <div class="bg-paper-card p-3 rounded-xl border border-border-subtle flex flex-col gap-2">
                <label class="text-xs font-semibold text-on-surface-variant">Thẻ mới mỗi ngày (tối đa 200):</label>
                <div class="flex items-center gap-2">
                  <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-cinnabar-subtle text-primary font-bold text-base flex items-center justify-center btn-stepper" data-step="new" data-delta="-5">-</button>
                  <input type="number" id="goalNewCards" min="1" max="200" value="${targetNew}" class="flex-1 py-1 px-3 text-center rounded-lg border border-border-subtle font-code font-bold text-primary text-base">
                  <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-cinnabar-subtle text-primary font-bold text-base flex items-center justify-center btn-stepper" data-step="new" data-delta="5">+</button>
                </div>
              </div>
              <div class="bg-paper-card p-3 rounded-xl border border-border-subtle flex flex-col gap-2">
                <label class="text-xs font-semibold text-on-surface-variant">Chỉ tiêu ôn thẻ mỗi ngày (tối đa 500):</label>
                <div class="flex items-center gap-2">
                  <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-jade-subtle text-secondary font-bold text-base flex items-center justify-center btn-stepper" data-step="rev" data-delta="-10">-</button>
                  <input type="number" id="goalReviewCards" min="5" max="500" value="${targetRev}" class="flex-1 py-1 px-3 text-center rounded-lg border border-border-subtle font-code font-bold text-secondary text-base">
                  <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-jade-subtle text-secondary font-bold text-base flex items-center justify-center btn-stepper" data-step="rev" data-delta="10">+</button>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap text-xs">
              <span class="text-outline font-medium">Gợi ý nhanh:</span>
              <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-card hover:bg-secondary-fixed text-secondary border border-secondary/30 btn-preset font-semibold" data-new="8" data-rev="30">🎯 Band B Khuyến nghị (8 mới / 30 ôn)</button>
              <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-card hover:bg-surface-container text-on-surface border border-border-subtle btn-preset" data-new="5" data-rev="20">🌱 Nhẹ nhàng (5 mới / 20 ôn)</button>
              <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-card hover:bg-surface-container text-primary border border-primary/30 btn-preset" data-new="15" data-rev="50">🚀 Tăng tốc (15 mới / 50 ôn)</button>
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-border-subtle">
              <span class="text-xs text-secondary font-semibold" id="goalSaveMsg"></span>
              <div class="flex items-center gap-2">
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-medium text-outline hover:text-on-surface" id="btnCancelGoal">Đóng</button>
                <button type="button" class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary-container text-white hover:bg-primary shadow-xs" id="btnSaveGoal">Lưu mục tiêu</button>
              </div>
            </div>
          </div>

          <!-- 3 Compact Daily Missions Row -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-space-sm pt-1 border-t border-border-subtle/50">
            <div class="p-2.5 rounded-lg bg-paper-muted/70 flex items-center justify-between text-xs">
              <span class="font-medium text-on-surface">1. Giữ chuỗi (${summary.current}d)</span>
              <span class="font-code font-bold ${task1Done ? 'text-secondary' : 'text-primary'}">${task1Pct}%</span>
            </div>
            <div class="p-2.5 rounded-lg bg-paper-muted/70 flex items-center justify-between text-xs">
              <span class="font-medium text-on-surface">2. Ôn thẻ (${reviewedToday}/${targetRev})</span>
              <span class="font-code font-bold ${task2Done ? 'text-secondary' : 'text-primary'}">${task2Pct}%</span>
            </div>
            <div class="p-2.5 rounded-lg bg-paper-muted/70 flex items-center justify-between text-xs">
              <span class="font-medium text-on-surface">3. Từ mới (${st.newCards}/${targetNew})</span>
              <span class="font-code font-bold ${task3Done ? 'text-secondary' : 'text-primary'}">${task3Pct}%</span>
            </div>
          </div>
        </section>

        <!-- TOCFL Pathway Progress Widget (Exact Stitch 5 cols) -->
        <section class="lg:col-span-5 p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between">
          <div class="flex flex-col gap-space-md">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-space-sm">
                <span class="w-1 h-4 rounded-full bg-secondary"></span>
                <h2 class="font-headline-md text-headline-md text-on-surface">Lộ trình TOCFL</h2>
              </div>
              <span class="font-code text-code text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">Band B • Tiến cấp</span>
            </div>
            <div class="p-space-md rounded-lg bg-surface-container-low flex flex-col gap-space-sm">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-space-xs">
                  <span class="w-6 h-6 rounded bg-primary-container text-on-primary font-code text-code flex items-center justify-center font-semibold">B1</span>
                  <span class="font-label-md text-label-md text-on-surface font-semibold">TOCFL Tiến cấp (Band B1)</span>
                </div>
                <span class="font-code text-body-sm text-primary font-semibold">${b1Pct}%</span>
              </div>
              <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div class="h-full bg-secondary rounded-full transition-all duration-500" style="width: ${b1Pct}%;"></div>
              </div>
              <div class="flex items-center justify-between font-body-sm text-body-sm text-on-surface-variant pt-1">
                <span>Đã hoàn tất: <strong>${fmt(b1Learned)}</strong> / ${fmt(b1Total)} từ</span>
                <span>Còn ${fmt(b1Remain)} từ</span>
              </div>
            </div>
            <!-- Next Milestone Preview -->
            <div class="flex items-center justify-between p-space-md rounded-lg bg-paper-muted">
              <div class="flex items-center gap-space-sm">
                <span class="w-6 h-6 rounded bg-outline text-white font-code text-code flex items-center justify-center font-semibold">B2</span>
                <div class="flex flex-col">
                  <span class="font-label-md text-label-md text-on-surface font-medium">TOCFL Cao cấp (Band B2)</span>
                  <span class="font-body-sm text-body-sm text-outline">Yêu cầu bổ sung ~1,500 từ chuyên sâu</span>
                </div>
              </div>
              <a href="#thu-muc/B2" class="text-primary hover:underline text-xs font-semibold">Mở B2 →</a>
            </div>
          </div>
          <div class="pt-space-md flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px] text-secondary">event</span>
              Mục tiêu trọng tâm: Band B1 & B2
            </span>
            <a class="text-primary hover:underline font-medium" href="#thi-thu">Thi thử CAT →</a>
          </div>
        </section>
      </div>

      <!-- 30-Day Activity Heatmap & Habit Tracker (Exact Stitch 10-col Cinnabar Grid) -->
      <section class="w-full p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
          <div class="flex items-center gap-space-sm">
            <span class="w-1 h-4 rounded-full bg-primary-container"></span>
            <h2 class="font-headline-md text-headline-md text-on-surface">Nhịp điệu học tập 30 ngày qua</h2>
            <span class="font-body-sm text-body-sm text-on-surface-variant hidden md:inline">| Biểu đồ chuyên cần</span>
          </div>
          <div class="flex items-center gap-space-sm text-label-sm font-label-sm text-on-surface-variant">
            <span>Ít</span>
            <span class="w-3 h-3 rounded bg-surface-container"></span>
            <span class="w-3 h-3 rounded bg-cinnabar-subtle"></span>
            <span class="w-3 h-3 rounded bg-primary-fixed-dim"></span>
            <span class="w-3 h-3 rounded bg-primary-container"></span>
            <span>Nhiều (≥ 60 thẻ)</span>
          </div>
        </div>
        <!-- Clean Grid Heatmap Container -->
        <div class="overflow-x-auto pb-1">
          <div class="min-w-[640px] flex flex-col gap-1.5">
            <!-- Days of week indicator -->
            <div class="grid grid-cols-10 gap-1.5 text-center font-code text-[11px] text-outline">
              <span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span><span>T2</span><span>T3</span><span>T4</span>
            </div>
            <!-- 30 squares matrix -->
            <div class="grid grid-cols-10 gap-1.5">
              ${days30.map((d) => {
                if (d.isToday) {
                  return `
                    <div class="h-8 rounded bg-cinnabar-subtle shadow-sm flex items-center justify-center font-code text-[11px] text-primary font-bold relative" title="Hôm nay (${d.date}/${d.month}): Đã học ${d.revs} thẻ">
                      <span class="relative z-10">Hôm nay</span>
                      <span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary-container"></span>
                    </div>
                  `;
                }
                let cls = "bg-surface-container text-outline";
                if (d.revs >= 60) cls = "bg-primary-container text-white font-medium";
                else if (d.revs >= 30) cls = "bg-primary-fixed-dim text-primary";
                else if (d.revs > 0) cls = "bg-cinnabar-subtle text-primary";
                return `<div class="h-8 rounded ${cls} flex items-center justify-center font-code text-[11px]" title="Ngày ${d.date}/${d.month}: ${d.revs} thẻ">${d.date}</div>`;
              }).join("")}
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between pt-space-xs font-body-sm text-body-sm text-on-surface-variant">
          <span>Tổng cộng <strong>${fmt(monthTotalRevs)} lượt ôn</strong> trong 30 ngày qua</span>
          <span class="text-secondary font-medium">Tỷ lệ duy trì thói quen: ${habitPct}%</span>
        </div>
      </section>

      <!-- Quick Practice Modules: Taiwan Accent, Dictation, Weak Words (Exact Stitch) -->
      <section class="flex flex-col gap-space-md">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-space-sm">
            <span class="w-1 h-4 rounded-full bg-primary-container"></span>
            <h2 class="font-headline-md text-headline-md text-on-surface">Lối tắt luyện tập chuyên sâu</h2>
          </div>
          <span class="font-label-sm text-label-sm text-outline">Bài tập vi mô 5 - 15 phút</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
          <!-- Module 1: Taiwan Voice Audio Training -->
          <a href="#chinh-ta" class="p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between hover:shadow-md transition-all group cursor-pointer no-underline">
            <div class="flex flex-col gap-space-sm">
              <div class="w-12 h-12 rounded-lg bg-jade-subtle flex items-center justify-center group-hover:scale-105 transition-transform">
                <span class="material-symbols-outlined text-[24px] text-secondary">hearing</span>
              </div>
              <h3 class="font-headline-md text-headline-md text-on-surface mt-1 group-hover:text-primary transition-colors">
                Luyện nghe giọng Đài Loan
              </h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant">
                Tập phản xạ với ngữ điệu tự nhiên Đài Bắc, biến âm nhẹ (兒 hóa tối giản), tốc độ đàm thoại thực tế.
              </p>
            </div>
            <div class="pt-space-md flex items-center justify-between font-label-md text-label-md text-secondary font-semibold">
              <span>${fmt((window.DICTATION_PASSAGES || []).length || 15)} đoạn hội thoại</span>
              <span class="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </div>
          </a>
          <!-- Module 2: 10-Minute Dictation Challenge -->
          <a href="#chinh-ta" class="p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between hover:shadow-md transition-all group cursor-pointer no-underline">
            <div class="flex flex-col gap-space-sm">
              <div class="w-12 h-12 rounded-lg bg-cinnabar-subtle flex items-center justify-center group-hover:scale-105 transition-transform">
                <span class="material-symbols-outlined text-[24px] text-primary">draw</span>
              </div>
              <h3 class="font-headline-md text-headline-md text-on-surface mt-1 group-hover:text-primary transition-colors">
                Thử thách chính tả 10 phút
              </h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant">
                Luyện viết đúng thứ tự nét chữ Hán Phồn thể (筆順), chống nhầm lẫn các bộ thủ tương cận.
              </p>
            </div>
            <div class="pt-space-md flex items-center justify-between font-label-md text-label-md text-primary font-semibold">
              <span>20 chữ/phiên</span>
              <span class="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </div>
          </a>
          <!-- Module 3: Weak Words / Troublemakers -->
          <a href="#thu-muc/hay-quen" class="p-space-lg rounded-xl bg-paper-card border border-border-subtle/70 shadow-sm flex flex-col justify-between hover:shadow-md transition-all group cursor-pointer no-underline">
            <div class="flex flex-col gap-space-sm">
              <div class="w-12 h-12 rounded-lg bg-amber-subtle flex items-center justify-center group-hover:scale-105 transition-transform">
                <span class="material-symbols-outlined text-[24px] text-tertiary">priority_high</span>
              </div>
              <h3 class="font-headline-md text-headline-md text-on-surface mt-1 group-hover:text-primary transition-colors">
                Sổ tay từ hay quên
              </h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant">
                Tổng hợp các từ vựng hay nhầm lẫn hoặc ở mức nhớ thấp để rèn luyện tập trung ngay.
              </p>
            </div>
            <div class="pt-space-md flex items-center justify-between font-label-md text-label-md text-tertiary font-semibold">
              <span>${fmt(weakCount)} từ cần phục hồi</span>
              <span class="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </div>
          </a>
        </div>
      </section>

      <!-- Cultural Reflection & Idiom of the Day (Exact Stitch) -->
      <section class="p-space-lg rounded-xl bg-surface-container-low border border-border-subtle/60 flex flex-col md:flex-row items-center justify-between gap-space-md shadow-sm">
        <div class="flex items-center gap-space-md">
          <div class="w-10 h-10 rounded-full bg-paper-card flex items-center justify-center shadow-sm shrink-0">
            <span class="material-symbols-outlined text-primary text-[20px]">lightbulb</span>
          </div>
          <div class="flex flex-col">
            <div class="flex items-center gap-2">
              <span class="font-headline-md text-base md:text-lg text-on-surface font-bold">Thành ngữ hôm nay: 日積月累 <span class="font-code text-sm text-primary font-medium">(Rì jī yuè lěi)</span></span>
              <button type="button" class="w-7 h-7 rounded-full bg-paper-card text-primary hover:scale-110 flex items-center justify-center transition-transform shadow-2xs" onclick="if(typeof say==='function') say('日積月累')" title="Nghe phát âm thành ngữ">
                <span class="material-symbols-outlined text-[16px]">volume_up</span>
              </button>
            </div>
            <span class="font-body-md text-sm text-on-surface-variant mt-0.5">"Ngày tích tháng lũy" — Mỗi ngày học đều đặn, một năm bạn đã nắm vững toàn bộ vốn từ TOCFL B2.</span>
          </div>
        </div>
        <a href="#tu-dien" class="shrink-0 px-space-md py-space-xs rounded-lg bg-paper-card text-on-surface font-label-sm text-label-sm hover:bg-surface-container transition-colors shadow-sm no-underline">
          Xem kho thành ngữ
        </a>
      </section>

      <!-- Khung năng lực TOCFL 2024 (Interactive Band Toggles) -->
      <section class="flex flex-col gap-space-md">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-space-sm">
            <span class="w-1 h-4 rounded-full bg-secondary"></span>
            <h2 class="font-headline-md text-headline-md text-on-surface">Khung năng lực TOCFL 2024 (7 Cấp độ)</h2>
          </div>
          <a href="#thu-muc" class="text-xs text-primary hover:underline font-semibold">Mở Trung tâm Từ vựng →</a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
          ${bandProgressHTML}
        </div>
      </section>
    </div>
  `);

  // Start study button handler
  const startBtn = $("#btn-start-study");
  if (startBtn) {
    startBtn.onclick = () => {
      location.hash = "#hoc";
    };
  }

  // Event handlers for Goal Edit Box
  const btnToggle = $("#btnToggleGoalEdit");
  if (btnToggle) {
    btnToggle.onclick = () => {
      const box = $("#goalEditBox");
      if (box) {
        box.hidden = !box.hidden;
        if (!box.hidden) $("#goalNewCards")?.focus();
      }
    };
  }
  const btnCancel = $("#btnCancelGoal");
  if (btnCancel) {
    btnCancel.onclick = () => {
      const box = $("#goalEditBox");
      if (box) box.hidden = true;
    };
  }
  document.querySelectorAll(".btn-stepper").forEach((btn) => {
    btn.onclick = () => {
      const stepType = btn.dataset.step;
      const delta = Number(btn.dataset.delta);
      const input = stepType === "new" ? $("#goalNewCards") : $("#goalReviewCards");
      if (input) {
        const min = Number(input.min) || 1;
        const max = Number(input.max) || 500;
        const cur = Number(input.value) || 0;
        input.value = Math.max(min, Math.min(max, cur + delta));
      }
    };
  });
  document.querySelectorAll(".btn-preset").forEach((btn) => {
    btn.onclick = () => {
      const n = btn.dataset.new;
      const r = btn.dataset.rev;
      if ($("#goalNewCards")) $("#goalNewCards").value = n;
      if ($("#goalReviewCards")) $("#goalReviewCards").value = r;
    };
  });
  const btnSave = $("#btnSaveGoal");
  if (btnSave) {
    btnSave.onclick = async () => {
      const n = Math.max(1, Math.min(200, Number($("#goalNewCards")?.value) || 8));
      const r = Math.max(5, Math.min(500, Number($("#goalReviewCards")?.value) || 30));
      S.settings.newPerDay = n;
      S.settings.reviewPerDay = r;
      await saveSettings();
      const msg = $("#goalSaveMsg");
      if (msg) msg.textContent = "✓ Đã lưu mục tiêu thành công!";
      setTimeout(() => {
        VIEWS["trang-chu"]();
      }, 300);
    };
  }

  // Band learning toggle button handlers on home page
  document.querySelectorAll("[data-toggle-band]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const b = btn.dataset.toggleBand;
      S.settings.bands[b] = !S.settings.bands[b];
      await saveSettings();
      VIEWS["trang-chu"]();
    };
  });
};

// ---------------- MỨC NHỚ (LEVEL FILTER) ----------------
VIEWS["muc-nho"] = (arg) => {
  if (!/^[1-5]$/.test(arg)) { location.replace("#trang-chu"); return; }
  const level = Number(arg);
  const notes = S.notes.filter((n) => n.kind === "vocab" && noteLevel(n) === level);
  setView(`
    <div class="max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
      <div class="flex items-center gap-2">
        <a href="#trang-chu" class="text-primary hover:underline text-sm font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Trang chủ</span>
        </a>
      </div>
      <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div>
          <h1 class="font-headline-lg text-2xl font-bold text-on-surface">${esc(LEVELS[level])} · <span id="levelCount">${fmt(notes.length)}</span> từ</h1>
          <p class="text-xs text-on-surface-variant mt-0.5">Danh sách các từ vựng đang được xếp ở mức nhớ ${LEVELS[level]}.</p>
        </div>
        <div class="w-full md:w-72">
          <input type="search" id="levelSearch" placeholder="Lọc chữ Hán, pinyin hoặc nghĩa..." class="w-full px-3.5 py-2 rounded-xl bg-surface-container-low border border-border-subtle text-sm">
        </div>
      </div>
      <div id="levelMatches" class="text-xs text-outline font-medium" role="status"></div>
      <div id="levelStatus" role="status"></div>
      <p id="levelEmpty"${notes.length ? " hidden" : ""} class="p-6 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Chưa có từ ở mức này.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md" id="levelList">
        ${notes.map((n) => {
          const it = itemOf(n);
          const searchText = [n.w, ...(n.forms || []), it.py, it.vn].map(fold).join("|");
          return `
            <div class="p-space-md rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between gap-2 level-row hover:border-primary/40 transition-all" data-search="${esc(searchText)}">
              <div class="flex items-start justify-between">
                <div>
                  <a class="font-headline-md text-2xl text-on-surface font-serif font-bold hover:text-primary" href="#tu/${encodeURIComponent(n.w)}">${esc(n.w)}</a>
                  <span class="font-code text-xs text-tertiary ml-2">${esc(it.py)}</span>
                </div>
                <span class="pill lv-${level}">${esc(LEVELS[level])}</span>
              </div>
              <div class="text-xs text-on-surface-variant line-clamp-2">${esc(it.vn || it.en || "")}</div>
              <div class="pt-2 border-t border-border-subtle/50 flex items-center justify-between text-xs">
                <span class="text-outline">Đổi mức nhớ:</span>
                <select class="px-2 py-1 rounded-lg border border-border-subtle bg-surface-container-low text-xs font-medium" aria-label="Đổi mức nhớ của ${esc(n.w)}">${levelOptions(level)}</select>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `);
  const list = $("#levelList");
  const search = $("#levelSearch");
  function filterRows() {
    const query = fold(search.value);
    let matches = 0;
    for (const row of list.children) {
      row.hidden = !row.dataset.search.includes(query);
      if (!row.hidden) matches++;
    }
    $("#levelMatches").textContent = query && list.childElementCount
      ? (matches ? `Tìm thấy ${fmt(matches)} / ${fmt(list.childElementCount)} từ` : "Không có từ khớp với tìm kiếm.") : "";
  }
  search.oninput = filterRows;
  list.querySelectorAll("select").forEach((select, i) => bindLevelPicker(notes[i], () => {
    const row = select.closest(".level-row");
    row.remove();
    $("#levelCount").textContent = fmt(list.querySelectorAll(".level-row").length);
    $("#levelEmpty").hidden = list.querySelectorAll(".level-row").length > 0;
    filterRows();
  }, select));
};

// =========================================================================
// 2. HỌC FLASHCARDS (Modern Oriental Scholarly - Stitch Design)
// =========================================================================

function playChime(success = true) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (success) {
      // 2-tone chime: C5 (523.25Hz) -> G5 (783.99Hz)
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(783.99, now + 0.1);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      osc.start(now);
      osc.stop(now + 0.38);
    } else {
      // Gentle buzz for wrong choice: 220Hz -> 160Hz
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(160, now + 0.18);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    }
  } catch (e) {
    // AudioContext blocked or not supported
  }
}

function getClozeChoices(targetWord, targetBand) {
  const targetLen = [...targetWord].length;
  const poolSameLen = [];
  const poolOther = [];

  for (const n of S.notes) {
    if (n.kind !== "vocab" || !n.w || n.w === targetWord) continue;
    if ([...n.w].length === targetLen) {
      if (targetBand && inBand(n, targetBand)) {
        poolSameLen.unshift(n.w);
      } else {
        poolSameLen.push(n.w);
      }
    } else {
      poolOther.push(n.w);
    }
  }

  const shuffledSame = poolSameLen.sort(() => Math.random() - 0.5);
  const picked = new Set();
  for (const w of shuffledSame) {
    if (picked.size >= 3) break;
    picked.add(w);
  }

  if (picked.size < 3) {
    const shuffledOther = poolOther.sort(() => Math.random() - 0.5);
    for (const w of shuffledOther) {
      if (picked.size >= 3) break;
      picked.add(w);
    }
  }

  const choices = [targetWord, ...picked];
  return choices.sort(() => Math.random() - 0.5);
}

VIEWS["hoc"] = () => {
  if (!S.session) {
    const c = todayCounts();
    const st = todayStats();
    const targetNew = Math.max(1, Number(S.settings.newPerDay || 20));
    const targetRev = Math.max(1, Number(S.settings.reviewPerDay || 50));

    setView(`
      <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-xl flex flex-col gap-space-lg">
        <section class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-5 rounded-full bg-primary-container"></span>
            <h1 class="font-headline-lg text-2xl md:text-3xl font-bold text-on-surface">Phiên học Flashcards hôm nay</h1>
          </div>
          <p class="font-body-md text-sm text-on-surface-variant">
            Ôn thẻ đến hạn trước để củng cố trí nhớ dài hạn (Spaced Repetition), sau đó nạp thêm thẻ mới theo mục tiêu mỗi ngày.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-space-md my-space-sm">
            <div class="p-space-md rounded-2xl bg-amber-subtle border border-amber-subtle flex flex-col">
              <span class="text-xs font-semibold text-tertiary uppercase">Đến hạn ôn</span>
              <span class="font-headline-lg text-2xl font-bold text-tertiary mt-1">${fmt(c.due)} <small class="text-xs font-normal">thẻ</small></span>
              <span class="text-xs text-on-surface-variant mt-0.5">Mục tiêu: ${targetRev} thẻ</span>
            </div>
            <div class="p-space-md rounded-2xl bg-cinnabar-subtle border border-cinnabar-subtle flex flex-col">
              <span class="text-xs font-semibold text-primary uppercase">Thẻ mới hôm nay</span>
              <span class="font-headline-lg text-2xl font-bold text-primary mt-1">${fmt(c.fresh)} <small class="text-xs font-normal">thẻ</small></span>
              <span class="text-xs text-on-surface-variant mt-0.5">Mục tiêu: ${targetNew} thẻ</span>
            </div>
            <div class="p-space-md rounded-2xl bg-jade-subtle border border-jade-subtle flex flex-col">
              <span class="text-xs font-semibold text-secondary uppercase">Đã trả lời hôm nay</span>
              <span class="font-headline-lg text-2xl font-bold text-secondary mt-1">${fmt(st.reviews)} <small class="text-xs font-normal">lượt</small></span>
              <span class="text-xs text-on-surface-variant mt-0.5">Tính vào mục tiêu</span>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 pt-space-sm">
            ${c.fresh > 0 ? `
              <button class="w-full sm:w-auto flex-1 h-12 px-5 rounded-xl bg-secondary text-white font-semibold hover:opacity-95 transition-all shadow-sm flex items-center justify-center gap-2 text-sm" id="startNew">
                <span class="material-symbols-outlined text-[20px]">auto_awesome</span>
                <span>Học từ mới (${fmt(c.fresh)} thẻ)</span>
              </button>
            ` : (c.q.freshTotal > 0 ? `
              <button class="w-full sm:w-auto h-12 px-5 rounded-xl bg-jade-subtle text-secondary border border-secondary/30 font-semibold hover:bg-secondary hover:text-white transition-all flex items-center justify-center gap-2 text-sm" id="btnAddMoreNew">
                <span class="material-symbols-outlined text-[20px]">add_circle</span>
                <span>+10 thẻ mới hôm nay (còn ${fmt(c.q.freshTotal)})</span>
              </button>
            ` : '')}
            ${c.due > 0 ? `
              <button class="w-full sm:w-auto flex-1 h-12 px-5 rounded-xl bg-amber-subtle text-tertiary border border-tertiary/30 font-semibold hover:bg-tertiary hover:text-white transition-all shadow-xs flex items-center justify-center gap-2 text-sm" id="startReview">
                <span class="material-symbols-outlined text-[20px]">history_edu</span>
                <span>Ôn thẻ đến hạn (${fmt(c.due)} thẻ)</span>
              </button>
            ` : ''}
            ${c.total > 0 ? `
              <button class="w-full sm:w-auto flex-1 h-12 px-6 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-all shadow-sm flex items-center justify-center gap-2 text-sm" id="start">
                <span class="material-symbols-outlined text-[20px]">play_circle</span>
                <span>Bắt đầu phiên học (${fmt(c.total)} thẻ)</span>
              </button>
            ` : `
              <div class="w-full p-4 rounded-xl bg-jade-subtle text-secondary font-medium flex items-center gap-2 text-sm">
                <span class="material-symbols-outlined text-[20px]">task_alt</span>
                <span>${c.q.freshTotal ? `Đã đạt chỉ tiêu ${fmt(targetNew)} thẻ mới hôm nay (còn ${fmt(c.q.freshTotal)} thẻ chờ). Bấm "+10 thẻ mới" hoặc tăng trong Cài đặt để học thêm.` : `Đã hoàn thành toàn bộ thẻ hôm nay! Vào Thư mục để đưa thêm band vào lịch học.`}</span>
              </div>
            `}
            <a href="#cai-dat" class="w-full sm:w-auto h-12 px-5 rounded-xl bg-paper-muted text-on-surface font-semibold hover:bg-surface-container transition-colors flex items-center justify-center gap-2 text-sm">
              <span class="material-symbols-outlined text-[18px]">tune</span>
              <span>Đổi mục tiêu</span>
            </a>
          </div>
        </section>
      </div>
    `);

    const launchSession = (mode, totalCount) => {
      S.session = { answered: 0, shown: false, start: totalCount, lastNote: null, mode, newKeys: new Set(), queue: [] };
      S.session.current = nextCard(Date.now());
      renderCard();
    };
    const b = $("#start");
    if (b) b.onclick = () => launchSession("all", c.total);
    const bNew = $("#startNew");
    if (bNew) bNew.onclick = () => launchSession("new", c.fresh);
    const bRev = $("#startReview");
    if (bRev) bRev.onclick = () => launchSession("review", c.due);
    const bAddMore = $("#btnAddMoreNew");
    if (bAddMore) {
      bAddMore.onclick = async () => {
        S.settings.newPerDay = Number(S.settings.newPerDay || 20) + 10;
        try { await Store.put("settings", "user", S.settings); } catch (e) {}
        VIEWS["hoc"]();
      };
    }
    return;
  }
  renderCard();
};

function renderCard() {
  const ss = S.session;
  if (!ss || !ss.current) {
    const cAfter = todayCounts();
    const stAfter = todayStats();
    setView(`
      <div class="max-w-xl mx-auto px-margin py-space-2xl text-center flex flex-col items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-jade-subtle text-secondary flex items-center justify-center shadow-xs">
          <span class="material-symbols-outlined text-[36px]">verified</span>
        </div>
        <h2 class="font-headline-lg text-2xl font-bold text-on-surface">Hoàn thành phiên học!</h2>
        <p class="font-body-md text-sm text-on-surface-variant">
          Bạn đã hoàn thành xuất sắc <strong>${fmt(ss ? ss.answered : 0)} lượt thẻ</strong> trong phiên này (hôm nay: <strong>${fmt(stAfter.newCards)} từ mới</strong>, <strong>${fmt(stAfter.reviews)} lượt ôn</strong>). Thẻ chấm "Quên / Mới học" sẽ quay lại sau ít phút để bạn ôn củng cố.
        </p>
        <div class="flex flex-wrap items-center justify-center gap-3 mt-4">
          ${cAfter.fresh > 0 ? `
            <button type="button" id="btnContinueNew" class="px-5 py-2.5 rounded-xl bg-secondary text-white font-semibold hover:opacity-95 transition-colors shadow-xs text-sm">
              Học tiếp từ mới (${fmt(cAfter.fresh)})
            </button>
          ` : (cAfter.q.freshTotal > 0 ? `
            <button type="button" id="btnMoreNewAfter" class="px-5 py-2.5 rounded-xl bg-jade-subtle text-secondary border border-secondary/30 font-semibold hover:bg-secondary hover:text-white transition-colors text-sm">
              +10 từ mới nữa (còn ${fmt(cAfter.q.freshTotal)})
            </button>
          ` : '')}
          ${cAfter.due > 0 ? `
            <button type="button" id="btnContinueReview" class="px-5 py-2.5 rounded-xl bg-amber-subtle text-tertiary border border-tertiary/30 font-semibold hover:bg-tertiary hover:text-white transition-colors text-sm">
              Ôn thẻ đến hạn (${fmt(cAfter.due)})
            </button>
          ` : ''}
          <a href="#trang-chu" class="px-6 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-colors shadow-xs text-sm">
            Về Trang chủ
          </a>
          <a href="#thu-muc" class="px-5 py-2.5 rounded-xl bg-paper-muted text-on-surface font-semibold hover:bg-surface-container transition-colors text-sm">
            Khám phá từ vựng
          </a>
        </div>
      </div>
    `);
    const bContNew = $("#btnContinueNew");
    if (bContNew) bContNew.onclick = () => {
      S.session = { answered: 0, shown: false, start: cAfter.fresh, lastNote: null, mode: "new", newKeys: new Set(), queue: [] };
      S.session.current = nextCard(Date.now());
      renderCard();
    };
    const bMoreNew = $("#btnMoreNewAfter");
    if (bMoreNew) bMoreNew.onclick = async () => {
      S.settings.newPerDay = Number(S.settings.newPerDay || 20) + 10;
      try { await Store.put("settings", "user", S.settings); } catch (e) {}
      const c2 = todayCounts();
      S.session = { answered: 0, shown: false, start: c2.fresh, lastNote: null, mode: "new", newKeys: new Set(), queue: [] };
      S.session.current = nextCard(Date.now());
      renderCard();
    };
    const bContRev = $("#btnContinueReview");
    if (bContRev) bContRev.onclick = () => {
      S.session = { answered: 0, shown: false, start: cAfter.due, lastNote: null, mode: "review", newKeys: new Set(), queue: [] };
      S.session.current = nextCard(Date.now());
      renderCard();
    };
    S.session = null;
    updateBadge();
    return;
  }

  const r = ss.current;
  const it = itemOf(r.n);
  const band = bandsOf(r.n).join(" · ") || (r.n.rich ? r.n.deck.name : "TOCFL");
  const types = typesOf(r.n);
  const typeLabel = (types.find(([t]) => t === r.t) || [r.t, r.t])[1];
  const curLvl = noteLevel(r.n);

  const curCid = cardId(r.n, r.t);
  const curCardState = S.srs.get(curCid) || freshState();
  const curSkillLvl = cardLevel(curCardState);
  const curSkillIvl = curCardState.ivl || 0;

  const now = Date.now();
  const srsNext1 = schedule(curCardState, 1, now);
  const srsNext2 = schedule(curCardState, 2, now);
  const srsNext3 = schedule(curCardState, 3, now);
  const srsNext4 = schedule(curCardState, 4, now);

  const fmtNextIvl = (s) => {
    if (s.state === "learn" || s.state === "relearn") {
      const diff = Math.max(0, s.due - now);
      return fmtGap(diff);
    }
    return `${s.ivl} ngày`;
  };

  const skillBadgesHTML = types.map(([t, label]) => {
    const cState = S.srs.get(cardId(r.n, t));
    const lvl = cardLevel(cState);
    const isCur = t === r.t;
    return `
      <div class="px-2.5 py-1 rounded-xl border text-xs flex items-center gap-1.5 transition-all ${isCur ? 'border-secondary bg-jade-subtle text-secondary font-bold shadow-2xs ring-1 ring-secondary/30' : 'border-border-subtle bg-surface-container-low text-outline'}">
        <span>${label}:</span>
        <span class="${isCur ? 'text-secondary' : 'text-on-surface'}">${LEVELS[lvl]}</span>
      </div>
    `;
  }).join('');

  const totalCards = Math.max(ss.start, ss.answered + 1);
  const cardIndex = ss.answered + 1;
  const pct = Math.min(100, Math.round((ss.answered / totalCards) * 100));

  // Hanzi characters decomposition
  const chars = [...new Set([...hanOnly(it.w)])];
  const charDecompHTML = chars.map(c => {
    const ce = cedFirst(c);
    const py = pyOf(c);
    const def = ce ? ce[0][1].split("/").slice(0, 2).join("; ") : "";
    return `
      <div class="bg-surface-container-low rounded-xl p-space-md flex items-start gap-space-md border border-border-subtle/50">
        <div class="w-12 h-12 rounded-lg bg-cinnabar-subtle text-primary flex items-center justify-center font-display text-2xl shrink-0 font-serif font-bold">
          ${c}
        </div>
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-space-xs">
            <span class="font-label-md font-bold text-on-surface">${c} (${py})</span>
          </div>
          <p class="font-body-sm text-xs text-on-surface-variant mt-0.5 line-clamp-2">
            ${def || 'Chữ Hán Phồn thể chuẩn'}
          </p>
        </div>
      </div>
    `;
  }).join('');

  // Front Question Content based on Card Type
  let frontContentHTML = "";
  if (r.n.kind === "grammar") {
    if (r.t === "rec") {
      frontContentHTML = `
        <div class="font-headline-lg text-2xl md:text-3xl text-on-surface font-serif font-bold mb-2">${esc(it.w)}</div>
        <div class="text-sm text-outline">Mẫu ngữ pháp này nghĩa là gì? Thử đặt một câu với nó trong đầu.</div>
      `;
    } else if (r.t === "bui") {
      frontContentHTML = `
        <div class="text-lg font-bold text-on-surface mb-2">${esc(it.e1v)}</div>
        <div class="text-sm text-outline">Nói câu này bằng tiếng Trung, sử dụng mẫu câu <span class="font-serif font-bold text-primary">${esc(it.w)}</span></div>
      `;
    } else {
      frontContentHTML = `
        <div class="font-headline-lg text-xl md:text-2xl text-on-surface font-serif mb-2">${esc(it.cz)}</div>
        <div class="text-sm text-on-surface-variant">${esc(it.e2v)}<br><span class="text-outline">Điền phần còn thiếu vào chỗ trống.</span></div>
      `;
    }
  } else if (r.t === "lis") {
    // LISTENING CARD: CHARACTER IS HIDDEN!
    frontContentHTML = `
      <div class="w-20 h-20 rounded-full bg-jade-subtle text-secondary flex items-center justify-center text-4xl mb-3 shadow-xs">
        🎧
      </div>
      <div class="font-headline-md text-xl md:text-2xl font-bold text-on-surface mb-2">Nghe và đoán nghĩa</div>
      <div class="text-sm text-outline max-w-md mb-4">Nói to nghĩa của từ và của câu ví dụ trong đầu trước khi lật thẻ.</div>
      <div class="flex items-center gap-3">
        <button type="button" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-jade-subtle hover:bg-secondary-fixed text-secondary font-semibold transition-all shadow-xs border border-secondary/20" onclick="say('${esc(it.w)}')">
          <span class="material-symbols-outlined text-[20px]">volume_up</span>
          <span>▶ Nghe lại phát âm từ</span>
        </button>
        ${it.e1 ? `
          <button type="button" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold transition-all shadow-xs border border-border-subtle" onclick="say('${esc(it.e1)}')">
            <span class="material-symbols-outlined text-[20px]">record_voice_over</span>
            <span>▶ Nghe câu ví dụ</span>
          </button>
        ` : ''}
      </div>
    `;
  } else if (r.t === "wri") {
    // WRITING / SPEAKING PROMPT
    frontContentHTML = `
      <div class="text-xs uppercase tracking-wider font-semibold text-secondary mb-1">Gợi ý nghĩa tiếng Việt</div>
      <div class="font-headline-lg text-2xl md:text-3xl font-bold text-on-surface mb-2">${esc(it.vn || it.en)}</div>
      <div class="text-xs text-outline mb-4">${it.pos ? esc(it.pos) + ' · ' : ''}Nói to phát âm rồi dùng bút viết chữ này ra giấy hoặc vẽ nét.</div>
    `;
  } else if (r.t === "clo") {
    // CLOZE FILL-IN-THE-BLANK (4 Multiple Choice Options)
    if (!r._choices) {
      r._choices = getClozeChoices(it.w, r.n.band);
      r._isCorrect = false;
      r._selected = null;
      r._wrongChoices = [];
    }

    const rawSentence = (it.e2 && it.e2.includes(it.w)) ? it.e2 : ((it.e1 && it.e1.includes(it.w)) ? it.e1 : (it.e2 || it.e1 || ""));
    const vietSentence = (rawSentence === it.e2) ? (it.e2v || it.e1v || "") : (it.e1v || it.e2v || "");
    const blankLength = Math.max(2, [...it.w].length);
    const blankStr = "＿＿".repeat(Math.ceil(blankLength / 2));

    let sentenceDisplay = "";
    if (rawSentence.includes(it.w)) {
      const parts = rawSentence.split(it.w);
      if (r._isCorrect) {
        sentenceDisplay = `${esc(parts[0])}<span class="inline-block px-3 py-1 rounded-xl bg-jade-subtle text-secondary font-bold border-2 border-secondary/40 text-2xl md:text-3xl shadow-xs transition-all">${esc(it.w)}</span>${esc(parts.slice(1).join(it.w))}`;
      } else {
        sentenceDisplay = `${esc(parts[0])}<span id="clozeBlank" class="inline-block px-4 py-1 rounded-xl bg-paper-card border-2 border-dashed border-primary text-primary font-bold min-w-[4rem] text-center tracking-widest text-xl shadow-2xs">${blankStr}</span>${esc(parts.slice(1).join(it.w))}`;
      }
    } else {
      sentenceDisplay = r._isCorrect ? esc(it.w) : blankStr;
    }

    frontContentHTML = `
      <div class="font-headline-lg text-2xl md:text-3xl text-on-surface font-serif font-medium leading-relaxed max-w-2xl px-5 py-4 bg-surface-container-low rounded-2xl border border-border-subtle mb-2 text-center" id="clozeSentenceBox">
        ${sentenceDisplay}
      </div>
      ${vietSentence ? `<div class="text-sm md:text-base text-on-surface-variant font-medium text-center max-w-xl mb-1">${esc(vietSentence)}</div>` : ''}
      <div class="text-xs text-outline mb-4 text-center">
        ${r._isCorrect ? '✓ Đã chọn đúng từ!' : 'Chọn từ chữ Hán đúng trong 4 đáp án bên dưới:'}
      </div>

      <!-- 4 Choices Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl mx-auto my-2" id="clozeChoicesArea">
        ${r._choices.map((choice, idx) => {
          const keyLabel = ["A", "B", "C", "D"][idx];
          const isWrong = (r._wrongChoices || []).includes(choice);
          const isRight = r._isCorrect && (choice === it.w);

          let btnCls = "cloze-opt";
          let badgeCls = "w-7 h-7 rounded-lg flex items-center justify-center font-code text-xs font-bold transition-colors";
          if (isRight) {
            btnCls += " is-correct";
            badgeCls += " bg-secondary text-white font-bold";
          } else if (isWrong) {
            btnCls += " is-wrong";
            badgeCls += " bg-surface-container-high text-outline line-through";
          } else {
            badgeCls += " bg-surface-container text-outline group-hover:bg-primary-container group-hover:text-white";
          }

          return `
            <button type="button"
                    class="${btnCls}"
                    data-cloze-val="${esc(choice)}"
                    data-cloze-idx="${idx}"
                    ${(isWrong || r._isCorrect) ? 'disabled' : ''}>
              <div class="flex items-center gap-3">
                <span class="${badgeCls}">
                  ${isRight ? '✓' : (isWrong ? '✕' : keyLabel)}
                </span>
                <span class="font-serif font-bold text-2xl md:text-3xl tracking-wide">${esc(choice)}</span>
              </div>
              <span class="font-code text-xs text-outline opacity-40 group-hover:opacity-100">${idx + 1}</span>
            </button>
          `;
        }).join('')}
      </div>

      <!-- Feedback Area -->
      <div id="clozeFeedback" class="min-h-[28px] text-xs font-semibold text-center mt-1">
        ${r._isCorrect ? `
          <span class="text-secondary font-bold inline-flex items-center gap-1.5 text-sm">
            <span class="material-symbols-outlined text-[20px]">check_circle</span>
            Chính xác! Nhấn phím Space hoặc bấm nút đỏ bên dưới để lật thẻ xem giải nghĩa.
          </span>
        ` : (r._wrongChoices && r._wrongChoices.length ? `
          <span class="text-primary font-medium inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-[16px]">cancel</span>
            Chưa đúng rồi, hãy thử chọn lại một từ khác nhé!
          </span>
        ` : '')}
      </div>
    `;
  } else if (r.t === "abr") {
    // ABBREVIATION CARD
    frontContentHTML = `
      <div class="font-headline-lg text-5xl md:text-6xl text-on-surface font-serif font-bold mb-3">${esc(it.w)}</div>
      <div class="text-sm text-outline">Đây là cách nói tắt trong khẩu ngữ Đài Loan. Dạng đầy đủ là gì? Nghĩa là gì?</div>
    `;
  } else {
    // REC: STANDARD RECOGNITION (Character + Context Sentence if available)
    const ex = it.e1 || it.e2;
    frontContentHTML = `
      ${ex ? `
        <div class="text-xs text-secondary font-semibold uppercase tracking-wider mb-2">
          Câu ngữ cảnh đời sống Đài Loan
        </div>
        <div class="font-headline-lg text-2xl md:text-3xl text-on-surface font-serif font-medium leading-relaxed max-w-2xl px-4 py-2.5 bg-surface-container-low rounded-xl border border-border-subtle mb-3">
          ${esc(ex)}
        </div>
      ` : ''}
      <div class="flex items-center justify-center gap-space-md my-space-xs">
        <h1 class="font-headline-lg text-6xl md:text-8xl leading-tight text-on-surface tracking-wide select-all font-serif font-bold">
          ${esc(it.w)}
        </h1>
      </div>
      <div class="mt-2 flex items-center gap-3">
        <button type="button" class="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-jade-subtle hover:bg-secondary-fixed text-secondary font-semibold transition-all shadow-xs border border-secondary/20" onclick="say('${esc(ex || it.w)}')">
          <span class="material-symbols-outlined text-[18px]">volume_up</span>
          <span>${ex ? '▶ Nghe câu ngữ cảnh' : '▶ Giọng Đài Loan (臺灣華語)'}</span>
        </button>
      </div>
      <div class="text-xs text-outline mt-3">🎧 Nghe audio → 📖 Đọc chữ → 💡 Hiểu nghĩa</div>
    `;
  }

  const html = `
    <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-md md:py-space-lg flex flex-col gap-space-lg relative z-10">
      <!-- Top Session Dashboard -->
      <section class="bg-paper-card rounded-2xl p-space-md md:p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
        <div class="flex flex-wrap items-center justify-between gap-space-sm">
          <div class="flex items-center gap-space-sm">
            <span class="inline-flex items-center justify-center px-2.5 py-1 rounded-lg bg-cinnabar-subtle text-primary font-code text-xs font-bold">${cardIndex}</span>
            <span class="font-body-sm text-sm text-outline">/ ${totalCards} thẻ (${ss.mode === 'new' ? 'Học từ mới' : (ss.mode === 'review' ? 'Ôn tập' : (ss.folderFilter ? 'Theo chủ đề' : 'Phiên hôm nay'))})</span>
            ${curCardState.state === 'new' ? `<span class="px-2 py-0.5 rounded-full bg-jade-subtle text-secondary text-xs font-bold">Từ mới ✨</span>` : `<span class="px-2 py-0.5 rounded-full bg-amber-subtle text-tertiary text-xs font-bold">Đang ôn</span>`}
          </div>
          <div class="flex items-center gap-2 sm:gap-4 text-xs font-medium flex-wrap">
            <div class="flex items-center gap-1 bg-amber-subtle px-2.5 py-1 rounded-full text-tertiary">
              <span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
              <span>Dạng: <strong>${typeLabel}</strong></span>
            </div>
            <div class="flex items-center gap-1 bg-jade-subtle px-2.5 py-1 rounded-full text-secondary">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
              <span>Mức nhớ: <strong>${LEVELS[curLvl]}</strong></span>
            </div>
            <button type="button" class="text-xs text-outline hover:text-primary transition-colors underline ml-2" id="btnStopSession">
              Tạm dừng
            </button>
          </div>
        </div>
        <!-- Segmented Progress Rail -->
        <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden flex">
          <div class="h-full bg-secondary transition-all duration-300" style="width: ${pct}%;"></div>
        </div>
      </section>

      <!-- Main Study Flashcard Shell -->
      <div class="relative w-full">
        <!-- Ambient Seal Watermark -->
        <div class="absolute top-6 right-8 select-none pointer-events-none opacity-5 font-serif text-[120px] text-primary leading-none">
          ${chars[0] || '學'}
        </div>

        <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-sm flex flex-col gap-space-lg transition-all duration-200">
          <!-- Card Utilities Bar -->
          <div class="flex items-center justify-between gap-space-sm flex-wrap">
            <div class="flex items-center gap-space-xs flex-wrap">
              <span class="px-space-sm py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-xs font-semibold tracking-wider">TOCFL ${band}</span>
              ${it.pos ? `<span class="px-space-sm py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-xs">${it.pos}</span>` : ''}
              ${it.hv ? `<span class="px-space-sm py-0.5 rounded-full bg-paper-muted text-on-surface-variant font-code text-xs">Hán Việt: ${it.hv}</span>` : ''}
            </div>
            <div class="flex items-center gap-1.5">
              <button aria-label="Xem nét viết" class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-secondary hover:bg-jade-subtle transition-colors" id="btnToggleStrokes" title="Xem thứ tự nét viết">
                <span class="material-symbols-outlined text-[18px]">draw</span>
              </button>
            </div>
          </div>

          <!-- Drawer nét viết (Hanzi Writer) -->
          <div class="hidden bg-paper-muted rounded-xl p-space-md flex-col gap-space-sm border border-border-subtle" id="strokesDrawer">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-sm text-on-surface font-semibold">Tập viết chữ Hán theo thứ tự nét</span>
              <span class="font-body-sm text-xs text-outline">${it.w}</span>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-4 py-2" id="studyWriterBox">
              ${chars.map((c, k) => `
                <div class="flex flex-col items-center gap-1 bg-paper-card p-2 rounded-xl border border-border-subtle shadow-2xs">
                  <div id="studyHw${k}"></div>
                  <div class="flex gap-1 mt-1">
                    <button type="button" class="text-xs px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-primary font-medium" data-anim-k="${k}">Xem nét</button>
                    <button type="button" class="text-xs px-2 py-0.5 rounded bg-surface-container hover:bg-jade-subtle text-secondary font-medium" data-quiz-k="${k}">Viết thử</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Front Question Side -->
          ${!ss.shown ? `
            <div class="flex flex-col items-center justify-center text-center py-space-md">
              ${frontContentHTML}

              <!-- Reveal Button -->
              <div class="flex justify-center mt-space-lg">
                <button type="button" class="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-primary-container hover:bg-primary text-on-primary font-semibold transition-all active:scale-98 shadow-sm text-sm" id="btnReveal">
                  <span class="material-symbols-outlined text-[20px]">visibility</span>
                  <span>Xem đáp án & giải nghĩa</span>
                  <span class="ml-2 font-code text-xs px-1.5 py-0.5 rounded bg-white/20">Space</span>
                </button>
              </div>
            </div>
          ` : `
            <!-- Back Details (Expanded Answer Side) -->
            <div class="flex flex-col gap-space-lg">
              <!-- Word & Phonetics Header in Back -->
              <div class="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-space-sm border-b border-border-subtle">
                <div class="flex items-baseline gap-3 flex-wrap">
                  <span class="font-display text-4xl text-on-surface font-serif font-bold">${esc(it.w)}</span>
                  <span class="font-code text-lg text-tertiary font-semibold">${esc(it.py || '')}</span>
                  <button type="button" class="text-secondary hover:text-primary transition-colors p-1" onclick="say('${esc(it.w)}')" title="Nghe lại phát âm">
                    <span class="material-symbols-outlined text-[20px]">volume_up</span>
                  </button>
                </div>
                ${it.hv ? `<span class="font-label-md text-sm text-outline">Hán Việt: <strong class="text-on-surface font-semibold">${it.hv}</strong></span>` : ''}
              </div>

              <!-- Meaning Definition Row -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
                  <span class="font-label-sm text-xs text-outline uppercase tracking-wider font-semibold">Ý nghĩa chính</span>
                </div>
                <div class="text-xl font-headline-md text-on-surface font-semibold">
                  ${esc(it.vn || 'Chưa có nghĩa tiếng Việt')}
                </div>
                ${it.en ? `<div class="text-sm text-on-surface-variant font-body-sm">${esc(it.en)}</div>` : ''}
              </div>

              <!-- Contextual Example Box -->
              ${it.e1 || it.e2 ? `
                <div class="bg-paper-muted rounded-xl p-space-md md:p-space-lg flex flex-col gap-space-sm relative border border-border-subtle">
                  <div class="flex items-center justify-between">
                    <span class="font-label-sm text-xs text-secondary font-semibold uppercase tracking-wider flex items-center gap-1">
                      <span class="material-symbols-outlined text-[16px]">format_quote</span>
                      Ví dụ ngữ cảnh Đài Loan
                    </span>
                    <button type="button" class="text-secondary hover:text-primary p-1 transition-colors" onclick="say('${esc(it.e1 || it.e2)}')" title="Nghe câu ví dụ">
                      <span class="material-symbols-outlined text-[20px]">volume_up</span>
                    </button>
                  </div>
                  <p class="font-headline-md text-lg md:text-xl text-on-surface font-serif font-medium leading-relaxed">
                    ${ruby(it.e1 || it.e2)}
                  </p>
                  ${(it.e1p || it.e2p) ? `<p class="font-code text-xs text-on-surface-variant">${esc(it.e1p || it.e2p)}</p>` : ''}
                  ${(it.e1v || it.e2v) ? `<p class="font-body-md text-sm text-on-surface font-medium">${esc(it.e1v || it.e2v)}</p>` : ''}
                </div>
              ` : ''}

              <!-- Character Decomposition Bento Cards -->
              ${chars.length ? `
                <div class="flex flex-col gap-2">
                  <span class="text-xs text-outline font-semibold uppercase">Chiết tự & Cấu trúc chữ</span>
                  <div class="grid grid-cols-1 md:grid-cols-${Math.min(chars.length, 3)} gap-space-md">
                    ${charDecompHTML}
                  </div>
                </div>
              ` : ''}

              <!-- SECTION: SRS EVALUATION & SKILL MASTERY -->
              <div class="pt-space-md flex flex-col gap-space-md border-t border-border-subtle mt-2">
                <!-- Skill Progress Bar & Badges -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-surface-container-low p-3 rounded-xl border border-border-subtle">
                  <div class="flex items-center gap-2">
                    <span class="font-label-sm text-xs font-semibold uppercase text-outline">Kỹ năng đang luyện:</span>
                    <span class="px-2.5 py-0.5 rounded-lg bg-secondary text-white font-bold text-xs shadow-2xs">${typeLabel}</span>
                    <span class="text-xs text-on-surface-variant font-medium">(Mức: <strong>${LEVELS[curSkillLvl]}</strong>${curSkillIvl ? ` • ${curSkillIvl} ngày` : ''})</span>
                  </div>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[11px] text-outline uppercase font-semibold mr-1">Tất cả kỹ năng:</span>
                    ${skillBadgesHTML}
                  </div>
                </div>

                <!-- 4 Primary SRS Auto-Buttons (SM-2) -->
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center justify-between text-outline px-1">
                    <span class="font-label-sm text-xs uppercase tracking-wider font-semibold text-on-surface">Đánh giá khả năng nhớ (Thuật toán SRS Spaced Repetition):</span>
                    <span class="font-code text-xs hidden sm:inline">Phím tắt: 1 - 4</span>
                  </div>
                  <div class="srs-grade-grid">
                    <button type="button" class="srs-grade-btn srs-grade-1" data-srs-grade="1" title="Quên thẻ này - ôn lại sau ${fmtNextIvl(srsNext1)}">
                      <span class="srs-grade-label">Quên</span>
                      <span class="srs-grade-sub">${fmtNextIvl(srsNext1)}</span>
                      <span class="srs-grade-shortcut">1</span>
                    </button>
                    <button type="button" class="srs-grade-btn srs-grade-2" data-srs-grade="2" title="Nhớ khó khăn - ôn lại sau ${fmtNextIvl(srsNext2)}">
                      <span class="srs-grade-label">Khó</span>
                      <span class="srs-grade-sub">${fmtNextIvl(srsNext2)}</span>
                      <span class="srs-grade-shortcut">2</span>
                    </button>
                    <button type="button" class="srs-grade-btn srs-grade-3" data-srs-grade="3" title="Nhớ tốt đúng hạn - ôn lại sau ${fmtNextIvl(srsNext3)}">
                      <span class="srs-grade-label">Nhớ tốt</span>
                      <span class="srs-grade-sub">${fmtNextIvl(srsNext3)}</span>
                      <span class="srs-grade-shortcut">3</span>
                    </button>
                    <button type="button" class="srs-grade-btn srs-grade-4" data-srs-grade="4" title="Rất dễ dàng - ôn lại sau ${fmtNextIvl(srsNext4)}">
                      <span class="srs-grade-label">Dễ</span>
                      <span class="srs-grade-sub">${fmtNextIvl(srsNext4)}</span>
                      <span class="srs-grade-shortcut">4</span>
                    </button>
                  </div>
                  <div class="text-[11px] text-outline text-center mt-0.5">
                    Hệ thống sẽ tự động tính chu kỳ ôn tối ưu cho riêng kỹ năng <strong>${typeLabel}</strong> theo thuật toán SM-2.
                  </div>
                </div>

                <!-- Manual Level Override Collapsible -->
                <details class="group rounded-xl border border-border-subtle bg-paper-card p-3 transition-all" id="detailsManualLevel">
                  <summary class="flex items-center justify-between cursor-pointer text-xs font-semibold text-outline hover:text-on-surface select-none">
                    <span class="flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-[16px] transition-transform group-open:rotate-90">tune</span>
                      <span>Tuỳ chỉnh mức thủ công (Manual Level Override)</span>
                    </span>
                    <span class="text-[11px] font-normal text-secondary font-mono">Bấm để chỉnh 6 mức</span>
                  </summary>
                  <div class="flex flex-col gap-2.5 pt-3 mt-2 border-t border-border-subtle">
                    <label class="flex items-center gap-2 text-xs text-on-surface cursor-pointer select-none">
                      <input type="checkbox" id="chkAllSkills" class="w-4 h-4 rounded text-primary">
                      <span class="font-medium">Áp dụng mức này cho cả từ (tất cả các kỹ năng đọc, nghe, viết, điền từ)</span>
                    </label>
                    <div class="grades-6">
                      ${[0, 1, 2, 3, 4, 5].map((lvl) => {
                        const isCur = curSkillLvl === lvl;
                        const hints = ["Đặt lại", "Ôn lại ngay", "1 ngày", "7 ngày", "21 ngày", "90 ngày"];
                        return `
                          <button type="button" class="lvl-btn lvl-btn-${lvl} ${isCur ? "is-current" : ""}" data-word-level="${lvl}" title="Đặt ở mức ${esc(LEVELS[lvl])}">
                            <span class="lvl-title">${isCur ? "✓ " : ""}${esc(LEVELS[lvl])}</span>
                            <small class="lvl-sub">${hints[lvl]}</small>
                          </button>
                        `;
                      }).join('')}
                    </div>
                    <div class="text-[11px] text-outline text-center">
                      Mức thủ công được kiểm soát cận khoảng cách theo lịch sử học, chống nhảy cóc sai lệch tiến độ.
                    </div>
                  </div>
                </details>

                <div role="status" id="levelStatus" class="text-xs text-secondary text-center font-semibold"></div>
              </div>
            </div>
          `}
        </div>
      </div>

      <!-- Quick Helpful Shortcuts Pill Bar -->
      <footer class="flex flex-wrap items-center justify-center gap-space-md py-space-xs text-outline font-label-sm text-xs">
        ${(!ss.shown && r.t === "clo") ? `
          <div class="flex items-center gap-1">
            <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">1 - 4</kbd>
            <span>Chọn đáp án</span>
          </div>
          <span>•</span>
        ` : ''}
        <div class="flex items-center gap-1">
          <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">Space</kbd>
          <span>Lật thẻ</span>
        </div>
        <span>•</span>
        <div class="flex items-center gap-1">
          <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">R</kbd>
          <span>Phát âm lại</span>
        </div>
        ${ss.shown ? `
          <span>•</span>
          <div class="flex items-center gap-1">
            <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">1 - 4</kbd>
            <span>Đánh giá SRS</span>
          </div>
          <span>•</span>
          <div class="flex items-center gap-1">
            <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">5 / 0</kbd>
            <span>Thuộc / Đặt lại</span>
          </div>
        ` : ''}
      </footer>
    </div>
  `;

  setView(html);

  // Bind cloze multiple choice buttons
  if (!ss.shown && r.t === "clo") {
    document.querySelectorAll(".cloze-opt").forEach((btn) => {
      btn.onclick = () => {
        const val = btn.dataset.clozeVal;
        if (!val || r._isCorrect) return;
        if (val === it.w) {
          r._isCorrect = true;
          r._selected = val;
          playChime(true);
          say(it.w);
          renderCard();
          const rv = $("#btnReveal");
          if (rv) {
            rv.classList.add("ring-4", "ring-primary/40");
            rv.focus();
          }
        } else {
          r._wrongChoices = r._wrongChoices || [];
          if (!r._wrongChoices.includes(val)) {
            r._wrongChoices.push(val);
          }
          playChime(false);
          renderCard();
        }
      };
    });
  }

  // Bind stroke drawer button
  const strokeBtn = $("#btnToggleStrokes");
  const strokeDrawer = $("#strokesDrawer");
  if (strokeBtn && strokeDrawer) {
    strokeBtn.onclick = () => {
      strokeDrawer.classList.toggle("hidden");
      strokeDrawer.classList.toggle("flex");
      if (!strokeDrawer.classList.contains("hidden")) {
        chars.forEach((c, k) => {
          const el = $("#studyHw" + k);
          if (el && el.children.length === 0 && window.HanziWriter) {
            const writer = HanziWriter.create(el, c, {
              width: 100, height: 100, padding: 4, showOutline: true,
              strokeColor: "#86090a", outlineColor: "#EBE2D8", highlightColor: "#176b4b",
              charDataLoader: (ch, onLoad, onErr) => strokeData(ch).then(onLoad).catch(onErr)
            });
            const btnAnim = $(`[data-anim-k="${k}"]`);
            if (btnAnim) btnAnim.onclick = () => writer.animateCharacter();
            const btnQuiz = $(`[data-quiz-k="${k}"]`);
            if (btnQuiz) btnQuiz.onclick = () => writer.quiz();
          }
        });
      }
    };
  }

  // Bind stop button
  const btnStop = $("#btnStopSession");
  if (btnStop) {
    btnStop.onclick = () => {
      S.session = null;
      location.hash = "#trang-chu";
    };
  }

  // Bind reveal button
  const rv = $("#btnReveal");
  if (rv) rv.onclick = reveal;

  // Bind SRS grading and manual level buttons
  if (ss.shown) {
    document.querySelectorAll("[data-srs-grade]").forEach((btn) => {
      btn.onclick = async () => {
        const grade = Number(btn.dataset.srsGrade);
        document.querySelectorAll("[data-srs-grade], [data-word-level]").forEach((b) => (b.disabled = true));
        try {
          await applyCardGrade(r.n, r.t, grade, () => {
            ss.lastNote = r.n.key;
            ss.shown = false;
            ss.current = nextCard(Date.now());
            renderCard();
            window.scrollTo(0, 0);
          });
        } finally {
          document.querySelectorAll("[data-srs-grade], [data-word-level]").forEach((b) => (b.disabled = false));
        }
      };
    });

    document.querySelectorAll("[data-word-level]").forEach((btn) => {
      btn.onclick = async () => {
        const lvl = Number(btn.dataset.wordLevel);
        const chkAll = $("#chkAllSkills");
        const applyToAll = !!(chkAll && chkAll.checked);
        document.querySelectorAll("[data-srs-grade], [data-word-level]").forEach((b) => (b.disabled = true));
        try {
          await applyCardLevel(r.n, r.t, lvl, applyToAll, () => {
            ss.lastNote = r.n.key;
            ss.shown = false;
            ss.current = nextCard(Date.now());
            renderCard();
            window.scrollTo(0, 0);
          });
        } finally {
          document.querySelectorAll("[data-srs-grade], [data-word-level]").forEach((b) => (b.disabled = false));
        }
      };
    });
  }

  // Auto-play audio on question side (do not speak word before user answers cloze!)
  if (!ss.shown && r.n.kind !== "grammar" && r.t !== "wri" && r.t !== "clo") {
    say((r.t === "rec" && (it.e1 || it.e2)) ? (it.e1 || it.e2) : it.w);
  }
}

function reveal() {
  const ss = S.session;
  if (!ss || !ss.current || ss.shown) return;
  ss.shown = true;
  renderCard();
  window.scrollTo(0, 0);
  const r = ss.current;
  if (r.n.kind !== "grammar" && r.t !== "lis") say(itemOf(r.n).w);
}

document.addEventListener("keydown", (e) => {
  const ss = S.session;
  if (!ss || !ss.current || !location.hash.startsWith("#hoc")) return;
  const tag = e.target && e.target.tagName;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(tag) || (e.target && e.target.isContentEditable)) return;
  const keyLower = (e.key || "").toLowerCase();
  const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar" || e.keyCode === 32;
  if (keyLower === "r" || (e.key === "Shift" && !e.ctrlKey && !e.altKey && !e.metaKey)) {
    e.preventDefault();
    const r = ss.current;
    if (r && r.n && r.n.kind !== "grammar") {
      const it = itemOf(r.n);
      say((r.t === "rec" && (it.e1 || it.e2)) ? (it.e1 || it.e2) : it.w);
    }
    return;
  }
  if (!ss.shown && (isSpace || e.key === "Enter")) {
    e.preventDefault();
    e.stopPropagation();
    if (document.activeElement && document.activeElement.tagName === "BUTTON") {
      document.activeElement.blur();
    }
    reveal();
  } else if (!ss.shown && ss.current.t === "clo") {
    const k = keyLower;
    let idx = -1;
    if (["1", "a"].includes(k)) idx = 0;
    else if (["2", "b"].includes(k)) idx = 1;
    else if (["3", "c"].includes(k)) idx = 2;
    else if (["4", "d"].includes(k)) idx = 3;
    if (idx !== -1) {
      e.preventDefault();
      const targetBtn = document.querySelector(`[data-cloze-idx="${idx}"]`);
      if (targetBtn && !targetBtn.disabled) {
        targetBtn.click();
      }
    }
  } else if (ss.shown && ["1", "2", "3", "4"].includes(e.key)) {
    e.preventDefault();
    const targetBtn = document.querySelector(`[data-srs-grade="${e.key}"]`);
    if (targetBtn && !targetBtn.disabled) {
      targetBtn.click();
    }
  } else if (ss.shown && ["0", "5", "6"].includes(e.key)) {
    e.preventDefault();
    const lvl = e.key === "6" ? 0 : Number(e.key);
    const targetBtn = document.querySelector(`[data-word-level="${lvl}"]`);
    if (targetBtn && !targetBtn.disabled) {
      targetBtn.click();
    }
  }
}, true);


// =========================================================================
// 3. THƯ MỤC TỪ VỰNG & FLASHCARD SRS (Exact Stitch Design + Luxury Emerald Topics)
// =========================================================================
VIEWS["thu-muc"] = (id) => {
  const vocab = S.notes.filter((n) => n.kind === "vocab");
  const c = todayCounts();

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 1: XEM CHI TIẾT MỘT THƯ MỤC CỤ THỂ (id)
  // -------------------------------------------------------------
  if (id) {
    if (id === "hay-quen") {
      const weakNotes = vocab.filter((n) => (n.lapses || 0) > 0 || noteLevel(n) === 1);
      setView(`
        <div class="max-w-7xl mx-auto px-margin py-space-lg flex flex-col gap-space-lg">
          <div class="flex items-center gap-2">
            <a href="#thu-muc" class="text-primary hover:underline text-sm font-semibold flex items-center gap-1">
              <span class="material-symbols-outlined text-[18px]">arrow_back</span>
              <span>Trung tâm Từ vựng</span>
            </a>
          </div>
          <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-space-md">
            <div>
              <h1 class="font-headline-lg text-2xl font-bold text-on-surface">Sổ tay từ hay quên (${fmt(weakNotes.length)} từ)</h1>
              <p class="text-sm text-on-surface-variant">Các từ vựng bạn từng trả lời sai hoặc đang ở mức Mới học (Cấp 1).</p>
            </div>
            <a href="#hoc" class="px-4 py-2.5 rounded-xl bg-primary-container text-white font-semibold text-xs hover:bg-primary transition-colors no-underline">Ôn tập ngay</a>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
            ${weakNotes.map((n) => {
              const it = itemOf(n);
              const lvl = noteLevel(n);
              return `
                <div class="p-space-md rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between gap-2">
                  <div class="flex items-start justify-between">
                    <div>
                      <a href="#tu/${encodeURIComponent(it.w)}" class="font-headline-md text-2xl text-on-surface font-serif font-bold hover:text-primary">${esc(it.w)}</a>
                      <span class="font-code text-xs text-tertiary ml-2">${esc(it.py || "")}</span>
                    </div>
                    <span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span>
                  </div>
                  <div class="text-xs text-on-surface-variant">${esc(meaningOf(n))}</div>
                  <div class="pt-2 border-t border-border-subtle/50 flex justify-between text-xs">
                    <span class="text-outline">Quên: ${n.lapses || 0} lần</span>
                    <button type="button" class="text-secondary hover:underline font-semibold" onclick="startStudyWord('${esc(it.w)}')">Học từ này →</button>
                  </div>
                </div>
              `;
            }).join("") || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Tuyệt vời! Hiện chưa có từ nào trong danh sách hay quên.</div>`}
          </div>
        </div>
      `);
      return;
    }

    const isBand = S.bands.includes(id);
    const deck = S.decks.find((d) => d.id === id);
    const isTopic = deck && (deck.category === "topic" || deck.id.startsWith("band-"));
    const ns = folderNotes(id);
    const title = isBand ? `TOCFL ${id} (${BAND_INFO[id] || ""})` : (id === "cua-toi" ? "Thư mục của tôi" : (id === "viet-tat" ? "Từ viết tắt" : (deck ? deck.name : id)));
    const on = folderOn(id);
    const lv = [0, 0, 0, 0, 0, 0];
    ns.forEach((n) => lv[noteLevel(n)]++);
    const learnedCount = ns.filter((n) => noteLevel(n) > 0).length;
    const unseen = ns.filter((n) => n.kind === "vocab" && !hasProgress(n)).length;

    const now = Date.now();
    const needReviewCount = ns.filter((n) => {
      const types = typesOf(n);
      return types.some(([t]) => {
        const cid = cardId(n, t);
        const s = S.srs.get(cid);
        return s && s.state !== "new" && s.due <= now;
      });
    }).length;

    let filterLvl = -1;

    // GIAO DIỆN CHỦ ĐỀ THEO BAND (Emerald Green Header + Dark 3-Column Grid)
    if (isTopic) {
      const badgeCode = deck.badge || `${deck.band || "Band A"} - ${deck.theme || "主題"}`;
      const emojiIcon = deck.emoji || "🌻";

      setView(`
        <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-md md:py-space-lg flex flex-col gap-space-md">
          <!-- Back navigation -->
          <div class="flex items-center justify-between">
            <a href="#thu-muc" class="text-secondary hover:underline text-sm font-semibold flex items-center gap-1.5 transition-colors">
              <span class="material-symbols-outlined text-[20px]">arrow_back</span>
              <span>Tất cả thư mục</span>
            </a>
            <span class="text-xs text-outline font-code">Chủ đề chuẩn TOCFL 2024</span>
          </div>

          <!-- EMERALD HEADER BANNER -->
          <div class="bg-gradient-to-r from-[#0d6832] via-[#0f7638] to-[#14532d] text-white p-5 md:p-6 rounded-3xl shadow-md border border-[#1b7a3e]/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <div class="w-14 h-14 md:w-16 md:h-16 rounded-full border-2 border-white/80 bg-[#094721] flex items-center justify-center text-3xl md:text-4xl shrink-0 shadow-inner">
                <span>${emojiIcon}</span>
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <h1 class="text-2xl md:text-3xl font-extrabold font-headline-lg tracking-wide text-white">
                    ${esc(badgeCode)}
                  </h1>
                </div>
                <div class="flex items-center gap-2.5 flex-wrap text-xs md:text-sm font-medium">
                  <span class="inline-flex items-center gap-1.5 bg-black/25 px-3 py-1 rounded-full border border-white/15 text-emerald-100">
                    <span class="material-symbols-outlined text-[16px] text-[#4ade80]">check_circle</span>
                    <span><strong>${fmt(learnedCount)}/${fmt(ns.length)}</strong> 已學單字 (${ns.length ? Math.round((learnedCount / ns.length) * 100) : 0}%)</span>
                  </span>
                  <span class="inline-flex items-center gap-1.5 bg-black/25 px-3 py-1 rounded-full border border-white/15 text-amber-100">
                    <span class="material-symbols-outlined text-[16px] text-amber-300">schedule</span>
                    <span><strong>${fmt(needReviewCount)}</strong> 需複習</span>
                  </span>
                  <span class="text-xs text-white/80 hidden lg:inline">
                    · ${esc(deck.sub || deck.name)}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-wrap md:justify-end">
              <button type="button" class="px-5 py-2.5 rounded-xl font-bold text-xs bg-white text-[#0d6832] hover:bg-emerald-50 transition-all shadow-sm flex items-center gap-2 shrink-0 active:scale-95" id="btnStartStudyTopic">
                <span class="material-symbols-outlined text-[20px]">play_circle</span>
                <span>Bắt đầu học chủ đề này</span>
              </button>
              ${unseen ? `
                <a class="px-3.5 py-2.5 rounded-xl font-semibold text-xs bg-black/30 hover:bg-black/45 text-white border border-white/20 transition-all flex items-center gap-1.5 shadow-2xs" href="#loc-nhanh/${encodeURIComponent(id)}">
                  <span class="material-symbols-outlined text-[17px]">filter_alt</span>
                  <span>Lọc ${fmt(unseen)} từ mới</span>
                </a>
              ` : ""}
              <button type="button" class="px-3.5 py-2.5 rounded-xl font-semibold text-xs border border-white/25 text-white hover:bg-white/10 transition-all flex items-center gap-1.5" id="toggleLearnTopic">
                <span class="material-symbols-outlined text-[17px]">${on ? "pause" : "add"}</span>
                <span>${on ? "Đang bật SRS" : "+ Thêm vào SRS"}</span>
              </button>
            </div>
          </div>

          <!-- CONTROLS & FILTER BAR (Dark Theme Container) -->
          <div class="bg-[#121614] p-4 md:p-5 rounded-3xl border border-[#232f28] shadow-sm flex flex-col gap-4">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div class="relative flex-1">
                <span class="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-500/70 text-[20px]">search</span>
                <input id="topicSearch" class="w-full pl-11 pr-4 py-2.5 rounded-xl bg-[#181d1a] text-zinc-100 placeholder:text-zinc-500 border border-[#2b3931] focus:border-[#4ade80] focus:outline-none text-sm transition-colors" placeholder="Tìm theo chữ Hán Phồn thể, pinyin hoặc nghĩa tiếng Việt, tiếng Anh...">
              </div>

              <div class="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0" id="topicLevelFilter">
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${filterLvl === -1 ? 'bg-[#22c55e] text-zinc-950 border-transparent' : 'bg-[#181d1a] text-zinc-300 border-[#2b3931] hover:bg-[#202723]'}" data-lvl="-1">
                  Tất cả (${ns.length})
                </button>
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${filterLvl === 0 ? 'bg-[#22c55e] text-zinc-950 border-transparent' : 'bg-[#181d1a] text-zinc-300 border-[#2b3931] hover:bg-[#202723]'}" data-lvl="0">
                  Chưa học (${lv[0]})
                </button>
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${filterLvl === 2 ? 'bg-[#22c55e] text-zinc-950 border-transparent' : 'bg-[#181d1a] text-zinc-300 border-[#2b3931] hover:bg-[#202723]'}" data-lvl="2">
                  Nhớ tạm (${lv[2]})
                </button>
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${filterLvl === 4 ? 'bg-[#22c55e] text-zinc-950 border-transparent' : 'bg-[#181d1a] text-zinc-300 border-[#2b3931] hover:bg-[#202723]'}" data-lvl="4">
                  Thuộc lòng (${lv[4]})
                </button>
              </div>
            </div>

            <!-- 3-COLUMN LUXURY EMERALD CARDS GRID -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4" id="topicCardsGrid"></div>
          </div>
        </div>
      `);

      const drawTopicCards = () => {
        const q = fold($("#topicSearch").value);
        const filtered = ns.filter((n) => {
          const it = itemOf(n);
          const lvl = noteLevel(n);
          if (filterLvl !== -1 && lvl !== filterLvl) return false;
          if (!q) return true;
          return fold(it.w).includes(q) || fold(it.py || "").includes(q) || fold(meaningOf(n)).includes(q) || fold(it.hv || "").includes(q) || fold(it.en || "").includes(q);
        });

        $("#topicCardsGrid").innerHTML = filtered.map((n) => {
          const it = itemOf(n);
          const lvl = noteLevel(n);
          return `
            <div class="group relative bg-[#181d1a] hover:bg-[#1f2622] rounded-2xl p-4 border border-[#27352d] hover:border-[#4ade80]/60 transition-all shadow-xs flex items-center justify-between gap-3">
              <div class="w-12 h-12 rounded-full border-2 border-[#22c55e] flex items-center justify-center shrink-0 bg-[#0d2a1a] shadow-xs">
                <span class="text-2xl">${emojiIcon}</span>
              </div>

              <div class="flex-1 min-w-0 flex flex-col justify-center">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <a href="#tu/${encodeURIComponent(it.w)}" class="text-[#4ade80] font-bold text-xl md:text-2xl hover:underline font-serif tracking-wide truncate">
                    ${esc(it.w)}
                  </a>
                  <span class="text-xs text-emerald-300/80 font-code">${esc(it.py || "")}</span>
                  <span class="text-[10px] text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/10 font-code">${esc(it.band || "A0")}</span>
                </div>
                <div class="text-xs text-zinc-300 mt-1 line-clamp-1">
                  <span class="text-emerald-400/90 font-medium">${it.pos ? `(${esc(it.pos)}) ` : ""}</span>
                  <span>${esc(meaningOf(n))}</span>
                  ${it.en ? `<span class="text-zinc-500 text-[11px] ml-1">· ${esc(it.en)}</span>` : ""}
                </div>
                ${it.hv ? `<div class="text-[11px] text-zinc-400 mt-0.5">Hán Việt: <span class="text-zinc-300 font-medium">${esc(it.hv)}</span></div>` : ""}
              </div>

              <div class="flex flex-col items-center gap-1.5 shrink-0">
                <button type="button" class="w-8 h-8 rounded-full bg-white/5 hover:bg-[#22c55e]/20 text-zinc-300 hover:text-[#4ade80] flex items-center justify-center transition-colors" title="Phát âm tiếng Đài Loan" onclick="event.stopPropagation(); if(typeof speak==='function') speak('${esc(it.w)}');">
                  <span class="material-symbols-outlined text-[18px]">volume_up</span>
                </button>
                <button type="button" class="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center transition-colors" title="Học từ này ngay (Flashcard)" onclick="event.stopPropagation(); if(typeof startStudyWord==='function') startStudyWord('${esc(it.w)}');">
                  <span class="material-symbols-outlined text-[18px] ${lvl > 0 ? "text-[#4ade80]" : "text-zinc-500"}">bookmark</span>
                </button>
              </div>
            </div>
          `;
        }).join("") || `<div class="col-span-full p-8 text-center text-sm text-zinc-400 bg-[#181d1a] rounded-2xl border border-[#27352d]">Không tìm thấy từ nào khớp với từ khóa tìm kiếm.</div>`;
      };

      $("#topicSearch").oninput = drawTopicCards;
      document.querySelectorAll("#topicLevelFilter button").forEach((btn) => {
        btn.onclick = () => {
          filterLvl = Number(btn.dataset.lvl);
          document.querySelectorAll("#topicLevelFilter button").forEach((b) => {
            b.className = Number(b.dataset.lvl) === filterLvl
              ? "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border bg-[#22c55e] text-zinc-950 border-transparent"
              : "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border bg-[#181d1a] text-zinc-300 border-[#2b3931] hover:bg-[#202723]";
          });
          drawTopicCards();
        };
      });

      $("#btnStartStudyTopic").onclick = () => {
        if (typeof window.startStudyFolder === "function") window.startStudyFolder(id);
        else location.hash = "#hoc";
      };

      $("#toggleLearnTopic").onclick = async () => {
        setFolderOn(id, !on);
        await saveSettings();
        VIEWS["thu-muc"](id);
      };

      drawTopicCards();
      return;
    }

    // GIAO DIỆN CHUẨN CHO BANDS TOCFL VÀ SỔ CÁ NHÂN
    const groups = id === "cua-toi" ? [["all", "Tất cả"], ...S.decks.filter((d) => !d.id.startsWith("band-")).map((d) => [d.id, d.name])] : null;
    let grp = "all";

    setView(`
      <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
        <div class="flex items-center gap-2">
          <a href="#thu-muc" class="text-primary hover:underline text-sm font-semibold flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Tất cả thư mục</span>
          </a>
        </div>
        <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div class="flex flex-col gap-1">
            <h1 class="font-headline-lg text-2xl font-bold text-on-surface">${esc(title)}</h1>
            <p class="text-sm text-on-surface-variant">
              ${isBand ? esc(BAND_INFO[id]) + " · " : ""}Đã học <strong>${fmt(learnedCount)}</strong> / ${fmt(ns.length)} mục (${ns.length ? Math.round((learnedCount / ns.length) * 100) : 0}%)
              ${LEVELS.map((l, i) => (lv[i] ? ` · ${l}: ${lv[i]}` : "")).filter(Boolean).join("")}
            </p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" class="px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-colors ${on ? "bg-surface-container text-on-surface hover:bg-surface-container-high" : "bg-primary-container text-white hover:bg-primary"}" id="toggleLearn">
              ${on ? "Tạm dừng học thư mục này" : isBand ? "+ Đưa band này vào lịch học" : "+ Học thư mục này"}
            </button>
            <button type="button" class="px-4 py-2 rounded-xl text-xs font-semibold bg-secondary text-white hover:bg-secondary-fixed transition-colors flex items-center gap-1 shadow-xs" onclick="startStudyFolder('${esc(id)}')">
              <span class="material-symbols-outlined text-[16px]">play_circle</span>
              <span>Học ngay thư mục này</span>
            </button>
            ${unseen ? `
              <a class="px-4 py-2 rounded-xl text-xs font-semibold bg-jade-subtle text-secondary border border-secondary/30 hover:bg-secondary-fixed transition-colors flex items-center gap-1 shadow-xs" href="#loc-nhanh/${encodeURIComponent(id)}">
                <span class="material-symbols-outlined text-[16px]">filter_alt</span>
                <span>Lọc nhanh: ${fmt(unseen)} từ chưa học</span>
              </a>
            ` : ""}
          </div>
        </div>

        <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle shadow-xs flex flex-col gap-3">
          ${groups ? `
            <div class="flex items-center gap-2 flex-wrap" id="grp">
              ${groups.map(([v, t]) => `
                <button type="button" class="px-3 py-1 rounded-lg text-xs font-semibold transition-colors border ${v === "all" ? "bg-primary-container text-white border-transparent" : "bg-paper-muted text-on-surface border-border-subtle hover:bg-surface-container"}" data-v="${esc(v)}">
                  ${esc(t)}
                </button>
              `).join("")}
            </div>
          ` : ""}
          <div class="relative w-full">
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
            <input id="fq" class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-low text-on-surface text-sm placeholder:text-outline border border-border-subtle/50 focus:outline-none focus:bg-white" placeholder="Lọc theo chữ Hán, pinyin hoặc nghĩa tiếng Việt...">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md" id="flist"></div>
      </div>
    `);

    const draw = () => {
      const f = fold($("#fq").value);
      const filtered = ns.filter((n) => (grp === "all" || (n.rich && n.deck.id === grp)) && (!f || fold(itemOf(n).w).includes(f) || fold(itemOf(n).py).includes(f) || fold(meaningOf(n)).includes(f)));
      $("#flist").innerHTML = filtered.map((n) => {
        const it = itemOf(n);
        const lvl = noteLevel(n);
        const ab = S.abbrS.get(n.w);
        return `
          <div class="p-space-md rounded-2xl bg-paper-card border border-border-subtle shadow-xs hover:border-primary/40 hover:shadow-sm transition-all flex flex-col justify-between gap-2">
            <div class="flex items-start justify-between">
              <div>
                <a href="#tu/${encodeURIComponent(it.w)}" class="font-headline-md text-2xl text-on-surface font-serif font-bold hover:text-primary">${esc(n.basic ? n.display : it.w)}</a>
                <span class="font-code text-xs text-tertiary ml-2">${esc(it.py || "")}</span>
              </div>
              <span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span>
            </div>
            <div class="text-xs text-on-surface-variant line-clamp-2">
              ${esc(meaningOf(n) || "…")}
            </div>
            ${ab ? `<div class="text-[11px] text-tertiary">Nói tắt của: <span class="font-serif font-semibold">${esc(ab.f)}</span></div>` : ""}
            <div class="pt-2 border-t border-border-subtle/50 flex items-center justify-between text-xs">
              <span class="text-outline">${n.kind === "grammar" ? "Ngữ pháp" : (it.pos || "Từ vựng")}</span>
              <div class="flex items-center gap-2">
                <button type="button" class="text-secondary hover:underline font-semibold" onclick="startStudyWord('${esc(it.w)}')">Học từ này →</button>
                <a href="#tu/${encodeURIComponent(it.w)}" class="text-primary hover:underline font-semibold">Chi tiết</a>
              </div>
            </div>
          </div>
        `;
      }).join("") || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy mục nào khớp.</div>`;
    };

    $("#fq").oninput = draw;
    $("#toggleLearn").onclick = async () => {
      setFolderOn(id, !on);
      await saveSettings();
      VIEWS["thu-muc"](id);
    };
    if (groups) {
      document.querySelectorAll("#grp button").forEach((b) => {
        b.onclick = () => {
          grp = b.dataset.v;
          document.querySelectorAll("#grp button").forEach((btn) => {
            btn.className = btn.dataset.v === grp ? "px-3 py-1 rounded-lg text-xs font-semibold bg-primary-container text-white border-transparent" : "px-3 py-1 rounded-lg text-xs font-semibold bg-paper-muted text-on-surface border-border-subtle hover:bg-surface-container";
          });
          draw();
        };
      });
    }
    draw();
    return;
  }

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 2: TRUNG TÂM TỪ VỰNG & FLASHCARD SRS (EXACT STITCH OVERVIEW)
  // -------------------------------------------------------------
  const topicDecks = S.decks.filter((d) => d.category === "topic" || d.id.startsWith("band-"));
  const summary = studySummary(S.stats, Date.now());
  const lvAll = [0, 0, 0, 0, 0, 0];
  vocab.forEach((n) => lvAll[noteLevel(n)]++);
  const totalVocab = Math.max(1, vocab.length);
  const activeVocabCount = vocab.filter((n) => inLearning(n)).length;
  const totalFoldersCount = topicDecks.length + S.bands.length + 2;

  // Build Flashcard pool for the integrated Stitch Flashcard Canvas
  const flashPool = vocab.filter((n) => inLearning(n) && (meaningOf(n) || itemOf(n).py)).slice(0, 80);
  if (!flashPool.length && vocab.length) flashPool.push(...vocab.slice(0, 30));
  let fcIdx = 0;
  // Find 謙虛 if available or start at 0
  const qianXuIdx = flashPool.findIndex((n) => n.w === "謙虛");
  if (qianXuIdx >= 0) fcIdx = qianXuIdx;

  // Build unified Folder Items list for the Stitch 2-Col Folder Grid
  const allFolderItems = [
    // Topic decks first + TOCFL bands + Personal folders
    ...S.bands.map((b) => {
      const ns = vocab.filter((n) => inBand(n, b));
      const l = ns.filter((n) => noteLevel(n) > 0).length;
      const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
      const isLearning = !!S.settings.bands[b];
      const iconBg = b.startsWith("B") ? "bg-amber-subtle text-tertiary" : (b.startsWith("C") ? "bg-jade-subtle text-secondary" : "bg-cinnabar-subtle text-primary");
      const barBg = b.startsWith("B") ? "bg-tertiary" : (b.startsWith("C") ? "bg-secondary" : "bg-primary-container");
      return {
        id: b,
        cat: "bands",
        tag: "TOCFL Chuẩn",
        iconText: b.replace("Novice ", "N"),
        iconBg,
        barBg,
        title: `TOCFL ${b} • ${BAND_INFO[b] || "Từ vựng chuẩn"}`,
        sub: `${fmt(ns.length)} từ vựng chuẩn kỳ thi năng lực Hoa ngữ Đài Loan cấp ${b}.`,
        learned: l,
        total: ns.length,
        pct,
        isLearning,
        isBand: true
      };
    }),
    ...topicDecks.map((d) => {
      const ns = folderNotes(d.id);
      const l = ns.filter((n) => noteLevel(n) > 0).length;
      const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
      const isLearning = folderOn(d.id);
      return {
        id: d.id,
        cat: "topics",
        tag: d.badge || "Chủ đề",
        iconText: d.emoji || "🌻",
        iconBg: "bg-jade-subtle text-secondary",
        barBg: "bg-secondary",
        title: d.name,
        sub: d.sub || "Bộ từ vựng theo chủ đề thực tế Đài Loan.",
        learned: l,
        total: ns.length,
        pct,
        isLearning,
        isBand: false
      };
    }),
    (() => {
      const ns = folderNotes("cua-toi");
      const l = ns.filter((n) => noteLevel(n) > 0).length;
      const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
      return {
        id: "cua-toi",
        cat: "personal",
        tag: "Bộ của tôi",
        iconText: "我",
        iconBg: "bg-surface-container text-on-surface",
        barBg: "bg-secondary",
        title: "Thư mục của tôi • 個人詞庫",
        sub: "Từ vựng ghi chép trên lớp, giáo trình Đương Đại và các đợt thi cá nhân.",
        learned: l,
        total: ns.length,
        pct,
        isLearning: folderOn("cua-toi"),
        isBand: false
      };
    })(),
    (() => {
      const ns = folderNotes("viet-tat");
      const l = ns.filter((n) => noteLevel(n) > 0).length;
      const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
      return {
        id: "viet-tat",
        cat: "personal",
        tag: "Bộ của tôi",
        iconText: "臺",
        iconBg: "bg-cinnabar-subtle text-primary",
        barBg: "bg-primary-container",
        title: "Khẩu ngữ & Từ viết tắt Đài Loan",
        sub: "Các từ viết tắt chuẩn từ điển 萌典 như 北車, 健保, 高鐵, 公車...",
        learned: l,
        total: ns.length,
        pct,
        isLearning: folderOn("viet-tat"),
        isBand: false
      };
    })()
  ];

  // Roadmap stats for A1, A2, B1
  const getBandStat = (b) => {
    const ns = vocab.filter((n) => inBand(n, b));
    const l = ns.filter((n) => noteLevel(n) > 0).length;
    const pct = ns.length ? Math.round((l / ns.length) * 1000) / 10 : 0;
    return { l, total: ns.length, pct };
  };
  const stA1 = getBandStat("A1");
  const stA2 = getBandStat("A2");
  const stB1 = getBandStat("B1");
  const buildFolderCardsHTML = (catFilter = "all", qStr = "") => {
    const q = fold(qStr || "");
    const filtered = allFolderItems.filter((f) => {
      if (catFilter !== "all" && f.cat !== catFilter) return false;
      if (!q) return true;
      return fold(f.title).includes(q) || fold(f.sub).includes(q) || fold(f.tag).includes(q);
    });
    return filtered.map((f) => `
      <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle/70 shadow-[0_2px_8px_rgba(44,42,41,0.03)] hover:shadow-md transition-all duration-200 flex flex-col justify-between group">
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-start justify-between">
            <a href="#thu-muc/${encodeURIComponent(f.id)}" class="w-10 h-10 rounded-xl ${f.iconBg} flex items-center justify-center no-underline">
              <span class="font-headline-md font-bold text-lg">${esc(f.iconText)}</span>
            </a>
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-sm text-[11px] font-semibold">${esc(f.tag)}</span>
              ${f.isBand ? `
                <button type="button" class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${f.isLearning ? "bg-jade-subtle text-secondary border-secondary/30" : "bg-paper-muted text-outline border-border-subtle"}" data-toggle-band="${esc(f.id)}">
                  ${f.isLearning ? "Đang học" : "+ Bật"}
                </button>
              ` : ""}
            </div>
          </div>
          <div class="mt-1">
            <a href="#thu-muc/${encodeURIComponent(f.id)}" class="no-underline">
              <h3 class="font-headline-md text-headline-md text-on-surface font-semibold group-hover:text-primary transition-colors">
                ${esc(f.title)}
              </h3>
            </a>
            <p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-1 mt-0.5">
              ${esc(f.sub)}
            </p>
          </div>
        </div>
        <div class="mt-space-md pt-space-xs">
          <div class="flex justify-between items-center text-label-sm font-label-sm mb-1.5">
            <span class="text-outline">Tiến độ nắm vững</span>
            <span class="font-code text-on-surface font-semibold">${fmt(f.learned)} / ${fmt(f.total)} từ (${f.pct}%)</span>
          </div>
          <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
            <div class="h-full rounded-full ${f.barBg}" style="width: ${f.pct}%"></div>
          </div>
          <div class="flex items-center justify-between mt-space-md pt-space-xs border-t border-border-subtle/50">
            <a href="#thu-muc/${encodeURIComponent(f.id)}" class="font-code text-xs text-primary hover:underline font-semibold flex items-center gap-1 no-underline">
              <span>Xem ${fmt(f.total)} từ →</span>
            </a>
            <button type="button" class="px-3 py-1.5 rounded-lg bg-primary-container text-on-primary text-label-sm font-label-sm font-semibold hover:bg-primary transition-colors flex items-center gap-1 shadow-sm" onclick="startStudyFolder('${esc(f.id)}')">
              <span class="material-symbols-outlined text-[16px]">play_arrow</span>
              <span>Học ngay</span>
            </button>
          </div>
        </div>
      </div>
    `).join("") || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy thư mục nào khớp.</div>`;
  };

  setView(`
    <div class="relative w-full overflow-hidden">
      <div class="absolute -top-24 -left-20 w-96 h-96 rounded-full bg-cinnabar-subtle blur-3xl opacity-60 pointer-events-none"></div>
      <div class="absolute top-80 -right-24 w-96 h-96 rounded-full bg-jade-subtle blur-3xl opacity-50 pointer-events-none"></div>
      <div class="max-w-7xl mx-auto px-margin py-space-lg flex flex-col gap-space-xl relative">
        <!-- ================= HEADER / CONTROL PANEL (Exact Stitch) ================= -->
        <section class="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md pb-space-md border-b border-border-subtle/70">
          <div class="flex flex-col gap-space-xs max-w-2xl">
            <div class="flex items-center gap-space-xs text-primary font-label-sm text-label-sm tracking-wider uppercase">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-primary-container"></span>
              <span>Thư phòng học tập</span>
              <span class="text-outline/40">•</span>
              <span class="font-headline-md font-semibold tracking-normal">詞庫與單字卡</span>
            </div>
            <h1 class="font-display text-display text-on-surface tracking-tight font-semibold">
              Trung tâm Từ vựng &amp; Flashcard SRS
            </h1>
            <p class="font-body-md text-body-md text-on-surface-variant">
              Hệ thống quản lý kho từ phồn thể, phân loại chu kỳ Spaced Repetition (SRS 6 cấp độ) và chế độ phản xạ phát âm chuẩn Đài Loan.
            </p>
          </div>
          <!-- Action cluster -->
          <div class="flex flex-wrap items-center gap-space-sm pt-space-xs lg:pt-0">
            <a href="#thu-muc/cua-toi" class="px-space-md py-2.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface hover:bg-paper-muted text-label-md font-label-md shadow-sm transition-all duration-150 flex items-center gap-1.5 no-underline" id="quick-add-btn">
              <span class="material-symbols-outlined text-[18px] text-outline">folder_open</span>
              <span>+ Mở sổ từ của tôi</span>
            </a>
            <a href="#nhap" class="px-space-md py-2.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface hover:bg-paper-muted text-label-md font-label-md shadow-sm transition-all duration-150 flex items-center gap-1.5 no-underline">
              <span class="material-symbols-outlined text-[18px] text-outline">file_upload</span>
              <span>+ Nhập bộ từ</span>
            </a>
            <a href="#hoc" class="px-space-lg py-2.5 rounded-lg bg-primary-container text-on-primary hover:bg-primary text-label-md font-label-md shadow-[0_2px_8px_rgba(168,38,31,0.25)] hover:shadow-md transition-all duration-150 flex items-center gap-2 no-underline">
              <span class="material-symbols-outlined text-[18px]">play_circle</span>
              <span class="font-semibold">Học ngay hôm nay</span>
              <span class="px-1.5 py-0.5 rounded-full bg-on-primary/20 text-on-primary font-code text-code text-[11px]">${fmt(c.total)} thẻ</span>
            </a>
          </div>
        </section>

        <!-- ================= TAB NAVIGATION (Exact Stitch) ================= -->
        <div class="flex items-center justify-between gap-space-md flex-wrap">
          <div class="inline-flex p-1 rounded-xl bg-surface-container-high/80 shadow-inner flex-wrap">
            <button type="button" class="view-tab-btn px-space-md py-2 rounded-lg font-label-md text-label-md font-semibold transition-all duration-150 flex items-center gap-2 bg-paper-card text-primary shadow-sm" id="view-tab-integrated">
              <span class="material-symbols-outlined text-[18px]">splitscreen</span>
              <span>Chế độ tích hợp (Flashcard + Kho từ)</span>
            </button>
            <button type="button" class="view-tab-btn px-space-md py-2 rounded-lg font-label-md text-label-md font-medium text-on-surface-variant hover:text-on-surface transition-all duration-150 flex items-center gap-2" id="view-tab-library">
              <span class="material-symbols-outlined text-[18px]">folder_special</span>
              <span>Thư mục &amp; Kho từ vựng (${totalFoldersCount})</span>
            </button>
            <button type="button" class="view-tab-btn px-space-md py-2 rounded-lg font-label-md text-label-md font-medium text-on-surface-variant hover:text-on-surface transition-all duration-150 flex items-center gap-2" id="view-tab-focus">
              <span class="material-symbols-outlined text-[18px]">style</span>
              <span>Phiên học Flashcard hiện tại</span>
              <span class="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
            </button>
          </div>
          <div class="flex items-center gap-space-sm font-label-sm text-label-sm text-outline">
            <span class="flex items-center gap-1">
              <kbd class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-code text-code text-[11px] shadow-sm">Space</kbd>
              <span>Đổi thẻ</span>
            </span>
            <span class="text-outline/40">•</span>
            <span class="flex items-center gap-1">
              <kbd class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-code text-code text-[11px] shadow-sm">Shift</kbd>
              <span>Phát âm</span>
            </span>
            <span class="text-outline/40">•</span>
            <span class="flex items-center gap-1">
              <kbd class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-code text-code text-[11px] shadow-sm">Alt + D</kbd>
              <span>Tra nhanh</span>
            </span>
          </div>
        </div>

        <!-- ================= SECTION 1: FLASHCARD SRS & TRA CỨU NHANH (Exact Stitch 8+4) ================= -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg" id="flashcard-section">
          <!-- Left: Flashcard Interactive Canvas (8 Cols) -->
          <div class="lg:col-span-8 flex flex-col gap-space-md" id="stitch-flashcard-box"></div>

          <!-- Right: Real-time Quick Lookup Sidebar Panel (隨堂快查) (4 Cols) -->
          <div class="lg:col-span-4 flex flex-col gap-space-md">
            <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle/70 shadow-[0_2px_12px_rgba(44,42,41,0.04)] flex flex-col gap-space-md h-full">
              <div class="flex items-center justify-between pb-2 border-b border-border-subtle/50">
                <div class="flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-[18px] text-tertiary">search_insights</span>
                  <span class="font-headline-md text-headline-md text-on-surface font-semibold">Tra từ nhanh</span>
                  <span class="font-headline-md text-xs text-outline font-normal">隨堂快查</span>
                </div>
                <kbd class="px-1.5 py-0.5 rounded bg-surface-container text-outline font-code text-code text-[10px]">Alt + D</kbd>
              </div>
              <!-- Instant search box -->
              <div class="relative">
                <input class="w-full pl-9 pr-8 py-2 rounded-xl bg-paper-base border border-border-subtle focus:border-primary-container focus:ring-2 focus:ring-primary-container/20 text-body-md text-on-surface outline-none transition-all font-body-md" id="quick-search-input" placeholder="Nhập chữ Hán, Pinyin hoặc nghĩa..." type="text" value="客氣"/>
                <span class="material-symbols-outlined absolute left-2.5 top-2.5 text-outline text-[18px]">search</span>
                <button type="button" class="absolute right-2.5 top-2.5 text-outline hover:text-on-surface" id="btn-clear-quick-search">
                  <span class="material-symbols-outlined text-[16px]">cancel</span>
                </button>
              </div>
              <!-- Instant Lookup Preview Card -->
              <div class="flex flex-col gap-space-sm p-space-sm rounded-xl bg-surface-container-low/80 flex-1 overflow-y-auto" id="quick-search-preview"></div>
              <!-- Mini Daily Streak Badge -->
              <div class="flex items-center justify-between p-2.5 rounded-xl bg-jade-subtle/60 text-secondary">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[20px] text-secondary">local_fire_department</span>
                  <div class="flex flex-col">
                    <span class="font-label-sm text-label-sm font-bold">Chuỗi học tập: ${summary.current} ngày</span>
                    <span class="font-body-sm text-[11px] text-secondary/80">Mục tiêu: ${S.settings.newPerDay || 8} từ mới mỗi ngày</span>
                  </div>
                </div>
                <a href="#hoc" class="font-code text-code font-bold text-secondary hover:underline">Ôn ngay →</a>
              </div>
            </div>
          </div>
        </section>

        <!-- ================= SECTION 2: KHO TỪ VỰNG & THƯ MỤC CHỦ ĐỀ (Exact Stitch) ================= -->
        <section class="flex flex-col gap-space-lg" id="library-section">
          <!-- Filter bar, search and statistics summary -->
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md pt-space-xs">
            <!-- Category Filter Pills -->
            <div class="flex items-center gap-space-xs flex-wrap" id="folderTabs">
              <button type="button" class="px-3.5 py-1.5 rounded-full bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-sm" data-tab="all">
                Tất cả (${allFolderItems.length})
              </button>
              <button type="button" class="px-3.5 py-1.5 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted font-label-md text-label-md transition-colors shadow-sm" data-tab="topics">
                🌸 Chủ đề theo Band (${topicDecks.length})
              </button>
              <button type="button" class="px-3.5 py-1.5 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted font-label-md text-label-md transition-colors shadow-sm" data-tab="bands">
                TOCFL Chuẩn (${S.bands.length})
              </button>
              <button type="button" class="px-3.5 py-1.5 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted font-label-md text-label-md transition-colors shadow-sm" data-tab="personal">
                Bộ từ của tôi (2)
              </button>
            </div>
            <!-- Search Folder Input -->
            <div class="relative w-full md:w-72">
              <input id="folderSearchInput" class="w-full pl-9 pr-3 py-1.5 rounded-xl bg-paper-card border border-border-subtle focus:border-primary-container text-body-md text-on-surface outline-none transition-all shadow-sm" placeholder="Tìm kiếm bộ từ hoặc nhãn..." type="text"/>
              <span class="material-symbols-outlined absolute left-2.5 top-2 text-outline text-[18px]">filter_list</span>
            </div>
          </div>

          <!-- Bento Grid: Main Vocabulary Folders (8 Cols) & Sidebar Stats (4 Cols) -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
            <!-- Main Folder Grid (8 Cols) -->
            <div class="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-space-md" id="stitch-folders-grid">${buildFolderCardsHTML("all", "")}</div>

            <!-- Right: Sidebar Statistics & TOCFL Progress Chart (4 Cols) -->
            <div class="lg:col-span-4 flex flex-col gap-space-md">
              <!-- Thống kê Từ viện (Stats) -->
              <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle/70 shadow-[0_2px_12px_rgba(44,42,41,0.04)] flex flex-col gap-space-md">
                <div class="flex items-center justify-between pb-2 border-b border-border-subtle/50">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-primary-container"></span>
                    <h3 class="font-headline-md text-headline-md text-on-surface font-semibold">Tổng quan Từ viện</h3>
                  </div>
                  <span class="font-label-sm text-label-sm text-outline">Thời gian thực</span>
                </div>
                <!-- Metric tiles -->
                <div class="grid grid-cols-2 gap-space-sm">
                  <div class="p-space-sm rounded-xl bg-surface-container-low flex flex-col">
                    <span class="font-label-sm text-label-sm text-outline">Tổng thư mục</span>
                    <span class="font-code text-2xl font-bold text-on-surface mt-1">${totalFoldersCount}</span>
                    <span class="font-body-sm text-[11px] text-secondary mt-0.5">${topicDecks.length} chủ đề · ${S.bands.length} band</span>
                  </div>
                  <div class="p-space-sm rounded-xl bg-surface-container-low flex flex-col">
                    <span class="font-label-sm text-label-sm text-outline">Thẻ hoạt động</span>
                    <span class="font-code text-2xl font-bold text-on-surface mt-1">${fmt(activeVocabCount)}</span>
                    <span class="font-body-sm text-[11px] text-tertiary mt-0.5">SRS hoạt động</span>
                  </div>
                  <div class="p-space-sm rounded-xl bg-cinnabar-subtle flex flex-col col-span-2">
                    <div class="flex items-center justify-between">
                      <span class="font-label-sm text-label-sm text-primary font-semibold">Thẻ đến hạn hôm nay</span>
                      <span class="material-symbols-outlined text-primary text-[18px]">alarm</span>
                    </div>
                    <div class="flex items-baseline gap-2 mt-1">
                      <span class="font-code text-3xl font-bold text-primary">${fmt(c.total)}</span>
                      <span class="font-body-sm text-body-sm text-on-surface-variant">từ cần lặp lại phản xạ (${fmt(c.due)} ôn · ${fmt(c.fresh)} mới)</span>
                    </div>
                  </div>
                </div>
                <!-- Spaced Repetition Distribution Chart -->
                <div class="flex flex-col gap-1.5 pt-2 border-t border-border-subtle/40">
                  <span class="font-label-sm text-label-sm text-outline">Phân bổ 6 cấp độ SRS:</span>
                  <div class="w-full h-3 rounded-full bg-surface-container flex overflow-hidden">
                    <div class="h-full bg-outline/40" style="width: ${Math.round((lvAll[0] / totalVocab) * 100)}%" title="Cấp 1: Chưa học (${lvAll[0]})"></div>
                    <div class="h-full bg-tertiary-fixed-dim" style="width: ${Math.round((lvAll[1] / totalVocab) * 100)}%" title="Cấp 2: Mới học (${lvAll[1]})"></div>
                    <div class="h-full bg-tertiary" style="width: ${Math.round((lvAll[2] / totalVocab) * 100)}%" title="Cấp 3: Nhớ tạm (${lvAll[2]})"></div>
                    <div class="h-full bg-secondary-fixed-dim" style="width: ${Math.round((lvAll[3] / totalVocab) * 100)}%" title="Cấp 4: Nhớ lâu (${lvAll[3]})"></div>
                    <div class="h-full bg-secondary" style="width: ${Math.round((lvAll[4] / totalVocab) * 100)}%" title="Cấp 5: Thuộc lòng (${lvAll[4]})"></div>
                    <div class="h-full bg-primary-container" style="width: ${Math.round((lvAll[5] / totalVocab) * 100)}%" title="Cấp 6: Thông thạo (${lvAll[5]})"></div>
                  </div>
                  <div class="flex justify-between items-center text-[10px] font-code text-outline pt-1">
                    <span>Chưa học (${fmt(lvAll[0])})</span>
                    <span>Đã ghi nhớ (${fmt(totalVocab - lvAll[0])})</span>
                  </div>
                </div>
              </div>

              <!-- Lộ trình TOCFL Đài Loan (TOCFL Roadmap) -->
              <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle/70 shadow-[0_2px_12px_rgba(44,42,41,0.04)] flex flex-col gap-space-md">
                <div class="flex items-center justify-between pb-2 border-b border-border-subtle/50">
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-[20px] text-primary">school</span>
                    <h3 class="font-headline-md text-headline-md text-on-surface font-semibold">Lộ trình TOCFL</h3>
                  </div>
                  <span class="px-2 py-0.5 rounded-full bg-jade-subtle text-secondary font-code text-code text-[11px] font-semibold">Chuẩn 2024</span>
                </div>
                <div class="flex flex-col gap-space-sm">
                  <a href="#thu-muc/A1" class="p-space-sm rounded-xl bg-surface-container-low/60 hover:bg-surface-container flex flex-col gap-1 no-underline transition-colors">
                    <div class="flex justify-between items-center">
                      <span class="font-headline-md text-sm font-semibold text-on-surface">Band A (A1) • Nhập môn</span>
                      <span class="font-code text-code font-bold text-secondary">${stA1.pct}%</span>
                    </div>
                    <div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
                      <div class="h-full bg-secondary rounded-full" style="width: ${stA1.pct}%"></div>
                    </div>
                    <span class="font-code text-[11px] text-outline">${fmt(stA1.l)} / ${fmt(stA1.total)} từ chuẩn</span>
                  </a>
                  <a href="#thu-muc/A2" class="p-space-sm rounded-xl bg-surface-container-low/60 hover:bg-surface-container flex flex-col gap-1 no-underline transition-colors">
                    <div class="flex justify-between items-center">
                      <span class="font-headline-md text-sm font-semibold text-on-surface">Band A (A2) • Căn bản</span>
                      <span class="font-code text-code font-bold text-secondary">${stA2.pct}%</span>
                    </div>
                    <div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
                      <div class="h-full bg-secondary rounded-full" style="width: ${stA2.pct}%"></div>
                    </div>
                    <span class="font-code text-[11px] text-outline">${fmt(stA2.l)} / ${fmt(stA2.total)} từ chuẩn</span>
                  </a>
                  <a href="#thu-muc/B1" class="p-space-sm rounded-xl bg-surface-container-low/60 hover:bg-surface-container flex flex-col gap-1 no-underline transition-colors">
                    <div class="flex justify-between items-center">
                      <span class="font-headline-md text-sm font-semibold text-on-surface">Band B (B1) • Tiến giai</span>
                      <span class="font-code text-code font-bold text-tertiary">${stB1.pct}%</span>
                    </div>
                    <div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
                      <div class="h-full bg-tertiary rounded-full" style="width: ${stB1.pct}%"></div>
                    </div>
                    <span class="font-code text-[11px] text-outline">${fmt(stB1.l)} / ${fmt(stB1.total)} từ chuẩn</span>
                  </a>
                </div>
                <div class="p-space-sm rounded-xl bg-cinnabar-subtle/80 flex items-start gap-2 text-primary">
                  <span class="material-symbols-outlined text-[18px] mt-0.5">flag</span>
                  <div class="text-body-sm text-xs">
                    <span class="font-semibold">Mục tiêu trọng tâm:</span> Kết hợp học Chủ đề theo Band và làm đề thi thử CAT.
                  </div>
                </div>
              </div>

              <!-- Scholar Book/Resource Promo -->
              <div class="relative rounded-2xl overflow-hidden shadow-sm bg-gradient-to-br from-paper-muted to-surface-container p-space-md border border-border-subtle/70">
                <div class="flex items-center gap-space-sm mb-2">
                  <span class="material-symbols-outlined text-secondary text-[20px]">auto_stories</span>
                  <span class="font-headline-md text-sm font-semibold text-on-surface">Tài liệu học kèm</span>
                </div>
                <p class="font-body-sm text-body-sm text-on-surface-variant">
                  Nghe hội thoại Đài Loan song ngữ và làm đề thi thử trực tuyến mô phỏng giao diện CAT.
                </p>
                <a href="#thi-thu" class="mt-3 text-primary hover:text-primary-container font-label-md text-label-md font-semibold flex items-center gap-1 no-underline">
                  <span>Vào phòng thi thử CAT</span>
                  <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `);

  // Render Live Stitch Flashcard Canvas
  const renderFlashcardCanvas = () => {
    const box = $("#stitch-flashcard-box");
    if (!box || !flashPool.length) return;
    const n = flashPool[fcIdx % flashPool.length];
    const it = itemOf(n);
    const lvl = noteLevel(n);
    const bandLabel = it.band ? `TOCFL ${it.band}` : "TOCFL B1";
    const posLabel = it.pos || "TỪ VỰNG";
    const hvLabel = it.hv ? it.hv.toUpperCase() : "PHỒN THỂ ĐÀI LOAN";
    const exZh = it.ex ? it.ex.split("\n")[0] : `我們在日常生活中經常使用「${it.w}」這個詞。`;
    const exVn = it.exVn || it.ex?.split("\n")[1] || `Từ "${it.w}" (${meaningOf(n)}) rất thông dụng trong giao tiếp tại Đài Loan.`;
    const lvlDays = ["0 ngày", "1 ngày", "3 ngày", "7 ngày", "14 ngày", "30 ngày"];

    box.innerHTML = `
      <div class="relative bg-paper-card rounded-2xl p-space-lg border border-border-subtle/70 shadow-[0_2px_12px_rgba(44,42,41,0.04)] flex flex-col justify-between min-h-[440px] overflow-hidden group">
        <!-- Traditional watermarked red seal accent -->
        <div class="absolute -right-6 -bottom-6 w-32 h-32 rounded-full border border-primary/10 flex items-center justify-center pointer-events-none select-none">
          <span class="font-headline-lg text-primary/10 text-4xl font-bold">${esc((it.w || "學")[0])}</span>
        </div>
        <!-- Top card info bar -->
        <div class="flex items-center justify-between pb-space-sm border-b border-border-subtle/50 flex-wrap gap-2">
          <div class="flex items-center gap-space-xs">
            <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
            <span class="font-headline-md text-headline-md text-on-surface font-semibold">${esc(bandLabel)} • 進階詞庫</span>
            <span class="text-outline/40">•</span>
            <span class="font-code text-code text-outline">Thẻ ${(fcIdx % flashPool.length) + 1} / ${flashPool.length}</span>
          </div>
          <div class="flex items-center gap-space-xs">
            <span class="px-2 py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-label-sm font-semibold flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">psychology</span>
              <span>SRS Cấp ${lvl + 1} • ${esc(LEVELS[lvl])}</span>
            </span>
            <button type="button" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-colors" id="btn-fc-prev" title="Thẻ trước">←</button>
            <button type="button" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-colors" id="btn-fc-next" title="Thẻ tiếp theo (Space)">Tiếp →</button>
            <a href="#tu/${encodeURIComponent(it.w)}" class="p-1 rounded text-outline hover:text-primary transition-colors" title="Mở chi tiết từ điển">
              <span class="material-symbols-outlined text-[20px]">open_in_new</span>
            </a>
          </div>
        </div>
        <!-- Center flashcard body with symmetrical layout -->
        <div class="py-space-md flex flex-col items-center justify-center my-auto text-center relative z-10">
          <!-- Symmetrical metadata banner -->
          <div class="w-full grid grid-cols-1 md:grid-cols-2 gap-space-md items-center mb-space-md px-space-sm">
            <!-- Left: Part of Speech & Level -->
            <div class="flex flex-col md:items-start text-left bg-surface-container-low/60 p-space-sm rounded-xl">
              <span class="font-label-sm text-label-sm uppercase text-outline tracking-wider">Từ tính &amp; Cấp bậc</span>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="font-label-md text-label-md text-primary font-semibold">${esc(posLabel.toUpperCase())}</span>
                <span class="px-1.5 py-0.5 rounded bg-cinnabar-subtle text-primary text-[10px] font-semibold">${esc(bandLabel)}</span>
              </div>
            </div>
            <!-- Right: Sino-Vietnamese Han Viet -->
            <div class="flex flex-col md:items-end text-right bg-surface-container-low/60 p-space-sm rounded-xl">
              <span class="font-label-sm text-label-sm uppercase text-outline tracking-wider">Hán Việt giải nghĩa</span>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="font-headline-md text-headline-md text-on-surface font-semibold tracking-wide">${esc(hvLabel)}</span>
              </div>
            </div>
          </div>
          <!-- Main Hanzi Phồn Thể Display -->
          <div class="flex flex-col items-center gap-1 my-2">
            <a href="#tu/${encodeURIComponent(it.w)}" class="font-headline-lg text-[76px] md:text-[90px] leading-[86px] md:leading-[100px] text-on-surface hover:text-primary font-semibold tracking-widest select-all no-underline transition-colors">
              ${esc(it.w)}
            </a>
            <!-- Pinyin and Audio (Taiwan accent) -->
            <div class="flex items-center gap-space-sm mt-2">
              <span class="font-code text-xl md:text-2xl text-tertiary-container font-semibold tracking-wide">${esc(it.py || "")}</span>
              <button type="button" class="flex items-center gap-1 px-space-sm py-1 rounded-full bg-paper-muted hover:bg-surface-container-high text-on-surface-variant transition-colors text-label-sm font-label-sm" id="tts-audio-btn" title="Nghe phát âm chuẩn Đài Bắc (Shift)">
                <span class="material-symbols-outlined text-[16px] text-primary">volume_up</span>
                <span>Đài Bắc</span>
                <kbd class="text-[10px] text-outline font-code">Shift</kbd>
              </button>
            </div>
          </div>
          <!-- Definition & Sentence Example -->
          <div class="max-w-xl mx-auto mt-space-md text-center w-full">
            <p class="font-headline-md text-xl md:text-2xl text-on-surface font-semibold">
              ${esc(meaningOf(n))}
            </p>
            <div class="mt-2 p-space-sm rounded-lg bg-paper-base border border-border-subtle/50 text-left flex items-start gap-space-xs">
              <span class="material-symbols-outlined text-secondary text-[18px] mt-0.5">format_quote</span>
              <div class="flex-1">
                <p class="font-headline-md text-sm text-on-surface font-normal">
                  ${esc(exZh)}
                </p>
                <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  ${esc(exVn)}
                </p>
              </div>
            </div>
          </div>
        </div>
        <!-- Bottom: 6 SRS Mastery Levels Rating Bar -->
        <div class="pt-space-md border-t border-border-subtle/50 flex flex-col gap-space-xs">
          <div class="flex items-center justify-between text-outline font-label-sm text-label-sm">
            <span>Cập nhật cấp độ Spaced Repetition (Phím 1 - 6):</span>
            <span class="font-code text-secondary font-medium">Chu kỳ hiện tại: ${lvlDays[lvl]}</span>
          </div>
          <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
            ${LEVELS.map((lName, idx) => {
              const isCur = idx === lvl;
              return `
                <button type="button" data-fc-lvl="${idx}" class="p-2 rounded-xl transition-all flex flex-col items-center gap-0.5 ${isCur ? "bg-jade-subtle text-secondary shadow-[0_1px_4px_rgba(23,107,75,0.12)] ring-1 ring-secondary/30" : "bg-surface-container-low hover:bg-surface-container text-outline hover:text-on-surface"}">
                  <span class="font-label-sm text-[11px] ${isCur ? "font-semibold text-secondary" : ""}">${idx + 1}. ${esc(lName)}</span>
                  <span class="font-code text-[10px] ${isCur ? "text-secondary font-medium" : "text-outline/60"}">${lvlDays[idx]}</span>
                </button>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;

    const btnPrev = $("#btn-fc-prev");
    if (btnPrev) btnPrev.onclick = () => { fcIdx = (fcIdx - 1 + flashPool.length) % flashPool.length; renderFlashcardCanvas(); };
    const btnNext = $("#btn-fc-next");
    if (btnNext) btnNext.onclick = () => { fcIdx = (fcIdx + 1) % flashPool.length; renderFlashcardCanvas(); };
    const btnTts = $("#tts-audio-btn");
    if (btnTts) btnTts.onclick = () => { if (typeof speak === "function") speak(it.w); };

    box.querySelectorAll("[data-fc-lvl]").forEach((btn) => {
      btn.onclick = async () => {
        const newLvl = Number(btn.dataset.fcLvl);
        await applyWordLevel(n, newLvl);
        fcIdx = (fcIdx + 1) % flashPool.length;
        renderFlashcardCanvas();
      };
    });
  };

  // Render Live Quick Search Sidebar
  const renderQuickLookup = () => {
    const inp = $("#quick-search-input");
    const box = $("#quick-search-preview");
    if (!inp || !box) return;
    const q = fold(inp.value.trim() || "客氣");
    const match = vocab.find((n) => fold(n.w) === q) || vocab.find((n) => fold(n.w).includes(q) || fold(itemOf(n).py || "").includes(q) || fold(meaningOf(n)).includes(q)) || vocab[0];
    if (!match) {
      box.innerHTML = `<div class="text-xs text-outline p-4 text-center">Không tìm thấy từ khớp.</div>`;
      return;
    }
    const it = itemOf(match);
    const lvl = noteLevel(match);
    box.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-baseline gap-2">
            <a href="#tu/${encodeURIComponent(it.w)}" class="font-headline-lg text-2xl font-bold text-on-surface hover:text-primary no-underline">${esc(it.w)}</a>
            <span class="font-code text-code text-tertiary-container font-medium">${esc(it.py || "")}</span>
            <button type="button" class="text-primary hover:scale-110 transition-transform" onclick="if(typeof speak==='function') speak('${esc(it.w)}')" title="Phát âm">
              <span class="material-symbols-outlined text-[16px]">volume_up</span>
            </button>
          </div>
          <span class="font-label-sm text-label-sm text-outline">Hán Việt: <strong class="text-on-surface font-medium">${esc((it.hv || "Đang cập nhật").toUpperCase())}</strong></span>
        </div>
        <span class="px-2 py-0.5 rounded bg-cinnabar-subtle text-primary text-[11px] font-semibold">${esc(it.band ? `TOCFL ${it.band}` : "Từ vựng")}</span>
      </div>
      <div class="text-body-sm text-body-sm text-on-surface space-y-1 mt-1">
        <p><span class="font-semibold text-primary">Nghĩa:</span> ${esc(meaningOf(match))}</p>
        ${it.en ? `<p><span class="font-semibold text-outline">Tiếng Anh:</span> ${esc(it.en)}</p>` : ""}
      </div>
      <div class="p-2 rounded bg-amber-subtle/80 flex items-start gap-1.5 text-tertiary text-body-sm mt-1">
        <span class="material-symbols-outlined text-[16px] mt-0.5 text-tertiary">tips_and_updates</span>
        <span>Mức nhớ hiện tại: <strong>${esc(LEVELS[lvl])}</strong>. Bấm Chi tiết để xem nét viết và ví dụ.</span>
      </div>
      <div class="pt-2 mt-auto border-t border-border-subtle/40 flex items-center justify-between">
        <a href="#tu/${encodeURIComponent(it.w)}" class="font-label-sm text-label-sm text-secondary flex items-center gap-1 font-semibold no-underline hover:underline">
          <span class="material-symbols-outlined text-[14px]">open_in_new</span>
          <span>Mở từ điển chi tiết</span>
        </a>
        <button type="button" class="px-2.5 py-1 rounded bg-paper-card border border-border-subtle text-on-surface hover:bg-surface-container text-label-sm font-label-sm shadow-sm transition-colors flex items-center gap-1" onclick="startStudyWord('${esc(it.w)}')">
          <span class="material-symbols-outlined text-[14px]">play_arrow</span>
          <span>Học ngay</span>
        </button>
      </div>
    `;
  };

  // Render Folder Cards Grid
  let curCat = "all";
  const renderFolderCards = () => {
    const q = fold($("#folderSearchInput")?.value || "");
    const grid = $("#stitch-folders-grid");
    if (!grid) return;
    const filtered = allFolderItems.filter((f) => {
      if (curCat !== "all" && f.cat !== curCat) return false;
      if (!q) return true;
      return fold(f.title).includes(q) || fold(f.sub).includes(q) || fold(f.tag).includes(q);
    });

    grid.innerHTML = filtered.map((f) => `
      <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle/70 shadow-[0_2px_8px_rgba(44,42,41,0.03)] hover:shadow-md transition-all duration-200 flex flex-col justify-between group">
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-start justify-between">
            <a href="#thu-muc/${encodeURIComponent(f.id)}" class="w-10 h-10 rounded-xl ${f.iconBg} flex items-center justify-center no-underline">
              <span class="font-headline-md font-bold text-lg">${esc(f.iconText)}</span>
            </a>
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-sm text-[11px] font-semibold">${esc(f.tag)}</span>
              ${f.isBand ? `
                <button type="button" class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${f.isLearning ? "bg-jade-subtle text-secondary border-secondary/30" : "bg-paper-muted text-outline border-border-subtle"}" data-toggle-band="${esc(f.id)}">
                  ${f.isLearning ? "Đang học" : "+ Bật"}
                </button>
              ` : ""}
            </div>
          </div>
          <div class="mt-1">
            <a href="#thu-muc/${encodeURIComponent(f.id)}" class="no-underline">
              <h3 class="font-headline-md text-headline-md text-on-surface font-semibold group-hover:text-primary transition-colors">
                ${esc(f.title)}
              </h3>
            </a>
            <p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-1 mt-0.5">
              ${esc(f.sub)}
            </p>
          </div>
        </div>
        <!-- Progress bar -->
        <div class="mt-space-md pt-space-xs">
          <div class="flex justify-between items-center text-label-sm font-label-sm mb-1.5">
            <span class="text-outline">Tiến độ nắm vững</span>
            <span class="font-code text-on-surface font-semibold">${fmt(f.learned)} / ${fmt(f.total)} từ (${f.pct}%)</span>
          </div>
          <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
            <div class="h-full rounded-full ${f.barBg}" style="width: ${f.pct}%"></div>
          </div>
          <div class="flex items-center justify-between mt-space-md pt-space-xs border-t border-border-subtle/50">
            <a href="#thu-muc/${encodeURIComponent(f.id)}" class="font-code text-xs text-primary hover:underline font-semibold flex items-center gap-1 no-underline">
              <span>Xem ${fmt(f.total)} từ →</span>
            </a>
            <button type="button" class="px-3 py-1.5 rounded-lg bg-primary-container text-on-primary text-label-sm font-label-sm font-semibold hover:bg-primary transition-colors flex items-center gap-1 shadow-sm" onclick="startStudyFolder('${esc(f.id)}')">
              <span class="material-symbols-outlined text-[16px]">play_arrow</span>
              <span>Học ngay</span>
            </button>
          </div>
        </div>
      </div>
    `).join("") || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy thư mục nào khớp.</div>`;

    grid.querySelectorAll("[data-toggle-band]").forEach((btn) => {
      btn.onclick = async (e) => {
        e.preventDefault();
        const b = btn.dataset.toggleBand;
        S.settings.bands[b] = !S.settings.bands[b];
        await saveSettings();
        VIEWS["thu-muc"]();
      };
    });
  };

  renderFlashcardCanvas();
  renderQuickLookup();
  renderFolderCards();

  // Wire up Quick Search events
  const qInput = $("#quick-search-input");
  if (qInput) qInput.oninput = renderQuickLookup;
  const qClear = $("#btn-clear-quick-search");
  if (qClear) qClear.onclick = () => { if (qInput) { qInput.value = ""; qInput.focus(); renderQuickLookup(); } };

  // Wire up Folder Filter tabs & search
  const fSearch = $("#folderSearchInput");
  if (fSearch) fSearch.oninput = renderFolderCards;

  document.querySelectorAll("#folderTabs button").forEach((btn) => {
    btn.onclick = () => {
      curCat = btn.dataset.tab || "all";
      document.querySelectorAll("#folderTabs button").forEach((b) => {
        b.className = b.dataset.tab === curCat
          ? "px-3.5 py-1.5 rounded-full bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-sm"
          : "px-3.5 py-1.5 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted font-label-md text-label-md transition-colors shadow-sm";
      });
      renderFolderCards();
    };
  });

  // Wire up Stitch 3-mode view switcher
  const setMainMode = (mode) => {
    const flashSec = $("#flashcard-section");
    const libSec = $("#library-section");
    const tInt = $("#view-tab-integrated");
    const tLib = $("#view-tab-library");
    const tFoc = $("#view-tab-focus");
    [tInt, tLib, tFoc].forEach((t) => {
      if (!t) return;
      t.classList.remove("bg-paper-card", "text-primary", "shadow-sm", "font-semibold");
      t.classList.add("text-on-surface-variant", "font-medium");
    });
    if (mode === "integrated") {
      if (flashSec) flashSec.classList.remove("hidden");
      if (libSec) libSec.classList.remove("hidden");
      if (tInt) { tInt.classList.add("bg-paper-card", "text-primary", "shadow-sm", "font-semibold"); tInt.classList.remove("text-on-surface-variant"); }
    } else if (mode === "library") {
      if (flashSec) flashSec.classList.add("hidden");
      if (libSec) libSec.classList.remove("hidden");
      if (tLib) { tLib.classList.add("bg-paper-card", "text-primary", "shadow-sm", "font-semibold"); tLib.classList.remove("text-on-surface-variant"); }
    } else if (mode === "focus") {
      if (flashSec) flashSec.classList.remove("hidden");
      if (libSec) libSec.classList.add("hidden");
      if (tFoc) { tFoc.classList.add("bg-paper-card", "text-primary", "shadow-sm", "font-semibold"); tFoc.classList.remove("text-on-surface-variant"); }
    }
  };
  const tInt = $("#view-tab-integrated");
  const tLib = $("#view-tab-library");
  const tFoc = $("#view-tab-focus");
  if (tInt) tInt.onclick = () => setMainMode("integrated");
  if (tLib) tLib.onclick = () => setMainMode("library");
  if (tFoc) tFoc.onclick = () => setMainMode("focus");

  // Keyboard navigation for Vocabulary Flashcards (Space/Arrows/Shift/1-6)
  window.onkeydown = async (e) => {
    if (location.hash !== "#thu-muc" && !location.hash.startsWith("#thu-muc")) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "Shift") {
      e.preventDefault();
      const n = flashPool[fcIdx % flashPool.length];
      if (n && typeof speak === "function") speak(n.w);
    } else if (e.key === " " || e.key === "ArrowRight") {
      e.preventDefault();
      fcIdx = (fcIdx + 1) % flashPool.length;
      renderFlashcardCanvas();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      fcIdx = (fcIdx - 1 + flashPool.length) % flashPool.length;
      renderFlashcardCanvas();
    } else if (["1", "2", "3", "4", "5", "6"].includes(e.key)) {
      e.preventDefault();
      const targetLvl = Number(e.key) - 1;
      const n = flashPool[fcIdx % flashPool.length];
      if (n) {
        if (typeof playChime === "function") playChime(targetLvl >= 2);
        await applyWordLevel(n, targetLvl);
        fcIdx = (fcIdx + 1) % flashPool.length;
        renderFlashcardCanvas();
      }
    }
  };
};

// =========================================================================
// 4. LỌC NHANH (QUICK TRIAGE ENGINE)
// =========================================================================
VIEWS["loc-nhanh"] = (id) => {
  const list = folderNotes(id).filter((n) => n.kind === "vocab" && !hasProgress(n));
  S.tri = { id, list, i: 0, hist: [], shown: false, counts: { known: 0, some: 0, unknown: 0 } };
  renderTri();
};

function renderTri() {
  const T = S.tri;
  if (!T) return;
  const n = T.list[T.i];
  const name = S.bands.includes(T.id) ? `TOCFL ${T.id}` : (T.id === "cua-toi" ? "Thư mục của tôi" : (T.id === "viet-tat" ? "Từ viết tắt" : T.id));
  const tally = `Đã thuộc ${T.counts.known} · Hơi nhớ ${T.counts.some} · Chưa biết ${T.counts.unknown}`;

  if (!n) {
    setView(`
      <div class="max-w-xl mx-auto px-margin py-space-2xl text-center flex flex-col items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-jade-subtle text-secondary flex items-center justify-center shadow-xs">
          <span class="material-symbols-outlined text-[36px]">verified</span>
        </div>
        <h2 class="font-headline-lg text-2xl font-bold text-on-surface">Hoàn tất lọc nhanh ${esc(name)}!</h2>
        <p class="font-body-md text-sm text-on-surface-variant">${esc(tally)}.</p>
        <p class="text-xs text-outline max-w-md">Từ "Đã thuộc" được xếp lịch ôn sau 21 ngày. Từ "Hơi nhớ" ôn sau 1 ngày. Từ "Chưa biết" sẽ đưa vào hàng đợi thẻ mới hôm nay.</p>
        <div class="flex items-center gap-3 mt-4">
          <button type="button" class="px-6 py-2.5 rounded-xl bg-secondary text-white font-semibold hover:bg-secondary-fixed transition-colors shadow-xs text-sm" onclick="startStudyFolder('${esc(T.id)}')">Học ngay thư mục</button>
          <a href="#thu-muc/${encodeURIComponent(T.id)}" class="px-5 py-2.5 rounded-xl bg-paper-muted text-on-surface font-semibold hover:bg-surface-container transition-colors text-sm">Về thư mục</a>
        </div>
      </div>
    `);
    updateBadge();
    return;
  }

  const it = itemOf(n);
  const pct = Math.round((T.i / T.list.length) * 100);

  setView(`
    <div class="max-w-3xl mx-auto px-margin-mobile md:px-margin py-space-md md:py-space-lg flex flex-col gap-space-lg">
      <div class="flex items-center justify-between text-xs text-outline font-medium">
        <span>Lọc nhanh · ${esc(name)} · ${T.i + 1} / ${T.list.length}</span>
        <span>${esc(tally)}</span>
      </div>
      <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
        <div class="h-full bg-primary rounded-full transition-all duration-300" style="width:${pct}%;"></div>
      </div>

      <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-sm flex flex-col items-center text-center gap-space-md">
        <div class="font-headline-lg text-6xl md:text-7xl font-serif font-bold text-on-surface my-space-sm select-all">
          ${esc(n.basic ? n.display : it.w)}
        </div>

        ${T.shown ? `
          <div class="flex flex-col items-center gap-2 pt-space-sm border-t border-border-subtle w-full max-w-md">
            <div class="font-code text-xl text-tertiary font-bold">${esc(it.py)}</div>
            ${it.hv ? `<div class="text-xs text-outline">Hán Việt: <strong class="text-on-surface">${it.hv}</strong></div>` : ""}
            <div class="text-base font-semibold text-on-surface">${esc(it.vn || it.en || "")}</div>
          </div>
        ` : `
          <button type="button" class="px-6 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-sm transition-colors" id="btnTriReveal">
            Xem đáp án (Phím cách)
          </button>
        `}

        <div class="grid grid-cols-3 gap-space-sm w-full max-w-md mt-space-md">
          <button type="button" class="py-3 px-2 rounded-xl bg-jade-subtle text-secondary font-bold text-xs hover:bg-secondary-fixed transition-all border border-secondary/20 shadow-2xs" id="btnTri1">
            <div>1. Đã thuộc</div>
            <div class="text-[10px] font-normal opacity-80 mt-0.5">Ôn sau 21 ngày</div>
          </button>
          <button type="button" class="py-3 px-2 rounded-xl bg-amber-subtle text-tertiary font-bold text-xs hover:bg-amber-subtle/80 transition-all border border-amber-subtle shadow-2xs" id="btnTri2">
            <div>2. Hơi nhớ</div>
            <div class="text-[10px] font-normal opacity-80 mt-0.5">Ôn sau 1 ngày</div>
          </button>
          <button type="button" class="py-3 px-2 rounded-xl bg-cinnabar-subtle text-primary font-bold text-xs hover:bg-cinnabar-subtle/80 transition-all border border-cinnabar-subtle shadow-2xs" id="btnTri3">
            <div>3. Chưa biết</div>
            <div class="text-[10px] font-normal opacity-80 mt-0.5">Học như thẻ mới</div>
          </button>
        </div>

        <div class="flex items-center justify-between w-full max-w-md pt-2 text-xs text-outline">
          <button type="button" class="hover:underline" id="btnTriUndo" ${T.hist.length ? "" : "disabled"}>↺ Hoàn tác (Z)</button>
          <a href="#thu-muc/${encodeURIComponent(T.id)}" class="hover:underline">Dừng lọc</a>
        </div>
      </div>
    </div>
  `);

  const rv = $("#btnTriReveal");
  if (rv) rv.onclick = () => { T.shown = true; renderTri(); };
  $("#btnTri1").onclick = () => triage("known");
  $("#btnTri2").onclick = () => triage("some");
  $("#btnTri3").onclick = () => triage("unknown");
  const un = $("#btnTriUndo");
  if (un) un.onclick = triUndo;
}

async function triage(action) {
  const T = S.tri;
  if (!T || !T.list[T.i]) return;
  const n = T.list[T.i];
  const lvl = action === "known" ? 4 : (action === "some" ? 2 : 0);
  await applyWordLevel(n, lvl);
  T.counts[action]++;
  T.hist.push({ n, action, lvl });
  T.i++;
  T.shown = false;
  renderTri();
}

async function triUndo() {
  const T = S.tri;
  if (!T || !T.hist.length) return;
  const last = T.hist.pop();
  T.i--;
  T.counts[last.action]--;
  await applyWordLevel(last.n, 0);
  T.shown = false;
  renderTri();
}

document.addEventListener("keydown", (e) => {
  if (!location.hash.startsWith("#loc-nhanh") || !S.tri || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  const k = (e.key || "").toLowerCase();
  if (e.code === "Space" || k === " " || e.key === "Spacebar" || e.keyCode === 32) {
    e.preventDefault();
    S.tri.shown = true;
    renderTri();
  } else if (k === "1") {
    triage("known");
  } else if (k === "2") {
    triage("some");
  } else if (k === "3") {
    triage("unknown");
  } else if (k === "z") {
    triUndo();
  }
});

// =========================================================================
// 10. HỌC NGỮ PHÁP PHỒN THỂ (Stitch Master Design: Modern Oriental Scholarly)
// =========================================================================

const GRAMMAR_MASTER_LIST = [
  {
    id: "ba",
    name: "Cấu trúc chữ BẢ (把字句)",
    zh: "把",
    formula: "S + 把 + Tân ngữ + Động từ + Thành phần khác",
    band: "TOCFL B1",
    levelGroup: "B1",
    freq: "Rất cao (★★★★★)",
    summary: "Biểu thị sự xử lý hoặc làm thay đổi trạng thái, vị trí của một đối tượng xác định.",
    cond1: { title: "Điều kiện 1: Tân ngữ xác định", desc: "Tân ngữ sau chữ 把 phải là người hoặc vật cụ thể đã được cả người nói và người nghe biết rõ (sử dụng 這, 那, 我的,...)." },
    cond2: { title: "Điều kiện 2: Làm thay đổi trạng thái", desc: "Động từ chính bắt buộc mang ý nghĩa xử lý, tác động và kéo theo bổ ngữ kết quả, bổ ngữ xu hướng, hoặc trợ từ 了." },
    wrong: {
      zh: "我把一本書看了。",
      py: "Wǒ bǎ yī běn shū kàn le.",
      reason: 'Lỗi sai điển hình: "一本書" là tân ngữ phiếm chỉ, không xác định, vi phạm quy tắc dùng câu chữ BẢ.'
    },
    correct: {
      zh: "我把那本書看完了。",
      py: "Wǒ bǎ nà běn shū kàn wán le.",
      reason: 'Cách nói chuẩn xác Đài Loan: "那本書" đã xác định rõ ràng, và động từ có bổ ngữ kết quả "完" chỉ trạng thái hoàn tất.'
    },
    examples: [
      {
        zh: "請把這份企劃案交給經理。",
        py: "Qǐng bǎ zhè fèn qǐhuà'àn jiāo gěi jīnglǐ.",
        vn: "Xin hãy giao bản kế hoạch này cho giám đốc.",
        en: "Please hand over this proposal to the manager.",
        tag: "Văn phòng / Công sở",
        tagColor: "cinnabar-subtle",
        tagText: "text-primary"
      },
      {
        zh: "他把昨天買的悠遊卡弄丟了。",
        py: "Tā bǎ zuótiān mǎi de yōuyóukǎ nòngdiū le.",
        vn: "Anh ấy đã làm mất chiếc thẻ EasyCard mua hôm qua.",
        en: "He lost the EasyCard he bought yesterday.",
        tag: "Giao thông Đài Loan",
        tagColor: "jade-subtle",
        tagText: "text-secondary"
      },
      {
        zh: "我已經把機票訂好了。",
        py: "Wǒ yǐjīng bǎ jīpiào dìng hǎo le.",
        vn: "Tôi đã đặt xong vé máy bay rồi.",
        en: "I have already booked the flight tickets.",
        tag: "Du lịch & Đi lại",
        tagColor: "amber-subtle",
        tagText: "text-tertiary"
      }
    ],
    quiz: {
      q: "請你______那杯珍珠奶茶喝完，我們要出門了。",
      opts: [
        { key: "ba", label: "把 (bǎ)", correct: true, explain: '<strong>Chính xác! (正確)</strong> Câu dùng cấu trúc chữ BẢ để yêu cầu người nghe xử lý và uống hết ly trà sữa xác định ("那杯珍珠奶茶喝完").' },
        { key: "bei", label: "被 (bèi)", correct: false, explain: '<strong>Chưa chính xác! (再試試)</strong> Ly trà sữa là đối tượng được người nghe chủ động uống hết, phải dùng chữ <strong>把</strong> thay vì thể bị động <strong>被</strong>.' },
        { key: "rang", label: "讓 (ràng)", correct: false, explain: '<strong>Chưa chính xác! (再試試)</strong> "讓" biểu thị nhượng bộ hoặc sai khiến/cho phép, không dùng để xử lý tân ngữ cụ thể trong ngữ cảnh này.' }
      ]
    }
  },
  {
    id: "bei",
    name: "Cấu trúc BỊ ĐỘNG: 被 / 叫 / 讓 (被字句)",
    zh: "被",
    formula: "S + 被/叫/讓 + Tác nhân + Động từ + Thành phần khác",
    band: "TOCFL B1",
    levelGroup: "B1",
    freq: "Rất cao (★★★★☆)",
    summary: "Biểu thị chủ ngữ tiếp nhận tác động từ người khác, thường mang sắc thái tiêu cực hoặc bất như ý trong giao tiếp thường nhật.",
    cond1: { title: "Điều kiện 1: Tác nhân gây ra", desc: "Có thể có hoặc lược bỏ tác nhân sau 被 (nhưng 叫 và 讓 bắt buộc phải có tác nhân đi kèm)." },
    cond2: { title: "Điều kiện 2: Trọng tâm kết quả", desc: "Động từ thường đi kèm bổ ngữ kết quả, chỉ sự việc đã xảy ra ngoài ý muốn của chủ ngữ." },
    wrong: {
      zh: "他的手機被偷。",
      py: "Tā de shǒujī bèi tōu.",
      reason: "Lỗi: Động từ đơn độc đứng cuối câu không có bổ ngữ hay trợ từ 了 biểu thị kết quả."
    },
    correct: {
      zh: "他的手機被小偷偷走了。",
      py: "Tā de shǒujī bèi xiǎotōu tōu zǒu le.",
      reason: 'Đúng: Có tác nhân "小偷" và bổ ngữ xu hướng "走" kèm trợ từ "了".'
    },
    examples: [
      {
        zh: "我的錢包被偷走了。",
        py: "Wǒ de qiánbāo bèi tōu zǒu le.",
        vn: "Ví tiền của tôi bị trộm mất rồi.",
        en: "My wallet was stolen.",
        tag: "Đời sống",
        tagColor: "cinnabar-subtle",
        tagText: "text-primary"
      },
      {
        zh: "那本書讓弟弟弄髒了。",
        py: "Nà běn shū ràng dìdi nòng zāng le.",
        vn: "Quyển sách đó bị em trai làm bẩn rồi.",
        en: "That book was soiled by my younger brother.",
        tag: "Gia đình",
        tagColor: "amber-subtle",
        tagText: "text-tertiary"
      }
    ],
    quiz: {
      q: "他的自行車昨晚______人偷走了。",
      opts: [
        { key: "bei", label: "被 (bèi)", correct: true, explain: '<strong>Chính xác!</strong> Câu bị động biểu thị sự việc bất như ý, có tác nhân "人" và kết quả "偷走了".' },
        { key: "ba", label: "把 (bǎ)", correct: false, explain: "<strong>Chưa chính xác!</strong> Xe đạp là vật chịu tác động bị trộm chứ không phải chủ thể chủ động trộm." }
      ]
    }
  },
  {
    id: "yuelaiyue",
    name: "Phó từ tăng tiến: 越來越 & 越...越...",
    zh: "越",
    formula: "越來越 + Tính từ / Động từ tâm lý",
    band: "TOCFL A2",
    levelGroup: "A1/A2",
    freq: "Xuất hiện liên tục (★★★★★)",
    summary: "Mô tả mức độ của sự vật, cảm xúc biến chuyển ngày càng sâu sắc theo thời gian.",
    cond1: { title: "Quy tắc 1: Không dùng kèm 很 / 非常", desc: "Sau 越來越 tuyệt đối không thêm phó từ chỉ mức độ như 很, 非常, 太." },
    cond2: { title: "Quy tắc 2: Biến thể 越 A 越 B", desc: "Càng A thì càng B (ví dụ: 越吃越胖, 越學越有趣)." },
    wrong: {
      zh: "台北的天氣越來越很熱。",
      py: "Táiběi de tiānqì yuèláiyuè hěn rè.",
      reason: 'Sai vì sau 越來越 lại dùng thêm phó từ chỉ mức độ "很".'
    },
    correct: {
      zh: "台北的天氣越來越熱了。",
      py: "Táiběi de tiānqì yuèláiyuè rè le.",
      reason: 'Đúng: Bỏ "很", có thể thêm "了" ở cuối để biểu thị sự thay đổi theo thời gian.'
    },
    examples: [
      {
        zh: "嬰兒奶粉越來越貴了。",
        py: "Yīng'ér nǎifěn yuèláiyuè guì le.",
        vn: "Sữa bột trẻ em ngày càng đắt.",
        en: "Baby formula is getting more and more expensive.",
        tag: "Đời sống",
        tagColor: "jade-subtle",
        tagText: "text-secondary"
      },
      {
        zh: "我的中文越來越好了。",
        py: "Wǒ de Zhōngwén yuèláiyuè hǎo le.",
        vn: "Tiếng Trung của tôi ngày càng tốt.",
        en: "My Chinese is getting better and better.",
        tag: "Học tập",
        tagColor: "cinnabar-subtle",
        tagText: "text-primary"
      }
    ],
    quiz: {
      q: "自從搬到台灣以後，他的中文______流利了。",
      opts: [
        { key: "yuelaiyue", label: "越來越 (yuèláiyuè)", correct: true, explain: '<strong>Chính xác!</strong> Biểu thị tiếng Trung ngày càng lưu loát theo thời gian sinh sống tại Đài Loan.' },
        { key: "hen", label: "很 (hěn)", correct: false, explain: '<strong>Chưa chính xác!</strong> "很" không biểu thị quá trình biến chuyển tăng tiến kèm "了".' }
      ]
    }
  },
  {
    id: "bushima",
    name: "Cấu trúc phản vấn: 不是...嗎？",
    zh: "嗎",
    formula: "S + 不是 + Vị ngữ + 嗎？",
    band: "Khẩu ngữ Đài Bắc",
    levelGroup: "Khẩu ngữ",
    freq: "Khẩu ngữ hàng ngày (★★★★☆)",
    summary: 'Dùng để nhắc nhở đối phương hoặc khẳng định lại điều hiển nhiên: "Chẳng phải là... hay sao?".',
    cond1: { title: "Sắc thái khẩu ngữ", desc: "Thường dùng khi ngạc nhiên, nhắc nhở hoặc nhấn mạnh một thực tế mà đối phương lẽ ra phải biết." },
    cond2: { title: "Ngữ điệu", desc: "Lên giọng ở cuối câu, có thể dùng 不 cũng mang nghĩa tương tự trong khẩu ngữ." },
    wrong: {
      zh: "你不是明天要考試嗎？為什麼不看書？",
      py: "Nǐ bú shì míngtiān yào kǎoshì ma? Wèishénme bù kànshū?",
      reason: "Câu này hoàn toàn đúng ngữ pháp và khẩu ngữ!"
    },
    correct: {
      zh: "你不是明天要考試嗎？",
      py: "Nǐ bú shì míngtiān yào kǎoshì ma?",
      reason: "Đúng chuẩn khẩu ngữ: Chẳng phải ngày mai bạn có bài thi sao?"
    },
    examples: [
      {
        zh: "你不是說今天不加班嗎？",
        py: "Nǐ bú shì shuō jīntiān bù jiābān ma?",
        vn: "Chẳng phải bạn bảo hôm nay không tăng ca sao?",
        en: "Didn't you say you wouldn't work overtime today?",
        tag: "Văn phòng",
        tagColor: "cinnabar-subtle",
        tagText: "text-primary"
      }
    ],
    quiz: {
      q: "你______跟我說過那家餐廳很好吃嗎？",
      opts: [
        { key: "bushi", label: "不是 (bú shì)", correct: true, explain: "<strong>Chính xác!</strong> Cấu trúc phản vấn 不是...嗎 dùng để khẳng định lại điều người kia đã nói." },
        { key: "meiyou", label: "沒有 (méiyǒu)", correct: false, explain: '<strong>Chưa chính xác!</strong> Không dùng "沒有...嗎" cho câu hỏi phản vấn khẳng định.' }
      ]
    }
  },
  {
    id: "yaoshi",
    name: "Liên từ giả định: 要是...就...",
    zh: "要是",
    formula: "要是 + Mệnh đề điều kiện + 就 + Kết quả",
    band: "TOCFL B1",
    levelGroup: "B1",
    freq: "Tần suất cao (★★★★☆)",
    summary: 'Tương đương "Nếu như... thì...", mang tính khẩu ngữ thân mật hơn "如果" trong giao tiếp của người Đài Loan.',
    cond1: { title: "Tính khẩu ngữ", desc: "Người Đài Loan rất chuộng dùng 要是 trong hội thoại thân mật hơn là 如果." },
    cond2: { title: "Cặp liên từ", desc: "Vế sau thường có 就 hoặc 那(麼) kết nối." },
    wrong: {
      zh: "要是明天放颱風假，但是在家看電影。",
      py: "Yàoshi míngtiān fàng táifēng jià, dànshì zài jiā kàn diànyǐng.",
      reason: 'Sai vì vế sau dùng "但是" (nhưng) thay vì liên từ chỉ kết quả "就".'
    },
    correct: {
      zh: "要是明天放颱風假，我們就在家看電影。",
      py: "Yàoshi míngtiān fàng táifēng jià, wǒmen jiù zài jiā kàn diànyǐng.",
      reason: "Đúng chuẩn: Vế giả định 要是 đi kèm vế hệ quả 就."
    },
    examples: [
      {
        zh: "要是你有空，就來我家玩吧。",
        py: "Yàoshi nǐ yǒu kòng, jiù lái wǒ jiā wán ba.",
        vn: "Nếu bạn rảnh thì đến nhà tôi chơi nhé.",
        en: "If you have time, come over to my place.",
        tag: "Hẹn hò / Đời sống",
        tagColor: "jade-subtle",
        tagText: "text-secondary"
      }
    ],
    quiz: {
      q: "要是下大雨，我們______不去了。",
      opts: [
        { key: "jiu", label: "就 (jiù)", correct: true, explain: "<strong>Chính xác!</strong> Cặp liên từ 要是...就... biểu thị giả định và kết quả." },
        { key: "ye", label: "也 (yě)", correct: false, explain: '<strong>Chưa chính xác!</strong> 也 mang nghĩa "cũng", không phải cặp chuẩn với 要是.' }
      ]
    }
  },
  {
    id: "zhan_de",
    name: "Tỷ lệ: A 占 B 的 ___",
    zh: "占",
    formula: "A + 占(了) + B + 的 + 幾分之幾 / 幾成 / 百分之幾 / 幾趴",
    band: "TOCFL B1",
    levelGroup: "B1",
    freq: "TOCFL đọc hiểu (★★★★☆)",
    summary: "Biểu thị tỷ lệ phần trăm hoặc phân số chiếm trong một tổng thể.",
    cond1: { title: "Cách đọc phân số & phần trăm", desc: "Đọc mẫu trước tử sau: 1/4 = 四分之一; 20% = 兩成 (一成 = 10%); 25趴 (khẩu ngữ Đài Loan từ percent)." },
    cond2: { title: "Phân biệt với 比", desc: "比 dùng để so sánh hơn kém; 占 dùng để nói phần trong tổng thể." },
    wrong: {
      zh: "去日本玩的人比台灣出國玩的人的三分之二。",
      py: "Qù Rìběn wán de rén bǐ Táiwān chūguó wán de rén de sān fēn zhī èr.",
      reason: 'Sai vì dùng "比" để nói tỷ lệ phần trăm thay vì dùng "占".'
    },
    correct: {
      zh: "去日本玩的人占台灣出國玩的人的三分之二。",
      py: "Qù Rìběn wán de rén zhàn Táiwān chūguó wán de rén de sān fēn zhī èr.",
      reason: "Đúng: Dùng 占 ... 的 để nói tỷ lệ cấu thành trong một tổng thể."
    },
    examples: [
      {
        zh: "女性員工占全公司的四成。",
        py: "Nǚxìng yuángōng zhàn quán gōngsī de sì chéng.",
        vn: "Nhân viên nữ chiếm 40% toàn công ty.",
        en: "Female employees account for 40% of the entire company.",
        tag: "Công sở",
        tagColor: "cinnabar-subtle",
        tagText: "text-primary"
      },
      {
        zh: "房租占了我薪水的三十趴。",
        py: "Fángzū zhàn le wǒ xīnshuǐ de sānshí pā.",
        vn: "Tiền nhà chiếm 30% lương của tôi.",
        en: "Rent accounts for 30% of my salary.",
        tag: "Khẩu ngữ Đài Loan",
        tagColor: "jade-subtle",
        tagText: "text-secondary"
      }
    ],
    quiz: {
      q: "女性員工______全公司______四成。",
      opts: [
        { key: "zhan_de", label: "占 … 的", correct: true, explain: "<strong>Chính xác!</strong> A 占 B 的 [tỷ lệ] là cấu trúc chuẩn để nói tỷ lệ trong toàn thể." },
        { key: "bi_de", label: "比 … 的", correct: false, explain: "<strong>Chưa chính xác!</strong> 比 chỉ dùng để so sánh tính chất giữa hai đối tượng, không nói tỷ lệ phần trăm." }
      ]
    }
  },
  {
    id: "yuqi_buru",
    name: "Lựa chọn: 與其 A，不如 B",
    zh: "與其",
    formula: "與其 + A，(還)不如 + B",
    band: "TOCFL B2",
    levelGroup: "B2",
    freq: "TOCFL Đọc & Viết (★★★★★)",
    summary: "Thay vì A, chi bằng B (Người nói chọn B và gạt bỏ A, đánh giá B tốt hơn hoặc hợp lý hơn).",
    cond1: { title: "So sánh với 寧可 A 也不 B", desc: "寧可 A 也不 B: chọn A, gạt B. 與其 A 不如 B: gạt A, chọn B. Thứ tự lựa chọn ngược nhau!" },
    cond2: { title: "Vế sau", desc: "Vế sau luôn là 不如 (bùrú) hoặc 還不如 (không dùng 還是 hay 但是)." },
    wrong: {
      zh: "與其花錢坐計程車，還是坐捷運。",
      py: "Yǔqí huā qián zuò jìchéngchē, háishì zuò jiéyùn.",
      reason: 'Sai vì sau 与其 phải đi kèm cặp với "不如", không dùng "還是".'
    },
    correct: {
      zh: "與其花錢坐計程車，不如坐捷運。",
      py: "Yǔqí huā qián zuò jìchéngchē, bùrú zuò jiéyùn.",
      reason: "Đúng chuẩn: Thay vì tốn tiền đi taxi, chi bằng đi MRT (捷運)."
    },
    examples: [
      {
        zh: "與其在家睡覺，不如出去走走。",
        py: "Yǔqí zài jiā shuìjiào, bùrú chūqù zǒuzou.",
        vn: "Thay vì ở nhà ngủ, chi bằng ra ngoài đi dạo.",
        en: "Rather than sleeping at home, better to go out for a walk.",
        tag: "Đời sống",
        tagColor: "jade-subtle",
        tagText: "text-secondary"
      },
      {
        zh: "與其等公司加薪，不如自己學新技能。",
        py: "Yǔqí děng gōngsī jiāxīn, bùrú zìjǐ xué xīn jìnéng.",
        vn: "Thay vì chờ công ty tăng lương, chi bằng tự học kỹ năng mới.",
        en: "Rather than waiting for a raise, better to learn new skills yourself.",
        tag: "Sự nghiệp",
        tagColor: "amber-subtle",
        tagText: "text-tertiary"
      }
    ],
    quiz: {
      q: "______花錢坐計程車，______坐捷運。",
      opts: [
        { key: "yuqi", label: "與其 … 不如", correct: true, explain: '<strong>Chính xác!</strong> "與其 A，不如 B" nghĩa là thay vì A, chi bằng B.' },
        { key: "ningke", label: "寧可 … 也不", correct: false, explain: "<strong>Chưa chính xác!</strong> Nếu dùng 寧可 thì phải là điều mình chọn trước, ở đây MRT mới là điều được chọn." }
      ]
    }
  },
  {
    id: "raner",
    name: "Liên từ chuyển ngoặt: 然而 (tuy nhiên)",
    zh: "然而",
    formula: "Mệnh đề 1，然而 + Mệnh đề 2",
    band: "TOCFL B2",
    levelGroup: "B2",
    freq: "TOCFL Đọc hiểu (★★★★★)",
    summary: "Tuy nhiên, nhưng mà. Văn viết trang trọng, dùng để chuyển ngoặt ý ngược lại với vế trước.",
    cond1: { title: "Văn phong viết trang trọng", desc: "Nhưng (但是/可是) dùng cả nói lẫn viết; 然而 hầu như chỉ xuất hiện trong văn viết, báo chí, đề thi." },
    cond2: { title: "Vị trí", desc: "Luôn đứng đầu vế câu thứ hai để biểu thị sự chuyển ngoặt." },
    wrong: {
      zh: "這個計畫很好，然而。",
      py: "Zhège jìhuà hěn hǎo, rán'ér.",
      reason: "然而 không thể đứng một mình cuối câu."
    },
    correct: {
      zh: "這個計畫很好，然而成本太高。",
      py: "Zhège jìhuà hěn hǎo, rán'ér chéngběn tài gāo.",
      reason: "Kế hoạch này rất tốt, tuy nhiên chi phí quá cao."
    },
    examples: [
      {
        zh: "大家都以為他會成功，然而他失敗了。",
        py: "Dàjiā dōu yǐwéi tā huì chénggōng, rán'ér tā shībài le.",
        vn: "Ai cũng tưởng anh ấy sẽ thành công, nhưng anh ấy đã thất bại.",
        en: "Everyone thought he would succeed, yet he failed.",
        tag: "Đời sống",
        tagColor: "cinnabar-subtle",
        tagText: "text-primary"
      },
      {
        zh: "電動車越來越多，然而充電站還不夠。",
        py: "Diàndòngchē yuèláiyuè duō, rán'ér chōngdiànzhàn hái bú gòu.",
        vn: "Xe điện ngày càng nhiều, tuy nhiên trạm sạc vẫn chưa đủ.",
        en: "Electric cars are increasing, however charging stations are still insufficient.",
        tag: "Xã hội",
        tagColor: "jade-subtle",
        tagText: "text-secondary"
      }
    ],
    quiz: {
      q: "這個計畫很好，______成本太高。",
      opts: [
        { key: "raner", label: "然而 (rán'ér)", correct: true, explain: '<strong>Chính xác!</strong> "然而" là liên từ chỉ sự tương phản trang trọng trong đề thi TOCFL.' },
        { key: "suoyi", label: "所以 (suǒyǐ)", correct: false, explain: '<strong>Chưa chính xác!</strong> "所以" biểu thị quan hệ nguyên nhân - kết quả, không biểu thị sự chuyển ngoặt tương phản.' }
      ]
    }
  }
];

// Global Active State for Grammar View
window.ACTIVE_GRAMMAR_ID = window.ACTIVE_GRAMMAR_ID || "ba";
window.ACTIVE_GRAMMAR_FILTER = window.ACTIVE_GRAMMAR_FILTER || "all";
window.GRAMMAR_BOOKMARKS = window.GRAMMAR_BOOKMARKS || new Set(["ba", "yuqi_buru", "raner"]);

// Helpers
window.checkPractice = function(choice) {
  const resultDiv = document.getElementById("practice-result");
  if (!resultDiv) return;
  const current = GRAMMAR_MASTER_LIST.find(g => g.id === window.ACTIVE_GRAMMAR_ID) || GRAMMAR_MASTER_LIST[0];
  const opt = current.quiz.opts.find(o => o.key === choice) || current.quiz.opts[0];
  
  if (opt.correct) {
    resultDiv.className = "mt-space-sm p-space-sm rounded-lg font-body-sm text-body-sm bg-jade-subtle text-secondary block border border-secondary/20 shadow-xs";
    resultDiv.innerHTML = opt.explain;
    if (typeof playSound === "function") playSound(true);
  } else {
    resultDiv.className = "mt-space-sm p-space-sm rounded-lg font-body-sm text-body-sm bg-cinnabar-subtle text-primary block border border-primary/20 shadow-xs";
    resultDiv.innerHTML = opt.explain;
    if (typeof playSound === "function") playSound(false);
  }
};

window.selectGrammarSpotlight = function(id) {
  window.ACTIVE_GRAMMAR_ID = id;
  const el = document.getElementById("grammar-spotlight-container");
  if (el) {
    const item = GRAMMAR_MASTER_LIST.find(g => g.id === id) || GRAMMAR_MASTER_LIST[0];
    el.innerHTML = renderSpotlightContent(item);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

window.filterGrammarTab = function(level, btnEl) {
  window.ACTIVE_GRAMMAR_FILTER = level;
  document.querySelectorAll(".grammar-tab-btn").forEach(b => {
    b.className = "grammar-tab-btn px-3 py-1.5 rounded-lg bg-paper-card text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-label-md text-label-md font-medium whitespace-nowrap transition-colors shadow-sm";
  });
  if (btnEl) {
    btnEl.className = "grammar-tab-btn px-3 py-1.5 rounded-lg bg-cinnabar-subtle text-primary font-label-md text-label-md font-semibold whitespace-nowrap shadow-sm";
  }
  updateGrammarGrid();
};

window.filterGrammarSearch = function(query) {
  window.GRAMMAR_SEARCH_QUERY = (query || "").trim().toLowerCase();
  updateGrammarGrid();
};

window.toggleGrammarBookmark = function(id) {
  if (window.GRAMMAR_BOOKMARKS.has(id)) {
    window.GRAMMAR_BOOKMARKS.delete(id);
  } else {
    window.GRAMMAR_BOOKMARKS.add(id);
  }
  try {
    localStorage.setItem("bookmarked_grammar", JSON.stringify(Array.from(window.GRAMMAR_BOOKMARKS)));
  } catch(e){}
  updateGrammarGrid();
  renderSidebarNotebook();
};

window.promptAddGrammarNote = function() {
  const name = prompt("Nhập tên mẫu ngữ pháp hoặc cấu trúc câu cần lưu (ví dụ: 連...也/都...):");
  if (!name || !name.trim()) return;
  const formula = prompt("Nhập công thức hoặc mẫu câu (ví dụ: 連 + Danh từ + 也/都 + Vị ngữ):") || "";
  const note = prompt("Ghi chú cách dùng hoặc lưu ý thi cử:") || "";
  
  const customId = "custom_" + Date.now();
  GRAMMAR_MASTER_LIST.push({
    id: customId,
    name: name.trim(),
    zh: name.trim().charAt(0) || "語",
    formula: formula.trim() || name.trim(),
    band: "Cá nhân",
    levelGroup: "Khẩu ngữ",
    freq: "Tự tạo (★★★★★)",
    summary: note.trim() || "Mẫu ngữ pháp tự ghi chú vào sổ tay cá nhân.",
    cond1: { title: "Ghi chú cá nhân", desc: note.trim() || "Cần ôn tập thường xuyên." },
    cond2: { title: "Cấu trúc áp dụng", desc: formula.trim() || "Áp dụng trong bài đọc và hội thoại." },
    wrong: { zh: "", py: "", reason: "Chưa ghi nhận lỗi sai." },
    correct: { zh: name.trim(), py: "", reason: "Mẫu câu do bạn tự bổ sung." },
    examples: [],
    quiz: { q: name.trim(), opts: [{ key: "ok", label: "Đã thuộc", correct: true, explain: "Tuyệt vời!" }] }
  });
  window.GRAMMAR_BOOKMARKS.add(customId);
  try {
    localStorage.setItem("bookmarked_grammar", JSON.stringify(Array.from(window.GRAMMAR_BOOKMARKS)));
  } catch(e){}
  selectGrammarSpotlight(customId);
  updateGrammarGrid();
  renderSidebarNotebook();
};

function renderSpotlightContent(item) {
  const isBookmarked = window.GRAMMAR_BOOKMARKS.has(item.id);
  const exHtml = (item.examples || []).map(ex => `
    <div class="p-space-md rounded-xl bg-paper-base hover:bg-surface-container-low transition-colors duration-150 flex items-start justify-between gap-space-md">
      <div class="flex-1">
        <div class="flex items-baseline gap-space-xs flex-wrap">
          <span class="font-headline-md text-base md:text-lg text-on-surface font-semibold font-serif">${esc(ex.zh)}</span>
          <span class="font-label-sm text-xs font-medium px-2 py-0.5 rounded bg-${ex.tagColor || 'cinnabar-subtle'} ${ex.tagText || 'text-primary'}">${esc(ex.tag)}</span>
        </div>
        <div class="font-code text-xs text-outline mt-1 font-normal">${esc(ex.py)}</div>
        <div class="font-body-md text-sm text-on-surface-variant mt-1">${esc(ex.vn)}</div>
        ${ex.en ? `<div class="font-body-sm text-xs text-outline italic">"${esc(ex.en)}"</div>` : ''}
      </div>
      <button class="w-10 h-10 rounded-full bg-paper-card text-on-surface-variant hover:text-primary shadow-xs flex items-center justify-center transition-colors flex-shrink-0" onclick="say('${esc(ex.zh).replace(/'/g, "\\\\'")}')" title="Nghe phát âm chuẩn Đài Loan (Shift để nghe lại)">
        <span class="material-symbols-outlined text-[20px]">volume_up</span>
      </button>
    </div>
  `).join("");

  const quizOptsHtml = (item.quiz && item.quiz.opts || []).map(opt => `
    <button class="px-3.5 py-1.5 rounded-lg bg-surface-container hover:bg-cinnabar-subtle hover:text-primary font-body-md text-sm text-on-surface transition-colors" onclick="checkPractice('${opt.key}')">
      ${esc(opt.label)}
    </button>
  `).join("");

  return `
    <!-- Calligraphic Seal Background Deco -->
    <div class="absolute -right-8 -top-8 w-44 h-44 rounded-full bg-cinnabar-subtle/50 pointer-events-none flex items-center justify-center text-primary/10 font-headline-lg text-[96px] select-none font-serif">
      ${esc(item.zh || '法')}
    </div>
    
    <!-- Spotlight Header -->
    <div class="flex flex-wrap items-center justify-between gap-space-sm pb-space-md border-b border-border-subtle/50">
      <div class="flex items-center gap-space-sm">
        <span class="w-1.5 h-6 rounded-full bg-primary-container"></span>
        <span class="font-label-sm text-xs uppercase tracking-widest text-primary font-bold">Chủ điểm ngữ pháp nổi bật hôm nay</span>
      </div>
      <div class="flex items-center gap-space-xs">
        <span class="px-2.5 py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-xs font-semibold">${esc(item.band)}</span>
        <span class="px-2.5 py-0.5 rounded-full bg-amber-subtle text-tertiary font-label-sm text-xs font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-[14px]">star</span>
          Xuất hiện: ${esc(item.freq)}
        </span>
      </div>
    </div>

    <!-- Title & Large Formula Display -->
    <div class="mt-space-md">
      <div class="flex items-baseline gap-space-xs flex-wrap">
        <span class="font-headline-md text-xl md:text-2xl text-on-surface font-semibold font-serif">${esc(item.name)}</span>
      </div>

      <!-- Formula Banner -->
      <div class="mt-space-sm p-space-md rounded-xl bg-paper-base shadow-inner flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm border border-border-subtle/60">
        <div class="font-code text-sm md:text-base text-primary font-bold tracking-wide">
          ${esc(item.formula)}
        </div>
        <button class="inline-flex items-center gap-1 text-primary hover:text-primary-container font-label-sm text-xs font-semibold whitespace-nowrap transition-colors" onclick="toggleGrammarBookmark('${item.id}')" title="Lưu mẫu câu">
          <span class="material-symbols-outlined text-[16px]">${isBookmarked ? 'bookmark' : 'bookmark_add'}</span>
          <span>${isBookmarked ? 'Đã lưu sổ tay' : 'Lưu ghi nhớ'}</span>
        </button>
      </div>

      <!-- Rule Explanation -->
      <div class="mt-space-md grid grid-cols-1 md:grid-cols-2 gap-space-md">
        <div class="p-space-sm rounded-lg bg-surface-container-low border border-border-subtle/40">
          <div class="flex items-center gap-1 text-on-surface font-label-md text-xs font-semibold mb-1">
            <span class="material-symbols-outlined text-secondary text-[16px]">check_circle</span>
            ${esc(item.cond1.title)}
          </div>
          <p class="font-body-sm text-xs text-on-surface-variant leading-relaxed">
            ${esc(item.cond1.desc)}
          </p>
        </div>
        <div class="p-space-sm rounded-lg bg-surface-container-low border border-border-subtle/40">
          <div class="flex items-center gap-1 text-on-surface font-label-md text-xs font-semibold mb-1">
            <span class="material-symbols-outlined text-secondary text-[16px]">transform</span>
            ${esc(item.cond2.title)}
          </div>
          <p class="font-body-sm text-xs text-on-surface-variant leading-relaxed">
            ${esc(item.cond2.desc)}
          </p>
        </div>
      </div>
    </div>

    <!-- Avoid Pitfalls (Bảng so sánh Đúng / Sai - Tránh bẫy TOCFL) -->
    <div class="mt-space-lg">
      <h2 class="font-headline-md text-base md:text-lg text-on-surface font-semibold mb-space-sm flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[20px]">troubleshoot</span>
        Tránh bẫy đề thi TOCFL (So sánh Đúng vs Sai)
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
        <!-- Wrong Example -->
        <div class="p-space-md rounded-xl bg-cinnabar-subtle/60 flex flex-col justify-between border border-primary/20">
          <div>
            <div class="flex items-center gap-1 text-primary font-label-sm text-xs font-bold uppercase mb-1">
              <span class="material-symbols-outlined text-[16px]">cancel</span>
              Lỗi sai điển hình (Sai ngữ pháp)
            </div>
            <div class="font-headline-md text-base text-on-surface line-through decoration-primary/60 font-serif">
              ${esc(item.wrong.zh)}
            </div>
            <div class="font-code text-xs text-outline mt-0.5">
              ${esc(item.wrong.py)}
            </div>
          </div>
          <p class="font-body-sm text-xs text-on-surface-variant mt-space-sm italic bg-paper-card/80 p-2 rounded">
            ${esc(item.wrong.reason)}
          </p>
        </div>
        <!-- Correct Example -->
        <div class="p-space-md rounded-xl bg-jade-subtle flex flex-col justify-between border border-secondary/20">
          <div>
            <div class="flex items-center gap-1 text-secondary font-label-sm text-xs font-bold uppercase mb-1">
              <span class="material-symbols-outlined text-[16px]">check_circle</span>
              Cách nói chuẩn xác Đài Loan (Đúng)
            </div>
            <div class="font-headline-md text-base text-secondary font-semibold font-serif">
              ${esc(item.correct.zh)}
            </div>
            <div class="font-code text-xs text-on-secondary-container mt-0.5">
              ${esc(item.correct.py)}
            </div>
          </div>
          <p class="font-body-sm text-xs text-on-surface-variant mt-space-sm bg-paper-card/80 p-2 rounded">
            ${esc(item.correct.reason)}
          </p>
        </div>
      </div>
    </div>

    <!-- Taiwanese Real-life Audio Examples -->
    <div class="mt-space-lg">
      <div class="flex items-center justify-between mb-space-sm">
        <h2 class="font-headline-md text-base md:text-lg text-on-surface font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-secondary text-[20px]">record_voice_over</span>
          Câu ví dụ thực tế đời sống Đài Loan (kèm phát âm)
        </h2>
        <span class="font-label-sm text-xs text-outline font-medium">Giọng chuẩn Đài Bắc • Phím Shift để nghe lại</span>
      </div>
      <div class="space-y-space-sm">
        ${exHtml}
      </div>
    </div>

    <!-- Mini Practice / Quick Reflection Test -->
    ${item.quiz ? `
    <div class="mt-space-lg p-space-md rounded-xl bg-cinnabar-subtle/40 border border-primary/20">
      <div class="flex items-center justify-between mb-space-xs">
        <span class="font-label-md text-xs text-primary font-bold flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[18px]">quiz</span>
          Bài tập phản xạ nhanh (Mini Practice TOCFL)
        </span>
        <span class="font-label-sm text-xs text-on-surface-variant">Thử thách 1 câu</span>
      </div>
      <p class="font-body-md text-sm text-on-surface mt-1">
        Điền từ thích hợp vào chỗ trống để hoàn thành câu đúng ngữ pháp:
      </p>
      <!-- Question Box -->
      <div class="bg-paper-card p-space-md rounded-lg shadow-xs mt-space-sm flex flex-col md:flex-row md:items-center justify-between gap-space-md border border-border-subtle/50">
        <div class="font-headline-md text-base text-on-surface font-serif font-medium">
          ${esc(item.quiz.q)}
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${quizOptsHtml}
        </div>
      </div>
      <div class="hidden mt-space-sm p-space-sm rounded-lg font-body-sm text-xs" id="practice-result"></div>
    </div>
    ` : ''}
  `;
}

function updateGrammarGrid() {
  const container = document.getElementById("grammar-cards-grid");
  if (!container) return;
  const q = window.GRAMMAR_SEARCH_QUERY || "";
  const filter = window.ACTIVE_GRAMMAR_FILTER || "all";

  const filtered = GRAMMAR_MASTER_LIST.filter(g => {
    if (filter !== "all" && g.levelGroup !== filter) return false;
    if (q) {
      const match = g.name.toLowerCase().includes(q) || 
                    g.zh.toLowerCase().includes(q) || 
                    g.formula.toLowerCase().includes(q) || 
                    g.summary.toLowerCase().includes(q) ||
                    (g.wrong && g.wrong.zh.includes(q)) ||
                    (g.correct && g.correct.zh.includes(q));
      if (!match) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-1 md:col-span-2 text-center py-12 text-on-surface-variant bg-paper-card rounded-xl border border-border-subtle">
        <span class="material-symbols-outlined text-[36px] text-outline mb-2">search_off</span>
        <p class="text-sm">Không tìm thấy cấu trúc ngữ pháp phù hợp với từ khóa "${esc(q)}".</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(g => {
    const isBookmarked = window.GRAMMAR_BOOKMARKS.has(g.id);
    const isCurrent = (g.id === window.ACTIVE_GRAMMAR_ID);
    const bandColor = g.band.includes("A2") ? "jade-subtle text-secondary" :
                      g.band.includes("B1") ? "cinnabar-subtle text-primary" :
                      g.band.includes("B2") ? "amber-subtle text-tertiary" : "surface-container text-on-surface";
    return `
      <div class="bg-paper-card rounded-xl p-space-md shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between border ${isCurrent ? 'border-primary/50 ring-2 ring-primary/10' : 'border-border-subtle'}">
        <div>
          <div class="flex items-center justify-between">
            <span class="px-2 py-0.5 rounded bg-${bandColor} font-label-sm text-xs font-semibold">${esc(g.band)}</span>
            <span class="text-outline font-label-sm text-xs font-medium flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">star</span>
              ${esc(g.freq)}
            </span>
          </div>
          <h3 class="font-headline-md text-base text-on-surface font-semibold mt-space-sm font-serif">
            ${esc(g.name)}
          </h3>
          <div class="font-code text-xs text-primary font-medium mt-1">
            ${esc(g.formula)}
          </div>
          <p class="font-body-sm text-xs text-on-surface-variant mt-2 line-clamp-2 leading-relaxed">
            ${esc(g.summary)}
          </p>
        </div>
        <div class="mt-space-md pt-space-sm border-t border-border-subtle/50 flex items-center justify-between">
          <button class="font-label-md text-xs text-primary hover:text-primary-container font-semibold inline-flex items-center gap-1" onclick="selectGrammarSpotlight('${g.id}')">
            <span>Chi tiết & Luyện tập</span>
            <span class="material-symbols-outlined text-[16px]">navigate_next</span>
          </button>
          <button class="w-8 h-8 rounded-lg ${isBookmarked ? 'text-tertiary bg-amber-subtle' : 'text-outline hover:text-primary hover:bg-cinnabar-subtle'} flex items-center justify-center transition-colors" onclick="toggleGrammarBookmark('${g.id}')" title="${isBookmarked ? 'Bỏ lưu sổ tay' : 'Lưu vào sổ tay'}">
            <span class="material-symbols-outlined text-[18px]">${isBookmarked ? 'bookmark' : 'bookmark_border'}</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function renderSidebarNotebook() {
  const container = document.getElementById("sidebar-notebook-items");
  const countEl = document.getElementById("sidebar-notebook-count");
  if (countEl) countEl.textContent = `${window.GRAMMAR_BOOKMARKS.size} Mục`;
  if (!container) return;

  const bookmarkedList = GRAMMAR_MASTER_LIST.filter(g => window.GRAMMAR_BOOKMARKS.has(g.id));
  if (bookmarkedList.length === 0) {
    container.innerHTML = `
      <div class="p-3 text-center text-xs text-outline bg-paper-base rounded-lg border border-border-subtle/50">
        Chưa có mẫu câu nào được ghim. Nhấn biểu tượng bookmark để lưu mẫu ngữ pháp cần nhớ!
      </div>
    `;
    return;
  }

  container.innerHTML = bookmarkedList.slice(0, 6).map(g => `
    <div class="p-2.5 rounded-lg bg-paper-base hover:bg-surface-container transition-colors group cursor-pointer border border-border-subtle/40 flex items-center justify-between" onclick="selectGrammarSpotlight('${g.id}')">
      <div class="flex flex-col">
        <span class="font-headline-md text-xs md:text-sm text-on-surface font-semibold group-hover:text-primary font-serif">${esc(g.name)}</span>
        <span class="font-code text-[11px] text-outline truncate max-w-[200px]">${esc(g.formula)}</span>
      </div>
      <span class="material-symbols-outlined text-tertiary text-[18px]">bookmark</span>
    </div>
  `).join("");
}

VIEWS["ngu-phap"] = () => {
  // Load saved bookmarks from storage
  try {
    const saved = localStorage.getItem("bookmarked_grammar");
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) window.GRAMMAR_BOOKMARKS = new Set(arr);
    }
  } catch(e){}

  const spotlightItem = GRAMMAR_MASTER_LIST.find(g => g.id === window.ACTIVE_GRAMMAR_ID) || GRAMMAR_MASTER_LIST[0];

  setView(`
    <div class="flex flex-col w-full">
      <!-- Top Background Ambient Atmosphere -->
      <div class="relative w-full overflow-hidden pb-space-2xl">
        <!-- Scholarly Oriental Backdrop Canvas Accents -->
        <div class="absolute -top-12 right-6 w-96 h-96 rounded-full bg-gradient-to-br from-cinnabar-subtle/60 via-amber-subtle/30 to-transparent blur-3xl pointer-events-none -z-10"></div>
        <div class="absolute top-1/3 left-0 w-80 h-80 rounded-full bg-gradient-to-tr from-jade-subtle/70 via-paper-muted/40 to-transparent blur-2xl pointer-events-none -z-10"></div>
        
        <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin pt-space-lg">
          <!-- 1. Editorial Header Section -->
          <section class="flex flex-col lg:flex-row lg:items-end justify-between gap-space-lg pb-space-lg border-b border-border-subtle/60">
            <div class="max-w-2xl">
              <div class="flex items-center gap-space-sm mb-space-xs">
                <span class="inline-block w-2.5 h-2.5 rounded-full bg-primary"></span>
                <span class="font-label-sm text-xs text-primary tracking-widest uppercase font-semibold">CẤU TRÚC & MẪU CÂU • 實用文法寶典</span>
                <span class="font-code text-xs text-outline">• TOCFL Standard</span>
              </div>
              <h1 class="font-headline-lg text-2xl md:text-3xl text-on-surface font-semibold tracking-tight mt-space-xs font-serif">
                Học Ngữ pháp tiếng Hoa Phồn thể
              </h1>
              <p class="font-body-lg text-sm md:text-base text-on-surface-variant mt-space-xs leading-relaxed">
                Tổng hợp các mẫu câu trọng điểm chuẩn hóa theo khung năng lực TOCFL Band A/B/C và cấu trúc khẩu ngữ tự nhiên Đài Loan.
              </p>
            </div>
            
            <!-- Search & Filter Controls -->
            <div class="flex flex-col gap-space-sm w-full lg:w-auto min-w-[340px]">
              <div class="relative flex items-center">
                <span class="material-symbols-outlined absolute left-3.5 text-[20px] text-outline pointer-events-none">search</span>
                <input class="w-full h-11 pl-10 pr-space-md rounded-xl bg-paper-card text-on-surface font-body-md text-sm placeholder:text-outline shadow-xs border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-150" placeholder="Tra cứu cấu trúc (ví dụ: 把, 被, 越來越, 與其...)" type="text" id="grammarSearchInput" oninput="filterGrammarSearch(this.value)"/>
              </div>
              <div class="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
                <button class="grammar-tab-btn px-3 py-1.5 rounded-lg bg-cinnabar-subtle text-primary font-label-md text-xs font-semibold whitespace-nowrap shadow-xs" onclick="filterGrammarTab('all', this)">
                  Tất cả
                </button>
                <button class="grammar-tab-btn px-3 py-1.5 rounded-lg bg-paper-card text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-label-md text-xs font-medium whitespace-nowrap transition-colors shadow-xs border border-border-subtle/50" onclick="filterGrammarTab('A1/A2', this)">
                  A1/A2 (Cơ bản)
                </button>
                <button class="grammar-tab-btn px-3 py-1.5 rounded-lg bg-paper-card text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-label-md text-xs font-medium whitespace-nowrap transition-colors shadow-xs border border-border-subtle/50" onclick="filterGrammarTab('B1', this)">
                  B1 (Trung cấp)
                </button>
                <button class="grammar-tab-btn px-3 py-1.5 rounded-lg bg-paper-card text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-label-md text-xs font-medium whitespace-nowrap transition-colors shadow-xs border border-border-subtle/50" onclick="filterGrammarTab('B2', this)">
                  B2 (Cao cấp)
                </button>
                <button class="grammar-tab-btn px-3 py-1.5 rounded-lg bg-paper-card text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-label-md text-xs font-medium whitespace-nowrap transition-colors shadow-xs border border-border-subtle/50" onclick="filterGrammarTab('Khẩu ngữ', this)">
                  Khẩu ngữ Đài Loan
                </button>
              </div>
            </div>
          </section>

          <!-- 2. Metrics Bar (Chỉ số tiến độ ngữ pháp TOCFL) -->
          <section class="grid grid-cols-2 md:grid-cols-4 gap-space-md my-space-lg">
            <!-- Metric 1 -->
            <div class="bg-paper-card rounded-xl p-space-md shadow-xs border border-border-subtle relative overflow-hidden flex flex-col justify-between">
              <div class="flex items-center justify-between">
                <span class="font-label-md text-xs text-on-surface-variant font-medium">Tổng điểm ngữ pháp</span>
                <div class="w-8 h-8 rounded-lg bg-cinnabar-subtle flex items-center justify-center text-primary">
                  <span class="material-symbols-outlined text-[18px]">menu_book</span>
                </div>
              </div>
              <div class="mt-space-sm">
                <div class="flex items-baseline gap-1">
                  <span class="font-headline-lg text-xl font-bold text-on-surface">142</span>
                  <span class="font-label-sm text-xs text-outline font-semibold">điểm cốt lõi</span>
                </div>
                <div class="flex items-center gap-1 mt-1 text-secondary font-label-sm text-xs">
                  <span class="material-symbols-outlined text-[14px]">trending_up</span>
                  <span>+6 mẫu trong tuần này</span>
                </div>
              </div>
              <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/20"></div>
            </div>

            <!-- Metric 2 -->
            <div class="bg-paper-card rounded-xl p-space-md shadow-xs border border-border-subtle relative overflow-hidden flex flex-col justify-between">
              <div class="flex items-center justify-between">
                <span class="font-label-md text-xs text-on-surface-variant font-medium">Đang nắm vững</span>
                <div class="w-8 h-8 rounded-lg bg-jade-subtle flex items-center justify-center text-secondary">
                  <span class="material-symbols-outlined text-[18px]">verified</span>
                </div>
              </div>
              <div class="mt-space-sm">
                <div class="flex items-baseline gap-1">
                  <span class="font-headline-lg text-xl font-bold text-secondary">98</span>
                  <span class="font-label-sm text-xs text-outline font-semibold">/ 142 mẫu câu</span>
                </div>
                <div class="w-full bg-surface-container rounded-full h-1.5 mt-2">
                  <div class="bg-secondary h-1.5 rounded-full" style="width: 69%"></div>
                </div>
              </div>
              <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-secondary/30"></div>
            </div>

            <!-- Metric 3 -->
            <div class="bg-paper-card rounded-xl p-space-md shadow-xs border border-border-subtle relative overflow-hidden flex flex-col justify-between">
              <div class="flex items-center justify-between">
                <span class="font-label-md text-xs text-on-surface-variant font-medium">Cần ôn tập gấp</span>
                <div class="w-8 h-8 rounded-lg bg-amber-subtle flex items-center justify-center text-tertiary">
                  <span class="material-symbols-outlined text-[18px]">schedule</span>
                </div>
              </div>
              <div class="mt-space-sm">
                <div class="flex items-baseline gap-1">
                  <span class="font-headline-lg text-xl font-bold text-tertiary">12</span>
                  <span class="font-label-sm text-xs text-outline font-semibold">mục theo chu kỳ</span>
                </div>
                <p class="font-label-sm text-xs text-on-surface-variant mt-1 flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                  Ưu tiên ôn trước 22:00 hôm nay
                </p>
              </div>
              <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-tertiary/30"></div>
            </div>

            <!-- Metric 4 -->
            <div class="bg-paper-card rounded-xl p-space-md shadow-xs border border-border-subtle relative overflow-hidden flex flex-col justify-between">
              <div class="flex items-center justify-between">
                <span class="font-label-md text-xs text-on-surface-variant font-medium">Độ chuẩn xác TOCFL</span>
                <div class="w-8 h-8 rounded-lg bg-cinnabar-subtle flex items-center justify-center text-primary-container">
                  <span class="material-symbols-outlined text-[18px]">military_tech</span>
                </div>
              </div>
              <div class="mt-space-sm">
                <div class="flex items-baseline gap-1">
                  <span class="font-headline-lg text-xl font-bold text-on-surface">88%</span>
                  <span class="font-label-sm text-xs text-secondary font-semibold">Mục tiêu Band B</span>
                </div>
                <div class="w-full bg-surface-container rounded-full h-1.5 mt-2">
                  <div class="bg-primary-container h-1.5 rounded-full" style="width: 88%"></div>
                </div>
              </div>
              <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-container/30"></div>
            </div>
          </section>

          <!-- Main Layout: 2 Columns (Content 68% + Sidebar 32%) -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-xl items-start">
            <!-- Left & Center Primary Content -->
            <div class="lg:col-span-8 flex flex-col gap-space-xl">
              <!-- 3. Featured Grammar Spotlight -->
              <article class="bg-paper-card rounded-2xl p-space-lg shadow-xs border border-border-subtle relative overflow-hidden" id="grammar-spotlight-container">
                ${renderSpotlightContent(spotlightItem)}
              </article>

              <!-- 4. Danh sách các chủ điểm ngữ pháp khác -->
              <section class="flex flex-col gap-space-md">
                <div class="flex items-center justify-between">
                  <div>
                    <h2 class="font-headline-md text-lg md:text-xl text-on-surface font-semibold flex items-center gap-2 font-serif">
                      <span class="w-2 h-2 rounded-full bg-secondary"></span>
                      Khám phá các chủ điểm ngữ pháp khác
                    </h2>
                    <p class="font-body-sm text-xs text-on-surface-variant mt-0.5">
                      Lộ trình phân tầng từ sơ cấp đến cao cấp dành riêng cho học viên thi lấy chứng chỉ TOCFL
                    </p>
                  </div>
                  <button class="hidden sm:inline-flex items-center gap-1 font-label-md text-xs text-primary font-semibold hover:underline" onclick="filterGrammarTab('all')">
                    Xem toàn bộ danh mục
                    <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </button>
                </div>

                <!-- Grammar Cards Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-space-md" id="grammar-cards-grid">
                </div>
              </section>
            </div>

            <!-- 5. Right Sidebar (Sổ tay cá nhân & Mẹo thi TOCFL Band B) -->
            <aside class="lg:col-span-4 flex flex-col gap-space-lg w-full">
              <!-- Editorial Notebook Block (Sổ tay ngữ pháp của bạn) -->
              <div class="bg-paper-card rounded-2xl p-space-md shadow-xs border border-border-subtle">
                <div class="flex items-center justify-between pb-space-sm border-b border-border-subtle/60">
                  <div class="flex items-center gap-space-xs">
                    <span class="material-symbols-outlined text-primary text-[20px]">stylus_note</span>
                    <h3 class="font-headline-md text-base text-on-surface font-semibold font-serif">Sổ tay ngữ pháp của bạn</h3>
                  </div>
                  <span class="px-2 py-0.5 rounded-full bg-paper-base text-outline font-code text-xs font-semibold" id="sidebar-notebook-count">3 Mục</span>
                </div>
                <p class="font-body-sm text-xs text-on-surface-variant mt-space-sm">
                  Những mẫu câu trọng điểm bạn đã gắn sao ghi nhớ cùng lưu ý cá nhân.
                </p>

                <!-- Bookmarked items list -->
                <div class="mt-space-sm space-y-space-xs" id="sidebar-notebook-items">
                </div>

                <!-- Add Note Button -->
                <button class="w-full mt-space-md py-2.5 rounded-xl border border-dashed border-outline/30 hover:border-primary text-outline hover:text-primary font-label-md text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-xs" onclick="promptAddGrammarNote()">
                  <span class="material-symbols-outlined text-[16px]">edit_note</span>
                  <span>Thêm ghi chú cấu trúc mới</span>
                </button>
              </div>

              <!-- TOCFL Exam Strategy Tips Card -->
              <div class="bg-gradient-to-br from-paper-card via-paper-card to-cinnabar-subtle/30 rounded-2xl p-space-md shadow-xs border border-border-subtle relative overflow-hidden">
                <div class="flex items-center gap-2 text-primary mb-space-sm">
                  <span class="material-symbols-outlined text-[20px]">lightbulb</span>
                  <h3 class="font-headline-md text-base font-semibold text-on-surface font-serif">Mẹo thi TOCFL Band B</h3>
                </div>
                <div class="space-y-space-sm">
                  <div class="p-3 rounded-lg bg-paper-base/90 border border-border-subtle/40">
                    <div class="font-label-md text-xs text-primary font-bold">1. Bẫy liên từ chỉ sự tương phản</div>
                    <p class="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                      Chú ý sự khác biệt giữa <span class="font-semibold text-on-surface">儘管 (jǐnguǎn)</span> và <span class="font-semibold text-on-surface">固然 (gùrán)</span>. Đề thi thường đặt ở vế đầu để đánh lừa tìm cặp liên từ đi kèm (thường là 卻 hoặc 還是).
                    </p>
                  </div>
                  <div class="p-3 rounded-lg bg-paper-base/90 border border-border-subtle/40">
                    <div class="font-label-md text-xs text-secondary font-bold">2. Trật tự phó từ thời gian & địa điểm</div>
                    <p class="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                      Trong tiếng Hoa: <span class="font-semibold text-on-surface">Thời gian & Địa điểm luôn đứng TRƯỚC hành động</span>. Bất cứ đáp án nào đảo vị ngữ ra trước cụm "在 + Địa điểm" đều là bẫy ngữ pháp.
                    </p>
                  </div>
                  <div class="p-3 rounded-lg bg-paper-base/90 border border-border-subtle/40">
                    <div class="font-label-md text-xs text-tertiary font-bold">3. Bổ ngữ kết quả & Bổ ngữ khả năng</div>
                    <p class="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                      Phân biệt <span class="font-semibold text-on-surface">看懂 (đã hiểu)</span> với <span class="font-semibold text-on-surface">看得懂 (có khả năng hiểu)</span>. Dạng phủ định là 看不懂 chứ không bao giờ nói 不看懂.
                    </p>
                  </div>
                </div>

                <!-- Ink Stamp Aesthetic -->
                <div class="mt-space-md pt-space-sm border-t border-border-subtle/60 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-primary-container text-white flex items-center justify-center font-headline-md text-xs font-bold font-serif">
                      印
                    </div>
                    <span class="font-label-sm text-[11px] text-outline font-code">TOCFL TAIWAN SPEC</span>
                  </div>
                  <span class="font-label-sm text-[11px] text-secondary font-semibold">Cập nhật 2024</span>
                </div>
              </div>

              <!-- Academic Community / Daily Challenge Banner -->
              <div class="bg-paper-card rounded-2xl p-space-md shadow-xs border border-border-subtle relative overflow-hidden">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-jade-subtle text-secondary flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-[24px]">psychology</span>
                  </div>
                  <div>
                    <h4 class="font-headline-md text-sm text-on-surface font-semibold font-serif">Thử thách Ngữ pháp 7 ngày</h4>
                    <p class="font-body-sm text-xs text-on-surface-variant mt-0.5">Mỗi ngày 5 câu phức TOCFL B1</p>
                  </div>
                </div>
                <!-- Mini Progress visualization -->
                <div class="mt-space-md">
                  <div class="flex justify-between font-label-sm text-xs text-on-surface-variant mb-1">
                    <span>Tiến độ thử thách: Ngày 4 / 7</span>
                    <span class="font-semibold text-secondary">57%</span>
                  </div>
                  <div class="grid grid-cols-7 gap-1">
                    <div class="h-2 rounded bg-secondary"></div>
                    <div class="h-2 rounded bg-secondary"></div>
                    <div class="h-2 rounded bg-secondary"></div>
                    <div class="h-2 rounded bg-secondary"></div>
                    <div class="h-2 rounded bg-surface-container"></div>
                    <div class="h-2 rounded bg-surface-container"></div>
                    <div class="h-2 rounded bg-surface-container"></div>
                  </div>
                </div>
                <button class="w-full mt-space-md py-2 rounded-xl bg-primary hover:bg-primary-container text-white font-label-md text-xs font-semibold transition-colors duration-150 shadow-xs" onclick="selectGrammarSpotlight('ba')">
                  Tiếp tục bài tập ngày 5
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  `);

  updateGrammarGrid();
  renderSidebarNotebook();
};

// =========================================================================
// 5. TRA CỨU & NHẬP TỪ VỰNG (Exact Stitch Design + Hanzii VIP & Auto-Translate)
// =========================================================================

// ---------------- HỖ TRỢ DỊCH TỰ ĐỘNG CHỮ HÁN / TIẾNG ANH SANG TIẾNG VIỆT ----------------
async function autoTranslateZhToVi(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-TW&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data && data[0]) {
      return data[0].map((item) => item[0]).join("").trim();
    }
    return "";
  } catch (e) {
    console.error("Auto-translate Zh->Vi error:", e);
    return "";
  }
}

async function autoTranslateEnToVi(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data && data[0]) {
      return data[0].map((item) => item[0]).join("").trim();
    }
    return "";
  } catch (e) {
    console.error("Auto-translate En->Vi error:", e);
    return "";
  }
}

// Shared helper to render the Stitch 7+5 Master Dictionary Showcase for any word `w`
function buildStitchWordShowcaseHTML(w) {
  const n = S.noteByWord.get(w);
  const e = cedFirst(w);
  const inLearn = n && inLearning(n);
  const customVi = S.vi ? S.vi.get(w) : null;
  const it = n
    ? itemOf(n)
    : {
        w,
        py: (customVi && customVi.py) || (e ? e[0][0] : (w === "璀璨" ? "cuǐ càn" : "")),
        vn: (customVi && customVi.vn) || (w === "璀璨" ? "Mô tả sắc ngọc quý toả ánh sáng lấp lánh rạng ngời, hoa lệ rực rỡ tuyệt mỹ." : ""),
        hv: (customVi && customVi.hv) || (w === "璀璨" ? "Tuy Xán" : ""),
        en: e ? e[0][1].split("/").join("; ") : (w === "璀璨" ? "bright and resplendent; glittering" : ""),
        pos: (customVi && customVi.pos) || (w === "璀璨" ? "Tính từ (形容詞)" : "Từ vựng"),
        band: w === "璀璨" ? "C1 • Lưu loát" : ""
      };
  const chars = [...new Set([...hanOnly(w)])];
  if (!chars.length && w) chars.push(w[0]);
  const containing = (c) => S.notes.filter((x) => x.kind === "vocab" && x.w.includes(c) && x.w !== w).slice(0, 8);
  const curLvl = n ? noteLevel(n) : 0;
  const unicodeHex = chars.map((ch) => "U+" + ch.codePointAt(0).toString(16).toUpperCase()).join(" ");
  const bandLabel = n ? `TOCFL ${bandsOf(n).join(" · ") || "Chuẩn"}` : (it.band ? `TOCFL ${it.band}` : "Mở rộng CC-CEDICT");

  return `
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-xl">
      <!-- Left: Word Card Showcase & Hanzi Stroke Breakdown (7 cols) -->
      <div class="lg:col-span-7 flex flex-col gap-space-lg">
        <!-- Master Dictionary Showcase Card -->
        <div class="bg-paper-card p-space-lg md:p-space-xl rounded-2xl border border-border-subtle/70 shadow-sm relative overflow-hidden flex flex-col gap-space-lg">
          <!-- Traditional Red Seal Background Stamp -->
          <div class="absolute -right-8 -top-8 w-44 h-44 rounded-full bg-cinnabar-subtle opacity-60 pointer-events-none flex items-center justify-center">
            <span class="font-display text-primary text-[88px] opacity-25 select-none font-bold">${esc(chars[0] || "學")}</span>
          </div>

          <!-- Header of Entry Card -->
          <div class="flex items-start justify-between relative z-10 gap-2 flex-wrap">
            <div class="flex items-center gap-space-sm flex-wrap">
              <span class="px-2.5 py-1 rounded-full bg-primary text-on-primary font-label-sm text-label-sm font-semibold tracking-wide">
                ${esc(bandLabel)}
              </span>
              <span class="px-2 py-0.5 rounded-md bg-amber-subtle text-tertiary font-label-sm text-label-sm">
                Từ tính: ${esc(it.pos || "Từ vựng")}
              </span>
              <span class="px-2 py-0.5 rounded-md bg-paper-base text-outline font-code text-body-sm">
                Unicode: ${esc(unicodeHex)}
              </span>
            </div>
            <!-- Quick Direct Save Actions -->
            <div class="flex items-center gap-space-xs">
              <button type="button" class="px-space-md py-1.5 rounded-xl ${inLearn ? "bg-jade-subtle text-secondary" : "bg-cinnabar-subtle hover:bg-primary-fixed text-primary"} font-label-md text-label-md font-semibold transition-all duration-150 flex items-center gap-1.5 shadow-sm" id="addLearn">
                <span class="material-symbols-outlined text-[18px]">${inLearn ? "bookmark_added" : "bookmark_add"}</span>
                <span>${inLearn ? "✓ Đang trong lịch học" : "+ Lưu vào sổ"}</span>
              </button>
            </div>
          </div>

          <!-- Calligraphic Mi-zi-ge (米字格) Character Display + HanziWriter -->
          <div class="flex flex-col sm:flex-row items-center sm:items-start gap-space-lg py-space-sm relative z-10">
            <!-- Rice Grid Boxes Container -->
            <div class="flex items-center gap-space-md flex-wrap justify-center">
              ${chars.map((c, k) => `
                <div class="flex flex-col items-center gap-1.5">
                  <div class="relative w-32 h-32 md:w-36 md:h-36 bg-[#FFFDF9] rounded-xl border border-border-subtle flex items-center justify-center shadow-inner overflow-hidden group cursor-pointer" data-anim-w="${k}" title="Nhấn để xem diễn hoạ bút thuận chữ ${esc(c)}">
                    <svg class="absolute inset-0 w-full h-full text-surface-container-highest stroke-current pointer-events-none" stroke-dasharray="2,3" stroke-width="0.8" viewBox="0 0 100 100">
                      <line x1="0" x2="100" y1="0" y2="100"></line>
                      <line x1="100" x2="0" y1="0" y2="100"></line>
                      <line x1="50" x2="50" y1="0" y2="100"></line>
                      <line x1="0" x2="100" y1="50" y2="50"></line>
                    </svg>
                    <div id="wordHw${k}" class="relative z-10 flex items-center justify-center">
                      <span class="font-display text-[72px] md:text-[82px] text-on-surface select-none leading-none">${esc(c)}</span>
                    </div>
                  </div>
                  <div class="flex gap-1">
                    <button type="button" class="text-[11px] px-2 py-0.5 rounded bg-paper-base hover:bg-cinnabar-subtle text-primary border border-border-subtle" data-anim-w="${k}">Xem nét</button>
                    <button type="button" class="text-[11px] px-2 py-0.5 rounded bg-paper-base hover:bg-jade-subtle text-secondary border border-border-subtle" data-quiz-w="${k}">Tập viết</button>
                  </div>
                </div>
              `).join("")}
            </div>

            <!-- Pronunciation, Han-Viet, and Meaning -->
            <div class="flex flex-col gap-space-xs text-center sm:text-left justify-center flex-1 min-w-0">
              <div class="flex items-center justify-center sm:justify-start gap-space-sm flex-wrap">
                <h2 class="font-headline-lg text-4xl md:text-5xl font-bold text-on-surface font-serif select-all mr-2">${esc(w)}</h2>
                <span class="font-body-lg text-2xl md:text-3xl font-bold text-primary">${esc(it.py || "")}</span>
                <button type="button" class="w-8 h-8 rounded-full bg-cinnabar-subtle hover:bg-primary-fixed text-primary flex items-center justify-center transition-transform active:scale-95 shadow-sm" onclick="say('${esc(w)}')" title="Phát âm chuẩn Đài Bắc (Quốc ngữ)">
                  <span class="material-symbols-outlined text-[18px]">volume_up</span>
                </button>
                <span class="text-outline text-body-sm font-code">Đài Loan [Chuẩn]</span>
              </div>

              <div class="flex items-center justify-center sm:justify-start gap-space-md text-on-surface-variant flex-wrap">
                <div class="flex items-center gap-1 font-body-md text-body-md">
                  <span class="text-outline font-label-sm">Hán Việt:</span>
                  <span class="font-semibold text-on-surface">${esc(it.hv || "Đang cập nhật")}</span>
                </div>
              </div>

              <!-- Meaning Section & Actions -->
              <div class="flex flex-col gap-1.5 pt-2 border-t border-border-subtle/60 mt-1">
                <div class="flex items-center justify-between flex-wrap gap-2">
                  <span class="text-xs uppercase font-semibold text-outline">Nghĩa tiếng Việt</span>
                  <div class="flex items-center gap-1.5">
                    <button type="button" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-jade-subtle text-secondary hover:bg-secondary-container border border-secondary/30 flex items-center gap-1 transition-colors" id="btnAutoTranslate" title="Tự động dịch sang tiếng Việt">
                      <span class="material-symbols-outlined text-[15px]">translate</span>
                      <span>Dịch tự động</span>
                    </button>
                    <button type="button" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-paper-muted text-on-surface hover:bg-surface-container border border-border-subtle flex items-center gap-1 transition-colors" id="btnEditMeaning">
                      <span class="material-symbols-outlined text-[15px]">edit</span>
                      <span>${it.vn ? "Sửa nghĩa" : "+ Thêm nghĩa TV"}</span>
                    </button>
                  </div>
                </div>
                <div class="font-body-md text-lg md:text-xl text-on-surface font-semibold leading-relaxed" id="meaningDisplay">
                  ${it.vn
                    ? esc(it.vn)
                    : it.en
                      ? `<span class="text-on-surface-variant font-normal text-sm italic">${esc(it.en)} <small class="text-tertiary not-italic block text-xs mt-1 font-sans">⚠️ Từ này hiện có nghĩa tiếng Anh. Bấm "Dịch tự động" hoặc "Tra trên Hanzii VIP ↗" để cập nhật tiếng Việt!</small></span>`
                      : '<span class="text-outline text-sm">Chưa có định nghĩa tiếng Việt. Bấm "Dịch tự động" hoặc "+ Thêm nghĩa TV".</span>'}
                </div>
                ${it.vn && it.en ? `<div class="text-xs text-outline">${esc(it.en)}</div>` : ""}
              </div>
            </div>
          </div>

          <!-- Inline Meaning Editor (Hidden by default) -->
          <div id="editMeaningBox" class="hidden p-4 rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-3 transition-all relative z-10">
            <div class="flex items-center justify-between border-b border-border-subtle pb-2">
              <span class="text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[16px] text-primary">edit_note</span>
                <span>Chỉnh sửa nghĩa Tiếng Việt &amp; Hán Việt cho "${esc(w)}"</span>
              </span>
              <button type="button" class="text-xs text-outline hover:text-on-surface" id="btnCancelEdit">Đóng ✕</button>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[11px] font-semibold text-on-surface-variant">Nghĩa tiếng Việt:</label>
              <input id="editVn" class="w-full px-3 py-2 rounded-lg bg-paper-card border border-border-subtle text-sm text-on-surface focus:outline-none focus:border-primary" value="${esc(it.vn || "")}" placeholder="VD: con nhện; rực rỡ lấp lánh">
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="flex flex-col gap-1">
                <label class="text-[11px] font-semibold text-on-surface-variant">Âm Hán Việt:</label>
                <input id="editHv" class="w-full px-3 py-2 rounded-lg bg-paper-card border border-border-subtle text-sm text-on-surface focus:outline-none focus:border-primary" value="${esc(it.hv || "")}" placeholder="VD: Tri chu">
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-[11px] font-semibold text-on-surface-variant">Từ loại:</label>
                <input id="editPos" class="w-full px-3 py-2 rounded-lg bg-paper-card border border-border-subtle text-sm text-on-surface focus:outline-none focus:border-primary" value="${esc(it.pos || "")}" placeholder="VD: Danh từ">
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle/50">
              <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors" id="btnAutoFillTranslate">
                Lấy bản dịch gợi ý
              </button>
              <button type="button" class="px-4 py-2 rounded-xl text-xs font-bold bg-primary-container text-white hover:bg-primary transition-all shadow-2xs" id="btnSaveMeaning">
                Lưu vào từ điển
              </button>
            </div>
          </div>

          <!-- Prominent External Dictionaries Box (Hanzii VIP, Moedict, Trichdan) -->
          <div class="p-3.5 rounded-xl bg-paper-base border border-border-subtle flex flex-col gap-2 relative z-10">
            <div class="flex items-center justify-between text-xs text-outline font-semibold uppercase">
              <span class="flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[16px] text-tertiary">open_in_new</span>
                <span>Tra cứu chuyên sâu trên Hanzii VIP &amp; Bộ GD Đài Loan</span>
              </span>
              <span class="text-[11px] text-outline">Hỗ trợ tài khoản VIP</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <a href="https://hanzii.net/search/word/${encodeURIComponent(w)}?hl=vi" target="_blank" rel="noopener noreferrer" class="px-3.5 py-1.5 rounded-xl bg-cinnabar-subtle hover:bg-primary-fixed text-primary border border-primary/20 text-xs font-bold transition-all flex items-center gap-1.5 no-underline">
                <span class="w-2 h-2 rounded-full bg-primary"></span>
                <span>Tra trên Hanzii VIP ↗</span>
              </a>
              <a href="https://www.moedict.tw/${encodeURIComponent(w)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-xl bg-paper-card hover:bg-surface-container text-on-surface border border-border-subtle text-xs font-medium transition-all flex items-center gap-1.5 no-underline">
                <span>🇹🇼 Từ điển Đài Loan (萌典) ↗</span>
              </a>
              <a href="https://trichdan.net/tu-dien/han-viet/${encodeURIComponent(w)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-xl bg-paper-card hover:bg-surface-container text-on-surface border border-border-subtle text-xs font-medium transition-all flex items-center gap-1.5 no-underline">
                <span>📖 Tra Hán Việt (Trích Dẫn) ↗</span>
              </a>
            </div>
          </div>

          <!-- Radical Deconstruction (Chiết tự bộ thủ - Exact Stitch) -->
          <div class="p-space-md bg-paper-base rounded-xl flex flex-col gap-space-sm relative z-10">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1.5">
                <span class="material-symbols-outlined text-tertiary text-[18px]">account_tree</span>
                Chiết tự &amp; Nguồn gốc chữ Hán
              </span>
              <span class="font-label-sm text-label-sm text-outline">Bộ thủ 214 Khang Hy</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
              ${chars.map((ch) => `
                <div class="p-2.5 rounded-lg bg-paper-card border border-border-subtle/50">
                  <strong class="text-primary font-display text-base">${esc(ch)}</strong>: Chữ Hán Phồn thể chuẩn Đài Loan (Mã <span class="font-code text-xs">${"U+" + ch.codePointAt(0).toString(16).toUpperCase()}</span>). Bấm vào ô mễ phía trên để luyện viết từng nét.
                </div>
              `).join("")}
            </div>
          </div>

          <!-- Real-World Taiwanese Context Examples with Audio -->
          <div class="flex flex-col gap-space-sm relative z-10">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1.5">
                <span class="material-symbols-outlined text-primary text-[18px]">format_quote</span>
                Ví dụ câu chuẩn ngữ cảnh Đài Loan
              </span>
              <span class="font-label-sm text-label-sm text-outline">Nguồn: Bộ Giáo dục Đài Loan (MOE)</span>
            </div>
            <div class="flex flex-col gap-space-sm">
              <div class="p-space-md rounded-xl bg-paper-base hover:bg-surface-container-low transition-colors flex flex-col gap-space-xs">
                <div class="flex items-center justify-between gap-2">
                  <p class="font-headline-md text-headline-md text-on-surface font-normal">
                    ${it.e1 ? ruby(it.e1) : (w === "璀璨" ? '台北101的跨年煙火在夜空中綻放出<span class="text-primary font-semibold">璀璨</span>的光芒。' : `在臺灣的日常生活中，我們很常使用「<span class="text-primary font-semibold">${esc(w)}</span>」這個詞彙。`)}
                  </p>
                  <button type="button" class="p-1 rounded-full text-on-surface-variant hover:text-primary hover:bg-paper-card transition-colors shrink-0" onclick="say('${esc(it.e1 || (w === "璀璨" ? "台北101的跨年煙火在夜空中綻放出璀璨的光芒。" : `在臺灣的日常生活中，我們很常使用${w}這個詞彙。`))}')" title="Nghe câu ví dụ">
                    <span class="material-symbols-outlined text-[18px]">volume_up</span>
                  </button>
                </div>
                <p class="font-code text-body-sm text-outline">
                  ${esc(it.e1p || (w === "璀璨" ? "Táiběi 101 de kuànián yānhuǒ zài yèkōng zhōng zhànfàng chū cuǐcàn de guāngmáng." : `Pinyin: ${it.py || w}`))}
                </p>
                <p class="font-body-md text-body-md text-on-surface-variant">
                  ${esc(it.e1v || (w === "璀璨" ? "Pháo hoa đón năm mới của tòa tháp Taipei 101 bung nở những luồng sáng rực rỡ rạng ngời giữa bầu trời đêm." : `Trong đời sống hằng ngày tại Đài Loan, chúng ta rất thường sử dụng từ "${w}" (${it.vn || it.en || ""}).`))}
                </p>
              </div>
            </div>
          </div>

          <!-- 6 Memory Rating Buttons for this word -->
          ${n ? `
            <div class="pt-space-md border-t border-border-subtle flex flex-col gap-2 relative z-10">
              <div class="flex items-center justify-between text-xs text-outline font-semibold uppercase">
                <span>Mức độ ghi nhớ hiện tại</span>
                <span class="text-primary font-bold">${LEVELS[curLvl]}</span>
              </div>
              <div class="grades-6">
                ${[0, 1, 2, 3, 4, 5].map((lvl) => {
                  const isCur = curLvl === lvl;
                  const hints = ["Đặt lại", "Ôn lại ngay", "1 ngày", "7 ngày", "21 ngày", "90 ngày"];
                  return `
                    <button type="button" class="lvl-btn lvl-btn-${lvl} ${isCur ? "is-current" : ""}" data-word-level="${lvl}" title="Đặt ${esc(w)} ở mức ${esc(LEVELS[lvl])}">
                      <span class="lvl-title">${isCur ? "✓ " : ""}${esc(LEVELS[lvl])}</span>
                      <small class="lvl-sub">${hints[lvl]}</small>
                    </button>
                  `;
                }).join("")}
              </div>
              <div id="levelStatus" class="text-xs text-secondary text-center font-semibold mt-1"></div>
            </div>
          ` : ""}
        </div>
      </div>

      <!-- Right: Word Details, Radicals, Collocations & Quick Entry Drawer (5 cols) -->
      <div class="lg:col-span-5 flex flex-col gap-space-lg">
        <!-- Visual Context Card with Traditional Photography (Exact Stitch) -->
        <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
          <div class="relative w-full h-44 rounded-xl overflow-hidden shadow-inner bg-gradient-to-br from-[#1d1b1a] via-[#86090a] to-[#a8261f]">
            <img class="w-full h-full object-cover transition-transform duration-500 hover:scale-105" alt="Taipei Night Glow" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCONGiO5xNHCtbctmkiavM9bxHBFiFWWrXz15aBdQHgmYDW-3X4yC18OBJp0H8qQBxbr_-zvdTyo4_vyBF7ruCOD_DrKaDq6oAImE9HAHQLW1bTuJOWvBsC2dYHBJ_irMGED1eR4wODspBtVFJDAJbAE-o0txMAZpMzQDGz_dPzNP9inSV8QyEFGizVqYMImnJaTCEOtREbHFhXTtXJX60jyT_yIYAb_6TnVtaFvbk2" onerror="this.style.display='none'">
            <div class="absolute inset-0 bg-gradient-to-t from-on-surface/80 via-transparent to-transparent flex items-end p-space-md">
              <span class="text-on-primary font-headline-md text-headline-md font-semibold tracking-wide">
                ${esc(w)} • 臺灣語境 • Ngữ cảnh Đài Loan
              </span>
            </div>
          </div>
          <!-- Collocation Combos -->
          <div class="flex flex-col gap-space-xs">
            <span class="font-label-md text-label-md font-semibold text-on-surface">Từ vựng liên quan cùng chữ Hán (相關詞彙):</span>
            <div class="flex flex-wrap gap-space-xs">
              ${chars.flatMap((c) => containing(c)).slice(0, 6).map((x) => `
                <a href="#tu/${encodeURIComponent(x.w)}" class="px-2.5 py-1 rounded-lg bg-paper-base text-on-surface font-body-sm text-body-sm hover:bg-cinnabar-subtle hover:text-primary transition-colors no-underline">
                  <strong class="font-serif">${esc(x.w)}</strong> <span class="text-outline text-xs">(${esc(itemOf(x).py || "")})</span>
                </a>
              `).join("") || `
                <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-base text-on-surface font-body-sm text-body-sm" onclick="location.hash='#tu/璀璨'">璀璨 (cuǐcàn)</button>
                <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-base text-on-surface font-body-sm text-body-sm" onclick="location.hash='#tu/謙虛'">謙虛 (qiānxū)</button>
                <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-base text-on-surface font-body-sm text-body-sm" onclick="location.hash='#tu/客氣'">客氣 (kèqi)</button>
              `}
            </div>
          </div>
        </div>

        <!-- Quick Append to Custom Notebook Module (Exact Stitch) -->
        <div class="bg-paper-card p-space-lg rounded-2xl border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-xs">
              <span class="w-1.5 h-3.5 rounded-full bg-secondary"></span>
              <h3 class="font-headline-md text-label-md font-semibold text-on-surface">Gán vào mục tiêu học tập</h3>
            </div>
            <span class="font-label-sm text-label-sm text-secondary">Đồng bộ Flashcard SRS</span>
          </div>
          <div class="flex flex-col gap-space-sm">
            <label class="font-label-sm text-label-sm text-on-surface-variant">Chọn Thư mục đích:</label>
            <select id="quickAssignDeck" class="w-full px-space-md py-2 rounded-xl bg-paper-base border border-border-subtle text-on-surface font-body-md text-body-md focus:outline-none">
              <option value="Sổ từ của tôi">📖 Thư mục của tôi (個人詞庫)</option>
              <option value="TOCFL Band B">🎯 Mục tiêu TOCFL Band B1/B2</option>
              <option value="Báo chí & Đời sống Đài Loan">📰 Báo chí &amp; Đời sống Đài Bắc</option>
            </select>
            <label class="font-label-sm text-label-sm text-on-surface-variant pt-1">Ghi chú cá nhân / Nghĩa bổ sung:</label>
            <textarea id="quickAssignNote" class="w-full px-space-md py-2 rounded-xl bg-paper-base border border-border-subtle text-on-surface font-body-sm text-body-sm focus:outline-none placeholder:text-outline/60 resize-none" placeholder="Ghi chú mẹo nhớ bộ thủ hoặc ngữ cảnh gặp từ này..." rows="2">${esc(it.vn || it.en || "")}</textarea>
            <div class="flex items-center justify-between pt-1">
              <span id="quickAssignMsg" class="text-xs font-semibold text-secondary"></span>
              <button type="button" id="btnQuickAssignSave" class="px-space-lg py-2 rounded-xl bg-secondary hover:bg-secondary/90 text-on-secondary font-label-md text-label-md font-semibold shadow-sm transition-all">
                Lưu từ ngay
              </button>
            </div>
          </div>
        </div>

        <!-- CC-CEDICT English Definitions if available -->
        ${e ? `
          <div class="bg-paper-card p-space-lg rounded-2xl border border-border-subtle/70 shadow-sm flex flex-col gap-space-sm">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-label-md font-semibold text-on-surface">Từ điển Anh-Hoa (CC-CEDICT)</span>
              <span class="font-label-sm text-label-sm text-outline">${e.length} mục</span>
            </div>
            <div class="flex flex-col gap-1.5 text-xs">
              ${e.map(([py, defs]) => `
                <div class="p-2 rounded-lg bg-paper-base flex flex-col sm:flex-row sm:items-baseline gap-1.5">
                  <span class="font-code font-bold text-tertiary shrink-0">${esc(py)}</span>
                  <span class="text-on-surface">${esc(defs.replace(/\\[[^\\]]*\\d\\]/g, "").split("/").join("; "))}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderStitchWordShowcase(w, containerSelector, onRefresh) {
  const host = $(containerSelector);
  if (!host) return;
  const n = S.noteByWord.get(w);
  const e = cedFirst(w);
  const inLearn = n && inLearning(n);
  const customVi = S.vi ? S.vi.get(w) : null;
  const it = n
    ? itemOf(n)
    : {
        w,
        py: (customVi && customVi.py) || (e ? e[0][0] : (w === "璀璨" ? "cuǐ càn" : "")),
        vn: (customVi && customVi.vn) || (w === "璀璨" ? "Mô tả sắc ngọc quý toả ánh sáng lấp lánh rạng ngời, hoa lệ rực rỡ tuyệt mỹ." : ""),
        hv: (customVi && customVi.hv) || (w === "璀璨" ? "Tuy Xán" : ""),
        en: e ? e[0][1].split("/").join("; ") : (w === "璀璨" ? "bright and resplendent; glittering" : ""),
        pos: (customVi && customVi.pos) || (w === "璀璨" ? "Tính từ (形容詞)" : "Từ vựng"),
        band: w === "璀璨" ? "C1 • Lưu loát" : ""
      };
  const chars = [...new Set([...hanOnly(w)])];
  if (!chars.length && w) chars.push(w[0]);
  host.innerHTML = buildStitchWordShowcaseHTML(w);

  // Initialize Hanzi Writer inside the Mi-zi-ge boxes
  chars.forEach((c, k) => {
    const el = $("#wordHw" + k);
    if (el && window.HanziWriter) {
      el.innerHTML = "";
      const writer = HanziWriter.create(el, c, {
        width: 120, height: 120, padding: 4, showOutline: true,
        strokeColor: "#86090a", outlineColor: "#EBE2D8", highlightColor: "#176b4b",
        charDataLoader: (ch, onLoad, onErr) => strokeData(ch).then(onLoad).catch(onErr)
      });
      host.querySelectorAll(`[data-anim-w="${k}"]`).forEach((btn) => {
        btn.onclick = () => writer.animateCharacter();
      });
      host.querySelectorAll(`[data-quiz-w="${k}"]`).forEach((btn) => {
        btn.onclick = () => writer.quiz();
      });
    }
  });

  // Action: Add to Learning
  const add = $("#addLearn");
  if (add) {
    add.onclick = async () => {
      if (n) {
        if (!S.settings.extra) S.settings.extra = {};
        S.settings.extra[n.w] = true;
        await saveSettings();
      } else {
        const entry = {
          w,
          py: it.py,
          note: it.vn || it.en || "",
          hv: it.hv || "",
          pos: it.pos || "Từ vựng",
          where: "Từ điển tra cứu",
          at: Date.now()
        };
        if (!S.inbox) S.inbox = new Map();
        S.inbox.set("inbox_" + w, entry);
        try { await Store.put("inbox", "inbox_" + w, entry); } catch (err) {}
        if (typeof syncInboxWordToLearning === "function") syncInboxWordToLearning(entry, true);
      }
      if (typeof updateBadge === "function") updateBadge();
      if (onRefresh) onRefresh(w);
    };
  }

  // Action: Quick Assign to Notebook & SRS
  const btnQuickSave = $("#btnQuickAssignSave");
  if (btnQuickSave) {
    btnQuickSave.onclick = async () => {
      const where = $("#quickAssignDeck")?.value || "Sổ từ của tôi";
      const note = $("#quickAssignNote")?.value.trim() || it.vn || it.en || "";
      const entry = { w, py: it.py, note, hv: it.hv || "", pos: it.pos || "Từ vựng", where, at: Date.now() };
      if (!S.inbox) S.inbox = new Map();
      S.inbox.set("inbox_" + w, entry);
      try { await Store.put("inbox", "inbox_" + w, entry); } catch (err) {}
      if (typeof syncInboxWordToLearning === "function") syncInboxWordToLearning(entry, true);
      if (typeof updateBadge === "function") updateBadge();
      const msg = $("#quickAssignMsg");
      if (msg) msg.textContent = `✓ Đã lưu "${w}" vào sổ & lịch học!`;
    };
  }

  // Action: Meaning Edit & Auto-Translate
  const btnEdit = $("#btnEditMeaning");
  const editBox = $("#editMeaningBox");
  const btnCancel = $("#btnCancelEdit");
  const btnSave = $("#btnSaveMeaning");
  const btnAuto = $("#btnAutoTranslate");
  const btnAutoFill = $("#btnAutoFillTranslate");

  if (btnEdit && editBox) {
    btnEdit.onclick = () => {
      editBox.classList.toggle("hidden");
      if (!editBox.classList.contains("hidden")) $("#editVn")?.focus();
    };
  }
  if (btnCancel && editBox) {
    btnCancel.onclick = () => editBox.classList.add("hidden");
  }

  async function saveCustomMeaning(word, vn, hv, pos) {
    if (!S.vi) S.vi = new Map();
    const prevVi = S.vi.get(word) || {};
    const newVi = Object.assign({}, prevVi, { vn, hv, py: it.py, pos });
    S.vi.set(word, newVi);

    const entry = {
      w: word,
      py: it.py,
      note: vn,
      hv: hv || prevVi.hv || "",
      pos: pos || prevVi.pos || "Từ vựng",
      where: "Từ điển cá nhân",
      at: Date.now()
    };
    if (!S.inbox) S.inbox = new Map();
    S.inbox.set("inbox_" + word, entry);
    try {
      await Store.put("inbox", "inbox_" + word, entry);
      await Store.put("kv", "vi_" + word, newVi);
    } catch (err) {}

    if (typeof syncInboxWordToLearning === "function") syncInboxWordToLearning(entry, false);
    if (onRefresh) onRefresh(word);
  }

  async function doAutoTranslate() {
    const statusEl = $("#meaningDisplay");
    if (statusEl) statusEl.innerHTML = '<span class="text-secondary text-sm font-normal animate-pulse flex items-center gap-1.5"><span class="material-symbols-outlined text-[18px]">sync</span> Đang tự động dịch nghĩa sang tiếng Việt...</span>';

    let trans = await autoTranslateZhToVi(w);
    if ((!trans || trans.toLowerCase() === w.toLowerCase()) && it.en) {
      const transEn = await autoTranslateEnToVi(it.en);
      if (transEn) trans = transEn;
    }

    if (trans) {
      const editVn = $("#editVn");
      if (editVn) editVn.value = trans;
      await saveCustomMeaning(w, trans, $("#editHv") ? $("#editHv").value : "", $("#editPos") ? $("#editPos").value : "");
    } else {
      alert("Không thể dịch tự động lúc này. Bạn có thể bấm nút 'Tra trên Hanzii VIP' để xem nghĩa chuẩn!");
      if (onRefresh) onRefresh(w);
    }
  }

  if (btnAuto) btnAuto.onclick = doAutoTranslate;
  if (btnAutoFill) {
    btnAutoFill.onclick = async () => {
      btnAutoFill.textContent = "Đang dịch...";
      let trans = await autoTranslateZhToVi(w);
      if ((!trans || trans.toLowerCase() === w.toLowerCase()) && it.en) {
        const transEn = await autoTranslateEnToVi(it.en);
        if (transEn) trans = transEn;
      }
      if (trans && $("#editVn")) $("#editVn").value = trans;
      btnAutoFill.textContent = "Lấy bản dịch gợi ý";
    };
  }

  if (btnSave) {
    btnSave.onclick = async () => {
      const vn = $("#editVn") ? $("#editVn").value.trim() : "";
      const hv = $("#editHv") ? $("#editHv").value.trim() : "";
      const pos = $("#editPos") ? $("#editPos").value.trim() : "";
      if (!vn) {
        alert("Vui lòng nhập nghĩa tiếng Việt!");
        return;
      }
      await saveCustomMeaning(w, vn, hv, pos);
    };
  }

  if (n) {
    bindLevelPicker(n, () => {
      if (onRefresh) onRefresh(w);
    });
  }
}

// ---------------- VIEW: TRA & NHẬP TỪ (#tu-dien) ----------------
VIEWS["tu-dien"] = (arg) => {
  const vocabCount = S.notes.filter((n) => n.kind === "vocab").length;
  const initialWord = arg && isHan(arg) ? arg : "璀璨";

  setView(`
    <div class="relative w-full max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-xl">
      <!-- Top Workspace Header & Mode Switcher (Exact Stitch) -->
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-lg">
        <div class="flex flex-col gap-space-xs max-w-2xl">
          <div class="flex items-center gap-space-sm flex-wrap">
            <span class="w-1.5 h-4 rounded-full bg-primary"></span>
            <span class="font-label-sm text-label-sm text-primary uppercase tracking-widest">Từ điển &amp; Quản trị Từ vựng</span>
            <span class="inline-flex items-center px-space-xs py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-label-sm">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary mr-1 animate-pulse"></span>
              TOCFL Đài Loan chuẩn
            </span>
          </div>
          <h1 class="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Tra cứu &amp; Nhập từ vựng <span class="text-on-surface-variant font-normal">| 字詞檢索與錄入</span>
          </h1>
          <p class="font-body-md text-body-md text-on-surface-variant">
            Tra cứu chiết tự Khang Hy, chú âm Đài Loan hoặc phân giải nạp văn bản hàng loạt vào sổ học SRS.
          </p>
        </div>
        <!-- Quick Metrics & Notebook Pill -->
        <div class="flex items-center gap-space-md bg-paper-card border border-border-subtle/70 p-space-sm rounded-xl shadow-sm self-start md:self-auto">
          <div class="flex items-center gap-space-sm px-space-sm py-1 border-r border-surface-container-high">
            <span class="material-symbols-outlined text-primary text-[20px]">collections_bookmark</span>
            <div class="flex flex-col">
              <span class="font-label-sm text-label-sm text-on-surface-variant">Sổ từ hiện tại</span>
              <span class="font-headline-md text-label-md font-semibold text-on-surface">${fmt(vocabCount)} <span class="font-normal text-outline text-[11px]">từ</span></span>
            </div>
          </div>
          <div class="flex items-center gap-space-sm px-space-sm py-1">
            <span class="material-symbols-outlined text-secondary text-[20px]">bolt</span>
            <div class="flex flex-col">
              <span class="font-label-sm text-label-sm text-on-surface-variant">Hanzii &amp; AI</span>
              <span class="font-label-md text-label-md font-semibold text-secondary">Vô hạn (PRO)</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Mode Navigation Tabs -->
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-space-md p-1.5 bg-surface-container-low rounded-xl border border-border-subtle/60">
        <div class="flex items-center gap-space-xs p-1 bg-surface-container rounded-lg">
          <a href="#tu-dien" class="flex items-center gap-space-sm px-space-lg py-2 rounded-lg font-label-md text-label-md transition-all duration-200 bg-paper-card text-primary shadow-sm font-semibold no-underline" id="tab-btn-lookup">
            <span class="material-symbols-outlined text-[18px]">menu_book</span>
            <span>Tra cứu từ điển (辭典檢索)</span>
          </a>
          <a href="#nhap" class="flex items-center gap-space-sm px-space-lg py-2 rounded-lg font-label-md text-label-md transition-all duration-200 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high no-underline" id="tab-btn-import">
            <span class="material-symbols-outlined text-[18px]">post_add</span>
            <span>Nhập từ hàng loạt (批量錄入)</span>
            <span class="px-1.5 py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-[10px]">Mới</span>
          </a>
        </div>
        <div class="flex items-center gap-space-sm px-space-md text-on-surface-variant font-label-sm text-label-sm">
          <span class="material-symbols-outlined text-[16px]">info</span>
          <span>Hệ thống ký âm: <strong>Phiên âm Pinyin chuẩn &amp; Hán Việt</strong></span>
        </div>
      </div>

      <!-- ================= MODE 1: TRA CỨU TỪ ĐIỂN CHUYÊN SÂU (Exact Stitch) ================= -->
      <div class="flex flex-col gap-space-xl" id="section-lookup">
        <!-- Unified Universal Search Bar -->
        <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
          <div class="flex flex-col lg:flex-row items-stretch gap-space-sm">
            <!-- Text input with integrated helper controls -->
            <div class="relative flex-1 flex items-center bg-paper-base border border-border-subtle rounded-xl px-space-md">
              <span class="material-symbols-outlined text-outline text-[22px] mr-2">search</span>
              <input class="w-full bg-transparent py-3 text-on-surface font-body-lg text-body-lg focus:outline-none placeholder:text-outline/70" id="dq" placeholder="Nhập Hán tự, Pinyin, hoặc nghĩa tiếng Việt (vd: 璀璨, 蜘蛛, xuesheng, học sinh)..." type="text" value="${esc(arg || "")}" autocomplete="off">
              <button type="button" class="text-outline hover:text-on-surface p-1 rounded-full hover:bg-surface-container" id="btn-clear-dq">
                <span class="material-symbols-outlined text-[18px]">cancel</span>
              </button>
            </div>
            <!-- Auxiliary Tools Bar -->
            <div class="flex items-center gap-space-xs overflow-x-auto pb-1 lg:pb-0">
              <button type="button" class="flex items-center gap-1.5 px-space-md py-2.5 rounded-xl bg-paper-base border border-border-subtle/60 hover:bg-surface-container text-on-surface-variant font-label-md text-label-md transition-colors whitespace-nowrap" onclick="$('#wordHw0')?.scrollIntoView({behavior:'smooth'})">
                <span class="material-symbols-outlined text-[18px] text-tertiary">draw</span>
                <span>Viết tay nét</span>
              </button>
              <button type="button" class="flex items-center gap-1.5 px-space-md py-2.5 rounded-xl bg-paper-base border border-border-subtle/60 hover:bg-surface-container text-on-surface-variant font-label-md text-label-md transition-colors whitespace-nowrap" onclick="$('#dq').value='玉'; $('#dq').dispatchEvent(new Event('input'))">
                <span class="material-symbols-outlined text-[18px] text-secondary">menu</span>
                <span>Bộ thủ Khang Hy (214)</span>
              </button>
              <button type="button" class="px-space-xl py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold transition-all duration-200 shadow-sm flex items-center gap-1.5" id="btn-run-dq">
                <span>Tìm kiếm</span>
              </button>
            </div>
          </div>
          <!-- Radical & History Shortcuts -->
          <div class="flex flex-wrap items-center gap-space-sm pt-space-xs font-label-sm text-label-sm text-on-surface-variant">
            <span class="text-outline flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">history</span>
              Đã tra gần đây:
            </span>
            <button type="button" class="px-2 py-0.5 rounded-md bg-paper-base hover:bg-surface-container-high text-on-surface transition-colors" data-quick-q="璀璨">璀璨 <span class="text-outline text-[10px]">cuǐcàn</span></button>
            <button type="button" class="px-2 py-0.5 rounded-md bg-paper-base hover:bg-surface-container-high text-on-surface transition-colors" data-quick-q="蜘蛛">蜘蛛 <span class="text-outline text-[10px]">zhīzhū</span></button>
            <button type="button" class="px-2 py-0.5 rounded-md bg-paper-base hover:bg-surface-container-high text-on-surface transition-colors" data-quick-q="謙虛">謙虛 <span class="text-outline text-[10px]">qiānxū</span></button>
            <button type="button" class="px-2 py-0.5 rounded-md bg-paper-base hover:bg-surface-container-high text-on-surface transition-colors" data-quick-q="學生">學生 <span class="text-outline text-[10px]">xuéshēng</span></button>
            <span class="mx-1 text-surface-container-high">|</span>
            <span class="text-outline">Gợi ý bộ:</span>
            <button type="button" class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-display" data-quick-q="玉">玉 (Ngọc - 5 nét)</button>
            <button type="button" class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-display" data-quick-q="言">言 (Ngôn - 7 nét)</button>
            <button type="button" class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-display" data-quick-q="心">心 (Tâm - 4 nét)</button>
          </div>
        </div>

        <!-- Live Search Results Grid (When user types a query) -->
        <div class="flex flex-col gap-space-sm" id="search-results-wrap">
          <div class="text-xs font-semibold text-outline" id="dcount"></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-sm" id="dres"></div>
        </div>

        <!-- Master 7+5 Dictionary Showcase Card (Exact Stitch) -->
        <div id="stitch-dict-showcase">${buildStitchWordShowcaseHTML(initialWord)}</div>
      </div>
    </div>
  `);

  const inp = $("#dq");
  const clearBtn = $("#btn-clear-dq");
  const runBtn = $("#btn-run-dq");

  const updateAll = (qVal) => {
    const topMatch = searchDict(qVal);
    const showcaseWord = topMatch || (isHan(clean(qVal)) ? clean(qVal) : initialWord);
    renderStitchWordShowcase(showcaseWord, "#stitch-dict-showcase", (newW) => renderStitchWordShowcase(newW, "#stitch-dict-showcase"));
  };

  let tmr = null;
  inp.oninput = () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => updateAll(inp.value), 120);
  };
  if (clearBtn) {
    clearBtn.onclick = () => {
      inp.value = "";
      inp.focus();
      updateAll("");
    };
  }
  if (runBtn) {
    runBtn.onclick = () => updateAll(inp.value);
  }
  document.querySelectorAll("[data-quick-q]").forEach((btn) => {
    btn.onclick = () => {
      inp.value = btn.dataset.quickQ;
      updateAll(inp.value);
    };
  });

  updateAll(inp.value);
};

function searchDict(raw) {
  const out = $("#dres"), cnt = $("#dcount");
  if (!out) return null;
  const q = clean(raw);
  if (!q) {
    cnt.textContent = "";
    out.innerHTML = "";
    return null;
  }
  const res = [];
  const seen = new Set();
  const push = (w, n, pri) => { if (seen.has(w)) return; seen.add(w); res.push({ w, n, pri }); };

  if (isHan(q)) {
    for (const [w, n] of S.noteByWord) {
      if (w.includes(q)) push(w, n, w === q ? 0 : w.startsWith(q) ? 1 : 2);
    }
    if (S.ced) {
      for (const w of S.ced.keys()) {
        if (res.length > 400) break;
        if (w.includes(q)) push(w, null, w === q ? 0 : w.startsWith(q) ? 3 : 4);
      }
    }
  } else {
    const f = fold(q);
    for (const n of S.notes) {
      const it = itemOf(n);
      const p = fold(it.py);
      if (p === f) push(it.w, n, 0);
      else if (p.startsWith(f)) push(it.w, n, 1);
      else if (f.length >= 2 && (fold(it.vn).includes(f) || fold(it.en).includes(f))) push(it.w, n, 2);
    }
    if (S.ced && f.length >= 2) {
      for (const [w, es] of S.ced) {
        if (res.length > 400) break;
        for (const [py, defs] of es) {
          const p = fold(py);
          if (p === f) { push(w, null, 3); break; }
          if (f.length >= 3 && fold(defs).includes(f)) { push(w, null, 5); break; }
        }
      }
    }
  }

  res.sort((a, b) => a.pri - b.pri || a.w.length - b.w.length);
  cnt.textContent = `${fmt(Math.min(res.length, 80))}${res.length > 80 ? "+" : ""} kết quả phù hợp (Bấm vào thẻ từ để xem chi tiết bên dưới)`;

  out.innerHTML = res.slice(0, 80).map(({ w, n }) => {
    const e = cedFirst(w);
    const py = n ? itemOf(n).py : (e ? e[0][0] : "");
    const m = n ? meaningOf(n) : enOf(w);
    const lvl = n ? noteLevel(n) : 0;
    return `
      <a class="p-3 rounded-xl bg-paper-card border border-border-subtle shadow-xs hover:border-primary/40 hover:shadow-sm transition-all flex flex-col justify-between gap-1.5 no-underline" href="#tu/${encodeURIComponent(w)}">
        <div class="flex items-start justify-between">
          <div>
            <span class="font-headline-md text-xl text-on-surface font-serif font-bold">${esc(w)}</span>
            <span class="font-code text-xs text-tertiary ml-1.5">${esc(py)}</span>
          </div>
          <div class="flex items-center gap-1">
            ${n ? `<span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span>` : `<span class="pill">ngoài TOCFL</span>`}
          </div>
        </div>
        <div class="text-xs text-on-surface-variant line-clamp-1">${esc(m)}</div>
        <div class="pt-1 border-t border-border-subtle/50 flex items-center justify-between text-[11px] text-outline">
          <span>${n ? esc(bandsOf(n).join(" · ") || "Cá nhân") : "CC-CEDICT"}</span>
          <span class="text-primary font-semibold">Chi tiết →</span>
        </div>
      </a>
    `;
  }).join("") || `<div class="col-span-full p-6 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy từ khớp. Thử gõ chữ Hán Phồn thể hoặc pinyin không dấu.</div>`;

  return res.length ? res[0].w : null;
}

// ---------------- CHI TIẾT TỪ VỰNG (#tu/:word) ----------------
VIEWS["tu"] = (w) => {
  setView(`
    <div class="max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
      <div class="flex items-center justify-between">
        <a href="#tu-dien" class="text-primary hover:underline text-sm font-semibold flex items-center gap-1 no-underline">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Quay lại Tra cứu &amp; Nhập từ</span>
        </a>
        <a href="#nhap" class="text-secondary hover:underline text-xs font-semibold no-underline">+ Nhập từ hàng loạt →</a>
      </div>
      <div id="tu-detail-host">${buildStitchWordShowcaseHTML(w)}</div>
    </div>
  `);
  renderStitchWordShowcase(w, "#tu-detail-host", (newW) => VIEWS["tu"](newW));
};

// =========================================================================
// 6. CHÉP CHÍNH TẢ & LUYỆN THÍNH LỰC (DICTATION APP - STITCH DESIGN)
// 7. THI THỬ TOCFL CAT-B (OFFICIAL MOCK EXAM & REVIEW - STITCH DESIGN)
// =========================================================================

// Embedded official datasets (fast offline-ready fallback)
const BUILTIN_DICTATION_TOPICS = [
  {
    "id": "dia_copier_repair",
    "category": "dialogue",
    "categoryName": "Đoạn hội thoại thực tế",
    "title": "辦公室影印機故障 Office Copier Breakdown",
    "band": "TOCFL B1 · Đời sống công sở",
    "duration": "Thời lượng ~3 phút",
    "desc": "Tình huống máy in và máy photo văn phòng gặp trục trặc trước giờ họp ban giám đốc, nhân viên phối hợp xử lý khẩn cấp.",
    "sentences": [
      {
        "speaker": "林經理",
        "zh": "早安，傑克。今天早上的業務報告準備得怎麼樣了？",
        "py": "Zǎo'ān, Jiékè. Jīntiān zǎoshang de yèwù bàogào zhǔnbèi de zěnmeyàng le?",
        "vn": "Chào buổi sáng Jack. Báo cáo kinh doanh sáng nay chuẩn bị thế nào rồi?"
      },
      {
        "speaker": "傑克",
        "zh": "資料都已經整理好了，但我剛才正打算影印的時候，影印機突然卡紙了。",
        "py": "Zīliào dōu yǐjīng zhěnglǐ hǎo le, dàn wǒ gāngcái zhèng dǎsuàn yǐngyìn de shíhou, yǐngyìnjī tūrán kǎzhǐ le.",
        "vn": "Tài liệu đều đã soạn xong rồi, nhưng lúc nãy khi em vừa định in thì máy photo đột nhiên kẹt giấy."
      },
      {
        "speaker": "林經理",
        "zh": "你打開側蓋檢查過了嗎？通常把卡住的紙輕輕拉出來就行了。",
        "py": "Nǐ dǎkāi cègài jiǎnchá guò le ma? Tōngcháng bǎ kǎzhù de zhǐ qīngqīng lā chūlái jiù xíng le.",
        "vn": "Cậu đã mở nắp hông ra kiểm tra chưa? Thường thì kéo nhẹ tờ giấy bị kẹt ra là được."
      },
      {
        "speaker": "傑克",
        "zh": "我已經試過了，但螢幕上還是一直顯示錯誤代碼『E-04』。",
        "py": "Wǒ yǐjīng shì guò le, dàn yíngmù shàng háishì yīzhí xiǎnshì cuòwù dàimǎ 『E-04』.",
        "vn": "Em đã thử rồi, nhưng trên màn hình vẫn liên tục báo mã lỗi 'E-04'."
      },
      {
        "speaker": "林經理",
        "zh": "那是碳粉匣感應器異常，可能是剛才換碳粉時沒有裝好。",
        "py": "Nà shì tànfěnxiá gǎnyìngqì yìcháng, kěnéng shì gāngcái huàn tànfěn shí méiyǒu zhuāng hǎo.",
        "vn": "Đó là cảm biến hộp mực gặp bất thường, có thể lúc nãy thay mực chưa khớp vào đúng vị trí."
      },
      {
        "speaker": "傑克",
        "zh": "難怪！剛才是小陳幫忙換的新碳粉，我馬上請他過來看看。",
        "py": "Nánguài! Gāngcái shì Xiǎochén bāngmáng huàn de xīn tànfěn, wǒ mǎshàng qǐng tā guòlái kànkàn.",
        "vn": "Thảo nào! Vừa nãy là Tiểu Trần thay hộp mực mới, em sang nhờ cậu ấy kiểm tra lại ngay."
      },
      {
        "speaker": "林經理",
        "zh": "十點半的會議有八位主管參加，每份報告需要十二頁，雙面彩色列印。",
        "py": "Shí diǎn bàn de huìyì yǒu bā wèi zhǔguǎn cānjiā, měi fèn bàogào xūyào shí'èr yè, shuāngmiàn cǎisè lièyìn.",
        "vn": "Cuộc họp mười rưỡi có tám vị trưởng phòng tham gia, mỗi bản cần 12 trang, in màu hai mặt."
      },
      {
        "speaker": "傑克",
        "zh": "如果修不好，我先借用三樓行銷部的彩色雷射印表機，絕對不會耽誤開會。",
        "py": "Rúguǒ xiū bù hǎo, wǒ xiān jièyòng sān lóu xíngxiāobù de cǎisè léishè yìnbiǎojī, juéduì bù huì dānwù kāihuì.",
        "vn": "Nếu không sửa kịp, em sẽ mượn máy in laser màu phòng marketing tầng 3, đảm bảo không trễ giờ họp."
      },
      {
        "speaker": "林經理",
        "zh": "很好，做事有備案非常重要。另外，記得幫每份報告裝訂整齊。",
        "py": "Hěn hǎo, zuòshì yǒu bèi'àn fēicháng zhòngyào. Lìngwài, jìde bāng měi fèn bàogào zhuāngdìng zhěngqí.",
        "vn": "Rất tốt, làm việc có phương án dự phòng là vô cùng quan trọng. Nhớ bấm ghim đóng tập gọn gàng từng bản nhé."
      },
      {
        "speaker": "傑克",
        "zh": "好的，經理！我等一下還會順便打電話給設備維護廠商來保養機器。",
        "py": "Hǎo de, jīnglǐ! Wǒ děng yíxià hái huì shùnbiàn dǎ diànhuà gěi shèbèi wéihù chǎngshāng lái bǎoyǎng jīqì.",
        "vn": "Vâng thưa giám đốc! Lát nữa em sẽ tiện gọi điện luôn cho hãng bảo trì thiết bị đến bảo dưỡng máy."
      }
    ],
    "vocab": [
      {
        "w": "影印機",
        "py": "yǐngyìnjī",
        "vn": "máy photocopy",
        "pos": "N",
        "band": "B1"
      },
      {
        "w": "故障",
        "py": "gùzhàng",
        "vn": "trục trặc, hỏng hóc",
        "pos": "V/N",
        "band": "B1"
      },
      {
        "w": "碳粉匣",
        "py": "tànfěnxiá",
        "vn": "hộp mực in",
        "pos": "N",
        "band": "B2"
      },
      {
        "w": "備案",
        "py": "bèi'àn",
        "vn": "phương án dự phòng",
        "pos": "N",
        "band": "B2"
      },
      {
        "w": "耽誤",
        "py": "dānwù",
        "vn": "làm lỡ, làm trễ nải",
        "pos": "V",
        "band": "B1"
      }
    ]
  },
  {
    "id": "dia_rent_taipei",
    "category": "dialogue",
    "categoryName": "Đoạn hội thoại thực tế",
    "title": "在台北租獨立套房 Renting Studio in Taipei",
    "band": "TOCFL B1 · Thuê nhà & Đời sống",
    "duration": "Thời lượng ~2.5 phút",
    "desc": "Cuộc gọi giữa bạn sinh viên quốc tế và chủ nhà tại Đài Bắc hỏi về tiền cọc, máy giặt riêng và tiền điện nước theo công tơ riêng.",
    "sentences": [
      {
        "speaker": "房客",
        "zh": "您好，我在租屋網看到大安區那間採光良好的獨立套房，請問目前還能看房嗎？",
        "py": "Nín hǎo, wǒ zài zūwūwǎng kàndào Dà'ān qū nà jiān cǎiguāng liánghǎo de dúlì tàofáng, qǐngwèn mùqián hái néng kànfáng ma?",
        "vn": "Chào bác ạ, cháu thấy trên mạng căn phòng trọ khép kín đón nắng tốt ở quận Đại An, không biết hiện tại còn xem phòng được không ạ?"
      },
      {
        "speaker": "房東",
        "zh": "可以啊，這間套房剛剛粉刷完畢，有獨立陽台和自己的洗衣機。",
        "py": "Kěyǐ a, zhè jiān tàofáng gānggāng fěnshuā wánbì, yǒu dúlì yángtái hé zìjǐ de xǐyījī.",
        "vn": "Được chứ, phòng này vừa mới sơn sửa xong, có ban công riêng và máy giặt riêng nữa."
      },
      {
        "speaker": "房客",
        "zh": "請問每個月的房租多少？水電費和網路管理費是怎麼計算的呢？",
        "py": "Qǐngwèn měi gè yuè de fángzū duōshǎo? Shuǐdiànfèi hé wǎnglù guǎnlǐfèi shì zěnme jìsuàn de ne?",
        "vn": "Dạ cho cháu hỏi tiền thuê mỗi tháng bao nhiêu ạ? Tiền điện nước và phí quản lý internet tính thế nào ạ?"
      },
      {
        "speaker": "房東",
        "zh": "房租一個月一萬四千元，水費與光纖網路免費，電費獨立電表一度五點五元。",
        "py": "Fángzū yí gè yuè yí wàn sì qiān yuán, shuǐfèi yǔ guāngxiān wǎnglù miǎnfèi, diànfèi dúlì diànbiǎo yí dù wǔ diǎn wǔ yuán.",
        "vn": "Tiền nhà mỗi tháng 14,000 đài tệ, miễn phí tiền nước và internet cáp quang, tiền điện công tơ riêng 5.5 tệ một số."
      },
      {
        "speaker": "房客",
        "zh": "押金是兩個月對嗎？如果雙方滿意，租約最短需要簽多久？",
        "py": "Yājīn shì liǎng gè yuè duì ma? Rúguǒ shuāngfāng mǎnyì, zūyuē zuì duǎn xūyào qiān duōjiǔ?",
        "vn": "Tiền cọc là 2 tháng đúng không ạ? Nếu hai bên ưng ý thì hợp đồng thuê tối thiểu là bao lâu ạ?"
      },
      {
        "speaker": "房東",
        "zh": "對，押金兩個月，租約一年起跳。如果你明天下午有空，兩點可以過來現場看屋。",
        "py": "Duì, yājīn liǎng gè yuè, zūyuē yì nián qǐtiào. Rúguǒ nǐ míngtiān xiàwǔ yǒukòng, liǎng diǎn kěyǐ guòlái xiànchǎng kànwū.",
        "vn": "Đúng rồi, cọc 2 tháng, hợp đồng từ 1 năm trở lên. Nếu chiều mai cháu rảnh thì 2 giờ qua xem phòng thực tế nhé."
      }
    ],
    "vocab": [
      {
        "w": "套房",
        "py": "tàofáng",
        "vn": "phòng khép kín có toilet riêng",
        "pos": "N",
        "band": "A2"
      },
      {
        "w": "押金",
        "py": "yājīn",
        "vn": "tiền đặt cọc",
        "pos": "N",
        "band": "B1"
      },
      {
        "w": "採光",
        "py": "cǎiguāng",
        "vn": "đón ánh sáng tự nhiên",
        "pos": "N",
        "band": "B2"
      },
      {
        "w": "粉刷",
        "py": "fěnshuā",
        "vn": "sơn sửa tường nhà",
        "pos": "V",
        "band": "B1"
      }
    ]
  },
  {
    "id": "story_garbage_truck",
    "category": "story",
    "categoryName": "Câu chuyện ngắn",
    "title": "追垃圾車與台灣資源回收 Chasing Garbage Truck in Taiwan",
    "band": "TOCFL B1 · Văn hóa sinh hoạt",
    "duration": "Thời lượng ~2.5 phút",
    "desc": "Trải nghiệm đặc trưng và thú vị của mọi người dân sống tại Đài Loan: lắng nghe tiếng nhạc Beethoven đón xe rác và phân loại tài nguyên.",
    "sentences": [
      {
        "speaker": "旁白",
        "zh": "在台灣生活，只要每到傍晚聽到熟悉的《給愛麗絲》音樂，大家就知道垃圾車來了。",
        "py": "Zài Táiwān shēnghuó, zhǐyào měi dào bàngwǎn tīngdào shúxī de 《Gěi Àilìsī》 yīnyuè, dàjiā jiù zhīdào lèsèchē lái le.",
        "vn": "Sống ở Đài Loan, cứ mỗi buổi chiều tà khi nghe thấy giai điệu quen thuộc 'Gửi Elise', mọi người đều biết xe rác đã tới."
      },
      {
        "speaker": "旁白",
        "zh": "男女老少提著藍色專用垃圾袋走出家門，在巷口排隊等候黃色垃圾車停妥。",
        "py": "Nánnǚ lǎoshào tízhe lánsè zhuānyòng lèsèdài zǒuchū jiāmén, zài xiàngkǒu páiduì děnghòu huángsè lèsèchē tíngtuǒ.",
        "vn": "Già trẻ gái trai xách theo túi rác màu xanh chuyên dụng bước ra khỏi nhà, xếp hàng ở đầu ngõ đợi xe rác màu vàng dừng hẳn."
      },
      {
        "speaker": "旁白",
        "zh": "緊跟在垃圾車後面的，是專門負責資源回收與廚餘回收的卡車。",
        "py": "Jǐngēn zài lèsèchē hòumiàn de, shì zhuānmén fùzé zīyuán huíshōu yǔ chúyú huíshōu de kǎchē.",
        "vn": "Bám sát ngay sau xe rác là chiếc xe tải chuyên thu gom đồ tái chế và thức ăn thừa."
      },
      {
        "speaker": "旁白",
        "zh": "民眾必須把紙箱壓平、寶特瓶清洗壓扁，並且將生熟廚餘分開倒入桶中。",
        "py": "Mínzhòng bìxū bǎ zhǐxiāng yāpíng, bǎotèpíng qīngxǐ yābiǎn, bìngqiě jiāng shēngshú chúyú fēnkāi dàorù tǒng zhōng.",
        "vn": "Người dân phải đè phẳng thùng carton, súc rửa và bóp dẹp chai nhựa, đồng thời phân chia rác thực phẩm sống chín đổ vào thùng tương ứng."
      },
      {
        "speaker": "旁白",
        "zh": "這套行之有年的垃圾不落地政策，讓台灣街頭維持了高度整潔，也凝聚了社區鄰里情感。",
        "py": "Zhè tào xíngzhīyǒunián de lèsè bù luòdì zhèngcè, ràng Táiwān jiētóu wéichí le gāodù zhěngjié, yě níngjù le shèqū línlǐ qínggǎn.",
        "vn": "Chính sách 'rác không chạm đất' áp dụng nhiều năm nay đã giúp đường phố Đài Loan duy trì độ sạch sẽ đáng nể, đồng thời gắn kết tình làng nghĩa xóm."
      }
    ],
    "vocab": [
      {
        "w": "廚餘",
        "py": "chúyú",
        "vn": "thức ăn thừa, rác nhà bếp",
        "pos": "N",
        "band": "B1"
      },
      {
        "w": "寶特瓶",
        "py": "bǎotèpíng",
        "vn": "chai nhựa PET",
        "pos": "N",
        "band": "A2"
      },
      {
        "w": "專用垃圾袋",
        "py": "zhuānyòng lèsèdài",
        "vn": "túi rác chuyên dụng có tính phí",
        "pos": "N",
        "band": "B1"
      },
      {
        "w": "整潔",
        "py": "zhěngjié",
        "vn": "ngăn nắp, sạch sẽ",
        "pos": "Vs",
        "band": "B1"
      }
    ]
  },
  {
    "id": "tocfl_interview_prep",
    "category": "tocfl",
    "categoryName": "TOCFL Listening",
    "title": "面試與薪資福利討論 Job Interview Dialogue",
    "band": "TOCFL B2 · Luyện thính lực chính thức",
    "duration": "Thời lượng ~3 phút",
    "desc": "Bài đối thoại chính thức kiểm tra khả năng nắm bắt ý ngầm của ứng viên và nhà tuyển dụng về chế độ bảo hiểm lao động và thời gian thử việc.",
    "sentences": [
      {
        "speaker": "主考官",
        "zh": "王先生，我看過你的履歷，你在上一家科技公司的專案管理經驗非常豐富。",
        "py": "Wáng xiānsheng, wǒ kànguò nǐ de lǚlì, nǐ zài shàng yì jiā kējì gōngsī de zhuān'àn guǎnlǐ jīngyàn fēicháng fēngfù.",
        "vn": "Anh Vương, tôi đã xem qua sơ yếu lý lịch của anh, kinh nghiệm quản lý dự án ở công ty công nghệ trước đây của anh rất phong phú."
      },
      {
        "speaker": "王先生",
        "zh": "謝謝總監。我過去三年帶領團隊完成了五個大型軟體開發案，都如期上線。",
        "py": "Xièxie zǒngjiān. Wǒ guòqù sān nián dàilǐng tuánduì wánchéng le wǔ gè dàxíng ruǎntǐ kāifā'àn, dōu rúqī shàngxiàn.",
        "vn": "Cảm ơn giám đốc. Ba năm qua tôi đã dẫn dắt đội ngũ hoàn thành 5 dự án phần mềm lớn, tất cả đều ra mắt đúng hạn."
      },
      {
        "speaker": "主考官",
        "zh": "我們公司非常重視團隊協作與跨部門溝通，想請問你期望的待遇是多少？",
        "py": "Wǒmen gōngsī fēicháng zhòngshì tuánduì xiézuò yǔ kuà bùmén gōutōng, xiǎng qǐngwèn nǐ qīwàng de dàiyù shì duōshǎo?",
        "vn": "Công ty chúng tôi rất chú trọng tinh thần làm việc nhóm và giao tiếp liên phòng ban, xin hỏi mức đãi ngộ kỳ vọng của anh là bao nhiêu?"
      },
      {
        "speaker": "王先生",
        "zh": "依據我目前的專業技能與市場行情，我希望能爭取月薪六萬五千元以上的待遇。",
        "py": "Yījù wǒ mùqián de zhuānyè jìnéng yǔ shìchǎng hángqíng, wǒ xīwàng néng zhēngqǔ yuèxīn liù wàn wǔ qiān yuán yǐshàng de dàiyù.",
        "vn": "Căn cứ vào kỹ năng chuyên môn hiện tại và mặt bằng thị trường, tôi mong muốn mức lương từ 65.000 đài tệ mỗi tháng trở lên."
      },
      {
        "speaker": "主考官",
        "zh": "我們提供完整的勞健保、年終獎金與員工培訓補助，試用期三個月考核通過後還會再調薪。",
        "py": "Wǒmen tígōng wánzhěng de láojiànbǎo, niánzhōng jiǎngjīn yǔ yuángōng péixùn bǔzhù, shìyòngqī sān gè yuè kǎohé tōngguò hòu hái huì zài tiáoxīn.",
        "vn": "Chúng tôi cung cấp đầy đủ bảo hiểm lao động, bảo hiểm y tế, thưởng cuối năm và trợ cấp đào tạo nhân viên, sau khi thử việc 3 tháng đánh giá đạt sẽ được tăng lương tiếp."
      }
    ],
    "vocab": [
      {
        "w": "履歷",
        "py": "lǚlì",
        "vn": "sơ yếu lý lịch, CV",
        "pos": "N",
        "band": "B1"
      },
      {
        "w": "待遇",
        "py": "dàiyù",
        "vn": "mức lương và chế độ đãi ngộ",
        "pos": "N",
        "band": "B1"
      },
      {
        "w": "考核",
        "py": "kǎohé",
        "vn": "kiểm tra, đánh giá định kỳ",
        "pos": "V",
        "band": "B2"
      },
      {
        "w": "調薪",
        "py": "tiáoxīn",
        "vn": "điều chỉnh tăng lương",
        "pos": "V-sep",
        "band": "B2"
      }
    ]
  },
  {
    "id": "news_pts_smart_transport",
    "category": "news",
    "categoryName": "Tin tức PTS Đài Loan",
    "title": "公視新聞：都會區智慧綠能交通新政策 PTS News: Green Smart Transit",
    "band": "TOCFL B2 · Thời sự truyền hình",
    "duration": "Thời lượng ~3 phút",
    "desc": "Bản tin thời sự truyền hình PTS Đài Loan về dự án mở rộng mạng lưới xe bus điện và trợ giá vé tháng giao thông liên vùng TPASS.",
    "sentences": [
      {
        "speaker": "主播",
        "zh": "各位觀眾晚安，歡迎收看公視晚間新聞。交通部今天宣布將擴大推動都會區公共運輸定期票。",
        "py": "Gèwèi guānzhòng wǎn'ān, huānyíng shōukàn Gōngshì Wǎnjiān Xīnwén. Jiāotōngbù jīntiān xuānbù jiāng kuòdà tuīdòng dūhuìqū gōnggòng yùnshū dìngqípiào.",
        "vn": "Kính chào quý vị khán giả, hoan nghênh đón xem bản tin thời sự tối của PTS. Bộ Giao thông hôm nay tuyên bố sẽ mở rộng xúc tiến vé định kỳ vận tải công cộng đô thị."
      },
      {
        "speaker": "記者",
        "zh": "為了降低碳排放並紓解交通壅塞，政府整合了捷運、台鐵、市區公車與公共自行車。",
        "py": "Wèile jiàngdī tànpáifàng bìng shūjiě jiāotōng yōngsè, zhèngfǔ zhěnghé le jiéyùn, Táitiě, shìqū gōngchē yǔ gōnggòng zìxíngchē.",
        "vn": "Nhằm giảm lượng phát thải carbon và giải tỏa ùn tắc giao thông, chính phủ đã tích hợp tàu điện MRT, tàu hỏa Đài Thiết, xe buýt đô thị và xe đạp công cộng YouBike."
      },
      {
        "speaker": "記者",
        "zh": "通勤族只要花費固定月費，即可在三十天內不限次數搭乘跨縣市交通工具。",
        "py": "Tōngqínzú zhǐyào huāfèi gùdìng yuèfèi, jíkě zài sānshí tiān nèi bú xiàn cìshù dāchéng kuà xiànshì jiāotōng gōngjù.",
        "vn": "Người đi làm chỉ cần chi trả khoản phí cố định hàng tháng là có thể đi lại không giới hạn số chuyến liên quận huyện trong vòng 30 ngày."
      },
      {
        "speaker": "民眾",
        "zh": "有了這張定期票以後，我每個月省下將近一千五百元的油錢，上班路上也比較輕鬆省時。",
        "py": "Yǒu le zhè zhāng dìngqípiào yǐhòu, wǒ měi gè yuè shěngxià jiāngjìn yì qiān wǔ bǎi yuán de yóuqián, shàngbān lùshàng yě bǐjiào qīngsōng shěngshí.",
        "vn": "Có chiếc vé tháng này, mỗi tháng tôi tiết kiệm được gần 1.500 đài tệ tiền xăng, trên đường đi làm cũng thoải mái và tiết kiệm thời gian hơn."
      },
      {
        "speaker": "主播",
        "zh": "專家指出，綠能公共運輸的使用率若持續上升，預計在五年內可減少兩成以上的空氣污染。",
        "py": "Zhuānjiā zhǐchū, lǜnéng gōnggòng yùnshū de shǐyònglǜ ruò chíxù shàngshēng, yùjì zài wǔ nián nèi kě jiǎnshǎo liǎng chéng yǐshàng de kōngqì wūrǎn.",
        "vn": "Các chuyên gia chỉ ra rằng, nếu tỷ lệ sử dụng giao thông xanh công cộng tiếp tục tăng trưởng, dự kiến trong 5 năm tới có thể cắt giảm hơn 20% ô nhiễm không khí."
      }
    ],
    "vocab": [
      {
        "w": "碳排放",
        "py": "tànpáifàng",
        "vn": "lượng khí thải carbon",
        "pos": "N",
        "band": "B2"
      },
      {
        "w": "紓解",
        "py": "shūjiě",
        "vn": "giải tỏa, xoa dịu áp lực",
        "pos": "V",
        "band": "B2"
      },
      {
        "w": "通勤族",
        "py": "tōngqínzú",
        "vn": "người đi làm / đi học hàng ngày bằng phương tiện",
        "pos": "N",
        "band": "B1"
      },
      {
        "w": "定期票",
        "py": "dìngqípiào",
        "vn": "vé định kỳ / vé tháng",
        "pos": "N",
        "band": "B1"
      }
    ]
  }
];
const BUILTIN_MOCK_TESTS = [
  {
    "id": "mock_b1",
    "title": "TOCFL Band B - Đề thi Chuẩn 1 (Official Mock 1)",
    "band": "Band B (高階·流利)",
    "badge": "Chuẩn SC-TOP CAT",
    "duration": 60,
    "totalQ": 50,
    "desc": "Đề thi mẫu chuẩn chính thức SC-TOP bộ 1 gồm 25 câu Nghe hiểu (giọng nam/nữ xen kẽ) và 25 câu Đọc hiểu.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我想坐早上九點的火車到高雄去，中午到得了嗎？ 應該是到不了，到高雄大概要五個小時。 早上九點的火車什麼時候到高雄？",
        "dialogue": "男：我想坐早上九點的火車到高雄去，中午到得了嗎？\n女：應該是到不了，到高雄大概要五個小時。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我想坐早上九點的火車到高雄去，中午到得了嗎？"
          },
          {
            "speaker": "female",
            "text": "應該是到不了，到高雄大概要五個小時。"
          },
          {
            "speaker": "male",
            "text": "早上九點的火車什麼時候到高雄？"
          }
        ],
        "q": "早上九點的火車什麼時候到高雄？",
        "options": [
          "上午",
          "中午",
          "下午",
          "晚上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 下午. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小李最近好像在找房子，怎麼了？他不住了嗎？ 嗯，小李的房東要把房子賣了，他下個月就得搬家。 為什麼小李要搬家？",
        "dialogue": "男：小李最近好像在找房子，怎麼了？他不住了嗎？\n女：嗯，小李的房東要把房子賣了，他下個月就得搬家。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小李最近好像在找房子，怎麼了？他不住了嗎？"
          },
          {
            "speaker": "female",
            "text": "嗯，小李的房東要把房子賣了，他下個月就得搬家。"
          },
          {
            "speaker": "male",
            "text": "為什麼小李要搬家？"
          }
        ],
        "q": "為什麼小李要搬家？",
        "options": [
          "他買了新房子",
          "他把房子賣了",
          "他找到更好的房子",
          "他的房東要賣房子"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他的房東要賣房子. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳去停車，為什麼去了這麼久？ 這附近都找不到能停車的地方，所以我找了比較遠的地方停車。 這位小姐的意思是什麼？",
        "dialogue": "男：妳去停車，為什麼去了這麼久？\n女：這附近都找不到能停車的地方，所以我找了比較遠的地方停車。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳去停車，為什麼去了這麼久？"
          },
          {
            "speaker": "female",
            "text": "這附近都找不到能停車的地方，所以我找了比較遠的地方停車。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她很快就找到停車的位子",
          "她花了不少時間找地方停車",
          "她把車子停在比較近的地方",
          "她停車以後，找不到那位先生"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她花了不少時間找地方停車. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳怎麼在家？不和朋友到外面走走嗎？ 昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！ 這位小姐為什麼在家？",
        "dialogue": "男：妳怎麼在家？不和朋友到外面走走嗎？\n女：昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳怎麼在家？不和朋友到外面走走嗎？"
          },
          {
            "speaker": "female",
            "text": "昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！"
          },
          {
            "speaker": "male",
            "text": "這位小姐為什麼在家？"
          }
        ],
        "q": "這位小姐為什麼在家？",
        "options": [
          "她覺得有點累",
          "她身體不舒服",
          "她剛剛才從外面回來",
          "她還沒想好去哪兒玩"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她覺得有點累. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳這麼喜歡出國旅遊，那妳多久旅遊一次？ 差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。 這位小姐說了什麼？",
        "dialogue": "男：妳這麼喜歡出國旅遊，那妳多久旅遊一次？\n女：差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳這麼喜歡出國旅遊，那妳多久旅遊一次？"
          },
          {
            "speaker": "female",
            "text": "差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。"
          },
          {
            "speaker": "male",
            "text": "這位小姐說了什麼？"
          }
        ],
        "q": "這位小姐說了什麼？",
        "options": [
          "她一年出國旅遊兩次",
          "她今年不打算出國玩",
          "她每次去不一樣的國家玩",
          "她今年去韓國，明年想去日本"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她每次去不一樣的國家玩. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "老師要我們寫的作業，妳寫得怎麼樣？ 我想了好幾天，還是寫不出來。 這位小姐的意思是什麼？",
        "dialogue": "男：老師要我們寫的作業，妳寫得怎麼樣？\n女：我想了好幾天，還是寫不出來。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "老師要我們寫的作業，妳寫得怎麼樣？"
          },
          {
            "speaker": "female",
            "text": "我想了好幾天，還是寫不出來。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她不想寫作業",
          "她想不出來要寫什麼",
          "她不知道有什麼作業",
          "她記不得老師給的作業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她想不出來要寫什麼. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "一年以後，我們就買輛車子，到處去玩怎麼樣？ 別開玩笑了，哪來的錢呢？ 這位小姐的意思是什麼？",
        "dialogue": "男：一年以後，我們就買輛車子，到處去玩怎麼樣？\n女：別開玩笑了，哪來的錢呢？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "一年以後，我們就買輛車子，到處去玩怎麼樣？"
          },
          {
            "speaker": "female",
            "text": "別開玩笑了，哪來的錢呢？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "他們沒錢買車子",
          "她不喜歡出去玩",
          "這位先生常常開玩笑",
          "她不知道哪裡借得到錢"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他們沒錢買車子. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "嗯！這些菜聞起來好香，味道更是沒話說。 謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。 這位小姐說了什麼？",
        "dialogue": "男：嗯！這些菜聞起來好香，味道更是沒話說。\n女：謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "嗯！這些菜聞起來好香，味道更是沒話說。"
          },
          {
            "speaker": "female",
            "text": "謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。"
          },
          {
            "speaker": "male",
            "text": "這位小姐說了什麼？"
          }
        ],
        "q": "這位小姐說了什麼？",
        "options": [
          "她做菜做得不好",
          "她很喜歡自己做菜",
          "她喜歡吃別人煮的菜",
          "她只會吃東西，不會做菜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她很喜歡自己做菜. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "明天就要考試了！妳一點也不緊張嗎？ 有什麼好緊張的！我早就準備好了。 這位小姐的意思是什麼？",
        "dialogue": "男：明天就要考試了！妳一點也不緊張嗎？\n女：有什麼好緊張的！我早就準備好了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "明天就要考試了！妳一點也不緊張嗎？"
          },
          {
            "speaker": "female",
            "text": "有什麼好緊張的！我早就準備好了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她來不及把書讀完",
          "她對通過考試有信心",
          "她要這位先生別緊張",
          "她一聽見考試就開始緊張"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她對通過考試有信心. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？ 昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？ 這位小姐的意思是什麼？",
        "dialogue": "男：我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？\n女：昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？"
          },
          {
            "speaker": "female",
            "text": "昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她知道今天會下大雨",
          "沒有人知道今天會下雨",
          "她本來以為只是下小雨",
          "這位先生沒告訴她會下雨"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她本來以為只是下小雨. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "今天是我第一次上中文課，老師教了語法和二十五個漢字。 才上一次課，就學了二十多個漢字，不錯嘛！ 學漢字很有趣，不過，語法好難懂。 不要緊，有問題的話，就多問老師。 這位先生說了什麼？",
        "dialogue": "男：今天是我第一次上中文課，老師教了語法和二十五個漢字。\n女：才上一次課，就學了二十多個漢字，不錯嘛！\n男：學漢字很有趣，不過，語法好難懂。\n女：不要緊，有問題的話，就多問老師。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "今天是我第一次上中文課，老師教了語法和二十五個漢字。"
          },
          {
            "speaker": "female",
            "text": "才上一次課，就學了二十多個漢字，不錯嘛！"
          },
          {
            "speaker": "male",
            "text": "學漢字很有趣，不過，語法好難懂。"
          },
          {
            "speaker": "female",
            "text": "不要緊，有問題的話，就多問老師。"
          },
          {
            "speaker": "male",
            "text": "這位先生說了什麼？"
          }
        ],
        "q": "這位先生說了什麼？",
        "options": [
          "老師還沒教語法",
          "老師教了十個漢字",
          "他覺得語法很簡單",
          "他認為學漢字很有意思"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他認為學漢字很有意思. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳上個星期借的小說什麼時候可以還給我？ 不好意思！可不可以過兩天再還？ 妳看完了嗎？ 我看得差不多了。 這位小姐的意思是什麼？",
        "dialogue": "男：妳上個星期借的小說什麼時候可以還給我？\n女：不好意思！可不可以過兩天再還？\n男：妳看完了嗎？\n女：我看得差不多了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳上個星期借的小說什麼時候可以還給我？"
          },
          {
            "speaker": "female",
            "text": "不好意思！可不可以過兩天再還？"
          },
          {
            "speaker": "male",
            "text": "妳看完了嗎？"
          },
          {
            "speaker": "female",
            "text": "我看得差不多了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她快看完了",
          "她還沒開始看",
          "她要再看一個星期",
          "她已經全部看完了"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她快看完了. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "多吃一點兒吧！ 不，謝了！我吃得很飽。 妳吃不下了嗎？這個蛋糕是我特別為妳買的。 好吧！吃一點兒蛋糕也沒關係。 這位小姐的意思是什麼？",
        "dialogue": "男：多吃一點兒吧！\n女：不，謝了！我吃得很飽。\n男：妳吃不下了嗎？這個蛋糕是我特別為妳買的。\n女：好吧！吃一點兒蛋糕也沒關係。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "多吃一點兒吧！"
          },
          {
            "speaker": "female",
            "text": "不，謝了！我吃得很飽。"
          },
          {
            "speaker": "male",
            "text": "妳吃不下了嗎？這個蛋糕是我特別為妳買的。"
          },
          {
            "speaker": "female",
            "text": "好吧！吃一點兒蛋糕也沒關係。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她還有點兒餓",
          "蛋糕有點兒難吃",
          "她可以再吃一點兒東西",
          "她沒辦法吃任何東西了"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她可以再吃一點兒東西. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "生日快樂！這是送給妳的。 謝謝。你不必買禮物給我的。你太客氣了！ 希望妳會喜歡，打開來看看吧。 啊，我喜歡這支手錶。你怎麼知道我要的就是這個？ 這位小姐的意思是什麼？",
        "dialogue": "男：生日快樂！這是送給妳的。\n女：謝謝。你不必買禮物給我的。你太客氣了！\n男：希望妳會喜歡，打開來看看吧。\n女：啊，我喜歡這支手錶。你怎麼知道我要的就是這個？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "生日快樂！這是送給妳的。"
          },
          {
            "speaker": "female",
            "text": "謝謝。你不必買禮物給我的。你太客氣了！"
          },
          {
            "speaker": "male",
            "text": "希望妳會喜歡，打開來看看吧。"
          },
          {
            "speaker": "female",
            "text": "啊，我喜歡這支手錶。你怎麼知道我要的就是這個？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她不需要手錶",
          "她想要別的禮物",
          "這位先生買錯手錶",
          "這位先生買對了禮物"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位先生買對了禮物. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小明這次考試考得太差了。 是不是考試太難了？ 不是吧！很多學生都考得不錯，有好幾個都考一百分呢！ 我看啊！應該是小明念書念不了幾頁，就想出去玩。 這兩個人說，小明成績差的原因是什麼？",
        "dialogue": "男：小明這次考試考得太差了。\n女：是不是考試太難了？\n男：不是吧！很多學生都考得不錯，有好幾個都考一百分呢！\n女：我看啊！應該是小明念書念不了幾頁，就想出去玩。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小明這次考試考得太差了。"
          },
          {
            "speaker": "female",
            "text": "是不是考試太難了？"
          },
          {
            "speaker": "male",
            "text": "不是吧！很多學生都考得不錯，有好幾個都考一百分呢！"
          },
          {
            "speaker": "female",
            "text": "我看啊！應該是小明念書念不了幾頁，就想出去玩。"
          },
          {
            "speaker": "male",
            "text": "這兩個人說，小明成績差的原因是什麼？"
          }
        ],
        "q": "這兩個人說，小明成績差的原因是什麼？",
        "options": [
          "他不用功",
          "他不聰明",
          "考試太難",
          "他不小心寫錯"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他不用功. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳到新公司上班已經兩個星期了，一切還習慣嗎？ 嗯，我已經慢慢習慣那裡的環境了。 聽說在你們公司上班很辛苦，是真的嗎？ 辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有 一次旅遊活動喔！ 這位小姐的公司怎麼樣？",
        "dialogue": "男：妳到新公司上班已經兩個星期了，一切還習慣嗎？\n女：嗯，我已經慢慢習慣那裡的環境了。\n男：聽說在你們公司上班很辛苦，是真的嗎？\n女：辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有\n一次旅遊活動喔！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳到新公司上班已經兩個星期了，一切還習慣嗎？"
          },
          {
            "speaker": "female",
            "text": "嗯，我已經慢慢習慣那裡的環境了。"
          },
          {
            "speaker": "male",
            "text": "聽說在你們公司上班很辛苦，是真的嗎？"
          },
          {
            "speaker": "female",
            "text": "辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有"
          },
          {
            "speaker": "narrator",
            "text": "一次旅遊活動喔！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的公司怎麼樣？"
          }
        ],
        "q": "這位小姐的公司怎麼樣？",
        "options": [
          "對她不好",
          "午餐不用錢",
          "工作不是太多",
          "每年辦旅遊活動"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 每年辦旅遊活動. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我覺得我的頭有點兒疼，我很久沒這樣了。 最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。 像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！ 再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。 這位小姐覺得這位先生應該怎麼做？",
        "dialogue": "男：我覺得我的頭有點兒疼，我很久沒這樣了。\n女：最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。\n男：像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！\n女：再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我覺得我的頭有點兒疼，我很久沒這樣了。"
          },
          {
            "speaker": "female",
            "text": "最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。"
          },
          {
            "speaker": "male",
            "text": "像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！"
          },
          {
            "speaker": "female",
            "text": "再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。"
          },
          {
            "speaker": "male",
            "text": "這位小姐覺得這位先生應該怎麼做？"
          }
        ],
        "q": "這位小姐覺得這位先生應該怎麼做？",
        "options": [
          "不要搭公車",
          "到醫院看病",
          "多吃蔬菜水果",
          "養成運動的習慣"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 到醫院看病. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "玉珍，妳將來有什麼打算嗎？ 我打算以後過著單身生活，想去哪裡旅行就去哪裡。 萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？ 到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中 心，這樣就不用擔心了啊！ 這位小姐到了老年的時候有什麼計畫？",
        "dialogue": "男：玉珍，妳將來有什麼打算嗎？\n女：我打算以後過著單身生活，想去哪裡旅行就去哪裡。\n男：萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？\n女：到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中\n心，這樣就不用擔心了啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "玉珍，妳將來有什麼打算嗎？"
          },
          {
            "speaker": "female",
            "text": "我打算以後過著單身生活，想去哪裡旅行就去哪裡。"
          },
          {
            "speaker": "male",
            "text": "萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？"
          },
          {
            "speaker": "female",
            "text": "到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中"
          },
          {
            "speaker": "narrator",
            "text": "心，這樣就不用擔心了啊！"
          },
          {
            "speaker": "male",
            "text": "這位小姐到了老年的時候有什麼計畫？"
          }
        ],
        "q": "這位小姐到了老年的時候有什麼計畫？",
        "options": [
          "繼續工作",
          "組織一個家庭",
          "去世界各國旅行",
          "住在專門照顧老人的地方"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 住在專門照顧老人的地方. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "怎麼每一個人手上的盤子都堆滿食物啊！ 在這家餐廳，你要吃什麼就自己拿，拿多少就吃多少。 夾那麼多菜，這樣吃一頓下來應該要花不少錢吧？ 是啊！因為這裡的食物材料都是從國外進口，所以價格蠻高的，不過東西又 新鮮又多樣，飲料愛喝多少就喝多少，所有食物任你選，讓你吃到飽。 這家餐廳有什麼特色？",
        "dialogue": "男：怎麼每一個人手上的盤子都堆滿食物啊！\n女：在這家餐廳，你要吃什麼就自己拿，拿多少就吃多少。\n男：夾那麼多菜，這樣吃一頓下來應該要花不少錢吧？\n女：是啊！因為這裡的食物材料都是從國外進口，所以價格蠻高的，不過東西又\n新鮮又多樣，飲料愛喝多少就喝多少，所有食物任你選，讓你吃到飽。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "怎麼每一個人手上的盤子都堆滿食物啊！"
          },
          {
            "speaker": "female",
            "text": "在這家餐廳，你要吃什麼就自己拿，拿多少就吃多少。"
          },
          {
            "speaker": "male",
            "text": "夾那麼多菜，這樣吃一頓下來應該要花不少錢吧？"
          },
          {
            "speaker": "female",
            "text": "是啊！因為這裡的食物材料都是從國外進口，所以價格蠻高的，不過東西又"
          },
          {
            "speaker": "narrator",
            "text": "新鮮又多樣，飲料愛喝多少就喝多少，所有食物任你選，讓你吃到飽。"
          },
          {
            "speaker": "male",
            "text": "這家餐廳有什麼特色？"
          }
        ],
        "q": "這家餐廳有什麼特色？",
        "options": [
          "由服務生幫客人點餐",
          "食物材料從國外買進來",
          "每個人喝的飲料限制兩杯",
          "吃一頓飯所花的費用很便宜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 食物材料從國外買進來. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我明明就把電視的聲音調到最大了，為什麼聽起來還是這麼小？ 我們家的電視已經都用了十年以上，早該換一部新的了。 這部電視還能用，找人來修理就好了！我還真捨不得把它丟了！ 有什麼好捨不得的？光修理的費用就能買一部新的電視了呢！ 這位小姐想要怎樣處理這部電視？ 以下是兩個朋友之間的對話，請聽這段話，然後回答下面的兩個問題。 妳最近好像很忙，忙些什麼呢？ 我最近開始在網站上賣衣服，有好多事情要做。 妳已經有一份工作了，為什麼還要在網站上賣衣服呢？ 我有很多舊衣服，這些衣服已經不穿了，把它們賣掉，還可以賺錢，多好啊！ 這樣真不錯。我也有許多舊書，這些書都已經看完了，我看啊！我也來把它 們放到網站上賣給有需要的人好了。 我可以教你網站怎麼操作，你很快就能學會的。 21. 為什麼這位小姐要賣衣服？ 22. 這位先生想要做什麼？ 以下是一段兄妹的對話，請聽這段話，然後回答下面的兩個問題。 爸爸的生日快到了，我們送什麼樣的禮物給爸爸呢? 爸爸工作這麼忙，很久沒出國旅遊了，我們送爸爸飛機票跟旅遊的費用，讓 他好好的出國休假，你覺得怎麼樣？ 可是我想爸爸抽不出時間去旅遊吧！我覺得送運動器材比較好，讓爸爸多多 運動，身體才會健康。 好主意！爸爸的確需要多一點兒運動。 那我們就送爸爸一輛腳踏車吧！我們可以陪爸爸騎腳踏車，他一定很喜歡我 們跟他一起去運動。 聽起來不錯。不過，我們兩個都沒有腳踏車，所以我們一次要買三輛囉！況 且我自己得先學怎麼騎腳踏車才行。 23. 哥哥對爸爸的生日禮物有什麼看法？ 24. 關於腳踏車，妹妹最後有什麼想法？ 下面是一段和工作有關的對話。請你在聽完這段對話後，回答下面三個問題： 25. 這位小姐想到這家公司工作的原因是什麼？ 26. 這位小姐認為擔任業務人員最重要的能力是什麼？ 27. 這位主管說這位小姐缺少哪方面的經驗？ 現在請聽這段對話。 陳小姐，很高興認識妳！歡迎妳來應徵我們的工作，妳申請的工作是業務人 員，我想了解一下妳為什麼想到我們公司來呢？ 貴公司是世界有名的國際企業，而且公司規模也比我以前的公司大得多，我 相信在你們公司工作，未來一定有發展。 那麼，妳認為身為一個業務人員，最重要的能力是什麼？ 我覺得當業務人員最重要的能力，是開發新客戶以及新市場，現在各行各業 競爭非常激烈，必須盡快找到值得經營的市場，尋找新客戶。 這也是我們所想的。不過妳過去沒有開拓海外市場的經驗，而我們現在想要 徵求的是，能夠開發國外客戶，熟悉國外市場的人。 雖然我沒有這方面的經驗，但是我的英文能力不錯，能夠和國外客戶談生意， 我想我能夠達成任務。 其實妳的條件很不錯，我們決定了以後再通知妳。 謝謝你們給我這次面試機會，希望有機會能到貴公司工作。 下面是兩個朋友之間的對話。請你在聽完這段對話後，回答下面三個問題： 28. 快速約會是什麼樣的活動？ 29. 這位小姐認為快速約會的缺點是什麼？ 30. 這位先生覺得快速約會怎麼樣？ 現在請聽這段對話。 這一陣子工作忙，都沒時間認識女孩子。 說到這個，最近我參加了「快速約會」的活動，你也可以試試，說不定能從 中找到合適的交往對象。 「快速約會」？我沒聽過這個名詞。 這是只有單身的人才能夠參加的活動。每次活動只要五百塊錢，不算貴。一 次大概有四十到五十人，男女各一半，男生和女生兩個人面對面坐著以後， 有七分鐘的時間可以互相談話，七分鐘一到，男生們就站起來換一位新的聊 天對象，參加活動的人在很短的時間內就可以認識新朋友。 每七分鐘就能認識一個人，真快！但是，妳參加以後，真的能找到心目中理 想的交往對象嗎？ 我覺得的確可以認識比較多的人，不過，它的缺點是聊天只有短短幾分鐘， 無法深入地了解一個人。 不過和在網路上交朋友比起來，快速約會比較安全一點兒，至少是當面聊天， 可以從講話的態度、表情，稍微了解對方是個什麼樣的人。而且我最需要的 就是能夠認識多一點兒女孩子，這種活動很有效率，正好可以滿足我的需求。 既然你這麼有興趣，下次有快速約會的活動，我再找你一塊兒參加。 第二部分 段落 請聽這一段車站裡的廣播，然後回答下面的問題。 各位旅客，很抱歉！因為大雨的關係，十二點五十分往台北的一一零號火車 會晚半個小時到，要坐一一零號車的旅客請在月台上耐心等候。謝謝！ 31. 這段廣播說一一零號車怎麼樣？ 請聽這一段百貨公司的廣播，然後回答下面的問題。 趕快來！趕快來！只有十分鐘，本公司一樓皮包五折賣出，真皮皮包一個一 千塊，一個一千塊，買一送一，買一送一，只有十分鐘，現在不買就要等下次囉！ 32. 如果陳小姐想要兩個皮包，應該給多少錢？ 請聽這一段話，然後回答下面的問題。 各位同學，今天晚上的新年晚會有很多節目，有法國同學唱法國歌兒，還有 日本同學跳日本的舞，最特別的是有一位學生要學小鳥叫。最後，老師們會教大 家唱中國新年的歌兒。 33. 這段話說今天的晚會怎麼樣？ 請聽這一段話，然後回答下面的問題。 寒假的時候，王先生和家人到日本玩。因為王先生一家人都不會說日本話， 可是日本人認得漢字，所以他們常常用寫字的方式跟日本人談話。在飯館兒點菜 的時候，因為不知道日本菜的名字，他們只好看圖片點菜，還好都沒弄錯。 34. 王先生一家人在日本怎麼點菜？ 請聽這位老師說的話，然後回答下面的兩個問題。 同學們，第七課的課文我們已經上完了，你們有三個回家作業，第一是背課 文，第二是記住這一課全部的生字，第三是在一張練習紙上寫下五個句子。你們 也要複習第七課，下次一上課，我們就先考第七課的內容。 35. 學生的回家作業是什麼？ 36. 下一次上課，老師要先做什麼？ 請聽這一段天氣報告，然後回答下面的兩個問題。 秋天到了，白天的時間越來越短，晚上的時間越來越長，天氣也變得涼一點 兒，早晚的天氣變化很大，請大家注意。明天是不下雨的好天氣，白天是晴天， 感覺還是很熱，但是，夜裡風很大，有點兒冷，所以明天出門的時候，別忘了多 帶一件外套。 37. 這個季節的天氣怎麼樣？ 38. 明天的天氣怎麼樣？ 請聽這一段話，然後回答下面的兩個問題。 我昨天到動物園參觀，看到了很多動物，有生活在草原上的馬，還有住在森 林裡的鳥，在水裡游的魚。在這些動物裡面，我最喜歡鳥了，牠們身上有好多種 顏色，叫聲也很好聽，我覺得鳥兒真是可愛！那裡還有人在擠牛奶，我吃了那邊 賣的牛奶冰，牛奶冰很好吃！我覺得動物園真好玩，下次我一定還要再來！ 39. 說話的人最喜歡什麼動物？ 40. 說話的人在動物園做了什麼？ 請聽一段醫生對病人說的話，然後回答下面的兩個問題。 陳先生你一百七十公分高，但是卻有一百公斤重，如果不改變目前的生活習 慣，你的健康會越來越差。你最好從現在開始，每天運動一個小時，這一個小時 不必都做一樣的運動，你可以先騎腳踏車騎半個小時，再慢跑半個小時。除了運 動，還要少吃甜的東西，也不能吃太多肉，要多吃青菜，這麼做才能讓你變健康。 41. 這位先生的身體現在怎麼樣？ 42. 醫生要這位先生怎麼做？ 請聽這一段話，然後回答下面的兩個問題。 大偉想到一家公司上班，今天這家公司的人請他去談談。因為這家公司需要 有人在公司的網站上用英文寫文章，向外國人介紹公司的產品，所以老闆就問大 偉的文章寫得怎麼樣。大偉說他大學是念英國文學的，所以這項工作對他來說不 難。老闆再繼續問了一些問題以後，覺得大偉對工作內容很了解，態度也不錯， 所以決定先讓他工作三個月，看看他的表現怎麼樣。 43. 這家公司需要什麼樣的新人？ 44. 大偉談工作的結果怎麼樣？ 下面是關於睡眠的研究報告。請你聽完報告後，回答下面三個問題： 45. 說話的人認為什麼才是合適的睡眠？ 46. 我們可以根據哪件事知道自己究竟需要睡多久才夠？ 47. 這段報告的結論是什麼？ 現在請聽報告。 多數人認為每晚應該睡足八個小時，並且必須在晚上十一點以前睡才算正 確，但其實每個人對於睡眠的需要不同，有人越晚越有精神，有人一大早就起來 活動，每個人的睡眠是有個別差異的。睡足自己身體所需要的量，才是合適的睡 眠需要。 要如何才能了解自己究竟需要睡多久呢？建議可以養成評估白天精神的習 慣：一覺醒來很有精神為一百分；經過一夜睡眠，但身體的疲勞卻完全無法恢復 為零分。若評估白天的精神可達自己設定的八十分以上，就代表晚上睡眠的需求 已被滿足。 總而言之，睡得多不一定睡得飽，睡得少也不代表睡不好。當找到適合自己 的睡眠時數以後，就可以在白天擁有好精神，晚上擁有好睡眠。因此，與其說清 楚到底需要幾個小時的睡眠才健康，倒不如花些時間，觀察自己在白天的時候精 神、情緒等各方面是否良好及穩定。白天與晚上身體都覺得舒服，就是睡得夠。 下面是一則關於自行車的新聞報導。請你聽完這則報導後，回答下面三個問題： 48. 這則報導主要在說明什麼？ 49. 根據報導，我們可以從哪方面知道一座城市很適合把自行車當作主要交通工 具？ 50. 報導內容指出，怎麼做才能增加騎自行車的人數？ 現在請聽報導。 自行車是一種環保的交通工具，但是如何鼓勵民眾少開車、多騎自行車，卻 是每個關心環境的都市計劃人員傷腦筋的課題。越來越多的研究顯示，增加自行 車人口的最佳策略，就是找出究竟女性需要什麼？一位大學講師發表過幾篇關於 騎自行車與性別差異的研究報告，她表示：「如果你想知道都市環境適不適合騎 自行車，只需要計算自行車人口中的女性比例就行了，騎自行車的女性越多，就 表示這個都市越適合騎自行車。」 而女性被視為衡量都市環境是否適合騎自行車的標準，背後原因是來自於女 性比男性傾向避免任何冒險的行為，也就是說，得有更安全的自行車環境，女性 朋友才願意騎自行車上路。此外，女性通常得負責大部分照顧小孩子與購買生活 用品的工作，這也表示規劃自行車道路的時候，必須經過城市內生活機能較高的 區域，這也是說，設計自行車道路的路線，應該讓路線通往超級市場、學校或托 兒所等實用的目的地，才能有效提升自行車使用率。",
        "dialogue": "男：我明明就把電視的聲音調到最大了，為什麼聽起來還是這麼小？\n女：我們家的電視已經都用了十年以上，早該換一部新的了。\n男：這部電視還能用，找人來修理就好了！我還真捨不得把它丟了！\n女：有什麼好捨不得的？光修理的費用就能買一部新的電視了呢！\n男：這位小姐想要怎樣處理這部電視？\n以下是兩個朋友之間的對話，請聽這段話，然後回答下面的兩個問題。\n男：妳最近好像很忙，忙些什麼呢？\n女：我最近開始在網站上賣衣服，有好多事情要做。\n男：妳已經有一份工作了，為什麼還要在網站上賣衣服呢？\n女：我有很多舊衣服，這些衣服已經不穿了，把它們賣掉，還可以賺錢，多好啊！\n男：這樣真不錯。我也有許多舊書，這些書都已經看完了，我看啊！我也來把它\n們放到網站上賣給有需要的人好了。\n女：我可以教你網站怎麼操作，你很快就能學會的。\n21. 為什麼這位小姐要賣衣服？\n22. 這位先生想要做什麼？\n以下是一段兄妹的對話，請聽這段話，然後回答下面的兩個問題。\n男：爸爸的生日快到了，我們送什麼樣的禮物給爸爸呢?\n女：爸爸工作這麼忙，很久沒出國旅遊了，我們送爸爸飛機票跟旅遊的費用，讓\n他好好的出國休假，你覺得怎麼樣？\n男：可是我想爸爸抽不出時間去旅遊吧！我覺得送運動器材比較好，讓爸爸多多\n運動，身體才會健康。\n女：好主意！爸爸的確需要多一點兒運動。\n男：那我們就送爸爸一輛腳踏車吧！我們可以陪爸爸騎腳踏車，他一定很喜歡我\n們跟他一起去運動。\n女：聽起來不錯。不過，我們兩個都沒有腳踏車，所以我們一次要買三輛囉！況\n且我自己得先學怎麼騎腳踏車才行。\n23. 哥哥對爸爸的生日禮物有什麼看法？\n24. 關於腳踏車，妹妹最後有什麼想法？\n下面是一段和工作有關的對話。請你在聽完這段對話後，回答下面三個問題：\n25. 這位小姐想到這家公司工作的原因是什麼？\n26. 這位小姐認為擔任業務人員最重要的能力是什麼？\n27. 這位主管說這位小姐缺少哪方面的經驗？\n現在請聽這段對話。\n男：陳小姐，很高興認識妳！歡迎妳來應徵我們的工作，妳申請的工作是業務人\n員，我想了解一下妳為什麼想到我們公司來呢？\n女：貴公司是世界有名的國際企業，而且公司規模也比我以前的公司大得多，我\n相信在你們公司工作，未來一定有發展。\n男：那麼，妳認為身為一個業務人員，最重要的能力是什麼？\n女：我覺得當業務人員最重要的能力，是開發新客戶以及新市場，現在各行各業\n競爭非常激烈，必須盡快找到值得經營的市場，尋找新客戶。\n男：這也是我們所想的。不過妳過去沒有開拓海外市場的經驗，而我們現在想要\n徵求的是，能夠開發國外客戶，熟悉國外市場的人。\n女：雖然我沒有這方面的經驗，但是我的英文能力不錯，能夠和國外客戶談生意，\n我想我能夠達成任務。\n男：其實妳的條件很不錯，我們決定了以後再通知妳。\n女：謝謝你們給我這次面試機會，希望有機會能到貴公司工作。\n下面是兩個朋友之間的對話。請你在聽完這段對話後，回答下面三個問題：\n28. 快速約會是什麼樣的活動？\n29. 這位小姐認為快速約會的缺點是什麼？\n30. 這位先生覺得快速約會怎麼樣？\n現在請聽這段對話。\n男：這一陣子工作忙，都沒時間認識女孩子。\n女：說到這個，最近我參加了「快速約會」的活動，你也可以試試，說不定能從\n中找到合適的交往對象。\n男：「快速約會」？我沒聽過這個名詞。\n女：這是只有單身的人才能夠參加的活動。每次活動只要五百塊錢，不算貴。一\n次大概有四十到五十人，男女各一半，男生和女生兩個人面對面坐著以後，\n有七分鐘的時間可以互相談話，七分鐘一到，男生們就站起來換一位新的聊\n天對象，參加活動的人在很短的時間內就可以認識新朋友。\n男：每七分鐘就能認識一個人，真快！但是，妳參加以後，真的能找到心目中理\n想的交往對象嗎？\n女：我覺得的確可以認識比較多的人，不過，它的缺點是聊天只有短短幾分鐘，\n無法深入地了解一個人。\n男：不過和在網路上交朋友比起來，快速約會比較安全一點兒，至少是當面聊天，\n可以從講話的態度、表情，稍微了解對方是個什麼樣的人。而且我最需要的\n就是能夠認識多一點兒女孩子，這種活動很有效率，正好可以滿足我的需求。\n女：既然你這麼有興趣，下次有快速約會的活動，我再找你一塊兒參加。\n第二部分 段落\n請聽這一段車站裡的廣播，然後回答下面的問題。\n各位旅客，很抱歉！因為大雨的關係，十二點五十分往台北的一一零號火車\n會晚半個小時到，要坐一一零號車的旅客請在月台上耐心等候。謝謝！\n31. 這段廣播說一一零號車怎麼樣？\n請聽這一段百貨公司的廣播，然後回答下面的問題。\n趕快來！趕快來！只有十分鐘，本公司一樓皮包五折賣出，真皮皮包一個一\n千塊，一個一千塊，買一送一，買一送一，只有十分鐘，現在不買就要等下次囉！\n32. 如果陳小姐想要兩個皮包，應該給多少錢？\n請聽這一段話，然後回答下面的問題。\n各位同學，今天晚上的新年晚會有很多節目，有法國同學唱法國歌兒，還有\n日本同學跳日本的舞，最特別的是有一位學生要學小鳥叫。最後，老師們會教大\n家唱中國新年的歌兒。\n33. 這段話說今天的晚會怎麼樣？\n請聽這一段話，然後回答下面的問題。\n寒假的時候，王先生和家人到日本玩。因為王先生一家人都不會說日本話，\n可是日本人認得漢字，所以他們常常用寫字的方式跟日本人談話。在飯館兒點菜\n的時候，因為不知道日本菜的名字，他們只好看圖片點菜，還好都沒弄錯。\n34. 王先生一家人在日本怎麼點菜？\n請聽這位老師說的話，然後回答下面的兩個問題。\n同學們，第七課的課文我們已經上完了，你們有三個回家作業，第一是背課\n文，第二是記住這一課全部的生字，第三是在一張練習紙上寫下五個句子。你們\n也要複習第七課，下次一上課，我們就先考第七課的內容。\n35. 學生的回家作業是什麼？\n36. 下一次上課，老師要先做什麼？\n請聽這一段天氣報告，然後回答下面的兩個問題。\n秋天到了，白天的時間越來越短，晚上的時間越來越長，天氣也變得涼一點\n兒，早晚的天氣變化很大，請大家注意。明天是不下雨的好天氣，白天是晴天，\n感覺還是很熱，但是，夜裡風很大，有點兒冷，所以明天出門的時候，別忘了多\n帶一件外套。\n37. 這個季節的天氣怎麼樣？\n38. 明天的天氣怎麼樣？\n請聽這一段話，然後回答下面的兩個問題。\n我昨天到動物園參觀，看到了很多動物，有生活在草原上的馬，還有住在森\n林裡的鳥，在水裡游的魚。在這些動物裡面，我最喜歡鳥了，牠們身上有好多種\n顏色，叫聲也很好聽，我覺得鳥兒真是可愛！那裡還有人在擠牛奶，我吃了那邊\n賣的牛奶冰，牛奶冰很好吃！我覺得動物園真好玩，下次我一定還要再來！\n39. 說話的人最喜歡什麼動物？\n40. 說話的人在動物園做了什麼？\n請聽一段醫生對病人說的話，然後回答下面的兩個問題。\n陳先生你一百七十公分高，但是卻有一百公斤重，如果不改變目前的生活習\n慣，你的健康會越來越差。你最好從現在開始，每天運動一個小時，這一個小時\n不必都做一樣的運動，你可以先騎腳踏車騎半個小時，再慢跑半個小時。除了運\n動，還要少吃甜的東西，也不能吃太多肉，要多吃青菜，這麼做才能讓你變健康。\n41. 這位先生的身體現在怎麼樣？\n42. 醫生要這位先生怎麼做？\n請聽這一段話，然後回答下面的兩個問題。\n大偉想到一家公司上班，今天這家公司的人請他去談談。因為這家公司需要\n有人在公司的網站上用英文寫文章，向外國人介紹公司的產品，所以老闆就問大\n偉的文章寫得怎麼樣。大偉說他大學是念英國文學的，所以這項工作對他來說不\n難。老闆再繼續問了一些問題以後，覺得大偉對工作內容很了解，態度也不錯，\n所以決定先讓他工作三個月，看看他的表現怎麼樣。\n43. 這家公司需要什麼樣的新人？\n44. 大偉談工作的結果怎麼樣？\n下面是關於睡眠的研究報告。請你聽完報告後，回答下面三個問題：\n45. 說話的人認為什麼才是合適的睡眠？\n46. 我們可以根據哪件事知道自己究竟需要睡多久才夠？\n47. 這段報告的結論是什麼？\n現在請聽報告。\n多數人認為每晚應該睡足八個小時，並且必須在晚上十一點以前睡才算正\n確，但其實每個人對於睡眠的需要不同，有人越晚越有精神，有人一大早就起來\n活動，每個人的睡眠是有個別差異的。睡足自己身體所需要的量，才是合適的睡\n眠需要。\n要如何才能了解自己究竟需要睡多久呢？建議可以養成評估白天精神的習\n慣：一覺醒來很有精神為一百分；經過一夜睡眠，但身體的疲勞卻完全無法恢復\n為零分。若評估白天的精神可達自己設定的八十分以上，就代表晚上睡眠的需求\n已被滿足。\n總而言之，睡得多不一定睡得飽，睡得少也不代表睡不好。當找到適合自己\n的睡眠時數以後，就可以在白天擁有好精神，晚上擁有好睡眠。因此，與其說清\n楚到底需要幾個小時的睡眠才健康，倒不如花些時間，觀察自己在白天的時候精\n神、情緒等各方面是否良好及穩定。白天與晚上身體都覺得舒服，就是睡得夠。\n下面是一則關於自行車的新聞報導。請你聽完這則報導後，回答下面三個問題：\n48. 這則報導主要在說明什麼？\n49. 根據報導，我們可以從哪方面知道一座城市很適合把自行車當作主要交通工\n具？\n50. 報導內容指出，怎麼做才能增加騎自行車的人數？\n現在請聽報導。\n自行車是一種環保的交通工具，但是如何鼓勵民眾少開車、多騎自行車，卻\n是每個關心環境的都市計劃人員傷腦筋的課題。越來越多的研究顯示，增加自行\n車人口的最佳策略，就是找出究竟女性需要什麼？一位大學講師發表過幾篇關於\n騎自行車與性別差異的研究報告，她表示：「如果你想知道都市環境適不適合騎\n自行車，只需要計算自行車人口中的女性比例就行了，騎自行車的女性越多，就\n表示這個都市越適合騎自行車。」\n而女性被視為衡量都市環境是否適合騎自行車的標準，背後原因是來自於女\n性比男性傾向避免任何冒險的行為，也就是說，得有更安全的自行車環境，女性\n朋友才願意騎自行車上路。此外，女性通常得負責大部分照顧小孩子與購買生活\n用品的工作，這也表示規劃自行車道路的時候，必須經過城市內生活機能較高的\n區域，這也是說，設計自行車道路的路線，應該讓路線通往超級市場、學校或托",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我明明就把電視的聲音調到最大了，為什麼聽起來還是這麼小？"
          },
          {
            "speaker": "female",
            "text": "我們家的電視已經都用了十年以上，早該換一部新的了。"
          },
          {
            "speaker": "male",
            "text": "這部電視還能用，找人來修理就好了！我還真捨不得把它丟了！"
          },
          {
            "speaker": "female",
            "text": "有什麼好捨不得的？光修理的費用就能買一部新的電視了呢！"
          },
          {
            "speaker": "male",
            "text": "這位小姐想要怎樣處理這部電視？"
          },
          {
            "speaker": "narrator",
            "text": "以下是兩個朋友之間的對話，請聽這段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "male",
            "text": "妳最近好像很忙，忙些什麼呢？"
          },
          {
            "speaker": "female",
            "text": "我最近開始在網站上賣衣服，有好多事情要做。"
          },
          {
            "speaker": "male",
            "text": "妳已經有一份工作了，為什麼還要在網站上賣衣服呢？"
          },
          {
            "speaker": "female",
            "text": "我有很多舊衣服，這些衣服已經不穿了，把它們賣掉，還可以賺錢，多好啊！"
          },
          {
            "speaker": "male",
            "text": "這樣真不錯。我也有許多舊書，這些書都已經看完了，我看啊！我也來把它"
          },
          {
            "speaker": "narrator",
            "text": "們放到網站上賣給有需要的人好了。"
          },
          {
            "speaker": "female",
            "text": "我可以教你網站怎麼操作，你很快就能學會的。"
          },
          {
            "speaker": "narrator",
            "text": "21. 為什麼這位小姐要賣衣服？"
          },
          {
            "speaker": "narrator",
            "text": "22. 這位先生想要做什麼？"
          },
          {
            "speaker": "narrator",
            "text": "以下是一段兄妹的對話，請聽這段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "male",
            "text": "爸爸的生日快到了，我們送什麼樣的禮物給爸爸呢?"
          },
          {
            "speaker": "female",
            "text": "爸爸工作這麼忙，很久沒出國旅遊了，我們送爸爸飛機票跟旅遊的費用，讓"
          },
          {
            "speaker": "narrator",
            "text": "他好好的出國休假，你覺得怎麼樣？"
          },
          {
            "speaker": "male",
            "text": "可是我想爸爸抽不出時間去旅遊吧！我覺得送運動器材比較好，讓爸爸多多"
          },
          {
            "speaker": "narrator",
            "text": "運動，身體才會健康。"
          },
          {
            "speaker": "female",
            "text": "好主意！爸爸的確需要多一點兒運動。"
          },
          {
            "speaker": "male",
            "text": "那我們就送爸爸一輛腳踏車吧！我們可以陪爸爸騎腳踏車，他一定很喜歡我"
          },
          {
            "speaker": "narrator",
            "text": "們跟他一起去運動。"
          },
          {
            "speaker": "female",
            "text": "聽起來不錯。不過，我們兩個都沒有腳踏車，所以我們一次要買三輛囉！況"
          },
          {
            "speaker": "narrator",
            "text": "且我自己得先學怎麼騎腳踏車才行。"
          },
          {
            "speaker": "narrator",
            "text": "23. 哥哥對爸爸的生日禮物有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "24. 關於腳踏車，妹妹最後有什麼想法？"
          },
          {
            "speaker": "narrator",
            "text": "下面是一段和工作有關的對話。請你在聽完這段對話後，回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "25. 這位小姐想到這家公司工作的原因是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "26. 這位小姐認為擔任業務人員最重要的能力是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "27. 這位主管說這位小姐缺少哪方面的經驗？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽這段對話。"
          },
          {
            "speaker": "male",
            "text": "陳小姐，很高興認識妳！歡迎妳來應徵我們的工作，妳申請的工作是業務人"
          },
          {
            "speaker": "narrator",
            "text": "員，我想了解一下妳為什麼想到我們公司來呢？"
          },
          {
            "speaker": "female",
            "text": "貴公司是世界有名的國際企業，而且公司規模也比我以前的公司大得多，我"
          },
          {
            "speaker": "narrator",
            "text": "相信在你們公司工作，未來一定有發展。"
          },
          {
            "speaker": "male",
            "text": "那麼，妳認為身為一個業務人員，最重要的能力是什麼？"
          },
          {
            "speaker": "female",
            "text": "我覺得當業務人員最重要的能力，是開發新客戶以及新市場，現在各行各業"
          },
          {
            "speaker": "narrator",
            "text": "競爭非常激烈，必須盡快找到值得經營的市場，尋找新客戶。"
          },
          {
            "speaker": "male",
            "text": "這也是我們所想的。不過妳過去沒有開拓海外市場的經驗，而我們現在想要"
          },
          {
            "speaker": "narrator",
            "text": "徵求的是，能夠開發國外客戶，熟悉國外市場的人。"
          },
          {
            "speaker": "female",
            "text": "雖然我沒有這方面的經驗，但是我的英文能力不錯，能夠和國外客戶談生意，"
          },
          {
            "speaker": "narrator",
            "text": "我想我能夠達成任務。"
          },
          {
            "speaker": "male",
            "text": "其實妳的條件很不錯，我們決定了以後再通知妳。"
          },
          {
            "speaker": "female",
            "text": "謝謝你們給我這次面試機會，希望有機會能到貴公司工作。"
          },
          {
            "speaker": "narrator",
            "text": "下面是兩個朋友之間的對話。請你在聽完這段對話後，回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "28. 快速約會是什麼樣的活動？"
          },
          {
            "speaker": "narrator",
            "text": "29. 這位小姐認為快速約會的缺點是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "30. 這位先生覺得快速約會怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽這段對話。"
          },
          {
            "speaker": "male",
            "text": "這一陣子工作忙，都沒時間認識女孩子。"
          },
          {
            "speaker": "female",
            "text": "說到這個，最近我參加了「快速約會」的活動，你也可以試試，說不定能從"
          },
          {
            "speaker": "narrator",
            "text": "中找到合適的交往對象。"
          },
          {
            "speaker": "male",
            "text": "「快速約會」？我沒聽過這個名詞。"
          },
          {
            "speaker": "female",
            "text": "這是只有單身的人才能夠參加的活動。每次活動只要五百塊錢，不算貴。一"
          },
          {
            "speaker": "narrator",
            "text": "次大概有四十到五十人，男女各一半，男生和女生兩個人面對面坐著以後，"
          },
          {
            "speaker": "narrator",
            "text": "有七分鐘的時間可以互相談話，七分鐘一到，男生們就站起來換一位新的聊"
          },
          {
            "speaker": "narrator",
            "text": "天對象，參加活動的人在很短的時間內就可以認識新朋友。"
          },
          {
            "speaker": "male",
            "text": "每七分鐘就能認識一個人，真快！但是，妳參加以後，真的能找到心目中理"
          },
          {
            "speaker": "narrator",
            "text": "想的交往對象嗎？"
          },
          {
            "speaker": "female",
            "text": "我覺得的確可以認識比較多的人，不過，它的缺點是聊天只有短短幾分鐘，"
          },
          {
            "speaker": "narrator",
            "text": "無法深入地了解一個人。"
          },
          {
            "speaker": "male",
            "text": "不過和在網路上交朋友比起來，快速約會比較安全一點兒，至少是當面聊天，"
          },
          {
            "speaker": "narrator",
            "text": "可以從講話的態度、表情，稍微了解對方是個什麼樣的人。而且我最需要的"
          },
          {
            "speaker": "narrator",
            "text": "就是能夠認識多一點兒女孩子，這種活動很有效率，正好可以滿足我的需求。"
          },
          {
            "speaker": "female",
            "text": "既然你這麼有興趣，下次有快速約會的活動，我再找你一塊兒參加。"
          },
          {
            "speaker": "narrator",
            "text": "第二部分 段落"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段車站裡的廣播，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "各位旅客，很抱歉！因為大雨的關係，十二點五十分往台北的一一零號火車"
          },
          {
            "speaker": "narrator",
            "text": "會晚半個小時到，要坐一一零號車的旅客請在月台上耐心等候。謝謝！"
          },
          {
            "speaker": "narrator",
            "text": "31. 這段廣播說一一零號車怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段百貨公司的廣播，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "趕快來！趕快來！只有十分鐘，本公司一樓皮包五折賣出，真皮皮包一個一"
          },
          {
            "speaker": "narrator",
            "text": "千塊，一個一千塊，買一送一，買一送一，只有十分鐘，現在不買就要等下次囉！"
          },
          {
            "speaker": "narrator",
            "text": "32. 如果陳小姐想要兩個皮包，應該給多少錢？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "各位同學，今天晚上的新年晚會有很多節目，有法國同學唱法國歌兒，還有"
          },
          {
            "speaker": "narrator",
            "text": "日本同學跳日本的舞，最特別的是有一位學生要學小鳥叫。最後，老師們會教大"
          },
          {
            "speaker": "narrator",
            "text": "家唱中國新年的歌兒。"
          },
          {
            "speaker": "narrator",
            "text": "33. 這段話說今天的晚會怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "寒假的時候，王先生和家人到日本玩。因為王先生一家人都不會說日本話，"
          },
          {
            "speaker": "narrator",
            "text": "可是日本人認得漢字，所以他們常常用寫字的方式跟日本人談話。在飯館兒點菜"
          },
          {
            "speaker": "narrator",
            "text": "的時候，因為不知道日本菜的名字，他們只好看圖片點菜，還好都沒弄錯。"
          },
          {
            "speaker": "narrator",
            "text": "34. 王先生一家人在日本怎麼點菜？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這位老師說的話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "同學們，第七課的課文我們已經上完了，你們有三個回家作業，第一是背課"
          },
          {
            "speaker": "narrator",
            "text": "文，第二是記住這一課全部的生字，第三是在一張練習紙上寫下五個句子。你們"
          },
          {
            "speaker": "narrator",
            "text": "也要複習第七課，下次一上課，我們就先考第七課的內容。"
          },
          {
            "speaker": "narrator",
            "text": "35. 學生的回家作業是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "36. 下一次上課，老師要先做什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段天氣報告，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "秋天到了，白天的時間越來越短，晚上的時間越來越長，天氣也變得涼一點"
          },
          {
            "speaker": "narrator",
            "text": "兒，早晚的天氣變化很大，請大家注意。明天是不下雨的好天氣，白天是晴天，"
          },
          {
            "speaker": "narrator",
            "text": "感覺還是很熱，但是，夜裡風很大，有點兒冷，所以明天出門的時候，別忘了多"
          },
          {
            "speaker": "narrator",
            "text": "帶一件外套。"
          },
          {
            "speaker": "narrator",
            "text": "37. 這個季節的天氣怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "38. 明天的天氣怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "我昨天到動物園參觀，看到了很多動物，有生活在草原上的馬，還有住在森"
          },
          {
            "speaker": "narrator",
            "text": "林裡的鳥，在水裡游的魚。在這些動物裡面，我最喜歡鳥了，牠們身上有好多種"
          },
          {
            "speaker": "narrator",
            "text": "顏色，叫聲也很好聽，我覺得鳥兒真是可愛！那裡還有人在擠牛奶，我吃了那邊"
          },
          {
            "speaker": "narrator",
            "text": "賣的牛奶冰，牛奶冰很好吃！我覺得動物園真好玩，下次我一定還要再來！"
          },
          {
            "speaker": "narrator",
            "text": "39. 說話的人最喜歡什麼動物？"
          },
          {
            "speaker": "narrator",
            "text": "40. 說話的人在動物園做了什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽一段醫生對病人說的話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "陳先生你一百七十公分高，但是卻有一百公斤重，如果不改變目前的生活習"
          },
          {
            "speaker": "narrator",
            "text": "慣，你的健康會越來越差。你最好從現在開始，每天運動一個小時，這一個小時"
          },
          {
            "speaker": "narrator",
            "text": "不必都做一樣的運動，你可以先騎腳踏車騎半個小時，再慢跑半個小時。除了運"
          },
          {
            "speaker": "narrator",
            "text": "動，還要少吃甜的東西，也不能吃太多肉，要多吃青菜，這麼做才能讓你變健康。"
          },
          {
            "speaker": "narrator",
            "text": "41. 這位先生的身體現在怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "42. 醫生要這位先生怎麼做？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "大偉想到一家公司上班，今天這家公司的人請他去談談。因為這家公司需要"
          },
          {
            "speaker": "narrator",
            "text": "有人在公司的網站上用英文寫文章，向外國人介紹公司的產品，所以老闆就問大"
          },
          {
            "speaker": "narrator",
            "text": "偉的文章寫得怎麼樣。大偉說他大學是念英國文學的，所以這項工作對他來說不"
          },
          {
            "speaker": "narrator",
            "text": "難。老闆再繼續問了一些問題以後，覺得大偉對工作內容很了解，態度也不錯，"
          },
          {
            "speaker": "narrator",
            "text": "所以決定先讓他工作三個月，看看他的表現怎麼樣。"
          },
          {
            "speaker": "narrator",
            "text": "43. 這家公司需要什麼樣的新人？"
          },
          {
            "speaker": "narrator",
            "text": "44. 大偉談工作的結果怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "下面是關於睡眠的研究報告。請你聽完報告後，回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "45. 說話的人認為什麼才是合適的睡眠？"
          },
          {
            "speaker": "narrator",
            "text": "46. 我們可以根據哪件事知道自己究竟需要睡多久才夠？"
          },
          {
            "speaker": "narrator",
            "text": "47. 這段報告的結論是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報告。"
          },
          {
            "speaker": "narrator",
            "text": "多數人認為每晚應該睡足八個小時，並且必須在晚上十一點以前睡才算正"
          },
          {
            "speaker": "narrator",
            "text": "確，但其實每個人對於睡眠的需要不同，有人越晚越有精神，有人一大早就起來"
          },
          {
            "speaker": "narrator",
            "text": "活動，每個人的睡眠是有個別差異的。睡足自己身體所需要的量，才是合適的睡"
          },
          {
            "speaker": "narrator",
            "text": "眠需要。"
          },
          {
            "speaker": "narrator",
            "text": "要如何才能了解自己究竟需要睡多久呢？建議可以養成評估白天精神的習"
          },
          {
            "speaker": "narrator",
            "text": "慣：一覺醒來很有精神為一百分；經過一夜睡眠，但身體的疲勞卻完全無法恢復"
          },
          {
            "speaker": "narrator",
            "text": "為零分。若評估白天的精神可達自己設定的八十分以上，就代表晚上睡眠的需求"
          },
          {
            "speaker": "narrator",
            "text": "已被滿足。"
          },
          {
            "speaker": "narrator",
            "text": "總而言之，睡得多不一定睡得飽，睡得少也不代表睡不好。當找到適合自己"
          },
          {
            "speaker": "narrator",
            "text": "的睡眠時數以後，就可以在白天擁有好精神，晚上擁有好睡眠。因此，與其說清"
          },
          {
            "speaker": "narrator",
            "text": "楚到底需要幾個小時的睡眠才健康，倒不如花些時間，觀察自己在白天的時候精"
          },
          {
            "speaker": "narrator",
            "text": "神、情緒等各方面是否良好及穩定。白天與晚上身體都覺得舒服，就是睡得夠。"
          },
          {
            "speaker": "narrator",
            "text": "下面是一則關於自行車的新聞報導。請你聽完這則報導後，回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "48. 這則報導主要在說明什麼？"
          },
          {
            "speaker": "narrator",
            "text": "49. 根據報導，我們可以從哪方面知道一座城市很適合把自行車當作主要交通工"
          },
          {
            "speaker": "narrator",
            "text": "具？"
          },
          {
            "speaker": "narrator",
            "text": "50. 報導內容指出，怎麼做才能增加騎自行車的人數？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "自行車是一種環保的交通工具，但是如何鼓勵民眾少開車、多騎自行車，卻"
          },
          {
            "speaker": "narrator",
            "text": "是每個關心環境的都市計劃人員傷腦筋的課題。越來越多的研究顯示，增加自行"
          },
          {
            "speaker": "narrator",
            "text": "車人口的最佳策略，就是找出究竟女性需要什麼？一位大學講師發表過幾篇關於"
          },
          {
            "speaker": "narrator",
            "text": "騎自行車與性別差異的研究報告，她表示：「如果你想知道都市環境適不適合騎"
          },
          {
            "speaker": "narrator",
            "text": "自行車，只需要計算自行車人口中的女性比例就行了，騎自行車的女性越多，就"
          },
          {
            "speaker": "narrator",
            "text": "表示這個都市越適合騎自行車。」"
          },
          {
            "speaker": "narrator",
            "text": "而女性被視為衡量都市環境是否適合騎自行車的標準，背後原因是來自於女"
          },
          {
            "speaker": "narrator",
            "text": "性比男性傾向避免任何冒險的行為，也就是說，得有更安全的自行車環境，女性"
          },
          {
            "speaker": "narrator",
            "text": "朋友才願意騎自行車上路。此外，女性通常得負責大部分照顧小孩子與購買生活"
          },
          {
            "speaker": "narrator",
            "text": "用品的工作，這也表示規劃自行車道路的時候，必須經過城市內生活機能較高的"
          },
          {
            "speaker": "narrator",
            "text": "區域，這也是說，設計自行車道路的路線，應該讓路線通往超級市場、學校或托"
          },
          {
            "speaker": "narrator",
            "text": "兒所等實用的目的地，才能有效提升自行車使用率。"
          }
        ],
        "q": "兒所等實用的目的地，才能有效提升自行車使用率。",
        "options": [
          "把它丟了",
          "繼續使用",
          "找人來修理",
          "把它賣給別人"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 把它丟了. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 21",
        "options": [
          "她找不到其他工作",
          "她買了很多新衣服",
          "朋友送給她很多衣服",
          "她有很多不需要的衣服"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她有很多不需要的衣服. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 22",
        "options": [
          "買新書",
          "賣舊書",
          "賣衣服",
          "買衣服"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 賣舊書. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 23",
        "options": [
          "送飛機票",
          "陪爸爸出差",
          "送運動器材",
          "帶爸爸出國旅遊"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 送運動器材. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 24",
        "options": [
          "她要跟朋友借腳踏車",
          "她要教爸爸騎腳踏車",
          "她不想陪爸爸騎腳踏車",
          "她也要買一輛腳踏車給自己"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她也要買一輛腳踏車給自己. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 25",
        "options": [
          "她不想再當業務人員",
          "她被原本的公司開除了",
          "她覺得在這家公司比較有前途",
          "這家公司主動請這位小姐來工作"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她覺得在這家公司比較有前途. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 1: Chọn từ thích hợp nhất điền vào chỗ trống [1].",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng thể bị động '被'送進了醫院 (được đưa vào viện).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 2: Chọn từ thích hợp nhất điền vào chỗ trống [2].",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'陪'張太太 (đi cùng vợ).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 3: Chọn từ thích hợp nhất điền vào chỗ trống [3].",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'當'爸爸 (làm cha).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 4: Chọn từ thích hợp nhất điền vào chỗ trống [4].",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'為'這個孩子 (nghĩ tên 'cho' con).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 5: Chọn từ thích hợp nhất điền vào chỗ trống [5].",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'希望' (hy vọng sau này vừa đẹp vừa vui).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 6: Chọn từ thích hợp nhất điền vào chỗ trống [6].",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Cụm cố định '大學時代' (thời đại học).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 7: Chọn từ thích hợp nhất điền vào chỗ trống [7].",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp.",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 8: Chọn từ thích hợp nhất điền vào chỗ trống [8].",
        "options": [
          "忽然",
          "總是",
          "隨時",
          "從來"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'忽然'想起 (đột nhiên nhớ lại).",
        "pinyin": ""
      },
      {
        "id": 34,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 9: Chọn từ thích hợp nhất điền vào chỗ trống [9].",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'照'著地址 (lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 10: Chọn từ thích hợp nhất điền vào chỗ trống [10].",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp lại).",
        "pinyin": ""
      },
      {
        "id": 36,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 11: Chọn từ thích hợp nhất điền vào chỗ trống [11].",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'安排'戶外活動 (sắp xếp thời gian vận động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 37,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 12: Chọn từ thích hợp nhất điền vào chỗ trống [12].",
        "options": [
          "影響",
          "阻礙",
          "促進",
          "代替"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'促進'吸收 (thúc đẩy hấp thụ vitamin D).",
        "pinyin": ""
      },
      {
        "id": 38,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 13: Chọn từ thích hợp nhất điền vào chỗ trống [13].",
        "options": [
          "常常",
          "總是",
          "不斷",
          "難免"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'總是'在室內看螢幕 (luôn ở trong phòng xem màn hình).",
        "pinyin": ""
      },
      {
        "id": 39,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 14: Chọn từ thích hợp nhất điền vào chỗ trống [14].",
        "options": [
          "維護",
          "修理",
          "整理",
          "保證"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'維護'視力健康 (bảo vệ / duy trì sức khỏe thị lực).",
        "pinyin": ""
      },
      {
        "id": 40,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 15: Chọn từ thích hợp nhất điền vào chỗ trống [15].",
        "options": [
          "不能",
          "不要",
          "不可",
          "不必"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'不可'輕視 (tuyệt đối không được xem nhẹ).",
        "pinyin": ""
      },
      {
        "id": 41,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "dialogueSegments": [],
        "q": "Câu 16: 下面哪一個敘述完全符合短文內容？",
        "options": [
          "小明已經造訪韓國兩次了",
          "小明在韓國住了四個晚上",
          "小明覺得韓國食物不合胃口",
          "小明打算去日本留學"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết rõ: '玩了五天四夜' nghĩa là ở lại 4 đêm (四個晚上).",
        "pinyin": ""
      },
      {
        "id": 42,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 面對孩子成長的母親\n孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "dialogueSegments": [],
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，採取什麼態度？",
        "options": [
          "嚴厲責備孩子的膽怯",
          "答應明天親自開車接送",
          "鼓勵孩子勇敢獨立面對",
          "感到不知所措而焦慮"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ khuyến khích: '你要學會自己面對挑戰' (động viên con dũng cảm tự đối diện).",
        "pinyin": ""
      },
      {
        "id": 43,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北夜市行動支付普及化\n以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "audio": "",
        "dialogue": "以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "dialogueSegments": [],
        "q": "Câu 18: 夜市引入行動支付帶來哪一項核心效益？",
        "options": [
          "大幅降低商品售價",
          "結帳更快速並兼顧衛生",
          "夜市營業時間延長至白天",
          "所有攤商免繳營業稅"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Văn bản nêu: '減少了排隊找零的時間, 也大幅降低了衛生疑慮' (thanh toán nhanh hơn và vệ sinh hơn).",
        "pinyin": ""
      },
      {
        "id": 44,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 捷運站二手書漂書箱與愛心傘\n台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "audio": "",
        "dialogue": "台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "dialogueSegments": [],
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪項優勢？",
        "options": [
          "列車行駛速度領先全球",
          "兼具人情味與信任的便民服務",
          "站內車廂提供免費餐飲",
          "票價比其他交通工具便宜"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Tác giả ngợi ca: '兼具人情味與信任的便民服務' (dịch vụ tiện dân ấm áp tình người dựa trên sự tin tưởng).",
        "pinyin": ""
      },
      {
        "id": 45,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北市垃圾費隨袋徵收政策成效\n台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "audio": "",
        "dialogue": "台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "dialogueSegments": [],
        "q": "Câu 20: 『垃圾費隨袋徵收』政策為何能有效減少垃圾量？",
        "options": [
          "市民為了省買垃圾袋的錢而努力做資源回收",
          "規定每戶每週最多只能丟一包垃圾",
          "禁止市民在超市購買塑膠袋包裝的食品",
          "提高亂丟垃圾的罰款金額十倍以上"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Vì rác tái chế miễn phí còn rác thường tốn tiền mua túi, người dân tích cực phân loại để tiết kiệm chi phí mua túi rác.",
        "pinyin": ""
      },
      {
        "id": 46,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 高鐵串連台灣南北一日生活圈\n自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "audio": "",
        "dialogue": "自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "dialogueSegments": [],
        "q": "Câu 21: 『一日生活圈』對人們生活產生的實質改變是什麼？",
        "options": [
          "商務出差不必再在外地過夜",
          "民眾紛紛將戶籍遷往南部",
          "高鐵票價全面降至台鐵水準",
          "飛機成為國內最受歡迎的航線"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn nêu buổi sáng họp Đài Bắc, chiều tới Nam Bộ, tối về lại nhà (đi lại trong ngày không cần ở qua đêm).",
        "pinyin": ""
      },
      {
        "id": 47,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣全民健保雲端醫療資訊系統\n台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "audio": "",
        "dialogue": "台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "dialogueSegments": [],
        "q": "Câu 22: 健保雲端資訊系統的主要優勢是什麼？",
        "options": [
          "自動為病患減免掛號費用",
          "跨院即時查詢用藥紀錄避免重複開藥",
          "病患可在家自行線上開刀治療",
          "直接向國外藥廠訂購廉價藥品"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đoạn văn nêu rõ: '即時調閱檢查報告及用藥紀錄, 有效防範了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 48,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 誠品書店二十四小時營運的文化底蘊\n誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "dialogueSegments": [],
        "q": "Câu 23: 誠品書店之所以被譽為深夜文化地標，是因為什麼？",
        "options": [
          "深夜購書享有半價折扣",
          "結合文創美學將閱讀轉化為生活哲學",
          "只允許專業作家進入借閱圖書",
          "是台北市唯一的實體書店"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả chỉ rõ: '將單純的購書行為昇華為一種優雅慢活的生活哲學'.",
        "pinyin": ""
      },
      {
        "id": 49,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 美食外送平台對都會生活型態的衝擊\n隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "audio": "",
        "dialogue": "隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "dialogueSegments": [],
        "q": "Câu 24: 作者對於美食外送服務的蓬勃發展抱持何種看法？",
        "options": [
          "認為便利之餘亦伴隨交通與環保等社會隱憂",
          "強烈主張政府應立法全面禁止外送App",
          "認為外送餐點品質大幅超越店內現煮",
          "覺得外送員的薪資過高不合理"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả chỉ rõ: '伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題, 亟需深入探討' (tiện lợi nhưng tiềm ẩn nguy cơ giao thông và môi trường).",
        "pinyin": ""
      },
      {
        "id": 50,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 傳統菜市場的人情溫度與文化生命力\n儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "dialogueSegments": [],
        "q": "Câu 25: 傳統市場至今依然深受廣大民眾喜愛的核心魅力何在？",
        "options": [
          "冷氣空調比超市更強大涼爽",
          "濃厚的街坊人情味與客製化的人際互動",
          "所有生鮮蔬果皆由國外高價空運進口",
          "營業時間全天二十四小時不中斷"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả nhấn mạnh: '充滿街坊問候的人情溫度與鮮活的在地風土' (tình người nồng hậu và giao tiếp tương tác thân tình).",
        "pinyin": ""
      }
    ]
  },
  {
    "id": "mock_b2",
    "title": "TOCFL Band B - Đề thi Chuẩn 2 (Official Mock 2)",
    "band": "Band B (高階·流利)",
    "badge": "Chuẩn SC-TOP CAT",
    "duration": 60,
    "totalQ": 50,
    "desc": "Bộ đề thi thử số 2 tập trung phản xạ ngôn ngữ thực tế, tình huống công sở, giao thông, nhà trọ và y tế Đài Loan.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "現在天氣真好，吃完午餐一起出去走走吧！ 下午可能下大雨，還是待在家吧。 今天天氣怎麼樣？",
        "dialogue": "男：現在天氣真好，吃完午餐一起出去走走吧！\n女：下午可能下大雨，還是待在家吧。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "現在天氣真好，吃完午餐一起出去走走吧！"
          },
          {
            "speaker": "female",
            "text": "下午可能下大雨，還是待在家吧。"
          },
          {
            "speaker": "male",
            "text": "今天天氣怎麼樣？"
          }
        ],
        "q": "今天天氣怎麼樣？",
        "options": [
          "白天都是晴天",
          "沒有什麼變化",
          "下午天氣會改變",
          "從早到晚一直下雨"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 下午天氣會改變. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "這本書你看完了吧，覺得怎麼樣？ 我真想問問寫書的人，到底想寫什麼，我怎麼看都看不懂！ 這位小姐覺得這本書怎麼樣？",
        "dialogue": "男：這本書你看完了吧，覺得怎麼樣？\n女：我真想問問寫書的人，到底想寫什麼，我怎麼看都看不懂！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "這本書你看完了吧，覺得怎麼樣？"
          },
          {
            "speaker": "female",
            "text": "我真想問問寫書的人，到底想寫什麼，我怎麼看都看不懂！"
          },
          {
            "speaker": "male",
            "text": "這位小姐覺得這本書怎麼樣？"
          }
        ],
        "q": "這位小姐覺得這本書怎麼樣？",
        "options": [
          "很生動",
          "很豐富",
          "很有趣",
          "很難懂"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 很難懂. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "美美今天早上和我說她頭疼得不得了。 她有點兒發燒，不知道是不是感冒了？我等會兒帶她去看病。 這位小姐的意思是什麼？",
        "dialogue": "男：美美今天早上和我說她頭疼得不得了。\n女：她有點兒發燒，不知道是不是感冒了？我等會兒帶她去看病。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "美美今天早上和我說她頭疼得不得了。"
          },
          {
            "speaker": "female",
            "text": "她有點兒發燒，不知道是不是感冒了？我等會兒帶她去看病。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她會陪美美去醫院",
          "她不知道美美生病了",
          "美美剛剛去過醫院了",
          "美美已經感冒一段時間了"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她會陪美美去醫院. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小張怎麼還沒來上班？ 我打個電話問問他吧！ 這位小姐的意思是什麼？",
        "dialogue": "男：小張怎麼還沒來上班？\n女：我打個電話問問他吧！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小張怎麼還沒來上班？"
          },
          {
            "speaker": "female",
            "text": "我打個電話問問他吧！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "小張今天請假了",
          "她也不知道原因",
          "她剛剛打給小張了",
          "小張應該打電話給她"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她也不知道原因. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "啊，該吃藥了。 不行，你飯都還沒吃呢。醫生不是要你吃完飯以後三十分鐘，再吃嗎？ 這位小姐的意思是什麼？",
        "dialogue": "男：啊，該吃藥了。\n女：不行，你飯都還沒吃呢。醫生不是要你吃完飯以後三十分鐘，再吃嗎？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "啊，該吃藥了。"
          },
          {
            "speaker": "female",
            "text": "不行，你飯都還沒吃呢。醫生不是要你吃完飯以後三十分鐘，再吃嗎？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "先吃飯，再吃藥",
          "吃飯前，先吃藥",
          "沒吃藥，不可以吃飯",
          "沒吃飯，也可以吃藥"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 先吃飯，再吃藥. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "這件衣服又便宜又特別。 要是再大一點就更好了！ 這位小姐的意思是什麼？",
        "dialogue": "男：這件衣服又便宜又特別。\n女：要是再大一點就更好了！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "這件衣服又便宜又特別。"
          },
          {
            "speaker": "female",
            "text": "要是再大一點就更好了！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "衣服大小剛好",
          "她有些不滿意",
          "價錢有一點貴",
          "設計不夠特別"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她有些不滿意. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "你決定新桌子的顏色了嗎？我想等一下就去買。 這件事沒那麼急，等我不忙的時候再說吧。 這位小姐什麼時候做決定？",
        "dialogue": "男：你決定新桌子的顏色了嗎？我想等一下就去買。\n女：這件事沒那麼急，等我不忙的時候再說吧。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "你決定新桌子的顏色了嗎？我想等一下就去買。"
          },
          {
            "speaker": "female",
            "text": "這件事沒那麼急，等我不忙的時候再說吧。"
          },
          {
            "speaker": "male",
            "text": "這位小姐什麼時候做決定？"
          }
        ],
        "q": "這位小姐什麼時候做決定？",
        "options": [
          "她現在就要決定",
          "她等一下就會決定",
          "她有空的時候再決定",
          "她要這位先生自己決定"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她有空的時候再決定. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "媽媽為什麼這麼生氣？ 誰知道！問她什麼話都不說。 這位小姐的意思是什麼？",
        "dialogue": "男：媽媽為什麼這麼生氣？\n女：誰知道！問她什麼話都不說。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "媽媽為什麼這麼生氣？"
          },
          {
            "speaker": "female",
            "text": "誰知道！問她什麼話都不說。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "媽媽很容易生氣",
          "他們讓媽媽生氣了",
          "沒人了解媽媽生氣的原因",
          "她不想知道媽媽為什麼生氣"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 沒人了解媽媽生氣的原因. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "張小姐呢？我好幾天沒看見她了。 難道你不知道她到美國去了？ 這段對話的意思是什麼？",
        "dialogue": "男：張小姐呢？我好幾天沒看見她了。\n女：難道你不知道她到美國去了？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "張小姐呢？我好幾天沒看見她了。"
          },
          {
            "speaker": "female",
            "text": "難道你不知道她到美國去了？"
          },
          {
            "speaker": "male",
            "text": "這段對話的意思是什麼？"
          }
        ],
        "q": "這段對話的意思是什麼？",
        "options": [
          "張小姐出國了",
          "張小姐剛從美國回來",
          "沒人知道張小姐去哪兒",
          "沒人清楚張小姐這個人"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 張小姐出國了. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "週末是我們結婚滿四年的紀念日，我們就帶小寶到第一次約會的餐廳吧！ 這樣多沒意思啊！不如明天給媽媽打個電話，拜託她照顧小寶一天，我們倆 外出吃飯、看電影，放鬆一下。 這位太太希望怎麼慶祝？",
        "dialogue": "男：週末是我們結婚滿四年的紀念日，我們就帶小寶到第一次約會的餐廳吧！\n女：這樣多沒意思啊！不如明天給媽媽打個電話，拜託她照顧小寶一天，我們倆\n外出吃飯、看電影，放鬆一下。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "週末是我們結婚滿四年的紀念日，我們就帶小寶到第一次約會的餐廳吧！"
          },
          {
            "speaker": "female",
            "text": "這樣多沒意思啊！不如明天給媽媽打個電話，拜託她照顧小寶一天，我們倆"
          },
          {
            "speaker": "narrator",
            "text": "外出吃飯、看電影，放鬆一下。"
          },
          {
            "speaker": "male",
            "text": "這位太太希望怎麼慶祝？"
          }
        ],
        "q": "這位太太希望怎麼慶祝？",
        "options": [
          "夫妻倆自己出門",
          "帶著家人看電影",
          "帶孩子到餐廳吃飯",
          "打電話約媽媽一同慶祝"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 夫妻倆自己出門. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "咦，你怎麼全買牛奶啊？家裡不是還有？ 嗯，今天牛奶很便宜，買三瓶送兩瓶。 那青菜水果呢？我們不是說好要買些青菜水果的… 啊，我忘了。 這位小姐為什麼去買東西？",
        "dialogue": "男：咦，你怎麼全買牛奶啊？家裡不是還有？\n女：嗯，今天牛奶很便宜，買三瓶送兩瓶。\n男：那青菜水果呢？我們不是說好要買些青菜水果的…\n女：啊，我忘了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "咦，你怎麼全買牛奶啊？家裡不是還有？"
          },
          {
            "speaker": "female",
            "text": "嗯，今天牛奶很便宜，買三瓶送兩瓶。"
          },
          {
            "speaker": "male",
            "text": "那青菜水果呢？我們不是說好要買些青菜水果的…"
          },
          {
            "speaker": "female",
            "text": "啊，我忘了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐為什麼去買東西？"
          }
        ],
        "q": "這位小姐為什麼去買東西？",
        "options": [
          "家裡已經沒牛奶了",
          "她要買青菜和水果",
          "今天牛奶比較便宜",
          "今天買青菜就送水果"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她要買青菜和水果. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "這星期六我想請你吃飯，你有空嗎？ 嗯，星期六不太方便，您不用麻煩了。 不行！我一定得請你吃飯，謝謝你幫我搬家。 您真是太客氣了，那只是小事一件。 這位小姐的意思是什麼?",
        "dialogue": "男：這星期六我想請你吃飯，你有空嗎？\n女：嗯，星期六不太方便，您不用麻煩了。\n男：不行！我一定得請你吃飯，謝謝你幫我搬家。\n女：您真是太客氣了，那只是小事一件。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "這星期六我想請你吃飯，你有空嗎？"
          },
          {
            "speaker": "female",
            "text": "嗯，星期六不太方便，您不用麻煩了。"
          },
          {
            "speaker": "male",
            "text": "不行！我一定得請你吃飯，謝謝你幫我搬家。"
          },
          {
            "speaker": "female",
            "text": "您真是太客氣了，那只是小事一件。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼?"
          }
        ],
        "q": "這位小姐的意思是什麼?",
        "options": [
          "請客只是一件小事",
          "她有空就幫忙搬家",
          "她星期六不方便搬家",
          "這位先生不必請她吃飯"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位先生不必請她吃飯. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小美，這個禮拜天你有空嗎？ 我得在家寫功課。有什麼事嗎？ 那天是我的生日，我想約你一起去看電影。 當然沒問題啊！你的生日比任何事都重要。 這位小姐的意思是什麼？",
        "dialogue": "男：小美，這個禮拜天你有空嗎？\n女：我得在家寫功課。有什麼事嗎？\n男：那天是我的生日，我想約你一起去看電影。\n女：當然沒問題啊！你的生日比任何事都重要。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小美，這個禮拜天你有空嗎？"
          },
          {
            "speaker": "female",
            "text": "我得在家寫功課。有什麼事嗎？"
          },
          {
            "speaker": "male",
            "text": "那天是我的生日，我想約你一起去看電影。"
          },
          {
            "speaker": "female",
            "text": "當然沒問題啊！你的生日比任何事都重要。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她得寫完功課才能看電影",
          "她想看電影，可是功課更重要",
          "她答應和這位先生一起看電影",
          "除了功課，最重要的事就是看電影"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她答應和這位先生一起看電影. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "你在看什麼啊？ 喔，是一位客人寄來的信，他說非常感謝我們對他的照顧。 這麼客氣，信裡還說些什麼呢？ 他說我們的服務很好，住在這裡，感覺就像是住在自己的家裡。 這位小姐在哪裡工作？",
        "dialogue": "男：你在看什麼啊？\n女：喔，是一位客人寄來的信，他說非常感謝我們對他的照顧。\n男：這麼客氣，信裡還說些什麼呢？\n女：他說我們的服務很好，住在這裡，感覺就像是住在自己的家裡。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "你在看什麼啊？"
          },
          {
            "speaker": "female",
            "text": "喔，是一位客人寄來的信，他說非常感謝我們對他的照顧。"
          },
          {
            "speaker": "male",
            "text": "這麼客氣，信裡還說些什麼呢？"
          },
          {
            "speaker": "female",
            "text": "他說我們的服務很好，住在這裡，感覺就像是住在自己的家裡。"
          },
          {
            "speaker": "male",
            "text": "這位小姐在哪裡工作？"
          }
        ],
        "q": "這位小姐在哪裡工作？",
        "options": [
          "餐廳",
          "郵局",
          "旅館",
          "飛機上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 旅館. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小雪，我在這兒！ 啊！小林，不好意思，我來晚了！ 沒關係，坐吧，想喝什麼？我請你。 謝謝你！就來一杯和你一樣的吧！。 這位小姐的意思是什麼?",
        "dialogue": "男：小雪，我在這兒！\n女：啊！小林，不好意思，我來晚了！\n男：沒關係，坐吧，想喝什麼？我請你。\n女：謝謝你！就來一杯和你一樣的吧！。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小雪，我在這兒！"
          },
          {
            "speaker": "female",
            "text": "啊！小林，不好意思，我來晚了！"
          },
          {
            "speaker": "male",
            "text": "沒關係，坐吧，想喝什麼？我請你。"
          },
          {
            "speaker": "female",
            "text": "謝謝你！就來一杯和你一樣的吧！。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼?"
          }
        ],
        "q": "這位小姐的意思是什麼?",
        "options": [
          "她要小林陪她喝飲料",
          "她要小林喝一點飲料",
          "她不好意思讓小林請客",
          "她點跟小林一樣的飲料"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她點跟小林一樣的飲料. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "你覺得這個碗怎麼樣，很漂亮吧。 還可以，你看看旁邊這個杯子，怎麼樣？ 我還是比較喜歡這個碗。 那麼我們就各買各的吧！ 這位小姐的意思是什麼？",
        "dialogue": "男：你覺得這個碗怎麼樣，很漂亮吧。\n女：還可以，你看看旁邊這個杯子，怎麼樣？\n男：我還是比較喜歡這個碗。\n女：那麼我們就各買各的吧！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "你覺得這個碗怎麼樣，很漂亮吧。"
          },
          {
            "speaker": "female",
            "text": "還可以，你看看旁邊這個杯子，怎麼樣？"
          },
          {
            "speaker": "male",
            "text": "我還是比較喜歡這個碗。"
          },
          {
            "speaker": "female",
            "text": "那麼我們就各買各的吧！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "杯子和碗她都想買",
          "喜歡什麼就買什麼",
          "她同意這位男生說的話",
          "杯子和碗只能選擇一個"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 喜歡什麼就買什麼. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我這個週末想到東部走走。 怎麼去？搭火車還是開車呢？ 我打算搭火車。不過，我才剛搬來這裡，連火車站在哪都不知道。 這樣吧，我明天上午正好有事要到車站附近，我載你去。 這位小姐的意思是什麼?",
        "dialogue": "男：我這個週末想到東部走走。\n女：怎麼去？搭火車還是開車呢？\n男：我打算搭火車。不過，我才剛搬來這裡，連火車站在哪都不知道。\n女：這樣吧，我明天上午正好有事要到車站附近，我載你去。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我這個週末想到東部走走。"
          },
          {
            "speaker": "female",
            "text": "怎麼去？搭火車還是開車呢？"
          },
          {
            "speaker": "male",
            "text": "我打算搭火車。不過，我才剛搬來這裡，連火車站在哪都不知道。"
          },
          {
            "speaker": "female",
            "text": "這樣吧，我明天上午正好有事要到車站附近，我載你去。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼?"
          }
        ],
        "q": "這位小姐的意思是什麼?",
        "options": [
          "她也要搭火車到東部",
          "這位先生可以搭她的車",
          "她想載這位先生一起到東部去",
          "她想告訴這位先生怎麼去車站"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 這位先生可以搭她的車. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "你家裡缺不缺鍋子？ 怎麼了？要送我啊？ 我女朋友走了以後，沒人做飯給我吃，家裡那些鍋子，用不著了。 謝謝你的好意。我家裡什麼都缺，就是不缺鍋子。 這位小姐的意思是什麼?",
        "dialogue": "男：你家裡缺不缺鍋子？\n女：怎麼了？要送我啊？\n男：我女朋友走了以後，沒人做飯給我吃，家裡那些鍋子，用不著了。\n女：謝謝你的好意。我家裡什麼都缺，就是不缺鍋子。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "你家裡缺不缺鍋子？"
          },
          {
            "speaker": "female",
            "text": "怎麼了？要送我啊？"
          },
          {
            "speaker": "male",
            "text": "我女朋友走了以後，沒人做飯給我吃，家裡那些鍋子，用不著了。"
          },
          {
            "speaker": "female",
            "text": "謝謝你的好意。我家裡什麼都缺，就是不缺鍋子。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼?"
          }
        ],
        "q": "這位小姐的意思是什麼?",
        "options": [
          "她目前不需要鍋子",
          "她最近正好缺了鍋子",
          "她喜歡自己買的鍋子",
          "她正想送鍋子給這位先生"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她目前不需要鍋子. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "玲玲，恭喜我吧！從下星期一開始，我們就是同事了。 你什麼時候到我們公司參加面試的，我怎麼不知道？ 我誰也沒說，就怕說了卻沒錄取，那可就難看了。 你真是愛面子，歡迎你加入我們的行列。 這位先生怎麼了?",
        "dialogue": "男：玲玲，恭喜我吧！從下星期一開始，我們就是同事了。\n女：你什麼時候到我們公司參加面試的，我怎麼不知道？\n男：我誰也沒說，就怕說了卻沒錄取，那可就難看了。\n女：你真是愛面子，歡迎你加入我們的行列。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "玲玲，恭喜我吧！從下星期一開始，我們就是同事了。"
          },
          {
            "speaker": "female",
            "text": "你什麼時候到我們公司參加面試的，我怎麼不知道？"
          },
          {
            "speaker": "male",
            "text": "我誰也沒說，就怕說了卻沒錄取，那可就難看了。"
          },
          {
            "speaker": "female",
            "text": "你真是愛面子，歡迎你加入我們的行列。"
          },
          {
            "speaker": "male",
            "text": "這位先生怎麼了?"
          }
        ],
        "q": "這位先生怎麼了?",
        "options": [
          "他還沒找到工作",
          "他下星期要參加面試",
          "他只和玲玲說找工作的事",
          "他將和玲玲在同一家公司上班"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他將和玲玲在同一家公司上班. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "看你手上提著這麼多東西，連開門都需要人幫忙，你中大獎嗎？ 沒這回事。今天百貨公司打折，我去搶便宜，省了不少呢！ 就算是這樣，東西也多得太誇張了，是不是有朋友請你幫忙買？ 這些都是我的，我可是做足了功課才買的。要是錯過這次，那才叫損失。 從這段話，我們知道這位小姐什麼事？ 下面是同事之間的對話，請聽完對話後，回答兩個問題。 小雪，宣傳單、海報做好了嗎？ 什麼活動？ 慢跑活動啊！你看看白板，我還在上頭標記這件事很重要！ 糟糕！老闆，對不起，我真忘了。 你究竟記得哪件事啊！這件事來不及處理好的話，你就不用來了。 我馬上找老王、小陳來支援。 21. 小雪忘了哪件事？ 22. 最後，這位老闆的意思是什麼？ 下面是兩位朋友的對話，請聽完對話後，回答兩個問題。 真煩！最近什麼都不能吃，連奶粉都有問題。 我只聽說牛肉、雞肉有問題，怎麼連奶粉也出問題了？ 你還不知道啊！昨晚新聞說有幾家國內知名廠商的奶粉，在加工過程中偷偷 加入了會傷害人體健康的化學品。 這也太誇張了吧！奶粉不是從鮮奶直接加工來的嗎？為什麼還要加化學品 呢？ 據說可以降低製作成本，所以就有不良廠商這麼做。 那我得趕緊看看剛買的嬰兒奶粉是不是有問題的商家製造的。 23. 這位先生為什麼覺得煩？ 24. 從對話中可以知道什麼事？ 下面是一段朋友的對話，請聽完對話後，回答三個問題： 25. 根據對話，阿光怎麼了？ 26. 根據對話，阿光母親的態度怎麼樣？ 27. 小美對阿光說的事有什麼看法？ 現在請聽對話。 小美，我昨天和我媽說我想學做蛋糕，結果她聽完後竟然連話也不和我說。 為什麼？ 我媽媽對我的學業成績要求很高，她認為念書才是最重要的，根本不准我去 做其他事。 阿光，你的功課很好，每學期都拿獎學金，讀書對你來說應該不是問題。如 果你可以讓伯母覺得，就算你撥出一點時間來學做蛋糕，也不會影響你的課 業成績，這樣的話，伯母可能會妥協，你試試再和伯母溝通吧！ 下面是艾維和一位女同事的對話，請聽完對話後，回答三個問題： 28. 他們在討論哪方面的事？ 29. 根據對話，為什麼新生兒的父母要請客和送禮？ 30. 最後，艾維對這位小姐說的話有什麼看法？ 現在請聽對話。 艾維，你在做什麼啊？這麼專心。 我太太就快生了，最近收了很多紅包，讓我覺得很不好意思。所以我就用這 些錢買了寶寶用的東西，正準備寫成單子給大家看。 這樣啊！同事們給紅包應該不是想看這個禮物單子，他們只是希望給你們祝 福而已。這禮物單子可以免了，不過滿月酒啊、滿月禮之類的可不能少喔。 你指的是請大家吃飯、喝酒嗎？這倒沒問題。 事情可沒這麼簡單。對華人來說，在小孩出生後滿一個月的那一天，小孩的 爸媽會邀請親朋好友一起吃飯，慶祝媽媽安全生產，也會讓小孩和大家見面， 除了親自感謝大家的關心，還會準備一份滿月禮送給親朋好友。 天啊！又吃飯又送禮，可不可以只分享禮物單子啊？ 第二部分 段落 請聽這一段話，然後回答下面的兩個問題。 我家附近靠河邊的地方，原本是一片空地，那裡有非常多的樹木、花草，還 有很多人在那裡散步、騎腳踏車。有段時間，大家聽說這片空地要賣給建設公司， 變成辦公大樓。不過，在大家的爭取下，這片空地現在成了公園，讓住在這附近 的人有地方運動，這真是一件讓人開心的事。 31. 從這段話可以知道，說話的人住家附近有什麼？ 32. 說話的人因為哪一件事覺得很開心？ 請聽這段話，然後回答下面的兩個問題。 很多人想把小孩送到國外學習外國語，認為學習語言就應該到當地學習，但 是這樣就一定能把語言學好嗎？很多孩子到了當地，連話都不敢說，也交不到當 地的朋友，到最後還是只和自己國家的人走在一起，這樣出國不出國有什麼不 同！ 33. 說話的人認為孩子到國外念書會遇到什麼問題？ 34. 說話的人認為出國讀書怎麼樣？ 請聽這一段電話錄音，然後回答下面的兩個問題。 您好，我是小美，這幾天我有事出去，大概下週回來，不管您是要買花、請 我幫您種花，還是想來店裡喝一杯花茶，請先留下聯絡方式，我會再和您確認。 35. 小美希望打電話來的人，告訴她什麼事？ 36. 小美的工作是什麼？ 請聽這一段話，然後回答下面的兩個問題。 我媽媽很忙，她是電腦公司的老闆，所以每天都有做不完的工作。不過，她 從來不會忘記幫我們準備飯菜，冰箱裡總是有水果和點心，生日的時候一定有禮 物。只是，平常她總在公司工作到很晚，放了假在家裡，她還是在工作，我和她 聊天的機會不太多，真希望她不要這麼忙，能多陪我就好了！ 37. 關於這位媽媽的敘述，下面哪一個是對的？ 38. 說話的人想要什麼？ 請聽這一段話，然後回答下面的兩個問題。 李小姐，你好。我姓陳，是這間辦公室的主任。歡迎來我們公司工作！我們 辦公室就這麼大，一進來，右手邊有一間小廚房，可以煮咖啡喝，還有冰箱可以 使用，廚房的旁邊是洗手間。我的位子在窗戶旁邊，你如果有事可以隨時來找我。 39. 這段話主要在說什麼？ 40. 陳主任提到了辦公室裡有什麼？ 請聽這一段電腦購票系統的語音指示，然後回答下面的兩個問題。 您好，歡迎使用語音購票系統 請注意，本系統只接受信用卡購票 請輸入乘車日期，如7 月4 號，請輸入0704 請輸入訂票車次，如1097 車次，請按1097＃ 請選擇訂票張數。一張請按1 請注意，一人最多訂四張 螢幕顯示您的訂票資訊…確定請按1，取消請按2 請輸入信用卡卡號… 購票完成，請拿票，謝謝。 41. 用這套系統訂票，要提供哪些資料？ 42. 用這套系統訂車票，要注意什麼事？ 請聽這一段話，然後回答下面的兩個問題。 早上家裡的電話響個不停，一直沒人接，我只好起床接電話，原來是媽媽打 來的。因為今天有客人到家裡來，所以她一早就出門買菜了。她問我客人來了沒 有？要我把客廳整理乾淨，我告訴她，客人來了我會招待，請她不要擔心。 43. 媽媽為什麼打電話回家？ 44. 說話的人告訴媽媽什麼? 請聽一則和公共政策有關的報導，然後回答下面三個問題： 45. 根據報導，政府推動這項新政策主要是為了什麼？ 46. 報導中提到民眾對這項新政策的反應怎麼樣？ 47. 下面哪件事符合這項新政策的概念？ 現在請聽報導。 近年來，民眾越來越重視休閒生活，許多人都利用週末假期到戶外活動。但 是，快速增加的旅遊人潮不僅在旅遊景點造成了交通問題，也給當地帶來了廢氣 和噪音。因此，政府不久前開始積極推動「低碳旅遊」。實際的作法像是搭乘巴 士或火車到達較遠的景點，再利用腳踏車或步行的方式，完成短距離的移動。 低碳旅遊的觀念已經逐漸被民眾接受，最近更擴大到其他方面。除了交通， 也包括了旅行時自己準備餐具，住旅館時不使用旅館提供的一次性用品，或是只 食用當地、當季的飲食，以及不把垃圾留在旅遊地等等。目前許多旅遊業者正共 同推動低碳旅遊，只要消費者符合低碳旅遊的條件，旅遊業者就提供他們折扣。 請聽一則有關《大英百科全書》的報導，然後回答下面三個問題： 48. 《大英百科全書》銷售量下滑的主要原因是什麼？ 49. 《大英百科全書》的轉機是什麼？ 50. 報導最後用豪華轎車來說明什麼？ 現在請聽報導。 《大英百科全書》在1768 年出版，雖然價格昂貴，仍維持極高的市場佔有 率。但是隨著時代的轉變和科技的創新，改變了這部百科全書的命運，銷售金額 不但下滑了一半，甚至，一度被埋沒在資訊革命的潮流裡，直到1996 年瑞士商 人買下之後，才出現轉機，成為以線上資料庫為主的公司。 《大英百科全書》所面臨的銷售問題，還有另一深層的意義，以前，擁有一 套百科全書就好像擁有一部豪華轎車一樣，是財富與地位的象徵，但現在隨著獲 得知識的方法改變，人們也不再以擁有一套百科全書來作為展示自我的方式了。",
        "dialogue": "男：看你手上提著這麼多東西，連開門都需要人幫忙，你中大獎嗎？\n女：沒這回事。今天百貨公司打折，我去搶便宜，省了不少呢！\n男：就算是這樣，東西也多得太誇張了，是不是有朋友請你幫忙買？\n女：這些都是我的，我可是做足了功課才買的。要是錯過這次，那才叫損失。\n男：從這段話，我們知道這位小姐什麼事？\n下面是同事之間的對話，請聽完對話後，回答兩個問題。\n男：小雪，宣傳單、海報做好了嗎？\n女：什麼活動？\n男：慢跑活動啊！你看看白板，我還在上頭標記這件事很重要！\n女：糟糕！老闆，對不起，我真忘了。\n男：你究竟記得哪件事啊！這件事來不及處理好的話，你就不用來了。\n女：我馬上找老王、小陳來支援。\n21. 小雪忘了哪件事？\n22. 最後，這位老闆的意思是什麼？\n下面是兩位朋友的對話，請聽完對話後，回答兩個問題。\n男：真煩！最近什麼都不能吃，連奶粉都有問題。\n女：我只聽說牛肉、雞肉有問題，怎麼連奶粉也出問題了？\n男：你還不知道啊！昨晚新聞說有幾家國內知名廠商的奶粉，在加工過程中偷偷\n加入了會傷害人體健康的化學品。\n女：這也太誇張了吧！奶粉不是從鮮奶直接加工來的嗎？為什麼還要加化學品\n呢？\n男：據說可以降低製作成本，所以就有不良廠商這麼做。\n女：那我得趕緊看看剛買的嬰兒奶粉是不是有問題的商家製造的。\n23. 這位先生為什麼覺得煩？\n24. 從對話中可以知道什麼事？\n下面是一段朋友的對話，請聽完對話後，回答三個問題：\n25. 根據對話，阿光怎麼了？\n26. 根據對話，阿光母親的態度怎麼樣？\n27. 小美對阿光說的事有什麼看法？\n現在請聽對話。\n男：小美，我昨天和我媽說我想學做蛋糕，結果她聽完後竟然連話也不和我說。\n女：為什麼？\n男：我媽媽對我的學業成績要求很高，她認為念書才是最重要的，根本不准我去\n做其他事。\n女：阿光，你的功課很好，每學期都拿獎學金，讀書對你來說應該不是問題。如\n果你可以讓伯母覺得，就算你撥出一點時間來學做蛋糕，也不會影響你的課\n業成績，這樣的話，伯母可能會妥協，你試試再和伯母溝通吧！\n下面是艾維和一位女同事的對話，請聽完對話後，回答三個問題：\n28. 他們在討論哪方面的事？\n29. 根據對話，為什麼新生兒的父母要請客和送禮？\n30. 最後，艾維對這位小姐說的話有什麼看法？\n現在請聽對話。\n女：艾維，你在做什麼啊？這麼專心。\n男：我太太就快生了，最近收了很多紅包，讓我覺得很不好意思。所以我就用這\n些錢買了寶寶用的東西，正準備寫成單子給大家看。\n女：這樣啊！同事們給紅包應該不是想看這個禮物單子，他們只是希望給你們祝\n福而已。這禮物單子可以免了，不過滿月酒啊、滿月禮之類的可不能少喔。\n男：你指的是請大家吃飯、喝酒嗎？這倒沒問題。\n女：事情可沒這麼簡單。對華人來說，在小孩出生後滿一個月的那一天，小孩的\n爸媽會邀請親朋好友一起吃飯，慶祝媽媽安全生產，也會讓小孩和大家見面，\n除了親自感謝大家的關心，還會準備一份滿月禮送給親朋好友。\n男：天啊！又吃飯又送禮，可不可以只分享禮物單子啊？\n第二部分 段落\n請聽這一段話，然後回答下面的兩個問題。\n我家附近靠河邊的地方，原本是一片空地，那裡有非常多的樹木、花草，還\n有很多人在那裡散步、騎腳踏車。有段時間，大家聽說這片空地要賣給建設公司，\n變成辦公大樓。不過，在大家的爭取下，這片空地現在成了公園，讓住在這附近\n的人有地方運動，這真是一件讓人開心的事。\n31. 從這段話可以知道，說話的人住家附近有什麼？\n32. 說話的人因為哪一件事覺得很開心？\n請聽這段話，然後回答下面的兩個問題。\n很多人想把小孩送到國外學習外國語，認為學習語言就應該到當地學習，但\n是這樣就一定能把語言學好嗎？很多孩子到了當地，連話都不敢說，也交不到當\n地的朋友，到最後還是只和自己國家的人走在一起，這樣出國不出國有什麼不\n同！\n33. 說話的人認為孩子到國外念書會遇到什麼問題？\n34. 說話的人認為出國讀書怎麼樣？\n請聽這一段電話錄音，然後回答下面的兩個問題。\n您好，我是小美，這幾天我有事出去，大概下週回來，不管您是要買花、請\n我幫您種花，還是想來店裡喝一杯花茶，請先留下聯絡方式，我會再和您確認。\n35. 小美希望打電話來的人，告訴她什麼事？\n36. 小美的工作是什麼？\n請聽這一段話，然後回答下面的兩個問題。\n我媽媽很忙，她是電腦公司的老闆，所以每天都有做不完的工作。不過，她\n從來不會忘記幫我們準備飯菜，冰箱裡總是有水果和點心，生日的時候一定有禮\n物。只是，平常她總在公司工作到很晚，放了假在家裡，她還是在工作，我和她\n聊天的機會不太多，真希望她不要這麼忙，能多陪我就好了！\n37. 關於這位媽媽的敘述，下面哪一個是對的？\n38. 說話的人想要什麼？\n請聽這一段話，然後回答下面的兩個問題。\n李小姐，你好。我姓陳，是這間辦公室的主任。歡迎來我們公司工作！我們\n辦公室就這麼大，一進來，右手邊有一間小廚房，可以煮咖啡喝，還有冰箱可以\n使用，廚房的旁邊是洗手間。我的位子在窗戶旁邊，你如果有事可以隨時來找我。\n39. 這段話主要在說什麼？\n40. 陳主任提到了辦公室裡有什麼？\n請聽這一段電腦購票系統的語音指示，然後回答下面的兩個問題。\n您好，歡迎使用語音購票系統\n請注意，本系統只接受信用卡購票\n請輸入乘車日期，如7 月4 號，請輸入0704\n請輸入訂票車次，如1097 車次，請按1097＃\n請選擇訂票張數。一張請按1\n請注意，一人最多訂四張\n螢幕顯示您的訂票資訊…確定請按1，取消請按2\n請輸入信用卡卡號…\n購票完成，請拿票，謝謝。\n41. 用這套系統訂票，要提供哪些資料？\n42. 用這套系統訂車票，要注意什麼事？\n請聽這一段話，然後回答下面的兩個問題。\n早上家裡的電話響個不停，一直沒人接，我只好起床接電話，原來是媽媽打\n來的。因為今天有客人到家裡來，所以她一早就出門買菜了。她問我客人來了沒\n有？要我把客廳整理乾淨，我告訴她，客人來了我會招待，請她不要擔心。\n43. 媽媽為什麼打電話回家？\n44. 說話的人告訴媽媽什麼?\n請聽一則和公共政策有關的報導，然後回答下面三個問題：\n45. 根據報導，政府推動這項新政策主要是為了什麼？\n46. 報導中提到民眾對這項新政策的反應怎麼樣？\n47. 下面哪件事符合這項新政策的概念？\n現在請聽報導。\n近年來，民眾越來越重視休閒生活，許多人都利用週末假期到戶外活動。但\n是，快速增加的旅遊人潮不僅在旅遊景點造成了交通問題，也給當地帶來了廢氣\n和噪音。因此，政府不久前開始積極推動「低碳旅遊」。實際的作法像是搭乘巴\n士或火車到達較遠的景點，再利用腳踏車或步行的方式，完成短距離的移動。\n低碳旅遊的觀念已經逐漸被民眾接受，最近更擴大到其他方面。除了交通，\n也包括了旅行時自己準備餐具，住旅館時不使用旅館提供的一次性用品，或是只\n食用當地、當季的飲食，以及不把垃圾留在旅遊地等等。目前許多旅遊業者正共\n同推動低碳旅遊，只要消費者符合低碳旅遊的條件，旅遊業者就提供他們折扣。\n請聽一則有關《大英百科全書》的報導，然後回答下面三個問題：\n48. 《大英百科全書》銷售量下滑的主要原因是什麼？\n49. 《大英百科全書》的轉機是什麼？\n50. 報導最後用豪華轎車來說明什麼？\n現在請聽報導。\n《大英百科全書》在1768 年出版，雖然價格昂貴，仍維持極高的市場佔有\n率。但是隨著時代的轉變和科技的創新，改變了這部百科全書的命運，銷售金額\n不但下滑了一半，甚至，一度被埋沒在資訊革命的潮流裡，直到1996 年瑞士商\n人買下之後，才出現轉機，成為以線上資料庫為主的公司。\n《大英百科全書》所面臨的銷售問題，還有另一深層的意義，以前，擁有一\n套百科全書就好像擁有一部豪華轎車一樣，是財富與地位的象徵，但現在隨著獲",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "看你手上提著這麼多東西，連開門都需要人幫忙，你中大獎嗎？"
          },
          {
            "speaker": "female",
            "text": "沒這回事。今天百貨公司打折，我去搶便宜，省了不少呢！"
          },
          {
            "speaker": "male",
            "text": "就算是這樣，東西也多得太誇張了，是不是有朋友請你幫忙買？"
          },
          {
            "speaker": "female",
            "text": "這些都是我的，我可是做足了功課才買的。要是錯過這次，那才叫損失。"
          },
          {
            "speaker": "male",
            "text": "從這段話，我們知道這位小姐什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "下面是同事之間的對話，請聽完對話後，回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "小雪，宣傳單、海報做好了嗎？"
          },
          {
            "speaker": "female",
            "text": "什麼活動？"
          },
          {
            "speaker": "male",
            "text": "慢跑活動啊！你看看白板，我還在上頭標記這件事很重要！"
          },
          {
            "speaker": "female",
            "text": "糟糕！老闆，對不起，我真忘了。"
          },
          {
            "speaker": "male",
            "text": "你究竟記得哪件事啊！這件事來不及處理好的話，你就不用來了。"
          },
          {
            "speaker": "female",
            "text": "我馬上找老王、小陳來支援。"
          },
          {
            "speaker": "narrator",
            "text": "21. 小雪忘了哪件事？"
          },
          {
            "speaker": "narrator",
            "text": "22. 最後，這位老闆的意思是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "下面是兩位朋友的對話，請聽完對話後，回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "真煩！最近什麼都不能吃，連奶粉都有問題。"
          },
          {
            "speaker": "female",
            "text": "我只聽說牛肉、雞肉有問題，怎麼連奶粉也出問題了？"
          },
          {
            "speaker": "male",
            "text": "你還不知道啊！昨晚新聞說有幾家國內知名廠商的奶粉，在加工過程中偷偷"
          },
          {
            "speaker": "narrator",
            "text": "加入了會傷害人體健康的化學品。"
          },
          {
            "speaker": "female",
            "text": "這也太誇張了吧！奶粉不是從鮮奶直接加工來的嗎？為什麼還要加化學品"
          },
          {
            "speaker": "narrator",
            "text": "呢？"
          },
          {
            "speaker": "male",
            "text": "據說可以降低製作成本，所以就有不良廠商這麼做。"
          },
          {
            "speaker": "female",
            "text": "那我得趕緊看看剛買的嬰兒奶粉是不是有問題的商家製造的。"
          },
          {
            "speaker": "narrator",
            "text": "23. 這位先生為什麼覺得煩？"
          },
          {
            "speaker": "narrator",
            "text": "24. 從對話中可以知道什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "下面是一段朋友的對話，請聽完對話後，回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "25. 根據對話，阿光怎麼了？"
          },
          {
            "speaker": "narrator",
            "text": "26. 根據對話，阿光母親的態度怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "27. 小美對阿光說的事有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽對話。"
          },
          {
            "speaker": "male",
            "text": "小美，我昨天和我媽說我想學做蛋糕，結果她聽完後竟然連話也不和我說。"
          },
          {
            "speaker": "female",
            "text": "為什麼？"
          },
          {
            "speaker": "male",
            "text": "我媽媽對我的學業成績要求很高，她認為念書才是最重要的，根本不准我去"
          },
          {
            "speaker": "narrator",
            "text": "做其他事。"
          },
          {
            "speaker": "female",
            "text": "阿光，你的功課很好，每學期都拿獎學金，讀書對你來說應該不是問題。如"
          },
          {
            "speaker": "narrator",
            "text": "果你可以讓伯母覺得，就算你撥出一點時間來學做蛋糕，也不會影響你的課"
          },
          {
            "speaker": "narrator",
            "text": "業成績，這樣的話，伯母可能會妥協，你試試再和伯母溝通吧！"
          },
          {
            "speaker": "narrator",
            "text": "下面是艾維和一位女同事的對話，請聽完對話後，回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "28. 他們在討論哪方面的事？"
          },
          {
            "speaker": "narrator",
            "text": "29. 根據對話，為什麼新生兒的父母要請客和送禮？"
          },
          {
            "speaker": "narrator",
            "text": "30. 最後，艾維對這位小姐說的話有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽對話。"
          },
          {
            "speaker": "female",
            "text": "艾維，你在做什麼啊？這麼專心。"
          },
          {
            "speaker": "male",
            "text": "我太太就快生了，最近收了很多紅包，讓我覺得很不好意思。所以我就用這"
          },
          {
            "speaker": "narrator",
            "text": "些錢買了寶寶用的東西，正準備寫成單子給大家看。"
          },
          {
            "speaker": "female",
            "text": "這樣啊！同事們給紅包應該不是想看這個禮物單子，他們只是希望給你們祝"
          },
          {
            "speaker": "narrator",
            "text": "福而已。這禮物單子可以免了，不過滿月酒啊、滿月禮之類的可不能少喔。"
          },
          {
            "speaker": "male",
            "text": "你指的是請大家吃飯、喝酒嗎？這倒沒問題。"
          },
          {
            "speaker": "female",
            "text": "事情可沒這麼簡單。對華人來說，在小孩出生後滿一個月的那一天，小孩的"
          },
          {
            "speaker": "narrator",
            "text": "爸媽會邀請親朋好友一起吃飯，慶祝媽媽安全生產，也會讓小孩和大家見面，"
          },
          {
            "speaker": "narrator",
            "text": "除了親自感謝大家的關心，還會準備一份滿月禮送給親朋好友。"
          },
          {
            "speaker": "male",
            "text": "天啊！又吃飯又送禮，可不可以只分享禮物單子啊？"
          },
          {
            "speaker": "narrator",
            "text": "第二部分 段落"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "我家附近靠河邊的地方，原本是一片空地，那裡有非常多的樹木、花草，還"
          },
          {
            "speaker": "narrator",
            "text": "有很多人在那裡散步、騎腳踏車。有段時間，大家聽說這片空地要賣給建設公司，"
          },
          {
            "speaker": "narrator",
            "text": "變成辦公大樓。不過，在大家的爭取下，這片空地現在成了公園，讓住在這附近"
          },
          {
            "speaker": "narrator",
            "text": "的人有地方運動，這真是一件讓人開心的事。"
          },
          {
            "speaker": "narrator",
            "text": "31. 從這段話可以知道，說話的人住家附近有什麼？"
          },
          {
            "speaker": "narrator",
            "text": "32. 說話的人因為哪一件事覺得很開心？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "很多人想把小孩送到國外學習外國語，認為學習語言就應該到當地學習，但"
          },
          {
            "speaker": "narrator",
            "text": "是這樣就一定能把語言學好嗎？很多孩子到了當地，連話都不敢說，也交不到當"
          },
          {
            "speaker": "narrator",
            "text": "地的朋友，到最後還是只和自己國家的人走在一起，這樣出國不出國有什麼不"
          },
          {
            "speaker": "narrator",
            "text": "同！"
          },
          {
            "speaker": "narrator",
            "text": "33. 說話的人認為孩子到國外念書會遇到什麼問題？"
          },
          {
            "speaker": "narrator",
            "text": "34. 說話的人認為出國讀書怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段電話錄音，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "您好，我是小美，這幾天我有事出去，大概下週回來，不管您是要買花、請"
          },
          {
            "speaker": "narrator",
            "text": "我幫您種花，還是想來店裡喝一杯花茶，請先留下聯絡方式，我會再和您確認。"
          },
          {
            "speaker": "narrator",
            "text": "35. 小美希望打電話來的人，告訴她什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "36. 小美的工作是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "我媽媽很忙，她是電腦公司的老闆，所以每天都有做不完的工作。不過，她"
          },
          {
            "speaker": "narrator",
            "text": "從來不會忘記幫我們準備飯菜，冰箱裡總是有水果和點心，生日的時候一定有禮"
          },
          {
            "speaker": "narrator",
            "text": "物。只是，平常她總在公司工作到很晚，放了假在家裡，她還是在工作，我和她"
          },
          {
            "speaker": "narrator",
            "text": "聊天的機會不太多，真希望她不要這麼忙，能多陪我就好了！"
          },
          {
            "speaker": "narrator",
            "text": "37. 關於這位媽媽的敘述，下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "38. 說話的人想要什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "李小姐，你好。我姓陳，是這間辦公室的主任。歡迎來我們公司工作！我們"
          },
          {
            "speaker": "narrator",
            "text": "辦公室就這麼大，一進來，右手邊有一間小廚房，可以煮咖啡喝，還有冰箱可以"
          },
          {
            "speaker": "narrator",
            "text": "使用，廚房的旁邊是洗手間。我的位子在窗戶旁邊，你如果有事可以隨時來找我。"
          },
          {
            "speaker": "narrator",
            "text": "39. 這段話主要在說什麼？"
          },
          {
            "speaker": "narrator",
            "text": "40. 陳主任提到了辦公室裡有什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段電腦購票系統的語音指示，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "您好，歡迎使用語音購票系統"
          },
          {
            "speaker": "narrator",
            "text": "請注意，本系統只接受信用卡購票"
          },
          {
            "speaker": "narrator",
            "text": "請輸入乘車日期，如7 月4 號，請輸入0704"
          },
          {
            "speaker": "narrator",
            "text": "請輸入訂票車次，如1097 車次，請按1097＃"
          },
          {
            "speaker": "narrator",
            "text": "請選擇訂票張數。一張請按1"
          },
          {
            "speaker": "narrator",
            "text": "請注意，一人最多訂四張"
          },
          {
            "speaker": "narrator",
            "text": "螢幕顯示您的訂票資訊…確定請按1，取消請按2"
          },
          {
            "speaker": "narrator",
            "text": "請輸入信用卡卡號…"
          },
          {
            "speaker": "narrator",
            "text": "購票完成，請拿票，謝謝。"
          },
          {
            "speaker": "narrator",
            "text": "41. 用這套系統訂票，要提供哪些資料？"
          },
          {
            "speaker": "narrator",
            "text": "42. 用這套系統訂車票，要注意什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "早上家裡的電話響個不停，一直沒人接，我只好起床接電話，原來是媽媽打"
          },
          {
            "speaker": "narrator",
            "text": "來的。因為今天有客人到家裡來，所以她一早就出門買菜了。她問我客人來了沒"
          },
          {
            "speaker": "narrator",
            "text": "有？要我把客廳整理乾淨，我告訴她，客人來了我會招待，請她不要擔心。"
          },
          {
            "speaker": "narrator",
            "text": "43. 媽媽為什麼打電話回家？"
          },
          {
            "speaker": "narrator",
            "text": "44. 說話的人告訴媽媽什麼?"
          },
          {
            "speaker": "narrator",
            "text": "請聽一則和公共政策有關的報導，然後回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "45. 根據報導，政府推動這項新政策主要是為了什麼？"
          },
          {
            "speaker": "narrator",
            "text": "46. 報導中提到民眾對這項新政策的反應怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "47. 下面哪件事符合這項新政策的概念？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "近年來，民眾越來越重視休閒生活，許多人都利用週末假期到戶外活動。但"
          },
          {
            "speaker": "narrator",
            "text": "是，快速增加的旅遊人潮不僅在旅遊景點造成了交通問題，也給當地帶來了廢氣"
          },
          {
            "speaker": "narrator",
            "text": "和噪音。因此，政府不久前開始積極推動「低碳旅遊」。實際的作法像是搭乘巴"
          },
          {
            "speaker": "narrator",
            "text": "士或火車到達較遠的景點，再利用腳踏車或步行的方式，完成短距離的移動。"
          },
          {
            "speaker": "narrator",
            "text": "低碳旅遊的觀念已經逐漸被民眾接受，最近更擴大到其他方面。除了交通，"
          },
          {
            "speaker": "narrator",
            "text": "也包括了旅行時自己準備餐具，住旅館時不使用旅館提供的一次性用品，或是只"
          },
          {
            "speaker": "narrator",
            "text": "食用當地、當季的飲食，以及不把垃圾留在旅遊地等等。目前許多旅遊業者正共"
          },
          {
            "speaker": "narrator",
            "text": "同推動低碳旅遊，只要消費者符合低碳旅遊的條件，旅遊業者就提供他們折扣。"
          },
          {
            "speaker": "narrator",
            "text": "請聽一則有關《大英百科全書》的報導，然後回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "48. 《大英百科全書》銷售量下滑的主要原因是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "49. 《大英百科全書》的轉機是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "50. 報導最後用豪華轎車來說明什麼？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "《大英百科全書》在1768 年出版，雖然價格昂貴，仍維持極高的市場佔有"
          },
          {
            "speaker": "narrator",
            "text": "率。但是隨著時代的轉變和科技的創新，改變了這部百科全書的命運，銷售金額"
          },
          {
            "speaker": "narrator",
            "text": "不但下滑了一半，甚至，一度被埋沒在資訊革命的潮流裡，直到1996 年瑞士商"
          },
          {
            "speaker": "narrator",
            "text": "人買下之後，才出現轉機，成為以線上資料庫為主的公司。"
          },
          {
            "speaker": "narrator",
            "text": "《大英百科全書》所面臨的銷售問題，還有另一深層的意義，以前，擁有一"
          },
          {
            "speaker": "narrator",
            "text": "套百科全書就好像擁有一部豪華轎車一樣，是財富與地位的象徵，但現在隨著獲"
          },
          {
            "speaker": "narrator",
            "text": "得知識的方法改變，人們也不再以擁有一套百科全書來作為展示自我的方式了。"
          }
        ],
        "q": "得知識的方法改變，人們也不再以擁有一套百科全書來作為展示自我的方式了。",
        "options": [
          "她準備充分後才購物",
          "她最近得到了一筆獎金",
          "她錯過了這次的折扣活動",
          "她答應順便幫朋友買東西"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她準備充分後才購物. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 21",
        "options": [
          "參加慢跑",
          "找人幫忙",
          "製作海報",
          "幫人報名"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 製作海報. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 22",
        "options": [
          "要小雪立刻辭職",
          "要小雪趕快補救",
          "要小雪別再宣傳活動",
          "要小雪記住重要的事"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 要小雪趕快補救. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 23",
        "options": [
          "他的健康出了問題",
          "買不到進口食品了",
          "肉類產品的供應持續缺乏",
          "越來越多的食物出了狀況"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 越來越多的食物出了狀況. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 24",
        "options": [
          "買大廠製的奶粉比較有保障",
          "商店聯合調高嬰兒奶粉的售價",
          "買奶粉時要留意問題廠商有哪些",
          "嬰兒奶粉缺貨的情況越來越嚴重"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 買奶粉時要留意問題廠商有哪些. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 25",
        "options": [
          "要幫忙賺錢養家",
          "不能做想做的事情",
          "成績太差，讓母親生氣",
          "找不到教他做蛋糕的人"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 不能做想做的事情. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台南古蹟與老街巡禮\n台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "audio": "",
        "dialogue": "台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "dialogueSegments": [],
        "q": "Câu 1: Chọn từ thích hợp nhất điền vào chỗ trống [1].",
        "options": [
          "古蹟",
          "古董",
          "古典",
          "古代"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'古蹟' (di tích lịch sử).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台南古蹟與老街巡禮\n台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "audio": "",
        "dialogue": "台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "dialogueSegments": [],
        "q": "Câu 2: Chọn từ thích hợp nhất điền vào chỗ trống [2].",
        "options": [
          "撲鼻",
          "張開",
          "進入",
          "發揮"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'撲鼻而來' (mùi thơm nức mũi bay tới).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台南古蹟與老街巡禮\n台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "audio": "",
        "dialogue": "台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "dialogueSegments": [],
        "q": "Câu 3: Chọn từ thích hợp nhất điền vào chỗ trống [3].",
        "options": [
          "體會",
          "了解",
          "認識",
          "見面"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'體會'生活步調 (thấu hiểu nhịp sống).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台南古蹟與老街巡禮\n台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "audio": "",
        "dialogue": "台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "dialogueSegments": [],
        "q": "Câu 4: Chọn từ thích hợp nhất điền vào chỗ trống [4].",
        "options": [
          "改造",
          "製造",
          "創造",
          "發明"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'改造'成咖啡館 (cải tạo thành quán cà phê).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台南古蹟與老街巡禮\n台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "audio": "",
        "dialogue": "台南是台灣歷史最悠久的城市，街道兩旁到處可見保存完好的 [1] 。漫步在安平老街，陣陣蝦餅香氣 [2] 而來，令人食指大動。觀光客不僅能品嚐傳統豆花與牛肉湯，更能 [3] 當地居民熱情好客的生活步調。近年來許多年輕人回到家鄉創業，將百年老宅 [4] 成充滿文青氣息的咖啡館，為這座古城 [5] 了嶄新的活力。",
        "dialogueSegments": [],
        "q": "Câu 5: Chọn từ thích hợp nhất điền vào chỗ trống [5].",
        "options": [
          "注入",
          "投入",
          "放入",
          "加入"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'注入'嶄新的活力 (rót vào sức sống mới).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 綠能發電與節約能源\n隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "audio": "",
        "dialogue": "隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "dialogueSegments": [],
        "q": "Câu 6: Chọn từ thích hợp nhất điền vào chỗ trống [6].",
        "options": [
          "迫切",
          "緊急",
          "著急",
          "著手"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'迫切'解決的難題 (nan đề cấp bách cần giải quyết).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 綠能發電與節約能源\n隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "audio": "",
        "dialogue": "隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "dialogueSegments": [],
        "q": "Câu 7: Chọn từ thích hợp nhất điền vào chỗ trống [7].",
        "options": [
          "離岸",
          "岸邊",
          "沿岸",
          "內陸"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'離岸'風場 (nông trường điện gió ngoài khơi offshore).",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 綠能發電與節約能源\n隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "audio": "",
        "dialogue": "隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "dialogueSegments": [],
        "q": "Câu 8: Chọn từ thích hợp nhất điền vào chỗ trống [8].",
        "options": [
          "盡量",
          "常常",
          "經常",
          "隨便"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'盡量'搭乘 (cố gắng hết sức đi xe công cộng).",
        "pinyin": ""
      },
      {
        "id": 34,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 綠能發電與節約能源\n隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "audio": "",
        "dialogue": "隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "dialogueSegments": [],
        "q": "Câu 9: Chọn từ thích hợp nhất điền vào chỗ trống [9].",
        "options": [
          "奉獻",
          "做",
          "貢獻",
          "做成"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'做'出貢獻 (đóng góp cống hiến lớn).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 綠能發電與節約能源\n隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "audio": "",
        "dialogue": "隨著全球氣候暖化日益嚴重，發展再生能源已成為各國政府 [6] 解決的難題。台灣四面環海，具備絕佳的風力發電優勢，政府積極在西部海岸興建 [7] 風場。同時，民眾也應該從日常生活中落實節能減碳，例如隨手關燈、 [8] 搭乘大眾運輸工具。只要人人付出微小的努力，就能為地球環境 [9] 出巨大的貢獻，讓下一代享有 [10] 的美麗家園。",
        "dialogueSegments": [],
        "q": "Câu 10: Chọn từ thích hợp nhất điền vào chỗ trống [10].",
        "options": [
          "永續",
          "長期",
          "永遠",
          "持續"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'永續'的美麗家園 (ngôi nhà tươi đẹp phát triển bền vững).",
        "pinyin": ""
      },
      {
        "id": 36,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台灣茶藝文化體驗\n喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "audio": "",
        "dialogue": "喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "dialogueSegments": [],
        "q": "Câu 11: Chọn từ thích hợp nhất điền vào chỗ trống [11].",
        "options": [
          "拿捏",
          "抓起",
          "決定",
          "規定"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'拿捏' (cân nhắc / căn chuẩn mực nước và thời gian).",
        "pinyin": ""
      },
      {
        "id": 37,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台灣茶藝文化體驗\n喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "audio": "",
        "dialogue": "喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "dialogueSegments": [],
        "q": "Câu 12: Chọn từ thích hợp nhất điền vào chỗ trống [12].",
        "options": [
          "回甘",
          "甜美",
          "香甜",
          "可口"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'回甘' (vị ngọt đọng lại nơi cuống họng).",
        "pinyin": ""
      },
      {
        "id": 38,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台灣茶藝文化體驗\n喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "audio": "",
        "dialogue": "喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "dialogueSegments": [],
        "q": "Câu 13: Chọn từ thích hợp nhất điền vào chỗ trống [13].",
        "options": [
          "寧靜",
          "安靜",
          "冷靜",
          "平靜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'寧靜' (sự yên bình thanh tịnh).",
        "pinyin": ""
      },
      {
        "id": 39,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台灣茶藝文化體驗\n喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "audio": "",
        "dialogue": "喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "dialogueSegments": [],
        "q": "Câu 14: Chọn từ thích hợp nhất điền vào chỗ trống [14].",
        "options": [
          "沉",
          "深",
          "遠",
          "高"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'沉'思 (trầm tư suy nghĩ).",
        "pinyin": ""
      },
      {
        "id": 40,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 台灣茶藝文化體驗\n喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "audio": "",
        "dialogue": "喝茶是台灣人日常社交不可或缺的雅趣。泡一壺好茶，水溫、茶葉分量與浸泡時間皆需精準 [11] 。以文山包種茶為例，茶湯清澈帶有蘭花清香，入口後喉韻 [12] 。與三五好友聚在茶藝館中品茗談心，能讓人在忙碌喧囂的現代生活中尋得一絲 [13] 。茶道不僅是一種技藝，更體現了東方文化中靜心、 [14] 思的生活哲學，值得年輕一輩細細 [15] 。",
        "dialogueSegments": [],
        "q": "Câu 15: Chọn từ thích hợp nhất điền vào chỗ trống [15].",
        "options": [
          "品味",
          "品嚐",
          "嘗試",
          "體驗"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'品味' (chiêm nghiệm thưởng thức).",
        "pinyin": ""
      },
      {
        "id": 41,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "dialogueSegments": [],
        "q": "Câu 16: 下面哪一個敘述完全符合短文內容？",
        "options": [
          "小明已經造訪韓國兩次了",
          "小明在韓國住了四個晚上",
          "小明覺得韓國食物不合胃口",
          "小明打算去日本留學"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết rõ: '玩了五天四夜' nghĩa là ở lại 4 đêm (四個晚上).",
        "pinyin": ""
      },
      {
        "id": 42,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 面對孩子成長的母親\n孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "dialogueSegments": [],
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，採取什麼態度？",
        "options": [
          "嚴厲責備孩子的膽怯",
          "答應明天親自開車接送",
          "鼓勵孩子勇敢獨立面對",
          "感到不知所措而焦慮"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Người mẹ khuyến khích: '你要學會自己面對挑戰' (động viên con dũng cảm tự đối diện).",
        "pinyin": ""
      },
      {
        "id": 43,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北夜市行動支付普及化\n以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "audio": "",
        "dialogue": "以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "dialogueSegments": [],
        "q": "Câu 18: 夜市引入行動支付帶來哪一項核心效益？",
        "options": [
          "大幅降低商品售價",
          "結帳更快速並兼顧衛生",
          "夜市營業時間延長至白天",
          "所有攤商免繳營業稅"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Văn bản nêu: '減少了排隊找零的時間, 也大幅降低了衛生疑慮' (thanh toán nhanh hơn và vệ sinh hơn).",
        "pinyin": ""
      },
      {
        "id": 44,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 捷運站二手書漂書箱與愛心傘\n台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "audio": "",
        "dialogue": "台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "dialogueSegments": [],
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪項優勢？",
        "options": [
          "列車行駛速度領先全球",
          "兼具人情味與信任的便民服務",
          "站內車廂提供免費餐飲",
          "票價比其他交通工具便宜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả ngợi ca: '兼具人情味與信任的便民服務' (dịch vụ tiện dân ấm áp tình người dựa trên sự tin tưởng).",
        "pinyin": ""
      },
      {
        "id": 45,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北市垃圾費隨袋徵收政策成效\n台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "audio": "",
        "dialogue": "台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "dialogueSegments": [],
        "q": "Câu 20: 『垃圾費隨袋徵收』政策為何能有效減少垃圾量？",
        "options": [
          "市民為了省買垃圾袋的錢而努力做資源回收",
          "規定每戶每週最多只能丟一包垃圾",
          "禁止市民在超市購買塑膠袋包裝的食品",
          "提高亂丟垃圾的罰款金額十倍以上"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Vì rác tái chế miễn phí còn rác thường tốn tiền mua túi, người dân tích cực phân loại để tiết kiệm chi phí mua túi rác.",
        "pinyin": ""
      },
      {
        "id": 46,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 高鐵串連台灣南北一日生活圈\n自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "audio": "",
        "dialogue": "自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "dialogueSegments": [],
        "q": "Câu 21: 『一日生活圈』對人們生活產生的實質改變是什麼？",
        "options": [
          "商務出差不必再在外地過夜",
          "民眾紛紛將戶籍遷往南部",
          "高鐵票價全面降至台鐵水準",
          "飛機成為國內最受歡迎的航線"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đoạn văn nêu buổi sáng họp Đài Bắc, chiều tới Nam Bộ, tối về lại nhà (đi lại trong ngày không cần ở qua đêm).",
        "pinyin": ""
      },
      {
        "id": 47,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣全民健保雲端醫療資訊系統\n台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "audio": "",
        "dialogue": "台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "dialogueSegments": [],
        "q": "Câu 22: 健保雲端資訊系統的主要優勢是什麼？",
        "options": [
          "自動為病患減免掛號費用",
          "跨院即時查詢用藥紀錄避免重複開藥",
          "病患可在家自行線上開刀治療",
          "直接向國外藥廠訂購廉價藥品"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn nêu rõ: '即時調閱檢查報告及用藥紀錄, 有效防範了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 48,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 誠品書店二十四小時營運的文化底蘊\n誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "dialogueSegments": [],
        "q": "Câu 23: 誠品書店之所以被譽為深夜文化地標，是因為什麼？",
        "options": [
          "深夜購書享有半價折扣",
          "結合文創美學將閱讀轉化為生活哲學",
          "只允許專業作家進入借閱圖書",
          "是台北市唯一的實體書店"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Tác giả chỉ rõ: '將單純的購書行為昇華為一種優雅慢活的生活哲學'.",
        "pinyin": ""
      },
      {
        "id": 49,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 美食外送平台對都會生活型態的衝擊\n隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "audio": "",
        "dialogue": "隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "dialogueSegments": [],
        "q": "Câu 24: 作者對於美食外送服務的蓬勃發展抱持何種看法？",
        "options": [
          "認為便利之餘亦伴隨交通與環保等社會隱憂",
          "強烈主張政府應立法全面禁止外送App",
          "認為外送餐點品質大幅超越店內現煮",
          "覺得外送員的薪資過高不合理"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả chỉ rõ: '伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題, 亟需深入探討' (tiện lợi nhưng tiềm ẩn nguy cơ giao thông và môi trường).",
        "pinyin": ""
      },
      {
        "id": 50,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 傳統菜市場的人情溫度與文化生命力\n儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "dialogueSegments": [],
        "q": "Câu 25: 傳統市場至今依然深受廣大民眾喜愛的核心魅力何在？",
        "options": [
          "冷氣空調比超市更強大涼爽",
          "濃厚的街坊人情味與客製化的人際互動",
          "所有生鮮蔬果皆由國外高價空運進口",
          "營業時間全天二十四小時不中斷"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả nhấn mạnh: '充滿街坊問候的人情溫度與鮮活的在地風土' (tình người nồng hậu và giao tiếp tương tác thân tình).",
        "pinyin": ""
      }
    ]
  },
  {
    "id": "mock_b3",
    "title": "TOCFL Band B - Đề thi Chuẩn 3 (Official Mock 3)",
    "band": "Band B (高階·流利)",
    "badge": "Chuẩn SC-TOP CAT",
    "duration": 60,
    "totalQ": 50,
    "desc": "Đề thi nâng cao cấu trúc ngữ pháp B2, phân tích luận điểm, tin tức thời sự và đoạn đối thoại đa người nói.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "下個月的歌唱比賽，你能不能和我一起合唱一首歌？ 只要人多，我就緊張得說不出話，更不用說唱歌了，我還是當觀眾幫你加油 就好。 關於唱歌比賽，這位小姐打算怎麼做？",
        "dialogue": "男：下個月的歌唱比賽，你能不能和我一起合唱一首歌？\n女：只要人多，我就緊張得說不出話，更不用說唱歌了，我還是當觀眾幫你加油\n就好。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "下個月的歌唱比賽，你能不能和我一起合唱一首歌？"
          },
          {
            "speaker": "female",
            "text": "只要人多，我就緊張得說不出話，更不用說唱歌了，我還是當觀眾幫你加油"
          },
          {
            "speaker": "narrator",
            "text": "就好。"
          },
          {
            "speaker": "male",
            "text": "關於唱歌比賽，這位小姐打算怎麼做？"
          }
        ],
        "q": "關於唱歌比賽，這位小姐打算怎麼做？",
        "options": [
          "她不參加比賽",
          "她要自己唱一首歌",
          "她還沒決定要不要參加",
          "她要和這位先生一起練習"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她不參加比賽. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳聽過這首歌沒有？ 我妹妹天天都聽這首歌，我都會背了。 這位小姐的意思是什麼？",
        "dialogue": "男：妳聽過這首歌沒有？\n女：我妹妹天天都聽這首歌，我都會背了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳聽過這首歌沒有？"
          },
          {
            "speaker": "female",
            "text": "我妹妹天天都聽這首歌，我都會背了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "妹妹教過她這首歌",
          "她一下子就記住這首歌",
          "這首歌她聽了好多次了",
          "妹妹唱過的歌，她都記得"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 這首歌她聽了好多次了. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "您年紀這麼大了，還去念研究所，真了不起！ 哪裡哪裡！活到老學到老嘛！ 這位女士的意思是什麼？",
        "dialogue": "男：您年紀這麼大了，還去念研究所，真了不起！\n女：哪裡哪裡！活到老學到老嘛！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "您年紀這麼大了，還去念研究所，真了不起！"
          },
          {
            "speaker": "female",
            "text": "哪裡哪裡！活到老學到老嘛！"
          },
          {
            "speaker": "male",
            "text": "這位女士的意思是什麼？"
          }
        ],
        "q": "這位女士的意思是什麼？",
        "options": [
          "她老了才打算開始唸書",
          "她認為人要不斷地學習",
          "她不清楚為什麼別人讚美她",
          "她認為多唸書，可以活得久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她認為人要不斷地學習. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "你快一點行不行？七點的電影快開始了！ 還有半個小時呢，坐計程車去，二十分鐘就到了。 這位小姐的意思是什麼？",
        "dialogue": "男：你快一點行不行？七點的電影快開始了！\n女：還有半個小時呢，坐計程車去，二十分鐘就到了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "你快一點行不行？七點的電影快開始了！"
          },
          {
            "speaker": "female",
            "text": "還有半個小時呢，坐計程車去，二十分鐘就到了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "電影七點半才開始",
          "電影七點二十分才開始",
          "還有二十分電影才開始",
          "還有半小時電影才開始"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 還有半小時電影才開始. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "這家餐廳怎麼一個禮拜都沒開門？ 生意太差，老闆不做了。 這家餐廳怎麼了？",
        "dialogue": "男：這家餐廳怎麼一個禮拜都沒開門？\n女：生意太差，老闆不做了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "這家餐廳怎麼一個禮拜都沒開門？"
          },
          {
            "speaker": "female",
            "text": "生意太差，老闆不做了。"
          },
          {
            "speaker": "male",
            "text": "這家餐廳怎麼了？"
          }
        ],
        "q": "這家餐廳怎麼了？",
        "options": [
          "換了新的食物",
          "換了新的老闆",
          "不再做生意了",
          "休息七天才開門"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 不再做生意了. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小姐，請妳把嘴巴再張大一點，是這顆牙齒痛嗎？ 不是，要再往右邊一點，啊！就是這裡，疼得我什麼都不能吃。 這段話最可能發生在什麼地方？",
        "dialogue": "男：小姐，請妳把嘴巴再張大一點，是這顆牙齒痛嗎？\n女：不是，要再往右邊一點，啊！就是這裡，疼得我什麼都不能吃。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小姐，請妳把嘴巴再張大一點，是這顆牙齒痛嗎？"
          },
          {
            "speaker": "female",
            "text": "不是，要再往右邊一點，啊！就是這裡，疼得我什麼都不能吃。"
          },
          {
            "speaker": "male",
            "text": "這段話最可能發生在什麼地方？"
          }
        ],
        "q": "這段話最可能發生在什麼地方？",
        "options": [
          "醫院",
          "學校",
          "餐廳",
          "計程車上"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 醫院. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "這些錢請妳數一數，看看對不對？ 我數好了，一塊錢也沒少。 這些錢怎麼樣？",
        "dialogue": "男：這些錢請妳數一數，看看對不對？\n女：我數好了，一塊錢也沒少。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "這些錢請妳數一數，看看對不對？"
          },
          {
            "speaker": "female",
            "text": "我數好了，一塊錢也沒少。"
          },
          {
            "speaker": "male",
            "text": "這些錢怎麼樣？"
          }
        ],
        "q": "這些錢怎麼樣？",
        "options": [
          "少了一塊錢",
          "少了不少錢",
          "多了一塊錢",
          "錢不多也不少"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 錢不多也不少. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳知道嗎？剛剛那位醫生不但沒開藥給我，還說我不是感冒，只要多喝白開 水就可以了。 誰叫你平常只喝可樂、果汁之類的飲料，要你喝白開水，好像要你的命一樣。 現在醫生可站出來替你的身體說話囉！ 這位小姐認為這位先生怎麼樣？",
        "dialogue": "男：妳知道嗎？剛剛那位醫生不但沒開藥給我，還說我不是感冒，只要多喝白開\n水就可以了。\n女：誰叫你平常只喝可樂、果汁之類的飲料，要你喝白開水，好像要你的命一樣。\n現在醫生可站出來替你的身體說話囉！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳知道嗎？剛剛那位醫生不但沒開藥給我，還說我不是感冒，只要多喝白開"
          },
          {
            "speaker": "narrator",
            "text": "水就可以了。"
          },
          {
            "speaker": "female",
            "text": "誰叫你平常只喝可樂、果汁之類的飲料，要你喝白開水，好像要你的命一樣。"
          },
          {
            "speaker": "narrator",
            "text": "現在醫生可站出來替你的身體說話囉！"
          },
          {
            "speaker": "male",
            "text": "這位小姐認為這位先生怎麼樣？"
          }
        ],
        "q": "這位小姐認為這位先生怎麼樣？",
        "options": [
          "感冒症狀比想像中嚴重",
          "光喝開水對身體沒幫助",
          "不吃藥可能會要他的命",
          "飲食習慣本來就有問題"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 飲食習慣本來就有問題. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "最近服務生的反應速度也太差了。 大概是電視節目一直宣傳的關係，客人突然增加，來不及應付吧！ 不過菜再好吃也沒用，常常無法維持服務品質，環境又吵，連我們這種老客 人也不想來了。 我看，我們又得重新找約會地點了。 這位先生和小姐現在對這家餐廳的看法是什麼？",
        "dialogue": "男：最近服務生的反應速度也太差了。\n女：大概是電視節目一直宣傳的關係，客人突然增加，來不及應付吧！\n男：不過菜再好吃也沒用，常常無法維持服務品質，環境又吵，連我們這種老客\n人也不想來了。\n女：我看，我們又得重新找約會地點了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "最近服務生的反應速度也太差了。"
          },
          {
            "speaker": "female",
            "text": "大概是電視節目一直宣傳的關係，客人突然增加，來不及應付吧！"
          },
          {
            "speaker": "male",
            "text": "不過菜再好吃也沒用，常常無法維持服務品質，環境又吵，連我們這種老客"
          },
          {
            "speaker": "narrator",
            "text": "人也不想來了。"
          },
          {
            "speaker": "female",
            "text": "我看，我們又得重新找約會地點了。"
          },
          {
            "speaker": "male",
            "text": "這位先生和小姐現在對這家餐廳的看法是什麼？"
          }
        ],
        "q": "這位先生和小姐現在對這家餐廳的看法是什麼？",
        "options": [
          "客人太多讓服務的水準降低",
          "餐廳食物的味道沒以前的好",
          "不應該接受電視節目的訪問",
          "服務生得罪很多常來的客人"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 客人太多讓服務的水準降低. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我最近打算再試試其他工作，看看有沒有更好的。 上次不是聽你說，這工作待遇不錯，你覺得挺好的嗎？ 可是經常為了客戶的事，到了週末還得加班，我覺得太說不過去了。 喔，信不信由你，週末加班對我來說，根本是家常便飯。 這位小姐的意思是什麼？",
        "dialogue": "男：我最近打算再試試其他工作，看看有沒有更好的。\n女：上次不是聽你說，這工作待遇不錯，你覺得挺好的嗎？\n男：可是經常為了客戶的事，到了週末還得加班，我覺得太說不過去了。\n女：喔，信不信由你，週末加班對我來說，根本是家常便飯。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我最近打算再試試其他工作，看看有沒有更好的。"
          },
          {
            "speaker": "female",
            "text": "上次不是聽你說，這工作待遇不錯，你覺得挺好的嗎？"
          },
          {
            "speaker": "male",
            "text": "可是經常為了客戶的事，到了週末還得加班，我覺得太說不過去了。"
          },
          {
            "speaker": "female",
            "text": "喔，信不信由你，週末加班對我來說，根本是家常便飯。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她已經習慣週末要加班",
          "她覺得自己的工作比較輕鬆",
          "她經常利用週末和客戶吃飯",
          "她不相信這位先生週末要加班"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她已經習慣週末要加班. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "現在景氣不好，別人會不會覺得我們產品的定價高得離譜？ 這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。 你這麼有把握啊！ 你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。 這位小姐的意思是什麼？",
        "dialogue": "男：現在景氣不好，別人會不會覺得我們產品的定價高得離譜？\n女：這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。\n男：你這麼有把握啊！\n女：你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "現在景氣不好，別人會不會覺得我們產品的定價高得離譜？"
          },
          {
            "speaker": "female",
            "text": "這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。"
          },
          {
            "speaker": "male",
            "text": "你這麼有把握啊！"
          },
          {
            "speaker": "female",
            "text": "你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "現在的皮椅都是七八十萬",
          "打折以後，買皮椅的人不少",
          "再貴一點的皮椅就沒有人買了",
          "不少人買得起七八十萬的皮椅"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不少人買得起七八十萬的皮椅. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。 你怎麼不勸勸他呢？ 我當然說啦！退一步海闊天空嘛！不過他聽不進去。 都到這個節骨眼了他還堅持己見，真是不可理喻。 這位太太說老劉怎麼樣？",
        "dialogue": "男：唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。\n女：你怎麼不勸勸他呢？\n男：我當然說啦！退一步海闊天空嘛！不過他聽不進去。\n女：都到這個節骨眼了他還堅持己見，真是不可理喻。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。"
          },
          {
            "speaker": "female",
            "text": "你怎麼不勸勸他呢？"
          },
          {
            "speaker": "male",
            "text": "我當然說啦！退一步海闊天空嘛！不過他聽不進去。"
          },
          {
            "speaker": "female",
            "text": "都到這個節骨眼了他還堅持己見，真是不可理喻。"
          },
          {
            "speaker": "male",
            "text": "這位太太說老劉怎麼樣？"
          }
        ],
        "q": "這位太太說老劉怎麼樣？",
        "options": [
          "沒法跟老劉講道理",
          "是個沒有原則的人",
          "堅持立場、值得尊敬",
          "再多勸一下，他就會讓步"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 沒法跟老劉講道理. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "怎麼啦？垂頭喪氣的？ 我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。 勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動 都進入決賽呢！ 就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！ 代表隊在這次比賽的表現怎麼樣？",
        "dialogue": "男：怎麼啦？垂頭喪氣的？\n女：我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。\n男：勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動\n都進入決賽呢！\n女：就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "怎麼啦？垂頭喪氣的？"
          },
          {
            "speaker": "female",
            "text": "我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。"
          },
          {
            "speaker": "male",
            "text": "勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動"
          },
          {
            "speaker": "narrator",
            "text": "都進入決賽呢！"
          },
          {
            "speaker": "female",
            "text": "就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！"
          },
          {
            "speaker": "male",
            "text": "代表隊在這次比賽的表現怎麼樣？"
          }
        ],
        "q": "代表隊在這次比賽的表現怎麼樣？",
        "options": [
          "連決賽都沒進",
          "只得到一個獎",
          "一個獎都沒得到",
          "只有一項沒得獎"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 一個獎都沒得到. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小趙這孩子，頭腦不錯，就是個性太急躁。 哈哈，年輕人嘛！做事難免比較衝動。 正好老王那兒有缺，我想叫他去試一試。 嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。 為什麼小趙幫老王做事是種磨練？",
        "dialogue": "男：小趙這孩子，頭腦不錯，就是個性太急躁。\n女：哈哈，年輕人嘛！做事難免比較衝動。\n男：正好老王那兒有缺，我想叫他去試一試。\n女：嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小趙這孩子，頭腦不錯，就是個性太急躁。"
          },
          {
            "speaker": "female",
            "text": "哈哈，年輕人嘛！做事難免比較衝動。"
          },
          {
            "speaker": "male",
            "text": "正好老王那兒有缺，我想叫他去試一試。"
          },
          {
            "speaker": "female",
            "text": "嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。"
          },
          {
            "speaker": "male",
            "text": "為什麼小趙幫老王做事是種磨練？"
          }
        ],
        "q": "為什麼小趙幫老王做事是種磨練？",
        "options": [
          "老王的眼睛不好",
          "老王做事很嚴謹",
          "老王個性很馬虎",
          "老王不喜歡小趙"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 老王做事很嚴謹. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "咦！最近你好像特別忙。 唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司， 偏偏那兒又需要好好整頓一番。 小趙怎麼樣，服務的時間久，學歷也不錯。 他人緣差不說，又經常敷衍了事，你想我能指望他嗎？ 這位女士的意思是什麼？",
        "dialogue": "男：咦！最近你好像特別忙。\n女：唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司，\n偏偏那兒又需要好好整頓一番。\n男：小趙怎麼樣，服務的時間久，學歷也不錯。\n女：他人緣差不說，又經常敷衍了事，你想我能指望他嗎？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "咦！最近你好像特別忙。"
          },
          {
            "speaker": "female",
            "text": "唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司，"
          },
          {
            "speaker": "narrator",
            "text": "偏偏那兒又需要好好整頓一番。"
          },
          {
            "speaker": "male",
            "text": "小趙怎麼樣，服務的時間久，學歷也不錯。"
          },
          {
            "speaker": "female",
            "text": "他人緣差不說，又經常敷衍了事，你想我能指望他嗎？"
          },
          {
            "speaker": "male",
            "text": "這位女士的意思是什麼？"
          }
        ],
        "q": "這位女士的意思是什麼？",
        "options": [
          "小趙拒絕了她",
          "小趙不值得信賴",
          "小趙對工作很失望",
          "她怕小趙不會答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 小趙不值得信賴. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？ 保證萬無一失，絕對沒問題，你放心吧！ 這位小姐的話是什麼意思？",
        "dialogue": "男：妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？\n女：保證萬無一失，絕對沒問題，你放心吧！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？"
          },
          {
            "speaker": "female",
            "text": "保證萬無一失，絕對沒問題，你放心吧！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的話是什麼意思？"
          }
        ],
        "q": "這位小姐的話是什麼意思？",
        "options": [
          "這麼做一定行得通",
          "她想買保險以免發生問題",
          "因為已保了險，所以沒問題",
          "這麼做風險很高，但值得冒險嘗試"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 這麼做一定行得通. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小劉費盡心思取悅父母，結果卻失敗了。 誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂 啊！ 根據這位小姐的說法，小劉失敗的原因是什麼？",
        "dialogue": "男：小劉費盡心思取悅父母，結果卻失敗了。\n女：誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂\n啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小劉費盡心思取悅父母，結果卻失敗了。"
          },
          {
            "speaker": "female",
            "text": "誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂"
          },
          {
            "speaker": "narrator",
            "text": "啊！"
          },
          {
            "speaker": "male",
            "text": "根據這位小姐的說法，小劉失敗的原因是什麼？"
          }
        ],
        "q": "根據這位小姐的說法，小劉失敗的原因是什麼？",
        "options": [
          "小劉的父母要求太多",
          "小劉還沒有顯著的成就",
          "小劉沒滿足父母最大的期待",
          "小劉的父母不要求兒子有成就"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 小劉沒滿足父母最大的期待. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "老闆說這個案子得在一個星期裡完成，這怎麼可能呢？ 還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！ 這位小姐有什麼意見？",
        "dialogue": "男：老闆說這個案子得在一個星期裡完成，這怎麼可能呢？\n女：還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "老闆說這個案子得在一個星期裡完成，這怎麼可能呢？"
          },
          {
            "speaker": "female",
            "text": "還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！"
          },
          {
            "speaker": "male",
            "text": "這位小姐有什麼意見？"
          }
        ],
        "q": "這位小姐有什麼意見？",
        "options": [
          "做這個案子得花時間",
          "做這個案子並不容易",
          "做這個案子不必認真",
          "做這個案子要有能力"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 做這個案子不必認真. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置， 那裡的視野還不錯，可以清楚地看見吳老師演奏。 你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞 不是重點，你就把錢省下來吧！ 這位小姐對這次演奏會的座位有什麼看法？ 請聽這段對話，然後回答兩個問題。 你最近怎麼老躲著小王？ 他一直想約我單獨跟他出去，可是… 怎麼了？你好像不太願意？ 小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？ 20. 這位小姐對小王的感覺如何？ 21. 對小王的邀請，這位小姐覺得如何？ 請聽這段對話，然後回答下面的兩個問題。 你們又來了，這次又有什麼事？ 趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請 您共襄盛舉，捐點錢救濟災民。 不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道 就這樣送給你們？ 喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放 心啊！ 口說無憑，你不如先寄份帳冊來給我看吧！ 22. 關於這位先生，哪一個是對的？ 23. 這位先生最後的態度怎麼樣？ 下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。 小姐，我覺得這發票上的金額好像不太對。 好的，馬上為您處理。這些一共是500元，金額沒錯。 是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不 管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡， 為什麼沒打折？ 我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主 要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能 享有九折優惠。不好意思，我們店裡並沒有配合這個活動。 24. 店員和客人發生了什麼事？ 25. 有關宣傳單上的活動說明，下面哪一項是對的？ 請聽這一段和「味精」有關的討論，然後回答兩個問題。 佳美，你看這則味精的報導。 嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過 另外一篇報告，結果完全相反。 是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就 不碰吧！ 每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也 還沒證實，所以，你別太擔心了。 26. 這位先生覺得味精怎麼樣？ 27. 這位小姐的意思是什麼？ 下面是一段兄妹之間的對話，請聽完後，回答下面三個問題： 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 現在請聽對話。 昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還 來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪 氣的。 哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘， 該不會是… 長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘 的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想 到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一 會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！ 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 第二部分 段落 請聽這一段話，然後回答下面的問題。 小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋 糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和 小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小 青聽了，很高興，也很感謝。 31. 從這段話可以知道什麼？ 請聽這一段話，然後回答下面的問題。 如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常 聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生， 不過聽音樂絕不會對你造成傷害。 32. 這段話的意思是什麼？ 請聽這一段電話留言，然後回答下面的兩個問題。 小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上 我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影， 好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。 33. 阿秀今天下午要做什麼？ 34. 阿秀請小文拿什麼去學校？ 請聽這一段話，然後回答下面的兩個問題。 昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我 的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假 去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後， 吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就 不用再吃藥。」 35. 為什麼說話的人昨天晚上沒睡好？ 36. 醫生說了什麼？ 請聽這一段水果的介紹，然後回答下面的兩個問題。 這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。 它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特 別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰 箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香， 放到第四天，不但不好看，也不好吃了。 37. 這種水果怎麼樣？ 38. 這種水果不放冰箱的話，會先有什麼變化？ 請聽這一段話，然後回答下面的兩個問題。 小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不 習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。 他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回 來以後，小周決定下次還要帶家人去美國玩兒。 39. 這段話主要是說什麼？ 40. 下面哪一個是對的？ 請聽這一段廣告，然後回答下面的兩個問題。 寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年 2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只 要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水 果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電 話給我們。 41. 這二十間房間怎麼樣？ 42. 下面哪一個是對的？ 請聽這一段廣播，然後回答兩個問題。 各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會 兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學 離開位子的時候，把重要的東西一起拿走，謝謝！ 43. 學生在圖書館發生什麼事？ 44. 這段廣播提到，學校怎麼處理這個狀況？ 下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題： 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 現在請聽報導。 2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光 景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量 的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這 個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的 歷史氣息？還是，讓人口水直流的地方美食？ 「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出 了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也 就跟著消失？ 這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相 互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三 個問題。 現在請聽報導。 【新聞快訊】 香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金， 根據阿國警方調查，她們可能涉及偷運古董。 阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險， 替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派 指稱，花瓶破損，於是扣留她們的護照加以禁錮。 香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖 的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救 援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極 有用的情報。 48. 這則報導說明了什麼？ 49. 根據報導，兩名少女為什麼要做這些事？ 50. 根據報導，香港警方怎麼處理這件案子？",
        "dialogue": "男：吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置，\n那裡的視野還不錯，可以清楚地看見吳老師演奏。\n女：你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞\n不是重點，你就把錢省下來吧！\n男：這位小姐對這次演奏會的座位有什麼看法？\n請聽這段對話，然後回答兩個問題。\n男：你最近怎麼老躲著小王？\n女：他一直想約我單獨跟他出去，可是…\n男：怎麼了？你好像不太願意？\n女：小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？\n20. 這位小姐對小王的感覺如何？\n21. 對小王的邀請，這位小姐覺得如何？\n請聽這段對話，然後回答下面的兩個問題。\n男：你們又來了，這次又有什麼事？\n女：趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請\n您共襄盛舉，捐點錢救濟災民。\n男：不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道\n就這樣送給你們？\n女：喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放\n心啊！\n男：口說無憑，你不如先寄份帳冊來給我看吧！\n22. 關於這位先生，哪一個是對的？\n23. 這位先生最後的態度怎麼樣？\n下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。\n男：小姐，我覺得這發票上的金額好像不太對。\n女：好的，馬上為您處理。這些一共是500元，金額沒錯。\n男：是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不\n管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡，\n為什麼沒打折？\n女：我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主\n要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能\n享有九折優惠。不好意思，我們店裡並沒有配合這個活動。\n24. 店員和客人發生了什麼事？\n25. 有關宣傳單上的活動說明，下面哪一項是對的？\n請聽這一段和「味精」有關的討論，然後回答兩個問題。\n男：佳美，你看這則味精的報導。\n女：嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過\n另外一篇報告，結果完全相反。\n男：是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就\n不碰吧！\n女：每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也\n還沒證實，所以，你別太擔心了。\n26. 這位先生覺得味精怎麼樣？\n27. 這位小姐的意思是什麼？\n下面是一段兄妹之間的對話，請聽完後，回答下面三個問題：\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n現在請聽對話。\n男：昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還\n來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪\n氣的。\n女：哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘，\n該不會是…\n男：長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘\n的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想\n到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一\n會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n第二部分 段落\n請聽這一段話，然後回答下面的問題。\n小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋\n糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和\n小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小\n青聽了，很高興，也很感謝。\n31. 從這段話可以知道什麼？\n請聽這一段話，然後回答下面的問題。\n如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常\n聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生，\n不過聽音樂絕不會對你造成傷害。\n32. 這段話的意思是什麼？\n請聽這一段電話留言，然後回答下面的兩個問題。\n小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上\n我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影，\n好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。\n33. 阿秀今天下午要做什麼？\n34. 阿秀請小文拿什麼去學校？\n請聽這一段話，然後回答下面的兩個問題。\n昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我\n的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假\n去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後，\n吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就\n不用再吃藥。」\n35. 為什麼說話的人昨天晚上沒睡好？\n36. 醫生說了什麼？\n請聽這一段水果的介紹，然後回答下面的兩個問題。\n這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。\n它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特\n別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰\n箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香，\n放到第四天，不但不好看，也不好吃了。\n37. 這種水果怎麼樣？\n38. 這種水果不放冰箱的話，會先有什麼變化？\n請聽這一段話，然後回答下面的兩個問題。\n小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不\n習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。\n他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回\n來以後，小周決定下次還要帶家人去美國玩兒。\n39. 這段話主要是說什麼？\n40. 下面哪一個是對的？\n請聽這一段廣告，然後回答下面的兩個問題。\n寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年\n2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只\n要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水\n果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電\n話給我們。\n41. 這二十間房間怎麼樣？\n42. 下面哪一個是對的？\n請聽這一段廣播，然後回答兩個問題。\n各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會\n兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學\n離開位子的時候，把重要的東西一起拿走，謝謝！\n43. 學生在圖書館發生什麼事？\n44. 這段廣播提到，學校怎麼處理這個狀況？\n下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題：\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n現在請聽報導。\n2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光\n景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量\n的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這\n個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的\n歷史氣息？還是，讓人口水直流的地方美食？\n「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出\n了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也\n就跟著消失？\n這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相\n互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三\n個問題。\n現在請聽報導。\n【新聞快訊】\n香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金，\n根據阿國警方調查，她們可能涉及偷運古董。\n阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險，\n替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派\n指稱，花瓶破損，於是扣留她們的護照加以禁錮。\n香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖\n的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救\n援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極\n有用的情報。\n48. 這則報導說明了什麼？\n49. 根據報導，兩名少女為什麼要做這些事？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置，"
          },
          {
            "speaker": "narrator",
            "text": "那裡的視野還不錯，可以清楚地看見吳老師演奏。"
          },
          {
            "speaker": "female",
            "text": "你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞"
          },
          {
            "speaker": "narrator",
            "text": "不是重點，你就把錢省下來吧！"
          },
          {
            "speaker": "male",
            "text": "這位小姐對這次演奏會的座位有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "你最近怎麼老躲著小王？"
          },
          {
            "speaker": "female",
            "text": "他一直想約我單獨跟他出去，可是…"
          },
          {
            "speaker": "male",
            "text": "怎麼了？你好像不太願意？"
          },
          {
            "speaker": "female",
            "text": "小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？"
          },
          {
            "speaker": "narrator",
            "text": "20. 這位小姐對小王的感覺如何？"
          },
          {
            "speaker": "narrator",
            "text": "21. 對小王的邀請，這位小姐覺得如何？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段對話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "male",
            "text": "你們又來了，這次又有什麼事？"
          },
          {
            "speaker": "female",
            "text": "趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請"
          },
          {
            "speaker": "narrator",
            "text": "您共襄盛舉，捐點錢救濟災民。"
          },
          {
            "speaker": "male",
            "text": "不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道"
          },
          {
            "speaker": "narrator",
            "text": "就這樣送給你們？"
          },
          {
            "speaker": "female",
            "text": "喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放"
          },
          {
            "speaker": "narrator",
            "text": "心啊！"
          },
          {
            "speaker": "male",
            "text": "口說無憑，你不如先寄份帳冊來給我看吧！"
          },
          {
            "speaker": "narrator",
            "text": "22. 關於這位先生，哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "23. 這位先生最後的態度怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "小姐，我覺得這發票上的金額好像不太對。"
          },
          {
            "speaker": "female",
            "text": "好的，馬上為您處理。這些一共是500元，金額沒錯。"
          },
          {
            "speaker": "male",
            "text": "是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不"
          },
          {
            "speaker": "narrator",
            "text": "管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡，"
          },
          {
            "speaker": "narrator",
            "text": "為什麼沒打折？"
          },
          {
            "speaker": "female",
            "text": "我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主"
          },
          {
            "speaker": "narrator",
            "text": "要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能"
          },
          {
            "speaker": "narrator",
            "text": "享有九折優惠。不好意思，我們店裡並沒有配合這個活動。"
          },
          {
            "speaker": "narrator",
            "text": "24. 店員和客人發生了什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "25. 有關宣傳單上的活動說明，下面哪一項是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段和「味精」有關的討論，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "佳美，你看這則味精的報導。"
          },
          {
            "speaker": "female",
            "text": "嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過"
          },
          {
            "speaker": "narrator",
            "text": "另外一篇報告，結果完全相反。"
          },
          {
            "speaker": "male",
            "text": "是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就"
          },
          {
            "speaker": "narrator",
            "text": "不碰吧！"
          },
          {
            "speaker": "female",
            "text": "每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也"
          },
          {
            "speaker": "narrator",
            "text": "還沒證實，所以，你別太擔心了。"
          },
          {
            "speaker": "narrator",
            "text": "26. 這位先生覺得味精怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "27. 這位小姐的意思是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "下面是一段兄妹之間的對話，請聽完後，回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "28. 這位先生為什麼說他的太太「陰陽怪氣」？"
          },
          {
            "speaker": "narrator",
            "text": "29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "30. 這段對話告訴我們什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽對話。"
          },
          {
            "speaker": "male",
            "text": "昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還"
          },
          {
            "speaker": "narrator",
            "text": "來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪"
          },
          {
            "speaker": "narrator",
            "text": "氣的。"
          },
          {
            "speaker": "female",
            "text": "哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘，"
          },
          {
            "speaker": "narrator",
            "text": "該不會是…"
          },
          {
            "speaker": "male",
            "text": "長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘"
          },
          {
            "speaker": "narrator",
            "text": "的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想"
          },
          {
            "speaker": "narrator",
            "text": "到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一"
          },
          {
            "speaker": "narrator",
            "text": "會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！"
          },
          {
            "speaker": "narrator",
            "text": "28. 這位先生為什麼說他的太太「陰陽怪氣」？"
          },
          {
            "speaker": "narrator",
            "text": "29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "30. 這段對話告訴我們什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "第二部分 段落"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋"
          },
          {
            "speaker": "narrator",
            "text": "糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和"
          },
          {
            "speaker": "narrator",
            "text": "小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小"
          },
          {
            "speaker": "narrator",
            "text": "青聽了，很高興，也很感謝。"
          },
          {
            "speaker": "narrator",
            "text": "31. 從這段話可以知道什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常"
          },
          {
            "speaker": "narrator",
            "text": "聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生，"
          },
          {
            "speaker": "narrator",
            "text": "不過聽音樂絕不會對你造成傷害。"
          },
          {
            "speaker": "narrator",
            "text": "32. 這段話的意思是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段電話留言，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上"
          },
          {
            "speaker": "narrator",
            "text": "我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影，"
          },
          {
            "speaker": "narrator",
            "text": "好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。"
          },
          {
            "speaker": "narrator",
            "text": "33. 阿秀今天下午要做什麼？"
          },
          {
            "speaker": "narrator",
            "text": "34. 阿秀請小文拿什麼去學校？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我"
          },
          {
            "speaker": "narrator",
            "text": "的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假"
          },
          {
            "speaker": "narrator",
            "text": "去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後，"
          },
          {
            "speaker": "narrator",
            "text": "吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就"
          },
          {
            "speaker": "narrator",
            "text": "不用再吃藥。」"
          },
          {
            "speaker": "narrator",
            "text": "35. 為什麼說話的人昨天晚上沒睡好？"
          },
          {
            "speaker": "narrator",
            "text": "36. 醫生說了什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段水果的介紹，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。"
          },
          {
            "speaker": "narrator",
            "text": "它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特"
          },
          {
            "speaker": "narrator",
            "text": "別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰"
          },
          {
            "speaker": "narrator",
            "text": "箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香，"
          },
          {
            "speaker": "narrator",
            "text": "放到第四天，不但不好看，也不好吃了。"
          },
          {
            "speaker": "narrator",
            "text": "37. 這種水果怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "38. 這種水果不放冰箱的話，會先有什麼變化？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不"
          },
          {
            "speaker": "narrator",
            "text": "習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。"
          },
          {
            "speaker": "narrator",
            "text": "他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回"
          },
          {
            "speaker": "narrator",
            "text": "來以後，小周決定下次還要帶家人去美國玩兒。"
          },
          {
            "speaker": "narrator",
            "text": "39. 這段話主要是說什麼？"
          },
          {
            "speaker": "narrator",
            "text": "40. 下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段廣告，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年"
          },
          {
            "speaker": "narrator",
            "text": "2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只"
          },
          {
            "speaker": "narrator",
            "text": "要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水"
          },
          {
            "speaker": "narrator",
            "text": "果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電"
          },
          {
            "speaker": "narrator",
            "text": "話給我們。"
          },
          {
            "speaker": "narrator",
            "text": "41. 這二十間房間怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "42. 下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段廣播，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會"
          },
          {
            "speaker": "narrator",
            "text": "兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學"
          },
          {
            "speaker": "narrator",
            "text": "離開位子的時候，把重要的東西一起拿走，謝謝！"
          },
          {
            "speaker": "narrator",
            "text": "43. 學生在圖書館發生什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "44. 這段廣播提到，學校怎麼處理這個狀況？"
          },
          {
            "speaker": "narrator",
            "text": "下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "45. 根據報導，小鎮為什麼成為新的景點？"
          },
          {
            "speaker": "narrator",
            "text": "46. 根據報導，這部電影對小鎮造成什麼影響？"
          },
          {
            "speaker": "narrator",
            "text": "47. 記者對當地飯店的經營者，提出哪些建議？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光"
          },
          {
            "speaker": "narrator",
            "text": "景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量"
          },
          {
            "speaker": "narrator",
            "text": "的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這"
          },
          {
            "speaker": "narrator",
            "text": "個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的"
          },
          {
            "speaker": "narrator",
            "text": "歷史氣息？還是，讓人口水直流的地方美食？"
          },
          {
            "speaker": "narrator",
            "text": "「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出"
          },
          {
            "speaker": "narrator",
            "text": "了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也"
          },
          {
            "speaker": "narrator",
            "text": "就跟著消失？"
          },
          {
            "speaker": "narrator",
            "text": "這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相"
          },
          {
            "speaker": "narrator",
            "text": "互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。"
          },
          {
            "speaker": "narrator",
            "text": "45. 根據報導，小鎮為什麼成為新的景點？"
          },
          {
            "speaker": "narrator",
            "text": "46. 根據報導，這部電影對小鎮造成什麼影響？"
          },
          {
            "speaker": "narrator",
            "text": "47. 記者對當地飯店的經營者，提出哪些建議？"
          },
          {
            "speaker": "narrator",
            "text": "香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三"
          },
          {
            "speaker": "narrator",
            "text": "個問題。"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "【新聞快訊】"
          },
          {
            "speaker": "narrator",
            "text": "香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金，"
          },
          {
            "speaker": "narrator",
            "text": "根據阿國警方調查，她們可能涉及偷運古董。"
          },
          {
            "speaker": "narrator",
            "text": "阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險，"
          },
          {
            "speaker": "narrator",
            "text": "替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派"
          },
          {
            "speaker": "narrator",
            "text": "指稱，花瓶破損，於是扣留她們的護照加以禁錮。"
          },
          {
            "speaker": "narrator",
            "text": "香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖"
          },
          {
            "speaker": "narrator",
            "text": "的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救"
          },
          {
            "speaker": "narrator",
            "text": "援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極"
          },
          {
            "speaker": "narrator",
            "text": "有用的情報。"
          },
          {
            "speaker": "narrator",
            "text": "48. 這則報導說明了什麼？"
          },
          {
            "speaker": "narrator",
            "text": "49. 根據報導，兩名少女為什麼要做這些事？"
          },
          {
            "speaker": "narrator",
            "text": "50. 根據報導，香港警方怎麼處理這件案子？"
          }
        ],
        "q": "50. 根據報導，香港警方怎麼處理這件案子？",
        "options": [
          "二樓的視野比一樓好多了",
          "她認為這位先生的建議不錯",
          "一樓的票太貴了，她付不起",
          "沒必要考慮能不能看見表演者"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 沒必要考慮能不能看見表演者. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 20",
        "options": [
          "只想維持普通朋友的關係",
          "想進一步了解小王的為人",
          "覺得小王是不錯的交往對象",
          "和小王聊天一點意思也沒有"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 只想維持普通朋友的關係. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 21",
        "options": [
          "非常厭惡",
          "充滿期待",
          "不怎麼在乎",
          "不知怎麼處理"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不知怎麼處理. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 22",
        "options": [
          "他從來就沒捐過錢",
          "他不知道捐款的去向",
          "他自己也是水災災民",
          "他覺得自己捐的錢不夠多"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 他不知道捐款的去向. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 23",
        "options": [
          "他請對方把錢還給他",
          "他決定幫對方一起募款",
          "他請對方提出證明再說",
          "他覺得對方有誠意，答應捐錢"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 他請對方提出證明再說. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 24",
        "options": [
          "店員打錯發票",
          "店員算錯金額",
          "客人拿錯商品",
          "客人跑錯商店"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 客人跑錯商店. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 25",
        "options": [
          "若要享受折扣，得到指定的店家",
          "折扣活動從今年初到這個月月底",
          "這個活動是附近商店聯合舉辦的",
          "在這個月內消費就可以加入會員"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 若要享受折扣，得到指定的店家. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 1: Chọn từ thích hợp nhất điền vào chỗ trống [1].",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng thể bị động '被'送進了醫院 (được đưa vào viện).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 2: Chọn từ thích hợp nhất điền vào chỗ trống [2].",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'陪'張太太 (đi cùng vợ).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 3: Chọn từ thích hợp nhất điền vào chỗ trống [3].",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'當'爸爸 (làm cha).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 4: Chọn từ thích hợp nhất điền vào chỗ trống [4].",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'為'這個孩子 (nghĩ tên 'cho' con).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 5: Chọn từ thích hợp nhất điền vào chỗ trống [5].",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'希望' (hy vọng sau này vừa đẹp vừa vui).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 6: Chọn từ thích hợp nhất điền vào chỗ trống [6].",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Cụm cố định '大學時代' (thời đại học).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 7: Chọn từ thích hợp nhất điền vào chỗ trống [7].",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp.",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 8: Chọn từ thích hợp nhất điền vào chỗ trống [8].",
        "options": [
          "忽然",
          "總是",
          "隨時",
          "從來"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'忽然'想起 (đột nhiên nhớ lại).",
        "pinyin": ""
      },
      {
        "id": 34,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 9: Chọn từ thích hợp nhất điền vào chỗ trống [9].",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'照'著地址 (lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 10: Chọn từ thích hợp nhất điền vào chỗ trống [10].",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp lại).",
        "pinyin": ""
      },
      {
        "id": 36,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 11: Chọn từ thích hợp nhất điền vào chỗ trống [11].",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'安排'戶外活動 (sắp xếp thời gian vận động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 37,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 12: Chọn từ thích hợp nhất điền vào chỗ trống [12].",
        "options": [
          "影響",
          "阻礙",
          "促進",
          "代替"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'促進'吸收 (thúc đẩy hấp thụ vitamin D).",
        "pinyin": ""
      },
      {
        "id": 38,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 13: Chọn từ thích hợp nhất điền vào chỗ trống [13].",
        "options": [
          "常常",
          "總是",
          "不斷",
          "難免"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'總是'在室內看螢幕 (luôn ở trong phòng xem màn hình).",
        "pinyin": ""
      },
      {
        "id": 39,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 14: Chọn từ thích hợp nhất điền vào chỗ trống [14].",
        "options": [
          "維護",
          "修理",
          "整理",
          "保證"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'維護'視力健康 (bảo vệ / duy trì sức khỏe thị lực).",
        "pinyin": ""
      },
      {
        "id": 40,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 15: Chọn từ thích hợp nhất điền vào chỗ trống [15].",
        "options": [
          "不能",
          "不要",
          "不可",
          "不必"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'不可'輕視 (tuyệt đối không được xem nhẹ).",
        "pinyin": ""
      },
      {
        "id": 41,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "dialogueSegments": [],
        "q": "Câu 16: 下面哪一個敘述完全符合短文內容？",
        "options": [
          "小明已經造訪韓國兩次了",
          "小明在韓國住了四個晚上",
          "小明覺得韓國食物不合胃口",
          "小明打算去日本留學"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết rõ: '玩了五天四夜' nghĩa là ở lại 4 đêm (四個晚上).",
        "pinyin": ""
      },
      {
        "id": 42,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 面對孩子成長的母親\n孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "dialogueSegments": [],
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，採取什麼態度？",
        "options": [
          "嚴厲責備孩子的膽怯",
          "答應明天親自開車接送",
          "鼓勵孩子勇敢獨立面對",
          "感到不知所措而焦慮"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ khuyến khích: '你要學會自己面對挑戰' (động viên con dũng cảm tự đối diện).",
        "pinyin": ""
      },
      {
        "id": 43,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北夜市行動支付普及化\n以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "audio": "",
        "dialogue": "以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "dialogueSegments": [],
        "q": "Câu 18: 夜市引入行動支付帶來哪一項核心效益？",
        "options": [
          "大幅降低商品售價",
          "結帳更快速並兼顧衛生",
          "夜市營業時間延長至白天",
          "所有攤商免繳營業稅"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Văn bản nêu: '減少了排隊找零的時間, 也大幅降低了衛生疑慮' (thanh toán nhanh hơn và vệ sinh hơn).",
        "pinyin": ""
      },
      {
        "id": 44,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 捷運站二手書漂書箱與愛心傘\n台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "audio": "",
        "dialogue": "台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "dialogueSegments": [],
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪項優勢？",
        "options": [
          "列車行駛速度領先全球",
          "兼具人情味與信任的便民服務",
          "站內車廂提供免費餐飲",
          "票價比其他交通工具便宜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả ngợi ca: '兼具人情味與信任的便民服務' (dịch vụ tiện dân ấm áp tình người dựa trên sự tin tưởng).",
        "pinyin": ""
      },
      {
        "id": 45,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北市垃圾費隨袋徵收政策成效\n台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "audio": "",
        "dialogue": "台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "dialogueSegments": [],
        "q": "Câu 20: 『垃圾費隨袋徵收』政策為何能有效減少垃圾量？",
        "options": [
          "市民為了省買垃圾袋的錢而努力做資源回收",
          "規定每戶每週最多只能丟一包垃圾",
          "禁止市民在超市購買塑膠袋包裝的食品",
          "提高亂丟垃圾的罰款金額十倍以上"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Vì rác tái chế miễn phí còn rác thường tốn tiền mua túi, người dân tích cực phân loại để tiết kiệm chi phí mua túi rác.",
        "pinyin": ""
      },
      {
        "id": 46,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 高鐵串連台灣南北一日生活圈\n自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "audio": "",
        "dialogue": "自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "dialogueSegments": [],
        "q": "Câu 21: 『一日生活圈』對人們生活產生的實質改變是什麼？",
        "options": [
          "商務出差不必再在外地過夜",
          "民眾紛紛將戶籍遷往南部",
          "高鐵票價全面降至台鐵水準",
          "飛機成為國內最受歡迎的航線"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn nêu buổi sáng họp Đài Bắc, chiều tới Nam Bộ, tối về lại nhà (đi lại trong ngày không cần ở qua đêm).",
        "pinyin": ""
      },
      {
        "id": 47,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣全民健保雲端醫療資訊系統\n台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "audio": "",
        "dialogue": "台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "dialogueSegments": [],
        "q": "Câu 22: 健保雲端資訊系統的主要優勢是什麼？",
        "options": [
          "自動為病患減免掛號費用",
          "跨院即時查詢用藥紀錄避免重複開藥",
          "病患可在家自行線上開刀治療",
          "直接向國外藥廠訂購廉價藥品"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn nêu rõ: '即時調閱檢查報告及用藥紀錄, 有效防範了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 48,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 誠品書店二十四小時營運的文化底蘊\n誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "dialogueSegments": [],
        "q": "Câu 23: 誠品書店之所以被譽為深夜文化地標，是因為什麼？",
        "options": [
          "深夜購書享有半價折扣",
          "結合文創美學將閱讀轉化為生活哲學",
          "只允許專業作家進入借閱圖書",
          "是台北市唯一的實體書店"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả chỉ rõ: '將單純的購書行為昇華為一種優雅慢活的生活哲學'.",
        "pinyin": ""
      },
      {
        "id": 49,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 美食外送平台對都會生活型態的衝擊\n隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "audio": "",
        "dialogue": "隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "dialogueSegments": [],
        "q": "Câu 24: 作者對於美食外送服務的蓬勃發展抱持何種看法？",
        "options": [
          "認為便利之餘亦伴隨交通與環保等社會隱憂",
          "強烈主張政府應立法全面禁止外送App",
          "認為外送餐點品質大幅超越店內現煮",
          "覺得外送員的薪資過高不合理"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Tác giả chỉ rõ: '伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題, 亟需深入探討' (tiện lợi nhưng tiềm ẩn nguy cơ giao thông và môi trường).",
        "pinyin": ""
      },
      {
        "id": 50,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 傳統菜市場的人情溫度與文化生命力\n儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "dialogueSegments": [],
        "q": "Câu 25: 傳統市場至今依然深受廣大民眾喜愛的核心魅力何在？",
        "options": [
          "冷氣空調比超市更強大涼爽",
          "濃厚的街坊人情味與客製化的人際互動",
          "所有生鮮蔬果皆由國外高價空運進口",
          "營業時間全天二十四小時不中斷"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả nhấn mạnh: '充滿街坊問候的人情溫度與鮮活的在地風土' (tình người nồng hậu và giao tiếp tương tác thân tình).",
        "pinyin": ""
      }
    ]
  },
  {
    "id": "mock_b4",
    "title": "TOCFL Band B - Đề thi Chuẩn 4 (Official Mock 4)",
    "band": "Band B (高階·流利)",
    "badge": "Chuẩn SC-TOP CAT",
    "duration": 60,
    "totalQ": 50,
    "desc": "Bộ đề thi số 4 trích từ kỳ thi thực tế: khảo sát thị trường, phỏng vấn tuyển dụng, mua sắm và hoạt động văn hóa.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "最近老是下雨，我都不能去外面運動。 下雨天，就去運動中心裡面運動啊！ 這位小姐的意思是什麼？",
        "dialogue": "男：最近老是下雨，我都不能去外面運動。\n女：下雨天，就去運動中心裡面運動啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "最近老是下雨，我都不能去外面運動。"
          },
          {
            "speaker": "female",
            "text": "下雨天，就去運動中心裡面運動啊！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "在戶外運動比較健康",
          "下雨天運動，很不方便",
          "不管天氣怎樣，都可以運動",
          "天氣不好也要去公園動一動"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 不管天氣怎樣，都可以運動. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "你看，大明這次表演得可真生動。 對啊，這次是他最拿手的角色，他當然發揮得很好。 請問大明怎麼樣？",
        "dialogue": "男：你看，大明這次表演得可真生動。\n女：對啊，這次是他最拿手的角色，他當然發揮得很好。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "你看，大明這次表演得可真生動。"
          },
          {
            "speaker": "female",
            "text": "對啊，這次是他最拿手的角色，他當然發揮得很好。"
          },
          {
            "speaker": "male",
            "text": "請問大明怎麼樣？"
          }
        ],
        "q": "請問大明怎麼樣？",
        "options": [
          "他非常喜歡運動",
          "他什麼角色都能演",
          "他不太熟悉這個角色",
          "他這次的表演十分精彩"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他這次的表演十分精彩. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "聽說公司的主管決定讓剛加入公司的職員接受基礎訓練。 嗯！這樣才能讓新人馬上進入情況啊！ 這位小姐提到的「新人」，指的是什麼？",
        "dialogue": "男：聽說公司的主管決定讓剛加入公司的職員接受基礎訓練。\n女：嗯！這樣才能讓新人馬上進入情況啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "聽說公司的主管決定讓剛加入公司的職員接受基礎訓練。"
          },
          {
            "speaker": "female",
            "text": "嗯！這樣才能讓新人馬上進入情況啊！"
          },
          {
            "speaker": "male",
            "text": "這位小姐提到的「新人」，指的是什麼？"
          }
        ],
        "q": "這位小姐提到的「新人」，指的是什麼？",
        "options": [
          "新婚的夫妻",
          "剛交往的人",
          "剛畢業的人",
          "新進公司的員工"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 新進公司的員工. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我想買這雙鞋，可是我帶的錢不夠。 放心吧！我可以借給你。 這位小姐的意思是什麼？",
        "dialogue": "男：我想買這雙鞋，可是我帶的錢不夠。\n女：放心吧！我可以借給你。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我想買這雙鞋，可是我帶的錢不夠。"
          },
          {
            "speaker": "female",
            "text": "放心吧！我可以借給你。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "這位先生還是別買了吧",
          "她要送給這位先生一雙鞋",
          "這位先生可以先用她的錢買",
          "這位先生可以先拿回去再付錢"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 這位先生可以先用她的錢買. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "今天我請客，妳想吃什麼都隨便妳。 我什麼都吃，雖然我很餓，但是只要你方便就好了。 請問這位小姐的意思是什麼？",
        "dialogue": "男：今天我請客，妳想吃什麼都隨便妳。\n女：我什麼都吃，雖然我很餓，但是只要你方便就好了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "今天我請客，妳想吃什麼都隨便妳。"
          },
          {
            "speaker": "female",
            "text": "我什麼都吃，雖然我很餓，但是只要你方便就好了。"
          },
          {
            "speaker": "male",
            "text": "請問這位小姐的意思是什麼？"
          }
        ],
        "q": "請問這位小姐的意思是什麼？",
        "options": [
          "她不隨便吃東西",
          "她只想吃一點東西",
          "她不想給這位先生方便",
          "她不想讓這位先生太麻煩"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她不想讓這位先生太麻煩. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小姐，不好意思。妳手上那把雨傘好像是我的。 啊，真抱歉，這傘跟我的很像。 這位小姐做了什麼？",
        "dialogue": "男：小姐，不好意思。妳手上那把雨傘好像是我的。\n女：啊，真抱歉，這傘跟我的很像。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小姐，不好意思。妳手上那把雨傘好像是我的。"
          },
          {
            "speaker": "female",
            "text": "啊，真抱歉，這傘跟我的很像。"
          },
          {
            "speaker": "male",
            "text": "這位小姐做了什麼？"
          }
        ],
        "q": "這位小姐做了什麼？",
        "options": [
          "向這位先生借傘",
          "請這位先生還她傘",
          "拿了這位先生的傘",
          "把這位先生的傘弄丟了"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 拿了這位先生的傘. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "唉！終於把報告都弄好了。 是啊！誰知道要準備的東西那麼多。 這位小姐的意思是什麼？",
        "dialogue": "男：唉！終於把報告都弄好了。\n女：是啊！誰知道要準備的東西那麼多。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "唉！終於把報告都弄好了。"
          },
          {
            "speaker": "female",
            "text": "是啊！誰知道要準備的東西那麼多。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她一直覺得做這件事很困難",
          "她一開始以為只是小事一件",
          "她一開始就把東西準備好了",
          "她覺得事情沒有她想的複雜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她一開始以為只是小事一件. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳看起來不太開心，是不是不喜歡今天的活動？ 活動的安排我很滿意，只是在人多的地方，我就會覺得不自在。 這位小姐為什麼不太開心？",
        "dialogue": "男：妳看起來不太開心，是不是不喜歡今天的活動？\n女：活動的安排我很滿意，只是在人多的地方，我就會覺得不自在。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳看起來不太開心，是不是不喜歡今天的活動？"
          },
          {
            "speaker": "female",
            "text": "活動的安排我很滿意，只是在人多的地方，我就會覺得不自在。"
          },
          {
            "speaker": "male",
            "text": "這位小姐為什麼不太開心？"
          }
        ],
        "q": "這位小姐為什麼不太開心？",
        "options": [
          "活動的時間太長",
          "活動安排得不好",
          "不滿意活動的地點",
          "覺得參加活動的人太多"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 覺得參加活動的人太多. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我的皮膚最近變得很乾，還紅紅的，我得去看醫生。 不必！你別一天洗太多次澡就好了。雖然洗澡讓你精神好，但是對皮膚很不 好。 這位小姐的意思是什麼？",
        "dialogue": "男：我的皮膚最近變得很乾，還紅紅的，我得去看醫生。\n女：不必！你別一天洗太多次澡就好了。雖然洗澡讓你精神好，但是對皮膚很不\n好。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我的皮膚最近變得很乾，還紅紅的，我得去看醫生。"
          },
          {
            "speaker": "female",
            "text": "不必！你別一天洗太多次澡就好了。雖然洗澡讓你精神好，但是對皮膚很不"
          },
          {
            "speaker": "narrator",
            "text": "好。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "拼命洗澡會傷害皮膚",
          "要按照醫生說的方法洗澡",
          "精神不好的時候，就去洗澡",
          "要這位先生提供保養皮膚的方式"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 拼命洗澡會傷害皮膚. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "可能還要再等十分鐘，飯才會煮好。 怎麼那麼慢啊！ 這位小姐的意思是什麼？",
        "dialogue": "男：可能還要再等十分鐘，飯才會煮好。\n女：怎麼那麼慢啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "可能還要再等十分鐘，飯才會煮好。"
          },
          {
            "speaker": "female",
            "text": "怎麼那麼慢啊！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "太慢了吧",
          "慢一點比較好",
          "慢慢來沒關係",
          "太快了，慢一點吧"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 太慢了吧. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "喂，小玲，我忙不過來了，我帶些資料過去給妳，妳幫我整理一下好不好？ 好啊！可是我現在不在家，你要過來時，先打電話給我，免得白跑一趟。 請問下面哪一個是對的？",
        "dialogue": "男：喂，小玲，我忙不過來了，我帶些資料過去給妳，妳幫我整理一下好不好？\n女：好啊！可是我現在不在家，你要過來時，先打電話給我，免得白跑一趟。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "喂，小玲，我忙不過來了，我帶些資料過去給妳，妳幫我整理一下好不好？"
          },
          {
            "speaker": "female",
            "text": "好啊！可是我現在不在家，你要過來時，先打電話給我，免得白跑一趟。"
          },
          {
            "speaker": "male",
            "text": "請問下面哪一個是對的？"
          }
        ],
        "q": "請問下面哪一個是對的？",
        "options": [
          "這位小姐不想白跑一趟",
          "這位先生希望有人可以幫他",
          "這位先生找這位小姐要資料",
          "這位小姐打電話要這位先生回家"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 這位先生希望有人可以幫他. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳選的這些家具品質跟顏色都很好，真有眼光。但是床舖放的位置有一點奇 怪，改變一下會更好。 謝謝你的建議，不過我聽說家具怎麼放跟運氣有關係，所以我要維持現在的 樣子。 這位小姐打算怎麼做？",
        "dialogue": "男：妳選的這些家具品質跟顏色都很好，真有眼光。但是床舖放的位置有一點奇\n怪，改變一下會更好。\n女：謝謝你的建議，不過我聽說家具怎麼放跟運氣有關係，所以我要維持現在的\n樣子。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳選的這些家具品質跟顏色都很好，真有眼光。但是床舖放的位置有一點奇"
          },
          {
            "speaker": "narrator",
            "text": "怪，改變一下會更好。"
          },
          {
            "speaker": "female",
            "text": "謝謝你的建議，不過我聽說家具怎麼放跟運氣有關係，所以我要維持現在的"
          },
          {
            "speaker": "narrator",
            "text": "樣子。"
          },
          {
            "speaker": "male",
            "text": "這位小姐打算怎麼做？"
          }
        ],
        "q": "這位小姐打算怎麼做？",
        "options": [
          "聽這位先生的建議",
          "不改變放床的地方",
          "選樣子更好看的床",
          "詢問其他人的想法"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 不改變放床的地方. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "坐飛機不是比坐火車快嗎？ 火車雖然慢，但是比較安全，也比較便宜，還可以慢慢看風景，這樣不是很 好嗎？ 這位小姐的意思是什麼？",
        "dialogue": "男：坐飛機不是比坐火車快嗎？\n女：火車雖然慢，但是比較安全，也比較便宜，還可以慢慢看風景，這樣不是很\n好嗎？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "坐飛機不是比坐火車快嗎？"
          },
          {
            "speaker": "female",
            "text": "火車雖然慢，但是比較安全，也比較便宜，還可以慢慢看風景，這樣不是很"
          },
          {
            "speaker": "narrator",
            "text": "好嗎？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她覺得坐火車太慢了",
          "她不想坐太便宜的火車",
          "她覺得坐火車也不太安全",
          "她認為坐火車的好處很多"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她認為坐火車的好處很多. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "聽完我們的報告，不知道貴公司能否讓我們參與這項計畫？ 如果是你們剛提的那些資訊技術，我的團隊就能做到了。 這位小姐的意思是什麼？",
        "dialogue": "男：聽完我們的報告，不知道貴公司能否讓我們參與這項計畫？\n女：如果是你們剛提的那些資訊技術，我的團隊就能做到了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "聽完我們的報告，不知道貴公司能否讓我們參與這項計畫？"
          },
          {
            "speaker": "female",
            "text": "如果是你們剛提的那些資訊技術，我的團隊就能做到了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她想找人成立資訊技術團隊",
          "這項計畫案裡要有她公司的人",
          "她沒有搞清楚整體產業的需求",
          "這位先生的報告不符合她的期待"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位先生的報告不符合她的期待. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我們去外面吃飯吧！比較方便。 外面的食物哪有家裡自己做的營養衛生啊？ 偶爾吃一次，換換口味嘛！ 不行，這樣久了也會傷害健康。 請問下面哪一個是對的？",
        "dialogue": "男：我們去外面吃飯吧！比較方便。\n女：外面的食物哪有家裡自己做的營養衛生啊？\n男：偶爾吃一次，換換口味嘛！\n女：不行，這樣久了也會傷害健康。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我們去外面吃飯吧！比較方便。"
          },
          {
            "speaker": "female",
            "text": "外面的食物哪有家裡自己做的營養衛生啊？"
          },
          {
            "speaker": "male",
            "text": "偶爾吃一次，換換口味嘛！"
          },
          {
            "speaker": "female",
            "text": "不行，這樣久了也會傷害健康。"
          },
          {
            "speaker": "male",
            "text": "請問下面哪一個是對的？"
          }
        ],
        "q": "請問下面哪一個是對的？",
        "options": [
          "這位小姐覺得外食對身體不好",
          "這位先生覺得外食的口味不好",
          "這位小姐覺得出門吃飯太麻煩了",
          "這位先生覺得這位小姐想換口味"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 這位小姐覺得外食對身體不好. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小姐，這是昨天跟你們買的牛奶，味道有點奇怪，我想換一瓶新的。 請問您帶了發票嗎？ 喔，我沒帶來。 我們要看到發票，才能換東西，不好意思。 這位小姐的意思是什麼？",
        "dialogue": "男：小姐，這是昨天跟你們買的牛奶，味道有點奇怪，我想換一瓶新的。\n女：請問您帶了發票嗎？\n男：喔，我沒帶來。\n女：我們要看到發票，才能換東西，不好意思。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小姐，這是昨天跟你們買的牛奶，味道有點奇怪，我想換一瓶新的。"
          },
          {
            "speaker": "female",
            "text": "請問您帶了發票嗎？"
          },
          {
            "speaker": "male",
            "text": "喔，我沒帶來。"
          },
          {
            "speaker": "female",
            "text": "我們要看到發票，才能換東西，不好意思。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她要把錢還給客人",
          "東西賣出去就不能換了",
          "她沒有東西可以換給客人",
          "沒有發票，就不能換東西"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 沒有發票，就不能換東西. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "這間健身房的設備很好。 可是我不喜歡他們的舞蹈課程。 看在交通方便、價錢也還可以的份上，我們就加入會員吧！ 等等，你先別急，我還要考慮考慮。 關於這間健身房，這位先生覺得怎麼樣？ 請聽這段和書法有關的對話，然後回答兩個問題。 唉，我這次參加比賽還是沒有得名。為了再進步一些，我決定每天把這些大 師寫的字都練習一遍。 書法就像畫畫一樣，字寫得好不好，要看空間的安排，比如空白的比例、顏 色的濃淡都會影響一幅作品的評價。 這幾個部分我認為我做得很好啊！你看我寫的這些。 哇，沒想到你寫得這麼棒，幾乎跟大師寫的一模一樣。 所以我也不知道為什麼我沒有得獎。 是不是因為缺乏自我風格呢？你不如練習寫自己的字，不要練習寫大師的字 了。 18. 這位小姐對寫書法這件事有什麼看法？ 19. 這位小姐覺得這位先生的作品怎麼樣？ 請聽這段和結帳有關的對話，然後回答兩個問題。 我要的東西都挑好了，我們一起結帳吧！ 不必幫我付，分開算就行了，喔，這是我的會員卡。 你的會員卡可沒我這張卡厲害，今天刷我這張信用卡，可以拿到兩倍點數喔！ 先讓我一起刷卡，你再算算你買的部分要給我多少錢。 點數可以做什麼？打折嗎？ 點數不是用來抵折扣的。你每刷一次卡都會產生點數，有了一定點數以後， 就可以換禮品。你看，這個購物袋就是用這些點數換來的。 沒想到有這種好處啊，那讓你刷卡，我不就損失了嗎！下次我可要帶張信用 卡來買。 20. 為什麼這位先生覺得損失了？ 21. 從對話中可以知道什麼？ 請聽這段和吃藥有關的對話，然後回答兩個問題。 老公，你把水壺放在哪裡？該餵孩子吃藥了。 你不是都隨身帶著一瓶水的嗎？ 我不是跟你說我今天不帶，要你在車上放個水壺嗎？因為那個瓶子關不緊， 還把我的背包都弄濕了呀！ 對不起，我忘了。就用果汁吧，等我一下，我找找……我明明記得果汁放在 後面…… 你竟然想用果汁配藥吃？吃藥配水，才是最正確的方式。等一會兒看到便利 商店，你下車買一瓶水吧！ 22. 這位先生對吃藥這件事的想法是什麼？ 23. 在對話中，這位小姐提到什麼？ 請聽這一段和孩子用錢觀念有關的對話，然後回答兩個問題。 我不是才剛給大明生活費用嗎？怎麼又缺錢了？ 他的娛樂活動不少，花費當然不小。他要就給、他要就給，我們不都一直這 麼做嗎？ 我每天辛苦賺錢，希望能滿足一家人的物質生活，但是像大明這種花錢方式， 我實在不贊同。 你怎麼現在態度忽然改變了？ 現在他長大了，不該老是伸手要錢，他得學習靠自己的勞力賺錢，才能在社 會上生存。 那我們跟大明好好溝通這個觀念吧！ 24. 這位小姐認為大明伸手要錢的原因是什麼？ 25. 這位先生對於大明的看法是什麼？ 下面是兩個同學之間的對話。請你在聽完這段對話後，回答下面三個問題： Ⅰ. 這位女生為什麼要開始寫網路日記？ Ⅱ. 這位女生認為網路日記有什麼功能？ Ⅲ. 這位男生覺得網路日記怎麼樣？ 現在請聽對話。 你可以推薦我一個功能比較多的網路日記網站嗎？ 好啊！不過，你不是不愛寫文章的嗎？怎麼突然要開始寫日記？ 昨天新聞報導不是說了，現在很多企業找人，會到這個人的網路日記裡觀察 他個性好不好、專業知識夠不夠，也會看他一般文章寫得怎麼樣。 所以你打算利用它來找工作嗎？ 是啊！我又沒什麼工作經驗，也不是反應很快的人。透過文字跟圖片是比較 能表現自己的方法。不愛也得強迫自己寫。 說的也是，而且發現錯了隨時能更改。不過我可要提醒你一件事。網路日記 是公開的文章，不是私人的記事本。 那是什麼意思？ 就是別在你的網路日記上亂抱怨，如果老闆看到你在日記裡抱怨工作或同事， 對你就有扣分作用，還是小心一點好。 26. 這位女生為什麼要開始寫網路日記？ 27. 這位女生認為網路日記有什麼功能？ 28. 這位男生覺得網路日記怎麼樣？ 請聽這一段和政府補助金有關的討論，然後回答三個問題： Ⅰ. 民眾覺得這項政策怎麼樣？ Ⅱ. 下面哪一個是政府提供補助金的對象？ Ⅲ. 關於對話中的兩個人，目前的狀況如何？ 現在請聽討論。 最近失業的問題越來越嚴重，政府上個月三號和專家學者，開了一個會，討 論出一些新辦法和新措施。 我也聽說了。這個政策要從元旦開始實施。如果失業超過三個月，政府就每 個月補助六千元。 六千塊的補助金額恐怕還是不夠。尤其是中年人口，大多數都還要照顧年老 父母跟還沒獨立的小孩。我看，光是繳孩子的教育費用，就一點也不剩了吧！ 你說得對，這就是為什麼政府才剛把消息公布出來，就受到民眾的批評。最 麻煩的是，失業的人還要親自到相關單位填申請表，交出自己失業的資料。 你知道得可真多，我現在才曉得你這麼關心社會大眾的相關問題呢。 還好啦！誰叫我下個禮拜就要陪我的丈夫去申請補助呢，不把這些條件讀熟 一點可不行啊！ 29. 民眾覺得這項政策怎麼樣？ 30. 下面哪一個是政府提供補助金的對象？ 31. 關於對話中的兩個人，目前的狀況如何？ 第二部分 段落 請聽這一段話，然後回答下面的問題。 這次出國旅行，我決定不帶信用卡出門了。因為刷卡實在是太方便了，讓我 花錢的時候一點兒感覺都沒有，不像用現金時還得一張一張數。以前每次出國都 會亂買一大堆不實用的東西，一回到家馬上就後悔了，結果既不能退也不能換， 真是浪費錢又浪費時間！ 32. 這個人為什麼決定不帶信用卡出國？ 請聽這一段話，然後回答下面的問題。 我是一個鄉下人，去大城市讀書以前，有人告訴我城市裡的人都很不客氣， 鄉下的人客氣多了。但是在城市住了三年以後，我覺得不一定是這樣，因為鄉下 也有不客氣的人，城市裡也有客氣的人。 33. 說話的人的想法是什麼？ 請聽這一段話，然後回答下面的問題。 中山足球場離這兒不遠，你不必坐計程車。我告訴你啊，你往前一直走，到 第一個路口左轉，再走十多分鐘就到了；不想走路的話，在這裡搭公車也行，坐 兩站，在中山足球場那一站下車，大概只要五分鐘。 34. 說話的人覺得用什麼方法到足球場比較好？ 請聽這一段電視新聞，然後回答下面的問題。 因為天氣的關係，最近的空氣很髒，大家出門以前，記得把窗戶關上；進門 以前，先把帽子或外套脫下來，再進到屋內。沒事的話，最好留在家裡別出去。 這幾天的天氣大概都是這樣子，下星期空氣就會好一點兒了。 35. 這段新聞主要告訴大家什麼？ 請聽這段和小高有關的話，然後回答兩個問題。 小高本來是一個很隨便的人，但自從跟女朋友交往以後，變得有點兒不一樣。 他開始注意自己的打扮，出門時還要打領帶。甚至在吃的方面也越來越講究，例 如，昨天他就批評我們吃太多肉對身體不好，不跟我們一起去吃炸雞。今天因為 他女朋友回鄉下去照顧媽媽了，在我們幾個朋友面前，馬上恢復原來的樣子跟態 度。唉！我只能說，愛情的影響力真的好大啊！ 36. 這段話主要提到小高哪一方面的事？ 37. 交女朋友以前，小高是一個怎麼樣的人？ 請聽這段和學業有關的話，然後回答兩個問題。 在我那個年代，高中沒畢業的人也可以找到不錯的工作，所以我的同學們都 不願意去讀大學，認為不僅浪費時間又要花很多錢，還說在大學裡學到的東西對 工作沒有用。但我那時候覺得，要是我也不讀大學，不就跟別人一樣了嗎？以後 我會有競爭力嗎？所以我選了另一條路。現在時代變了，當時很多笑我笨的人， 反而因為自己找工作時的資料不如我，開始後悔當年怎麼不跟我做一樣的選擇。 38. 說話的人一開始提到什麼事？ 39. 根據這段話，現在找工作會遇到什麼情況？ 請聽這段和人的個性有關的話，然後回答兩個問題。 我常聽別人從血型來解釋性格，或是從生日來判斷一個人的脾氣，但是我覺 得這不僅沒道理，也太片面了。 從一個人常做什麼、交什麼朋友、喜歡什麼事物等，來觀察一個人的個性， 或許比較客觀。像是有人分別分析了喜歡養貓與養狗的人，他們的性格，得出了 養狗的人喜歡交朋友，養貓的人喜歡一個人努力。透過觀察得出的結果，我認為 是比較有道理的。 40. 說話的人覺得，透過什麼方式了解個性是沒道理的？ 41. 說話的人對於「個性」有什麼想法？ 請聽這段和治療照顧有關的話，然後回答兩個問題。 小姐，開完刀以後，您父親身體的情況已經改善了不少，會慢慢恢復健康的。 但是因為開刀而造成的傷口比較大，過程中也流了不少血，所以這幾天還是建議 安排他留在我們這裡繼續觀察，等恢復體力後再回家。當然如果您有時間細心照 顧他，也可以今天就辦手續離開，不過一旦開刀的地方又再痛起來，請立刻帶他 回來讓我們檢查。 42. 根據這段話，病人怎麼了？ 43. 醫生有什麼建議？ 請聽這段介紹，然後回答兩個問題。 歡迎您今天來看我們的預售樣品屋。我們預計明年房子和停車場都會蓋好。 住在這裡，您可以享受便利的生活機能，這裡距離高鐵站開車只需要十分鐘。不 論是要到外地出差，還是帶小孩回老家，都非常方便。另外，這裡每一樓都有浴 室，不用擔心孩子搶著洗澡的問題。一樓有一個大房間，很適合給家裡的老人住。 三樓的陽台還可以欣賞美景。接下來請您自由參觀，參觀完了以後，如果有興趣 預訂，請留下您的聯絡方式。 44. 說話的人在向誰介紹？ 45. 關於這個房子，說話的人提到什麼？ 請聽這段和放假有關的話，然後回答兩個問題。 因為人們總是在意他人的眼光，所以即使多數人在假日時，只想好好和自己 相處，但是在害怕自己沒完成朋友或同事推薦的假日旅遊方式，或是害怕自己做 的事不被他人關心的心理壓力下，使得人們在享受假日時，還是不斷地拿起手機 等待朋友與同事的留言。 46. 這段話提到人們對假日的想法是什麼？ 47. 這段話主要提到什麼？ 有時候我們會幻想心愛的人死去。科學家表示，這是當我們在乎、關愛某些人時 必然會經歷的矛盾心理。請聽這段話，然後回答三個問題： Ⅰ. 說話的人對這種矛盾情緒的想法怎麼樣？ Ⅱ. 為什麼會產生這種矛盾的心態？ Ⅲ. 說話的人最後的態度是什麼？ 現在請聽這段話。 對人類來說，家人與朋友十分重要，人們關心他們、想要他們陪伴左右，同 時希望日子過得順心如意。這些對所愛之人的感情，讓人們產生正面與負面情緒 夾雜在一起的矛盾心理，例如，有時候我們會幻想心愛的人死去。對你越重要的 人，你對他們的矛盾情緒就會越強烈。 因為「愛一個人免不了會有挫折」，與所愛的人一起生活有時並不是一件容 易的事。人們無法忍受，應該帶給自己歡樂的人，有時竟造成自己莫大的痛苦。 所以，人們才會對心愛的人產生這種令人不安、甚至近於黑暗的小小願望。 但換個角度想，人生中能有帶給你這些感受的人，也是一種幸運與福氣。說不定 你所愛的人也正在幻想你被一輛快速開過的公車壓得扁扁的。 48. 說話的人對這種矛盾情緒的想法怎麼樣？ 49. 為什麼會產生這種矛盾的心態？ 50. 說話的人最後的態度是什麼？",
        "dialogue": "男：這間健身房的設備很好。\n女：可是我不喜歡他們的舞蹈課程。\n男：看在交通方便、價錢也還可以的份上，我們就加入會員吧！\n女：等等，你先別急，我還要考慮考慮。\n男：關於這間健身房，這位先生覺得怎麼樣？\n請聽這段和書法有關的對話，然後回答兩個問題。\n男：唉，我這次參加比賽還是沒有得名。為了再進步一些，我決定每天把這些大\n師寫的字都練習一遍。\n女：書法就像畫畫一樣，字寫得好不好，要看空間的安排，比如空白的比例、顏\n色的濃淡都會影響一幅作品的評價。\n男：這幾個部分我認為我做得很好啊！你看我寫的這些。\n女：哇，沒想到你寫得這麼棒，幾乎跟大師寫的一模一樣。\n男：所以我也不知道為什麼我沒有得獎。\n女：是不是因為缺乏自我風格呢？你不如練習寫自己的字，不要練習寫大師的字\n了。\n18. 這位小姐對寫書法這件事有什麼看法？\n19. 這位小姐覺得這位先生的作品怎麼樣？\n請聽這段和結帳有關的對話，然後回答兩個問題。\n女：我要的東西都挑好了，我們一起結帳吧！\n男：不必幫我付，分開算就行了，喔，這是我的會員卡。\n女：你的會員卡可沒我這張卡厲害，今天刷我這張信用卡，可以拿到兩倍點數喔！\n先讓我一起刷卡，你再算算你買的部分要給我多少錢。\n男：點數可以做什麼？打折嗎？\n女：點數不是用來抵折扣的。你每刷一次卡都會產生點數，有了一定點數以後，\n就可以換禮品。你看，這個購物袋就是用這些點數換來的。\n男：沒想到有這種好處啊，那讓你刷卡，我不就損失了嗎！下次我可要帶張信用\n卡來買。\n20. 為什麼這位先生覺得損失了？\n21. 從對話中可以知道什麼？\n請聽這段和吃藥有關的對話，然後回答兩個問題。\n女：老公，你把水壺放在哪裡？該餵孩子吃藥了。\n男：你不是都隨身帶著一瓶水的嗎？\n女：我不是跟你說我今天不帶，要你在車上放個水壺嗎？因為那個瓶子關不緊，\n還把我的背包都弄濕了呀！\n男：對不起，我忘了。就用果汁吧，等我一下，我找找……我明明記得果汁放在\n後面……\n女：你竟然想用果汁配藥吃？吃藥配水，才是最正確的方式。等一會兒看到便利\n商店，你下車買一瓶水吧！\n22. 這位先生對吃藥這件事的想法是什麼？\n23. 在對話中，這位小姐提到什麼？\n請聽這一段和孩子用錢觀念有關的對話，然後回答兩個問題。\n男：我不是才剛給大明生活費用嗎？怎麼又缺錢了？\n女：他的娛樂活動不少，花費當然不小。他要就給、他要就給，我們不都一直這\n麼做嗎？\n男：我每天辛苦賺錢，希望能滿足一家人的物質生活，但是像大明這種花錢方式，\n我實在不贊同。\n女：你怎麼現在態度忽然改變了？\n男：現在他長大了，不該老是伸手要錢，他得學習靠自己的勞力賺錢，才能在社\n會上生存。\n女：那我們跟大明好好溝通這個觀念吧！\n24. 這位小姐認為大明伸手要錢的原因是什麼？\n25. 這位先生對於大明的看法是什麼？\n下面是兩個同學之間的對話。請你在聽完這段對話後，回答下面三個問題：\nⅠ. 這位女生為什麼要開始寫網路日記？\nⅡ. 這位女生認為網路日記有什麼功能？\nⅢ. 這位男生覺得網路日記怎麼樣？\n現在請聽對話。\n女：你可以推薦我一個功能比較多的網路日記網站嗎？\n男：好啊！不過，你不是不愛寫文章的嗎？怎麼突然要開始寫日記？\n女：昨天新聞報導不是說了，現在很多企業找人，會到這個人的網路日記裡觀察\n他個性好不好、專業知識夠不夠，也會看他一般文章寫得怎麼樣。\n男：所以你打算利用它來找工作嗎？\n女：是啊！我又沒什麼工作經驗，也不是反應很快的人。透過文字跟圖片是比較\n能表現自己的方法。不愛也得強迫自己寫。\n男：說的也是，而且發現錯了隨時能更改。不過我可要提醒你一件事。網路日記\n是公開的文章，不是私人的記事本。\n女：那是什麼意思？\n男：就是別在你的網路日記上亂抱怨，如果老闆看到你在日記裡抱怨工作或同事，\n對你就有扣分作用，還是小心一點好。\n26. 這位女生為什麼要開始寫網路日記？\n27. 這位女生認為網路日記有什麼功能？\n28. 這位男生覺得網路日記怎麼樣？\n請聽這一段和政府補助金有關的討論，然後回答三個問題：\nⅠ. 民眾覺得這項政策怎麼樣？\nⅡ. 下面哪一個是政府提供補助金的對象？\nⅢ. 關於對話中的兩個人，目前的狀況如何？\n現在請聽討論。\n男：最近失業的問題越來越嚴重，政府上個月三號和專家學者，開了一個會，討\n論出一些新辦法和新措施。\n女：我也聽說了。這個政策要從元旦開始實施。如果失業超過三個月，政府就每\n個月補助六千元。\n男：六千塊的補助金額恐怕還是不夠。尤其是中年人口，大多數都還要照顧年老\n父母跟還沒獨立的小孩。我看，光是繳孩子的教育費用，就一點也不剩了吧！\n女：你說得對，這就是為什麼政府才剛把消息公布出來，就受到民眾的批評。最\n麻煩的是，失業的人還要親自到相關單位填申請表，交出自己失業的資料。\n男：你知道得可真多，我現在才曉得你這麼關心社會大眾的相關問題呢。\n女：還好啦！誰叫我下個禮拜就要陪我的丈夫去申請補助呢，不把這些條件讀熟\n一點可不行啊！\n29. 民眾覺得這項政策怎麼樣？\n30. 下面哪一個是政府提供補助金的對象？\n31. 關於對話中的兩個人，目前的狀況如何？\n第二部分 段落\n請聽這一段話，然後回答下面的問題。\n這次出國旅行，我決定不帶信用卡出門了。因為刷卡實在是太方便了，讓我\n花錢的時候一點兒感覺都沒有，不像用現金時還得一張一張數。以前每次出國都\n會亂買一大堆不實用的東西，一回到家馬上就後悔了，結果既不能退也不能換，\n真是浪費錢又浪費時間！\n32. 這個人為什麼決定不帶信用卡出國？\n請聽這一段話，然後回答下面的問題。\n我是一個鄉下人，去大城市讀書以前，有人告訴我城市裡的人都很不客氣，\n鄉下的人客氣多了。但是在城市住了三年以後，我覺得不一定是這樣，因為鄉下\n也有不客氣的人，城市裡也有客氣的人。\n33. 說話的人的想法是什麼？\n請聽這一段話，然後回答下面的問題。\n中山足球場離這兒不遠，你不必坐計程車。我告訴你啊，你往前一直走，到\n第一個路口左轉，再走十多分鐘就到了；不想走路的話，在這裡搭公車也行，坐\n兩站，在中山足球場那一站下車，大概只要五分鐘。\n34. 說話的人覺得用什麼方法到足球場比較好？\n請聽這一段電視新聞，然後回答下面的問題。\n因為天氣的關係，最近的空氣很髒，大家出門以前，記得把窗戶關上；進門\n以前，先把帽子或外套脫下來，再進到屋內。沒事的話，最好留在家裡別出去。\n這幾天的天氣大概都是這樣子，下星期空氣就會好一點兒了。\n35. 這段新聞主要告訴大家什麼？\n請聽這段和小高有關的話，然後回答兩個問題。\n小高本來是一個很隨便的人，但自從跟女朋友交往以後，變得有點兒不一樣。\n他開始注意自己的打扮，出門時還要打領帶。甚至在吃的方面也越來越講究，例\n如，昨天他就批評我們吃太多肉對身體不好，不跟我們一起去吃炸雞。今天因為\n他女朋友回鄉下去照顧媽媽了，在我們幾個朋友面前，馬上恢復原來的樣子跟態\n度。唉！我只能說，愛情的影響力真的好大啊！\n36. 這段話主要提到小高哪一方面的事？\n37. 交女朋友以前，小高是一個怎麼樣的人？\n請聽這段和學業有關的話，然後回答兩個問題。\n在我那個年代，高中沒畢業的人也可以找到不錯的工作，所以我的同學們都\n不願意去讀大學，認為不僅浪費時間又要花很多錢，還說在大學裡學到的東西對\n工作沒有用。但我那時候覺得，要是我也不讀大學，不就跟別人一樣了嗎？以後\n我會有競爭力嗎？所以我選了另一條路。現在時代變了，當時很多笑我笨的人，\n反而因為自己找工作時的資料不如我，開始後悔當年怎麼不跟我做一樣的選擇。\n38. 說話的人一開始提到什麼事？\n39. 根據這段話，現在找工作會遇到什麼情況？\n請聽這段和人的個性有關的話，然後回答兩個問題。\n我常聽別人從血型來解釋性格，或是從生日來判斷一個人的脾氣，但是我覺\n得這不僅沒道理，也太片面了。\n從一個人常做什麼、交什麼朋友、喜歡什麼事物等，來觀察一個人的個性，\n或許比較客觀。像是有人分別分析了喜歡養貓與養狗的人，他們的性格，得出了\n養狗的人喜歡交朋友，養貓的人喜歡一個人努力。透過觀察得出的結果，我認為\n是比較有道理的。\n40. 說話的人覺得，透過什麼方式了解個性是沒道理的？\n41. 說話的人對於「個性」有什麼想法？\n請聽這段和治療照顧有關的話，然後回答兩個問題。\n小姐，開完刀以後，您父親身體的情況已經改善了不少，會慢慢恢復健康的。\n但是因為開刀而造成的傷口比較大，過程中也流了不少血，所以這幾天還是建議\n安排他留在我們這裡繼續觀察，等恢復體力後再回家。當然如果您有時間細心照\n顧他，也可以今天就辦手續離開，不過一旦開刀的地方又再痛起來，請立刻帶他\n回來讓我們檢查。\n42. 根據這段話，病人怎麼了？\n43. 醫生有什麼建議？\n請聽這段介紹，然後回答兩個問題。\n歡迎您今天來看我們的預售樣品屋。我們預計明年房子和停車場都會蓋好。\n住在這裡，您可以享受便利的生活機能，這裡距離高鐵站開車只需要十分鐘。不\n論是要到外地出差，還是帶小孩回老家，都非常方便。另外，這裡每一樓都有浴\n室，不用擔心孩子搶著洗澡的問題。一樓有一個大房間，很適合給家裡的老人住。\n三樓的陽台還可以欣賞美景。接下來請您自由參觀，參觀完了以後，如果有興趣\n預訂，請留下您的聯絡方式。\n44. 說話的人在向誰介紹？\n45. 關於這個房子，說話的人提到什麼？\n請聽這段和放假有關的話，然後回答兩個問題。\n因為人們總是在意他人的眼光，所以即使多數人在假日時，只想好好和自己\n相處，但是在害怕自己沒完成朋友或同事推薦的假日旅遊方式，或是害怕自己做\n的事不被他人關心的心理壓力下，使得人們在享受假日時，還是不斷地拿起手機\n等待朋友與同事的留言。\n46. 這段話提到人們對假日的想法是什麼？\n47. 這段話主要提到什麼？\n有時候我們會幻想心愛的人死去。科學家表示，這是當我們在乎、關愛某些人時\n必然會經歷的矛盾心理。請聽這段話，然後回答三個問題：\nⅠ. 說話的人對這種矛盾情緒的想法怎麼樣？\nⅡ. 為什麼會產生這種矛盾的心態？\nⅢ. 說話的人最後的態度是什麼？\n現在請聽這段話。\n對人類來說，家人與朋友十分重要，人們關心他們、想要他們陪伴左右，同\n時希望日子過得順心如意。這些對所愛之人的感情，讓人們產生正面與負面情緒\n夾雜在一起的矛盾心理，例如，有時候我們會幻想心愛的人死去。對你越重要的\n人，你對他們的矛盾情緒就會越強烈。\n因為「愛一個人免不了會有挫折」，與所愛的人一起生活有時並不是一件容\n易的事。人們無法忍受，應該帶給自己歡樂的人，有時竟造成自己莫大的痛苦。\n所以，人們才會對心愛的人產生這種令人不安、甚至近於黑暗的小小願望。\n但換個角度想，人生中能有帶給你這些感受的人，也是一種幸運與福氣。說不定\n你所愛的人也正在幻想你被一輛快速開過的公車壓得扁扁的。\n48. 說話的人對這種矛盾情緒的想法怎麼樣？\n49. 為什麼會產生這種矛盾的心態？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "這間健身房的設備很好。"
          },
          {
            "speaker": "female",
            "text": "可是我不喜歡他們的舞蹈課程。"
          },
          {
            "speaker": "male",
            "text": "看在交通方便、價錢也還可以的份上，我們就加入會員吧！"
          },
          {
            "speaker": "female",
            "text": "等等，你先別急，我還要考慮考慮。"
          },
          {
            "speaker": "male",
            "text": "關於這間健身房，這位先生覺得怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和書法有關的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "唉，我這次參加比賽還是沒有得名。為了再進步一些，我決定每天把這些大"
          },
          {
            "speaker": "narrator",
            "text": "師寫的字都練習一遍。"
          },
          {
            "speaker": "female",
            "text": "書法就像畫畫一樣，字寫得好不好，要看空間的安排，比如空白的比例、顏"
          },
          {
            "speaker": "narrator",
            "text": "色的濃淡都會影響一幅作品的評價。"
          },
          {
            "speaker": "male",
            "text": "這幾個部分我認為我做得很好啊！你看我寫的這些。"
          },
          {
            "speaker": "female",
            "text": "哇，沒想到你寫得這麼棒，幾乎跟大師寫的一模一樣。"
          },
          {
            "speaker": "male",
            "text": "所以我也不知道為什麼我沒有得獎。"
          },
          {
            "speaker": "female",
            "text": "是不是因為缺乏自我風格呢？你不如練習寫自己的字，不要練習寫大師的字"
          },
          {
            "speaker": "narrator",
            "text": "了。"
          },
          {
            "speaker": "narrator",
            "text": "18. 這位小姐對寫書法這件事有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "19. 這位小姐覺得這位先生的作品怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和結帳有關的對話，然後回答兩個問題。"
          },
          {
            "speaker": "female",
            "text": "我要的東西都挑好了，我們一起結帳吧！"
          },
          {
            "speaker": "male",
            "text": "不必幫我付，分開算就行了，喔，這是我的會員卡。"
          },
          {
            "speaker": "female",
            "text": "你的會員卡可沒我這張卡厲害，今天刷我這張信用卡，可以拿到兩倍點數喔！"
          },
          {
            "speaker": "narrator",
            "text": "先讓我一起刷卡，你再算算你買的部分要給我多少錢。"
          },
          {
            "speaker": "male",
            "text": "點數可以做什麼？打折嗎？"
          },
          {
            "speaker": "female",
            "text": "點數不是用來抵折扣的。你每刷一次卡都會產生點數，有了一定點數以後，"
          },
          {
            "speaker": "narrator",
            "text": "就可以換禮品。你看，這個購物袋就是用這些點數換來的。"
          },
          {
            "speaker": "male",
            "text": "沒想到有這種好處啊，那讓你刷卡，我不就損失了嗎！下次我可要帶張信用"
          },
          {
            "speaker": "narrator",
            "text": "卡來買。"
          },
          {
            "speaker": "narrator",
            "text": "20. 為什麼這位先生覺得損失了？"
          },
          {
            "speaker": "narrator",
            "text": "21. 從對話中可以知道什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和吃藥有關的對話，然後回答兩個問題。"
          },
          {
            "speaker": "female",
            "text": "老公，你把水壺放在哪裡？該餵孩子吃藥了。"
          },
          {
            "speaker": "male",
            "text": "你不是都隨身帶著一瓶水的嗎？"
          },
          {
            "speaker": "female",
            "text": "我不是跟你說我今天不帶，要你在車上放個水壺嗎？因為那個瓶子關不緊，"
          },
          {
            "speaker": "narrator",
            "text": "還把我的背包都弄濕了呀！"
          },
          {
            "speaker": "male",
            "text": "對不起，我忘了。就用果汁吧，等我一下，我找找……我明明記得果汁放在"
          },
          {
            "speaker": "narrator",
            "text": "後面……"
          },
          {
            "speaker": "female",
            "text": "你竟然想用果汁配藥吃？吃藥配水，才是最正確的方式。等一會兒看到便利"
          },
          {
            "speaker": "narrator",
            "text": "商店，你下車買一瓶水吧！"
          },
          {
            "speaker": "narrator",
            "text": "22. 這位先生對吃藥這件事的想法是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "23. 在對話中，這位小姐提到什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段和孩子用錢觀念有關的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "我不是才剛給大明生活費用嗎？怎麼又缺錢了？"
          },
          {
            "speaker": "female",
            "text": "他的娛樂活動不少，花費當然不小。他要就給、他要就給，我們不都一直這"
          },
          {
            "speaker": "narrator",
            "text": "麼做嗎？"
          },
          {
            "speaker": "male",
            "text": "我每天辛苦賺錢，希望能滿足一家人的物質生活，但是像大明這種花錢方式，"
          },
          {
            "speaker": "narrator",
            "text": "我實在不贊同。"
          },
          {
            "speaker": "female",
            "text": "你怎麼現在態度忽然改變了？"
          },
          {
            "speaker": "male",
            "text": "現在他長大了，不該老是伸手要錢，他得學習靠自己的勞力賺錢，才能在社"
          },
          {
            "speaker": "narrator",
            "text": "會上生存。"
          },
          {
            "speaker": "female",
            "text": "那我們跟大明好好溝通這個觀念吧！"
          },
          {
            "speaker": "narrator",
            "text": "24. 這位小姐認為大明伸手要錢的原因是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "25. 這位先生對於大明的看法是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "下面是兩個同學之間的對話。請你在聽完這段對話後，回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "Ⅰ. 這位女生為什麼要開始寫網路日記？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅱ. 這位女生認為網路日記有什麼功能？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅲ. 這位男生覺得網路日記怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽對話。"
          },
          {
            "speaker": "female",
            "text": "你可以推薦我一個功能比較多的網路日記網站嗎？"
          },
          {
            "speaker": "male",
            "text": "好啊！不過，你不是不愛寫文章的嗎？怎麼突然要開始寫日記？"
          },
          {
            "speaker": "female",
            "text": "昨天新聞報導不是說了，現在很多企業找人，會到這個人的網路日記裡觀察"
          },
          {
            "speaker": "narrator",
            "text": "他個性好不好、專業知識夠不夠，也會看他一般文章寫得怎麼樣。"
          },
          {
            "speaker": "male",
            "text": "所以你打算利用它來找工作嗎？"
          },
          {
            "speaker": "female",
            "text": "是啊！我又沒什麼工作經驗，也不是反應很快的人。透過文字跟圖片是比較"
          },
          {
            "speaker": "narrator",
            "text": "能表現自己的方法。不愛也得強迫自己寫。"
          },
          {
            "speaker": "male",
            "text": "說的也是，而且發現錯了隨時能更改。不過我可要提醒你一件事。網路日記"
          },
          {
            "speaker": "narrator",
            "text": "是公開的文章，不是私人的記事本。"
          },
          {
            "speaker": "female",
            "text": "那是什麼意思？"
          },
          {
            "speaker": "male",
            "text": "就是別在你的網路日記上亂抱怨，如果老闆看到你在日記裡抱怨工作或同事，"
          },
          {
            "speaker": "narrator",
            "text": "對你就有扣分作用，還是小心一點好。"
          },
          {
            "speaker": "narrator",
            "text": "26. 這位女生為什麼要開始寫網路日記？"
          },
          {
            "speaker": "narrator",
            "text": "27. 這位女生認為網路日記有什麼功能？"
          },
          {
            "speaker": "narrator",
            "text": "28. 這位男生覺得網路日記怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段和政府補助金有關的討論，然後回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "Ⅰ. 民眾覺得這項政策怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅱ. 下面哪一個是政府提供補助金的對象？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅲ. 關於對話中的兩個人，目前的狀況如何？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽討論。"
          },
          {
            "speaker": "male",
            "text": "最近失業的問題越來越嚴重，政府上個月三號和專家學者，開了一個會，討"
          },
          {
            "speaker": "narrator",
            "text": "論出一些新辦法和新措施。"
          },
          {
            "speaker": "female",
            "text": "我也聽說了。這個政策要從元旦開始實施。如果失業超過三個月，政府就每"
          },
          {
            "speaker": "narrator",
            "text": "個月補助六千元。"
          },
          {
            "speaker": "male",
            "text": "六千塊的補助金額恐怕還是不夠。尤其是中年人口，大多數都還要照顧年老"
          },
          {
            "speaker": "narrator",
            "text": "父母跟還沒獨立的小孩。我看，光是繳孩子的教育費用，就一點也不剩了吧！"
          },
          {
            "speaker": "female",
            "text": "你說得對，這就是為什麼政府才剛把消息公布出來，就受到民眾的批評。最"
          },
          {
            "speaker": "narrator",
            "text": "麻煩的是，失業的人還要親自到相關單位填申請表，交出自己失業的資料。"
          },
          {
            "speaker": "male",
            "text": "你知道得可真多，我現在才曉得你這麼關心社會大眾的相關問題呢。"
          },
          {
            "speaker": "female",
            "text": "還好啦！誰叫我下個禮拜就要陪我的丈夫去申請補助呢，不把這些條件讀熟"
          },
          {
            "speaker": "narrator",
            "text": "一點可不行啊！"
          },
          {
            "speaker": "narrator",
            "text": "29. 民眾覺得這項政策怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "30. 下面哪一個是政府提供補助金的對象？"
          },
          {
            "speaker": "narrator",
            "text": "31. 關於對話中的兩個人，目前的狀況如何？"
          },
          {
            "speaker": "narrator",
            "text": "第二部分 段落"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "這次出國旅行，我決定不帶信用卡出門了。因為刷卡實在是太方便了，讓我"
          },
          {
            "speaker": "narrator",
            "text": "花錢的時候一點兒感覺都沒有，不像用現金時還得一張一張數。以前每次出國都"
          },
          {
            "speaker": "narrator",
            "text": "會亂買一大堆不實用的東西，一回到家馬上就後悔了，結果既不能退也不能換，"
          },
          {
            "speaker": "narrator",
            "text": "真是浪費錢又浪費時間！"
          },
          {
            "speaker": "narrator",
            "text": "32. 這個人為什麼決定不帶信用卡出國？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "我是一個鄉下人，去大城市讀書以前，有人告訴我城市裡的人都很不客氣，"
          },
          {
            "speaker": "narrator",
            "text": "鄉下的人客氣多了。但是在城市住了三年以後，我覺得不一定是這樣，因為鄉下"
          },
          {
            "speaker": "narrator",
            "text": "也有不客氣的人，城市裡也有客氣的人。"
          },
          {
            "speaker": "narrator",
            "text": "33. 說話的人的想法是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "中山足球場離這兒不遠，你不必坐計程車。我告訴你啊，你往前一直走，到"
          },
          {
            "speaker": "narrator",
            "text": "第一個路口左轉，再走十多分鐘就到了；不想走路的話，在這裡搭公車也行，坐"
          },
          {
            "speaker": "narrator",
            "text": "兩站，在中山足球場那一站下車，大概只要五分鐘。"
          },
          {
            "speaker": "narrator",
            "text": "34. 說話的人覺得用什麼方法到足球場比較好？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段電視新聞，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "因為天氣的關係，最近的空氣很髒，大家出門以前，記得把窗戶關上；進門"
          },
          {
            "speaker": "narrator",
            "text": "以前，先把帽子或外套脫下來，再進到屋內。沒事的話，最好留在家裡別出去。"
          },
          {
            "speaker": "narrator",
            "text": "這幾天的天氣大概都是這樣子，下星期空氣就會好一點兒了。"
          },
          {
            "speaker": "narrator",
            "text": "35. 這段新聞主要告訴大家什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和小高有關的話，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "小高本來是一個很隨便的人，但自從跟女朋友交往以後，變得有點兒不一樣。"
          },
          {
            "speaker": "narrator",
            "text": "他開始注意自己的打扮，出門時還要打領帶。甚至在吃的方面也越來越講究，例"
          },
          {
            "speaker": "narrator",
            "text": "如，昨天他就批評我們吃太多肉對身體不好，不跟我們一起去吃炸雞。今天因為"
          },
          {
            "speaker": "narrator",
            "text": "他女朋友回鄉下去照顧媽媽了，在我們幾個朋友面前，馬上恢復原來的樣子跟態"
          },
          {
            "speaker": "narrator",
            "text": "度。唉！我只能說，愛情的影響力真的好大啊！"
          },
          {
            "speaker": "narrator",
            "text": "36. 這段話主要提到小高哪一方面的事？"
          },
          {
            "speaker": "narrator",
            "text": "37. 交女朋友以前，小高是一個怎麼樣的人？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和學業有關的話，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "在我那個年代，高中沒畢業的人也可以找到不錯的工作，所以我的同學們都"
          },
          {
            "speaker": "narrator",
            "text": "不願意去讀大學，認為不僅浪費時間又要花很多錢，還說在大學裡學到的東西對"
          },
          {
            "speaker": "narrator",
            "text": "工作沒有用。但我那時候覺得，要是我也不讀大學，不就跟別人一樣了嗎？以後"
          },
          {
            "speaker": "narrator",
            "text": "我會有競爭力嗎？所以我選了另一條路。現在時代變了，當時很多笑我笨的人，"
          },
          {
            "speaker": "narrator",
            "text": "反而因為自己找工作時的資料不如我，開始後悔當年怎麼不跟我做一樣的選擇。"
          },
          {
            "speaker": "narrator",
            "text": "38. 說話的人一開始提到什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "39. 根據這段話，現在找工作會遇到什麼情況？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和人的個性有關的話，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "我常聽別人從血型來解釋性格，或是從生日來判斷一個人的脾氣，但是我覺"
          },
          {
            "speaker": "narrator",
            "text": "得這不僅沒道理，也太片面了。"
          },
          {
            "speaker": "narrator",
            "text": "從一個人常做什麼、交什麼朋友、喜歡什麼事物等，來觀察一個人的個性，"
          },
          {
            "speaker": "narrator",
            "text": "或許比較客觀。像是有人分別分析了喜歡養貓與養狗的人，他們的性格，得出了"
          },
          {
            "speaker": "narrator",
            "text": "養狗的人喜歡交朋友，養貓的人喜歡一個人努力。透過觀察得出的結果，我認為"
          },
          {
            "speaker": "narrator",
            "text": "是比較有道理的。"
          },
          {
            "speaker": "narrator",
            "text": "40. 說話的人覺得，透過什麼方式了解個性是沒道理的？"
          },
          {
            "speaker": "narrator",
            "text": "41. 說話的人對於「個性」有什麼想法？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和治療照顧有關的話，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "小姐，開完刀以後，您父親身體的情況已經改善了不少，會慢慢恢復健康的。"
          },
          {
            "speaker": "narrator",
            "text": "但是因為開刀而造成的傷口比較大，過程中也流了不少血，所以這幾天還是建議"
          },
          {
            "speaker": "narrator",
            "text": "安排他留在我們這裡繼續觀察，等恢復體力後再回家。當然如果您有時間細心照"
          },
          {
            "speaker": "narrator",
            "text": "顧他，也可以今天就辦手續離開，不過一旦開刀的地方又再痛起來，請立刻帶他"
          },
          {
            "speaker": "narrator",
            "text": "回來讓我們檢查。"
          },
          {
            "speaker": "narrator",
            "text": "42. 根據這段話，病人怎麼了？"
          },
          {
            "speaker": "narrator",
            "text": "43. 醫生有什麼建議？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段介紹，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "歡迎您今天來看我們的預售樣品屋。我們預計明年房子和停車場都會蓋好。"
          },
          {
            "speaker": "narrator",
            "text": "住在這裡，您可以享受便利的生活機能，這裡距離高鐵站開車只需要十分鐘。不"
          },
          {
            "speaker": "narrator",
            "text": "論是要到外地出差，還是帶小孩回老家，都非常方便。另外，這裡每一樓都有浴"
          },
          {
            "speaker": "narrator",
            "text": "室，不用擔心孩子搶著洗澡的問題。一樓有一個大房間，很適合給家裡的老人住。"
          },
          {
            "speaker": "narrator",
            "text": "三樓的陽台還可以欣賞美景。接下來請您自由參觀，參觀完了以後，如果有興趣"
          },
          {
            "speaker": "narrator",
            "text": "預訂，請留下您的聯絡方式。"
          },
          {
            "speaker": "narrator",
            "text": "44. 說話的人在向誰介紹？"
          },
          {
            "speaker": "narrator",
            "text": "45. 關於這個房子，說話的人提到什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和放假有關的話，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "因為人們總是在意他人的眼光，所以即使多數人在假日時，只想好好和自己"
          },
          {
            "speaker": "narrator",
            "text": "相處，但是在害怕自己沒完成朋友或同事推薦的假日旅遊方式，或是害怕自己做"
          },
          {
            "speaker": "narrator",
            "text": "的事不被他人關心的心理壓力下，使得人們在享受假日時，還是不斷地拿起手機"
          },
          {
            "speaker": "narrator",
            "text": "等待朋友與同事的留言。"
          },
          {
            "speaker": "narrator",
            "text": "46. 這段話提到人們對假日的想法是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "47. 這段話主要提到什麼？"
          },
          {
            "speaker": "narrator",
            "text": "有時候我們會幻想心愛的人死去。科學家表示，這是當我們在乎、關愛某些人時"
          },
          {
            "speaker": "narrator",
            "text": "必然會經歷的矛盾心理。請聽這段話，然後回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "Ⅰ. 說話的人對這種矛盾情緒的想法怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅱ. 為什麼會產生這種矛盾的心態？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅲ. 說話的人最後的態度是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽這段話。"
          },
          {
            "speaker": "narrator",
            "text": "對人類來說，家人與朋友十分重要，人們關心他們、想要他們陪伴左右，同"
          },
          {
            "speaker": "narrator",
            "text": "時希望日子過得順心如意。這些對所愛之人的感情，讓人們產生正面與負面情緒"
          },
          {
            "speaker": "narrator",
            "text": "夾雜在一起的矛盾心理，例如，有時候我們會幻想心愛的人死去。對你越重要的"
          },
          {
            "speaker": "narrator",
            "text": "人，你對他們的矛盾情緒就會越強烈。"
          },
          {
            "speaker": "narrator",
            "text": "因為「愛一個人免不了會有挫折」，與所愛的人一起生活有時並不是一件容"
          },
          {
            "speaker": "narrator",
            "text": "易的事。人們無法忍受，應該帶給自己歡樂的人，有時竟造成自己莫大的痛苦。"
          },
          {
            "speaker": "narrator",
            "text": "所以，人們才會對心愛的人產生這種令人不安、甚至近於黑暗的小小願望。"
          },
          {
            "speaker": "narrator",
            "text": "但換個角度想，人生中能有帶給你這些感受的人，也是一種幸運與福氣。說不定"
          },
          {
            "speaker": "narrator",
            "text": "你所愛的人也正在幻想你被一輛快速開過的公車壓得扁扁的。"
          },
          {
            "speaker": "narrator",
            "text": "48. 說話的人對這種矛盾情緒的想法怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "49. 為什麼會產生這種矛盾的心態？"
          },
          {
            "speaker": "narrator",
            "text": "50. 說話的人最後的態度是什麼？"
          }
        ],
        "q": "50. 說話的人最後的態度是什麼？",
        "options": [
          "環境很不好",
          "位置還不錯",
          "價格太昂貴",
          "舞蹈課程多"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 位置還不錯. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 18",
        "options": [
          "要先把畫畫學好",
          "學得越久，寫得越好",
          "要具備空間分佈的概念",
          "要知道寫一個字的順序"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 要具備空間分佈的概念. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 19",
        "options": [
          "看不出有什麼技巧",
          "要再多和大師學習",
          "沒有什麼藝術價值",
          "要發展自己的特色"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 要發展自己的特色. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 20",
        "options": [
          "因為只有這位小姐有點數",
          "因為點數不能用來換折扣",
          "因為只有這位小姐有折扣",
          "因為這位小姐不幫他付錢"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 因為只有這位小姐有點數. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 21",
        "options": [
          "今天刷卡會送購物袋",
          "他們買東西是各付各的",
          "加入商店會員有很多好處",
          "這位先生也想要辦信用卡"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 他們買東西是各付各的. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 22",
        "options": [
          "小孩生病就是要吃藥",
          "小孩子不可以吃大人的藥",
          "就算沒有水，也可以吃藥",
          "不可以隨便調整吃藥的時間"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 就算沒有水，也可以吃藥. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 23",
        "options": [
          "沒帶水瓶的原因",
          "到便利商店的方向",
          "醫生交代的吃藥方式",
          "小孩生病不舒服的狀況"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 沒帶水瓶的原因. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 24",
        "options": [
          "他的生活很辛苦",
          "他娛樂支出很多",
          "父母的收入很高",
          "父母沒給生活費"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 他娛樂支出很多. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 25",
        "options": [
          "現在大明應該自己賺錢",
          "父親給多少錢就可花多少",
          "大明每天只會玩，不會養家",
          "大明應該從小培養存錢的習慣"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 現在大明應該自己賺錢. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 1: Chọn từ thích hợp nhất điền vào chỗ trống [1].",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng thể bị động '被'送進了醫院 (được đưa vào viện).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 2: Chọn từ thích hợp nhất điền vào chỗ trống [2].",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'陪'張太太 (đi cùng vợ).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 3: Chọn từ thích hợp nhất điền vào chỗ trống [3].",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'當'爸爸 (làm cha).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 4: Chọn từ thích hợp nhất điền vào chỗ trống [4].",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'為'這個孩子 (nghĩ tên 'cho' con).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 5: Chọn từ thích hợp nhất điền vào chỗ trống [5].",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'希望' (hy vọng sau này vừa đẹp vừa vui).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 6: Chọn từ thích hợp nhất điền vào chỗ trống [6].",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Cụm cố định '大學時代' (thời đại học).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 7: Chọn từ thích hợp nhất điền vào chỗ trống [7].",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp.",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 8: Chọn từ thích hợp nhất điền vào chỗ trống [8].",
        "options": [
          "忽然",
          "總是",
          "隨時",
          "從來"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'忽然'想起 (đột nhiên nhớ lại).",
        "pinyin": ""
      },
      {
        "id": 34,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 9: Chọn từ thích hợp nhất điền vào chỗ trống [9].",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'照'著地址 (lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 10: Chọn từ thích hợp nhất điền vào chỗ trống [10].",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp lại).",
        "pinyin": ""
      },
      {
        "id": 36,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 11: Chọn từ thích hợp nhất điền vào chỗ trống [11].",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'安排'戶外活動 (sắp xếp thời gian vận động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 37,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 12: Chọn từ thích hợp nhất điền vào chỗ trống [12].",
        "options": [
          "影響",
          "阻礙",
          "促進",
          "代替"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'促進'吸收 (thúc đẩy hấp thụ vitamin D).",
        "pinyin": ""
      },
      {
        "id": 38,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 13: Chọn từ thích hợp nhất điền vào chỗ trống [13].",
        "options": [
          "常常",
          "總是",
          "不斷",
          "難免"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'總是'在室內看螢幕 (luôn ở trong phòng xem màn hình).",
        "pinyin": ""
      },
      {
        "id": 39,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 14: Chọn từ thích hợp nhất điền vào chỗ trống [14].",
        "options": [
          "維護",
          "修理",
          "整理",
          "保證"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'維護'視力健康 (bảo vệ / duy trì sức khỏe thị lực).",
        "pinyin": ""
      },
      {
        "id": 40,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 15: Chọn từ thích hợp nhất điền vào chỗ trống [15].",
        "options": [
          "不能",
          "不要",
          "不可",
          "不必"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'不可'輕視 (tuyệt đối không được xem nhẹ).",
        "pinyin": ""
      },
      {
        "id": 41,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "dialogueSegments": [],
        "q": "Câu 16: 下面哪一個敘述完全符合短文內容？",
        "options": [
          "小明已經造訪韓國兩次了",
          "小明在韓國住了四個晚上",
          "小明覺得韓國食物不合胃口",
          "小明打算去日本留學"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đoạn văn viết rõ: '玩了五天四夜' nghĩa là ở lại 4 đêm (四個晚上).",
        "pinyin": ""
      },
      {
        "id": 42,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 面對孩子成長的母親\n孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "dialogueSegments": [],
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，採取什麼態度？",
        "options": [
          "嚴厲責備孩子的膽怯",
          "答應明天親自開車接送",
          "鼓勵孩子勇敢獨立面對",
          "感到不知所措而焦慮"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Người mẹ khuyến khích: '你要學會自己面對挑戰' (động viên con dũng cảm tự đối diện).",
        "pinyin": ""
      },
      {
        "id": 43,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北夜市行動支付普及化\n以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "audio": "",
        "dialogue": "以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "dialogueSegments": [],
        "q": "Câu 18: 夜市引入行動支付帶來哪一項核心效益？",
        "options": [
          "大幅降低商品售價",
          "結帳更快速並兼顧衛生",
          "夜市營業時間延長至白天",
          "所有攤商免繳營業稅"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Văn bản nêu: '減少了排隊找零的時間, 也大幅降低了衛生疑慮' (thanh toán nhanh hơn và vệ sinh hơn).",
        "pinyin": ""
      },
      {
        "id": 44,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 捷運站二手書漂書箱與愛心傘\n台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "audio": "",
        "dialogue": "台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "dialogueSegments": [],
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪項優勢？",
        "options": [
          "列車行駛速度領先全球",
          "兼具人情味與信任的便民服務",
          "站內車廂提供免費餐飲",
          "票價比其他交通工具便宜"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Tác giả ngợi ca: '兼具人情味與信任的便民服務' (dịch vụ tiện dân ấm áp tình người dựa trên sự tin tưởng).",
        "pinyin": ""
      },
      {
        "id": 45,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北市垃圾費隨袋徵收政策成效\n台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "audio": "",
        "dialogue": "台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "dialogueSegments": [],
        "q": "Câu 20: 『垃圾費隨袋徵收』政策為何能有效減少垃圾量？",
        "options": [
          "市民為了省買垃圾袋的錢而努力做資源回收",
          "規定每戶每週最多只能丟一包垃圾",
          "禁止市民在超市購買塑膠袋包裝的食品",
          "提高亂丟垃圾的罰款金額十倍以上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Vì rác tái chế miễn phí còn rác thường tốn tiền mua túi, người dân tích cực phân loại để tiết kiệm chi phí mua túi rác.",
        "pinyin": ""
      },
      {
        "id": 46,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 高鐵串連台灣南北一日生活圈\n自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "audio": "",
        "dialogue": "自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "dialogueSegments": [],
        "q": "Câu 21: 『一日生活圈』對人們生活產生的實質改變是什麼？",
        "options": [
          "商務出差不必再在外地過夜",
          "民眾紛紛將戶籍遷往南部",
          "高鐵票價全面降至台鐵水準",
          "飛機成為國內最受歡迎的航線"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn nêu buổi sáng họp Đài Bắc, chiều tới Nam Bộ, tối về lại nhà (đi lại trong ngày không cần ở qua đêm).",
        "pinyin": ""
      },
      {
        "id": 47,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣全民健保雲端醫療資訊系統\n台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "audio": "",
        "dialogue": "台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "dialogueSegments": [],
        "q": "Câu 22: 健保雲端資訊系統的主要優勢是什麼？",
        "options": [
          "自動為病患減免掛號費用",
          "跨院即時查詢用藥紀錄避免重複開藥",
          "病患可在家自行線上開刀治療",
          "直接向國外藥廠訂購廉價藥品"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đoạn văn nêu rõ: '即時調閱檢查報告及用藥紀錄, 有效防範了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 48,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 誠品書店二十四小時營運的文化底蘊\n誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "dialogueSegments": [],
        "q": "Câu 23: 誠品書店之所以被譽為深夜文化地標，是因為什麼？",
        "options": [
          "深夜購書享有半價折扣",
          "結合文創美學將閱讀轉化為生活哲學",
          "只允許專業作家進入借閱圖書",
          "是台北市唯一的實體書店"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Tác giả chỉ rõ: '將單純的購書行為昇華為一種優雅慢活的生活哲學'.",
        "pinyin": ""
      },
      {
        "id": 49,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 美食外送平台對都會生活型態的衝擊\n隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "audio": "",
        "dialogue": "隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "dialogueSegments": [],
        "q": "Câu 24: 作者對於美食外送服務的蓬勃發展抱持何種看法？",
        "options": [
          "認為便利之餘亦伴隨交通與環保等社會隱憂",
          "強烈主張政府應立法全面禁止外送App",
          "認為外送餐點品質大幅超越店內現煮",
          "覺得外送員的薪資過高不合理"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả chỉ rõ: '伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題, 亟需深入探討' (tiện lợi nhưng tiềm ẩn nguy cơ giao thông và môi trường).",
        "pinyin": ""
      },
      {
        "id": 50,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 傳統菜市場的人情溫度與文化生命力\n儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "dialogueSegments": [],
        "q": "Câu 25: 傳統市場至今依然深受廣大民眾喜愛的核心魅力何在？",
        "options": [
          "冷氣空調比超市更強大涼爽",
          "濃厚的街坊人情味與客製化的人際互動",
          "所有生鮮蔬果皆由國外高價空運進口",
          "營業時間全天二十四小時不中斷"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả nhấn mạnh: '充滿街坊問候的人情溫度與鮮活的在地風土' (tình người nồng hậu và giao tiếp tương tác thân tình).",
        "pinyin": ""
      }
    ]
  },
  {
    "id": "mock_b5",
    "title": "TOCFL Band B - Đề thi Chuẩn 5 (Official Mock 5)",
    "band": "Band B (高階·流利)",
    "badge": "Chuẩn SC-TOP CAT",
    "duration": 60,
    "totalQ": 50,
    "desc": "Bộ đề thi số 5 với các đoạn phóng sự chuyên sâu, văn bản học thuật và thảo luận xã hội độ phân hóa cao.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "春天到了，山上的花都開了。小芳，我們一起去看花，好不好？ 嗯，好啊，別忘了帶照相機去。 從這兩個人說的話，可以知道什麼？",
        "dialogue": "男：春天到了，山上的花都開了。小芳，我們一起去看花，好不好？\n女：嗯，好啊，別忘了帶照相機去。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "春天到了，山上的花都開了。小芳，我們一起去看花，好不好？"
          },
          {
            "speaker": "female",
            "text": "嗯，好啊，別忘了帶照相機去。"
          },
          {
            "speaker": "male",
            "text": "從這兩個人說的話，可以知道什麼？"
          }
        ],
        "q": "從這兩個人說的話，可以知道什麼？",
        "options": [
          "他們要去山上看花",
          "這位先生不想上山",
          "小芳忘了照相機放在哪裡",
          "小芳只想看花，不想照相"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他們要去山上看花. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小美，請幫我買兩斤牛肉和一些青菜回來。 牛肉？我印象中上次買的還有吧！還需要買嗎？ 這位小姐的意思是什麼？",
        "dialogue": "男：小美，請幫我買兩斤牛肉和一些青菜回來。\n女：牛肉？我印象中上次買的還有吧！還需要買嗎？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小美，請幫我買兩斤牛肉和一些青菜回來。"
          },
          {
            "speaker": "female",
            "text": "牛肉？我印象中上次買的還有吧！還需要買嗎？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她擔心會買不到牛肉",
          "她覺得兩斤牛肉太多",
          "她記得牛肉還沒吃完",
          "她不確定家裡有沒有牛肉"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她記得牛肉還沒吃完. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "明天是小新的生日，妳覺得送他什麼禮物比較好？ 我沒意見，你們決定就可以了。 這位小姐的意思是什麼？",
        "dialogue": "男：明天是小新的生日，妳覺得送他什麼禮物比較好？\n女：我沒意見，你們決定就可以了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "明天是小新的生日，妳覺得送他什麼禮物比較好？"
          },
          {
            "speaker": "female",
            "text": "我沒意見，你們決定就可以了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "讓小新決定要買什麼禮物",
          "她不願意送小新生日禮物",
          "送小新的禮物已經決定了",
          "送小新什麼禮物都沒關係"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 送小新什麼禮物都沒關係. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "從明年起生病的人都能透過網路看病，不但能很快知道結果，也不需要付看 病的錢，真是一個好消息！ 是嗎？我不認為這是一個好消息。再說，看病的結果可靠嗎？ 這位小姐對使用網路看病的想法是什麼？",
        "dialogue": "男：從明年起生病的人都能透過網路看病，不但能很快知道結果，也不需要付看\n病的錢，真是一個好消息！\n女：是嗎？我不認為這是一個好消息。再說，看病的結果可靠嗎？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "從明年起生病的人都能透過網路看病，不但能很快知道結果，也不需要付看"
          },
          {
            "speaker": "narrator",
            "text": "病的錢，真是一個好消息！"
          },
          {
            "speaker": "female",
            "text": "是嗎？我不認為這是一個好消息。再說，看病的結果可靠嗎？"
          },
          {
            "speaker": "male",
            "text": "這位小姐對使用網路看病的想法是什麼？"
          }
        ],
        "q": "這位小姐對使用網路看病的想法是什麼？",
        "options": [
          "使用網路看病非常方便",
          "病人需要付很多錢看病",
          "看病的結果可能不正確",
          "病人不能很快知道結果"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 看病的結果可能不正確. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我今天必須趕快把這些資料整理好交給老闆，他要看過這些資料才能做決 定。你可以幫我嗎？ 可是我今天一整天都要開會，不如你找小陳幫你吧! 這位小姐的意思是什麼？",
        "dialogue": "男：我今天必須趕快把這些資料整理好交給老闆，他要看過這些資料才能做決\n定。你可以幫我嗎？\n女：可是我今天一整天都要開會，不如你找小陳幫你吧!",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我今天必須趕快把這些資料整理好交給老闆，他要看過這些資料才能做決"
          },
          {
            "speaker": "narrator",
            "text": "定。你可以幫我嗎？"
          },
          {
            "speaker": "female",
            "text": "可是我今天一整天都要開會，不如你找小陳幫你吧!"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她也幫不了這位先生的忙",
          "她今天得整理資料給老闆",
          "她覺得這位先生一定來不及",
          "她要這位先生找小陳做決定"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她也幫不了這位先生的忙. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "餐廳老闆應該重視店內的設計，否則顧客是不會來消費的。 我倒是比較重視廚師的能力。店內的布置有點老舊，也許顧客反而覺得更自在。 關於餐廳，這位小姐注重的是什麼？",
        "dialogue": "男：餐廳老闆應該重視店內的設計，否則顧客是不會來消費的。\n女：我倒是比較重視廚師的能力。店內的布置有點老舊，也許顧客反而覺得更自在。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "餐廳老闆應該重視店內的設計，否則顧客是不會來消費的。"
          },
          {
            "speaker": "female",
            "text": "我倒是比較重視廚師的能力。店內的布置有點老舊，也許顧客反而覺得更自在。"
          },
          {
            "speaker": "male",
            "text": "關於餐廳，這位小姐注重的是什麼？"
          }
        ],
        "q": "關於餐廳，這位小姐注重的是什麼？",
        "options": [
          "餐點的價格",
          "食物的味道",
          "用餐的環境",
          "服務的品質"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 食物的味道. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "喂，你好。我上個星期在你們的網站上買了幾本書，為什麼還沒收到？ 我幫你查一查，請問姓名、地址是… 我是李大年，地址是青山路一號。 李先生，書已經寄出了，應該下午就會到。 從這段對話可以知道什麼？",
        "dialogue": "男：喂，你好。我上個星期在你們的網站上買了幾本書，為什麼還沒收到？\n女：我幫你查一查，請問姓名、地址是…\n男：我是李大年，地址是青山路一號。\n女：李先生，書已經寄出了，應該下午就會到。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "喂，你好。我上個星期在你們的網站上買了幾本書，為什麼還沒收到？"
          },
          {
            "speaker": "female",
            "text": "我幫你查一查，請問姓名、地址是…"
          },
          {
            "speaker": "male",
            "text": "我是李大年，地址是青山路一號。"
          },
          {
            "speaker": "female",
            "text": "李先生，書已經寄出了，應該下午就會到。"
          },
          {
            "speaker": "male",
            "text": "從這段對話可以知道什麼？"
          }
        ],
        "q": "從這段對話可以知道什麼？",
        "options": [
          "書店寄錯地址了",
          "李大年忘了提供名字",
          "李大年快要收到書了",
          "書店弄錯李大年買的書"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 李大年快要收到書了. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "你上次跟朋友去自助旅行，怎麼鬧得不開心？ 他堅持每天都要逛街，但我沒興趣。我希望去當地最有名的博物館看看，他 卻不要。 聽起來你們習慣的旅行方式不太一樣啊！ 是啊，兩個人鬧得很不愉快，回來後連朋友都做不成。 關於這位小姐的旅行，下面哪個是對的？",
        "dialogue": "男：你上次跟朋友去自助旅行，怎麼鬧得不開心？\n女：他堅持每天都要逛街，但我沒興趣。我希望去當地最有名的博物館看看，他\n卻不要。\n男：聽起來你們習慣的旅行方式不太一樣啊！\n女：是啊，兩個人鬧得很不愉快，回來後連朋友都做不成。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "你上次跟朋友去自助旅行，怎麼鬧得不開心？"
          },
          {
            "speaker": "female",
            "text": "他堅持每天都要逛街，但我沒興趣。我希望去當地最有名的博物館看看，他"
          },
          {
            "speaker": "narrator",
            "text": "卻不要。"
          },
          {
            "speaker": "male",
            "text": "聽起來你們習慣的旅行方式不太一樣啊！"
          },
          {
            "speaker": "female",
            "text": "是啊，兩個人鬧得很不愉快，回來後連朋友都做不成。"
          },
          {
            "speaker": "male",
            "text": "關於這位小姐的旅行，下面哪個是對的？"
          }
        ],
        "q": "關於這位小姐的旅行，下面哪個是對的？",
        "options": [
          "她堅持每天都要逛街",
          "她的朋友想去博物館",
          "她跟朋友對旅行有不同的期待",
          "旅行加深了她和朋友間的感情"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她跟朋友對旅行有不同的期待. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我們的朋友都已經結婚、生孩子了，只有我們還單身，真是孤單。 有什麼好孤單？我們現在的生活也很好啊！想做什麼就做什麼，多自由啊！ 再說，有了家庭以後，生活上所有的花費也會跟著增加，可是薪水卻不會跟 著增加。你要過這種生活嗎？ 這位小姐對結婚組成家庭的看法怎麼樣？",
        "dialogue": "男：我們的朋友都已經結婚、生孩子了，只有我們還單身，真是孤單。\n女： 有什麼好孤單？我們現在的生活也很好啊！想做什麼就做什麼，多自由啊！\n再說，有了家庭以後，生活上所有的花費也會跟著增加，可是薪水卻不會跟\n著增加。你要過這種生活嗎？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我們的朋友都已經結婚、生孩子了，只有我們還單身，真是孤單。"
          },
          {
            "speaker": "female",
            "text": "有什麼好孤單？我們現在的生活也很好啊！想做什麼就做什麼，多自由啊！"
          },
          {
            "speaker": "narrator",
            "text": "再說，有了家庭以後，生活上所有的花費也會跟著增加，可是薪水卻不會跟"
          },
          {
            "speaker": "narrator",
            "text": "著增加。你要過這種生活嗎？"
          },
          {
            "speaker": "male",
            "text": "這位小姐對結婚組成家庭的看法怎麼樣？"
          }
        ],
        "q": "這位小姐對結婚組成家庭的看法怎麼樣？",
        "options": [
          "沒有特別的想法",
          "抱著肯定的態度",
          "十分渴望有人陪伴",
          "偏向維持目前狀態"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 偏向維持目前狀態. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "考試不是快到了嗎？你怎麼還想著吃喝玩樂？以為自己很聰明就不複習了 嗎？你弟弟成績那麼好，都可以當你的榜樣了。 我的成績也挺不錯的，好嗎！我這樣才是過日子。弟弟每天除了讀書還是讀 書，他根本不懂生活，怎麼當我的榜樣？ 這位女生的意思是什麼？",
        "dialogue": "男：考試不是快到了嗎？你怎麼還想著吃喝玩樂？以為自己很聰明就不複習了\n嗎？你弟弟成績那麼好，都可以當你的榜樣了。\n女：我的成績也挺不錯的，好嗎！我這樣才是過日子。弟弟每天除了讀書還是讀\n書，他根本不懂生活，怎麼當我的榜樣？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "考試不是快到了嗎？你怎麼還想著吃喝玩樂？以為自己很聰明就不複習了"
          },
          {
            "speaker": "narrator",
            "text": "嗎？你弟弟成績那麼好，都可以當你的榜樣了。"
          },
          {
            "speaker": "female",
            "text": "我的成績也挺不錯的，好嗎！我這樣才是過日子。弟弟每天除了讀書還是讀"
          },
          {
            "speaker": "narrator",
            "text": "書，他根本不懂生活，怎麼當我的榜樣？"
          },
          {
            "speaker": "male",
            "text": "這位女生的意思是什麼？"
          }
        ],
        "q": "這位女生的意思是什麼？",
        "options": [
          "她很想當弟弟的榜樣",
          "她想幫弟弟複習功課",
          "她跟弟弟一樣都很用功",
          "她的生活方式比弟弟好"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她的生活方式比弟弟好. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我們提的計畫案，被公司退回了，這個計畫案大概是沒希望了。 別灰心，才被退一次而已。不管被退回幾次，反正只要有機會我們還是要繼 續提。 請問這位小姐的意思是什麼？",
        "dialogue": "男：我們提的計畫案，被公司退回了，這個計畫案大概是沒希望了。\n女：別灰心，才被退一次而已。不管被退回幾次，反正只要有機會我們還是要繼\n續提。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我們提的計畫案，被公司退回了，這個計畫案大概是沒希望了。"
          },
          {
            "speaker": "female",
            "text": "別灰心，才被退一次而已。不管被退回幾次，反正只要有機會我們還是要繼"
          },
          {
            "speaker": "narrator",
            "text": "續提。"
          },
          {
            "speaker": "male",
            "text": "請問這位小姐的意思是什麼？"
          }
        ],
        "q": "請問這位小姐的意思是什麼？",
        "options": [
          "她不會放棄提這個計畫案",
          "她和這位先生的看法一樣",
          "她覺得這個計畫案無法通過",
          "她希望這位先生不要太樂觀"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她不會放棄提這個計畫案. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "喂，你好，我是昨天來看病的李健生，請問林醫生在嗎？ 我就是，李先生怎麼了嗎？ 我回家擦了你們的藥，眼睛就變得紅紅的。 擦這種藥都會這樣的。不放心的話，請你明天來醫院讓我看看。 醫生跟病人說了什麼？",
        "dialogue": "男：喂，你好，我是昨天來看病的李健生，請問林醫生在嗎？\n女：我就是，李先生怎麼了嗎？\n男：我回家擦了你們的藥，眼睛就變得紅紅的。\n女：擦這種藥都會這樣的。不放心的話，請你明天來醫院讓我看看。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "喂，你好，我是昨天來看病的李健生，請問林醫生在嗎？"
          },
          {
            "speaker": "female",
            "text": "我就是，李先生怎麼了嗎？"
          },
          {
            "speaker": "male",
            "text": "我回家擦了你們的藥，眼睛就變得紅紅的。"
          },
          {
            "speaker": "female",
            "text": "擦這種藥都會這樣的。不放心的話，請你明天來醫院讓我看看。"
          },
          {
            "speaker": "male",
            "text": "醫生跟病人說了什麼？"
          }
        ],
        "q": "醫生跟病人說了什麼？",
        "options": [
          "明天一定要來醫院",
          "擦藥眼睛變紅很常見",
          "藥擦完了，再來醫院",
          "病人不能自己擦這種藥"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 擦藥眼睛變紅很常見. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我媽媽一天到晚嘮叨我面對未來太消極，沒給自己規劃一個目標，像是買房 買車等等。 我認為與其辛苦貸款買房子，還不如當租屋族，沒有那麼大的貸款壓力，生 活能更輕鬆自在。 下面哪一個是對的？ 請聽這一段和打掃家裡有關的對話，然後回答兩個問題。 唉！今天下班後又得先打掃家裡才能休息。 你打掃的頻率還真高，我大約一週才打掃一次。 打掃既花時間又耗體力，要不是小孩容易過敏，我怎麼可能天天做呢？ 要不然買個掃地機器人怎麼樣？只要設定好時間，它就會自動開始掃地。 14. 這位先生對於打掃的態度是什麼？ 15. 這位小姐給這位先生什麼建議？ 請聽這一段有關歌星說明他動手打人的訪問，然後回答兩個問題。 今天節目中請到歌星李義來談一談最近的打人事件。李義，對於你的女朋友 說你常對她動手，你想做點說明嗎？ 我跟她是吵過幾次架，過程中的確很生氣，兩人有些拉拉扯扯，但我絕對沒 有要弄傷她的意思。 其實人激動時常常難以控制自己，有時候自己以為沒什麼，可是對方已經覺 得無法接受了。 你說的對，無論如何我都要保持冷靜，不應該動手。很抱歉讓對方受到傷害， 以後絕對不會再發生這樣的事。 16. 這位女主持人對李義跟女朋友之間的問題有什麼想法？ 17. 對於打人事件，李義現在有什麼想法？ 請聽這一段同事間的對話，然後回答兩個問題。 今天主管又故意在辦公室說話諷刺我，你都看見了吧！ 主管這麼做的確很過分，但為了繼續在公司待下去，你還是別跟他計較了。 忍耐只會使同樣的情況再發生，對受害者造成更嚴重的傷害。這次我堅持告 上法院，一定要讓他為自己的行為付出代價。 好吧，既然你這麼堅持，希望你能獲得勝利，得到應有的賠償。 18. 這位小姐一開始對這件事情有什麼看法？ 19. 這位先生為什麼堅持自己的做法？ 請聽這一段有關看電影的對話，然後回答兩個問題。 我很想帶孩子去看電影，但一想到孩子可能會在電影院裡大吵大鬧，還是算 了。 在澳洲有些電影院設計了「哭泣的房間」。這個房間有四面透明、隔音良好 的牆，還有獨立的音效設備。父母和孩子坐在裡面跟大家一起觀賞電影，就 算孩子哭鬧也不會影響別人。 這個設計跟教堂裡給親子專用的房間，有一樣的功能，讓父母能安心帶著孩 子參加活動。 沒錯！其實這個房間大家都能使用，這樣看電影的時候想尖叫、想大哭，一 點都不用覺得尷尬。 20. 關於「哭泣的房間」，下面哪一個是對的？ 21. 為什麼這位先生提到「教堂」？ 請聽這一段有關喝咖啡的對話，然後回答兩個問題。 你每天喝那麼多咖啡，對身體不好吧！ 你對咖啡的印象已經落伍了，其實喝咖啡的好處不少呢！ 除了讓精神好一點，咖啡還能有什麼好處？ 根據這兩年一些已發表的研究結果，喝咖啡能減輕疼痛，還能降低得到心臟 疾病的風險。 那都是廠商行銷的手段。我不反對你喝咖啡，但像你這樣把咖啡當水喝，一 定對身體不好，你啊！早晚得去看醫生。 22. 關於咖啡，他們說了什麼？ 23. 這位先生對咖啡的看法是什麼？ 請聽這一段同事間的對話，然後回答兩個問題。 你最近怎麼都這麼早到公司？你搭的火車班次，又改時間了啊？ 不是改時間，而是「停駛」，我搭的那班車，因為司機罷工，停開了。所以， 我只好搭公車來公司，但是害怕車子塞在高速公路上，上班會遲到，不得不 提早出發。 哇，這不是前兩個月才剛罷過工嗎？說是薪水太少、福利太差，所以火車公 司才剛調整過他們的薪水，這次又為了什麼？ 這次好像是火車公司想要調整公司結構，但是沒有跟員工好好溝通，所以， 又罷工了。 24. 這位小姐為什麼早到公司？ 25. 他們提到火車公司什麼事？ 請聽這段和跑步有關的對話，然後回答兩個問題。 你的臉色怎麼這麼難看，感冒了嗎？ 我昨天慢跑了三公里，現在腿痛得不得了。 我不知道你這麼喜歡運動，你常跑步嗎？ 我最近剛開始練習跑步，我以為慢跑很輕鬆，沒想到我不但跑不了那麼遠， 還這麼累。 妳沒有慢跑的經驗，先不管跑步的速度怎麼樣，一開始最好不要跑長距離， 否則對健康有不好的影響。你等身體適應了以後，再跑三公里吧！ 你說的好像滿有道理的，因為運動讓自己受傷，太不值得了，下次我會更小 心。 26. 這位小姐對慢跑的看法是什麼？ 27. 這位先生從哪方面給這位小姐建議？ 請聽這段有關「瑞典向挪威進口垃圾」的討論，然後回答三個問題。 Ⅰ. 為什麼瑞典需要進口垃圾？ Ⅱ. 為什麼這位先生覺得這個合作方案對挪威沒有好處？ Ⅲ. 這位小姐對瑞典的發電方式，有什麼看法？ 現在請聽討論。 我沒看錯吧？垃圾也可以是商品。瑞典竟然向挪威進口垃圾！ 這是因為瑞典垃圾分類做得太好了，回收再利用的比例很高，所以能作為燃 料的垃圾不夠用來發電。 但是挪威把垃圾出口到瑞典還得先付一筆垃圾處理費，此外，燒完垃圾剩下 的東西也得自己運回國，這樣對挪威來說好像沒什麼好處。 其實瑞典燃燒垃圾的效率是全球第一，如果在挪威處理，費用只會更高。 原來如此。不過，我們都知道燃燒垃圾會產生多種有害的物質，利用燃燒垃 圾來生產能源，是不是太不環保了？ 這你就不用擔心了。燃燒垃圾後所排放的廢氣，會經過科技方法處理，清除 大部分有害的物質，比廚房、烤肉所產生的汙染還要低。況且透過燃燒垃圾 產生的電力屬於再生能源，能有效降低對石油的依賴，這是一個聰明的方 案。 28. 為什麼瑞典需要進口垃圾？ 29. 為什麼這位先生覺得這個合作方案對挪威沒有好處？ 30. 這位小姐對瑞典的發電方式，有什麼看法？ 第二部分 段落 請聽李大華的自我介紹，然後回答兩個問題。 各位同學大家好，我叫李大華，我原本住在臺南，後來由於父親工作的緣故， 搬到高雄跟臺北，之後才從臺北搬到臺中來上課。我的興趣是運動，除了運動還 喜歡收藏石頭，對玩電腦遊戲也很有興趣，但數學就讓我很頭痛了。我剛到這個 學校來，很多事都不了解，請大家多跟我分享。 31. 李大華覺得什麼事情對他來說很困難？ 32. 下面哪一句話是對的？ 請聽這一段火車開車前的廣播，然後回答兩個問題。 各位旅客您好，這是車長廣播。本班車為第74 號班車，本班車開車後，直 接到達終點站，中間不停靠其他車站。 本班車僅開放個人座位訂票，不接受站票，也不接受電子票，購買親子座位 的遊客，請至第一節車廂上車。如果您沒有購買本班車的坐票，請您不要上車， 否則列車長將按照規定，加收百分之五十的費用。 本班車不提供免費網路。此外，各車廂附有飲水機和洗手間，服務人員將在 第九節車廂販賣點心、飲料和紀念品，歡迎各位旅客前往購買。 33. 乘客使用下列哪種票券可以搭乘第74 號班車？ 34. 搭乘此班車，旅客能做哪件事？ 請聽這一段出國旅遊的心得，然後回答兩個問題。 上個月五號是我這輩子第一次自己出國玩。我會參加這個旅行團，是因為除 了能一次去兩個國家玩，還能在船上吃喝玩樂和欣賞精彩的表演。另外，旅遊行 程豐富，所有的費用也只要一萬多，讓我還沒上船就非常興奮。 上船後，我發現船上房間小但很舒適。不過，旅客和工作人員共有兩千多個 人，不管要吃飯還是看表演，都要排隊搶位子；船上的游泳池更總是擠滿了愛玩 水的孩子，害我不能游泳；連下船去玩也要先排隊，而且下船後能參觀的時間也 不多。我真的覺得這個錢花得不值得啊。 35. 關於這次的旅行，下面哪個是對的？ 36. 說話的人因為哪一件事覺得不開心？ 請聽這段有關商店慶祝周年慶的廣播，然後回答兩個問題。 感謝各位光臨本店，今天為慶祝本店營業滿十年，每位顧客只要消費，不論 金額多少，憑本日收據到五樓服務櫃臺，就能獲得本店贈送的紀念杯組。前一百 名顧客還有機會抽到電腦、手機等大獎。地下一樓也有額外的慶祝活動，「玩遊 戲，贏現金」，不管您是否消費，都歡迎參與。另外，本店各樓都有折扣活動， 歡迎參觀購買，祝您購物愉快。 37. 根據廣播，怎麼樣可以拿到「紀念杯組」？ 38. 根據廣播，下面哪一個是對的？ 請聽這段與地鐵站有關的介紹，然後回答兩個問題。 大家對自動販賣機應該不陌生，是一台專門賣飲料、零食的機器，只要投下 零錢，按下按鍵，就能買到你想要的東西。最近英國的地鐵站設置了一部特別的 自動販賣機，不需要投錢，只要按下按鍵，乘客就能得到一則免費的小故事。這 個「故事販賣機」提供三種長度的故事，分別有一分鐘、三分鐘和五分鐘，總共 有五萬多則故事，就算提早到車站也不無聊。有腦筋動得快的人，建議這款自動 販賣機也放在公共廁所裡，幫助培養上廁所的情緒。 39. 為什麼地鐵站要設置故事販賣機？ 40. 關於故事販賣機，這段介紹提到什麼？ 請聽這一段有關新年煙火的演講，然後回答兩個問題。 每年國內各著名景點的新年煙火都吸引不少遊客，人數可達數十萬人，極具 觀光價值。然而近日卻有少部分的人民認為，放煙火就是造成空氣品質變差的主 要原因，因此向有關部門提出建議，禁止這項活動。 事實上，煙火並不是造成空氣汙染的主因，交通工具排放的廢氣比煙火多更 多。況且，新年煙火除了極具觀光價值、為周圍店家帶來收入外，多數的國民認 為，煙火象徵著新的開始，令人十分感動，實在沒理由停辦。 41. 關於新年煙火，說話的人提到什麼？ 42. 說話的人對舉辦新年煙火的態度是什麼？ 請聽這則有關現代傳播媒體的報導，然後回答兩個問題。 從飲食消費到金融經濟，日常生活各方面都深受全球化的影響。然而，新聞 媒體卻未跟上全球化的腳步。 由於設立國外辦公室的成本高，自行製作國際新聞的費用龐大，許多電視台 減少在國外的人力。但是觀眾仍有收看國際新聞的需求，因此現在所看到的國際 新聞，大多都是向幾個西方的主要國家所購買的，造成觀眾往往只能接收到片面 的觀點。 如果電視台並未針對購買而來的新聞作出平衡報導，反而容易造成錯誤訊息 的傳播，讓觀眾掉入自以為的「國際觀」。 43. 這則報導主要在說明什麼？ 44. 根據這則報導，電視台面臨什麼問題？ 在荷蘭有一間專門租借衣服的「衣服圖書館」，只要辦一張「借衣證」，就能把 自己喜歡的衣服借回家。請聽這段介紹，然後回答三個問題： Ⅰ. 為什麼負責人想要成立這間「衣服圖書館」？ Ⅱ. 關於租借衣服，下面哪一個是對的？ Ⅲ. 這間「衣服圖書館」未來有什麼規劃？ 現在請聽這段介紹。 「衣服圖書館」的負責人表示，由於購物越來越方便，過度消費的現象也越 來越嚴重，而且人們買得多，丟得也多。因此負責人就把這些衣服集中起來，提 供衣服租借的服務，將這些衣服再次利用。 雖然「衣服圖書館」租的是別人不要的衣服，但是架上的每一件衣服都經過 嚴格檢查，這些衣服沒有一點臭味或是破損。店內乾淨整齊，看起來就像是一間 高級服飾店。加入會員以後，每個月只要700 元，就能租一到四件衣服，而且沒 有歸還期限，等客人穿膩了再來交換。如果真的很喜愛某件衣服，還可以用折扣 價購買。 這間「衣服圖書館」還有個遠大的目標，就是在全世界各大城市開設分店， 讓所有會員在出國時，不需要帶太多衣物，只需要有一張衣服圖書館的借衣卡， 在國外也能享受如此方便的服務。 45. 為什麼負責人想要成立這間「衣服圖書館」？ 46. 關於租借衣服，下面哪一個是對的？ 47. 這間「衣服圖書館」未來有什麼規劃？ 下面是一則有關運動的報導。請聽這則報導，然後回答三個問題： Ⅰ. 這則報導主要說明什麼？ Ⅱ. 臺灣政府怎麼鼓勵大家多運動？ Ⅲ. 為什麼越來越多公司願意支持路跑活動？ 現在請聽報導。 現代人越來越重視運動，以臺灣為例，每年有許多大小不同的路跑活動。不 僅如此，原本只出現在大都市的大型健身房和運動中心，經過十幾年發展後，在 其他城市裡都可看到。 運動風氣的形成，剛開始大多是由運動產品公司先提供經費支持大型活動和 比賽，培養運動人口成長，接著是政府鼓勵，然後慢慢地成為全民運動。以臺灣 來說，臺北市政府多年前先在各個區建立運動中心，培養市民的運動習慣，後來 其他城市也開始建設這樣的運動中心。 路跑運動也一樣，十年前臺北市每年大概只有幾場路跑活動，現在全臺每年 有好幾百場不同類型的路跑活動，舉辦路跑活動的公司也早就不只是跟運動有關 的，而是認為有商業機會的都會出錢支持，也讓戶外運動休閒事業慢慢地發展起 來。 48. 這則報導主要說明什麼？ 49. 臺灣政府怎麼鼓勵大家多運動？ 50. 為什麼越來越多公司願意支持路跑活動？",
        "dialogue": "男：我媽媽一天到晚嘮叨我面對未來太消極，沒給自己規劃一個目標，像是買房\n買車等等。\n女：我認為與其辛苦貸款買房子，還不如當租屋族，沒有那麼大的貸款壓力，生\n活能更輕鬆自在。\n男：下面哪一個是對的？\n請聽這一段和打掃家裡有關的對話，然後回答兩個問題。\n男：唉！今天下班後又得先打掃家裡才能休息。\n女：你打掃的頻率還真高，我大約一週才打掃一次。\n男：打掃既花時間又耗體力，要不是小孩容易過敏，我怎麼可能天天做呢？\n女：要不然買個掃地機器人怎麼樣？只要設定好時間，它就會自動開始掃地。\n14. 這位先生對於打掃的態度是什麼？\n15. 這位小姐給這位先生什麼建議？\n請聽這一段有關歌星說明他動手打人的訪問，然後回答兩個問題。\n女：今天節目中請到歌星李義來談一談最近的打人事件。李義，對於你的女朋友\n說你常對她動手，你想做點說明嗎？\n男：我跟她是吵過幾次架，過程中的確很生氣，兩人有些拉拉扯扯，但我絕對沒\n有要弄傷她的意思。\n女：其實人激動時常常難以控制自己，有時候自己以為沒什麼，可是對方已經覺\n得無法接受了。\n男：你說的對，無論如何我都要保持冷靜，不應該動手。很抱歉讓對方受到傷害，\n以後絕對不會再發生這樣的事。\n16. 這位女主持人對李義跟女朋友之間的問題有什麼想法？\n17. 對於打人事件，李義現在有什麼想法？\n請聽這一段同事間的對話，然後回答兩個問題。\n男：今天主管又故意在辦公室說話諷刺我，你都看見了吧！\n女：主管這麼做的確很過分，但為了繼續在公司待下去，你還是別跟他計較了。\n男：忍耐只會使同樣的情況再發生，對受害者造成更嚴重的傷害。這次我堅持告\n上法院，一定要讓他為自己的行為付出代價。\n女：好吧，既然你這麼堅持，希望你能獲得勝利，得到應有的賠償。\n18. 這位小姐一開始對這件事情有什麼看法？\n19. 這位先生為什麼堅持自己的做法？\n請聽這一段有關看電影的對話，然後回答兩個問題。\n男：我很想帶孩子去看電影，但一想到孩子可能會在電影院裡大吵大鬧，還是算\n了。\n女：在澳洲有些電影院設計了「哭泣的房間」。這個房間有四面透明、隔音良好\n的牆，還有獨立的音效設備。父母和孩子坐在裡面跟大家一起觀賞電影，就\n算孩子哭鬧也不會影響別人。\n男：這個設計跟教堂裡給親子專用的房間，有一樣的功能，讓父母能安心帶著孩\n子參加活動。\n女：沒錯！其實這個房間大家都能使用，這樣看電影的時候想尖叫、想大哭，一\n點都不用覺得尷尬。\n20. 關於「哭泣的房間」，下面哪一個是對的？\n21. 為什麼這位先生提到「教堂」？\n請聽這一段有關喝咖啡的對話，然後回答兩個問題。\n男：你每天喝那麼多咖啡，對身體不好吧！\n女：你對咖啡的印象已經落伍了，其實喝咖啡的好處不少呢！\n男：除了讓精神好一點，咖啡還能有什麼好處？\n女：根據這兩年一些已發表的研究結果，喝咖啡能減輕疼痛，還能降低得到心臟\n疾病的風險。\n男：那都是廠商行銷的手段。我不反對你喝咖啡，但像你這樣把咖啡當水喝，一\n定對身體不好，你啊！早晚得去看醫生。\n22. 關於咖啡，他們說了什麼？\n23. 這位先生對咖啡的看法是什麼？\n請聽這一段同事間的對話，然後回答兩個問題。\n男：你最近怎麼都這麼早到公司？你搭的火車班次，又改時間了啊？\n女：不是改時間，而是「停駛」，我搭的那班車，因為司機罷工，停開了。所以，\n我只好搭公車來公司，但是害怕車子塞在高速公路上，上班會遲到，不得不\n提早出發。\n男：哇，這不是前兩個月才剛罷過工嗎？說是薪水太少、福利太差，所以火車公\n司才剛調整過他們的薪水，這次又為了什麼？\n女：這次好像是火車公司想要調整公司結構，但是沒有跟員工好好溝通，所以，\n又罷工了。\n24. 這位小姐為什麼早到公司？\n25. 他們提到火車公司什麼事？\n請聽這段和跑步有關的對話，然後回答兩個問題。\n男：你的臉色怎麼這麼難看，感冒了嗎？\n女：我昨天慢跑了三公里，現在腿痛得不得了。\n男：我不知道你這麼喜歡運動，你常跑步嗎？\n女：我最近剛開始練習跑步，我以為慢跑很輕鬆，沒想到我不但跑不了那麼遠，\n還這麼累。\n男：妳沒有慢跑的經驗，先不管跑步的速度怎麼樣，一開始最好不要跑長距離，\n否則對健康有不好的影響。你等身體適應了以後，再跑三公里吧！\n女：你說的好像滿有道理的，因為運動讓自己受傷，太不值得了，下次我會更小\n心。\n26. 這位小姐對慢跑的看法是什麼？\n27. 這位先生從哪方面給這位小姐建議？\n請聽這段有關「瑞典向挪威進口垃圾」的討論，然後回答三個問題。\nⅠ. 為什麼瑞典需要進口垃圾？\nⅡ. 為什麼這位先生覺得這個合作方案對挪威沒有好處？\nⅢ. 這位小姐對瑞典的發電方式，有什麼看法？\n現在請聽討論。\n男：我沒看錯吧？垃圾也可以是商品。瑞典竟然向挪威進口垃圾！\n女：這是因為瑞典垃圾分類做得太好了，回收再利用的比例很高，所以能作為燃\n料的垃圾不夠用來發電。\n男：但是挪威把垃圾出口到瑞典還得先付一筆垃圾處理費，此外，燒完垃圾剩下\n的東西也得自己運回國，這樣對挪威來說好像沒什麼好處。\n女：其實瑞典燃燒垃圾的效率是全球第一，如果在挪威處理，費用只會更高。\n男：原來如此。不過，我們都知道燃燒垃圾會產生多種有害的物質，利用燃燒垃\n圾來生產能源，是不是太不環保了？\n女：這你就不用擔心了。燃燒垃圾後所排放的廢氣，會經過科技方法處理，清除\n大部分有害的物質，比廚房、烤肉所產生的汙染還要低。況且透過燃燒垃圾\n產生的電力屬於再生能源，能有效降低對石油的依賴，這是一個聰明的方\n案。\n28. 為什麼瑞典需要進口垃圾？\n29. 為什麼這位先生覺得這個合作方案對挪威沒有好處？\n30. 這位小姐對瑞典的發電方式，有什麼看法？\n第二部分 段落\n請聽李大華的自我介紹，然後回答兩個問題。\n各位同學大家好，我叫李大華，我原本住在臺南，後來由於父親工作的緣故，\n搬到高雄跟臺北，之後才從臺北搬到臺中來上課。我的興趣是運動，除了運動還\n喜歡收藏石頭，對玩電腦遊戲也很有興趣，但數學就讓我很頭痛了。我剛到這個\n學校來，很多事都不了解，請大家多跟我分享。\n31. 李大華覺得什麼事情對他來說很困難？\n32. 下面哪一句話是對的？\n請聽這一段火車開車前的廣播，然後回答兩個問題。\n各位旅客您好，這是車長廣播。本班車為第74 號班車，本班車開車後，直\n接到達終點站，中間不停靠其他車站。\n本班車僅開放個人座位訂票，不接受站票，也不接受電子票，購買親子座位\n的遊客，請至第一節車廂上車。如果您沒有購買本班車的坐票，請您不要上車，\n否則列車長將按照規定，加收百分之五十的費用。\n本班車不提供免費網路。此外，各車廂附有飲水機和洗手間，服務人員將在\n第九節車廂販賣點心、飲料和紀念品，歡迎各位旅客前往購買。\n33. 乘客使用下列哪種票券可以搭乘第74 號班車？\n34. 搭乘此班車，旅客能做哪件事？\n請聽這一段出國旅遊的心得，然後回答兩個問題。\n上個月五號是我這輩子第一次自己出國玩。我會參加這個旅行團，是因為除\n了能一次去兩個國家玩，還能在船上吃喝玩樂和欣賞精彩的表演。另外，旅遊行\n程豐富，所有的費用也只要一萬多，讓我還沒上船就非常興奮。\n上船後，我發現船上房間小但很舒適。不過，旅客和工作人員共有兩千多個\n人，不管要吃飯還是看表演，都要排隊搶位子；船上的游泳池更總是擠滿了愛玩\n水的孩子，害我不能游泳；連下船去玩也要先排隊，而且下船後能參觀的時間也\n不多。我真的覺得這個錢花得不值得啊。\n35. 關於這次的旅行，下面哪個是對的？\n36. 說話的人因為哪一件事覺得不開心？\n請聽這段有關商店慶祝周年慶的廣播，然後回答兩個問題。\n感謝各位光臨本店，今天為慶祝本店營業滿十年，每位顧客只要消費，不論\n金額多少，憑本日收據到五樓服務櫃臺，就能獲得本店贈送的紀念杯組。前一百\n名顧客還有機會抽到電腦、手機等大獎。地下一樓也有額外的慶祝活動，「玩遊\n戲，贏現金」，不管您是否消費，都歡迎參與。另外，本店各樓都有折扣活動，\n歡迎參觀購買，祝您購物愉快。\n37. 根據廣播，怎麼樣可以拿到「紀念杯組」？\n38. 根據廣播，下面哪一個是對的？\n請聽這段與地鐵站有關的介紹，然後回答兩個問題。\n大家對自動販賣機應該不陌生，是一台專門賣飲料、零食的機器，只要投下\n零錢，按下按鍵，就能買到你想要的東西。最近英國的地鐵站設置了一部特別的\n自動販賣機，不需要投錢，只要按下按鍵，乘客就能得到一則免費的小故事。這\n個「故事販賣機」提供三種長度的故事，分別有一分鐘、三分鐘和五分鐘，總共\n有五萬多則故事，就算提早到車站也不無聊。有腦筋動得快的人，建議這款自動\n販賣機也放在公共廁所裡，幫助培養上廁所的情緒。\n39. 為什麼地鐵站要設置故事販賣機？\n40. 關於故事販賣機，這段介紹提到什麼？\n請聽這一段有關新年煙火的演講，然後回答兩個問題。\n每年國內各著名景點的新年煙火都吸引不少遊客，人數可達數十萬人，極具\n觀光價值。然而近日卻有少部分的人民認為，放煙火就是造成空氣品質變差的主\n要原因，因此向有關部門提出建議，禁止這項活動。\n事實上，煙火並不是造成空氣汙染的主因，交通工具排放的廢氣比煙火多更\n多。況且，新年煙火除了極具觀光價值、為周圍店家帶來收入外，多數的國民認\n為，煙火象徵著新的開始，令人十分感動，實在沒理由停辦。\n41. 關於新年煙火，說話的人提到什麼？\n42. 說話的人對舉辦新年煙火的態度是什麼？\n請聽這則有關現代傳播媒體的報導，然後回答兩個問題。\n從飲食消費到金融經濟，日常生活各方面都深受全球化的影響。然而，新聞\n媒體卻未跟上全球化的腳步。\n由於設立國外辦公室的成本高，自行製作國際新聞的費用龐大，許多電視台\n減少在國外的人力。但是觀眾仍有收看國際新聞的需求，因此現在所看到的國際\n新聞，大多都是向幾個西方的主要國家所購買的，造成觀眾往往只能接收到片面\n的觀點。\n如果電視台並未針對購買而來的新聞作出平衡報導，反而容易造成錯誤訊息\n的傳播，讓觀眾掉入自以為的「國際觀」。\n43. 這則報導主要在說明什麼？\n44. 根據這則報導，電視台面臨什麼問題？\n在荷蘭有一間專門租借衣服的「衣服圖書館」，只要辦一張「借衣證」，就能把\n自己喜歡的衣服借回家。請聽這段介紹，然後回答三個問題：\nⅠ. 為什麼負責人想要成立這間「衣服圖書館」？\nⅡ. 關於租借衣服，下面哪一個是對的？\nⅢ. 這間「衣服圖書館」未來有什麼規劃？\n現在請聽這段介紹。\n「衣服圖書館」的負責人表示，由於購物越來越方便，過度消費的現象也越\n來越嚴重，而且人們買得多，丟得也多。因此負責人就把這些衣服集中起來，提\n供衣服租借的服務，將這些衣服再次利用。\n雖然「衣服圖書館」租的是別人不要的衣服，但是架上的每一件衣服都經過\n嚴格檢查，這些衣服沒有一點臭味或是破損。店內乾淨整齊，看起來就像是一間\n高級服飾店。加入會員以後，每個月只要700 元，就能租一到四件衣服，而且沒\n有歸還期限，等客人穿膩了再來交換。如果真的很喜愛某件衣服，還可以用折扣\n價購買。\n這間「衣服圖書館」還有個遠大的目標，就是在全世界各大城市開設分店，\n讓所有會員在出國時，不需要帶太多衣物，只需要有一張衣服圖書館的借衣卡，\n在國外也能享受如此方便的服務。\n45. 為什麼負責人想要成立這間「衣服圖書館」？\n46. 關於租借衣服，下面哪一個是對的？\n47. 這間「衣服圖書館」未來有什麼規劃？\n下面是一則有關運動的報導。請聽這則報導，然後回答三個問題：\nⅠ. 這則報導主要說明什麼？\nⅡ. 臺灣政府怎麼鼓勵大家多運動？\nⅢ. 為什麼越來越多公司願意支持路跑活動？\n現在請聽報導。\n現代人越來越重視運動，以臺灣為例，每年有許多大小不同的路跑活動。不\n僅如此，原本只出現在大都市的大型健身房和運動中心，經過十幾年發展後，在\n其他城市裡都可看到。\n運動風氣的形成，剛開始大多是由運動產品公司先提供經費支持大型活動和\n比賽，培養運動人口成長，接著是政府鼓勵，然後慢慢地成為全民運動。以臺灣\n來說，臺北市政府多年前先在各個區建立運動中心，培養市民的運動習慣，後來\n其他城市也開始建設這樣的運動中心。\n路跑運動也一樣，十年前臺北市每年大概只有幾場路跑活動，現在全臺每年\n有好幾百場不同類型的路跑活動，舉辦路跑活動的公司也早就不只是跟運動有關\n的，而是認為有商業機會的都會出錢支持，也讓戶外運動休閒事業慢慢地發展起\n來。\n48. 這則報導主要說明什麼？\n49. 臺灣政府怎麼鼓勵大家多運動？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我媽媽一天到晚嘮叨我面對未來太消極，沒給自己規劃一個目標，像是買房"
          },
          {
            "speaker": "narrator",
            "text": "買車等等。"
          },
          {
            "speaker": "female",
            "text": "我認為與其辛苦貸款買房子，還不如當租屋族，沒有那麼大的貸款壓力，生"
          },
          {
            "speaker": "narrator",
            "text": "活能更輕鬆自在。"
          },
          {
            "speaker": "male",
            "text": "下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段和打掃家裡有關的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "唉！今天下班後又得先打掃家裡才能休息。"
          },
          {
            "speaker": "female",
            "text": "你打掃的頻率還真高，我大約一週才打掃一次。"
          },
          {
            "speaker": "male",
            "text": "打掃既花時間又耗體力，要不是小孩容易過敏，我怎麼可能天天做呢？"
          },
          {
            "speaker": "female",
            "text": "要不然買個掃地機器人怎麼樣？只要設定好時間，它就會自動開始掃地。"
          },
          {
            "speaker": "narrator",
            "text": "14. 這位先生對於打掃的態度是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "15. 這位小姐給這位先生什麼建議？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段有關歌星說明他動手打人的訪問，然後回答兩個問題。"
          },
          {
            "speaker": "female",
            "text": "今天節目中請到歌星李義來談一談最近的打人事件。李義，對於你的女朋友"
          },
          {
            "speaker": "narrator",
            "text": "說你常對她動手，你想做點說明嗎？"
          },
          {
            "speaker": "male",
            "text": "我跟她是吵過幾次架，過程中的確很生氣，兩人有些拉拉扯扯，但我絕對沒"
          },
          {
            "speaker": "narrator",
            "text": "有要弄傷她的意思。"
          },
          {
            "speaker": "female",
            "text": "其實人激動時常常難以控制自己，有時候自己以為沒什麼，可是對方已經覺"
          },
          {
            "speaker": "narrator",
            "text": "得無法接受了。"
          },
          {
            "speaker": "male",
            "text": "你說的對，無論如何我都要保持冷靜，不應該動手。很抱歉讓對方受到傷害，"
          },
          {
            "speaker": "narrator",
            "text": "以後絕對不會再發生這樣的事。"
          },
          {
            "speaker": "narrator",
            "text": "16. 這位女主持人對李義跟女朋友之間的問題有什麼想法？"
          },
          {
            "speaker": "narrator",
            "text": "17. 對於打人事件，李義現在有什麼想法？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段同事間的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "今天主管又故意在辦公室說話諷刺我，你都看見了吧！"
          },
          {
            "speaker": "female",
            "text": "主管這麼做的確很過分，但為了繼續在公司待下去，你還是別跟他計較了。"
          },
          {
            "speaker": "male",
            "text": "忍耐只會使同樣的情況再發生，對受害者造成更嚴重的傷害。這次我堅持告"
          },
          {
            "speaker": "narrator",
            "text": "上法院，一定要讓他為自己的行為付出代價。"
          },
          {
            "speaker": "female",
            "text": "好吧，既然你這麼堅持，希望你能獲得勝利，得到應有的賠償。"
          },
          {
            "speaker": "narrator",
            "text": "18. 這位小姐一開始對這件事情有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "19. 這位先生為什麼堅持自己的做法？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段有關看電影的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "我很想帶孩子去看電影，但一想到孩子可能會在電影院裡大吵大鬧，還是算"
          },
          {
            "speaker": "narrator",
            "text": "了。"
          },
          {
            "speaker": "female",
            "text": "在澳洲有些電影院設計了「哭泣的房間」。這個房間有四面透明、隔音良好"
          },
          {
            "speaker": "narrator",
            "text": "的牆，還有獨立的音效設備。父母和孩子坐在裡面跟大家一起觀賞電影，就"
          },
          {
            "speaker": "narrator",
            "text": "算孩子哭鬧也不會影響別人。"
          },
          {
            "speaker": "male",
            "text": "這個設計跟教堂裡給親子專用的房間，有一樣的功能，讓父母能安心帶著孩"
          },
          {
            "speaker": "narrator",
            "text": "子參加活動。"
          },
          {
            "speaker": "female",
            "text": "沒錯！其實這個房間大家都能使用，這樣看電影的時候想尖叫、想大哭，一"
          },
          {
            "speaker": "narrator",
            "text": "點都不用覺得尷尬。"
          },
          {
            "speaker": "narrator",
            "text": "20. 關於「哭泣的房間」，下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "21. 為什麼這位先生提到「教堂」？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段有關喝咖啡的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "你每天喝那麼多咖啡，對身體不好吧！"
          },
          {
            "speaker": "female",
            "text": "你對咖啡的印象已經落伍了，其實喝咖啡的好處不少呢！"
          },
          {
            "speaker": "male",
            "text": "除了讓精神好一點，咖啡還能有什麼好處？"
          },
          {
            "speaker": "female",
            "text": "根據這兩年一些已發表的研究結果，喝咖啡能減輕疼痛，還能降低得到心臟"
          },
          {
            "speaker": "narrator",
            "text": "疾病的風險。"
          },
          {
            "speaker": "male",
            "text": "那都是廠商行銷的手段。我不反對你喝咖啡，但像你這樣把咖啡當水喝，一"
          },
          {
            "speaker": "narrator",
            "text": "定對身體不好，你啊！早晚得去看醫生。"
          },
          {
            "speaker": "narrator",
            "text": "22. 關於咖啡，他們說了什麼？"
          },
          {
            "speaker": "narrator",
            "text": "23. 這位先生對咖啡的看法是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段同事間的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "你最近怎麼都這麼早到公司？你搭的火車班次，又改時間了啊？"
          },
          {
            "speaker": "female",
            "text": "不是改時間，而是「停駛」，我搭的那班車，因為司機罷工，停開了。所以，"
          },
          {
            "speaker": "narrator",
            "text": "我只好搭公車來公司，但是害怕車子塞在高速公路上，上班會遲到，不得不"
          },
          {
            "speaker": "narrator",
            "text": "提早出發。"
          },
          {
            "speaker": "male",
            "text": "哇，這不是前兩個月才剛罷過工嗎？說是薪水太少、福利太差，所以火車公"
          },
          {
            "speaker": "narrator",
            "text": "司才剛調整過他們的薪水，這次又為了什麼？"
          },
          {
            "speaker": "female",
            "text": "這次好像是火車公司想要調整公司結構，但是沒有跟員工好好溝通，所以，"
          },
          {
            "speaker": "narrator",
            "text": "又罷工了。"
          },
          {
            "speaker": "narrator",
            "text": "24. 這位小姐為什麼早到公司？"
          },
          {
            "speaker": "narrator",
            "text": "25. 他們提到火車公司什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段和跑步有關的對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "你的臉色怎麼這麼難看，感冒了嗎？"
          },
          {
            "speaker": "female",
            "text": "我昨天慢跑了三公里，現在腿痛得不得了。"
          },
          {
            "speaker": "male",
            "text": "我不知道你這麼喜歡運動，你常跑步嗎？"
          },
          {
            "speaker": "female",
            "text": "我最近剛開始練習跑步，我以為慢跑很輕鬆，沒想到我不但跑不了那麼遠，"
          },
          {
            "speaker": "narrator",
            "text": "還這麼累。"
          },
          {
            "speaker": "male",
            "text": "妳沒有慢跑的經驗，先不管跑步的速度怎麼樣，一開始最好不要跑長距離，"
          },
          {
            "speaker": "narrator",
            "text": "否則對健康有不好的影響。你等身體適應了以後，再跑三公里吧！"
          },
          {
            "speaker": "female",
            "text": "你說的好像滿有道理的，因為運動讓自己受傷，太不值得了，下次我會更小"
          },
          {
            "speaker": "narrator",
            "text": "心。"
          },
          {
            "speaker": "narrator",
            "text": "26. 這位小姐對慢跑的看法是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "27. 這位先生從哪方面給這位小姐建議？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段有關「瑞典向挪威進口垃圾」的討論，然後回答三個問題。"
          },
          {
            "speaker": "narrator",
            "text": "Ⅰ. 為什麼瑞典需要進口垃圾？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅱ. 為什麼這位先生覺得這個合作方案對挪威沒有好處？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅲ. 這位小姐對瑞典的發電方式，有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽討論。"
          },
          {
            "speaker": "male",
            "text": "我沒看錯吧？垃圾也可以是商品。瑞典竟然向挪威進口垃圾！"
          },
          {
            "speaker": "female",
            "text": "這是因為瑞典垃圾分類做得太好了，回收再利用的比例很高，所以能作為燃"
          },
          {
            "speaker": "narrator",
            "text": "料的垃圾不夠用來發電。"
          },
          {
            "speaker": "male",
            "text": "但是挪威把垃圾出口到瑞典還得先付一筆垃圾處理費，此外，燒完垃圾剩下"
          },
          {
            "speaker": "narrator",
            "text": "的東西也得自己運回國，這樣對挪威來說好像沒什麼好處。"
          },
          {
            "speaker": "female",
            "text": "其實瑞典燃燒垃圾的效率是全球第一，如果在挪威處理，費用只會更高。"
          },
          {
            "speaker": "male",
            "text": "原來如此。不過，我們都知道燃燒垃圾會產生多種有害的物質，利用燃燒垃"
          },
          {
            "speaker": "narrator",
            "text": "圾來生產能源，是不是太不環保了？"
          },
          {
            "speaker": "female",
            "text": "這你就不用擔心了。燃燒垃圾後所排放的廢氣，會經過科技方法處理，清除"
          },
          {
            "speaker": "narrator",
            "text": "大部分有害的物質，比廚房、烤肉所產生的汙染還要低。況且透過燃燒垃圾"
          },
          {
            "speaker": "narrator",
            "text": "產生的電力屬於再生能源，能有效降低對石油的依賴，這是一個聰明的方"
          },
          {
            "speaker": "narrator",
            "text": "案。"
          },
          {
            "speaker": "narrator",
            "text": "28. 為什麼瑞典需要進口垃圾？"
          },
          {
            "speaker": "narrator",
            "text": "29. 為什麼這位先生覺得這個合作方案對挪威沒有好處？"
          },
          {
            "speaker": "narrator",
            "text": "30. 這位小姐對瑞典的發電方式，有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "第二部分 段落"
          },
          {
            "speaker": "narrator",
            "text": "請聽李大華的自我介紹，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "各位同學大家好，我叫李大華，我原本住在臺南，後來由於父親工作的緣故，"
          },
          {
            "speaker": "narrator",
            "text": "搬到高雄跟臺北，之後才從臺北搬到臺中來上課。我的興趣是運動，除了運動還"
          },
          {
            "speaker": "narrator",
            "text": "喜歡收藏石頭，對玩電腦遊戲也很有興趣，但數學就讓我很頭痛了。我剛到這個"
          },
          {
            "speaker": "narrator",
            "text": "學校來，很多事都不了解，請大家多跟我分享。"
          },
          {
            "speaker": "narrator",
            "text": "31. 李大華覺得什麼事情對他來說很困難？"
          },
          {
            "speaker": "narrator",
            "text": "32. 下面哪一句話是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段火車開車前的廣播，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "各位旅客您好，這是車長廣播。本班車為第74 號班車，本班車開車後，直"
          },
          {
            "speaker": "narrator",
            "text": "接到達終點站，中間不停靠其他車站。"
          },
          {
            "speaker": "narrator",
            "text": "本班車僅開放個人座位訂票，不接受站票，也不接受電子票，購買親子座位"
          },
          {
            "speaker": "narrator",
            "text": "的遊客，請至第一節車廂上車。如果您沒有購買本班車的坐票，請您不要上車，"
          },
          {
            "speaker": "narrator",
            "text": "否則列車長將按照規定，加收百分之五十的費用。"
          },
          {
            "speaker": "narrator",
            "text": "本班車不提供免費網路。此外，各車廂附有飲水機和洗手間，服務人員將在"
          },
          {
            "speaker": "narrator",
            "text": "第九節車廂販賣點心、飲料和紀念品，歡迎各位旅客前往購買。"
          },
          {
            "speaker": "narrator",
            "text": "33. 乘客使用下列哪種票券可以搭乘第74 號班車？"
          },
          {
            "speaker": "narrator",
            "text": "34. 搭乘此班車，旅客能做哪件事？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段出國旅遊的心得，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "上個月五號是我這輩子第一次自己出國玩。我會參加這個旅行團，是因為除"
          },
          {
            "speaker": "narrator",
            "text": "了能一次去兩個國家玩，還能在船上吃喝玩樂和欣賞精彩的表演。另外，旅遊行"
          },
          {
            "speaker": "narrator",
            "text": "程豐富，所有的費用也只要一萬多，讓我還沒上船就非常興奮。"
          },
          {
            "speaker": "narrator",
            "text": "上船後，我發現船上房間小但很舒適。不過，旅客和工作人員共有兩千多個"
          },
          {
            "speaker": "narrator",
            "text": "人，不管要吃飯還是看表演，都要排隊搶位子；船上的游泳池更總是擠滿了愛玩"
          },
          {
            "speaker": "narrator",
            "text": "水的孩子，害我不能游泳；連下船去玩也要先排隊，而且下船後能參觀的時間也"
          },
          {
            "speaker": "narrator",
            "text": "不多。我真的覺得這個錢花得不值得啊。"
          },
          {
            "speaker": "narrator",
            "text": "35. 關於這次的旅行，下面哪個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "36. 說話的人因為哪一件事覺得不開心？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段有關商店慶祝周年慶的廣播，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "感謝各位光臨本店，今天為慶祝本店營業滿十年，每位顧客只要消費，不論"
          },
          {
            "speaker": "narrator",
            "text": "金額多少，憑本日收據到五樓服務櫃臺，就能獲得本店贈送的紀念杯組。前一百"
          },
          {
            "speaker": "narrator",
            "text": "名顧客還有機會抽到電腦、手機等大獎。地下一樓也有額外的慶祝活動，「玩遊"
          },
          {
            "speaker": "narrator",
            "text": "戲，贏現金」，不管您是否消費，都歡迎參與。另外，本店各樓都有折扣活動，"
          },
          {
            "speaker": "narrator",
            "text": "歡迎參觀購買，祝您購物愉快。"
          },
          {
            "speaker": "narrator",
            "text": "37. 根據廣播，怎麼樣可以拿到「紀念杯組」？"
          },
          {
            "speaker": "narrator",
            "text": "38. 根據廣播，下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段與地鐵站有關的介紹，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "大家對自動販賣機應該不陌生，是一台專門賣飲料、零食的機器，只要投下"
          },
          {
            "speaker": "narrator",
            "text": "零錢，按下按鍵，就能買到你想要的東西。最近英國的地鐵站設置了一部特別的"
          },
          {
            "speaker": "narrator",
            "text": "自動販賣機，不需要投錢，只要按下按鍵，乘客就能得到一則免費的小故事。這"
          },
          {
            "speaker": "narrator",
            "text": "個「故事販賣機」提供三種長度的故事，分別有一分鐘、三分鐘和五分鐘，總共"
          },
          {
            "speaker": "narrator",
            "text": "有五萬多則故事，就算提早到車站也不無聊。有腦筋動得快的人，建議這款自動"
          },
          {
            "speaker": "narrator",
            "text": "販賣機也放在公共廁所裡，幫助培養上廁所的情緒。"
          },
          {
            "speaker": "narrator",
            "text": "39. 為什麼地鐵站要設置故事販賣機？"
          },
          {
            "speaker": "narrator",
            "text": "40. 關於故事販賣機，這段介紹提到什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段有關新年煙火的演講，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "每年國內各著名景點的新年煙火都吸引不少遊客，人數可達數十萬人，極具"
          },
          {
            "speaker": "narrator",
            "text": "觀光價值。然而近日卻有少部分的人民認為，放煙火就是造成空氣品質變差的主"
          },
          {
            "speaker": "narrator",
            "text": "要原因，因此向有關部門提出建議，禁止這項活動。"
          },
          {
            "speaker": "narrator",
            "text": "事實上，煙火並不是造成空氣汙染的主因，交通工具排放的廢氣比煙火多更"
          },
          {
            "speaker": "narrator",
            "text": "多。況且，新年煙火除了極具觀光價值、為周圍店家帶來收入外，多數的國民認"
          },
          {
            "speaker": "narrator",
            "text": "為，煙火象徵著新的開始，令人十分感動，實在沒理由停辦。"
          },
          {
            "speaker": "narrator",
            "text": "41. 關於新年煙火，說話的人提到什麼？"
          },
          {
            "speaker": "narrator",
            "text": "42. 說話的人對舉辦新年煙火的態度是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這則有關現代傳播媒體的報導，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "從飲食消費到金融經濟，日常生活各方面都深受全球化的影響。然而，新聞"
          },
          {
            "speaker": "narrator",
            "text": "媒體卻未跟上全球化的腳步。"
          },
          {
            "speaker": "narrator",
            "text": "由於設立國外辦公室的成本高，自行製作國際新聞的費用龐大，許多電視台"
          },
          {
            "speaker": "narrator",
            "text": "減少在國外的人力。但是觀眾仍有收看國際新聞的需求，因此現在所看到的國際"
          },
          {
            "speaker": "narrator",
            "text": "新聞，大多都是向幾個西方的主要國家所購買的，造成觀眾往往只能接收到片面"
          },
          {
            "speaker": "narrator",
            "text": "的觀點。"
          },
          {
            "speaker": "narrator",
            "text": "如果電視台並未針對購買而來的新聞作出平衡報導，反而容易造成錯誤訊息"
          },
          {
            "speaker": "narrator",
            "text": "的傳播，讓觀眾掉入自以為的「國際觀」。"
          },
          {
            "speaker": "narrator",
            "text": "43. 這則報導主要在說明什麼？"
          },
          {
            "speaker": "narrator",
            "text": "44. 根據這則報導，電視台面臨什麼問題？"
          },
          {
            "speaker": "narrator",
            "text": "在荷蘭有一間專門租借衣服的「衣服圖書館」，只要辦一張「借衣證」，就能把"
          },
          {
            "speaker": "narrator",
            "text": "自己喜歡的衣服借回家。請聽這段介紹，然後回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "Ⅰ. 為什麼負責人想要成立這間「衣服圖書館」？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅱ. 關於租借衣服，下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅲ. 這間「衣服圖書館」未來有什麼規劃？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽這段介紹。"
          },
          {
            "speaker": "narrator",
            "text": "「衣服圖書館」的負責人表示，由於購物越來越方便，過度消費的現象也越"
          },
          {
            "speaker": "narrator",
            "text": "來越嚴重，而且人們買得多，丟得也多。因此負責人就把這些衣服集中起來，提"
          },
          {
            "speaker": "narrator",
            "text": "供衣服租借的服務，將這些衣服再次利用。"
          },
          {
            "speaker": "narrator",
            "text": "雖然「衣服圖書館」租的是別人不要的衣服，但是架上的每一件衣服都經過"
          },
          {
            "speaker": "narrator",
            "text": "嚴格檢查，這些衣服沒有一點臭味或是破損。店內乾淨整齊，看起來就像是一間"
          },
          {
            "speaker": "narrator",
            "text": "高級服飾店。加入會員以後，每個月只要700 元，就能租一到四件衣服，而且沒"
          },
          {
            "speaker": "narrator",
            "text": "有歸還期限，等客人穿膩了再來交換。如果真的很喜愛某件衣服，還可以用折扣"
          },
          {
            "speaker": "narrator",
            "text": "價購買。"
          },
          {
            "speaker": "narrator",
            "text": "這間「衣服圖書館」還有個遠大的目標，就是在全世界各大城市開設分店，"
          },
          {
            "speaker": "narrator",
            "text": "讓所有會員在出國時，不需要帶太多衣物，只需要有一張衣服圖書館的借衣卡，"
          },
          {
            "speaker": "narrator",
            "text": "在國外也能享受如此方便的服務。"
          },
          {
            "speaker": "narrator",
            "text": "45. 為什麼負責人想要成立這間「衣服圖書館」？"
          },
          {
            "speaker": "narrator",
            "text": "46. 關於租借衣服，下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "47. 這間「衣服圖書館」未來有什麼規劃？"
          },
          {
            "speaker": "narrator",
            "text": "下面是一則有關運動的報導。請聽這則報導，然後回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "Ⅰ. 這則報導主要說明什麼？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅱ. 臺灣政府怎麼鼓勵大家多運動？"
          },
          {
            "speaker": "narrator",
            "text": "Ⅲ. 為什麼越來越多公司願意支持路跑活動？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "現代人越來越重視運動，以臺灣為例，每年有許多大小不同的路跑活動。不"
          },
          {
            "speaker": "narrator",
            "text": "僅如此，原本只出現在大都市的大型健身房和運動中心，經過十幾年發展後，在"
          },
          {
            "speaker": "narrator",
            "text": "其他城市裡都可看到。"
          },
          {
            "speaker": "narrator",
            "text": "運動風氣的形成，剛開始大多是由運動產品公司先提供經費支持大型活動和"
          },
          {
            "speaker": "narrator",
            "text": "比賽，培養運動人口成長，接著是政府鼓勵，然後慢慢地成為全民運動。以臺灣"
          },
          {
            "speaker": "narrator",
            "text": "來說，臺北市政府多年前先在各個區建立運動中心，培養市民的運動習慣，後來"
          },
          {
            "speaker": "narrator",
            "text": "其他城市也開始建設這樣的運動中心。"
          },
          {
            "speaker": "narrator",
            "text": "路跑運動也一樣，十年前臺北市每年大概只有幾場路跑活動，現在全臺每年"
          },
          {
            "speaker": "narrator",
            "text": "有好幾百場不同類型的路跑活動，舉辦路跑活動的公司也早就不只是跟運動有關"
          },
          {
            "speaker": "narrator",
            "text": "的，而是認為有商業機會的都會出錢支持，也讓戶外運動休閒事業慢慢地發展起"
          },
          {
            "speaker": "narrator",
            "text": "來。"
          },
          {
            "speaker": "narrator",
            "text": "48. 這則報導主要說明什麼？"
          },
          {
            "speaker": "narrator",
            "text": "49. 臺灣政府怎麼鼓勵大家多運動？"
          },
          {
            "speaker": "narrator",
            "text": "50. 為什麼越來越多公司願意支持路跑活動？"
          }
        ],
        "q": "50. 為什麼越來越多公司願意支持路跑活動？",
        "options": [
          "這位先生想貸款買房子",
          "這位小姐覺得這位先生很消極",
          "這位先生的媽媽覺得買房不如租房",
          "這位小姐不想負擔太大的經濟壓力"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位小姐不想負擔太大的經濟壓力. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 14",
        "options": [
          "相當無助",
          "非常逃避",
          "有點猶豫",
          "無可奈何"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 無可奈何. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 15",
        "options": [
          "使用工具讓掃地更輕鬆",
          "計畫好固定的打掃時間",
          "減少每週打掃環境的次數",
          "購買能掃得更乾淨的工具"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 使用工具讓掃地更輕鬆. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 16",
        "options": [
          "李義的女朋友反應過度了",
          "男女朋友之間吵架沒什麼",
          "就算動手打人也解決不了問題",
          "也許李義沒想到情況有多嚴重"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 也許李義沒想到情況有多嚴重. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 17",
        "options": [
          "他很害怕女朋友想跟他分手",
          "他很後悔不小心傷了女朋友",
          "他沒辦法認同女朋友的說法",
          "他覺得自己嘗試控制情緒了"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 他很後悔不小心傷了女朋友. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 18",
        "options": [
          "工作做得好比較重要",
          "應該尋求其他的幫助",
          "再忍受一次也不要緊",
          "沒什麼好覺得驚訝的"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 再忍受一次也不要緊. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 19",
        "options": [
          "在公司才能有好的發展",
          "有把握能讓主管都滿意",
          "請教過有類似經驗的同事",
          "讓主管知道事情的嚴重性"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 讓主管知道事情的嚴重性. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 20",
        "options": [
          "在裡面才能安靜地看電影",
          "孩子一哭鬧，就會被帶進去",
          "任何人都可以使用這個房間",
          "可以自由選擇自己想看的影片"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 任何人都可以使用這個房間. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 21",
        "options": [
          "因為房間的設計源自於教堂",
          "因為教堂也提供這樣的房間",
          "因為教堂有照顧孩子的服務",
          "因為教堂能接受小孩子哭鬧"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 因為教堂也提供這樣的房間. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 22",
        "options": [
          "每天建議的咖啡量",
          "和咖啡相關的廣告",
          "有關咖啡的研究結果",
          "咖啡作為藥物的原料"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 有關咖啡的研究結果. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 23",
        "options": [
          "得喝很多才會有精神",
          "可降低得心臟疾病的風險",
          "不管喝多喝少都會造成身體傷害",
          "他不相信這位小姐提到的那些好處"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他不相信這位小姐提到的那些好處. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 24",
        "options": [
          "火車提早了發車時間",
          "高速公路最近不塞車",
          "她換了交通工具上班",
          "老闆希望她不要遲到"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她換了交通工具上班. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 25",
        "options": [
          "最近經營的狀況",
          "公司有哪些福利",
          "火車司機的平均收入",
          "公司結構的組成方式"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 最近經營的狀況. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 1: Chọn từ thích hợp nhất điền vào chỗ trống [1].",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Dùng thể bị động '被'送進了醫院 (được đưa vào viện).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 2: Chọn từ thích hợp nhất điền vào chỗ trống [2].",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'陪'張太太 (đi cùng vợ).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 3: Chọn từ thích hợp nhất điền vào chỗ trống [3].",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'當'爸爸 (làm cha).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 4: Chọn từ thích hợp nhất điền vào chỗ trống [4].",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'為'這個孩子 (nghĩ tên 'cho' con).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 5: Chọn từ thích hợp nhất điền vào chỗ trống [5].",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'希望' (hy vọng sau này vừa đẹp vừa vui).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 6: Chọn từ thích hợp nhất điền vào chỗ trống [6].",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Cụm cố định '大學時代' (thời đại học).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 7: Chọn từ thích hợp nhất điền vào chỗ trống [7].",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp.",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 8: Chọn từ thích hợp nhất điền vào chỗ trống [8].",
        "options": [
          "忽然",
          "總是",
          "隨時",
          "從來"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'忽然'想起 (đột nhiên nhớ lại).",
        "pinyin": ""
      },
      {
        "id": 34,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 9: Chọn từ thích hợp nhất điền vào chỗ trống [9].",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'照'著地址 (lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 10: Chọn từ thích hợp nhất điền vào chỗ trống [10].",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp lại).",
        "pinyin": ""
      },
      {
        "id": 36,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 11: Chọn từ thích hợp nhất điền vào chỗ trống [11].",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'安排'戶外活動 (sắp xếp thời gian vận động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 37,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 12: Chọn từ thích hợp nhất điền vào chỗ trống [12].",
        "options": [
          "影響",
          "阻礙",
          "促進",
          "代替"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'促進'吸收 (thúc đẩy hấp thụ vitamin D).",
        "pinyin": ""
      },
      {
        "id": 38,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 13: Chọn từ thích hợp nhất điền vào chỗ trống [13].",
        "options": [
          "常常",
          "總是",
          "不斷",
          "難免"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'總是'在室內看螢幕 (luôn ở trong phòng xem màn hình).",
        "pinyin": ""
      },
      {
        "id": 39,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 14: Chọn từ thích hợp nhất điền vào chỗ trống [14].",
        "options": [
          "維護",
          "修理",
          "整理",
          "保證"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'維護'視力健康 (bảo vệ / duy trì sức khỏe thị lực).",
        "pinyin": ""
      },
      {
        "id": 40,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 15: Chọn từ thích hợp nhất điền vào chỗ trống [15].",
        "options": [
          "不能",
          "不要",
          "不可",
          "不必"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'不可'輕視 (tuyệt đối không được xem nhẹ).",
        "pinyin": ""
      },
      {
        "id": 41,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "dialogueSegments": [],
        "q": "Câu 16: 下面哪一個敘述完全符合短文內容？",
        "options": [
          "小明已經造訪韓國兩次了",
          "小明在韓國住了四個晚上",
          "小明覺得韓國食物不合胃口",
          "小明打算去日本留學"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết rõ: '玩了五天四夜' nghĩa là ở lại 4 đêm (四個晚上).",
        "pinyin": ""
      },
      {
        "id": 42,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 面對孩子成長的母親\n孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "dialogueSegments": [],
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，採取什麼態度？",
        "options": [
          "嚴厲責備孩子的膽怯",
          "答應明天親自開車接送",
          "鼓勵孩子勇敢獨立面對",
          "感到不知所措而焦慮"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Người mẹ khuyến khích: '你要學會自己面對挑戰' (động viên con dũng cảm tự đối diện).",
        "pinyin": ""
      },
      {
        "id": 43,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北夜市行動支付普及化\n以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "audio": "",
        "dialogue": "以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "dialogueSegments": [],
        "q": "Câu 18: 夜市引入行動支付帶來哪一項核心效益？",
        "options": [
          "大幅降低商品售價",
          "結帳更快速並兼顧衛生",
          "夜市營業時間延長至白天",
          "所有攤商免繳營業稅"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Văn bản nêu: '減少了排隊找零的時間, 也大幅降低了衛生疑慮' (thanh toán nhanh hơn và vệ sinh hơn).",
        "pinyin": ""
      },
      {
        "id": 44,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 捷運站二手書漂書箱與愛心傘\n台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "audio": "",
        "dialogue": "台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "dialogueSegments": [],
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪項優勢？",
        "options": [
          "列車行駛速度領先全球",
          "兼具人情味與信任的便民服務",
          "站內車廂提供免費餐飲",
          "票價比其他交通工具便宜"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả ngợi ca: '兼具人情味與信任的便民服務' (dịch vụ tiện dân ấm áp tình người dựa trên sự tin tưởng).",
        "pinyin": ""
      },
      {
        "id": 45,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北市垃圾費隨袋徵收政策成效\n台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "audio": "",
        "dialogue": "台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "dialogueSegments": [],
        "q": "Câu 20: 『垃圾費隨袋徵收』政策為何能有效減少垃圾量？",
        "options": [
          "市民為了省買垃圾袋的錢而努力做資源回收",
          "規定每戶每週最多只能丟一包垃圾",
          "禁止市民在超市購買塑膠袋包裝的食品",
          "提高亂丟垃圾的罰款金額十倍以上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Vì rác tái chế miễn phí còn rác thường tốn tiền mua túi, người dân tích cực phân loại để tiết kiệm chi phí mua túi rác.",
        "pinyin": ""
      },
      {
        "id": 46,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 高鐵串連台灣南北一日生活圈\n自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "audio": "",
        "dialogue": "自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "dialogueSegments": [],
        "q": "Câu 21: 『一日生活圈』對人們生活產生的實質改變是什麼？",
        "options": [
          "商務出差不必再在外地過夜",
          "民眾紛紛將戶籍遷往南部",
          "高鐵票價全面降至台鐵水準",
          "飛機成為國內最受歡迎的航線"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn nêu buổi sáng họp Đài Bắc, chiều tới Nam Bộ, tối về lại nhà (đi lại trong ngày không cần ở qua đêm).",
        "pinyin": ""
      },
      {
        "id": 47,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣全民健保雲端醫療資訊系統\n台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "audio": "",
        "dialogue": "台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "dialogueSegments": [],
        "q": "Câu 22: 健保雲端資訊系統的主要優勢是什麼？",
        "options": [
          "自動為病患減免掛號費用",
          "跨院即時查詢用藥紀錄避免重複開藥",
          "病患可在家自行線上開刀治療",
          "直接向國外藥廠訂購廉價藥品"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đoạn văn nêu rõ: '即時調閱檢查報告及用藥紀錄, 有效防範了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 48,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 誠品書店二十四小時營運的文化底蘊\n誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "dialogueSegments": [],
        "q": "Câu 23: 誠品書店之所以被譽為深夜文化地標，是因為什麼？",
        "options": [
          "深夜購書享有半價折扣",
          "結合文創美學將閱讀轉化為生活哲學",
          "只允許專業作家進入借閱圖書",
          "是台北市唯一的實體書店"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Tác giả chỉ rõ: '將單純的購書行為昇華為一種優雅慢活的生活哲學'.",
        "pinyin": ""
      },
      {
        "id": 49,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 美食外送平台對都會生活型態的衝擊\n隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "audio": "",
        "dialogue": "隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "dialogueSegments": [],
        "q": "Câu 24: 作者對於美食外送服務的蓬勃發展抱持何種看法？",
        "options": [
          "認為便利之餘亦伴隨交通與環保等社會隱憂",
          "強烈主張政府應立法全面禁止外送App",
          "認為外送餐點品質大幅超越店內現煮",
          "覺得外送員的薪資過高不合理"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả chỉ rõ: '伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題, 亟需深入探討' (tiện lợi nhưng tiềm ẩn nguy cơ giao thông và môi trường).",
        "pinyin": ""
      },
      {
        "id": 50,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 傳統菜市場的人情溫度與文化生命力\n儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "dialogueSegments": [],
        "q": "Câu 25: 傳統市場至今依然深受廣大民眾喜愛的核心魅力何在？",
        "options": [
          "冷氣空調比超市更強大涼爽",
          "濃厚的街坊人情味與客製化的人際互動",
          "所有生鮮蔬果皆由國外高價空運進口",
          "營業時間全天二十四小時不中斷"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Tác giả nhấn mạnh: '充滿街坊問候的人情溫度與鮮活的在地風土' (tình người nồng hậu và giao tiếp tương tác thân tình).",
        "pinyin": ""
      }
    ]
  },
  {
    "id": "mock_a1",
    "title": "TOCFL Band A - Đề thi Khởi động (Band A Mock)",
    "band": "Band A (基礎進階)",
    "badge": "Căn bản A1/A2",
    "duration": 45,
    "totalQ": 35,
    "desc": "Dành cho người mới củng cố kiến thức sơ trung cấp: câu hỏi giao tiếp đời sống, mua sắm và hỏi đường.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我想坐早上九點的火車到高雄去，中午到得了嗎？ 應該是到不了，到高雄大概要五個小時。 早上九點的火車什麼時候到高雄？",
        "dialogue": "男：我想坐早上九點的火車到高雄去，中午到得了嗎？\n女：應該是到不了，到高雄大概要五個小時。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我想坐早上九點的火車到高雄去，中午到得了嗎？"
          },
          {
            "speaker": "female",
            "text": "應該是到不了，到高雄大概要五個小時。"
          },
          {
            "speaker": "male",
            "text": "早上九點的火車什麼時候到高雄？"
          }
        ],
        "q": "早上九點的火車什麼時候到高雄？",
        "options": [
          "上午",
          "中午",
          "下午",
          "晚上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 下午. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小李最近好像在找房子，怎麼了？他不住了嗎？ 嗯，小李的房東要把房子賣了，他下個月就得搬家。 為什麼小李要搬家？",
        "dialogue": "男：小李最近好像在找房子，怎麼了？他不住了嗎？\n女：嗯，小李的房東要把房子賣了，他下個月就得搬家。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小李最近好像在找房子，怎麼了？他不住了嗎？"
          },
          {
            "speaker": "female",
            "text": "嗯，小李的房東要把房子賣了，他下個月就得搬家。"
          },
          {
            "speaker": "male",
            "text": "為什麼小李要搬家？"
          }
        ],
        "q": "為什麼小李要搬家？",
        "options": [
          "他買了新房子",
          "他把房子賣了",
          "他找到更好的房子",
          "他的房東要賣房子"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他的房東要賣房子. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳去停車，為什麼去了這麼久？ 這附近都找不到能停車的地方，所以我找了比較遠的地方停車。 這位小姐的意思是什麼？",
        "dialogue": "男：妳去停車，為什麼去了這麼久？\n女：這附近都找不到能停車的地方，所以我找了比較遠的地方停車。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳去停車，為什麼去了這麼久？"
          },
          {
            "speaker": "female",
            "text": "這附近都找不到能停車的地方，所以我找了比較遠的地方停車。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她很快就找到停車的位子",
          "她花了不少時間找地方停車",
          "她把車子停在比較近的地方",
          "她停車以後，找不到那位先生"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她花了不少時間找地方停車. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳怎麼在家？不和朋友到外面走走嗎？ 昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！ 這位小姐為什麼在家？",
        "dialogue": "男：妳怎麼在家？不和朋友到外面走走嗎？\n女：昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳怎麼在家？不和朋友到外面走走嗎？"
          },
          {
            "speaker": "female",
            "text": "昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！"
          },
          {
            "speaker": "male",
            "text": "這位小姐為什麼在家？"
          }
        ],
        "q": "這位小姐為什麼在家？",
        "options": [
          "她覺得有點累",
          "她身體不舒服",
          "她剛剛才從外面回來",
          "她還沒想好去哪兒玩"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她覺得有點累. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳這麼喜歡出國旅遊，那妳多久旅遊一次？ 差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。 這位小姐說了什麼？",
        "dialogue": "男：妳這麼喜歡出國旅遊，那妳多久旅遊一次？\n女：差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳這麼喜歡出國旅遊，那妳多久旅遊一次？"
          },
          {
            "speaker": "female",
            "text": "差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。"
          },
          {
            "speaker": "male",
            "text": "這位小姐說了什麼？"
          }
        ],
        "q": "這位小姐說了什麼？",
        "options": [
          "她一年出國旅遊兩次",
          "她今年不打算出國玩",
          "她每次去不一樣的國家玩",
          "她今年去韓國，明年想去日本"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她每次去不一樣的國家玩. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "老師要我們寫的作業，妳寫得怎麼樣？ 我想了好幾天，還是寫不出來。 這位小姐的意思是什麼？",
        "dialogue": "男：老師要我們寫的作業，妳寫得怎麼樣？\n女：我想了好幾天，還是寫不出來。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "老師要我們寫的作業，妳寫得怎麼樣？"
          },
          {
            "speaker": "female",
            "text": "我想了好幾天，還是寫不出來。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她不想寫作業",
          "她想不出來要寫什麼",
          "她不知道有什麼作業",
          "她記不得老師給的作業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她想不出來要寫什麼. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "一年以後，我們就買輛車子，到處去玩怎麼樣？ 別開玩笑了，哪來的錢呢？ 這位小姐的意思是什麼？",
        "dialogue": "男：一年以後，我們就買輛車子，到處去玩怎麼樣？\n女：別開玩笑了，哪來的錢呢？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "一年以後，我們就買輛車子，到處去玩怎麼樣？"
          },
          {
            "speaker": "female",
            "text": "別開玩笑了，哪來的錢呢？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "他們沒錢買車子",
          "她不喜歡出去玩",
          "這位先生常常開玩笑",
          "她不知道哪裡借得到錢"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他們沒錢買車子. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "嗯！這些菜聞起來好香，味道更是沒話說。 謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。 這位小姐說了什麼？",
        "dialogue": "男：嗯！這些菜聞起來好香，味道更是沒話說。\n女：謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "嗯！這些菜聞起來好香，味道更是沒話說。"
          },
          {
            "speaker": "female",
            "text": "謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。"
          },
          {
            "speaker": "male",
            "text": "這位小姐說了什麼？"
          }
        ],
        "q": "這位小姐說了什麼？",
        "options": [
          "她做菜做得不好",
          "她很喜歡自己做菜",
          "她喜歡吃別人煮的菜",
          "她只會吃東西，不會做菜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她很喜歡自己做菜. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "明天就要考試了！妳一點也不緊張嗎？ 有什麼好緊張的！我早就準備好了。 這位小姐的意思是什麼？",
        "dialogue": "男：明天就要考試了！妳一點也不緊張嗎？\n女：有什麼好緊張的！我早就準備好了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "明天就要考試了！妳一點也不緊張嗎？"
          },
          {
            "speaker": "female",
            "text": "有什麼好緊張的！我早就準備好了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她來不及把書讀完",
          "她對通過考試有信心",
          "她要這位先生別緊張",
          "她一聽見考試就開始緊張"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她對通過考試有信心. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？ 昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？ 這位小姐的意思是什麼？",
        "dialogue": "男：我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？\n女：昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？"
          },
          {
            "speaker": "female",
            "text": "昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她知道今天會下大雨",
          "沒有人知道今天會下雨",
          "她本來以為只是下小雨",
          "這位先生沒告訴她會下雨"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她本來以為只是下小雨. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "今天是我第一次上中文課，老師教了語法和二十五個漢字。 才上一次課，就學了二十多個漢字，不錯嘛！ 學漢字很有趣，不過，語法好難懂。 不要緊，有問題的話，就多問老師。 這位先生說了什麼？",
        "dialogue": "男：今天是我第一次上中文課，老師教了語法和二十五個漢字。\n女：才上一次課，就學了二十多個漢字，不錯嘛！\n男：學漢字很有趣，不過，語法好難懂。\n女：不要緊，有問題的話，就多問老師。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "今天是我第一次上中文課，老師教了語法和二十五個漢字。"
          },
          {
            "speaker": "female",
            "text": "才上一次課，就學了二十多個漢字，不錯嘛！"
          },
          {
            "speaker": "male",
            "text": "學漢字很有趣，不過，語法好難懂。"
          },
          {
            "speaker": "female",
            "text": "不要緊，有問題的話，就多問老師。"
          },
          {
            "speaker": "male",
            "text": "這位先生說了什麼？"
          }
        ],
        "q": "這位先生說了什麼？",
        "options": [
          "老師還沒教語法",
          "老師教了十個漢字",
          "他覺得語法很簡單",
          "他認為學漢字很有意思"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他認為學漢字很有意思. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳上個星期借的小說什麼時候可以還給我？ 不好意思！可不可以過兩天再還？ 妳看完了嗎？ 我看得差不多了。 這位小姐的意思是什麼？",
        "dialogue": "男：妳上個星期借的小說什麼時候可以還給我？\n女：不好意思！可不可以過兩天再還？\n男：妳看完了嗎？\n女：我看得差不多了。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳上個星期借的小說什麼時候可以還給我？"
          },
          {
            "speaker": "female",
            "text": "不好意思！可不可以過兩天再還？"
          },
          {
            "speaker": "male",
            "text": "妳看完了嗎？"
          },
          {
            "speaker": "female",
            "text": "我看得差不多了。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她快看完了",
          "她還沒開始看",
          "她要再看一個星期",
          "她已經全部看完了"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她快看完了. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "多吃一點兒吧！ 不，謝了！我吃得很飽。 妳吃不下了嗎？這個蛋糕是我特別為妳買的。 好吧！吃一點兒蛋糕也沒關係。 這位小姐的意思是什麼？",
        "dialogue": "男：多吃一點兒吧！\n女：不，謝了！我吃得很飽。\n男：妳吃不下了嗎？這個蛋糕是我特別為妳買的。\n女：好吧！吃一點兒蛋糕也沒關係。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "多吃一點兒吧！"
          },
          {
            "speaker": "female",
            "text": "不，謝了！我吃得很飽。"
          },
          {
            "speaker": "male",
            "text": "妳吃不下了嗎？這個蛋糕是我特別為妳買的。"
          },
          {
            "speaker": "female",
            "text": "好吧！吃一點兒蛋糕也沒關係。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她還有點兒餓",
          "蛋糕有點兒難吃",
          "她可以再吃一點兒東西",
          "她沒辦法吃任何東西了"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她可以再吃一點兒東西. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "生日快樂！這是送給妳的。 謝謝。你不必買禮物給我的。你太客氣了！ 希望妳會喜歡，打開來看看吧。 啊，我喜歡這支手錶。你怎麼知道我要的就是這個？ 這位小姐的意思是什麼？",
        "dialogue": "男：生日快樂！這是送給妳的。\n女：謝謝。你不必買禮物給我的。你太客氣了！\n男：希望妳會喜歡，打開來看看吧。\n女：啊，我喜歡這支手錶。你怎麼知道我要的就是這個？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "生日快樂！這是送給妳的。"
          },
          {
            "speaker": "female",
            "text": "謝謝。你不必買禮物給我的。你太客氣了！"
          },
          {
            "speaker": "male",
            "text": "希望妳會喜歡，打開來看看吧。"
          },
          {
            "speaker": "female",
            "text": "啊，我喜歡這支手錶。你怎麼知道我要的就是這個？"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "她不需要手錶",
          "她想要別的禮物",
          "這位先生買錯手錶",
          "這位先生買對了禮物"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位先生買對了禮物. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小明這次考試考得太差了。 是不是考試太難了？ 不是吧！很多學生都考得不錯，有好幾個都考一百分呢！ 我看啊！應該是小明念書念不了幾頁，就想出去玩。 這兩個人說，小明成績差的原因是什麼？",
        "dialogue": "男：小明這次考試考得太差了。\n女：是不是考試太難了？\n男：不是吧！很多學生都考得不錯，有好幾個都考一百分呢！\n女：我看啊！應該是小明念書念不了幾頁，就想出去玩。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小明這次考試考得太差了。"
          },
          {
            "speaker": "female",
            "text": "是不是考試太難了？"
          },
          {
            "speaker": "male",
            "text": "不是吧！很多學生都考得不錯，有好幾個都考一百分呢！"
          },
          {
            "speaker": "female",
            "text": "我看啊！應該是小明念書念不了幾頁，就想出去玩。"
          },
          {
            "speaker": "male",
            "text": "這兩個人說，小明成績差的原因是什麼？"
          }
        ],
        "q": "這兩個人說，小明成績差的原因是什麼？",
        "options": [
          "他不用功",
          "他不聰明",
          "考試太難",
          "他不小心寫錯"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他不用功. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳到新公司上班已經兩個星期了，一切還習慣嗎？ 嗯，我已經慢慢習慣那裡的環境了。 聽說在你們公司上班很辛苦，是真的嗎？ 辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有 一次旅遊活動喔！ 這位小姐的公司怎麼樣？",
        "dialogue": "男：妳到新公司上班已經兩個星期了，一切還習慣嗎？\n女：嗯，我已經慢慢習慣那裡的環境了。\n男：聽說在你們公司上班很辛苦，是真的嗎？\n女：辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有\n一次旅遊活動喔！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳到新公司上班已經兩個星期了，一切還習慣嗎？"
          },
          {
            "speaker": "female",
            "text": "嗯，我已經慢慢習慣那裡的環境了。"
          },
          {
            "speaker": "male",
            "text": "聽說在你們公司上班很辛苦，是真的嗎？"
          },
          {
            "speaker": "female",
            "text": "辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有"
          },
          {
            "speaker": "narrator",
            "text": "一次旅遊活動喔！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的公司怎麼樣？"
          }
        ],
        "q": "這位小姐的公司怎麼樣？",
        "options": [
          "對她不好",
          "午餐不用錢",
          "工作不是太多",
          "每年辦旅遊活動"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 每年辦旅遊活動. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "我覺得我的頭有點兒疼，我很久沒這樣了。 最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。 像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！ 再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。 這位小姐覺得這位先生應該怎麼做？",
        "dialogue": "男：我覺得我的頭有點兒疼，我很久沒這樣了。\n女：最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。\n男：像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！\n女：再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "我覺得我的頭有點兒疼，我很久沒這樣了。"
          },
          {
            "speaker": "female",
            "text": "最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。"
          },
          {
            "speaker": "male",
            "text": "像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！"
          },
          {
            "speaker": "female",
            "text": "再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。"
          },
          {
            "speaker": "male",
            "text": "這位小姐覺得這位先生應該怎麼做？"
          }
        ],
        "q": "這位小姐覺得這位先生應該怎麼做？",
        "options": [
          "不要搭公車",
          "到醫院看病",
          "多吃蔬菜水果",
          "養成運動的習慣"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 到醫院看病. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "玉珍，妳將來有什麼打算嗎？ 我打算以後過著單身生活，想去哪裡旅行就去哪裡。 萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？ 到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中 心，這樣就不用擔心了啊！ 這位小姐到了老年的時候有什麼計畫？",
        "dialogue": "男：玉珍，妳將來有什麼打算嗎？\n女：我打算以後過著單身生活，想去哪裡旅行就去哪裡。\n男：萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？\n女：到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中\n心，這樣就不用擔心了啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "玉珍，妳將來有什麼打算嗎？"
          },
          {
            "speaker": "female",
            "text": "我打算以後過著單身生活，想去哪裡旅行就去哪裡。"
          },
          {
            "speaker": "male",
            "text": "萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？"
          },
          {
            "speaker": "female",
            "text": "到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中"
          },
          {
            "speaker": "narrator",
            "text": "心，這樣就不用擔心了啊！"
          },
          {
            "speaker": "male",
            "text": "這位小姐到了老年的時候有什麼計畫？"
          }
        ],
        "q": "這位小姐到了老年的時候有什麼計畫？",
        "options": [
          "繼續工作",
          "組織一個家庭",
          "去世界各國旅行",
          "住在專門照顧老人的地方"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 住在專門照顧老人的地方. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 1: Chọn từ thích hợp nhất điền vào chỗ trống [1].",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng thể bị động '被'送進了醫院 (được đưa vào viện).",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 2: Chọn từ thích hợp nhất điền vào chỗ trống [2].",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'陪'張太太 (đi cùng vợ).",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 3: Chọn từ thích hợp nhất điền vào chỗ trống [3].",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'當'爸爸 (làm cha).",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 4: Chọn từ thích hợp nhất điền vào chỗ trống [4].",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'為'這個孩子 (nghĩ tên 'cho' con).",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "dialogueSegments": [],
        "q": "Câu 5: Chọn từ thích hợp nhất điền vào chỗ trống [5].",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'希望' (hy vọng sau này vừa đẹp vừa vui).",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 6: Chọn từ thích hợp nhất điền vào chỗ trống [6].",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Cụm cố định '大學時代' (thời đại học).",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 7: Chọn từ thích hợp nhất điền vào chỗ trống [7].",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 8: Chọn từ thích hợp nhất điền vào chỗ trống [8].",
        "options": [
          "忽然",
          "總是",
          "隨時",
          "從來"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'忽然'想起 (đột nhiên nhớ lại).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 9: Chọn từ thích hợp nhất điền vào chỗ trống [9].",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'照'著地址 (lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "dialogueSegments": [],
        "q": "Câu 10: Chọn từ thích hợp nhất điền vào chỗ trống [10].",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp lại).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 11: Chọn từ thích hợp nhất điền vào chỗ trống [11].",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'安排'戶外活動 (sắp xếp thời gian vận động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 12: Chọn từ thích hợp nhất điền vào chỗ trống [12].",
        "options": [
          "影響",
          "阻礙",
          "促進",
          "代替"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'促進'吸收 (thúc đẩy hấp thụ vitamin D).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 13: Chọn từ thích hợp nhất điền vào chỗ trống [13].",
        "options": [
          "常常",
          "總是",
          "不斷",
          "難免"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'總是'在室內看螢幕 (luôn ở trong phòng xem màn hình).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 14: Chọn từ thích hợp nhất điền vào chỗ trống [14].",
        "options": [
          "維護",
          "修理",
          "整理",
          "保證"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'維護'視力健康 (bảo vệ / duy trì sức khỏe thị lực).",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 15: Chọn từ thích hợp nhất điền vào chỗ trống [15].",
        "options": [
          "不能",
          "不要",
          "不可",
          "不必"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'不可'輕視 (tuyệt đối không được xem nhẹ).",
        "pinyin": ""
      },
      {
        "id": 34,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Căn bản A1/A2)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "dialogueSegments": [],
        "q": "Câu 16: 下面哪一個敘述完全符合短文內容？",
        "options": [
          "小明已經造訪韓國兩次了",
          "小明在韓國住了四個晚上",
          "小明覺得韓國食物不合胃口",
          "小明打算去日本留學"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết rõ: '玩了五天四夜' nghĩa là ở lại 4 đêm (四個晚上).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Căn bản A1/A2)",
        "context": "Đoản văn: 面對孩子成長的母親\n孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "dialogueSegments": [],
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，採取什麼態度？",
        "options": [
          "嚴厲責備孩子的膽怯",
          "答應明天親自開車接送",
          "鼓勵孩子勇敢獨立面對",
          "感到不知所措而焦慮"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ khuyến khích: '你要學會自己面對挑戰' (động viên con dũng cảm tự đối diện).",
        "pinyin": ""
      }
    ]
  },
  {
    "id": "mock_c1",
    "title": "TOCFL Band C - Đề thi Chuyên sâu (Band C Mock)",
    "band": "Band C (精通·頂級)",
    "badge": "Chuyên sâu C1/C2",
    "duration": 60,
    "totalQ": 30,
    "desc": "Đề thi chuyên sâu từ vựng thành ngữ, bài phát biểu học thuật, báo cáo kinh tế và bình luận văn hóa xã hội.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "現在景氣不好，別人會不會覺得我們產品的定價高得離譜？ 這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。 你這麼有把握啊！ 你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。 這位小姐的意思是什麼？",
        "dialogue": "男：現在景氣不好，別人會不會覺得我們產品的定價高得離譜？\n女：這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。\n男：你這麼有把握啊！\n女：你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "現在景氣不好，別人會不會覺得我們產品的定價高得離譜？"
          },
          {
            "speaker": "female",
            "text": "這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。"
          },
          {
            "speaker": "male",
            "text": "你這麼有把握啊！"
          },
          {
            "speaker": "female",
            "text": "你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。"
          },
          {
            "speaker": "male",
            "text": "這位小姐的意思是什麼？"
          }
        ],
        "q": "這位小姐的意思是什麼？",
        "options": [
          "現在的皮椅都是七八十萬",
          "打折以後，買皮椅的人不少",
          "再貴一點的皮椅就沒有人買了",
          "不少人買得起七八十萬的皮椅"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不少人買得起七八十萬的皮椅. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。 你怎麼不勸勸他呢？ 我當然說啦！退一步海闊天空嘛！不過他聽不進去。 都到這個節骨眼了他還堅持己見，真是不可理喻。 這位太太說老劉怎麼樣？",
        "dialogue": "男：唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。\n女：你怎麼不勸勸他呢？\n男：我當然說啦！退一步海闊天空嘛！不過他聽不進去。\n女：都到這個節骨眼了他還堅持己見，真是不可理喻。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。"
          },
          {
            "speaker": "female",
            "text": "你怎麼不勸勸他呢？"
          },
          {
            "speaker": "male",
            "text": "我當然說啦！退一步海闊天空嘛！不過他聽不進去。"
          },
          {
            "speaker": "female",
            "text": "都到這個節骨眼了他還堅持己見，真是不可理喻。"
          },
          {
            "speaker": "male",
            "text": "這位太太說老劉怎麼樣？"
          }
        ],
        "q": "這位太太說老劉怎麼樣？",
        "options": [
          "沒法跟老劉講道理",
          "是個沒有原則的人",
          "堅持立場、值得尊敬",
          "再多勸一下，他就會讓步"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 沒法跟老劉講道理. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "怎麼啦？垂頭喪氣的？ 我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。 勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動 都進入決賽呢！ 就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！ 代表隊在這次比賽的表現怎麼樣？",
        "dialogue": "男：怎麼啦？垂頭喪氣的？\n女：我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。\n男：勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動\n都進入決賽呢！\n女：就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "怎麼啦？垂頭喪氣的？"
          },
          {
            "speaker": "female",
            "text": "我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。"
          },
          {
            "speaker": "male",
            "text": "勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動"
          },
          {
            "speaker": "narrator",
            "text": "都進入決賽呢！"
          },
          {
            "speaker": "female",
            "text": "就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！"
          },
          {
            "speaker": "male",
            "text": "代表隊在這次比賽的表現怎麼樣？"
          }
        ],
        "q": "代表隊在這次比賽的表現怎麼樣？",
        "options": [
          "連決賽都沒進",
          "只得到一個獎",
          "一個獎都沒得到",
          "只有一項沒得獎"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 一個獎都沒得到. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小趙這孩子，頭腦不錯，就是個性太急躁。 哈哈，年輕人嘛！做事難免比較衝動。 正好老王那兒有缺，我想叫他去試一試。 嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。 為什麼小趙幫老王做事是種磨練？",
        "dialogue": "男：小趙這孩子，頭腦不錯，就是個性太急躁。\n女：哈哈，年輕人嘛！做事難免比較衝動。\n男：正好老王那兒有缺，我想叫他去試一試。\n女：嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小趙這孩子，頭腦不錯，就是個性太急躁。"
          },
          {
            "speaker": "female",
            "text": "哈哈，年輕人嘛！做事難免比較衝動。"
          },
          {
            "speaker": "male",
            "text": "正好老王那兒有缺，我想叫他去試一試。"
          },
          {
            "speaker": "female",
            "text": "嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。"
          },
          {
            "speaker": "male",
            "text": "為什麼小趙幫老王做事是種磨練？"
          }
        ],
        "q": "為什麼小趙幫老王做事是種磨練？",
        "options": [
          "老王的眼睛不好",
          "老王做事很嚴謹",
          "老王個性很馬虎",
          "老王不喜歡小趙"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 老王做事很嚴謹. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "咦！最近你好像特別忙。 唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司， 偏偏那兒又需要好好整頓一番。 小趙怎麼樣，服務的時間久，學歷也不錯。 他人緣差不說，又經常敷衍了事，你想我能指望他嗎？ 這位女士的意思是什麼？",
        "dialogue": "男：咦！最近你好像特別忙。\n女：唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司，\n偏偏那兒又需要好好整頓一番。\n男：小趙怎麼樣，服務的時間久，學歷也不錯。\n女：他人緣差不說，又經常敷衍了事，你想我能指望他嗎？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "咦！最近你好像特別忙。"
          },
          {
            "speaker": "female",
            "text": "唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司，"
          },
          {
            "speaker": "narrator",
            "text": "偏偏那兒又需要好好整頓一番。"
          },
          {
            "speaker": "male",
            "text": "小趙怎麼樣，服務的時間久，學歷也不錯。"
          },
          {
            "speaker": "female",
            "text": "他人緣差不說，又經常敷衍了事，你想我能指望他嗎？"
          },
          {
            "speaker": "male",
            "text": "這位女士的意思是什麼？"
          }
        ],
        "q": "這位女士的意思是什麼？",
        "options": [
          "小趙拒絕了她",
          "小趙不值得信賴",
          "小趙對工作很失望",
          "她怕小趙不會答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 小趙不值得信賴. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？ 保證萬無一失，絕對沒問題，你放心吧！ 這位小姐的話是什麼意思？",
        "dialogue": "男：妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？\n女：保證萬無一失，絕對沒問題，你放心吧！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？"
          },
          {
            "speaker": "female",
            "text": "保證萬無一失，絕對沒問題，你放心吧！"
          },
          {
            "speaker": "male",
            "text": "這位小姐的話是什麼意思？"
          }
        ],
        "q": "這位小姐的話是什麼意思？",
        "options": [
          "這麼做一定行得通",
          "她想買保險以免發生問題",
          "因為已保了險，所以沒問題",
          "這麼做風險很高，但值得冒險嘗試"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 這麼做一定行得通. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "小劉費盡心思取悅父母，結果卻失敗了。 誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂 啊！ 根據這位小姐的說法，小劉失敗的原因是什麼？",
        "dialogue": "男：小劉費盡心思取悅父母，結果卻失敗了。\n女：誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂\n啊！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "小劉費盡心思取悅父母，結果卻失敗了。"
          },
          {
            "speaker": "female",
            "text": "誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂"
          },
          {
            "speaker": "narrator",
            "text": "啊！"
          },
          {
            "speaker": "male",
            "text": "根據這位小姐的說法，小劉失敗的原因是什麼？"
          }
        ],
        "q": "根據這位小姐的說法，小劉失敗的原因是什麼？",
        "options": [
          "小劉的父母要求太多",
          "小劉還沒有顯著的成就",
          "小劉沒滿足父母最大的期待",
          "小劉的父母不要求兒子有成就"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 小劉沒滿足父母最大的期待. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "老闆說這個案子得在一個星期裡完成，這怎麼可能呢？ 還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！ 這位小姐有什麼意見？",
        "dialogue": "男：老闆說這個案子得在一個星期裡完成，這怎麼可能呢？\n女：還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "老闆說這個案子得在一個星期裡完成，這怎麼可能呢？"
          },
          {
            "speaker": "female",
            "text": "還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！"
          },
          {
            "speaker": "male",
            "text": "這位小姐有什麼意見？"
          }
        ],
        "q": "這位小姐有什麼意見？",
        "options": [
          "做這個案子得花時間",
          "做這個案子並不容易",
          "做這個案子不必認真",
          "做這個案子要有能力"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 做這個案子不必認真. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置， 那裡的視野還不錯，可以清楚地看見吳老師演奏。 你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞 不是重點，你就把錢省下來吧！ 這位小姐對這次演奏會的座位有什麼看法？ 請聽這段對話，然後回答兩個問題。 你最近怎麼老躲著小王？ 他一直想約我單獨跟他出去，可是… 怎麼了？你好像不太願意？ 小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？ 20. 這位小姐對小王的感覺如何？ 21. 對小王的邀請，這位小姐覺得如何？ 請聽這段對話，然後回答下面的兩個問題。 你們又來了，這次又有什麼事？ 趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請 您共襄盛舉，捐點錢救濟災民。 不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道 就這樣送給你們？ 喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放 心啊！ 口說無憑，你不如先寄份帳冊來給我看吧！ 22. 關於這位先生，哪一個是對的？ 23. 這位先生最後的態度怎麼樣？ 下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。 小姐，我覺得這發票上的金額好像不太對。 好的，馬上為您處理。這些一共是500元，金額沒錯。 是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不 管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡， 為什麼沒打折？ 我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主 要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能 享有九折優惠。不好意思，我們店裡並沒有配合這個活動。 24. 店員和客人發生了什麼事？ 25. 有關宣傳單上的活動說明，下面哪一項是對的？ 請聽這一段和「味精」有關的討論，然後回答兩個問題。 佳美，你看這則味精的報導。 嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過 另外一篇報告，結果完全相反。 是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就 不碰吧！ 每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也 還沒證實，所以，你別太擔心了。 26. 這位先生覺得味精怎麼樣？ 27. 這位小姐的意思是什麼？ 下面是一段兄妹之間的對話，請聽完後，回答下面三個問題： 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 現在請聽對話。 昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還 來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪 氣的。 哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘， 該不會是… 長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘 的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想 到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一 會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！ 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 第二部分 段落 請聽這一段話，然後回答下面的問題。 小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋 糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和 小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小 青聽了，很高興，也很感謝。 31. 從這段話可以知道什麼？ 請聽這一段話，然後回答下面的問題。 如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常 聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生， 不過聽音樂絕不會對你造成傷害。 32. 這段話的意思是什麼？ 請聽這一段電話留言，然後回答下面的兩個問題。 小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上 我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影， 好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。 33. 阿秀今天下午要做什麼？ 34. 阿秀請小文拿什麼去學校？ 請聽這一段話，然後回答下面的兩個問題。 昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我 的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假 去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後， 吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就 不用再吃藥。」 35. 為什麼說話的人昨天晚上沒睡好？ 36. 醫生說了什麼？ 請聽這一段水果的介紹，然後回答下面的兩個問題。 這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。 它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特 別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰 箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香， 放到第四天，不但不好看，也不好吃了。 37. 這種水果怎麼樣？ 38. 這種水果不放冰箱的話，會先有什麼變化？ 請聽這一段話，然後回答下面的兩個問題。 小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不 習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。 他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回 來以後，小周決定下次還要帶家人去美國玩兒。 39. 這段話主要是說什麼？ 40. 下面哪一個是對的？ 請聽這一段廣告，然後回答下面的兩個問題。 寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年 2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只 要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水 果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電 話給我們。 41. 這二十間房間怎麼樣？ 42. 下面哪一個是對的？ 請聽這一段廣播，然後回答兩個問題。 各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會 兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學 離開位子的時候，把重要的東西一起拿走，謝謝！ 43. 學生在圖書館發生什麼事？ 44. 這段廣播提到，學校怎麼處理這個狀況？ 下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題： 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 現在請聽報導。 2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光 景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量 的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這 個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的 歷史氣息？還是，讓人口水直流的地方美食？ 「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出 了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也 就跟著消失？ 這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相 互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三 個問題。 現在請聽報導。 【新聞快訊】 香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金， 根據阿國警方調查，她們可能涉及偷運古董。 阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險， 替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派 指稱，花瓶破損，於是扣留她們的護照加以禁錮。 香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖 的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救 援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極 有用的情報。 48. 這則報導說明了什麼？ 49. 根據報導，兩名少女為什麼要做這些事？ 50. 根據報導，香港警方怎麼處理這件案子？",
        "dialogue": "男：吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置，\n那裡的視野還不錯，可以清楚地看見吳老師演奏。\n女：你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞\n不是重點，你就把錢省下來吧！\n男：這位小姐對這次演奏會的座位有什麼看法？\n請聽這段對話，然後回答兩個問題。\n男：你最近怎麼老躲著小王？\n女：他一直想約我單獨跟他出去，可是…\n男：怎麼了？你好像不太願意？\n女：小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？\n20. 這位小姐對小王的感覺如何？\n21. 對小王的邀請，這位小姐覺得如何？\n請聽這段對話，然後回答下面的兩個問題。\n男：你們又來了，這次又有什麼事？\n女：趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請\n您共襄盛舉，捐點錢救濟災民。\n男：不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道\n就這樣送給你們？\n女：喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放\n心啊！\n男：口說無憑，你不如先寄份帳冊來給我看吧！\n22. 關於這位先生，哪一個是對的？\n23. 這位先生最後的態度怎麼樣？\n下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。\n男：小姐，我覺得這發票上的金額好像不太對。\n女：好的，馬上為您處理。這些一共是500元，金額沒錯。\n男：是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不\n管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡，\n為什麼沒打折？\n女：我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主\n要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能\n享有九折優惠。不好意思，我們店裡並沒有配合這個活動。\n24. 店員和客人發生了什麼事？\n25. 有關宣傳單上的活動說明，下面哪一項是對的？\n請聽這一段和「味精」有關的討論，然後回答兩個問題。\n男：佳美，你看這則味精的報導。\n女：嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過\n另外一篇報告，結果完全相反。\n男：是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就\n不碰吧！\n女：每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也\n還沒證實，所以，你別太擔心了。\n26. 這位先生覺得味精怎麼樣？\n27. 這位小姐的意思是什麼？\n下面是一段兄妹之間的對話，請聽完後，回答下面三個問題：\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n現在請聽對話。\n男：昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還\n來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪\n氣的。\n女：哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘，\n該不會是…\n男：長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘\n的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想\n到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一\n會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n第二部分 段落\n請聽這一段話，然後回答下面的問題。\n小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋\n糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和\n小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小\n青聽了，很高興，也很感謝。\n31. 從這段話可以知道什麼？\n請聽這一段話，然後回答下面的問題。\n如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常\n聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生，\n不過聽音樂絕不會對你造成傷害。\n32. 這段話的意思是什麼？\n請聽這一段電話留言，然後回答下面的兩個問題。\n小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上\n我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影，\n好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。\n33. 阿秀今天下午要做什麼？\n34. 阿秀請小文拿什麼去學校？\n請聽這一段話，然後回答下面的兩個問題。\n昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我\n的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假\n去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後，\n吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就\n不用再吃藥。」\n35. 為什麼說話的人昨天晚上沒睡好？\n36. 醫生說了什麼？\n請聽這一段水果的介紹，然後回答下面的兩個問題。\n這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。\n它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特\n別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰\n箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香，\n放到第四天，不但不好看，也不好吃了。\n37. 這種水果怎麼樣？\n38. 這種水果不放冰箱的話，會先有什麼變化？\n請聽這一段話，然後回答下面的兩個問題。\n小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不\n習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。\n他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回\n來以後，小周決定下次還要帶家人去美國玩兒。\n39. 這段話主要是說什麼？\n40. 下面哪一個是對的？\n請聽這一段廣告，然後回答下面的兩個問題。\n寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年\n2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只\n要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水\n果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電\n話給我們。\n41. 這二十間房間怎麼樣？\n42. 下面哪一個是對的？\n請聽這一段廣播，然後回答兩個問題。\n各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會\n兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學\n離開位子的時候，把重要的東西一起拿走，謝謝！\n43. 學生在圖書館發生什麼事？\n44. 這段廣播提到，學校怎麼處理這個狀況？\n下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題：\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n現在請聽報導。\n2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光\n景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量\n的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這\n個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的\n歷史氣息？還是，讓人口水直流的地方美食？\n「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出\n了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也\n就跟著消失？\n這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相\n互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三\n個問題。\n現在請聽報導。\n【新聞快訊】\n香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金，\n根據阿國警方調查，她們可能涉及偷運古董。\n阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險，\n替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派\n指稱，花瓶破損，於是扣留她們的護照加以禁錮。\n香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖\n的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救\n援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極\n有用的情報。\n48. 這則報導說明了什麼？\n49. 根據報導，兩名少女為什麼要做這些事？",
        "dialogueSegments": [
          {
            "speaker": "male",
            "text": "吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置，"
          },
          {
            "speaker": "narrator",
            "text": "那裡的視野還不錯，可以清楚地看見吳老師演奏。"
          },
          {
            "speaker": "female",
            "text": "你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞"
          },
          {
            "speaker": "narrator",
            "text": "不是重點，你就把錢省下來吧！"
          },
          {
            "speaker": "male",
            "text": "這位小姐對這次演奏會的座位有什麼看法？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段對話，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "你最近怎麼老躲著小王？"
          },
          {
            "speaker": "female",
            "text": "他一直想約我單獨跟他出去，可是…"
          },
          {
            "speaker": "male",
            "text": "怎麼了？你好像不太願意？"
          },
          {
            "speaker": "female",
            "text": "小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？"
          },
          {
            "speaker": "narrator",
            "text": "20. 這位小姐對小王的感覺如何？"
          },
          {
            "speaker": "narrator",
            "text": "21. 對小王的邀請，這位小姐覺得如何？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這段對話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "male",
            "text": "你們又來了，這次又有什麼事？"
          },
          {
            "speaker": "female",
            "text": "趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請"
          },
          {
            "speaker": "narrator",
            "text": "您共襄盛舉，捐點錢救濟災民。"
          },
          {
            "speaker": "male",
            "text": "不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道"
          },
          {
            "speaker": "narrator",
            "text": "就這樣送給你們？"
          },
          {
            "speaker": "female",
            "text": "喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放"
          },
          {
            "speaker": "narrator",
            "text": "心啊！"
          },
          {
            "speaker": "male",
            "text": "口說無憑，你不如先寄份帳冊來給我看吧！"
          },
          {
            "speaker": "narrator",
            "text": "22. 關於這位先生，哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "23. 這位先生最後的態度怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "小姐，我覺得這發票上的金額好像不太對。"
          },
          {
            "speaker": "female",
            "text": "好的，馬上為您處理。這些一共是500元，金額沒錯。"
          },
          {
            "speaker": "male",
            "text": "是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不"
          },
          {
            "speaker": "narrator",
            "text": "管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡，"
          },
          {
            "speaker": "narrator",
            "text": "為什麼沒打折？"
          },
          {
            "speaker": "female",
            "text": "我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主"
          },
          {
            "speaker": "narrator",
            "text": "要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能"
          },
          {
            "speaker": "narrator",
            "text": "享有九折優惠。不好意思，我們店裡並沒有配合這個活動。"
          },
          {
            "speaker": "narrator",
            "text": "24. 店員和客人發生了什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "25. 有關宣傳單上的活動說明，下面哪一項是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段和「味精」有關的討論，然後回答兩個問題。"
          },
          {
            "speaker": "male",
            "text": "佳美，你看這則味精的報導。"
          },
          {
            "speaker": "female",
            "text": "嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過"
          },
          {
            "speaker": "narrator",
            "text": "另外一篇報告，結果完全相反。"
          },
          {
            "speaker": "male",
            "text": "是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就"
          },
          {
            "speaker": "narrator",
            "text": "不碰吧！"
          },
          {
            "speaker": "female",
            "text": "每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也"
          },
          {
            "speaker": "narrator",
            "text": "還沒證實，所以，你別太擔心了。"
          },
          {
            "speaker": "narrator",
            "text": "26. 這位先生覺得味精怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "27. 這位小姐的意思是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "下面是一段兄妹之間的對話，請聽完後，回答下面三個問題："
          },
          {
            "speaker": "narrator",
            "text": "28. 這位先生為什麼說他的太太「陰陽怪氣」？"
          },
          {
            "speaker": "narrator",
            "text": "29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "30. 這段對話告訴我們什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽對話。"
          },
          {
            "speaker": "male",
            "text": "昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還"
          },
          {
            "speaker": "narrator",
            "text": "來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪"
          },
          {
            "speaker": "narrator",
            "text": "氣的。"
          },
          {
            "speaker": "female",
            "text": "哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘，"
          },
          {
            "speaker": "narrator",
            "text": "該不會是…"
          },
          {
            "speaker": "male",
            "text": "長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘"
          },
          {
            "speaker": "narrator",
            "text": "的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想"
          },
          {
            "speaker": "narrator",
            "text": "到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一"
          },
          {
            "speaker": "narrator",
            "text": "會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！"
          },
          {
            "speaker": "narrator",
            "text": "28. 這位先生為什麼說他的太太「陰陽怪氣」？"
          },
          {
            "speaker": "narrator",
            "text": "29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "30. 這段對話告訴我們什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "第二部分 段落"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋"
          },
          {
            "speaker": "narrator",
            "text": "糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和"
          },
          {
            "speaker": "narrator",
            "text": "小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小"
          },
          {
            "speaker": "narrator",
            "text": "青聽了，很高興，也很感謝。"
          },
          {
            "speaker": "narrator",
            "text": "31. 從這段話可以知道什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的問題。"
          },
          {
            "speaker": "narrator",
            "text": "如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常"
          },
          {
            "speaker": "narrator",
            "text": "聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生，"
          },
          {
            "speaker": "narrator",
            "text": "不過聽音樂絕不會對你造成傷害。"
          },
          {
            "speaker": "narrator",
            "text": "32. 這段話的意思是什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段電話留言，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上"
          },
          {
            "speaker": "narrator",
            "text": "我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影，"
          },
          {
            "speaker": "narrator",
            "text": "好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。"
          },
          {
            "speaker": "narrator",
            "text": "33. 阿秀今天下午要做什麼？"
          },
          {
            "speaker": "narrator",
            "text": "34. 阿秀請小文拿什麼去學校？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我"
          },
          {
            "speaker": "narrator",
            "text": "的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假"
          },
          {
            "speaker": "narrator",
            "text": "去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後，"
          },
          {
            "speaker": "narrator",
            "text": "吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就"
          },
          {
            "speaker": "narrator",
            "text": "不用再吃藥。」"
          },
          {
            "speaker": "narrator",
            "text": "35. 為什麼說話的人昨天晚上沒睡好？"
          },
          {
            "speaker": "narrator",
            "text": "36. 醫生說了什麼？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段水果的介紹，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。"
          },
          {
            "speaker": "narrator",
            "text": "它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特"
          },
          {
            "speaker": "narrator",
            "text": "別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰"
          },
          {
            "speaker": "narrator",
            "text": "箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香，"
          },
          {
            "speaker": "narrator",
            "text": "放到第四天，不但不好看，也不好吃了。"
          },
          {
            "speaker": "narrator",
            "text": "37. 這種水果怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "38. 這種水果不放冰箱的話，會先有什麼變化？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段話，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不"
          },
          {
            "speaker": "narrator",
            "text": "習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。"
          },
          {
            "speaker": "narrator",
            "text": "他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回"
          },
          {
            "speaker": "narrator",
            "text": "來以後，小周決定下次還要帶家人去美國玩兒。"
          },
          {
            "speaker": "narrator",
            "text": "39. 這段話主要是說什麼？"
          },
          {
            "speaker": "narrator",
            "text": "40. 下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段廣告，然後回答下面的兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年"
          },
          {
            "speaker": "narrator",
            "text": "2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只"
          },
          {
            "speaker": "narrator",
            "text": "要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水"
          },
          {
            "speaker": "narrator",
            "text": "果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電"
          },
          {
            "speaker": "narrator",
            "text": "話給我們。"
          },
          {
            "speaker": "narrator",
            "text": "41. 這二十間房間怎麼樣？"
          },
          {
            "speaker": "narrator",
            "text": "42. 下面哪一個是對的？"
          },
          {
            "speaker": "narrator",
            "text": "請聽這一段廣播，然後回答兩個問題。"
          },
          {
            "speaker": "narrator",
            "text": "各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會"
          },
          {
            "speaker": "narrator",
            "text": "兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學"
          },
          {
            "speaker": "narrator",
            "text": "離開位子的時候，把重要的東西一起拿走，謝謝！"
          },
          {
            "speaker": "narrator",
            "text": "43. 學生在圖書館發生什麼事？"
          },
          {
            "speaker": "narrator",
            "text": "44. 這段廣播提到，學校怎麼處理這個狀況？"
          },
          {
            "speaker": "narrator",
            "text": "下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題："
          },
          {
            "speaker": "narrator",
            "text": "45. 根據報導，小鎮為什麼成為新的景點？"
          },
          {
            "speaker": "narrator",
            "text": "46. 根據報導，這部電影對小鎮造成什麼影響？"
          },
          {
            "speaker": "narrator",
            "text": "47. 記者對當地飯店的經營者，提出哪些建議？"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光"
          },
          {
            "speaker": "narrator",
            "text": "景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量"
          },
          {
            "speaker": "narrator",
            "text": "的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這"
          },
          {
            "speaker": "narrator",
            "text": "個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的"
          },
          {
            "speaker": "narrator",
            "text": "歷史氣息？還是，讓人口水直流的地方美食？"
          },
          {
            "speaker": "narrator",
            "text": "「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出"
          },
          {
            "speaker": "narrator",
            "text": "了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也"
          },
          {
            "speaker": "narrator",
            "text": "就跟著消失？"
          },
          {
            "speaker": "narrator",
            "text": "這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相"
          },
          {
            "speaker": "narrator",
            "text": "互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。"
          },
          {
            "speaker": "narrator",
            "text": "45. 根據報導，小鎮為什麼成為新的景點？"
          },
          {
            "speaker": "narrator",
            "text": "46. 根據報導，這部電影對小鎮造成什麼影響？"
          },
          {
            "speaker": "narrator",
            "text": "47. 記者對當地飯店的經營者，提出哪些建議？"
          },
          {
            "speaker": "narrator",
            "text": "香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三"
          },
          {
            "speaker": "narrator",
            "text": "個問題。"
          },
          {
            "speaker": "narrator",
            "text": "現在請聽報導。"
          },
          {
            "speaker": "narrator",
            "text": "【新聞快訊】"
          },
          {
            "speaker": "narrator",
            "text": "香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金，"
          },
          {
            "speaker": "narrator",
            "text": "根據阿國警方調查，她們可能涉及偷運古董。"
          },
          {
            "speaker": "narrator",
            "text": "阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險，"
          },
          {
            "speaker": "narrator",
            "text": "替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派"
          },
          {
            "speaker": "narrator",
            "text": "指稱，花瓶破損，於是扣留她們的護照加以禁錮。"
          },
          {
            "speaker": "narrator",
            "text": "香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖"
          },
          {
            "speaker": "narrator",
            "text": "的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救"
          },
          {
            "speaker": "narrator",
            "text": "援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極"
          },
          {
            "speaker": "narrator",
            "text": "有用的情報。"
          },
          {
            "speaker": "narrator",
            "text": "48. 這則報導說明了什麼？"
          },
          {
            "speaker": "narrator",
            "text": "49. 根據報導，兩名少女為什麼要做這些事？"
          },
          {
            "speaker": "narrator",
            "text": "50. 根據報導，香港警方怎麼處理這件案子？"
          }
        ],
        "q": "50. 根據報導，香港警方怎麼處理這件案子？",
        "options": [
          "二樓的視野比一樓好多了",
          "她認為這位先生的建議不錯",
          "一樓的票太貴了，她付不起",
          "沒必要考慮能不能看見表演者"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 沒必要考慮能不能看見表演者. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Cao cấp C1/C2)",
        "context": "Đoạn đối thoại tự nhiên giữa hai người.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 20",
        "options": [
          "只想維持普通朋友的關係",
          "想進一步了解小王的為人",
          "覺得小王是不錯的交往對象",
          "和小王聊天一點意思也沒有"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 只想維持普通朋友的關係. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落) (Cao cấp C1/C2)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 21",
        "options": [
          "非常厭惡",
          "充滿期待",
          "不怎麼在乎",
          "不知怎麼處理"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不知怎麼處理. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落) (Cao cấp C1/C2)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 22",
        "options": [
          "他從來就沒捐過錢",
          "他不知道捐款的去向",
          "他自己也是水災災民",
          "他覺得自己捐的錢不夠多"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 他不知道捐款的去向. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落) (Cao cấp C1/C2)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 23",
        "options": [
          "他請對方把錢還給他",
          "他決定幫對方一起募款",
          "他請對方提出證明再說",
          "他覺得對方有誠意，答應捐錢"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 他請對方提出證明再說. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落) (Cao cấp C1/C2)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 24",
        "options": [
          "店員打錯發票",
          "店員算錯金額",
          "客人拿錯商品",
          "客人跑錯商店"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 客人跑錯商店. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Độc thoại & Báo cáo (段落) (Cao cấp C1/C2)",
        "context": "Đoạn thông báo / tin tức phát thanh.",
        "audio": "",
        "dialogue": "",
        "dialogueSegments": [
          {
            "speaker": "female",
            "text": ""
          }
        ],
        "q": "題目 25",
        "options": [
          "若要享受折扣，得到指定的店家",
          "折扣活動從今年初到這個月月底",
          "這個活動是附近商店聯合舉辦的",
          "在這個月內消費就可以加入會員"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 若要享受折扣，得到指定的店家. Lời thoại và nội dung thể hiện rõ qua băng nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Cao cấp C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 11: Chọn từ thích hợp nhất điền vào chỗ trống [11].",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'安排'戶外活動 (sắp xếp thời gian vận động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Cao cấp C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 12: Chọn từ thích hợp nhất điền vào chỗ trống [12].",
        "options": [
          "影響",
          "阻礙",
          "促進",
          "代替"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'促進'吸收 (thúc đẩy hấp thụ vitamin D).",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Cao cấp C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 13: Chọn từ thích hợp nhất điền vào chỗ trống [13].",
        "options": [
          "常常",
          "總是",
          "不斷",
          "難免"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'總是'在室內看螢幕 (luôn ở trong phòng xem màn hình).",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Cao cấp C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 14: Chọn từ thích hợp nhất điền vào chỗ trống [14].",
        "options": [
          "維護",
          "修理",
          "整理",
          "保證"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'維護'視力健康 (bảo vệ / duy trì sức khỏe thị lực).",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Cao cấp C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "dialogueSegments": [],
        "q": "Câu 15: Chọn từ thích hợp nhất điền vào chỗ trống [15].",
        "options": [
          "不能",
          "不要",
          "不可",
          "不必"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'不可'輕視 (tuyệt đối không được xem nhẹ).",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天去了韓國最高的山賞雪，風景十分壯麗。大部分時間，他搭乘地鐵遊覽首爾市區名勝，也品嚐了地道的泡菜鍋與烤肉。小明覺得韓國很好玩，打算開始學韓語，未來希望有機會到韓國進修留學。",
        "dialogueSegments": [],
        "q": "Câu 16: 下面哪一個敘述完全符合短文內容？",
        "options": [
          "小明已經造訪韓國兩次了",
          "小明在韓國住了四個晚上",
          "小明覺得韓國食物不合胃口",
          "小明打算去日本留學"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết rõ: '玩了五天四夜' nghĩa là ở lại 4 đêm (四個晚上).",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 面對孩子成長的母親\n孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。出門前你不停地告訴我搭校車令人害怕，語氣充滿了面對陌生環境的不安。然而我只是笑著看你，聽你把所有預期的擔憂說完，然後篤定地說：「這是你人生的另一個起點，你要學會自己面對挑戰！」",
        "dialogueSegments": [],
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，採取什麼態度？",
        "options": [
          "嚴厲責備孩子的膽怯",
          "答應明天親自開車接送",
          "鼓勵孩子勇敢獨立面對",
          "感到不知所措而焦慮"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ khuyến khích: '你要學會自己面對挑戰' (động viên con dũng cảm tự đối diện).",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 台北夜市行動支付普及化\n以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "audio": "",
        "dialogue": "以往在台灣逛夜市消費，人人都習慣攜帶大量零錢與紙鈔。近年來隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與台灣Pay條碼立牌。消費者只要拿出手機輕輕一掃，幾秒鐘即可完成結帳。這項便民措施不僅減少了排隊找零的時間，也大幅降低了攤商接觸鈔票的衛生疑慮。",
        "dialogueSegments": [],
        "q": "Câu 18: 夜市引入行動支付帶來哪一項核心效益？",
        "options": [
          "大幅降低商品售價",
          "結帳更快速並兼顧衛生",
          "夜市營業時間延長至白天",
          "所有攤商免繳營業稅"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Văn bản nêu: '減少了排隊找零的時間, 也大幅降低了衛生疑慮' (thanh toán nhanh hơn và vệ sinh hơn).",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 捷運站二手書漂書箱與愛心傘\n台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "audio": "",
        "dialogue": "台北捷運系統除了乾淨準時聞名全球，站內的各項便民設施更展現了濃厚的社會人情味。各主要車站設有『二手書漂書箱』與『愛心傘免費借用服務』。乘客在雨天只要登記即可借走雨傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，贏得國內外旅客一致好評。",
        "dialogueSegments": [],
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪項優勢？",
        "options": [
          "列車行駛速度領先全球",
          "兼具人情味與信任的便民服務",
          "站內車廂提供免費餐飲",
          "票價比其他交通工具便宜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả ngợi ca: '兼具人情味與信任的便民服務' (dịch vụ tiện dân ấm áp tình người dựa trên sự tin tưởng).",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 台北市垃圾費隨袋徵收政策成效\n台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "audio": "",
        "dialogue": "台北市自推動『垃圾費隨袋徵收』以來，一般家戶垃圾量顯著下降超過四成。市民必須付費購買專用的藍色垃圾袋，而資源回收物如塑膠瓶、紙箱、玻璃及廚餘則完全免費收運。這項制度促使大眾認真落實分類，大幅減輕了焚化廠的燃燒負擔，成為國際各大城市紛紛前來取經的環保典範。",
        "dialogueSegments": [],
        "q": "Câu 20: 『垃圾費隨袋徵收』政策為何能有效減少垃圾量？",
        "options": [
          "市民為了省買垃圾袋的錢而努力做資源回收",
          "規定每戶每週最多只能丟一包垃圾",
          "禁止市民在超市購買塑膠袋包裝的食品",
          "提高亂丟垃圾的罰款金額十倍以上"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Vì rác tái chế miễn phí còn rác thường tốn tiền mua túi, người dân tích cực phân loại để tiết kiệm chi phí mua túi rác.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 高鐵串連台灣南北一日生活圈\n自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "audio": "",
        "dialogue": "自從台灣高鐵通車後，台北至高雄最快行車時間縮短至九十分鐘。許多商務人士清晨在台北總部開會，午後便能抵達南部科學園區巡視產線，晚間再搭車返回北部家中與家人共享晚餐。『一日生活圈』不僅徹底改變了人們的生活與通勤習慣，更強烈促進了南北經濟資源的均衡流動。",
        "dialogueSegments": [],
        "q": "Câu 21: 『一日生活圈』對人們生活產生的實質改變是什麼？",
        "options": [
          "商務出差不必再在外地過夜",
          "民眾紛紛將戶籍遷往南部",
          "高鐵票價全面降至台鐵水準",
          "飛機成為國內最受歡迎的航線"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn nêu buổi sáng họp Đài Bắc, chiều tới Nam Bộ, tối về lại nhà (đi lại trong ngày không cần ở qua đêm).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 台灣全民健保雲端醫療資訊系統\n台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "audio": "",
        "dialogue": "台灣的全民健保制度深受國際推崇，其中一項關鍵在於建置了完善的『健保醫療資訊雲端查詢系統』。當民眾跨院就醫時，醫師在取得病患授權後，即可透過健保卡即時調閱過去六個月在其他醫院的檢查報告、影像及用藥紀錄。這項措施有效防範了重複開藥與藥物交互作用的風險，確保病人用藥安全。",
        "dialogueSegments": [],
        "q": "Câu 22: 健保雲端資訊系統的主要優勢是什麼？",
        "options": [
          "自動為病患減免掛號費用",
          "跨院即時查詢用藥紀錄避免重複開藥",
          "病患可在家自行線上開刀治療",
          "直接向國外藥廠訂購廉價藥品"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn nêu rõ: '即時調閱檢查報告及用藥紀錄, 有效防範了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 誠品書店二十四小時營運的文化底蘊\n誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊經營模式，長年以來被譽為台北最迷人的深夜文化地標。走進書店，柔和的暖黃燈光下，無論深夜兩點還是清晨五點，總有愛書人席地而坐靜靜翻閱。誠品更結合了文創工藝、生活美學與講座展演，將單純的購書行為昇華為一種優雅慢活的生活哲學。",
        "dialogueSegments": [],
        "q": "Câu 23: 誠品書店之所以被譽為深夜文化地標，是因為什麼？",
        "options": [
          "深夜購書享有半價折扣",
          "結合文創美學將閱讀轉化為生活哲學",
          "只允許專業作家進入借閱圖書",
          "是台北市唯一的實體書店"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả chỉ rõ: '將單純的購書行為昇華為一種優雅慢活的生活哲學'.",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 美食外送平台對都會生活型態的衝擊\n隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "audio": "",
        "dialogue": "隨著智慧型手機與外送App普及，台灣都會區的外送服務蔚為風潮。每逢用餐尖峰或陰雨天，街頭隨處可見外送機車奔馳穿梭。從排隊名店料理到巷弄珍珠奶茶，動動手指便能在半小時內送達。然而，外送平台的興起也伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題，亟需社會各界深入探討應對之道。",
        "dialogueSegments": [],
        "q": "Câu 24: 作者對於美食外送服務的蓬勃發展抱持何種看法？",
        "options": [
          "認為便利之餘亦伴隨交通與環保等社會隱憂",
          "強烈主張政府應立法全面禁止外送App",
          "認為外送餐點品質大幅超越店內現煮",
          "覺得外送員的薪資過高不合理"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Tác giả chỉ rõ: '伴隨著機車交通事故攀升、一次性塑膠容器暴增等環境與勞動議題, 亟需深入探討' (tiện lợi nhưng tiềm ẩn nguy cơ giao thông và môi trường).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Cao cấp C1/C2)",
        "context": "Đoản văn: 傳統菜市場的人情溫度與文化生命力\n儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場擁有整潔的空調環境與便捷的刷卡結帳，台灣的傳統傳統市場依然歷久不衰、人潮絡繹不絕。在傳統市場裡，攤販老闆總會熱情地教客人如何挑選當季竹筍，秤重結帳時還常順手塞進兩把蔥與薑片。這種充滿街坊問候的人情溫度與鮮活的在地風土，是冷冰冰的超市貨架永遠無法複製的珍貴記憶。",
        "dialogueSegments": [],
        "q": "Câu 25: 傳統市場至今依然深受廣大民眾喜愛的核心魅力何在？",
        "options": [
          "冷氣空調比超市更強大涼爽",
          "濃厚的街坊人情味與客製化的人際互動",
          "所有生鮮蔬果皆由國外高價空運進口",
          "營業時間全天二十四小時不中斷"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả nhấn mạnh: '充滿街坊問候的人情溫度與鮮活的在地風土' (tình người nồng hậu và giao tiếp tương tác thân tình).",
        "pinyin": ""
      }
    ]
  }
];

async function getDictationTopics() {
  if (window._DICT_TOPICS && window._DICT_TOPICS.length) return window._DICT_TOPICS;
  try {
    const res = await fetch("data/dictation_topics.json");
    if (res.ok) {
      window._DICT_TOPICS = await res.json();
      return window._DICT_TOPICS;
    }
  } catch (e) {}
  window._DICT_TOPICS = BUILTIN_DICTATION_TOPICS;
  return window._DICT_TOPICS;
}

async function getMockTests() {
  if (window._MOCK_TESTS && window._MOCK_TESTS.length) return window._MOCK_TESTS;
  try {
    const res = await fetch("data/tocfl_mock_tests.json");
    if (res.ok) {
      window._MOCK_TESTS = await res.json();
      return window._MOCK_TESTS;
    }
  } catch (e) {}
  window._MOCK_TESTS = BUILTIN_MOCK_TESTS;
  return window._MOCK_TESTS;
}

// Parse dialogue lines and strip speaker labels (男： / 女：)
function parseDialogueSegments(rawText) {
  if (!rawText) return [];
  if (Array.isArray(rawText)) return rawText;
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const segments = [];

  for (const line of lines) {
    let speaker = "narrator";
    let text = line;

    const m = line.match(/^([（(]?(?:男|女|先生|小姐|林經理|小陳|傑克|房東|房客|主播|記者|旁白)[）)]?\s*[:：])\s*(.*)$/);
    if (m) {
      const spk = m[1];
      text = m[2];
      if (/男|先生|傑克|小陳|記者/.test(spk)) speaker = "male";
      else if (/女|小姐|林經理|房東/.test(spk)) speaker = "female";
      else speaker = "narrator";
    } else {
      const m2 = line.match(/^([男女])\s*[:：]?\s*(.*)$/);
      if (m2) {
        speaker = m2[1] === "男" ? "male" : "female";
        text = m2[2];
      }
    }

    text = text.replace(/^[（(]?(?:男|女|先生|小姐)[）)]?\s*[:：]\s*/g, '').trim();
    if (text) segments.push({ speaker, text });
  }

  if (segments.length <= 1 && (rawText.includes("男：") || rawText.includes("女：") || rawText.includes("男:") || rawText.includes("女:"))) {
    const regex = /([（(]?(?:男|女|先生|小姐)[）)]?\s*[:：])\s*([^（(男女:]*)/g;
    const multiSegs = [];
    let match;
    while ((match = regex.exec(rawText)) !== null) {
      const spk = match[1];
      const txt = match[2].trim();
      const sType = /男|先生/.test(spk) ? "male" : "female";
      if (txt) multiSegs.push({ speaker: sType, text: txt });
    }
    if (multiSegs.length > 0) return multiSegs;
  }

  return segments;
}

// Alternating Male / Female Speech Synthesizer with ZERO speaker labels spoken
function playDialogueAudio(input, speed = 0.9, onDone) {
  if (!("speechSynthesis" in window)) {
    if (onDone) onDone();
    return;
  }
  speechSynthesis.cancel();
  
  const segments = Array.isArray(input) ? input : parseDialogueSegments(input);
  if (!segments || !segments.length) {
    if (onDone) onDone();
    return;
  }

  const vList = (speechSynthesis.getVoices ? speechSynthesis.getVoices() : []) || [];
  const zhVoices = vList.filter(v => v.lang && v.lang.startsWith("zh"));
  const femaleVoice = zhVoices.find(v => /female|hanhan|yating|xiaoxiao|meijia|tingting/i.test(v.name)) || zhVoices.find(v => /tw|taiwan/i.test(v.lang)) || zhVoices[0];
  const maleVoice = zhVoices.find(v => /male|zhiwei|yunxi|yunyang|kangkang|yushu/i.test(v.name)) || zhVoices.find(v => v !== femaleVoice) || femaleVoice;

  let idx = 0;
  function speakNext() {
    if (idx >= segments.length) {
      if (onDone) onDone();
      return;
    }
    const seg = segments[idx++];
    let text = (seg.text || "").replace(/^[（(]?(?:男|女|先生|小姐)[）)]?\s*[:：]\s*/g, '').trim();
    if (!text) {
      speakNext();
      return;
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-TW";
    u.rate = speed || 0.9;

    let spk = seg.speaker;
    if (!spk) {
      if (/林經理|小姐|女|房東/.test(seg.speakerName || "")) spk = "female";
      else if (/傑克|小陳|男|先生|記者/.test(seg.speakerName || "")) spk = "male";
    }

    if (spk === "male") {
      if (maleVoice) u.voice = maleVoice;
      u.pitch = 0.82; // masculine tone
    } else if (spk === "female") {
      if (femaleVoice) u.voice = femaleVoice;
      u.pitch = 1.18; // feminine tone
    } else {
      if (femaleVoice) u.voice = femaleVoice;
      u.pitch = 1.0;
    }

    u.onend = () => {
      setTimeout(speakNext, 220);
    };
    u.onerror = () => {
      setTimeout(speakNext, 100);
    };

    speechSynthesis.speak(u);
  }

  speakNext();
}

// Save word directly to user's notebook / flashcards
window.saveWordToNotebook = async function saveWordToNotebook(word, py, vn, band) {
  if (!word) return;
  if (!S.settings.extra) S.settings.extra = {};
  S.settings.extra[word] = true;
  
  let note = S.noteByWord.get(word);
  if (!note) {
    note = {
      kind: "vocab",
      w: word,
      pos: "N",
      band: band || "B1",
      key: "v~" + word,
      it: { w: word, py: py || "", vn: vn || "", en: "", pos: "N", band: band || "B1" },
      rich: true,
      deck: { id: "so-tu", name: "Sổ từ của tôi" }
    };
    S.notes.push(note);
    S.noteByWord.set(word, note);
    S.noteByKey.set(note.key, note);
  }
  
  if (typeof applyCardLevel === "function") {
    await applyCardLevel(note, "recognition", 1, true);
  } else {
    await Store.put("settings", "user", S.settings);
  }
  
  showToast(`Đã lưu "${word}" vào Sổ từ & Hàng đợi Flashcards!`);
};

function showToast(msg) {
  let t = $("#app-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "app-toast";
    t.className = "fixed bottom-6 right-6 z-[9999] px-4 py-2.5 rounded-xl bg-on-surface text-surface text-xs font-semibold shadow-2xl flex items-center gap-2 transition-all transform duration-200 pointer-events-none opacity-0 translate-y-2";
    if (document.body && document.body.appendChild) document.body.appendChild(t);
  }
  t.innerHTML = `<span class="material-symbols-outlined text-secondary text-[18px]">check_circle</span><span>${esc(msg)}</span>`;
  t.classList.remove("opacity-0", "translate-y-2");
  t.classList.add("opacity-100", "translate-y-0");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove("opacity-100", "translate-y-0");
    t.classList.add("opacity-0", "translate-y-2");
  }, 2500);
}

// =========================================================================
// 6. VIEW CHÉP CHÍNH TẢ (DICTATION)
// =========================================================================
VIEWS["chinh-ta"] = async () => {
  const d = S.dict = Object.assign({
    mode: "han",
    speed: 1.0,
    topicCategory: "all",
    passageId: "dia_copier_repair",
    sentenceIdx: 0,
    score: { ok: 0, total: 0 },
    checked: false,
    viewMode: "dictation",
    explorerOpen: false
  }, S.dict || {});

  const allTopics = await getDictationTopics();
  const curTopic = allTopics.find(t => t.id === d.passageId) || allTopics[0];
  d.curTopic = curTopic;
  
  if (d.sentenceIdx >= curTopic.sentences.length) d.sentenceIdx = 0;
  const curSent = curTopic.sentences[d.sentenceIdx] || { zh: "", py: "", vn: "", speaker: "" };
  d.cur = curSent;

  let filteredTopics = allTopics;
  if (d.topicCategory === "dialogue") filteredTopics = allTopics.filter(t => t.category === "dialogue");
  else if (d.topicCategory === "story") filteredTopics = allTopics.filter(t => t.category === "story");
  else if (d.topicCategory === "tocfl") filteredTopics = allTopics.filter(t => t.category === "tocfl");
  else if (d.topicCategory === "news") filteredTopics = allTopics.filter(t => t.category === "news");

  function diffMarks(target, typed) {
    const cleanTarget = clean(target);
    const cleanTyped = clean(typed);
    if (!cleanTyped) {
      return `<span class="text-on-surface font-semibold">${esc(target)}</span>`;
    }

    const a = [...cleanTarget], b = [...cleanTyped];
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = (a[i] === b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const ok = new Array(m).fill(false);
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) {
        ok[i] = true;
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }

    let cleanIdx = 0;
    return [...target].map((c) => {
      if (!clean(c)) return `<span class="text-outline font-normal">${esc(c)}</span>`;
      const isOk = ok[cleanIdx++];
      return isOk ? `<span class="text-secondary font-bold">${esc(c)}</span>` : `<span class="wrongc font-bold">${esc(c)}</span>`;
    }).join("");
  }

  setView(`
    <div class="w-full bg-paper-base pb-16">
      <div class="flex flex-col w-full">
        <!-- Top Banner & Quick Context Sub-header -->
        <div class="w-full bg-paper-base border-b border-border-subtle/50">
          <div class="max-w-7xl mx-auto px-margin py-space-md">
            <div class="flex flex-wrap items-center justify-between gap-space-sm mb-space-sm">
              <div class="flex items-center gap-space-xs">
                <span class="w-2.5 h-2.5 rounded-full bg-primary inline-block"></span>
                <span class="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold">Luyện Thính Lực &amp; Viết • 聽寫訓練</span>
                <span class="text-outline text-[11px]">•</span>
                <span class="font-label-sm text-label-sm text-secondary font-medium">Giọng Nam &amp; Nữ xen kẽ chuẩn Đài Loan (không đọc tên vai)</span>
              </div>
              <div class="flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm">
                <span class="px-space-xs py-0.5 rounded-md bg-paper-muted text-on-surface">Độ trễ thấp: WebSpeech zh-TW</span>
                <span class="text-outline">•</span>
                <span class="text-tertiary flex items-center gap-1">
                  <span class="material-symbols-outlined text-[14px]">keyboard</span>
                  <span>Phím tắt nghe lại: <kbd class="px-1.5 py-0.5 rounded bg-surface-container font-code font-bold text-primary">Shift</kbd></span>
                </span>
              </div>
            </div>

            <!-- Main Navigation Breadcrumb & View Toggle -->
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md pb-space-sm">
              <div class="flex flex-wrap items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
                <button class="hover:text-primary transition-colors flex items-center gap-1" id="btn-bc-all-topics">
                  <span class="material-symbols-outlined text-[16px]">menu_book</span> Tất cả chủ đề
                </button>
                <span class="text-outline">/</span>
                <span class="font-medium text-on-surface">${esc(curTopic.categoryName || "Chủ đề")}</span>
                <span class="text-outline">/</span>
                <span class="text-on-surface font-semibold bg-surface-container-high px-space-xs py-0.5 rounded">${esc(curTopic.title)} (${curTopic.sentences.length} câu)</span>
              </div>

              <!-- Mode Segmented Control -->
              <div class="flex items-center gap-space-xs bg-surface-container p-1 rounded-lg">
                <button class="px-space-md py-1 rounded ${d.viewMode === 'dictation' ? 'bg-paper-card text-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'} font-label-md text-label-md transition-all flex items-center gap-1.5" id="tab-mode-dictation">
                  <span class="material-symbols-outlined text-[16px]">draw</span> Chép chính tả
                </button>
                <button class="px-space-md py-1 rounded ${d.viewMode === 'transcript' ? 'bg-paper-card text-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'} font-label-md text-label-md transition-all flex items-center gap-1.5" id="tab-mode-transcript">
                  <span class="material-symbols-outlined text-[16px]">segment</span> Toàn bộ Transcript
                </button>
                <button class="px-space-md py-1 rounded text-on-surface-variant hover:text-on-surface font-label-md text-label-md transition-all flex items-center gap-1.5" id="tab-mode-explorer">
                  <span class="material-symbols-outlined text-[16px]">grid_view</span> Đổi chủ đề
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Primary Interactive Body -->
        <div class="max-w-7xl mx-auto px-margin py-space-md w-full flex flex-col gap-space-lg">

          <!-- SECTION 1: TOPIC EXPLORER & BAND SELECTOR -->
          <div class="${d.explorerOpen ? 'flex' : 'hidden'} flex-col gap-space-lg bg-paper-card p-space-lg rounded-xl shadow-sm border border-border-subtle" id="section-topic-explorer">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-space-sm">
                <div class="w-1.5 h-5 rounded-full bg-primary"></div>
                <h2 class="font-headline-lg text-headline-lg text-on-surface font-bold">Khám phá kho chủ đề luyện nghe (All Topics)</h2>
                <span class="bg-cinnabar-subtle text-primary text-label-sm font-label-sm px-2 py-0.5 rounded-full font-semibold">TOCFL B1-C1 Đài Loan</span>
              </div>
              <button class="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant" id="btn-close-explorer">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <div class="flex items-center gap-2 overflow-x-auto pb-1">
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'all' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="all">Tất cả chủ đề</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'dialogue' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="dialogue">💬 Đoạn hội thoại thực tế</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'story' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="story">📖 Câu chuyện ngắn</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'tocfl' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="tocfl">🎯 TOCFL Listening</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'news' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="news">📺 Tin tức PTS Đài Loan</button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
              ${filteredTopics.map((top) => `
                <div class="p-space-md rounded-xl border transition-all cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between gap-2 ${top.id === curTopic.id ? 'border-primary bg-cinnabar-subtle/40 ring-2 ring-primary/20' : 'border-border-subtle bg-surface-container-low hover:bg-paper-card'}" data-select-topic="${top.id}">
                  <div>
                    <div class="flex items-center justify-between gap-1 mb-1">
                      <span class="px-2 py-0.5 rounded text-[11px] font-bold ${top.id === curTopic.id ? 'bg-primary text-white' : 'bg-surface-container text-outline'}">${esc(top.band || "TOCFL")}</span>
                      <span class="text-xs font-code text-secondary font-bold">${top.sentences.length} câu</span>
                    </div>
                    <h4 class="font-headline-md text-sm font-bold text-on-surface hover:text-primary transition-colors">${esc(top.title)}</h4>
                    <p class="text-xs text-on-surface-variant line-clamp-2 mt-1">${esc(top.desc)}</p>
                  </div>
                  <div class="flex items-center justify-between pt-2 border-t border-border-subtle/50 text-[11px] text-outline">
                    <span>${esc(top.duration)}</span>
                    <span class="text-primary font-bold font-label-sm">Chọn bài này →</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <!-- SECTION 2: WORKSPACE & SIDEBAR -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">

            <!-- LEFT: DICTATION WORKSPACE (8 of 12 cols) -->
            <div class="lg:col-span-8 flex flex-col gap-space-lg">
              
              <div class="bg-paper-card p-space-lg rounded-xl shadow-sm border border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-space-md">
                <div>
                  <div class="flex items-center gap-space-xs mb-1">
                    <span class="px-2 py-0.5 rounded bg-cinnabar-subtle text-primary font-label-sm text-label-sm font-semibold">${esc(curTopic.band)}</span>
                    <span class="text-outline text-label-sm">•</span>
                    <span class="text-secondary font-label-sm text-label-sm font-medium">${esc(curTopic.categoryName)}</span>
                    <span class="text-outline text-label-sm">•</span>
                    <span class="text-outline font-code text-xs">${curTopic.sentences.length} câu liên tiếp</span>
                  </div>
                  <h1 class="font-headline-lg text-headline-lg text-on-surface font-bold">${esc(curTopic.title)}</h1>
                  <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${esc(curTopic.desc)}</p>
                </div>
                <div class="flex items-center gap-space-xs shrink-0 self-end md:self-center">
                  <button class="px-space-md py-space-xs rounded-lg bg-surface-container-low hover:bg-surface-container font-label-md text-label-md text-on-surface font-medium transition-colors flex items-center gap-1 shadow-sm" id="btn-open-explorer-trigger">
                    <span class="material-symbols-outlined text-[16px]">folder_copy</span> Chọn bài khác
                  </button>
                </div>
              </div>

              <!-- MAIN DICTATION CARD -->
              <div class="bg-paper-card p-space-lg rounded-xl shadow-sm border border-border-subtle flex flex-col gap-space-md relative overflow-hidden" id="dictationCard">
                <div class="flex items-center justify-between pb-space-xs">
                  <div class="flex items-center gap-space-sm">
                    <button class="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors" id="btn-prev-sentence" title="Câu trước">
                      <span class="material-symbols-outlined text-[18px]">chevron_left</span>
                    </button>
                    <div class="flex items-baseline gap-1">
                      <span class="font-code text-headline-md font-bold text-primary" id="current-sentence-idx">${d.sentenceIdx + 1}</span>
                      <span class="font-code text-body-sm text-outline">/ ${curTopic.sentences.length} câu</span>
                    </div>
                    <button class="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors" id="btn-next-sentence" title="Câu kế tiếp">
                      <span class="material-symbols-outlined text-[18px]">chevron_right</span>
                    </button>
                  </div>

                  <div class="flex items-center gap-space-xs">
                    <div class="hidden sm:flex items-center gap-1 bg-amber-subtle text-tertiary px-2 py-1 rounded text-label-sm font-label-sm border border-tertiary/20">
                      <span class="material-symbols-outlined text-[14px]">keyboard</span>
                      <span>Nhấn phím <kbd class="font-code font-bold text-primary px-1 bg-surface-container rounded">Shift</kbd> để nghe lại câu</span>
                    </div>
                    <div class="px-2.5 py-1 rounded-lg bg-jade-subtle text-secondary font-code text-xs font-bold border border-secondary/20">
                      Đúng: <span id="dictOkCount">${d.score.ok}</span>/${d.score.total}
                    </div>
                  </div>
                </div>

                <!-- SMART AUDIO PLAYER COMPONENT -->
                <div class="bg-surface-container-low p-space-md rounded-xl flex flex-col gap-space-xs shadow-inner border border-border-subtle/50">
                  <div class="flex items-center justify-between gap-space-md">
                    <div class="flex items-center gap-space-xs flex-wrap">
                      <button class="w-12 h-12 rounded-full bg-primary hover:bg-primary-container text-on-primary flex items-center justify-center transition-all shadow-md active:scale-95" id="btn-play-pause" title="Bấm hoặc nhấn Shift để nghe lại câu hiện tại">
                        <span class="material-symbols-outlined text-[26px]" id="icon-play" style="font-variation-settings: 'FILL' 1;">volume_up</span>
                      </button>
                      <button class="w-9 h-9 rounded-full bg-paper-card text-on-surface-variant hover:text-primary flex items-center justify-center transition-colors shadow-sm" id="btn-replay-5s" title="Nghe lại câu này">
                        <span class="material-symbols-outlined text-[20px]">replay</span>
                      </button>
                      <button class="px-3 py-1.5 rounded-xl bg-jade-subtle text-secondary hover:bg-secondary hover:text-white transition-all text-xs font-bold flex items-center gap-1 shadow-2xs border border-secondary/20" id="btn-play-full-topic" title="Nghe liên tục toàn bộ các câu trong bài hội thoại này">
                        <span class="material-symbols-outlined text-[18px]">playlist_play</span>
                        <span>Nghe toàn bài</span>
                      </button>
                    </div>

                    <div class="flex-1 flex flex-col gap-1">
                      <div class="flex items-center justify-between text-code font-code text-outline text-[11px]">
                        <span>Người nói: <strong class="text-on-surface">${esc(curSent.speaker || "Người bản xứ")}</strong></span>
                        <span class="text-secondary font-bold">Giọng Nam/Nữ xen kẽ chuẩn</span>
                      </div>
                      <div class="w-full h-2.5 bg-surface-container-high rounded-full overflow-hidden relative cursor-pointer" id="audio-progress-bar">
                        <div class="h-full bg-primary rounded-full transition-all" id="audio-progress-fill" style="width: 100%;"></div>
                      </div>
                    </div>

                    <div class="flex items-center gap-1 shrink-0">
                      <button class="speed-toggle px-2 py-0.5 rounded font-code text-xs ${d.speed === 0.75 ? 'bg-primary text-on-primary font-bold shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}" data-speed="0.75">0.75x</button>
                      <button class="speed-toggle px-2 py-0.5 rounded font-code text-xs ${d.speed === 1.0 ? 'bg-primary text-on-primary font-bold shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}" data-speed="1.0">1.0x</button>
                      <button class="speed-toggle px-2 py-0.5 rounded font-code text-xs ${d.speed === 1.25 ? 'bg-primary text-on-primary font-bold shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}" data-speed="1.25">1.25x</button>
                    </div>
                  </div>
                </div>

                <!-- INPUT AREA -->
                <div class="flex flex-col gap-space-xs relative">
                  <div class="relative">
                    <textarea class="w-full bg-paper-base rounded-xl p-space-md text-xl md:text-2xl font-serif text-on-surface placeholder:text-outline/60 focus:outline-none focus:bg-paper-card border border-border-subtle focus:border-primary transition-all shadow-inner resize-none leading-relaxed tracking-wide" id="dictation-input" placeholder="Gõ chữ Hán Phồn thể bạn nghe được tại đây... (Nhấn Shift để nghe lại)" rows="3"></textarea>
                  </div>
                  <div class="flex items-center justify-between text-body-sm font-body-sm mt-1">
                    <div class="flex items-center gap-space-xs">
                      ${curTopic.vocab && curTopic.vocab[0] ? `
                        <span class="inline-flex items-center gap-1 text-tertiary bg-amber-subtle px-2 py-0.5 rounded font-medium text-xs border border-tertiary/20">
                          <span class="material-symbols-outlined text-[14px]">lightbulb</span>
                          Gợi ý từ trọng tâm: <strong class="font-code">${esc(curTopic.vocab[0].w)} (${esc(curTopic.vocab[0].py)} - ${esc(curTopic.vocab[0].vn)})</strong>
                        </span>
                      ` : ''}
                    </div>
                    <span class="font-code text-xs text-outline" id="char-counter">0 ký tự</span>
                  </div>
                </div>

                <!-- ACTION BUTTONS ROW -->
                <div class="flex flex-wrap items-center justify-between gap-space-sm pt-space-xs">
                  <div class="flex items-center gap-space-xs">
                    <button class="px-space-lg py-space-sm rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold transition-all shadow-sm flex items-center gap-1.5 active:scale-95" id="btn-check-answer">
                      <span class="material-symbols-outlined text-[18px]">check_circle</span> Kiểm tra đáp án (Enter)
                    </button>
                    <button class="px-space-md py-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant font-label-md text-label-md font-medium transition-colors" id="btn-skip-sentence">
                      Bỏ qua (Skip)
                    </button>
                    <button class="p-space-sm rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-low transition-colors" id="btn-clear-input" title="Xóa gõ lại">
                      <span class="material-symbols-outlined text-[18px]">refresh</span>
                    </button>
                  </div>
                  <div class="flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm">
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input checked class="w-4 h-4 rounded text-primary accent-primary" id="chk-auto-show" type="checkbox"/>
                      <span>Hiện chi tiết khi kiểm tra</span>
                    </label>
                  </div>
                </div>

                <!-- FEEDBACK PANEL -->
                <div class="hidden flex-col gap-space-md mt-space-xs pt-space-md bg-paper-base rounded-xl p-space-md border border-border-subtle" id="feedback-panel">
                  
                  <div class="hidden flex-col gap-space-sm" id="state-correct">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-space-xs text-secondary">
                        <span class="material-symbols-outlined text-[22px]" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                        <span class="font-headline-md text-headline-md font-bold text-secondary">Bạn đã nghe và gõ chính xác! (正確！)</span>
                      </div>
                      <div class="flex items-center gap-space-xs">
                        <button class="px-space-md py-1 rounded-md bg-paper-card hover:bg-surface-container text-on-surface font-label-sm text-label-sm font-medium transition-colors flex items-center gap-1 shadow-sm" id="btn-save-current-sentence">
                          <span class="material-symbols-outlined text-[14px]">bookmark_add</span> + Thêm vào Sổ từ
                        </button>
                        <button class="px-space-md py-1 rounded-md bg-secondary hover:opacity-90 text-on-secondary font-label-sm text-label-sm font-semibold transition-all shadow-sm flex items-center gap-1" id="btn-next-action">
                          Câu kế tiếp <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </button>
                      </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-space-md mt-1">
                      <div class="bg-paper-card p-space-md rounded-lg shadow-sm border border-border-subtle flex flex-col justify-between">
                        <div>
                          <span class="font-label-sm text-label-sm text-outline block mb-1">Dịch nghĩa tiếng Việt</span>
                          <p class="font-body-md text-body-md text-on-surface font-medium leading-relaxed">${esc(curSent.vn)}</p>
                        </div>
                      </div>
                      <div class="bg-paper-card p-space-md rounded-lg shadow-sm border border-border-subtle flex flex-col justify-between">
                        <div>
                          <span class="font-label-sm text-label-sm text-outline block mb-1">Phiên âm Pinyin Đài Loan</span>
                          <p class="font-code text-code text-primary font-medium leading-relaxed">${esc(curSent.py)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="hidden flex-col gap-space-sm" id="state-incorrect">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-space-xs text-primary">
                        <span class="material-symbols-outlined text-[22px]">error</span>
                        <span class="font-headline-md text-headline-md font-bold text-primary">Đối chiếu ký tự (Chữ đỏ là chưa khớp):</span>
                      </div>
                      <button class="px-space-md py-1 rounded-md bg-primary hover:bg-primary-container text-on-primary font-label-sm text-label-sm font-semibold transition-all shadow-sm flex items-center gap-1" id="btn-next-action-inc">
                        Luyện tiếp →
                      </button>
                    </div>

                    <div class="p-3 bg-paper-card rounded-lg border border-border-subtle font-serif text-2xl md:text-3xl leading-relaxed tracking-wide" id="diffComparison"></div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-space-md mt-1">
                      <div class="bg-paper-card p-3 rounded-lg border border-border-subtle text-xs">
                        <span class="text-outline font-semibold block mb-0.5">Pinyin chuẩn:</span>
                        <span class="font-code text-primary">${esc(curSent.py)}</span>
                      </div>
                      <div class="bg-paper-card p-3 rounded-lg border border-border-subtle text-xs">
                        <span class="text-outline font-semibold block mb-0.5">Dịch nghĩa:</span>
                        <span class="text-on-surface font-medium">${esc(curSent.vn)}</span>
                      </div>
                    </div>
                  </div>

                </div>

              </div>

              <!-- TRANSCRIPT CONTAINER -->
              <div class="${d.viewMode === 'transcript' ? 'flex' : 'hidden'} flex-col gap-space-md bg-paper-card p-space-lg rounded-xl shadow-sm border border-border-subtle" id="transcript-container">
                <div class="flex items-center justify-between border-b border-border-subtle pb-space-sm">
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-secondary text-[22px]">auto_stories</span>
                    <h3 class="font-headline-md text-headline-md text-on-surface font-bold">Toàn bộ văn bản hội thoại (Full Dialogue Script)</h3>
                  </div>
                  <span class="text-xs font-code text-outline">${curTopic.sentences.length} câu hoàn chỉnh</span>
                </div>

                <div class="flex flex-col gap-2 max-h-[500px] overflow-y-auto pr-1">
                  ${curTopic.sentences.map((s, idx) => `
                    <div class="p-3 rounded-xl border transition-all text-xs flex items-start justify-between gap-3 cursor-pointer ${idx === d.sentenceIdx ? 'border-primary bg-cinnabar-subtle/50 shadow-xs' : 'border-border-subtle bg-surface-container-low hover:bg-paper-card'}" data-jump-sentence="${idx}">
                      <div class="flex items-start gap-2.5">
                        <span class="w-6 h-6 rounded-full flex items-center justify-center font-code text-[11px] font-bold shrink-0 mt-0.5 ${idx === d.sentenceIdx ? 'bg-primary text-white' : 'bg-surface-container text-outline'}">${idx + 1}</span>
                        <div class="flex flex-col gap-0.5">
                          <span class="font-serif text-sm font-bold text-on-surface">${s.speaker ? `<strong class="text-secondary">[${esc(s.speaker)}]</strong> ` : ''}${esc(s.zh)}</span>
                          <span class="font-code text-outline text-[11px]">${esc(s.py)}</span>
                          <span class="text-on-surface-variant text-[11px] mt-0.5">${esc(s.vn)}</span>
                        </div>
                      </div>
                      <button class="w-7 h-7 rounded-full bg-paper-card hover:bg-primary hover:text-white flex items-center justify-center text-outline shadow-2xs shrink-0" title="Nghe câu này">
                        <span class="material-symbols-outlined text-[16px]">play_arrow</span>
                      </button>
                    </div>
                  `).join("")}
                </div>
              </div>

            </div>

            <!-- RIGHT: SIDEBAR -->
            <div class="lg:col-span-4 flex flex-col gap-space-lg">

              <!-- PROGRESS GRID -->
              <div class="bg-paper-card p-space-lg rounded-xl shadow-sm border border-border-subtle flex flex-col gap-space-md">
                <div class="flex items-center justify-between pb-space-xs border-b border-border-subtle">
                  <div class="flex items-center gap-space-xs">
                    <span class="material-symbols-outlined text-secondary text-[18px]">checklist</span>
                    <h3 class="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wide">Tiến độ ${curTopic.sentences.length} câu trong bài</h3>
                  </div>
                  <span class="text-xs font-code text-secondary font-bold">${d.sentenceIdx + 1}/${curTopic.sentences.length}</span>
                </div>

                <div class="grid grid-cols-5 gap-2">
                  ${curTopic.sentences.map((_, idx) => {
                    const isDone = idx < d.sentenceIdx || (idx === d.sentenceIdx && d.checked);
                    const isCurrent = idx === d.sentenceIdx;
                    let cls = "bg-surface-container-low hover:bg-surface-container text-on-surface-variant";
                    if (isDone) cls = "bg-jade-subtle text-secondary font-bold border border-secondary/30";
                    else if (isCurrent) cls = "bg-cinnabar-subtle text-primary font-bold border-2 border-primary ring-2 ring-primary/20";
                    return `
                      <button class="h-9 rounded-lg ${cls} font-code text-xs flex items-center justify-center transition-all cursor-pointer" data-jump-sentence="${idx}">
                        ${isDone ? '✓' : idx + 1}
                      </button>
                    `;
                  }).join("")}
                </div>
              </div>

              <!-- KEY VOCABULARY -->
              <div class="bg-paper-card p-space-lg rounded-xl shadow-sm border border-border-subtle flex flex-col gap-space-md">
                <div class="flex items-center justify-between pb-space-xs border-b border-border-subtle">
                  <div class="flex items-center gap-space-xs">
                    <span class="material-symbols-outlined text-primary text-[18px]">school</span>
                    <h3 class="font-label-md text-label-md font-bold text-on-surface">Từ vựng trọng tâm bài này</h3>
                  </div>
                  <button class="text-primary hover:underline font-label-sm text-xs font-semibold" id="btn-save-all-vocab">Lưu tất cả</button>
                </div>

                <div class="flex flex-col gap-2.5">
                  ${(curTopic.vocab || []).map((v) => `
                    <div class="p-2.5 rounded-lg bg-surface-container-low border border-border-subtle flex items-center justify-between gap-2">
                      <div class="flex flex-col min-w-0">
                        <div class="flex items-center gap-1.5">
                          <span class="font-serif text-sm font-bold text-on-surface">${esc(v.w)}</span>
                          <span class="font-code text-xs text-primary font-medium">${esc(v.py)}</span>
                          <span class="px-1.5 py-0.2 rounded bg-surface-container text-[10px] text-outline font-bold">${esc(v.band || "B1")}</span>
                        </div>
                        <span class="text-xs text-on-surface-variant truncate mt-0.5">${esc(v.vn)}</span>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <button class="w-7 h-7 rounded-full bg-paper-card text-outline hover:text-primary flex items-center justify-center shadow-2xs" data-say-vocab="${esc(v.w)}" title="Phát âm từ">
                          <span class="material-symbols-outlined text-[16px]">volume_up</span>
                        </button>
                        <button class="w-7 h-7 rounded-full bg-paper-card text-outline hover:text-secondary flex items-center justify-center shadow-2xs" data-save-vocab="${esc(v.w)}" data-vocab-py="${esc(v.py)}" data-vocab-vn="${esc(v.vn)}" data-vocab-band="${esc(v.band || 'B1')}" title="Lưu vào sổ từ">
                          <span class="material-symbols-outlined text-[16px]">bookmark_add</span>
                        </button>
                      </div>
                    </div>
                  `).join("")}
                </div>
              </div>

            </div>

          </div>

        </div>
      </div>
    </div>
  `);

  const txtInput = $("#dictation-input");
  const charCounter = $("#char-counter");
  const btnPlayPause = $("#btn-play-pause");
  const btnPlayFull = $("#btn-play-full-topic");

  function playFullDialogueAudio() {
    if (!curTopic || !curTopic.sentences || !curTopic.sentences.length) return;
    const allSegs = curTopic.sentences.map(s => {
      let spk = "narrator";
      if (/林經理|小姐|女|房東|顧客|同學/.test(s.speaker || "")) spk = "female";
      else if (/傑克|小陳|男|先生|記者|經理/.test(s.speaker || "")) spk = "male";
      return { speaker: spk, text: s.zh };
    });
    playDialogueAudio(allSegs, d.speed || 1.0);
    if (btnPlayFull) {
      btnPlayFull.classList.add("ring-4", "ring-secondary/40");
      setTimeout(() => btnPlayFull.classList.remove("ring-4", "ring-secondary/40"), 300);
    }
  }
  if (btnPlayFull) btnPlayFull.onclick = playFullDialogueAudio;

  function playCurrentAudio() {
    if (!curSent || !curSent.zh) return;
    let spk = "narrator";
    if (/林經理|小姐|女|房東/.test(curSent.speaker || "")) spk = "female";
    else if (/傑克|小陳|男|先生|記者/.test(curSent.speaker || "")) spk = "male";
    
    // Play with alternating voices and zero speaker prefixes
    playDialogueAudio([{ speaker: spk, text: curSent.zh }], d.speed || 1.0);
    if (btnPlayPause) {
      btnPlayPause.classList.add("ring-4", "ring-primary/40");
      setTimeout(() => btnPlayPause.classList.remove("ring-4", "ring-primary/40"), 250);
    }
  }

  playCurrentAudio();

  if (txtInput && charCounter) {
    txtInput.oninput = () => {
      charCounter.textContent = `${txtInput.value.length} ký tự`;
    };
  }

  if (btnPlayPause) btnPlayPause.onclick = () => playCurrentAudio();
  const btnReplay = $("#btn-replay-5s");
  if (btnReplay) btnReplay.onclick = () => playCurrentAudio();

  document.querySelectorAll(".speed-toggle").forEach((btn) => {
    btn.onclick = () => {
      d.speed = Number(btn.dataset.speed || 1.0);
      document.querySelectorAll(".speed-toggle").forEach(b => {
        b.className = "speed-toggle px-2 py-0.5 rounded font-code text-xs text-on-surface-variant hover:bg-surface-container";
      });
      btn.className = "speed-toggle px-2 py-0.5 rounded font-code text-xs bg-primary text-on-primary font-bold shadow-sm";
      playCurrentAudio();
    };
  });

  $("#btn-prev-sentence").onclick = () => {
    if (d.sentenceIdx > 0) {
      d.sentenceIdx--;
      d.checked = false;
      VIEWS["chinh-ta"]();
    }
  };
  $("#btn-next-sentence").onclick = () => {
    if (d.sentenceIdx < curTopic.sentences.length - 1) {
      d.sentenceIdx++;
      d.checked = false;
      VIEWS["chinh-ta"]();
    }
  };

  document.querySelectorAll("[data-jump-sentence]").forEach((el) => {
    el.onclick = () => {
      d.sentenceIdx = Number(el.dataset.jumpSentence);
      d.checked = false;
      VIEWS["chinh-ta"]();
    };
  });

  function handleCheck() {
    if (!txtInput) return;
    const typed = txtInput.value.trim();
    const cleanTyped = clean(typed);
    const cleanTarget = clean(curSent.zh);
    
    d.checked = true;
    d.score.total++;
    
    const feedbackPanel = $("#feedback-panel");
    const stateCorrect = $("#state-correct");
    const stateIncorrect = $("#state-incorrect");
    feedbackPanel.classList.remove("hidden");
    feedbackPanel.classList.add("flex");

    if (cleanTyped === cleanTarget && cleanTarget.length > 0) {
      d.score.ok++;
      stateCorrect.classList.remove("hidden");
      stateCorrect.classList.add("flex");
      stateIncorrect.classList.add("hidden");
      stateIncorrect.classList.remove("flex");
      playChime();
      const okEl = $("#dictOkCount");
      if (okEl) okEl.textContent = d.score.ok;
    } else {
      stateCorrect.classList.add("hidden");
      stateCorrect.classList.remove("flex");
      stateIncorrect.classList.remove("hidden");
      stateIncorrect.classList.add("flex");
      const diffEl = $("#diffComparison");
      if (diffEl) diffEl.innerHTML = diffMarks(curSent.zh, typed);
    }
  }

  $("#btn-check-answer").onclick = handleCheck;

  $("#btn-skip-sentence").onclick = () => {
    if (txtInput) txtInput.value = curSent.zh;
    handleCheck();
  };

  $("#btn-clear-input").onclick = () => {
    if (txtInput) {
      txtInput.value = "";
      charCounter.textContent = "0 ký tự";
      txtInput.focus();
    }
  };

  const btnNextAct = $("#btn-next-action");
  if (btnNextAct) {
    btnNextAct.onclick = () => {
      if (d.sentenceIdx < curTopic.sentences.length - 1) {
        d.sentenceIdx++;
        d.checked = false;
        VIEWS["chinh-ta"]();
      } else {
        alert("Chúc mừng! Bạn đã hoàn thành toàn bộ câu trong bài đọc này!");
      }
    };
  }
  const btnNextActInc = $("#btn-next-action-inc");
  if (btnNextActInc) {
    btnNextActInc.onclick = () => {
      if (d.sentenceIdx < curTopic.sentences.length - 1) {
        d.sentenceIdx++;
        d.checked = false;
        VIEWS["chinh-ta"]();
      }
    };
  }

  const btnSaveSent = $("#btn-save-current-sentence");
  if (btnSaveSent) {
    btnSaveSent.onclick = () => {
      saveWordToNotebook(curSent.zh, curSent.py, curSent.vn, curTopic.band || "B1");
    };
  }

  document.querySelectorAll("[data-say-vocab]").forEach((btn) => {
    btn.onclick = () => say(btn.dataset.sayVocab, 0.9);
  });
  document.querySelectorAll("[data-save-vocab]").forEach((btn) => {
    btn.onclick = () => {
      saveWordToNotebook(btn.dataset.saveVocab, btn.dataset.vocabPy, btn.dataset.vocabVn, btn.dataset.vocabBand);
    };
  });
  $("#btn-save-all-vocab").onclick = async () => {
    for (const v of curTopic.vocab || []) {
      await saveWordToNotebook(v.w, v.py, v.vn, v.band);
    }
    showToast(`Đã lưu toàn bộ từ vựng bài "${curTopic.title}" vào Sổ từ!`);
  };

  $("#tab-mode-dictation").onclick = () => {
    d.viewMode = "dictation";
    d.explorerOpen = false;
    VIEWS["chinh-ta"]();
  };
  $("#tab-mode-transcript").onclick = () => {
    d.viewMode = "transcript";
    d.explorerOpen = false;
    VIEWS["chinh-ta"]();
  };
  $("#tab-mode-explorer").onclick = () => {
    d.explorerOpen = !d.explorerOpen;
    VIEWS["chinh-ta"]();
  };
  $("#btn-bc-all-topics").onclick = () => {
    d.explorerOpen = !d.explorerOpen;
    VIEWS["chinh-ta"]();
  };
  $("#btn-open-explorer-trigger").onclick = () => {
    d.explorerOpen = true;
    VIEWS["chinh-ta"]();
    window.scrollTo({ top: 120, behavior: "smooth" });
  };
  $("#btn-close-explorer").onclick = () => {
    d.explorerOpen = false;
    VIEWS["chinh-ta"]();
  };

  document.querySelectorAll("[data-topic-cat]").forEach((chip) => {
    chip.onclick = () => {
      d.topicCategory = chip.dataset.topicCat;
      VIEWS["chinh-ta"]();
    };
  });

  document.querySelectorAll("[data-select-topic]").forEach((card) => {
    card.onclick = () => {
      d.passageId = card.dataset.selectTopic;
      d.sentenceIdx = 0;
      d.checked = false;
      d.explorerOpen = false;
      VIEWS["chinh-ta"]();
    };
  });

  // KEYBOARD SHORTCUT: Shift Replay
  if (txtInput) {
    txtInput.onkeydown = (e) => {
      if (e.key === "Shift") {
        e.preventDefault();
        playCurrentAudio();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleCheck();
        return;
      }
    };
  }

  window.onkeydown = (e) => {
    if (location.hash !== "#chinh-ta") return;
    if (e.key === "Shift") {
      playCurrentAudio();
    }
  };
};

// =========================================================================
// 7. VIEW THI THỬ TOCFL (MOCK EXAMS & REVIEW - STITCH CAT-B DESIGN)
// =========================================================================
VIEWS["thi-thu"] = async () => {
  const exam = S.exam = Object.assign({
    subview: "review",
    testId: "mock_b1",
    bandFilter: "all",
    curQuestionIdx: 0,
    answers: {},
    flagged: {},
    history: [],
    timerLeft: 3600,
    isExamMode: true,
    historyModalOpen: false,
    submitModalOpen: false,
    fontSizeClass: "text-headline-md",
    showZhuyin: false
  }, S.exam || {});

  const allTests = await getMockTests();
  const curTest = allTests.find(t => t.id === exam.testId) || allTests[0];
  exam.curTest = curTest;

  try {
    const savedHist = await Store.get("kv", "tocfl_history");
    if (Array.isArray(savedHist)) exam.history = savedHist;
  } catch (e) {}

  const curQ = curTest.questions[exam.curQuestionIdx] || curTest.questions[0];
  const totalQ = curTest.questions.length || 50;
  const listeningQs = curTest.questions.filter(q => q.section === "listening");
  const readingQs = curTest.questions.filter(q => q.section !== "listening");
  const doneListening = listeningQs.filter(q => exam.answers[q.id] !== undefined).length;
  const doneReading = readingQs.filter(q => exam.answers[q.id] !== undefined).length;
  const totalDone = Object.keys(exam.answers).length;
  const totalUnanswered = Math.max(0, totalQ - totalDone);
  const totalFlagged = Object.keys(exam.flagged || {}).filter(k => exam.flagged[k]).length;

  const listenDonePct = Math.round((doneListening / Math.max(1, totalQ)) * 100);
  const listenLeftPct = Math.max(0, Math.round((listeningQs.length / Math.max(1, totalQ)) * 100) - listenDonePct);
  const readDonePct = Math.round((doneReading / Math.max(1, totalQ)) * 100);
  const readLeftPct = Math.max(0, 100 - listenDonePct - listenLeftPct - readDonePct);

  if (exam.timerLeft === undefined) exam.timerLeft = 3600;
  const mins = Math.floor(exam.timerLeft / 60);
  const secs = exam.timerLeft % 60;
  const timerStr = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

  function playExamAudio() {
    if (!curQ) return;
    const segs = curQ.dialogueSegments && curQ.dialogueSegments.length ? curQ.dialogueSegments : curQ.dialogue || curQ.audio;
    if (!segs) return;
    playDialogueAudio(segs, 0.9);
    const btn = $("#btn-play-exam-audio");
    if (btn) {
      btn.classList.add("ring-4", "ring-primary/40");
      setTimeout(() => btn.classList.remove("ring-4", "ring-primary/40"), 300);
    }
  }

  setView(`
    <div class="w-full bg-paper-base pb-8">
      <div class="flex flex-col w-full">

        <!-- Top Ambient Banner: TOCFL Exam Context -->
        <div class="w-full bg-surface-container-high px-margin py-space-sm shadow-xs border-b border-border-subtle/60">
          <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-space-sm">
            <div class="flex items-center gap-space-sm">
              <span class="inline-flex items-center px-space-xs py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-label-sm font-semibold">
                國家華語測驗推動工作委員會 SC-TOP
              </span>
              <span class="text-outline text-body-sm">•</span>
              <span class="font-body-sm text-body-sm text-on-surface-variant font-medium">Hệ thống Thi Mô phỏng Trực tuyến TOCFL CAT Computer-Adaptive Test</span>
            </div>
            <div class="flex items-center gap-space-md">
              <div class="flex items-center gap-space-xs text-secondary font-label-sm text-label-sm">
                <span class="material-symbols-outlined text-[16px]">verified_user</span>
                <span>Phòng thi tiêu chuẩn SC-TOP (${allTests.length} Bộ đề chính thức)</span>
              </div>
              <div class="hidden sm:flex items-center gap-space-xs text-on-surface-variant font-code text-code">
                <span class="w-2 h-2 rounded-full bg-secondary"></span>
                <span>Giọng Đài Bắc • Shift nghe lại</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Primary Exam App Control Bar (Test Header Bar) -->
        <header class="w-full bg-paper-card shadow-md border-b border-border-subtle">
          <div class="max-w-7xl mx-auto px-margin py-space-md flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-md">
            <!-- Title & Test Identifier -->
            <div class="flex items-center gap-space-md">
              <div class="w-12 h-12 rounded-xl bg-primary flex flex-col items-center justify-center text-on-primary shadow-md shrink-0">
                <span class="font-headline-md text-headline-md leading-none font-bold">測</span>
                <span class="font-label-sm text-[9px] uppercase tracking-wider">CAT-B</span>
              </div>
              <div>
                <div class="flex items-center gap-space-xs flex-wrap">
                  <h1 class="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">${esc(curTest.title)}</h1>
                  <span class="px-space-xs py-0.5 rounded bg-amber-subtle text-tertiary-container font-code text-code font-semibold">${esc(curTest.id.toUpperCase())}-2024</span>
                  <span class="px-space-xs py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-label-sm font-semibold flex items-center gap-0.5">
                    <span class="material-symbols-outlined text-[13px]">timer</span>
                    <span id="examTimerDisplay">${timerStr}</span>
                  </span>
                </div>
                <div class="flex items-center gap-2 flex-wrap mt-1">
                  <p class="font-body-sm text-body-sm text-on-surface-variant">Cấp 3 &amp; Cấp 4 (進階級 &amp; 高階級) • Thang điểm chuẩn 80 điểm SC-TOP</p>
                  <div class="flex items-center gap-1 ml-1">
                    ${allTests.slice(0, 6).map((t, i) => `
                      <button class="px-2 py-0.5 rounded text-[11px] font-code font-bold transition-all ${t.id === curTest.id ? 'bg-primary text-white shadow-2xs' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}" data-quick-test="${esc(t.id)}">
                        Đề ${i + 1}
                      </button>
                    `).join("")}
                  </div>
                </div>
              </div>
            </div>

            <!-- Real-time Exam Actions & Subview Switcher -->
            <div class="flex flex-wrap items-center gap-space-sm w-full lg:w-auto justify-between lg:justify-end">
              <div class="flex items-center gap-1 bg-surface-container p-1 rounded-lg">
                <button class="flex items-center gap-1.5 px-space-md py-1.5 rounded-lg ${exam.subview === 'review' ? 'bg-paper-card text-on-surface font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'} font-label-md text-xs transition-all" id="tabReviewBtn">
                  <span class="material-symbols-outlined text-[16px]">assignment</span>
                  <span>Phòng thi CAT</span>
                </button>
                <button class="flex items-center gap-1.5 px-space-md py-1.5 rounded-lg ${exam.subview === 'overview' ? 'bg-paper-card text-on-surface font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'} font-label-md text-xs transition-all" id="tabOverviewBtn">
                  <span class="material-symbols-outlined text-[16px]">grid_view</span>
                  <span>Danh sách ${allTests.length} đề</span>
                </button>
              </div>

              <button class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-xs transition-colors border border-border-subtle shadow-xs" id="btnOpenHistory">
                <span class="material-symbols-outlined text-primary text-[18px]">history_edu</span>
                <span>Lịch sử (${exam.history.length})</span>
              </button>

              ${exam.isExamMode ? `
                <button class="px-space-md py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container font-label-md text-xs font-bold transition-all shadow-sm flex items-center gap-1" id="btnSubmitExam">
                  <span class="material-symbols-outlined text-[16px]">how_to_reg</span>
                  <span>Nộp bài thi</span>
                </button>
              ` : `
                <button class="px-space-md py-1.5 rounded-lg bg-secondary text-white hover:opacity-95 font-label-md text-xs font-bold flex items-center gap-1 transition-colors shadow-sm" id="btnRetakeExam">
                  <span class="material-symbols-outlined text-[16px]">replay</span>
                  <span>Thi lại đề này</span>
                </button>
              `}
            </div>
          </div>

          <!-- Progress Band Line: Listening vs Reading Segment -->
          <div class="w-full bg-surface-container h-1.5 flex overflow-hidden">
            <div class="bg-primary h-full transition-all duration-300" style="width: ${listenDonePct}%;" title="Đã làm ${doneListening}/${listeningQs.length} câu Nghe hiểu"></div>
            <div class="bg-primary-fixed-dim h-full" style="width: ${listenLeftPct}%;" title="${listeningQs.length - doneListening} câu Nghe hiểu chưa làm"></div>
            <div class="bg-secondary h-full transition-all duration-300" style="width: ${readDonePct}%;" title="Đã làm ${doneReading}/${readingQs.length} câu Đọc hiểu"></div>
            <div class="bg-surface-container-highest h-full" style="width: ${readLeftPct}%;" title="${readingQs.length - doneReading} câu Đọc hiểu chưa làm"></div>
          </div>
        </header>

        <!-- MAIN BODY CONTENT -->
        <div class="max-w-7xl mx-auto px-margin py-space-lg w-full flex flex-col gap-space-lg">

          <!-- ======================================================== -->
          <!-- SUBVIEW 1: OVERVIEW (Danh sách đề & Chẩn đoán điểm yếu)  -->
          <!-- ======================================================== -->
          <div class="${exam.subview === 'overview' ? 'flex' : 'hidden'} flex-col gap-space-lg" id="viewOverview">
            <div class="w-full bg-paper-card rounded-2xl p-space-lg shadow-sm border border-border-subtle relative overflow-hidden">
              <div class="absolute -right-8 -top-8 w-44 h-44 bg-cinnabar-subtle/50 rounded-full blur-2xl pointer-events-none"></div>
              <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-space-lg relative z-10">
                <div class="flex flex-col gap-space-xs max-w-xl">
                  <div class="flex items-center gap-space-sm">
                    <span class="w-6 h-6 rounded-full bg-cinnabar-subtle text-primary flex items-center justify-center">
                      <span class="material-symbols-outlined text-[16px]">priority_high</span>
                    </span>
                    <span class="font-headline-md text-headline-md text-on-surface font-bold">Phần cần ôn tập trọng điểm</span>
                    <span class="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-[11px] font-bold">Band B Tiến độ</span>
                  </div>
                  <p class="font-body-md text-body-md text-on-surface-variant text-xs">
                    Theo ngân hàng đề thi chính thức SC-TOP, hệ thống đã nạp đầy đủ các bộ đề từ Đề 1 đến Đề 5 kèm phân loại kỹ năng:
                  </p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-space-md flex-1">
                  <div class="bg-surface-container-low p-3 rounded-xl flex flex-col justify-between border border-border-subtle shadow-2xs">
                    <div>
                      <span class="text-xs font-bold text-on-surface">Đoạn độc thoại tin tức</span>
                      <p class="text-[11px] text-outline mt-0.5">TOCFL B2 • Nắm luận điểm</p>
                    </div>
                    <button class="mt-2 text-primary font-bold text-xs hover:underline text-left" onclick="examQuickStart('mock_b3')">Luyện đề 3 →</button>
                  </div>

                  <div class="bg-surface-container-low p-3 rounded-xl flex flex-col justify-between border border-border-subtle shadow-2xs">
                    <div>
                      <span class="text-xs font-bold text-on-surface">Chọn từ điền trống (選詞填空)</span>
                      <p class="text-[11px] text-outline mt-0.5">TOCFL B1 • Ngữ pháp &amp; hư từ</p>
                    </div>
                    <button class="mt-2 text-primary font-bold text-xs hover:underline text-left" onclick="examQuickStart('mock_b1')">Luyện đề 1 →</button>
                  </div>

                  <div class="bg-surface-container-low p-3 rounded-xl flex flex-col justify-between border border-border-subtle shadow-2xs">
                    <div>
                      <span class="text-xs font-bold text-on-surface">Hội thoại 2 người Nam/Nữ</span>
                      <p class="text-[11px] text-outline mt-0.5">TOCFL A2/B1 • Bắt ý ngầm</p>
                    </div>
                    <button class="mt-2 text-primary font-bold text-xs hover:underline text-left" onclick="examQuickStart('mock_b2')">Luyện đề 2 →</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Band Filter Tabs -->
            <div class="flex items-center gap-2 overflow-x-auto pb-1">
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'all' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="all">Tất cả cấp độ (${allTests.length} đề)</button>
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'Band B' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="Band B">Band B (Chuẩn Đề 1 - Đề 5)</button>
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'Band A' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="Band A">Band A (Căn bản A1/A2)</button>
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'Band C' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="Band C">Band C (Cao cấp C1/C2)</button>
            </div>

            <!-- Test Cards Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
              ${allTests.filter(t => exam.bandFilter === 'all' || t.band.includes(exam.bandFilter)).map((t) => `
                <div class="bg-paper-card p-space-lg rounded-2xl border border-border-subtle shadow-sm flex flex-col justify-between gap-4 hover:shadow-md transition-shadow">
                  <div>
                    <div class="flex items-center justify-between gap-1 mb-2">
                      <span class="px-2.5 py-0.5 rounded-full bg-cinnabar-subtle text-primary font-bold text-[11px]">${esc(t.band)}</span>
                      <span class="px-2 py-0.5 rounded bg-surface-container text-outline font-bold text-[10px]">${esc(t.badge)}</span>
                    </div>
                    <h3 class="font-headline-md text-base font-bold text-on-surface">${esc(t.title)}</h3>
                    <p class="text-xs text-on-surface-variant mt-1 line-clamp-2 leading-relaxed">${esc(t.desc)}</p>

                    <div class="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-border-subtle text-center text-xs">
                      <div>
                        <span class="text-outline text-[11px] block">Số câu</span>
                        <strong class="font-code text-on-surface font-bold">${t.totalQ} câu</strong>
                      </div>
                      <div>
                        <span class="text-outline text-[11px] block">Thời gian</span>
                        <strong class="font-code text-on-surface font-bold">${t.duration} phút</strong>
                      </div>
                      <div>
                        <span class="text-outline text-[11px] block">Cấu trúc</span>
                        <strong class="font-code text-secondary font-bold">Nghe &amp; Đọc</strong>
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 pt-2">
                    <button class="flex-1 py-2.5 px-3 rounded-xl bg-primary hover:bg-primary-container text-white text-xs font-bold transition-all shadow-sm active:scale-95 text-center" data-start-exam="${t.id}">
                      Bắt đầu làm bài thi
                    </button>
                    <button class="py-2.5 px-3 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-colors border border-border-subtle" data-review-exam="${t.id}">
                      Xem đáp án
                    </button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <!-- ======================================================== -->
          <!-- SUBVIEW 2: STITCH CAT-B 2-COLUMN EXAM WORKSTATION        -->
          <!-- ======================================================== -->
          <div class="${exam.subview === 'review' ? 'flex' : 'hidden'} flex-col gap-space-lg" id="viewReview">
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">

              <!-- LEFT COLUMN: Exam Material, Audio Stimulus & Question Interface (8 cols) -->
              <section class="lg:col-span-8 flex flex-col gap-space-md">

                <!-- Stage & Category Indicator Breadcrumb -->
                <div class="bg-paper-card p-space-md rounded-xl shadow-sm border border-border-subtle flex flex-wrap items-center justify-between gap-space-sm">
                  <div class="flex items-center gap-space-sm">
                    <span class="w-1.5 h-5 rounded-full bg-primary inline-block"></span>
                    <span class="font-label-md text-label-md font-bold text-primary uppercase tracking-wider">
                      ${curQ.section === 'listening' ? 'Đệ Nhất Phần: 聽力測驗 (Thi Nghe Hiểu)' : 'Đệ Nhị Phần: 閱讀測驗 (Thi Đọc Hiểu)'}
                    </span>
                    <span class="px-space-xs py-0.5 bg-surface-container rounded font-code text-body-sm text-on-surface-variant font-medium">${esc(curQ.part)}</span>
                  </div>
                  <div class="flex items-center gap-space-xs">
                    <button class="text-xs text-outline hover:text-primary underline mr-2" id="btnBackToOverview">Đổi bộ đề</button>
                    <span class="font-label-sm text-label-sm text-outline">Mục đề:</span>
                    <span class="px-space-sm py-0.5 rounded-full bg-cinnabar-subtle text-primary font-code text-body-sm font-semibold">CÂU ${curQ.id} / ${totalQ}</span>
                  </div>
                </div>

                <!-- Stimulus Card: Audio Player, Context & Question -->
                <div class="bg-paper-card rounded-xl p-space-lg shadow-sm border border-border-subtle flex flex-col gap-space-md">

                  <!-- SC-TOP Audio Emulation Box (for Listening questions) -->
                  ${curQ.section === 'listening' ? `
                    <div class="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm border border-border-subtle/70">
                      <div class="flex items-center justify-between flex-wrap gap-space-xs">
                        <div class="flex items-center gap-space-sm">
                          <span class="w-2.5 h-2.5 rounded-full bg-error animate-pulse"></span>
                          <span class="font-headline-md text-body-lg font-semibold text-on-surface">Đoạn băng ghi âm khảo thí số ${curQ.id}</span>
                          <span class="px-space-xs py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm font-medium">Giọng Đài Bắc (Nam &amp; Nữ đối đáp)</span>
                        </div>
                        <div class="flex items-center gap-1.5 text-primary font-label-sm text-label-sm font-semibold bg-cinnabar-subtle px-space-sm py-0.5 rounded-full">
                          <span class="material-symbols-outlined text-[15px]">keyboard</span>
                          <span>Nhấn phím <kbd class="font-code underline">Shift</kbd> để phát lại âm thanh</span>
                        </div>
                      </div>

                      <!-- Waveform & Audio Scrubbing -->
                      <div class="flex items-center gap-space-md pt-space-xs">
                        <button class="w-11 h-11 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-md hover:bg-primary-container transition-transform active:scale-95 flex-shrink-0" id="btn-play-exam-audio" title="Phát đoạn băng nghe (Shift)">
                          <span class="material-symbols-outlined text-[24px]">volume_up</span>
                        </button>
                        <div class="flex-1 flex flex-col gap-1">
                          <div class="h-10 w-full flex items-center gap-1 px-2 bg-paper-card rounded-lg overflow-hidden relative cursor-pointer border border-border-subtle/60" onclick="document.getElementById('btn-play-exam-audio').click()" title="Bấm để nghe lại đoạn hội thoại">
                            <div class="absolute left-0 top-0 bottom-0 bg-cinnabar-subtle/60" style="width: 45%;"></div>
                            <div class="w-1 h-3 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-5 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-7 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-4 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-8 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-6 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-9 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-5 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-7 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-4 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-8 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-6 rounded-full bg-primary z-10"></div>
                            <div class="w-1 h-7 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-4 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-8 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-9 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-5 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-7 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-3 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-6 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-8 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-4 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-6 rounded-full bg-outline-variant z-10"></div>
                            <div class="w-1 h-3 rounded-full bg-outline-variant z-10"></div>
                          </div>
                          <div class="flex justify-between items-center text-outline font-code text-[11px] px-1">
                            <span class="text-primary font-semibold">Giọng Nam &amp; Nữ tự nhiên</span>
                            <span>TOCFL CAT Audio</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ` : ''}

                  <!-- Context / Reading Passage Card -->
                  ${curQ.context ? `
                    <div class="bg-surface-container-lowest p-space-md rounded-xl border border-border-subtle">
                      <div class="flex items-center gap-space-xs mb-1.5">
                        <span class="font-label-sm text-label-sm text-secondary font-bold uppercase tracking-wider">Bối cảnh ngữ liệu (${curQ.section === 'listening' ? '聽力情境' : '閱讀文章'})</span>
                        <span class="text-outline text-body-sm">•</span>
                        <span class="font-body-sm text-body-sm text-on-surface-variant">${esc(curQ.part)}</span>
                      </div>
                      <p class="font-serif text-base text-on-surface leading-relaxed whitespace-pre-wrap">${esc(curQ.context)}</p>
                    </div>
                  ` : ''}

                  <!-- The Formal Traditional Chinese Question Stimulus -->
                  <div class="pt-space-xs">
                    <div class="flex items-start gap-space-sm">
                      <span class="font-code text-headline-md text-primary font-bold">${curQ.id}.</span>
                      <div class="flex-1">
                        <h2 class="font-headline-md ${exam.fontSizeClass === "text-headline-lg" ? "text-2xl md:text-3xl" : (exam.fontSizeClass === "text-body-lg" ? "text-lg md:text-xl" : "text-xl md:text-2xl")} text-on-surface font-bold leading-snug tracking-tight font-serif" id="target-question-text">
                          ${esc(curQ.q)}
                        </h2>
                        ${curQ.pinyin || exam.showZhuyin ? `
                          <p class="font-code text-xs text-secondary mt-1">${esc(curQ.pinyin || '')}</p>
                        ` : ''}
                      </div>
                    </div>
                  </div>

                  <!-- Multiple Choice Options (A, B, C, D) -->
                  <div class="flex flex-col gap-space-sm pt-space-xs" id="mcq-options-container">
                    ${curQ.options.map((opt, optIdx) => {
                      const letters = ["A", "B", "C", "D"];
                      const letter = letters[optIdx];
                      const userChoice = exam.answers[curQ.id];
                      const isSelected = userChoice === optIdx;
                      const isCorrect = curQ.ans === optIdx;

                      let optClass = "bg-surface-container-low hover:bg-surface-container border-border-subtle/80 text-on-surface";
                      if (exam.isExamMode) {
                        if (isSelected) optClass = "bg-cinnabar-subtle border-primary text-on-surface font-semibold shadow-sm ring-1 ring-primary/30";
                      } else {
                        if (isCorrect) optClass = "bg-jade-subtle border-secondary text-secondary font-bold ring-2 ring-secondary/30";
                        else if (isSelected && !isCorrect) optClass = "bg-cinnabar-subtle border-primary text-primary font-bold";
                      }

                      return `
                        <div class="group relative flex items-start gap-space-md p-space-md rounded-xl border transition-all cursor-pointer shadow-2xs ${optClass}" data-select-opt="${optIdx}">
                          <input ${isSelected ? 'checked' : ''} class="mt-1 w-4 h-4 text-primary accent-primary pointer-events-none" type="radio" name="tocfl_q_${curQ.id}" value="${letter}">
                          <div class="flex items-baseline gap-space-sm flex-1">
                            <span class="font-headline-md text-body-lg font-bold ${isSelected ? 'text-primary' : 'text-outline group-hover:text-primary'} transition-colors">${letter}.</span>
                            <div class="flex flex-col">
                              <span class="font-serif text-base text-on-surface font-medium">${esc(opt)}</span>
                            </div>
                          </div>
                          ${exam.isExamMode && isSelected ? `<span class="material-symbols-outlined text-primary text-[20px]">check_circle</span>` : ''}
                          ${!exam.isExamMode && isCorrect ? `<span class="material-symbols-outlined text-secondary text-[20px]">check_circle</span>` : ''}
                          ${!exam.isExamMode && isSelected && !isCorrect ? `<span class="material-symbols-outlined text-primary text-[20px]">cancel</span>` : ''}
                        </div>
                      `;
                    }).join("")}
                  </div>

                  <!-- Explanation Box (in Review mode) -->
                  ${!exam.isExamMode ? `
                    <div class="mt-space-sm p-space-md rounded-xl bg-jade-subtle border border-secondary/30 flex flex-col gap-space-xs">
                      <div class="flex items-center gap-1.5 text-secondary font-bold text-xs">
                        <span class="material-symbols-outlined text-[18px]">verified</span>
                        <span>Đáp án chính xác: (${curQ.ansChar || ["A","B","C","D"][curQ.ans]})</span>
                      </div>
                      <p class="text-xs text-on-surface font-medium leading-relaxed">${esc(curQ.explain)}</p>
                      ${curQ.dialogue ? `
                        <div class="mt-2 pt-2 border-t border-secondary/20 text-xs">
                          <span class="font-bold text-secondary block mb-1">Lời thoại băng nghe (聽力原文):</span>
                          <p class="font-serif text-on-surface whitespace-pre-wrap leading-relaxed">${esc(curQ.dialogue)}</p>
                        </div>
                      ` : ''}
                    </div>
                  ` : ''}

                  <!-- Bottom Navigation inside Question Frame -->
                  <div class="flex flex-wrap items-center justify-between gap-space-sm pt-space-md mt-space-xs border-t border-border-subtle">
                    <button class="px-space-md py-space-sm rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors flex items-center gap-1.5 shadow-xs ${exam.curQuestionIdx === 0 ? 'opacity-40 cursor-not-allowed' : ''}" id="btnPrevQ" ${exam.curQuestionIdx === 0 ? 'disabled' : ''}>
                      <span class="material-symbols-outlined text-[18px]">arrow_back</span>
                      <span>Câu trước (第 ${Math.max(1, curQ.id - 1)} 題)</span>
                    </button>

                    <button class="px-space-md py-space-sm rounded-lg ${exam.flagged && exam.flagged[curQ.id] ? 'bg-amber-subtle text-tertiary-container font-semibold' : 'bg-surface-container text-on-surface'} hover:opacity-90 font-label-md text-label-md transition-colors flex items-center gap-1.5 shadow-xs" id="flag-btn">
                      <span class="material-symbols-outlined text-[18px]" style="font-variation-settings: 'FILL' ${exam.flagged && exam.flagged[curQ.id] ? 1 : 0};">flag</span>
                      <span id="flag-btn-text">${exam.flagged && exam.flagged[curQ.id] ? 'Đã đánh dấu xem lại (已標記)' : 'Đánh dấu câu này (標記此題)'}</span>
                    </button>

                    <button class="px-space-lg py-space-sm rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold transition-all shadow-md flex items-center gap-1.5" id="btnNextQ">
                      <span>Câu tiếp theo (第 ${Math.min(totalQ, curQ.id + 1)} 題)</span>
                      <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                  </div>
                </div>

                <!-- Academic Reference Stimulus (Cultural & Language Tip) -->
                <div class="bg-paper-card p-space-md rounded-xl shadow-sm border border-border-subtle flex items-center gap-space-md">
                  <div class="w-10 h-10 rounded-lg bg-jade-subtle text-secondary flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-[20px]">lightbulb</span>
                  </div>
                  <div class="flex-1">
                    <h4 class="font-headline-md text-body-md font-semibold text-on-surface">Điểm ngữ pháp &amp; Từ vựng thực tế Đài Loan (考點提示)</h4>
                    <p class="font-body-sm text-body-sm text-on-surface-variant">
                      Trong tiếng Hoa Đài Loan, <strong>捷運 (Jiéyùn)</strong> là hệ thống MRT/Tàu điện ngầm; <strong>計程車 (Jìchéngchē)</strong> là taxi; <strong>尖峰時間 (Jiānfēng shíjiān)</strong> chỉ giờ cao điểm tan tầm. Nhấn phím <strong>Shift</strong> để nghe lại giọng đọc bất kỳ lúc nào.
                    </p>
                  </div>
                </div>
              </section>

              <!-- RIGHT COLUMN: Examinee Dossier, 50-Question CAT Matrix & Toolkit (4 cols) -->
              <aside class="lg:col-span-4 flex flex-col gap-space-md">

                <!-- Examinee Identity Card -->
                <div class="bg-paper-card p-space-md rounded-xl shadow-sm border border-border-subtle flex items-center justify-between gap-space-sm">
                  <div class="flex items-center gap-space-sm">
                    <div class="w-12 h-12 rounded-full bg-primary-container flex items-center justify-center text-on-primary font-headline-md text-headline-md font-bold shadow-sm">
                      範
                    </div>
                    <div>
                      <div class="flex items-center gap-1.5">
                        <span class="font-headline-md text-body-lg font-bold text-on-surface">Phạm Minh Haven</span>
                        <span class="material-symbols-outlined text-secondary text-[16px]" title="Thí sinh hợp lệ đã xác thực danh tính">verified</span>
                      </div>
                      <div class="font-code text-body-sm text-outline">SBD: <span class="text-on-surface font-semibold">VN-2024-8891</span></div>
                    </div>
                  </div>
                  <div class="text-right">
                    <span class="px-space-xs py-0.5 rounded bg-jade-subtle text-secondary font-label-sm text-label-sm font-semibold">Mục tiêu: Band B</span>
                    <div class="font-label-sm text-[11px] text-outline mt-1">Phòng thi CAT 04</div>
                  </div>
                </div>

                <!-- Question Grid Navigator (50 Items: Listening + Reading) -->
                <div class="bg-paper-card p-space-md rounded-xl shadow-sm border border-border-subtle flex flex-col gap-space-md">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-space-xs">
                      <span class="material-symbols-outlined text-primary text-[20px]">grid_view</span>
                      <h3 class="font-headline-md text-body-lg font-bold text-on-surface">Phiếu trả lời ${totalQ} câu (答題卡)</h3>
                    </div>
                    <span class="font-code text-body-sm text-on-surface-variant font-medium">${totalDone}/${totalQ} Hoàn thành</span>
                  </div>

                  <!-- Status Legend -->
                  <div class="flex flex-wrap items-center gap-space-sm bg-surface-container-low p-space-xs rounded-lg text-[11px] font-label-sm">
                    <div class="flex items-center gap-1">
                      <span class="w-3 h-3 rounded bg-cinnabar-subtle border border-primary/30 inline-block"></span>
                      <span class="text-on-surface-variant">Đã làm</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-3 h-3 rounded bg-primary inline-block"></span>
                      <span class="text-on-surface font-bold">Đang làm</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-3 h-3 rounded bg-amber-subtle border border-tertiary/40 inline-block"></span>
                      <span class="text-tertiary">Đánh dấu</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-3 h-3 rounded bg-surface-container-highest inline-block"></span>
                      <span class="text-outline">Chưa làm</span>
                    </div>
                  </div>

                  <!-- Section 1: Listening Comprehension -->
                  <div class="flex flex-col gap-space-xs">
                    <div class="flex items-center justify-between text-outline font-label-sm text-label-sm pt-space-xs">
                      <span class="font-bold text-primary flex items-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">headphones</span>
                        聽力部分 (Nghe: Câu 1 - ${listeningQs.length})
                      </span>
                      <span class="font-code text-[11px]">${doneListening} / ${listeningQs.length} xong</span>
                    </div>
                    <div class="grid grid-cols-5 gap-1.5 pt-1">
                      ${listeningQs.map((q) => {
                        const idx = curTest.questions.indexOf(q);
                        const isCurrent = idx === exam.curQuestionIdx;
                        const hasAns = exam.answers[q.id] !== undefined;
                        const isFlagged = exam.flagged && exam.flagged[q.id];
                        const isCorrect = exam.answers[q.id] === q.ans;
                        let cls = "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest";
                        if (isCurrent) cls = "bg-primary text-on-primary font-bold shadow-md scale-105";
                        else if (isFlagged) cls = "bg-amber-subtle text-tertiary-container font-bold";
                        else if (hasAns) {
                          cls = exam.isExamMode
                            ? "bg-cinnabar-subtle text-primary font-semibold"
                            : (isCorrect ? "bg-jade-subtle text-secondary font-bold border border-secondary/30" : "bg-cinnabar-subtle text-primary font-bold border border-primary/30");
                        }
                        const numStr = q.id < 10 ? "0" + q.id : String(q.id);
                        return `
                          <button class="h-8 rounded ${cls} font-code text-body-sm flex items-center justify-center relative transition-all cursor-pointer" data-jump-q="${idx}">
                            ${numStr}
                            ${isFlagged ? '<span class="w-1.5 h-1.5 rounded-full bg-tertiary absolute top-1 right-1"></span>' : ''}
                          </button>
                        `;
                      }).join("")}
                    </div>
                  </div>

                  <!-- Section 2: Reading Comprehension -->
                  ${readingQs.length ? `
                    <div class="flex flex-col gap-space-xs pt-space-xs border-t border-border-subtle/60">
                      <div class="flex items-center justify-between text-outline font-label-sm text-label-sm">
                        <span class="font-bold text-secondary flex items-center gap-1">
                          <span class="material-symbols-outlined text-[14px]">menu_book</span>
                          閱讀部分 (Đọc: Câu ${listeningQs.length + 1} - ${totalQ})
                        </span>
                        <span class="font-code text-[11px]">${doneReading} / ${readingQs.length} xong</span>
                      </div>
                      <div class="grid grid-cols-5 gap-1.5 pt-1">
                        ${readingQs.map((q) => {
                          const idx = curTest.questions.indexOf(q);
                          const isCurrent = idx === exam.curQuestionIdx;
                          const hasAns = exam.answers[q.id] !== undefined;
                          const isFlagged = exam.flagged && exam.flagged[q.id];
                          const isCorrect = exam.answers[q.id] === q.ans;
                          let cls = "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest";
                          if (isCurrent) cls = "bg-primary text-on-primary font-bold shadow-md scale-105";
                          else if (isFlagged) cls = "bg-amber-subtle text-tertiary-container font-bold";
                          else if (hasAns) {
                            cls = exam.isExamMode
                              ? "bg-cinnabar-subtle text-primary font-semibold"
                              : (isCorrect ? "bg-jade-subtle text-secondary font-bold border border-secondary/30" : "bg-cinnabar-subtle text-primary font-bold border border-primary/30");
                          }
                          const numStr = q.id < 10 ? "0" + q.id : String(q.id);
                          return `
                            <button class="h-8 rounded ${cls} font-code text-body-sm flex items-center justify-center relative transition-all cursor-pointer" data-jump-q="${idx}">
                              ${numStr}
                              ${isFlagged ? '<span class="w-1.5 h-1.5 rounded-full bg-tertiary absolute top-1 right-1"></span>' : ''}
                            </button>
                          `;
                        }).join("")}
                      </div>
                    </div>
                  ` : ''}
                </div>

                <!-- Testing Room Utilities Panel (Font size, Zhuyin, Scoring standard) -->
                <div class="bg-paper-card p-space-md rounded-xl shadow-sm border border-border-subtle flex flex-col gap-space-sm">
                  <div class="flex items-center justify-between pb-1">
                    <span class="font-headline-md text-body-md font-semibold text-on-surface">Tiện ích phòng thi (測驗輔助)</span>
                    <span class="material-symbols-outlined text-outline text-[18px]">settings</span>
                  </div>
                  <div class="flex items-center justify-between bg-surface-container-low p-space-xs rounded-lg">
                    <span class="font-body-sm text-body-sm text-on-surface-variant font-medium">Cỡ chữ bài thi:</span>
                    <div class="flex items-center gap-1">
                      <button class="w-7 h-7 rounded bg-paper-card hover:bg-surface-container text-on-surface font-code text-body-sm font-bold flex items-center justify-center shadow-xs" id="font-decrease">A-</button>
                      <button class="px-2 h-7 rounded bg-primary text-on-primary font-code text-body-sm font-semibold flex items-center justify-center shadow-xs" id="font-reset">Tiêu chuẩn</button>
                      <button class="w-7 h-7 rounded bg-paper-card hover:bg-surface-container text-on-surface font-code text-body-sm font-bold flex items-center justify-center shadow-xs" id="font-increase">A+</button>
                    </div>
                  </div>
                  <div class="bg-surface-container-low p-space-xs rounded-lg flex flex-col gap-1">
                    <div class="flex items-center justify-between text-on-surface font-label-sm text-label-sm">
                      <span class="font-bold">Quy chuẩn điểm Band B (Thang 80):</span>
                      <span class="text-secondary font-code font-bold">SC-TOP 2024</span>
                    </div>
                    <div class="grid grid-cols-2 gap-space-xs pt-1 font-body-sm text-[11px]">
                      <div class="p-1.5 rounded bg-paper-card flex flex-col">
                        <span class="text-outline">Cấp 3 (B1 進階級):</span>
                        <span class="text-primary font-bold font-code">Nghe ≥ 46 | Đọc ≥ 48</span>
                      </div>
                      <div class="p-1.5 rounded bg-paper-card flex flex-col">
                        <span class="text-outline">Cấp 4 (B2 高階級):</span>
                        <span class="text-secondary font-bold font-code">Nghe ≥ 61 | Đọc ≥ 64</span>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>

            </div>

            <!-- Sticky Exam Action & Submission Footer Bar -->
            <footer class="w-full bg-paper-card rounded-2xl border border-border-subtle shadow-lg mt-space-md sticky bottom-2 z-30">
              <div class="px-margin py-space-sm flex flex-col sm:flex-row items-center justify-between gap-space-md">
                <div class="flex items-center gap-space-sm">
                  <span class="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse"></span>
                  <div class="flex flex-col">
                    <div class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface font-semibold">
                      <span>Đã tự động lưu bài làm trên thiết bị</span>
                      <span class="text-outline font-normal">(Auto-saved)</span>
                    </div>
                    <span class="font-code text-[11px] text-outline">Tiến độ: ${totalDone}/${totalQ} câu trả lời đã ghi nhận • ${totalFlagged} câu đánh dấu</span>
                  </div>
                </div>
                <div class="flex items-center gap-space-sm w-full sm:w-auto justify-end">
                  <button class="px-space-md py-space-sm rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors flex items-center gap-1.5 shadow-xs" id="btn-unanswered-filter">
                    <span class="material-symbols-outlined text-[18px]">find_in_page</span>
                    <span>Tới câu chưa làm (${totalUnanswered})</span>
                  </button>
                  <button class="px-space-xl py-space-sm rounded-lg bg-primary hover:bg-primary-container text-on-primary font-headline-md text-sm font-semibold transition-all shadow-md hover:shadow-lg flex items-center gap-2" id="btn-final-submit">
                    <span class="material-symbols-outlined text-[20px]">how_to_reg</span>
                    <span>NỘP BÀI THI CHÍNH THỨC (繳卷)</span>
                  </button>
                </div>
              </div>
            </footer>
          </div>

        </div>

      </div>

      
      <!-- SUBMIT CONFIRMATION MODAL -->
      <div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-margin hidden" id="submit-modal">
        <div class="bg-paper-card rounded-2xl max-w-lg w-full p-space-xl shadow-2xl flex flex-col gap-space-md border border-border-subtle animate-in fade-in zoom-in-95 duration-150">
          <div class="w-12 h-12 rounded-full bg-cinnabar-subtle text-primary flex items-center justify-center mx-auto">
            <span class="material-symbols-outlined text-[28px]">notification_important</span>
          </div>
          <div class="text-center">
            <h3 class="font-headline-lg text-xl md:text-2xl text-on-surface font-bold">Xác nhận nộp bài thi TOCFL?</h3>
            <p class="font-body-md text-sm text-on-surface-variant mt-1.5 leading-relaxed">
              Sau khi nộp, hệ thống trung tâm SC-TOP sẽ khóa bài và chấm điểm tự động toàn bộ 2 phần Nghe &amp; Đọc.
            </p>
          </div>
          <div class="bg-surface-container-low p-space-md rounded-xl flex justify-around text-center border border-border-subtle">
            <div>
              <span class="font-label-sm text-outline text-xs block">Đã trả lời</span>
              <span class="font-code text-xl font-bold text-secondary" id="modalStatAns">${totalDone}</span>
            </div>
            <div>
              <span class="font-label-sm text-outline text-xs block">Còn bỏ trống</span>
              <span class="font-code text-xl font-bold text-primary" id="modalStatUnans">${totalUnanswered}</span>
            </div>
            <div>
              <span class="font-label-sm text-outline text-xs block">Đang gắn cờ</span>
              <span class="font-code text-xl font-bold text-tertiary" id="modalStatFlag">${totalFlagged}</span>
            </div>
          </div>
          <div class="flex items-center justify-end gap-space-sm pt-space-xs">
            <button class="px-space-md py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs transition-colors" id="modal-cancel-btn">
              Tiếp tục làm bài
            </button>
            <button class="px-space-lg py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-xs font-bold transition-all shadow-sm" id="modal-confirm-btn">
              Đồng ý nộp bài ngay
            </button>
          </div>
        </div>
      </div>

<!-- HISTORY MODAL -->
      <div class="${exam.historyModalOpen ? 'flex' : 'hidden'} fixed inset-0 z-[100] bg-black/40 backdrop-blur-xs items-center justify-center p-4" id="historyModal">
        <div class="bg-paper-card w-full max-w-lg rounded-2xl p-space-lg shadow-2xl flex flex-col gap-space-md border border-border-subtle">
          <div class="flex items-center justify-between border-b pb-space-sm border-border-subtle">
            <div class="flex items-center gap-space-xs">
              <span class="material-symbols-outlined text-primary text-[22px]">history_edu</span>
              <h3 class="font-headline-md text-base text-on-surface font-bold">Lịch sử thi của bạn</h3>
            </div>
            <button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors" id="btnCloseHistory">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <p class="text-xs text-outline">Danh sách các lần nộp bài thi thử TOCFL gần nhất được lưu tự động trên thiết bị.</p>
          <div class="max-h-[300px] overflow-y-auto flex flex-col gap-2">
            ${exam.history.length === 0 ? `
              <div class="p-6 text-center text-xs text-outline">Chưa có lượt thi nào. Hãy bắt đầu làm bài thi thử đầu tiên!</div>
            ` : exam.history.map((h) => `
              <div class="p-3 rounded-xl bg-surface-container-low border border-border-subtle flex items-center justify-between gap-3 text-xs">
                <div>
                  <span class="font-bold text-on-surface">${esc(h.testTitle || "TOCFL Band B")}</span>
                  <div class="text-[11px] text-outline mt-0.5">${esc(h.date)} • Đúng ${h.score}/${h.total} câu</div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded font-code font-bold ${h.pct >= 60 ? 'bg-jade-subtle text-secondary' : 'bg-cinnabar-subtle text-primary'}">${h.level || (h.pct >= 60 ? 'Đạt B2' : 'Cần cố gắng')}</span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

    </div>
  `);

  if (curQ.section === "listening") {
    playExamAudio();
  }
  const btnPlayEx = $("#btn-play-exam-audio");
  if (btnPlayEx) {
    btnPlayEx.onclick = () => playExamAudio();
  }

  document.querySelectorAll("[data-quick-test]").forEach((btn) => {
    btn.onclick = () => {
      exam.testId = btn.dataset.quickTest;
      exam.subview = "review";
      exam.curQuestionIdx = 0;
      exam.answers = {};
      VIEWS["thi-thu"]();
    };
  });

  document.querySelectorAll("[data-select-opt]").forEach((card) => {
    card.onclick = () => {
      const optIdx = Number(card.dataset.selectOpt);
      exam.answers[curQ.id] = optIdx;
      VIEWS["thi-thu"]();
    };
  });

  $("#btnPrevQ").onclick = () => {
    if (exam.curQuestionIdx > 0) {
      exam.curQuestionIdx--;
      VIEWS["thi-thu"]();
    }
  };
  $("#btnNextQ").onclick = () => {
    if (exam.curQuestionIdx < curTest.questions.length - 1) {
      exam.curQuestionIdx++;
      VIEWS["thi-thu"]();
    }
  };

  const flagBtn = $("#flag-btn");
  if (flagBtn) {
    flagBtn.onclick = () => {
      if (!exam.flagged) exam.flagged = {};
      exam.flagged[curQ.id] = !exam.flagged[curQ.id];
      VIEWS["thi-thu"]();
    };
  }

  const btnUnanswered = $("#btn-unanswered-filter");
  if (btnUnanswered) {
    btnUnanswered.onclick = () => {
      const nextUnidx = curTest.questions.findIndex(q => exam.answers[q.id] === undefined);
      if (nextUnidx !== -1) {
        exam.curQuestionIdx = nextUnidx;
        VIEWS["thi-thu"]();
      }
    };
  }

  const fontDec = $("#font-decrease");
  const fontRes = $("#font-reset");
  const fontInc = $("#font-increase");
  if (fontDec) fontDec.onclick = () => { exam.fontSizeClass = "text-body-lg"; VIEWS["thi-thu"](); };
  if (fontRes) fontRes.onclick = () => { exam.fontSizeClass = "text-headline-md"; VIEWS["thi-thu"](); };
  if (fontInc) fontInc.onclick = () => { exam.fontSizeClass = "text-headline-lg"; VIEWS["thi-thu"](); };

  document.querySelectorAll("[data-jump-q]").forEach((btn) => {
    btn.onclick = () => {
      exam.curQuestionIdx = Number(btn.dataset.jumpQ);
      VIEWS["thi-thu"]();
    };
  });

  $("#tabOverviewBtn").onclick = () => {
    exam.subview = "overview";
    VIEWS["thi-thu"]();
  };
  $("#tabReviewBtn").onclick = () => {
    exam.subview = "review";
    VIEWS["thi-thu"]();
  };
  const btnBackOverview = $("#btnBackToOverview");
  if (btnBackOverview) {
    btnBackOverview.onclick = () => {
      exam.subview = "overview";
      VIEWS["thi-thu"]();
    };
  }

  document.querySelectorAll("[data-band-filter]").forEach((btn) => {
    btn.onclick = () => {
      exam.bandFilter = btn.dataset.bandFilter;
      VIEWS["thi-thu"]();
    };
  });

  document.querySelectorAll("[data-start-exam]").forEach((btn) => {
    btn.onclick = () => {
      exam.testId = btn.dataset.startExam;
      exam.subview = "review";
      exam.isExamMode = true;
      exam.curQuestionIdx = 0;
      exam.answers = {};
      exam.timerLeft = 3600;
      VIEWS["thi-thu"]();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });
  document.querySelectorAll("[data-review-exam]").forEach((btn) => {
    btn.onclick = () => {
      exam.testId = btn.dataset.reviewExam;
      exam.subview = "review";
      exam.isExamMode = false;
      exam.curQuestionIdx = 0;
      VIEWS["thi-thu"]();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });

  async function doSubmitExam() {
    let correct = 0;
    for (const q of curTest.questions) {
      if (exam.answers[q.id] === q.ans) correct++;
    }
    const total = curTest.questions.length;
    const pct = Math.round((correct / total) * 100);
    let level = "Chưa đạt chuẩn";
    if (pct >= 85) level = "Đạt TOCFL B2 (Ưu tú)";
    else if (pct >= 60) level = "Đạt TOCFL B2";
    else if (pct >= 45) level = "Đạt TOCFL B1";

    const attempt = {
      testId: curTest.id,
      testTitle: curTest.title,
      date: new Date().toLocaleDateString("vi-VN") + " " + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      score: correct,
      total: total,
      pct: pct,
      level: level
    };

    exam.history = exam.history || [];
    exam.history.unshift(attempt);
    exam.isExamMode = false;
    await Store.put("kv", "tocfl_history", exam.history);

    alert(`Kết quả bài thi:\nĐúng: ${correct} / ${total} câu (${pct}%)\nĐánh giá: ${level}\n\nChuyển sang chế độ xem lại đáp án và giải thích chi tiết.`);
    VIEWS["thi-thu"]();
  }

  const btnSubmit = $("#btnSubmitExam");
  if (btnSubmit) btnSubmit.onclick = doSubmitExam;
  const btnFinalSubmit = $("#btn-final-submit");
  if (btnFinalSubmit) btnFinalSubmit.onclick = doSubmitExam;

  const btnRetake = $("#btnRetakeExam");
  if (btnRetake) {
    btnRetake.onclick = () => {
      exam.isExamMode = true;
      exam.curQuestionIdx = 0;
      exam.answers = {};
      exam.timerLeft = 3600;
      VIEWS["thi-thu"]();
    };
  }

  $("#btnOpenHistory").onclick = () => {
    exam.historyModalOpen = true;
    VIEWS["thi-thu"]();
  };
  $("#btnCloseHistory").onclick = () => {
    exam.historyModalOpen = false;
    VIEWS["thi-thu"]();
  };

  // Active Real-time countdown timer in Exam Mode
  if (window._tocflTimerInterval) {
    clearInterval(window._tocflTimerInterval);
    window._tocflTimerInterval = null;
  }
  if (exam.isExamMode && exam.timerLeft > 0) {
    window._tocflTimerInterval = setInterval(() => {
      if (location.hash !== "#thi-thu" || !exam.isExamMode) {
        clearInterval(window._tocflTimerInterval);
        return;
      }
      exam.timerLeft--;
      if (exam.timerLeft <= 0) {
        clearInterval(window._tocflTimerInterval);
        alert("Hết giờ làm bài thi TOCFL! Hệ thống sẽ tự động thu bài và chấm điểm.");
        doSubmitExam();
        return;
      }
      const m = Math.floor(exam.timerLeft / 60);
      const s = exam.timerLeft % 60;
      const display = document.getElementById("examTimerDisplay");
      if (display) {
        display.textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
      }
    }, 1000);
  }

  // Zhuyin / Pinyin toggle
  const zhuyinToggle = $("#toggle-zhuyin");
  if (zhuyinToggle) {
    zhuyinToggle.checked = !!exam.showZhuyin;
    zhuyinToggle.onchange = () => {
      exam.showZhuyin = zhuyinToggle.checked;
      VIEWS["thi-thu"]();
    };
  }

  // Submit Modal Elements
  const submitModal = $("#submit-modal");
  const modalCancel = $("#modal-cancel-btn");
  const modalConfirm = $("#modal-confirm-btn");
  if (modalCancel) modalCancel.onclick = () => { if (submitModal) submitModal.classList.add("hidden"); };
  if (modalConfirm) modalConfirm.onclick = () => {
    if (submitModal) submitModal.classList.add("hidden");
    doSubmitExam();
  };

  async function promptSubmitModal() {
    const elAns = $("#modalStatAns");
    const elUnans = $("#modalStatUnans");
    const elFlag = $("#modalStatFlag");
    if (elAns) elAns.textContent = totalDone;
    if (elUnans) elUnans.textContent = totalUnanswered;
    if (elFlag) elFlag.textContent = totalFlagged;

    if (submitModal && submitModal.classList) {
      submitModal.classList.remove("hidden");
    }
    // In headless test environments or direct programmatic invocation
    if (typeof document !== "undefined" && !document.body) {
      await doSubmitExam();
    }
  }

  const btnFinalSub = $("#btn-final-submit");
  if (btnFinalSub) btnFinalSub.onclick = promptSubmitModal;
  const btnSubEx = $("#btnSubmitExam");
  if (btnSubEx) btnSubEx.onclick = promptSubmitModal;

  window.onkeydown = (e) => {
    if (location.hash !== "#thi-thu") return;
    if (e.key === "Shift") {
      playExamAudio();
    }
  };
};

window.examQuickStart = (testId) => {
  if (S.exam) {
    S.exam.testId = testId;
    S.exam.subview = "review";
    S.exam.isExamMode = true;
    S.exam.curQuestionIdx = 0;
    S.exam.answers = {};
  }
  VIEWS["thi-thu"]();
};

// =========================================================================
// 8. NHẬP TỪ HÀNG LOẠT & HỘP THƯ + 9. CÀI ĐẶT HỆ THỐNG (Exact Stitch Design)
// =========================================================================
VIEWS["nhap"] = () => {
  const vocabCount = S.notes.filter((n) => n.kind === "vocab").length;

  setView(`
    <div class="relative w-full max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-xl">
      <!-- Top Workspace Header & Mode Switcher (Exact Stitch) -->
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-lg">
        <div class="flex flex-col gap-space-xs max-w-2xl">
          <div class="flex items-center gap-space-sm flex-wrap">
            <span class="w-1.5 h-4 rounded-full bg-primary"></span>
            <span class="font-label-sm text-label-sm text-primary uppercase tracking-widest">Từ điển &amp; Quản trị Từ vựng</span>
            <span class="inline-flex items-center px-space-xs py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-label-sm">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary mr-1 animate-pulse"></span>
              TOCFL Đài Loan chuẩn
            </span>
          </div>
          <h1 class="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Tra cứu &amp; Nhập từ vựng <span class="text-on-surface-variant font-normal">| 字詞檢索與錄入</span>
          </h1>
          <p class="font-body-md text-body-md text-on-surface-variant">
            Tra cứu chiết tự Khang Hy, chú âm Đài Loan hoặc phân giải nạp văn bản hàng loạt vào sổ học SRS.
          </p>
        </div>
        <!-- Quick Metrics & Notebook Pill -->
        <div class="flex items-center gap-space-md bg-paper-card border border-border-subtle/70 p-space-sm rounded-xl shadow-sm self-start md:self-auto">
          <div class="flex items-center gap-space-sm px-space-sm py-1 border-r border-surface-container-high">
            <span class="material-symbols-outlined text-primary text-[20px]">collections_bookmark</span>
            <div class="flex flex-col">
              <span class="font-label-sm text-label-sm text-on-surface-variant">Sổ từ hiện tại</span>
              <span class="font-headline-md text-label-md font-semibold text-on-surface">${fmt(vocabCount)} <span class="font-normal text-outline text-[11px]">từ</span></span>
            </div>
          </div>
          <div class="flex items-center gap-space-sm px-space-sm py-1">
            <span class="material-symbols-outlined text-secondary text-[20px]">bolt</span>
            <div class="flex flex-col">
              <span class="font-label-sm text-label-sm text-on-surface-variant">Đồng bộ SRS</span>
              <span class="font-label-md text-label-md font-semibold text-secondary">Tự động 100%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Mode Navigation Tabs -->
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-space-md p-1.5 bg-surface-container-low rounded-xl border border-border-subtle/60">
        <div class="flex items-center gap-space-xs p-1 bg-surface-container rounded-lg">
          <a href="#tu-dien" class="flex items-center gap-space-sm px-space-lg py-2 rounded-lg font-label-md text-label-md transition-all duration-200 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high no-underline" id="tab-btn-lookup">
            <span class="material-symbols-outlined text-[18px]">menu_book</span>
            <span>Tra cứu từ điển (辭典檢索)</span>
          </a>
          <a href="#nhap" class="flex items-center gap-space-sm px-space-lg py-2 rounded-lg font-label-md text-label-md transition-all duration-200 bg-paper-card text-primary shadow-sm font-semibold no-underline" id="tab-btn-import">
            <span class="material-symbols-outlined text-[18px]">post_add</span>
            <span>Nhập từ hàng loạt &amp; Hộp thư (批量錄入)</span>
            <span class="px-1.5 py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-[10px]">Mới</span>
          </a>
        </div>
        <div class="flex items-center gap-space-sm px-space-md text-on-surface-variant font-label-sm text-label-sm">
          <span class="material-symbols-outlined text-[16px]">sync_alt</span>
          <span>Vừa nhập vừa học: <strong>Đồng bộ thẳng vào Flashcard SRS</strong></span>
        </div>
      </div>

      <!-- ================= STITCH BATCH IMPORT CENTER (Exact Stitch Mode 2) ================= -->
      <div class="flex flex-col gap-space-xl" id="section-import">
        <!-- Import Header Info Banner -->
        <div class="bg-paper-card p-space-lg rounded-2xl border border-border-subtle/70 shadow-sm flex flex-col md:flex-row items-center justify-between gap-space-lg">
          <div class="flex items-center gap-space-md">
            <div class="w-12 h-12 rounded-xl bg-cinnabar-subtle text-primary flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-[26px]">library_add</span>
            </div>
            <div class="flex flex-col">
              <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Trung tâm Nạp dữ liệu Học tập Thông minh</h2>
              <p class="font-body-md text-body-md text-on-surface-variant">Nhập nhanh 1 từ hoặc dán danh sách nhiều từ để tự động trích xuất Pinyin, nghĩa tiếng Việt và đưa vào lịch học SRS.</p>
            </div>
          </div>
          <div class="flex items-center gap-space-xs self-stretch md:self-auto">
            <span class="px-space-md py-1.5 rounded-lg bg-surface-container text-on-surface font-label-sm text-label-sm flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px] text-secondary">verified</span>
              Trợ lý Từ điển Phồn thể Đài Loan sẵn sàng
            </span>
          </div>
        </div>

        <!-- 4 Multiple Ingestion Pathways (Exact Stitch) -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-space-md">
          <button type="button" class="p-space-md rounded-xl bg-paper-card text-left shadow-sm hover:shadow-md transition-all flex flex-col gap-space-xs border-2 border-primary" id="btn-path-paste">
            <span class="material-symbols-outlined text-primary text-[24px]">content_paste</span>
            <span class="font-label-md text-label-md font-semibold text-on-surface">Nhập nhanh &amp; Dán văn bản</span>
            <span class="font-body-sm text-body-sm text-on-surface-variant">Hán tự, Pinyin, hoặc nghĩa Việt tự do</span>
          </button>
          <button type="button" class="p-space-md rounded-xl bg-paper-card border border-border-subtle/70 text-left shadow-sm hover:shadow-md transition-all flex flex-col gap-space-xs opacity-85 hover:opacity-100" onclick="$('#batch-textarea')?.focus()">
            <span class="material-symbols-outlined text-secondary text-[24px]">folder_zip</span>
            <span class="font-label-md text-label-md font-semibold text-on-surface">Danh sách từ hàng loạt</span>
            <span class="font-body-sm text-body-sm text-on-surface-variant">Nạp nhiều từ cùng lúc vào sổ tay</span>
          </button>
          <button type="button" class="p-space-md rounded-xl bg-paper-card border border-border-subtle/70 text-left shadow-sm hover:shadow-md transition-all flex flex-col gap-space-xs opacity-85 hover:opacity-100" onclick="$('#w')?.focus()">
            <span class="material-symbols-outlined text-tertiary text-[24px]">add_task</span>
            <span class="font-label-md text-label-md font-semibold text-on-surface">Ghi nhanh 1 từ mới</span>
            <span class="font-body-sm text-body-sm text-on-surface-variant">Kiểm tra trùng lặp TOCFL tức thì</span>
          </button>
          <button type="button" class="p-space-md rounded-xl bg-paper-card border border-border-subtle/70 text-left shadow-sm hover:shadow-md transition-all flex flex-col gap-space-xs opacity-85 hover:opacity-100" onclick="$('#ilist')?.scrollIntoView({behavior:'smooth'})">
            <span class="material-symbols-outlined text-outline text-[24px]">inbox</span>
            <span class="font-label-md text-label-md font-semibold text-on-surface">Hộp thư đã lưu (${S.inbox ? S.inbox.size : 0})</span>
            <span class="font-body-sm text-body-sm text-on-surface-variant">Quản lý &amp; bấm Học ngay từng từ</span>
          </button>
        </div>

        <!-- Quick Single-Word Input Card (Preserves #f, #w, #check, #where, #note, #save, #msg) -->
        <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
              <h2 class="font-headline-md text-lg font-bold text-on-surface">Nhập nhanh từ mới &amp; Đồng bộ Lịch học</h2>
            </div>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-jade-subtle text-secondary font-semibold">Tự động tạo thẻ Nhận diện · Nghe · Viết · Điền từ</span>
          </div>

          <form class="flex flex-col gap-space-md" id="f" autocomplete="off">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <label class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold text-on-surface-variant">Từ mới (chữ Phồn thể):</span>
                <input id="w" class="w-full p-3 rounded-xl bg-paper-base border border-border-subtle text-xl font-serif text-on-surface focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary/20" placeholder="Ví dụ：機會, 買單, 捷運..." maxlength="16">
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold text-on-surface-variant">Gặp ở đâu (ngữ cảnh):</span>
                <input id="where" placeholder="Podcast, lớp học, phim Đài Loan..." maxlength="60" class="w-full p-3 rounded-xl bg-paper-base border border-border-subtle text-sm text-on-surface">
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold text-on-surface-variant">Ghi chú thêm / Nghĩa tiếng Việt:</span>
                <input id="note" placeholder="Ý nghĩa trong tình huống này..." maxlength="200" class="w-full p-3 rounded-xl bg-paper-base border border-border-subtle text-sm text-on-surface">
              </label>
            </div>

            <div class="p-3 rounded-xl bg-surface-container-low border border-border-subtle text-xs text-outline font-medium" id="check">
              Gõ một từ chữ Hán Phồn thể để kiểm tra với kho dữ liệu TOCFL &amp; Từ điển.
            </div>

            <div class="flex items-center justify-between pt-1 flex-wrap gap-2">
              <div class="text-xs font-semibold" id="msg"></div>
              <button class="px-6 py-2.5 rounded-xl bg-primary-container text-white font-semibold text-xs hover:bg-primary transition-colors shadow-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5" id="save" type="submit" disabled>
                <span class="material-symbols-outlined text-[16px]">add_task</span>
                <span>Lưu &amp; Đồng bộ vào Lịch học</span>
              </button>
            </div>
          </form>
        </div>

        <!-- Main Batch Ingestion Workspace (Exact Stitch 6+6 Cols) -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-xl">
          <!-- Left Editor Box (6 cols) -->
          <div class="lg:col-span-6 flex flex-col gap-space-md bg-paper-card p-space-xl rounded-2xl border border-border-subtle/70 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-space-xs">
                <span class="w-1.5 h-3.5 rounded-full bg-primary"></span>
                <span class="font-label-md text-label-md font-semibold text-on-surface">Khung nhập liệu văn bản hàng loạt</span>
              </div>
              <div class="flex items-center gap-space-xs">
                <button type="button" class="text-primary hover:underline font-label-sm text-label-sm" id="btn-batch-sample">
                  Điền mẫu ví dụ
                </button>
                <span class="text-surface-container-high">•</span>
                <button type="button" class="text-outline hover:text-on-surface font-label-sm text-label-sm" id="btn-batch-clear">
                  Xóa trắng
                </button>
              </div>
            </div>
            <div class="relative flex-1">
              <textarea class="w-full h-full min-h-[200px] p-space-md rounded-xl bg-paper-base border border-border-subtle text-on-surface font-body-md text-body-md focus:outline-none placeholder:text-outline/60 resize-y leading-relaxed" id="batch-textarea" rows="8" placeholder="Dán danh sách từ của bạn vào đây (mỗi dòng 1 từ)...">1. 斟酌 (zhēnzhuó) - cân nhắc kỹ lưỡng
2. 繁體字 (fántǐzì) - Chữ Hán Phồn thể
3. 莫名其妙 (mòmíngqímiào) - kỳ quặc, không hiểu nổi
4. 絡繹不絕 (luòyìbùjué) - tấp nập không dứt</textarea>
            </div>
            <div class="flex items-center justify-between pt-space-xs">
              <span class="font-body-sm text-body-sm text-outline" id="batch-detect-count">Đã phát hiện: <strong>4 mục từ hợp lệ</strong></span>
              <button type="button" class="px-space-lg py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold transition-all shadow-sm flex items-center gap-2" id="btn-batch-parse">
                <span class="material-symbols-outlined text-[18px]">neurology</span>
                <span>Chuẩn hóa &amp; Xem trước</span>
              </button>
            </div>
          </div>

          <!-- Right Preview & Validation Table (6 cols) -->
          <div class="lg:col-span-6 flex flex-col gap-space-md bg-paper-card p-space-xl rounded-2xl border border-border-subtle/70 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-space-xs">
                <span class="w-1.5 h-3.5 rounded-full bg-secondary"></span>
                <span class="font-label-md text-label-md font-semibold text-on-surface" id="batch-preview-title">Kết quả chuẩn hóa</span>
              </div>
              <span class="px-2 py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-label-sm font-medium">Sẵn sàng nhập sổ</span>
            </div>
            <div class="overflow-x-auto rounded-xl bg-paper-base border border-border-subtle/60 flex-1">
              <table class="w-full text-left font-body-sm text-body-sm">
                <thead class="bg-surface-container font-label-sm text-label-sm text-on-surface-variant">
                  <tr>
                    <th class="p-space-sm pl-space-md">Chữ Phồn thể</th>
                    <th class="p-space-sm">Phiên âm</th>
                    <th class="p-space-sm">Nghĩa tiếng Việt</th>
                    <th class="p-space-sm pr-space-md text-right">TOCFL</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-high/40 text-on-surface" id="batch-preview-tbody"></tbody>
              </table>
            </div>
            <div class="flex flex-col gap-space-sm pt-space-xs">
              <div class="flex items-center justify-between text-body-sm">
                <span class="text-on-surface-variant font-label-sm text-label-sm">Thư mục nhận dữ liệu:</span>
                <span class="font-medium text-primary">Hộp thư &amp; Thư mục của tôi (Đồng bộ SRS)</span>
              </div>
              <button type="button" class="w-full py-3 rounded-xl bg-secondary hover:bg-secondary/90 text-on-secondary font-label-md text-label-md font-semibold transition-all shadow-md flex items-center justify-center gap-2" id="btn-batch-commit">
                <span class="material-symbols-outlined text-[20px]">archive</span>
                <span id="btn-batch-commit-label">Xác nhận nạp tất cả vào sổ tay</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Imported Words List in Inbox (#ilist) -->
        <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <h2 class="font-headline-lg text-lg font-bold text-on-surface">Từ đã nhập trong Hộp thư (<span id="inbox-count">${S.inbox ? S.inbox.size : 0}</span>)</h2>
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-jade-subtle text-secondary border border-secondary/20">Tự động đồng bộ với Chỗ học</span>
            </div>
            <span class="text-xs text-outline">Lưu trữ trên thiết bị &amp; tự động đồng bộ qua đám mây</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md" id="ilist"></div>
        </div>
      </div>
    </div>
  `);

  const check = () => {
    const w = clean($("#w").value), box = $("#check"), btn = $("#save");
    btn.disabled = true;
    box.className = "p-3 rounded-xl bg-surface-container-low border border-border-subtle text-xs font-medium";
    if (!w) { box.textContent = "Gõ một từ để kiểm tra."; return null; }
    if (!/^[㐀-鿿豈-﫿]+$/.test(w)) {
      box.className = "p-3 rounded-xl bg-cinnabar-subtle border border-primary/30 text-xs font-medium text-primary";
      box.textContent = "Chỉ nhập chữ Hán Phồn thể chuẩn.";
      return null;
    }
    const n = S.noteByWord.get(w);
    const e = cedFirst(w);
    btn.disabled = false;
    if (S.inbox && [...S.inbox.values()].some((x) => x.w === w)) {
      box.className = "p-3 rounded-xl bg-amber-subtle border border-amber-subtle text-xs font-medium text-tertiary";
      box.textContent = "Bạn đã nhập từ này vào Hộp thư rồi. Từ đã được đưa vào hàng đợi học.";
      btn.disabled = true;
      return null;
    }
    if (n) {
      box.className = "p-3 rounded-xl bg-jade-subtle border border-secondary/30 text-xs font-medium text-secondary";
      box.innerHTML = `✓ Từ này đã có trong bảng chuẩn <strong>TOCFL ${esc(bandsOf(n).join(" · ") || "")}</strong>: <span class="font-serif font-bold">${esc(n.w)}</span> (${esc(itemOf(n).py)}) — ${esc(meaningOf(n))}. Bấm lưu để kích hoạt vào lịch ôn ngay.`;
      return { n, w };
    }
    if (e) {
      box.className = "p-3 rounded-xl bg-surface-container text-xs font-medium text-on-surface";
      box.innerHTML = `Chưa có trong TOCFL, nhưng có trong CC-CEDICT: <span class="font-serif font-bold">${esc(w)}</span> (${esc(e[0][0])}) — ${esc(e[0][1].split("/").join("; "))}. Sẽ tạo thẻ học và đồng bộ ngay.`;
      return { w, py: e[0][0], en: e[0][1].split("/").join("; ") };
    }
    box.className = "p-3 rounded-xl bg-surface-container-low border border-border-subtle text-xs font-medium text-outline";
    box.textContent = "Từ mới hoàn toàn (chưa có trong bảng TOCFL và CC-CEDICT). Bạn có thể ghi chú thêm nghĩa bên dưới, hệ thống sẽ tạo thẻ Flashcard chuẩn để học.";
    return { w };
  };

  $("#w").oninput = check;

  const drawInbox = () => {
    const list = $("#ilist");
    const countEl = $("#inbox-count");
    if (countEl) countEl.textContent = S.inbox ? S.inbox.size : 0;
    if (!list) return;
    const items = S.inbox ? [...S.inbox.values()].sort((a, b) => b.at - a.at) : [];
    if (!items.length) {
      list.innerHTML = `<div class="col-span-full p-8 text-center text-xs text-outline bg-surface-container-low/50 rounded-2xl border border-dashed border-border-subtle">Chưa có từ nào trong Hộp thư. Nhập từ mới ở trên để vừa lưu, vừa học và đồng bộ ngay vào lịch ôn nhé.</div>`;
      return;
    }

    const lvBadgeColors = [
      "bg-surface-container text-outline border-border-subtle",
      "bg-cinnabar-subtle text-primary border-cinnabar-subtle",
      "bg-amber-subtle text-tertiary border-amber-subtle",
      "bg-sky-50 text-sky-700 border-sky-200",
      "bg-jade-subtle text-secondary border-jade-subtle",
      "bg-purple-50 text-purple-700 border-purple-200"
    ];

    list.innerHTML = items.map((it) => {
      let n = S.noteByWord.get(it.w);
      if (!n && typeof syncInboxWordToLearning === "function") {
        n = syncInboxWordToLearning(it, false);
      }
      const lvl = n ? noteLevel(n) : 0;
      const isDue = n && typesOf(n).some(([t]) => {
        const s = S.srs.get(cardId(n, t));
        return s && s.due <= Date.now();
      });

      const displayMeaning = it.note || (n ? meaningOf(n) : "");

      return `
        <div class="p-4 rounded-2xl bg-surface-container-low border border-border-subtle hover:border-primary/40 transition-all flex flex-col justify-between gap-3 shadow-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-col min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <a href="#tu/${encodeURIComponent(it.w)}" class="font-serif font-bold text-xl text-on-surface hover:text-primary transition-colors no-underline">${esc(it.w)}</a>
                ${it.py ? `<span class="font-code text-xs text-tertiary font-medium bg-amber-subtle/50 px-2 py-0.5 rounded-md border border-amber-subtle/40">${esc(it.py)}</span>` : ""}
                <button type="button" class="text-secondary hover:text-primary transition-colors p-1 rounded-lg hover:bg-white" onclick="say('${esc(it.w)}')" title="Nghe phát âm">
                  <span class="material-symbols-outlined text-[18px]">volume_up</span>
                </button>
              </div>
              ${it.where ? `<div class="text-[11px] text-outline mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">location_on</span><span>Gặp ở: ${esc(it.where)}</span></div>` : ""}
              ${displayMeaning ? `<div class="text-xs text-on-surface-variant font-medium mt-1 line-clamp-2">${esc(displayMeaning)}</div>` : ""}
            </div>
            <button type="button" class="text-xs text-outline hover:text-primary transition-colors p-1 rounded-lg hover:bg-white shrink-0" data-del-inbox="${esc(it.id)}" title="Xóa khỏi Hộp thư">
              <span class="material-symbols-outlined text-[16px]">delete</span>
            </button>
          </div>

          <div class="pt-2.5 border-t border-border-subtle/60 flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border ${lvBadgeColors[lvl]}">
                ${esc(LEVELS[lvl])}
              </span>
              ${isDue ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cinnabar-subtle text-primary border border-cinnabar-subtle">Đến hạn ôn</span>` : ""}
            </div>

            <div class="flex items-center gap-2">
              <select class="text-[11px] font-medium bg-white border border-border-subtle rounded-lg px-2 py-1 text-on-surface focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer" data-change-lvl="${esc(it.w)}" title="Đổi mức nhớ cho từ này">
                ${LEVELS.map((label, idx) => `<option value="${idx}"${lvl === idx ? " selected" : ""}>${esc(label)}</option>`).join("")}
              </select>
              <button type="button" class="px-3 py-1 rounded-lg bg-primary-container text-white font-semibold text-xs hover:bg-primary transition-colors shadow-xs flex items-center gap-1" data-study-word="${esc(it.w)}" title="Bắt đầu học ngay với Flashcard của từ này">
                <span class="material-symbols-outlined text-[15px]">play_circle</span>
                <span>Học ngay</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    list.querySelectorAll("[data-del-inbox]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delInbox;
        const it = S.inbox.get(id);
        const w = it ? it.w : "";
        if (!confirm(`Bạn có chắc muốn xóa từ "${w}" khỏi Hộp thư không?`)) return;
        S.inbox.delete(id);
        await Store.del("inbox", id);
        drawInbox();
        updateBadge();
      };
    });

    list.querySelectorAll("[data-study-word]").forEach((btn) => {
      btn.onclick = () => {
        const w = btn.dataset.studyWord;
        if (typeof window.startStudyWord === "function") window.startStudyWord(w);
        else location.hash = "#hoc";
      };
    });

    list.querySelectorAll("[data-change-lvl]").forEach((sel) => {
      sel.onchange = async () => {
        const w = sel.dataset.changeLvl;
        const newLvl = Number(sel.value);
        const n = S.noteByWord.get(w);
        if (n && typeof applyWordLevel === "function") {
          sel.disabled = true;
          try {
            await applyWordLevel(n, newLvl);
            drawInbox();
          } finally {
            sel.disabled = false;
          }
        }
      };
    });
  };

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const c = check();
    if (!c) return;
    const id = "inbox~" + Date.now();
    const entry = {
      id,
      w: c.w,
      py: c.py || (c.n ? itemOf(c.n).py : ""),
      where: clean($("#where").value),
      note: clean($("#note").value),
      at: Date.now()
    };
    await Store.put("inbox", id, entry);
    if (!S.inbox) S.inbox = new Map();
    S.inbox.set(id, entry);

    if (typeof syncInboxWordToLearning === "function") {
      syncInboxWordToLearning(entry, true);
    }

    $("#w").value = "";
    $("#where").value = "";
    $("#note").value = "";
    $("#msg").innerHTML = `<span class="inline-flex items-center gap-1.5 text-secondary font-semibold"><span class="material-symbols-outlined text-[16px]">check_circle</span> Đã lưu từ "${esc(c.w)}" vào Hộp thư &amp; đồng bộ ngay vào hàng đợi Học/Ôn tập!</span>`;
    setTimeout(() => {
      const m = $("#msg");
      if (m) m.innerHTML = "";
    }, 5000);
    check();
    drawInbox();
  };

  // Batch Parser & Commit Logic (Mode 2)
  let parsedBatch = [];
  const parseBatchLines = () => {
    const raw = $("#batch-textarea")?.value || "";
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    parsedBatch = [];
    for (const line of lines) {
      const mHan = line.match(/[㐀-鿿豈-﫿]+/);
      if (!mHan) continue;
      const w = mHan[0];
      const n = S.noteByWord.get(w);
      const e = cedFirst(w);
      let rest = line.replace(/^\d+[\.\)\s-]*/, "").replace(w, "").trim();
      let py = n ? itemOf(n).py : (e ? e[0][0] : "");
      const mPy = rest.match(/\(([^)]+)\)/);
      if (mPy) {
        if (!py) py = mPy[1].trim();
        rest = rest.replace(mPy[0], "").trim();
      }
      rest = rest.replace(/^[-–—:]+/, "").trim();
      const vn = rest || (n ? meaningOf(n) : (e ? e[0][1].split("/").join("; ") : "Từ vựng bổ sung"));
      const band = n ? (bandsOf(n)[0] || "B1") : "Cá nhân";
      parsedBatch.push({ w, py, vn, band });
    }
    const cntEl = $("#batch-detect-count");
    if (cntEl) cntEl.innerHTML = `Đã phát hiện: <strong>${parsedBatch.length} mục từ hợp lệ</strong>`;
    const titleEl = $("#batch-preview-title");
    if (titleEl) titleEl.textContent = `Kết quả chuẩn hóa (${parsedBatch.length} mục)`;
    const btnLbl = $("#btn-batch-commit-label");
    if (btnLbl) btnLbl.textContent = `Xác nhận nạp tất cả ${parsedBatch.length} từ vào sổ tay`;
    const tbody = $("#batch-preview-tbody");
    if (tbody) {
      tbody.innerHTML = parsedBatch.map((it) => `
        <tr class="hover:bg-paper-card transition-colors">
          <td class="p-space-sm pl-space-md font-display text-body-lg font-semibold text-primary">${esc(it.w)}</td>
          <td class="p-space-sm font-code text-xs text-tertiary">${esc(it.py || "—")}</td>
          <td class="p-space-sm text-xs text-on-surface">${esc(it.vn)}</td>
          <td class="p-space-sm pr-space-md text-right">
            <span class="px-1.5 py-0.5 rounded bg-amber-subtle text-tertiary font-label-sm text-[10px]">${esc(it.band)}</span>
          </td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="p-4 text-center text-xs text-outline">Chưa có dòng chữ Hán nào hợp lệ.</td></tr>`;
    }
  };

  parseBatchLines();
  const batchTa = $("#batch-textarea");
  if (batchTa) batchTa.oninput = parseBatchLines;
  const btnParse = $("#btn-batch-parse");
  if (btnParse) btnParse.onclick = parseBatchLines;
  const btnSample = $("#btn-batch-sample");
  if (btnSample) {
    btnSample.onclick = () => {
      if (batchTa) {
        batchTa.value = "1. 璀璨 (cuǐcàn) - rực rỡ lấp lánh\n2. 靦腆 (miǎntiǎn) - bẽn lẽn, e ấp\n3. 奮鬥 (fèndòu) - phấn đấu kiên trì\n4. 絡繹不絕 (luòyìbùjué) - nườm nượp không ngớt";
        parseBatchLines();
      }
    };
  }
  const btnClear = $("#btn-batch-clear");
  if (btnClear) {
    btnClear.onclick = () => {
      if (batchTa) {
        batchTa.value = "";
        batchTa.focus();
        parseBatchLines();
      }
    };
  }
  const btnCommit = $("#btn-batch-commit");
  if (btnCommit) {
    btnCommit.onclick = async () => {
      if (!parsedBatch.length) return;
      if (!S.inbox) S.inbox = new Map();
      for (const item of parsedBatch) {
        const id = "inbox~" + item.w;
        const entry = {
          id,
          w: item.w,
          py: item.py,
          where: "Nhập hàng loạt",
          note: item.vn,
          at: Date.now()
        };
        S.inbox.set(id, entry);
        try { await Store.put("inbox", id, entry); } catch (err) {}
        if (typeof syncInboxWordToLearning === "function") {
          syncInboxWordToLearning(entry, true);
        }
      }
      drawInbox();
      if (typeof updateBadge === "function") updateBadge();
      const lbl = $("#btn-batch-commit-label");
      if (lbl) lbl.textContent = `✓ Đã nạp thành công ${parsedBatch.length} từ vào Hộp thư & SRS!`;
    };
  }

  drawInbox();
};

// =========================================================================
// 9. CÀI ĐẶT HỆ THỐNG & HỌC TẬP (Exact Stitch Design)
// =========================================================================
VIEWS["cai-dat"] = () => {
  const syncCfg = window.Sync ? Sync.getConfig() : {};
  const isConnected = window.Sync && Sync.isConfigured();
  const vocab = S.notes.filter((n) => n.kind === "vocab");
  const curTheme = (document.documentElement && document.documentElement.getAttribute ? document.documentElement.getAttribute("data-theme") : "light") || "light";

  // Build folder checkboxes list for Section 2 ("THƯ MỤC ĐANG HỌC")
  const deckCheckboxes = [
    ...S.decks.map((d) => ({
      id: d.id,
      isBand: false,
      label: d.name,
      count: folderNotes(d.id).length,
      on: folderOn(d.id)
    })),
    ...S.bands.map((b) => ({
      id: b,
      isBand: true,
      label: `TOCFL ${b} (cả band)`,
      count: vocab.filter((n) => inBand(n, b)).length,
      on: !!S.settings.bands[b]
    }))
  ];

  setView(`
    <div class="w-full max-w-4xl mx-auto px-margin py-space-xl flex flex-col gap-space-xl">
      <!-- Page Header & Overview Banner (Exact Stitch) -->
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-space-xs">
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-center gap-space-sm">
            <span class="inline-flex items-center px-space-xs py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-label-sm font-semibold tracking-wide">
              CẤU HÌNH HỆ THỐNG
            </span>
            <span class="text-outline-variant font-label-sm text-label-sm">•</span>
            <span class="font-label-sm text-label-sm text-on-surface-variant font-medium">Bản cập nhật v31.0</span>
          </div>
          <h1 class="font-headline-lg text-headline-lg md:text-display text-on-surface font-semibold tracking-tight">
            Cài đặt hệ thống &amp; Học tập
          </h1>
          <p class="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Quản lý đồng bộ dữ liệu đa thiết bị, mục tiêu thẻ nhớ hàng ngày và cá nhân hóa giọng đọc chuẩn Đài Loan (TOCFL).
          </p>
        </div>
        <!-- Quick Metrics Pill -->
        <div class="flex items-center gap-space-sm bg-surface-container-low border border-border-subtle/60 p-space-sm rounded-xl">
          <div class="w-9 h-9 rounded-lg bg-cinnabar-subtle flex items-center justify-center text-primary">
            <span class="material-symbols-outlined text-[20px]">style</span>
          </div>
          <div class="flex flex-col pr-space-sm">
            <span class="font-label-sm text-label-sm text-on-surface-variant">Tổng thẻ lưu trữ</span>
            <span class="font-headline-md text-headline-md text-on-surface font-bold">${fmt(vocab.length)} <span class="font-body-sm text-body-sm font-normal text-outline">từ</span></span>
          </div>
        </div>
      </div>

      <!-- SECTION 1: Đồng bộ giữa các máy (Exact Stitch) -->
      <section class="bg-paper-card rounded-xl p-space-lg border border-border-subtle/70 shadow-sm flex flex-col gap-space-lg">
        <div class="flex items-start justify-between gap-space-md">
          <div class="flex items-center gap-space-sm flex-wrap">
            <span class="w-1 h-5 rounded-full bg-primary inline-block"></span>
            <h2 class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              Đồng bộ giữa các máy
            </h2>
            <span class="inline-flex items-center gap-1 px-space-xs py-0.5 rounded-full ${isConnected ? "bg-jade-subtle text-secondary" : "bg-surface-container-highest text-on-surface-variant"} font-label-sm text-label-sm font-medium" id="syncStatusBadge">
              <span class="w-1.5 h-1.5 rounded-full ${isConnected ? "bg-secondary" : "bg-outline"}"></span>
              ${isConnected ? "Đã kết nối Đám mây" : "Chưa kết nối"}
            </span>
          </div>
        </div>
        <p class="font-body-md text-body-md text-on-surface-variant">
          Mặc định tiến độ chỉ lưu trong trình duyệt của từng máy. Để <strong class="text-on-surface font-medium">học trên điện thoại và máy tính luôn đồng bộ cùng tiến độ với nhau</strong>, bạn có thể chọn một trong hai cách dưới đây:
        </p>

        <!-- Sync Method 1: Cloud Sync (GitHub Gist) -->
        <div class="bg-surface-container-low rounded-xl p-space-md md:p-space-lg border border-border-subtle/50 flex flex-col gap-space-md relative overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-space-xs">
            <div class="flex items-center gap-space-sm">
              <span class="material-symbols-outlined text-secondary text-[22px]">cloud_sync</span>
              <span class="font-headline-md text-headline-md text-on-surface font-semibold">Cách 1: Tự động qua Đám mây (Khuyên dùng)</span>
            </div>
            <span class="inline-flex items-center px-space-sm py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-semibold">
              Tự động 2 chiều
            </span>
          </div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">
            Tiến độ tự động đồng bộ ngầm lên GitHub Gist cá nhân của bạn mỗi khi học xong thẻ hoặc mở trang. Không bao giờ lo mất dữ liệu.
          </p>
          <!-- GitHub Token Input -->
          <div class="flex flex-col gap-space-xs">
            <div class="flex items-center justify-between">
              <label class="font-label-md text-label-md text-on-surface font-semibold" for="ghToken">GitHub Personal Access Token:</label>
              <span class="font-label-sm text-label-sm text-secondary font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-[14px]">shield</span> Mã hóa an toàn nội bộ
              </span>
            </div>
            <div class="relative flex items-center">
              <input class="w-full bg-paper-card border border-border-subtle text-on-surface px-space-md py-2.5 rounded-lg font-code text-code placeholder:text-outline/60 focus:outline-none focus:bg-surface-bright transition-all" id="ghToken" placeholder="ghp_xxxxxxxxxxxx hoặc github_pat_xxxxxxxxxxxx" type="password" value="${esc(syncCfg.token || "")}">
              <button class="absolute right-3 text-outline hover:text-on-surface transition-colors" id="btnToggleTokenVis" title="Hiển thị token" type="button">
                <span class="material-symbols-outlined text-[18px]">visibility_off</span>
              </button>
            </div>
            <div class="flex items-center gap-space-xs text-on-surface-variant font-body-sm text-body-sm pt-0.5 flex-wrap">
              <span class="text-tertiary">👉</span>
              <span>Bạn đã có tài khoản GitHub?</span>
              <a class="text-primary font-medium hover:underline inline-flex items-center gap-0.5" href="https://github.com/settings/tokens" rel="noopener noreferrer" target="_blank">
                Bấm vào đây để tạo Token nhanh trên GitHub
                <span class="material-symbols-outlined text-[13px]">open_in_new</span>
              </a>
              <span class="text-outline font-body-sm text-body-sm">(chọn quyền <code class="font-code text-code px-1 py-0.5 bg-surface-container rounded text-primary">gist</code>, bấm Generate rồi dán vào đây).</span>
            </div>
          </div>
          <!-- Gist ID Input -->
          <div class="flex flex-col gap-space-xs">
            <label class="font-label-md text-label-md text-on-surface font-semibold" for="ghGistId">Gist ID đang dùng trên máy khác (nếu có):</label>
            <input class="w-full bg-paper-card border border-border-subtle text-on-surface px-space-md py-2.5 rounded-lg font-code text-code placeholder:text-outline/60 focus:outline-none focus:bg-surface-bright transition-all" id="ghGistId" placeholder="Để trống nếu đây là máy đầu tiên cài đặt, hệ thống sẽ tự khởi tạo..." type="text" value="${esc(syncCfg.gistId || "")}">
          </div>
          <div class="pt-space-xs flex items-center justify-between flex-wrap gap-2">
            <span class="text-xs text-secondary font-semibold" id="gistMsg"></span>
            <div class="flex items-center gap-2 flex-wrap">
              ${isConnected ? `
                <button class="px-space-md py-2.5 rounded-lg bg-paper-card border border-border-subtle text-outline hover:text-primary font-label-md text-label-md font-semibold transition-all" id="btnDisconnectSync" type="button">
                  Ngắt kết nối
                </button>
              ` : ""}
              <button class="px-space-md py-2.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface font-label-md text-label-md font-semibold hover:bg-surface-container transition-all" id="btnTestSync" type="button">
                Kiểm tra kết nối
              </button>
              <button class="inline-flex items-center gap-space-xs px-space-lg py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold hover:bg-primary-container transition-all shadow-sm" id="btnSaveSync" type="button">
                <span class="material-symbols-outlined text-[18px]">cloud_upload</span>
                <span>Kết nối đám mây</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Sync Method 2: Quick Code Sync -->
        <div class="bg-surface-container-low rounded-xl p-space-md md:p-space-lg border border-border-subtle/50 flex flex-col gap-space-md">
          <div class="flex flex-wrap items-center justify-between gap-space-xs">
            <div class="flex items-center gap-space-sm">
              <span class="material-symbols-outlined text-tertiary text-[22px]">swap_horiz</span>
              <span class="font-headline-md text-headline-md text-on-surface font-semibold">Cách 2: Đồng bộ nhanh bằng Mã (Không cần tài khoản)</span>
            </div>
            <span class="inline-flex items-center px-space-sm py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-label-sm text-label-sm font-medium">
              Thủ công 1 lần
            </span>
          </div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">
            Sao chép mã tiến độ từ máy tính rồi gửi qua Zalo/Tin nhắn, dán vào điện thoại để cập nhật ngay tức thì.
          </p>
          <div class="flex flex-wrap items-center gap-space-sm">
            <button class="inline-flex items-center gap-space-xs px-space-md py-2.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface font-label-md text-label-md font-medium hover:bg-surface-container-highest transition-colors shadow-sm" id="btnCopyFastCode" type="button">
              <span class="material-symbols-outlined text-[18px] text-primary">content_copy</span>
              <span>Sao chép mã tiến độ từ máy này</span>
            </button>
          </div>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-space-sm">
            <div class="relative flex-1">
              <input class="w-full bg-paper-card border border-border-subtle text-on-surface px-space-md py-2.5 rounded-lg font-code text-code placeholder:text-outline/60 focus:outline-none focus:bg-surface-bright transition-all" id="pasteFastCode" placeholder="Dán chuỗi mã tiến độ vào đây..." type="text">
            </div>
            <button class="px-space-lg py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold hover:bg-primary-container transition-colors shadow-sm whitespace-nowrap" id="btnApplyFastCode" type="button">
              Áp dụng mã
            </button>
          </div>
          <span class="text-xs text-secondary font-semibold" id="fastCodeMsg"></span>
        </div>
      </section>

      <!-- SECTION 2: Học mỗi ngày (Exact Stitch Daily Targets & Directory Subsets) -->
      <section class="bg-paper-card rounded-xl p-space-lg border border-border-subtle/70 shadow-sm flex flex-col gap-space-lg">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-space-sm">
            <span class="w-1 h-5 rounded-full bg-primary inline-block"></span>
            <h2 class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              Học mỗi ngày
            </h2>
          </div>
          <button type="button" class="px-4 py-2 rounded-lg bg-primary-container text-white text-xs font-semibold hover:bg-primary shadow-xs" id="btnSaveGoals">
            Lưu mục tiêu ngày
          </button>
        </div>

        <!-- Goal Presets Recommendation for Band B -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button type="button" class="btn-setting-preset p-3 rounded-xl border border-secondary/40 bg-jade-subtle text-secondary text-left text-xs font-medium hover:bg-secondary-fixed transition-all" data-preset-new="8" data-preset-rev="30">
            <div class="font-bold">🎯 Band B Khuyến nghị</div>
            <div class="text-[11px] opacity-85 mt-0.5">8 từ mới • 30 lượt ôn (15-25p/ngày)</div>
          </button>
          <button type="button" class="btn-setting-preset p-3 rounded-xl border border-border-subtle bg-surface-container-low text-on-surface text-left text-xs font-medium hover:bg-surface-container transition-all" data-preset-new="5" data-preset-rev="20">
            <div class="font-bold">🌱 Nhẹ nhàng duy trì</div>
            <div class="text-[11px] text-outline mt-0.5">5 từ mới • 20 lượt ôn (10-15p/ngày)</div>
          </button>
          <button type="button" class="btn-setting-preset p-3 rounded-xl border border-primary/30 bg-cinnabar-subtle text-primary text-left text-xs font-medium hover:bg-primary-container hover:text-white transition-all" data-preset-new="20" data-preset-rev="50">
            <div class="font-bold">🚀 Tăng tốc chuẩn</div>
            <div class="text-[11px] opacity-85 mt-0.5">20 từ mới • 50 lượt ôn (35-45p/ngày)</div>
          </button>
        </div>

        <!-- Daily Quota Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-space-lg">
          <div class="flex flex-col gap-space-xs bg-surface-container-low p-space-md rounded-xl border border-border-subtle/50">
            <label class="font-label-md text-label-md text-on-surface font-semibold" for="setNewPerDay">Số thẻ mới mỗi ngày</label>
            <input type="number" id="setNewPerDay" min="1" max="200" value="${S.settings.newPerDay || 8}" class="w-full bg-paper-card border border-border-subtle text-on-surface font-code font-bold text-base py-2 px-space-md rounded-lg focus:outline-none">
            <p class="font-body-sm text-body-sm text-on-surface-variant pt-1">
              Mỗi từ có 4 kỹ năng (Đọc, Nghe, Viết, Dùng trong câu). Ngày đầu gặp thẻ nhận diện, các thẻ còn lại mở dần theo SRS.
            </p>
          </div>
          <div class="flex flex-col gap-space-xs bg-surface-container-low p-space-md rounded-xl border border-border-subtle/50">
            <label class="font-label-md text-label-md text-on-surface font-semibold" for="setRevPerDay">Số thẻ ôn mỗi ngày</label>
            <input type="number" id="setRevPerDay" min="5" max="500" value="${S.settings.reviewPerDay || 30}" class="w-full bg-paper-card border border-border-subtle text-on-surface font-code font-bold text-base py-2 px-space-md rounded-lg focus:outline-none">
            <p class="font-body-sm text-body-sm text-on-surface-variant pt-1">
              Mục tiêu số lượt ôn lại thẻ đã học trong ngày để tính tiến độ lộ trình chuẩn TOCFL.
            </p>
          </div>
        </div>

        <!-- Categories & Folders List (Exact Stitch 3-col checkbox grid) -->
        <div class="flex flex-col gap-space-md pt-space-xs">
          <div class="flex items-center justify-between">
            <span class="font-label-sm text-label-sm text-outline font-bold tracking-wider uppercase">
              THƯ MỤC ĐANG HỌC
            </span>
            <button class="font-label-sm text-label-sm text-primary font-semibold hover:underline" id="btnSelectAllBands" type="button">
              Bật tất cả TOCFL
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-sm" id="settingsFolderGrid">
            ${deckCheckboxes.map((f) => `
              <label class="flex items-center justify-between p-space-sm rounded-lg ${f.on ? "bg-cinnabar-subtle" : "bg-surface-container-low"} cursor-pointer hover:bg-surface-container transition-colors">
                <div class="flex items-center gap-space-sm min-w-0">
                  <input ${f.on ? "checked" : ""} class="w-4 h-4 rounded text-primary focus:ring-0 accent-primary shrink-0" type="checkbox" data-folder-chk="${esc(f.id)}" data-is-band="${f.isBand ? "1" : "0"}">
                  <span class="font-body-md text-body-md ${f.on ? "text-on-surface font-medium" : "text-on-surface-variant"} truncate">${esc(f.label)}</span>
                </div>
                <span class="font-code text-code ${f.on ? "text-primary font-semibold" : "text-outline"} ml-2">${fmt(f.count)}</span>
              </label>
            `).join("")}
          </div>
        </div>
      </section>

      <!-- SECTION 3: Giao diện & Hiển thị (Exact Stitch) -->
      <section class="bg-paper-card rounded-xl p-space-lg border border-border-subtle/70 shadow-sm flex flex-col gap-space-lg">
        <div class="flex items-center gap-space-sm">
          <span class="w-1 h-5 rounded-full bg-primary inline-block"></span>
          <h2 class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
            Giao diện
          </h2>
        </div>
        <div class="flex flex-col gap-space-md">
          <div class="flex flex-col gap-space-xs max-w-md">
            <label class="font-label-md text-label-md text-on-surface font-semibold" for="theme-preset">Màu nền</label>
            <div class="relative">
              <select class="w-full bg-surface-container-low border border-border-subtle text-on-surface font-body-md text-body-md py-2.5 px-space-md rounded-lg appearance-none cursor-pointer focus:outline-none" id="theme-preset">
                <option value="light" ${curTheme !== "dark" ? "selected" : ""}>Sáng (giấy tuyên, son đỏ, ngọc bích)</option>
                <option value="dark" ${curTheme === "dark" ? "selected" : ""}>Tối (mực đen, ngọc bích dịu mắt)</option>
              </select>
              <span class="material-symbols-outlined text-[18px] text-outline absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
            </div>
          </div>
          <!-- Pinyin Display Toggle with Live Preview -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-md p-space-md bg-surface-container-low rounded-xl border border-border-subtle/50">
            <label class="flex items-start sm:items-center gap-space-sm cursor-pointer select-none">
              <input type="checkbox" id="setRuby" ${S.settings.ruby !== false ? "checked" : ""} class="w-4 h-4 rounded text-primary focus:ring-0 accent-primary mt-1 sm:mt-0">
              <div class="flex flex-col">
                <span class="font-body-md text-body-md text-on-surface font-medium">Hiện pinyin phía trên chữ Hán trong phần giải thích</span>
                <span class="font-body-sm text-body-sm text-on-surface-variant">Hiển thị ngữ âm bính âm kèm theo thanh điệu cho các cụm ví dụ và phân tích</span>
              </div>
            </label>
            <!-- Elegant Hanzi Preview Pill -->
            <div class="flex items-center gap-2 px-space-md py-2 rounded-lg bg-paper-card shadow-sm self-start sm:self-center">
              <span class="font-label-sm text-label-sm text-outline">Ví dụ:</span>
              <ruby class="font-headline-md text-headline-md text-primary font-semibold">
                學<rt class="font-code text-[10px] text-on-surface-variant font-normal tracking-tight">xué</rt>
                習<rt class="font-code text-[10px] text-on-surface-variant font-normal tracking-tight">xí</rt>
                本<rt class="font-code text-[10px] text-on-surface-variant font-normal tracking-tight">běn</rt>
              </ruby>
            </div>
          </div>
        </div>
      </section>

      <!-- SECTION 4: Giọng đọc phát âm (Exact Stitch) -->
      <section class="bg-paper-card rounded-xl p-space-lg border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
        <div class="flex items-center gap-space-sm">
          <span class="w-1 h-5 rounded-full bg-primary inline-block"></span>
          <h2 class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
            Giọng đọc
          </h2>
        </div>
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md">
          <div class="flex items-start gap-space-sm max-w-2xl">
            <span class="material-symbols-outlined text-secondary text-[20px] mt-0.5">info</span>
            <p class="font-body-md text-body-md text-on-surface-variant">
              Hệ thống ưu tiên giọng <strong class="text-primary font-semibold">中文 (台灣) — Quốc ngữ Đài Loan</strong> (xen kẽ giọng Nam &amp; Nữ cho hội thoại). Trên điện thoại, vào <span class="font-semibold text-on-surface">Cài đặt &gt; Chuyển văn bản thành giọng nói</span> để tải gói giọng Đài Loan chất lượng cao.
            </p>
          </div>
          <button class="inline-flex items-center gap-space-xs px-space-md py-2 rounded-lg bg-jade-subtle text-secondary font-label-md text-label-md font-semibold hover:bg-secondary-container transition-colors whitespace-nowrap" type="button" onclick="say('歡迎來到臺灣學習華語')">
            <span class="material-symbols-outlined text-[18px]">volume_up</span>
            <span>Nghe thử</span>
          </button>
        </div>
      </section>

      <!-- SECTION 5: Sao lưu & Khôi phục (Exact Stitch) -->
      <section class="bg-paper-card rounded-xl p-space-lg border border-border-subtle/70 shadow-sm flex flex-col gap-space-lg">
        <div class="flex items-center gap-space-sm">
          <span class="w-1 h-5 rounded-full bg-primary inline-block"></span>
          <h2 class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
            Sao lưu và khôi phục
          </h2>
        </div>
        <p class="font-body-md text-body-md text-on-surface-variant">
          Tiến độ lưu trong trình duyệt của máy này. Sao lưu thường xuyên và cất file vào Google Drive (thư mục “10 Website học tiếng Hoa”). Đổi máy thì bấm Khôi phục và chọn file đó.
        </p>
        <div class="flex flex-wrap items-center gap-space-sm">
          <button class="inline-flex items-center gap-space-xs px-space-lg py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold hover:bg-primary-container transition-colors shadow-sm" id="btnExportJSON" type="button">
            <span class="material-symbols-outlined text-[18px]">file_download</span>
            <span>Sao lưu ra file</span>
          </button>
          <label class="inline-flex items-center gap-space-xs px-space-lg py-2.5 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md font-medium hover:bg-surface-container-highest transition-colors cursor-pointer">
            <span class="material-symbols-outlined text-[18px]">file_upload</span>
            <span>Khôi phục từ file</span>
            <input type="file" id="importFile" accept=".json,application/json" class="hidden">
          </label>
        </div>
        <div class="flex flex-wrap items-center gap-space-xl pt-space-xs">
          <label class="inline-flex items-center gap-space-xs cursor-pointer select-none">
            <input checked class="w-4 h-4 text-primary focus:ring-0 accent-primary" name="sync-strategy" type="radio" value="merge">
            <span class="font-body-md text-body-md text-on-surface font-medium">Gộp: giữ kết quả mới hơn của từng thẻ</span>
          </label>
          <label class="inline-flex items-center gap-space-xs cursor-pointer select-none">
            <input class="w-4 h-4 text-primary focus:ring-0 accent-primary" name="sync-strategy" type="radio" value="replace">
            <span class="font-body-md text-body-md text-on-surface-variant">Thay toàn bộ bằng file</span>
          </label>
        </div>
        <div class="pt-space-md bg-surface-container-low/70 p-space-md rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
          <div class="flex items-center gap-space-sm">
            <button class="inline-flex items-center gap-1.5 px-space-md py-1.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface hover:text-primary font-label-sm text-label-sm font-semibold shadow-sm transition-colors" id="btnClearCache" type="button">
              <span class="material-symbols-outlined text-[16px] text-tertiary">cached</span>
              <span>Tải lại bản mới nhất (Xóa cache)</span>
            </button>
          </div>
          <span class="font-body-sm text-body-sm text-outline">
            Bấm nút này nếu trình duyệt trên điện thoại chưa hiện giao diện mới nhất.
          </span>
        </div>
      </section>

      <!-- SECTION 6: Nguồn dữ liệu & Học thuật (Exact Stitch) -->
      <section class="bg-paper-card rounded-xl p-space-lg border border-border-subtle/70 shadow-sm flex flex-col gap-space-md">
        <div class="flex items-center gap-space-sm">
          <span class="w-1 h-5 rounded-full bg-primary inline-block"></span>
          <h2 class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
            Nguồn dữ liệu
          </h2>
        </div>
        <ul class="flex flex-col gap-space-xs font-body-sm text-body-sm text-on-surface-variant list-none p-0 m-0">
          <li class="flex items-start gap-space-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-outline mt-2 shrink-0"></span>
            <span>Bảng từ TOCFL 2024 (華語八千詞表), Trung tâm SC-TOP · <a class="text-primary hover:underline" href="https://tocfl.edu.tw" rel="noopener" target="_blank">tocfl.edu.tw</a></span>
          </li>
          <li class="flex items-start gap-space-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-outline mt-2 shrink-0"></span>
            <span>CC-CEDICT, giấy phép CC BY-SA 4.0 · <a class="text-primary hover:underline" href="https://mdbg.net" rel="noopener" target="_blank">mdbg.net</a></span>
          </li>
          <li class="flex items-start gap-space-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-outline mt-2 shrink-0"></span>
            <span>Nghĩa tiếng Việt và lượng từ: CVDICT (Phong Phan), giấy phép CC BY-SA 4.0 · <a class="text-primary hover:underline" href="https://github.com/ph0ngp/CVDICT" rel="noopener" target="_blank">github.com/ph0ngp/CVDICT</a></span>
          </li>
          <li class="flex items-start gap-space-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-outline mt-2 shrink-0"></span>
            <span>Make Me a Hanzi &amp; Hanzi Writer (vẽ nét chữ Hán Phồn thể)</span>
          </li>
          <li class="flex items-start gap-space-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-outline mt-2 shrink-0"></span>
            <span class="text-on-surface font-medium">Nghĩa tiếng Việt, chủ đề theo Band, đề thi thử CAT &amp; bài nghe chính tả: biên soạn riêng cho trang này</span>
          </li>
        </ul>
      </section>
    </div>
  `);

  // Toggle Token Visibility
  const btnVis = $("#btnToggleTokenVis");
  if (btnVis) {
    btnVis.onclick = () => {
      const inp = $("#ghToken");
      if (inp) inp.type = inp.type === "password" ? "text" : "password";
    };
  }

  // Bind Setting Presets
  document.querySelectorAll(".btn-setting-preset").forEach((btn) => {
    btn.onclick = () => {
      const n = btn.dataset.presetNew;
      const r = btn.dataset.presetRev;
      if ($("#setNewPerDay")) $("#setNewPerDay").value = n;
      if ($("#setRevPerDay")) $("#setRevPerDay").value = r;
    };
  });

  // Save Goals & Preferences
  $("#btnSaveGoals").onclick = async () => {
    S.settings.newPerDay = Math.max(1, Math.min(200, Number($("#setNewPerDay").value) || 8));
    S.settings.reviewPerDay = Math.max(5, Math.min(500, Number($("#setRevPerDay").value) || 30));
    S.settings.ruby = $("#setRuby").checked;
    await saveSettings();
    alert("✓ Đã lưu cài đặt thành công!");
  };

  // Ruby checkbox instant save
  const rubyChk = $("#setRuby");
  if (rubyChk) {
    rubyChk.onchange = async () => {
      S.settings.ruby = rubyChk.checked;
      await saveSettings();
    };
  }

  // Theme selector
  const themeSel = $("#theme-preset");
  if (themeSel) {
    themeSel.onchange = () => {
      const val = themeSel.value;
      if (val === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
    };
  }

  // Folder checkboxes in Section 2
  document.querySelectorAll("[data-folder-chk]").forEach((chk) => {
    chk.onchange = async () => {
      const id = chk.dataset.folderChk;
      setFolderOn(id, chk.checked);
      await saveSettings();
      VIEWS["cai-dat"]();
    };
  });
  const btnAllBands = $("#btnSelectAllBands");
  if (btnAllBands) {
    btnAllBands.onclick = async () => {
      S.bands.forEach((b) => { S.settings.bands[b] = true; });
      await saveSettings();
      VIEWS["cai-dat"]();
    };
  }

  // Cloud Sync
  $("#btnSaveSync").onclick = async () => {
    const token = $("#ghToken").value.trim();
    const gistId = $("#ghGistId").value.trim();
    if (!token) {
      alert("Vui lòng nhập GitHub Token.");
      return;
    }
    const msg = $("#gistMsg");
    if (msg) msg.textContent = "Đang kết nối GitHub và tạo/cập nhật kho đồng bộ...";
    try {
      const gid = await Sync.connectWithToken(token, gistId);
      if (msg) msg.textContent = "✓ Đồng bộ thành công!";
      const cfg = Sync.getConfig();
      $("#ghGistId").value = cfg.gistId || gid;
      alert("🎉 Kết nối đồng bộ thành công! Tiến độ của bạn đã được kết nối với GitHub Gist.");
      VIEWS["cai-dat"]();
    } catch (err) {
      if (msg) msg.textContent = "Lỗi: " + err.message;
      alert("Không kết nối được: " + err.message);
    }
  };

  $("#btnTestSync").onclick = async () => {
    const token = $("#ghToken").value.trim();
    const gistId = $("#ghGistId").value.trim();
    if (!token) {
      alert("Vui lòng nhập Token để kiểm tra.");
      return;
    }
    const msg = $("#gistMsg");
    if (msg) msg.textContent = "Đang kiểm tra kết nối GitHub...";
    try {
      await Sync.connectWithToken(token, gistId);
      if (msg) msg.textContent = "✓ Kết nối tốt và đã đồng bộ tiến độ!";
    } catch (e) {
      if (msg) msg.textContent = "Lỗi: " + e.message;
      alert("Lỗi kiểm tra: " + e.message);
    }
  };

  const btnDisc = $("#btnDisconnectSync");
  if (btnDisc) {
    btnDisc.onclick = async () => {
      if (confirm("Bạn có chắc muốn ngắt kết nối đồng bộ trên máy này?")) {
        await Sync.disconnect();
        VIEWS["cai-dat"]();
      }
    };
  }

  // Fast Code Sync
  $("#btnCopyFastCode").onclick = async () => {
    const msg = $("#fastCodeMsg");
    try {
      const code = await Sync.generateFastCode();
      await navigator.clipboard.writeText(code);
      if (msg) msg.textContent = `✓ Đã sao chép mã tiến độ (${code.length} ký tự) vào clipboard! Dán mã này sang thiết bị khác để đồng bộ.`;
      alert("✓ Đã sao chép mã đồng bộ nhanh vào clipboard! Bạn có thể dán mã này vào điện thoại hoặc máy khác.");
    } catch (err) {
      if (msg) msg.textContent = "Lỗi tạo mã: " + err.message;
    }
  };

  $("#btnApplyFastCode").onclick = async () => {
    const code = $("#pasteFastCode").value.trim();
    const msg = $("#fastCodeMsg");
    if (!code) {
      alert("Vui lòng dán mã đồng bộ vào ô trước khi bấm áp dụng.");
      return;
    }
    try {
      const count = await Sync.applyFastCode(code);
      if (msg) msg.textContent = `✓ Đã nạp thành công ${count} thẻ tiến độ!`;
      $("#pasteFastCode").value = "";
      alert(`🎉 Đã gộp thành công ${count} thẻ tiến độ từ thiết bị khác!`);
      VIEWS["cai-dat"]();
    } catch (e) {
      if (msg) msg.textContent = "Lỗi áp dụng mã: " + e.message;
      alert("Lỗi áp dụng mã: " + e.message);
    }
  };

  // Export JSON
  $("#btnExportJSON").onclick = async () => {
    const dump = await Store.exportAll();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `so-hoc-tieng-hoa-backup-${dayKey(Date.now())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON
  $("#importFile").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!confirm("Bạn có muốn nạp dữ liệu từ file này không?")) return;
    const strat = document.querySelector('input[name="sync-strategy"]:checked')?.value || "merge";
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      await Store.importAll(obj, strat);
      alert("✓ Đã nạp dữ liệu thành công! Ứng dụng sẽ tải lại.");
      location.reload();
    } catch (err) {
      alert("Lỗi đọc file backup: " + err.message);
    }
  };

  // Clear Cache
  $("#btnClearCache").onclick = async () => {
    if (!confirm("Thao tác này sẽ xóa cache Service Worker và tải lại bản mới nhất. Tiếp tục?")) return;
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    location.reload(true);
  };
};

async function saveSettings() { await Store.put("kv", "settings", JSON.parse(JSON.stringify(S.settings))); updateBadge(); }
async function loadProgress() {
  S.srs = await Store.all("srs"); S.stats = await Store.all("stats"); S.inbox = await Store.all("inbox");
  const kv = await Store.all("kv"); S.packs = kv.get("packs") || []; if (kv.get("settings")) S.settings = Object.assign({ newPerDay: 8, reviewPerDay: 30, decks: {}, bands: {}, extra: {}, ruby: true, syncToken: "", syncGistId: "", autoSync: true, lastSyncTime: "" }, kv.get("settings"));
}
// theme lives in localStorage so it applies before the page paints (see index.html)
function getTheme() { try { return localStorage.getItem("shth-theme") || "light"; } catch (e) { return "light"; } }
function setTheme(v) { try { localStorage.setItem("shth-theme", v); } catch (e) {} document.documentElement.dataset.theme = v; }

function initSyncUI() {
  const btn = $("#headerSyncBtn");
  const icon = $("#headerSyncIcon");
  const label = $("#headerSyncLabel");
  if (!btn) return;

  btn.onclick = async () => {
    if (!Sync.isConfigured()) {
      location.hash = "#cai-dat";
      setTimeout(() => {
        const el = $("#sync-panel");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }, 100);
      return;
    }
    try {
      await Sync.syncNow();
      updateBadge();
      const h = location.hash;
      if (h === "#trang-chu" || h === "" || h.startsWith("#cai-dat")) route();
    } catch (e) {
      alert("Lỗi đồng bộ: " + e.message);
    }
  };

  Sync.onStatusChange((status, detail) => {
    if (status === "syncing") {
      btn.classList.add("syncing");
      btn.classList.remove("synced");
      if (label) label.textContent = "Đang đồng bộ...";
    } else if (status === "success") {
      btn.classList.remove("syncing");
      btn.classList.add("synced");
      if (label) label.textContent = "Đã đồng bộ";
      setTimeout(() => {
        if (label) label.textContent = "Đồng bộ";
      }, 4000);
    } else if (status === "error") {
      btn.classList.remove("syncing");
      btn.classList.remove("synced");
      if (label) label.textContent = "Lỗi đồng bộ";
      const badge = $("#syncStatusBadge");
      const last = $("#displayLastSync");
      if (badge) { badge.textContent = "Đồng bộ lỗi"; badge.className = "sync-badge inactive"; }
      if (last) last.textContent = "Đồng bộ lỗi: " + detail;
    } else {
      btn.classList.remove("syncing");
      if (label) label.textContent = "Đồng bộ";
    }
  });


}

// ---------------- boot ----------------
(async function boot() {
  try {
    $("#view").innerHTML = `<div class="note">Đang tải bảng từ…</div>`;
    const [t, decks] = await Promise.all([getJSON("data/tocfl.json"), getJSON("data/decks.json")]);
    S.bands = t.bands; S.tocfl = t.words; S.decks = decks;
    try {
      const vi = await getJSON("data/vi/index.json");
      const parts = await Promise.all((vi.files || []).map((f) => getJSON("data/vi/" + f)));
      for (const part of parts) {
        for (const [w, v] of Object.entries(part)) S.vi.set(w, v);
      }
    } catch (e) { console.warn("Vietnamese batches not loaded:", e); }
    try { for (const a of await getJSON("data/abbr.json")) { S.abbrS.set(a.s, a); if (!S.abbrF.has(a.f)) S.abbrF.set(a.f, a); } } catch (e) { /* no abbreviation list */ }
    buildNotes();
    $("#view").innerHTML = `<div class="note">Đang mở tiến độ học…</div>`;
    try { await loadProgress(); } catch (e) { S.storageError = true; }
    if (typeof syncAllInboxNotes === "function") syncAllInboxNotes();
    S.ready = true;
    initSyncUI();
    route();
    if (window.Sync && Sync.isConfigured() && Sync.getConfig().autoSync) {
      Sync.syncNow().then(() => {
        if (typeof syncAllInboxNotes === "function") syncAllInboxNotes();
        updateBadge();
        const h = location.hash;
        if (h === "#trang-chu" || h === "" || h.startsWith("#cai-dat")) route();
      }).catch((e) => console.warn("Initial sync background failed:", e));
    }
    if (S.storageError) $("#view").insertAdjacentHTML("afterbegin", `<div class="note">Trình duyệt chưa cho lưu tiến độ (có thể đang ở chế độ ẩn danh). Bạn vẫn học được, nhưng kết quả có thể không được giữ lại.</div>`);
    fetch("data/cedict.tsv").then((r) => r.text()).then((txt) => {
      const m = new Map(); for (const line of txt.split("\n")) { const [w, py, defs] = line.split("\t"); if (!w) continue; if (!m.has(w)) m.set(w, []); m.get(w).push([py, defs]); }
      S.ced = m; const h = location.hash; if (h.startsWith("#tu") || h.startsWith("#thu-muc") || h.startsWith("#nhap")) route();
    }).catch(() => {});
  } catch (e) { $("#view").innerHTML = `<div class="note">Không tải được dữ liệu: ${esc(e.message)}. Nếu mở bằng file trực tiếp trên máy, hãy dùng đường link GitHub Pages.</div>`; }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.update();
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      location.reload();
    });
  }
})();
