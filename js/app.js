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
const BAND_ORDER = ["Novice 1", "Novice 2", "A1", "A2", "B1", "B2", "C"];
// Card types per word: Novice–A2 = Nhận diện, Nghe, Nói và viết, Điền từ · B1 = Nhận diện, Nghe, Điền từ · B2/C = Nhận diện, Nghe
const VOCAB_TYPES = [["rec", "Nhận diện"], ["lis", "Nghe"], ["wri", "Nói và viết"], ["clo", "Điền từ"]];
const GRAMMAR_TYPES = [["rec", "Nhận diện mẫu câu"], ["bui", "Đặt câu"], ["clo", "Điền chỗ trống"]];

// ---------------- state ----------------
const S = {
  bands: [], tocfl: [], decks: [], notes: [], noteByWord: new Map(), noteByKey: new Map(),
  ced: null, cedList: null, vi: new Map(), abbrS: new Map(), abbrF: new Map(), packs: [],
  srs: new Map(), stats: new Map(), inbox: new Map(),
  settings: { newPerDay: 8, reviewPerDay: 50, decks: {}, bands: {}, extra: {}, ruby: true },
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
    const lowest = Math.min(...bandsOf(n).map((b) => BAND_ORDER.indexOf(b)).filter((i) => i >= 0), 99);
    const core = lowest <= BAND_ORDER.indexOf("A2"), upper = lowest >= BAND_ORDER.indexOf("B2");
    if (core && (it.vn || it.en)) t.push(["wri", "Nói và viết"]);
    if (!upper && it.e2 && it.e2.includes(n.w)) t.push(["clo", "Điền từ"]);
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
// --- Word Segmenter (for ruby() and dictation) ---
function segment(zh) {
  const out = []; const chars = [...String(zh || "")]; let i = 0;
  while (i < chars.length) {
    if (!isHan(chars[i])) { out.push({ t: chars[i] }); i++; continue; }
    let hit = null;
    for (let L = Math.min(8, chars.length - i); L >= 1; L--) {
      const w = chars.slice(i, i + L).join("");
      const n = S.noteByWord.get(w);
      if (n) { hit = { t: w, n }; break; }
      if (L > 1 && S.ced && S.ced.has(w)) { hit = { t: w }; break; }
    }
    if (!hit) hit = { t: chars[i] };
    out.push(hit); i += [...hit.t].length;
  }
  return out;
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

// Text under a level button: when this card would come back if graded at that level.
function levelHint(prev, lvl, now) {
  if (lvl === 0) return "Đặt lại";
  const x = scheduleLevel(prev, lvl, now);
  return x.state === "review" ? fmtGap(x.ivl * DAY) : fmtGap(Math.max(MIN, x.due - now));
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
  const wasNewWord = noteLevel(n) === 0;
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
    const s = Object.assign(scheduleLevel(prev, targetLvl, now), {
      firstSeen: (prev && (prev.firstSeen || prev.last)) || now,
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
    await bumpReviewStats(now, targetLvl === 1 ? 1 : 3, wasNewWord);
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
  // The daily limit counts new WORDS. Other skill cards of a word already started (Nghe, Viết, Điền từ)
  // open from the next day and are not limited, otherwise they would use up the quota for new words.
  const left = Math.max(0, Number(S.settings.newPerDay || 8) - todayStats().newCards);
  const sib = fresh.filter((r) => noteLevel(r.n) > 0);
  const rank = (r) => S.lessonRank.has(r.n.w) ? S.lessonRank.get(r.n.w) : 1e6;
  const first = fresh.filter((r) => noteLevel(r.n) === 0).map((r, i) => [r, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map((x) => x[0]);
  return { learn, review, fresh: sib.concat(first.slice(0, left)), freshTotal: fresh.length };
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
// ---------------- rich word data: full explanation, situation lessons ----------------
// data/rich/<band>.json is built by tools/build_rich.py from the lesson source folder (du-lieu-tu-vung).
S.lessons = new Map(); S.lessonOf = new Map(); S.lessonRank = new Map(); S.richTopics = {};
function addRich(part) {
  Object.assign(S.richTopics, part.topics || {});
  for (const L of part.lessons || []) {
    S.lessons.set(L.id, L);
    for (const w of L.words) if (!S.lessonOf.has(w)) { S.lessonOf.set(w, L.id); S.lessonRank.set(w, S.lessonRank.size); }
  }
  for (const [w, r] of Object.entries(part.words || {})) S.vi.set(w, Object.assign({}, S.vi.get(w) || {}, r));
}
// Sentences from the user's private test packs (only on this device): exam questions and dictation packs.
let EXAM_SENTS = null;
async function buildExamIndex() {
  const out = [];
  const add = (text, src) => String(text || "").replace(/[男女][：:]/g, "\n").split(/(?<=[。！？!?])|\n/).forEach((x) => { x = x.trim(); if (x.length >= 4 && /[㐀-鿿]/.test(x)) out.push({ zh: x, src }); });
  try {
    for (const t of await getMockTests()) for (const q of t.questions || []) {
      const src = `${t.title} · câu ${q.id}`;
      add(q.dialogue || q.audio, src); add(q.zh, src); add(q.passage, src); add(q.q, src);
    }
  } catch (e) {}
  for (const pk of S.packs || []) for (const x of pk.sentences || []) add(x.zh, pk.name || "Bộ câu riêng");
  const seen = new Set(); EXAM_SENTS = out.filter((x) => !seen.has(x.zh) && seen.add(x.zh));
  return EXAM_SENTS;
}
function examHitsHTML(w) {
  if (!EXAM_SENTS) { buildExamIndex(); return ""; }
  const fs = [...new Set(w.split("/").flatMap((f) => [f.replace(/[()]/g, ""), f.replace(/\([^)]*\)/g, "")]))].filter(Boolean);
  const hits = EXAM_SENTS.filter((x) => fs.some((f) => x.zh.includes(f))).slice(0, 4);
  if (!hits.length) return "";
  return `<details class="rich-box rich-exam"><summary>Gặp trong đề thi của bạn (${hits.length}) <small>chỉ hiện trên máy này</small></summary>
    ${hits.map((h) => `<div class="rich-ex"><div class="zh" lang="zh-Hant">${ruby(h.zh)} ${sp(h.zh)}</div><div class="src">${esc(h.src)}</div></div>`).join("")}</details>`;
}
function lessonHTML(w, open) {
  const L = S.lessons.get(S.lessonOf.get(w)); if (!L) return "";
  const t = S.richTopics[L.chu_de] || {};
  const dv = L.doan_van;
  const q = dv && dv.cau_hoi;
  return `<details class="rich-box rich-lesson" ${open ? "open" : ""}><summary>Bài tình huống: ${esc(L.ten)} <small>${esc(L.band)} · ${esc(t.vn || "")} · ${L.words.length} từ</small></summary>
    ${L.tinh_huong ? `<p class="rich-scene">${esc(L.tinh_huong)}</p>` : ""}
    <div class="rich-dlg">${L.hoi_thoai.map((x) => `<div class="rich-line"><b>${esc(x.s)}</b><div><div class="zh" lang="zh-Hant">${esc(x.zh)} ${sp(x.zh)}</div><div class="py">${esc(x.py)}</div><div class="vn">${esc(x.vn)}</div></div></div>`).join("")}</div>
    ${dv ? `<div class="rich-read"><b>Đoạn đọc kiểu đề thi</b><div class="zh" lang="zh-Hant">${ruby(dv.zh)} ${sp(dv.zh)}</div><details><summary>Pinyin và nghĩa</summary><div class="py">${esc(dv.py)}</div><div class="vn">${esc(dv.vn)}</div></details>
      ${q ? `<div class="rich-quiz" data-ans="${q.ans}"><div class="zh" lang="zh-Hant">${ruby(q.q)}</div>${q.opts.map((o, i) => `<button type="button" class="rich-opt" data-i="${i}">${"ABCD"[i]}. ${ruby(o)}</button>`).join("")}<div class="rich-res" role="status"></div></div>` : ""}</div>` : ""}
    <div class="rich-words">Từ trong bài: ${L.words.map((x) => `<a href="#tu/${encodeURIComponent(x)}" class="${x === w ? "cur" : ""}" lang="zh-Hant">${esc(x)}</a>`).join(" ")}</div>
  </details>`;
}
function richDetailHTML(it, opts = {}) {
  // hand-made deck items keep their own text; situation sentences and senses come from data/rich when they have none
  const extra = S.vi.get(it.w) || {};
  it = Object.assign({}, it, { vd: it.vd || extra.vd, ng: it.ng || extra.ng });
  const w = it.w; const parts = [];
  if (it.ng && it.ng.length) parts.push(`<div class="rich-sec"><h4>Giải nghĩa đầy đủ</h4><ol>${it.ng.map((x) => `<li>${ruby(x)}</li>`).join("")}</ol></div>`);
  if (it.vd && it.vd.length) parts.push(`<div class="rich-sec"><h4>Câu theo tình huống</h4>${it.vd.map((v) => `<div class="rich-ex">${v.t ? `<span class="rich-tag">${esc(v.t)}</span>` : ""}<div class="zh" lang="zh-Hant">${esc(v.zh)} ${sp(v.zh)}</div><div class="py">${esc(v.py || "")}</div><div class="vn">${esc(v.vn)}</div></div>`).join("")}</div>`);
  const rows = [["Cách dùng", it.us], ["Cụm hay gặp", it.co], ["Đồng nghĩa, gần nghĩa", it.sy], ["Trái nghĩa", it.an], ["Dễ nhầm với", it.cf], ["Lượng từ", it.lt]].filter(([, v]) => v);
  if (rows.length) parts.push(`<div class="rich-sec"><dl class="rich-kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${ruby(v)}</dd></div>`).join("")}</dl></div>`);
  if (it.mk) parts.push(`<div class="rich-note rich-warn"><b>Lỗi hay gặp</b> ${ruby(it.mk)}</div>`);
  if (it.tw) parts.push(`<div class="rich-note rich-tw"><b>Người Đài nói thế nào</b> ${ruby(it.tw)}</div>`);
  if (it.mh || it.mi) parts.push(`<div class="rich-note rich-tip"><b>Mẹo nhớ</b> ${ruby(it.mh || it.mi)}</div>`);
  const lesson = lessonHTML(w, opts.lessonOpen);
  const exam = examHitsHTML(w);
  if (!parts.length && !lesson && !exam) return "";
  return `<section class="rich" aria-label="Giải thích đầy đủ">${parts.join("")}${lesson}${exam}</section>`;
}
// answer the mini reading question inside a lesson
document.addEventListener("click", (e) => {
  const b = e.target.closest(".rich-opt"); if (!b) return;
  const box = b.closest(".rich-quiz"); const ok = Number(b.dataset.i) === Number(box.dataset.ans);
  box.querySelectorAll(".rich-opt").forEach((x) => x.classList.toggle("right", Number(x.dataset.i) === Number(box.dataset.ans) && ok));
  b.classList.add(ok ? "right" : "wrong");
  box.querySelector(".rich-res").textContent = ok ? "Đúng rồi!" : "Chưa đúng, đọc lại đoạn văn rồi thử lần nữa.";
});
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

  const targetNew = Math.max(1, Number(S.settings.newPerDay || 8));
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
  const studyMinutes = Math.round(st.reviews * 0.2); // about 12 s per answer
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
                <img class="w-full h-full object-cover" alt="Traditional Taiwanese scholar academy" src="img/trang-chu-dai-loan.jpg" onerror="this.style.display='none'">
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
    const targetNew = Math.max(1, Number(S.settings.newPerDay || 8));
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
        S.settings.newPerDay = Number(S.settings.newPerDay || 8) + 10;
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
      S.settings.newPerDay = Number(S.settings.newPerDay || 8) + 10;
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
  const clozeMissed = r.t === "clo" && (r._wrongChoices || []).length > 0;
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

              ${richDetailHTML(it)}

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

                <!-- 6-level grading for this skill: the interval grows from this card's history -->
                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between text-outline px-1">
                    <span class="font-label-sm text-xs uppercase tracking-wider font-semibold text-on-surface">${S.settings.gradeAll !== false ? "Chấm mức nhớ cho cả từ" : "Chấm mức nhớ cho kỹ năng " + esc(typeLabel)}</span>
                    <span class="font-code text-xs hidden sm:inline">Phím tắt: 1 - 5, 0</span>
                  </div>
                  <div class="grades-6">
                    ${[0, 1, 2, 3, 4, 5].map((lvl) => {
                      const isCur = curSkillLvl === lvl;
                      const hint = levelHint(curCardState, lvl, now);
                      const locked = clozeMissed && lvl > 2;
                      return `
                        <button type="button" class="lvl-btn lvl-btn-${lvl} ${isCur ? "is-current" : ""}" data-word-level="${lvl}" ${locked ? "disabled" : ""} title="${locked ? "Đã chọn sai đáp án: tối đa Nhớ tạm" : "Lần ôn tới: " + hint}">
                          <span class="lvl-title">${isCur ? "✓ " : ""}${esc(LEVELS[lvl])}</span>
                          <small class="lvl-sub">${hint}</small>
                        </button>
                      `;
                    }).join('')}
                  </div>
                  <label class="flex items-center justify-center gap-2 text-xs text-on-surface-variant cursor-pointer select-none">
                    <input type="checkbox" id="chkAllSkills" class="w-4 h-4 rounded text-primary" ${S.settings.gradeAll !== false ? "checked" : ""}>
                    <span>Áp dụng cho cả từ (mọi kỹ năng: đọc, nghe, viết, điền từ) · mặc định bật</span>
                  </label>
                  <div class="text-[11px] text-outline text-center">
                    ${clozeMissed ? "Bạn đã chọn sai đáp án nên chỉ chấm được tới Nhớ tạm. " : ""}Số dưới mỗi ô là lần ôn tới. Lịch tự giãn dần khi bạn nhớ tốt nhiều lần; không nhảy thẳng lên 90 ngày.
                  </div>
                </div>

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
        if (chkAll && (S.settings.gradeAll !== false) !== chkAll.checked) { S.settings.gradeAll = chkAll.checked; saveSettings(); }
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

window.addEventListener("keydown", (e) => {
  const ss = S.session;
  if (!ss || !ss.current) return;
  if (!location.hash.startsWith("#hoc") && !$("#btnReveal") && !$("[data-srs-grade]")) return;
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
  } else if (ss.shown && ["0", "1", "2", "3", "4", "5", "6"].includes(e.key)) {
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
window.GRAMMAR_BOOKMARKS = window.GRAMMAR_BOOKMARKS || new Set();

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

function grammarStatsHTML() {
  const notes = S.notes.filter((n) => n.kind === "grammar");
  const lv = notes.map(noteLevel);
  const learning = lv.filter((l) => l > 0).length, solid = lv.filter((l) => l >= 3).length;
  const end = dayStart(Date.now()) + DAY; let due = 0;
  for (const n of notes) for (const [t] of typesOf(n)) { const st = S.srs.get(cardId(n, t)); if (st && st.state !== "new" && st.due < end) due++; }
  const saved = (window.GRAMMAR_BOOKMARKS || new Set()).size;
  const box = (label, icon, val, sub, href) => `<${href ? `a href="${href}"` : "div"} class="bg-paper-card rounded-xl p-space-md shadow-xs border border-border-subtle flex flex-col gap-1">
      <span class="font-label-md text-xs text-on-surface-variant font-medium flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">${icon}</span>${label}</span>
      <span class="font-headline-lg text-xl font-bold text-on-surface">${fmt(val)}</span>
      <span class="font-label-sm text-xs text-outline">${sub}</span></${href ? "a" : "div"}>`;
  return box("Bài ngữ pháp", "menu_book", GRAMMAR_MASTER_LIST.length + notes.length, `${GRAMMAR_MASTER_LIST.length} bài giảng · ${notes.length} mẫu có thẻ ôn`)
    + box("Mẫu đang học", "school", learning, `${solid} mẫu đã ở mức Nhớ lâu trở lên`)
    + box("Thẻ ngữ pháp đến hạn", "schedule", due, due ? "Bấm để vào mục Học" : "Hôm nay không có thẻ đến hạn", due ? "#hoc" : "")
    + box("Đã lưu sổ tay", "bookmark", saved, "mẫu câu bạn đánh dấu");
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

          <!-- 2. Real progress for grammar -->
          <section class="grid grid-cols-2 md:grid-cols-4 gap-space-md my-space-lg">${grammarStatsHTML()}</section>

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
              <span class="font-label-sm text-label-sm text-outline">Câu soạn riêng cho trang</span>
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

          ${richDetailHTML(it, { lessonOpen: true })}

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
            <img class="w-full h-full object-cover transition-transform duration-500 hover:scale-105" alt="Taipei Night Glow" src="img/tra-tu.jpg" onerror="this.style.display='none'">
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
// Official TOCFL practice tests are copyrighted, so they are not shipped with the site.
// The user loads them once per device from a private file (kept in Google Drive); they stay in this browser only.
const BUILTIN_MOCK_TESTS = [];

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
    const saved = await Store.get("kv", "mockTests");
    if (Array.isArray(saved) && saved.length) { window._MOCK_TESTS = saved; return saved; }
  } catch (e) {}
  return [];
}
// Accepts the private pack {app:"so-hoc-tieng-hoa-mocktests", tests:[...]} or a bare array of tests.
async function loadMockTestFile(file) {
  const data = JSON.parse(await file.text());
  const tests = Array.isArray(data) ? data : (data && data.tests);
  if (!Array.isArray(tests) || !tests.length || !tests.every((t) => t && t.id && Array.isArray(t.questions)))
    throw new Error("File này không phải gói đề thi của Sổ học tiếng Hoa.");
  await Store.put("kv", "mockTests", tests);
  window._MOCK_TESTS = tests;
  return tests.length;
}
function mockTestLoaderHTML() {
  return `<div class="max-w-2xl mx-auto px-margin-mobile md:px-margin py-space-xl">
    <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-sm flex flex-col gap-space-md">
      <h1 class="font-headline-lg text-2xl font-bold text-on-surface">Thi thử TOCFL</h1>
      <p class="text-on-surface-variant">Đề thi thử chính thức của SC-TOP có bản quyền nên không đăng công khai trên trang này. Bạn nạp gói đề riêng một lần trên mỗi máy; đề chỉ lưu trong trình duyệt của máy đó, không đồng bộ lên mạng.</p>
      <p class="text-sm text-outline">File gói đề nằm trong Google Drive: <b>10 Website học tiếng Hoa › bo-cau-rieng › de-thi-thu-TOCFL.json</b>. Trên điện thoại, mở bằng ứng dụng Files/Tệp của Drive.</p>
      <label class="inline-flex items-center gap-2 self-start px-5 py-2.5 rounded-xl bg-primary-container hover:bg-primary text-on-primary font-semibold cursor-pointer">
        <span class="material-symbols-outlined text-[20px]">upload_file</span><span>Nạp gói đề thi</span>
        <input type="file" id="mockFile" accept=".json,application/json" class="hidden">
      </label>
      <div role="status" id="mockMsg" class="text-sm"></div>
    </div>
  </div>`;
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
  if (!allTests.length) {
    setView(mockTestLoaderHTML());
    const inp = $("#mockFile");
    if (inp) inp.onchange = async () => {
      const msg = $("#mockMsg");
      try { const n = await loadMockTestFile(inp.files[0]); msg.textContent = `Đã nạp ${n} đề.`; VIEWS["thi-thu"](); }
      catch (e) { msg.textContent = e.message; }
    };
    return;
  }
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
                    <div class="font-body-sm text-[12px] text-on-surface-variant">Ngưỡng điểm đạt từng cấp: xem trang chính thức
                      <a class="text-primary underline" href="https://tocfl.edu.tw/index.php/exam/test/page/2" target="_blank" rel="noopener">tocfl.edu.tw</a>. Điểm ở đây chỉ là số câu đúng.</div>
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
              <span class="font-label-md text-label-md font-semibold text-secondary">Tự động khi lưu</span>
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
              <textarea class="w-full h-full min-h-[200px] p-space-md rounded-xl bg-paper-base border border-border-subtle text-on-surface font-body-md text-body-md focus:outline-none placeholder:text-outline/60 resize-y leading-relaxed" id="batch-textarea" rows="8" placeholder="Dán danh sách từ của bạn vào đây (mỗi dòng 1 từ)..."></textarea>
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
                <span class="material-symbols-outlined text-[14px]">shield</span> Chỉ lưu trên máy này
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
    try {
      const ri = await getJSON("data/rich/index.json");
      for (const part of await Promise.all((ri.files || []).map((f) => getJSON("data/rich/" + f)))) addRich(part);
    } catch (e) { console.warn("Rich word data not loaded:", e); }
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
