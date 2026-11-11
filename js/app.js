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
// --- SRS Core Functions (SM-2 Spaced Repetition & Calibrated Levels) ---
// 1. Grade single card via SM-2: grade 1 (Quên), 2 (Khó), 3 (Nhớ tốt), 4 (Dễ)
async function applyCardGrade(n, type, grade, afterSave) {
  if (!grade || grade < 1 || grade > 4) return;
  const now = Date.now();
  const cid = cardId(n, type);
  const prev = S.srs.get(cid);
  const wasNew = !prev || prev.state === "new";
  const next = schedule(prev, grade, now);
  next.w = n.w;
  next.firstSeen = next.firstSeen || (prev && (prev.firstSeen || prev.last)) || now;

  // Nếu Quên (grade 1): đưa lại vào cuối hàng đợi của phiên học hiện tại để truy xuất lại (retrieval practice)
  if (grade === 1 && S.session && Array.isArray(S.session.queue)) {
    S.session.queue.push({ id: cid, n, t: type, s: next });
  }

  const entries = [[cid, next]];

  // Cập nhật thống kê trong ngày
  const key = dayKey(now);
  const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats.get(key));
  st.reviews++;
  if (wasNew) st.newCards++;
  if (grade === 1) st.again++;
  S.stats.set(key, st);
  if (S.session) S.session.answered++;

  try {
    await Store.putMany("srs", entries);
    await Store.put("stats", key, st);
  } catch (err) {
    const el = $("#saveErr") || $("#levelStatus");
    if (el) el.textContent = "Chưa lưu được tiến độ SRS: " + (err && err.message || err);
    return;
  }
  S.srs.set(cid, next);
  updateBadge();
  if (window.Sync && typeof Sync.onCardGraded === "function") Sync.onCardGraded();
  if (afterSave) afterSave();
}

// 2. Calibrated manual level override for single skill or all skills
async function applyCardLevel(n, type, level, applyToAll = false, afterSave) {
  if (level === undefined || level < 0 || level > 5) return;
  const now = Date.now();
  const typesToUpdate = applyToAll ? typesOf(n).map(([t]) => t) : [type];
  const entries = [];
  let hasNew = false;
  let hasAgain = false;

  for (const t of typesToUpdate) {
    const cid = cardId(n, t);
    const prev = S.srs.get(cid);
    const wasNew = !prev || prev.state === "new";
    if (wasNew && level > 0) hasNew = true;
    if (level === 1) hasAgain = true;
    const next = scheduleLevel(prev, level, now);
    next.w = n.w;
    next.firstSeen = next.firstSeen || (prev && (prev.firstSeen || prev.last)) || now;
    entries.push([cid, next]);
  }

  const key = dayKey(now);
  const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats.get(key));
  st.reviews++;
  if (hasNew) st.newCards++;
  if (hasAgain) st.again++;
  S.stats.set(key, st);
  if (S.session) S.session.answered++;

  try {
    await Store.putMany("srs", entries);
    await Store.put("stats", key, st);
  } catch (err) {
    const el = $("#saveErr") || $("#levelStatus");
    if (el) el.textContent = "Chưa lưu được mức nhớ: " + (err && err.message || err);
    return;
  }
  for (const [id, state] of entries) S.srs.set(id, state);
  updateBadge();
  if (window.Sync && typeof Sync.onCardGraded === "function") Sync.onCardGraded();
  if (afterSave) afterSave();
  const message = $("#levelStatus");
  if (message) message.textContent = `Đã đặt ${n.w} ở mức ${LEVELS[level]}${applyToAll ? " (tất cả kỹ năng)" : ""}.`;
}

// 3. Backward compatibility for dictionary / folder list bulk actions
async function applyWordLevel(n, level, afterSave) {
  return applyCardLevel(n, typesOf(n)[0][0], level, true, afterSave);
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
const deckOn = (id) => (!S.settings.decks || S.settings.decks[id] !== false);
const bandOn = (n) => bandsOf(n).some((b) => S.settings.bands && S.settings.bands[b]);
const inLearning = (n) => n.rich ? (deckOn(n.deck.id) || bandOn(n)) : (bandOn(n) || !!(S.settings.extra && S.settings.extra[n.w]));
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
  const pick = (arr) => arr.find((r) => r.n.key !== last) || arr[0];
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
  const h = decodeURIComponent(rawHash || "trang-chu");
  const [name, ...rest] = h.split("/"); const arg = rest.join("/");
  document.querySelectorAll("[data-view]").forEach((a) => { if (a.dataset.view === name || (name === "tu" && a.dataset.view === "tu-dien") || (name === "muc-nho" && a.dataset.view === "trang-chu")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
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


// --- Folders & Learning Utilities ---
function folderNotes(id) {
  if (S.bands.includes(id)) return S.notes.filter((n) => n.kind === "vocab" && inBand(n, id));
  if (id === "cua-toi") return S.notes.filter((n) => n.rich);
  if (id === "viet-tat") { const set = new Set(); for (const w of S.abbrS.keys()) { const n = S.noteByWord.get(w); if (n) set.add(n); } return [...set]; }
  return S.notes.filter((n) => n.rich && n.deck.id === id);
}
function folderOn(id) {
  if (S.bands.includes(id)) return !!(S.settings.bands && S.settings.bands[id]);
  if (id === "cua-toi") return S.decks.every((d) => deckOn(d.id));
  if (id === "viet-tat") return folderNotes(id).every(inLearning);
  return deckOn(id);
}
function setFolderOn(id, v) {
  if (!S.settings.bands) S.settings.bands = {};
  if (!S.settings.decks) S.settings.decks = {};
  if (!S.settings.extra) S.settings.extra = {};
  if (S.bands.includes(id)) S.settings.bands[id] = v;
  else if (id === "cua-toi") for (const d of S.decks) S.settings.decks[d.id] = v;
  else if (id === "viet-tat") { for (const n of folderNotes(id)) { if (n.rich) S.settings.decks[n.deck.id] = v || deckOn(n.deck.id); else if (v) S.settings.extra[n.w] = true; else delete S.settings.extra[n.w]; } }
  else S.settings.decks[id] = v;
}
const hasProgress = (n) => typesOf(n).some(([t]) => S.srs.has(cardId(n, t)));

// --- NLP & Sentence Helpers for Dictation & Search ---
function segment(zh) {
  const out = []; const chars = [...zh]; let i = 0;
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
function autoPinyin(tokens) {
  return tokens.map((k) => k.n ? itemOf(k.n).py : isHan(k.t) ? ((cedFirst(k.t) || [[k.t]])[0][0]) : k.t).join(" ").replace(/\s+([，。！？、])/g, "$1");
}
function sentenceBank() {
  const out = [];
  for (const n of S.notes) {
    if (!n.rich && !S.vi.has(n.w)) continue;
    const it = itemOf(n);
    for (const k of n.kind === "grammar" ? [1, 2, 3] : [1, 2]) if (it["e" + k]) out.push({ zh: it["e" + k], py: it["e" + k + "p"], vn: it["e" + k + "v"], src: n.rich ? (n.deck && n.deck.name || "Của tôi") : bandLabel(n), own: true, note: n });
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
// 1. TRANG CHỦ (Modern Oriental Scholarly - Stitch Design)
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
  const reviewedToday = Math.max(0, st.reviews - st.newCards);
  const studyMinutes = Math.max(1, Math.round(st.reviews * 0.45));

  // 3 Tasks Progress Calculations
  const task1Done = st.reviews > 0;
  const task1Pct = task1Done ? 100 : 0;

  const task2Pct = Math.min(100, Math.round((reviewedToday / targetRev) * 100));
  const task2Done = reviewedToday >= targetRev || (c.due === 0 && reviewedToday > 0);

  const task3Pct = Math.min(100, Math.round((st.newCards / targetNew) * 100));
  const task3Done = st.newCards >= targetNew || (c.fresh === 0 && st.newCards > 0);

  // 30 days matrix for heatmap
  const today = new Date(dayStart(Date.now()));
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - 29 + i);
    const key = dayKey(d);
    const revs = (S.stats.get(key) || {}).reviews || 0;
    return { key, date: d.getDate(), month: d.getMonth() + 1, revs };
  });
  const maxDayRevs = Math.max(1, ...days30.map(d => d.revs));

  // TOCFL Band progress breakdown
  const bandList = ["Novice 1", "Novice 2", "A1", "A2", "B1", "B2", "C"];
  const bandProgressHTML = bandList.map(b => {
    const ns = vocab.filter(n => inBand(n, b));
    const l = ns.filter(n => noteLevel(n) > 0).length;
    const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
    const isLearning = !!S.settings.bands[b];
    return `
      <div class="p-space-md rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between gap-space-sm hover:border-primary/40 transition-all">
        <div class="flex items-center justify-between">
          <span class="font-headline-md font-bold text-on-surface text-base">TOCFL ${b}</span>
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
            <div class="h-full bg-primary rounded-full transition-all duration-300" style="width:${pct}%;"></div>
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

  // Personal folders
  const mineFolders = [
    { id: "cua-toi", name: "Thư mục của tôi", sub: "Lớp học, các đợt thi cá nhân, ngữ pháp", notes: folderNotes("cua-toi") },
    { id: "viet-tat", name: "Từ viết tắt Đài Loan", sub: "Khẩu ngữ & cách nói tắt có nguồn từ điển", notes: folderNotes("viet-tat") }
  ];
  const mineFoldersHTML = mineFolders.map(f => {
    const l = f.notes.filter(n => noteLevel(n) > 0).length;
    const pct = f.notes.length ? Math.round((l / f.notes.length) * 100) : 0;
    return `
      <div class="p-space-md rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between gap-space-sm hover:border-secondary/40 transition-all">
        <div class="flex items-center justify-between">
          <span class="font-headline-md font-bold text-on-surface text-base">${esc(f.name)}</span>
          <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-jade-subtle text-secondary">
            Cá nhân
          </span>
        </div>
        <div class="text-xs text-on-surface-variant line-clamp-1">${esc(f.sub)}</div>
        <div class="flex flex-col gap-1.5 mt-1">
          <div class="flex justify-between text-xs font-medium">
            <span class="text-outline font-code">${fmt(l)} / ${fmt(f.notes.length)} mục</span>
            <span class="text-secondary font-bold">${pct}%</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
            <div class="h-full bg-secondary rounded-full transition-all duration-300" style="width:${pct}%;"></div>
          </div>
        </div>
        <div class="flex items-center justify-between pt-2 border-t border-border-subtle/50 text-xs mt-1">
          <a href="#thu-muc/${encodeURIComponent(f.id)}" class="text-secondary hover:underline font-semibold">Mở thư mục →</a>
          <a href="#nhap" class="text-xs px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-medium">+ Thêm từ</a>
        </div>
      </div>
    `;
  }).join('');

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin w-full py-space-lg flex flex-col gap-space-xl">
      <!-- Top Hero Banner: East Asian Modern Scholar Scroll -->
      <section class="relative w-full rounded-2xl overflow-hidden bg-paper-card border border-border-subtle shadow-xs p-space-lg md:p-space-xl flex flex-col md:flex-row items-center justify-between gap-space-lg">
        <div class="flex flex-col gap-space-sm max-w-2xl">
          <div class="flex items-center gap-space-xs text-primary font-label-sm text-xs font-semibold tracking-wider uppercase">
            <span class="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
            <span>Hán Ngữ Đài Loan • TOCFL 2024</span>
          </div>
          <h1 class="font-headline-lg text-3xl md:text-4xl text-on-surface font-bold tracking-tight">
            學習本 <span class="font-normal text-on-surface-variant font-serif text-2xl md:text-3xl">| Sổ học tiếng Hoa</span>
          </h1>
          <div class="p-3 md:p-4 rounded-xl bg-paper-muted border-l-4 border-primary text-sm font-serif italic text-on-surface-variant leading-relaxed">
            「學而時習之，不亦說乎。」— Học và thường xuyên ôn luyện, chẳng vui lắm sao?
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <a href="#hoc" class="w-full sm:w-auto px-6 py-3 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-all shadow-sm flex items-center justify-center gap-2 text-sm">
            <span class="material-symbols-outlined text-[20px]">play_circle</span>
            <span>Học ngay (${fmt(c.total)} thẻ)</span>
          </a>
          <a href="#tu-dien" class="w-full sm:w-auto px-5 py-3 rounded-xl bg-paper-muted text-on-surface font-semibold hover:bg-surface-container transition-all flex items-center justify-center gap-2 text-sm">
            <span class="material-symbols-outlined text-[18px]">search</span>
            <span>Tra từ điển</span>
          </a>
        </div>
      </section>

      <!-- Key Metrics Bento Row -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-space-md">
        <!-- Metric 1: Streak -->
        <div class="p-space-md rounded-2xl bg-cinnabar-subtle/60 border border-cinnabar-subtle flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase text-primary">Chuỗi học tập</span>
            <span class="material-symbols-outlined text-primary text-[20px]">local_fire_department</span>
          </div>
          <div class="mt-2">
            <div class="font-headline-lg text-2xl md:text-3xl font-bold text-primary">${summary.current} <small class="text-xs font-normal">ngày</small></div>
            <div class="text-[11px] text-on-surface-variant mt-0.5">Kỷ lục: ${summary.longest} ngày liên tục</div>
          </div>
        </div>

        <!-- Metric 2: Mastered Words -->
        <div class="p-space-md rounded-2xl bg-jade-subtle/60 border border-jade-subtle flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase text-secondary">Từ đã học</span>
            <span class="material-symbols-outlined text-secondary text-[20px]">verified</span>
          </div>
          <div class="mt-2">
            <div class="font-headline-lg text-2xl md:text-3xl font-bold text-secondary">${fmt(learned)} <small class="text-xs font-normal">từ</small></div>
            <div class="text-[11px] text-on-surface-variant mt-0.5">${fmt(lv[4] + lv[5])} từ mức nhớ lâu & thông thạo</div>
          </div>
        </div>

        <!-- Metric 3: Today's Target -->
        <div class="p-space-md rounded-2xl bg-amber-subtle/60 border border-amber-subtle flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase text-tertiary">Thẻ hôm nay</span>
            <span class="material-symbols-outlined text-tertiary text-[20px]">schedule</span>
          </div>
          <div class="mt-2">
            <div class="font-headline-lg text-2xl md:text-3xl font-bold text-tertiary">${fmt(c.due)} <small class="text-xs font-normal">ôn</small> · ${fmt(c.fresh)} <small class="text-xs font-normal">mới</small></div>
            <div class="text-[11px] text-on-surface-variant mt-0.5">Đã trả lời ${fmt(st.reviews)} lượt hôm nay</div>
          </div>
        </div>

        <!-- Metric 4: Daily Study Time -->
        <div class="p-space-md rounded-2xl bg-paper-card border border-border-subtle flex flex-col justify-between shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase text-outline">Thời lượng học</span>
            <span class="material-symbols-outlined text-outline text-[20px]">timer</span>
          </div>
          <div class="mt-2">
            <div class="font-headline-lg text-2xl md:text-3xl font-bold text-on-surface">~${studyMinutes} <small class="text-xs font-normal">phút</small></div>
            <div class="text-[11px] text-on-surface-variant mt-0.5">Tổng cộng ${fmt(summary.answers)} câu đã ôn</div>
          </div>
        </div>
      </div>

      <!-- LỘ TRÌNH HẰNG NGÀY (DAILY ROADMAP WITH 3 MISSIONS + GOAL STEPPER) -->
      <section class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-space-sm border-b border-border-subtle">
          <div>
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
              <h2 class="font-headline-md text-xl md:text-2xl font-bold text-on-surface">Lộ trình học tập hôm nay</h2>
            </div>
            <p class="text-xs text-on-surface-variant mt-0.5">Mục tiêu hằng ngày giúp bạn duy trì phản xạ và tiến bộ đều đặn.</p>
          </div>
          <button type="button" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-paper-muted hover:bg-surface-container text-xs font-semibold text-on-surface transition-colors" id="btnToggleGoalEdit">
            <span class="material-symbols-outlined text-[16px]">tune</span>
            <span>Điều chỉnh mục tiêu</span>
          </button>
        </div>

        <!-- Collapsible Goal Edit Box -->
        <div class="p-space-md rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-space-md" id="goalEditBox" hidden>
          <div class="flex items-center justify-between">
            <span class="font-label-md text-sm font-semibold text-on-surface">Đặt mục tiêu học tập mỗi ngày:</span>
            <span class="text-xs text-outline">Tự do tăng/giảm thẻ theo thời gian của bạn</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            <!-- Thẻ mới input with steppers -->
            <div class="bg-paper-card p-3 rounded-xl border border-border-subtle flex flex-col gap-2">
              <label class="text-xs font-semibold text-on-surface-variant">Thẻ mới mỗi ngày (tối đa 200):</label>
              <div class="flex items-center gap-2">
                <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-cinnabar-subtle text-primary font-bold text-base flex items-center justify-center btn-stepper" data-step="new" data-delta="-5">-</button>
                <input type="number" id="goalNewCards" min="1" max="200" value="${targetNew}" class="flex-1 py-1 px-3 text-center rounded-lg border border-border-subtle font-code font-bold text-primary text-base">
                <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-cinnabar-subtle text-primary font-bold text-base flex items-center justify-center btn-stepper" data-step="new" data-delta="5">+</button>
              </div>
            </div>

            <!-- Thẻ ôn input with steppers -->
            <div class="bg-paper-card p-3 rounded-xl border border-border-subtle flex flex-col gap-2">
              <label class="text-xs font-semibold text-on-surface-variant">Chỉ tiêu ôn thẻ mỗi ngày (tối đa 500):</label>
              <div class="flex items-center gap-2">
                <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-jade-subtle text-secondary font-bold text-base flex items-center justify-center btn-stepper" data-step="rev" data-delta="-10">-</button>
                <input type="number" id="goalReviewCards" min="5" max="500" value="${targetRev}" class="flex-1 py-1 px-3 text-center rounded-lg border border-border-subtle font-code font-bold text-secondary text-base">
                <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-jade-subtle text-secondary font-bold text-base flex items-center justify-center btn-stepper" data-step="rev" data-delta="10">+</button>
              </div>
            </div>
          </div>

          <!-- Presets -->
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

        <!-- 3 Tasks Grid with Individual Progress Bars -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
          <!-- Task 1: Streak -->
          <div class="p-space-md rounded-2xl bg-paper-muted border border-border-subtle flex flex-col justify-between gap-3">
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-primary uppercase">Nhiệm vụ 1</span>
                <span class="material-symbols-outlined text-[18px] ${task1Done ? 'text-secondary' : 'text-outline'}">${task1Done ? 'check_circle' : 'radio_button_unchecked'}</span>
              </div>
              <h3 class="font-headline-md font-bold text-base text-on-surface">Giữ chuỗi ngày học</h3>
              <p class="text-xs text-on-surface-variant">${task1Done ? `Đã hoàn thành! Chuỗi hiện tại: ${summary.current} ngày.` : `Chưa ôn thẻ nào hôm nay. Hãy học ngay để không đứt chuỗi!`}</p>
            </div>
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-xs font-semibold">
                <span class="text-outline">Tiến độ</span>
                <span class="${task1Done ? 'text-secondary' : 'text-primary'}">${task1Pct}%</span>
              </div>
              <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div class="h-full rounded-full transition-all duration-300 ${task1Done ? 'bg-secondary' : 'bg-primary'}" style="width:${task1Pct}%;"></div>
              </div>
            </div>
          </div>

          <!-- Task 2: Reviews -->
          <div class="p-space-md rounded-2xl bg-paper-muted border border-border-subtle flex flex-col justify-between gap-3">
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-secondary uppercase">Nhiệm vụ 2</span>
                <span class="material-symbols-outlined text-[18px] ${task2Done ? 'text-secondary' : 'text-outline'}">${task2Done ? 'check_circle' : 'radio_button_unchecked'}</span>
              </div>
              <h3 class="font-headline-md font-bold text-base text-on-surface">Ôn thẻ đến hạn</h3>
              <p class="text-xs text-on-surface-variant">${task2Done ? `Đã hoàn thành xuất sắc (${fmt(reviewedToday)}/${fmt(targetRev)} thẻ)!` : `Đã ôn ${fmt(reviewedToday)} / ${fmt(targetRev)} thẻ mục tiêu.`}</p>
            </div>
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-xs font-semibold">
                <span class="text-outline">Tiến độ</span>
                <span class="${task2Done ? 'text-secondary' : 'text-primary'}">${task2Pct}%</span>
              </div>
              <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div class="h-full rounded-full transition-all duration-300 ${task2Done ? 'bg-secondary' : 'bg-primary'}" style="width:${task2Pct}%;"></div>
              </div>
            </div>
          </div>

          <!-- Task 3: Fresh Cards -->
          <div class="p-space-md rounded-2xl bg-paper-muted border border-border-subtle flex flex-col justify-between gap-3">
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-tertiary uppercase">Nhiệm vụ 3</span>
                <span class="material-symbols-outlined text-[18px] ${task3Done ? 'text-secondary' : 'text-outline'}">${task3Done ? 'check_circle' : 'radio_button_unchecked'}</span>
              </div>
              <h3 class="font-headline-md font-bold text-base text-on-surface">Học thẻ mới hôm nay</h3>
              <p class="text-xs text-on-surface-variant">${task3Done ? `Đã nạp đủ ${fmt(st.newCards)}/${fmt(targetNew)} thẻ mới!` : `Đã học ${fmt(st.newCards)} / ${fmt(targetNew)} thẻ mới.`}</p>
            </div>
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-xs font-semibold">
                <span class="text-outline">Tiến độ</span>
                <span class="${task3Done ? 'text-secondary' : 'text-primary'}">${task3Pct}%</span>
              </div>
              <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div class="h-full rounded-full transition-all duration-300 ${task3Done ? 'bg-secondary' : 'bg-primary'}" style="width:${task3Pct}%;"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 30-Day Activity Heatmap & Habit Tracker -->
      <section class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-secondary text-[20px]">calendar_month</span>
            <h2 class="font-headline-md text-lg md:text-xl font-bold text-on-surface">Biểu đồ thói quen 30 ngày qua</h2>
          </div>
          <span class="text-xs text-outline font-medium">Mỗi ô là một ngày học tập</span>
        </div>
        <div class="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-15 gap-1.5 pt-2">
          ${days30.map(d => {
            const hasRevs = d.revs > 0;
            const intensity = hasRevs ? Math.min(1, Math.max(0.2, d.revs / maxDayRevs)) : 0;
            const bg = hasRevs ? `rgba(23, 107, 75, ${0.25 + intensity * 0.75})` : 'var(--paper-muted)';
            const textColor = intensity > 0.6 ? '#ffffff' : 'var(--on-surface)';
            return `
              <div class="aspect-square rounded-lg flex flex-col items-center justify-center text-[10px] font-code transition-all hover:scale-110 shadow-2xs cursor-pointer" style="background:${bg};color:${textColor};" title="Ngày ${d.date}/${d.month}: ${d.revs} thẻ đã ôn">
                <span class="font-bold">${d.date}</span>
                <span class="text-[9px] opacity-80">${d.revs || ''}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="flex items-center justify-end gap-2 text-xs text-outline mt-1">
          <span>Ít</span>
          <span class="w-3 h-3 rounded bg-paper-muted"></span>
          <span class="w-3 h-3 rounded bg-secondary/30"></span>
          <span class="w-3 h-3 rounded bg-secondary/70"></span>
          <span class="w-3 h-3 rounded bg-secondary"></span>
          <span>Nhiều</span>
        </div>
      </section>

      <!-- TOCFL Band Progress Cards -->
      <section class="flex flex-col gap-space-md">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-headline-md text-xl md:text-2xl font-bold text-on-surface">Khung năng lực TOCFL 2024</h2>
            <p class="text-xs text-on-surface-variant mt-0.5">7 phân hạng từ vựng chuẩn do Bộ Giáo dục Đài Loan ban hành.</p>
          </div>
          <a href="#thu-muc" class="text-xs text-primary hover:underline font-semibold">Xem tất cả →</a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
          ${bandProgressHTML}
        </div>
      </section>

      <!-- Personal Collections -->
      <section class="flex flex-col gap-space-md">
        <div>
          <h2 class="font-headline-md text-xl md:text-2xl font-bold text-on-surface">Thư mục ghi chép cá nhân</h2>
          <p class="text-xs text-on-surface-variant mt-0.5">Một từ ở nhiều thư mục vẫn là một từ duy nhất: học ở đâu cũng tính cho mọi nơi.</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
          ${mineFoldersHTML}
        </div>
      </section>
    </div>
  `);

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
  document.querySelectorAll("[data-toggle-band]").forEach(btn => {
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

          <div class="flex flex-col sm:flex-row items-center gap-3 pt-space-sm">
            ${c.total > 0 ? `
              <button class="w-full sm:w-auto flex-1 h-12 px-6 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-all shadow-sm flex items-center justify-center gap-2 text-sm" id="start">
                <span class="material-symbols-outlined text-[20px]">play_circle</span>
                <span>Bắt đầu phiên học (${fmt(c.total)} thẻ)</span>
              </button>
            ` : `
              <div class="w-full p-4 rounded-xl bg-jade-subtle text-secondary font-medium flex items-center gap-2 text-sm">
                <span class="material-symbols-outlined text-[20px]">task_alt</span>
                <span>${c.q.freshTotal ? `Còn ${fmt(c.q.freshTotal)} thẻ mới chờ trong hàng đợi. Tăng chỉ tiêu thẻ mới trong Cài đặt để học thêm.` : `Đã hoàn thành toàn bộ thẻ hôm nay! Vào Thư mục để đưa thêm band vào lịch học.`}</span>
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

    const b = $("#start");
    if (b) {
      b.onclick = () => {
        S.session = { answered: 0, shown: false, start: c.total, lastNote: null };
        S.session.current = nextCard(Date.now());
        renderCard();
      };
    }
    return;
  }
  renderCard();
};

function renderCard() {
  const ss = S.session;
  if (!ss || !ss.current) {
    setView(`
      <div class="max-w-xl mx-auto px-margin py-space-2xl text-center flex flex-col items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-jade-subtle text-secondary flex items-center justify-center shadow-xs">
          <span class="material-symbols-outlined text-[36px]">verified</span>
        </div>
        <h2 class="font-headline-lg text-2xl font-bold text-on-surface">Hoàn thành phiên học!</h2>
        <p class="font-body-md text-sm text-on-surface-variant">
          Bạn đã hoàn thành xuất sắc <strong>${fmt(ss.answered)} thẻ</strong> trong phiên này. Thẻ chấm "Mới học" sẽ quay lại sau ít phút để bạn ôn củng cố.
        </p>
        <div class="flex items-center gap-3 mt-4">
          <a href="#trang-chu" class="px-6 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-colors shadow-xs text-sm">
            Về Trang chủ
          </a>
          <a href="#thu-muc" class="px-5 py-2.5 rounded-xl bg-paper-muted text-on-surface font-semibold hover:bg-surface-container transition-colors text-sm">
            Khám phá từ vựng
          </a>
        </div>
      </div>
    `);
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
                <span class="font-serif font-bold text-2xl tracking-wide">${esc(choice)}</span>
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
        <h1 class="font-headline-lg text-5xl md:text-7xl leading-tight text-on-surface tracking-wide select-all font-serif font-bold">
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
            <span class="font-body-sm text-sm text-outline">/ ${totalCards} thẻ phiên hôm nay</span>
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
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key.toLowerCase() === "r") {
    e.preventDefault();
    const r = ss.current;
    if (r && r.n && r.n.kind !== "grammar") {
      const it = itemOf(r.n);
      say((r.t === "rec" && (it.e1 || it.e2)) ? (it.e1 || it.e2) : it.w);
    }
    return;
  }
  if (!ss.shown && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    reveal();
  } else if (!ss.shown && ss.current.t === "clo") {
    const k = e.key.toLowerCase();
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
});


// =========================================================================
// 3. THƯ MỤC TỪ VỰNG & 4. LỌC NHANH (Stitch Design)
// =========================================================================
VIEWS["thu-muc"] = (id) => {
  const vocab = S.notes.filter(n => n.kind === "vocab");
  const c = todayCounts();

  // If viewing a specific folder
  if (id) {
    const isBand = S.bands.includes(id);
    const deck = S.decks.find(d => d.id === id);
    const ns = folderNotes(id);
    const title = isBand ? `TOCFL ${id} (${BAND_INFO[id] || ''})` : (id === 'cua-toi' ? 'Thư mục của tôi' : (id === 'viet-tat' ? 'Từ viết tắt' : (deck ? deck.name : id)));
    const on = folderOn(id);
    const lv = [0, 0, 0, 0, 0, 0];
    ns.forEach(n => lv[noteLevel(n)]++);
    const learnedCount = ns.filter(n => noteLevel(n) > 0).length;
    const unseen = ns.filter(n => n.kind === "vocab" && !hasProgress(n)).length;
    const groups = id === "cua-toi" ? [["all", "Tất cả"], ...S.decks.map((d) => [d.id, d.name])] : null;
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
              ${isBand ? esc(BAND_INFO[id]) + ' · ' : ''}Đã học <strong>${fmt(learnedCount)}</strong> / ${fmt(ns.length)} mục (${ns.length ? Math.round(learnedCount / ns.length * 100) : 0}%)
              ${LEVELS.map((l, i) => lv[i] ? ` · ${l}: ${lv[i]}` : '').filter(Boolean).join('')}
            </p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" class="px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-colors ${on ? 'bg-surface-container text-on-surface hover:bg-surface-container-high' : 'bg-primary-container text-white hover:bg-primary'}" id="toggleLearn">
              ${on ? 'Tạm dừng học thư mục này' : isBand ? '+ Đưa band này vào lịch học' : '+ Học thư mục này'}
            </button>
            ${unseen ? `
              <a class="px-4 py-2 rounded-xl text-xs font-semibold bg-jade-subtle text-secondary border border-secondary/30 hover:bg-secondary-fixed transition-colors flex items-center gap-1 shadow-xs" href="#loc-nhanh/${encodeURIComponent(id)}">
                <span class="material-symbols-outlined text-[16px]">filter_alt</span>
                <span>Lọc nhanh: ${fmt(unseen)} từ chưa học</span>
              </a>
            ` : ''}
          </div>
        </div>

        <!-- Filter and Search Controls -->
        <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle shadow-xs flex flex-col gap-3">
          ${groups ? `
            <div class="flex items-center gap-2 flex-wrap" id="grp">
              ${groups.map(([v, t]) => `
                <button type="button" class="px-3 py-1 rounded-lg text-xs font-semibold transition-colors border ${v === "all" ? "bg-primary-container text-white border-transparent" : "bg-paper-muted text-on-surface border-border-subtle hover:bg-surface-container"}" data-v="${esc(v)}">
                  ${esc(t)}
                </button>
              `).join('')}
            </div>
          ` : ''}
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
      const filtered = ns.filter(n => (grp === "all" || (n.rich && n.deck.id === grp)) && (!f || fold(itemOf(n).w).includes(f) || fold(itemOf(n).py).includes(f) || fold(meaningOf(n)).includes(f)));
      $("#flist").innerHTML = filtered.map(n => {
        const it = itemOf(n);
        const lvl = noteLevel(n);
        const ab = S.abbrS.get(n.w);
        return `
          <div class="p-space-md rounded-2xl bg-paper-card border border-border-subtle shadow-xs hover:border-primary/40 hover:shadow-sm transition-all flex flex-col justify-between gap-2">
            <div class="flex items-start justify-between">
              <div>
                <a href="#tu/${encodeURIComponent(it.w)}" class="font-headline-md text-2xl text-on-surface font-serif font-bold hover:text-primary">${esc(n.basic ? n.display : it.w)}</a>
                <span class="font-code text-xs text-tertiary ml-2">${esc(it.py || '')}</span>
              </div>
              <span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span>
            </div>
            <div class="text-xs text-on-surface-variant line-clamp-2">
              ${esc(meaningOf(n) || '…')}
            </div>
            ${ab ? `<div class="text-[11px] text-tertiary">Nói tắt của: <span class="font-serif font-semibold">${esc(ab.f)}</span></div>` : ''}
            <div class="pt-2 border-t border-border-subtle/50 flex items-center justify-between text-xs">
              <span class="text-outline">${n.kind === "grammar" ? "Ngữ pháp" : (it.pos || "Từ vựng")}</span>
              <a href="#tu/${encodeURIComponent(it.w)}" class="text-primary hover:underline font-semibold">Chi tiết →</a>
            </div>
          </div>
        `;
      }).join('') || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy mục nào khớp.</div>`;
    };

    $("#fq").oninput = draw;
    $("#toggleLearn").onclick = async () => {
      setFolderOn(id, !on);
      await saveSettings();
      VIEWS["thu-muc"](id);
    };
    if (groups) {
      document.querySelectorAll("#grp button").forEach(b => {
        b.onclick = () => {
          grp = b.dataset.v;
          document.querySelectorAll("#grp button").forEach(btn => {
            btn.className = btn.dataset.v === grp ? "px-3 py-1 rounded-lg text-xs font-semibold bg-primary-container text-white border-transparent" : "px-3 py-1 rounded-lg text-xs font-semibold bg-paper-muted text-on-surface border-border-subtle hover:bg-surface-container";
          });
          draw();
        };
      });
    }
    draw();
    return;
  }

  // Main Directory Grid
  const deckCardsHTML = [
    ...S.bands.map(b => {
      const ns = vocab.filter(n => inBand(n, b));
      const l = ns.filter(n => noteLevel(n) > 0).length;
      const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
      const isLearning = !!S.settings.bands[b];
      return `
        <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col justify-between gap-space-md hover:shadow-sm transition-all">
          <div class="flex flex-col gap-space-xs">
            <div class="flex items-center justify-between">
              <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${isLearning ? 'bg-jade-subtle text-secondary' : 'bg-surface-container text-on-surface-variant'}">
                <span class="w-1.5 h-1.5 rounded-full ${isLearning ? 'bg-secondary' : 'bg-outline'}"></span>
                ${isLearning ? 'Đang học' : 'Chưa bật'}
              </span>
              <span class="font-code text-xs text-outline">TOCFL 2024</span>
            </div>
            <h3 class="font-headline-md text-xl font-bold text-on-surface mt-1">
              TOCFL ${b}
            </h3>
            <p class="font-body-sm text-xs text-on-surface-variant line-clamp-2">
              ${BAND_INFO[b] || 'Bộ từ vựng chuẩn do Bộ Giáo dục Đài Loan ban hành.'}
            </p>
          </div>
          <div class="flex flex-col gap-1.5">
            <div class="flex justify-between text-xs font-medium">
              <span class="text-outline font-code">${fmt(l)} / ${fmt(ns.length)} từ</span>
              <span class="text-primary font-bold">${pct}%</span>
            </div>
            <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
              <div class="h-full bg-primary rounded-full transition-all duration-300" style="width:${pct}%;"></div>
            </div>
          </div>
          <div class="flex items-center justify-between pt-4 border-t border-border-subtle/50">
            <a href="#thu-muc/${encodeURIComponent(b)}" class="text-xs text-primary hover:underline font-semibold">Mở danh sách từ →</a>
            <button type="button" class="text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${isLearning ? 'border-border-subtle hover:bg-surface-container text-on-surface' : 'bg-primary-container text-white border-transparent hover:bg-primary'}" data-toggle-band="${b}">
              ${isLearning ? 'Tạm dừng' : '+ Đưa vào học'}
            </button>
          </div>
        </div>
      `;
    }),
    `
      <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col justify-between gap-space-md hover:shadow-sm transition-all">
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-center justify-between">
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-jade-subtle text-secondary">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
              Sổ cá nhân
            </span>
          </div>
          <h3 class="font-headline-md text-xl font-bold text-on-surface mt-1">
            Thư mục của tôi
          </h3>
          <p class="font-body-sm text-xs text-on-surface-variant line-clamp-2">
            Từ vựng ghi chép trên lớp, giáo trình ngoài và các đợt thi cá nhân.
          </p>
        </div>
        <div class="flex items-center justify-between pt-4 border-t border-border-subtle/50">
          <a href="#thu-muc/cua-toi" class="text-xs text-primary hover:underline font-semibold">Xem ${fmt(folderNotes("cua-toi").length)} mục →</a>
          <a href="#nhap" class="text-xs px-3 py-1.5 rounded-lg bg-paper-muted text-on-surface font-semibold hover:bg-surface-container transition-colors">+ Thêm từ</a>
        </div>
      </div>
    `,
    `
      <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col justify-between gap-space-md hover:shadow-sm transition-all">
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-center justify-between">
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-subtle text-tertiary">
              <span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
              Khẩu ngữ
            </span>
          </div>
          <h3 class="font-headline-md text-xl font-bold text-on-surface mt-1">
            Từ viết tắt Đài Loan
          </h3>
          <p class="font-body-sm text-xs text-on-surface-variant line-clamp-2">
            Cách nói tắt có nguồn từ điển Bộ GD Đài Loan (萌典) & CC-CEDICT.
          </p>
        </div>
        <div class="flex items-center justify-between pt-4 border-t border-border-subtle/50">
          <a href="#thu-muc/viet-tat" class="text-xs text-primary hover:underline font-semibold">Xem ${fmt(folderNotes("viet-tat").length)} mục →</a>
          <span class="text-xs text-outline font-code">Chuẩn 萌典</span>
        </div>
      </div>
    `
  ].join('');

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin w-full py-space-xl flex flex-col gap-space-xl">
      <!-- Header Title & Actions -->
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
        <div>
          <div class="flex items-center gap-space-xs text-primary font-label-sm text-xs font-semibold tracking-wider uppercase mb-space-xs">
            <span class="w-1.5 h-3.5 bg-primary-container rounded-full"></span>
            <span>Thư Phòng Học Tập • 詞庫管理</span>
          </div>
          <h1 class="font-headline-lg text-2xl md:text-3xl text-on-surface font-bold tracking-tight">
            Quản lý Thư mục Từ vựng
          </h1>
          <p class="font-body-md text-sm text-on-surface-variant mt-1">
            Hệ thống các bộ thẻ ghi nhớ, phân hạng TOCFL 2024 và giáo trình Hán ngữ Phồn thể Đài Loan.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-space-sm">
          <a href="#nhap" class="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-paper-card border border-border-subtle text-on-surface font-semibold text-xs shadow-xs hover:bg-paper-muted transition-all">
            <span class="material-symbols-outlined text-[18px] text-tertiary">upload_file</span>
            <span>Nhập bộ từ mới</span>
          </a>
          <a href="#hoc" class="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs hover:bg-primary transition-all">
            <span class="material-symbols-outlined text-[18px]">play_circle</span>
            <span>Ôn tập toàn bộ (${fmt(c.total)} thẻ)</span>
          </a>
        </div>
      </div>

      <!-- Layout Grid: Main Cards (Left) + Sidebar Stats (Right) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-xl">
        <div class="lg:col-span-8 flex flex-col gap-space-lg">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            ${deckCardsHTML}
          </div>
        </div>

        <!-- Sidebar Stats -->
        <div class="lg:col-span-4 flex flex-col gap-space-md">
          <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-primary text-[20px]">bar_chart</span>
              <h2 class="font-headline-md text-lg font-bold text-on-surface">Thống kê Từ viện</h2>
            </div>
            <div class="flex flex-col gap-space-sm text-sm">
              <div class="p-3 rounded-xl bg-surface-container-low flex items-center justify-between">
                <span class="text-on-surface-variant">Tổng số thư mục:</span>
                <strong class="font-code text-on-surface">${S.bands.length + 2}</strong>
              </div>
              <div class="p-3 rounded-xl bg-surface-container-low flex items-center justify-between">
                <span class="text-on-surface-variant">Thẻ trong lịch học:</span>
                <strong class="font-code text-secondary">${fmt(vocab.filter(n => inLearning(n)).length)}</strong>
              </div>
              <div class="p-3 rounded-xl bg-surface-container-low flex items-center justify-between">
                <span class="text-on-surface-variant">Đến hạn ôn hôm nay:</span>
                <strong class="font-code text-primary">${fmt(c.due)}</strong>
              </div>
            </div>
            <a href="#hoc" class="w-full py-3 rounded-xl bg-primary-container text-on-primary font-semibold text-center text-sm shadow-xs hover:bg-primary transition-colors flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-[18px]">bolt</span>
              <span>Bắt đầu ôn tập (${fmt(c.total)} thẻ)</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  `);

  document.querySelectorAll("[data-toggle-band]").forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const b = btn.dataset.toggleBand;
      S.settings.bands[b] = !S.settings.bands[b];
      await saveSettings();
      VIEWS["thu-muc"]();
    };
  });
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
          <a href="#hoc" class="px-6 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-colors shadow-xs text-sm">Học ngay</a>
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
            ${it.hv ? `<div class="text-xs text-outline">Hán Việt: <strong class="text-on-surface">${it.hv}</strong></div>` : ''}
            <div class="text-base font-semibold text-on-surface">${esc(it.vn || it.en || '')}</div>
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
          <button type="button" class="hover:underline" id="btnTriUndo" ${T.hist.length ? '' : 'disabled'}>↺ Hoàn tác (Z)</button>
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
  const now = Date.now();
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
  const k = e.key.toLowerCase();
  if (k === " ") {
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
// 5. TRA TỪ & CHI TIẾT TỪ (Stitch Design)
// =========================================================================
VIEWS["tu-dien"] = (arg) => {
  setView(`
    <div class="max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
      <!-- Top Workspace Header -->
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
        <div class="flex flex-col gap-space-xs max-w-2xl">
          <div class="flex items-center gap-space-sm">
            <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
            <span class="font-label-sm text-xs text-primary uppercase tracking-widest font-semibold">Từ điển & Tra cứu</span>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-xs font-semibold">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary mr-1 animate-pulse"></span>
              TOCFL 2024 & CVDICT
            </span>
          </div>
          <h1 class="font-headline-lg text-2xl md:text-3xl text-on-surface font-bold tracking-tight">
            Tra cứu Từ vựng Phồn thể <span class="text-on-surface-variant font-normal">| 字詞檢索</span>
          </h1>
          <p class="font-body-md text-sm text-on-surface-variant">
            Tra cứu chữ Hán, pinyin không dấu, âm Hán Việt hoặc nghĩa tiếng Việt/tiếng Anh.
          </p>
        </div>
      </div>

      <!-- Search Input Container -->
      <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle shadow-xs flex flex-col gap-3">
        <div class="relative w-full">
          <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[20px]">search</span>
          <input id="dq" class="w-full pl-12 pr-10 py-3.5 rounded-xl bg-surface-container-low text-on-surface text-base placeholder:text-outline focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary/20 transition-all border border-border-subtle/50" placeholder="Ví dụ: 學生 · xuesheng · học sinh · student" value="${esc(arg || "")}" autocomplete="off">
        </div>
        <div class="flex items-center gap-2 flex-wrap text-xs text-outline">
          <span>Gợi ý bộ thủ:</span>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='言'; $('#dq').dispatchEvent(new Event('input'))">言 (Ngôn)</button>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='心'; $('#dq').dispatchEvent(new Event('input'))">心 (Tâm)</button>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='水'; $('#dq').dispatchEvent(new Event('input'))">水 (Thủy)</button>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='木'; $('#dq').dispatchEvent(new Event('input'))">木 (Mộc)</button>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='手'; $('#dq').dispatchEvent(new Event('input'))">手 (Thủ)</button>
        </div>
      </div>

      <!-- Results stats & grid -->
      <div class="text-sm font-medium text-outline" id="dcount"></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md" id="dres"></div>
    </div>
  `);

  const inp = $("#dq");
  let tmr = null;
  inp.oninput = () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => searchDict(inp.value), 150);
  };
  inp.focus();
  searchDict(inp.value);
};

function searchDict(raw) {
  const out = $("#dres"), cnt = $("#dcount");
  if (!out) return;
  const q = clean(raw);
  if (!q) {
    cnt.textContent = "";
    out.innerHTML = `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Gõ từ cần tra. Kết quả ưu tiên từ trong bảng chuẩn TOCFL trước, sau đó đến từ điển mở rộng ${S.ced ? `(${fmt(S.ced.size)} từ)` : '(đang tải...)'}.</div>`;
    return;
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
  cnt.textContent = `${fmt(Math.min(res.length, 80))}${res.length > 80 ? "+" : ""} kết quả phù hợp`;

  out.innerHTML = res.slice(0, 80).map(({ w, n }) => {
    const e = cedFirst(w);
    const py = n ? itemOf(n).py : (e ? e[0][0] : "");
    const m = n ? meaningOf(n) : enOf(w);
    const lvl = n ? noteLevel(n) : 0;
    return `
      <a class="p-space-md rounded-2xl bg-paper-card border border-border-subtle shadow-xs hover:border-primary/40 hover:shadow-sm transition-all flex flex-col justify-between gap-2" href="#tu/${encodeURIComponent(w)}">
        <div class="flex items-start justify-between">
          <div>
            <span class="font-headline-md text-2xl text-on-surface font-serif font-bold">${esc(w)}</span>
            <span class="font-code text-xs text-tertiary ml-2">${esc(py)}</span>
          </div>
          <div class="flex items-center gap-1">
            ${n ? `<span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span>` : `<span class="pill">ngoài TOCFL</span>`}
          </div>
        </div>
        <div class="text-xs text-on-surface-variant line-clamp-2">${esc(m)}</div>
        <div class="pt-2 border-t border-border-subtle/50 flex items-center justify-between text-xs text-outline">
          <span>${n ? esc(bandsOf(n).join(" · ") || "Cá nhân") : "CC-CEDICT"}</span>
          <span class="text-primary font-semibold">Xem chi tiết →</span>
        </div>
      </a>
    `;
  }).join("") || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy từ khớp. Thử gõ chữ Hán Phồn thể hoặc pinyin không dấu.</div>`;
}

// ---------------- CHI TIẾT TỪ VỰNG (#tu/:word) ----------------
VIEWS["tu"] = (w) => {
  const n = S.noteByWord.get(w);
  const e = cedFirst(w);
  const inLearn = n && inLearning(n);
  const it = n ? itemOf(n) : { w, py: (e ? e[0][0] : ""), vn: "", en: (e ? e[0][1].split("/").join("; ") : ""), pos: "", band: "" };
  const chars = [...new Set([...hanOnly(w)])];
  const containing = (c) => S.notes.filter((x) => x.kind === "vocab" && x.w.includes(c) && x.w !== w).slice(0, 8);
  const curLvl = n ? noteLevel(n) : 0;

  setView(`
    <div class="max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
      <div class="flex items-center gap-2">
        <a href="#tu-dien" class="text-primary hover:underline text-sm font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Tra từ điển</span>
        </a>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <!-- Main Column (8 cols) -->
        <div class="lg:col-span-8 flex flex-col gap-space-md">
          <!-- Main Word Entry Showcase -->
          <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md relative overflow-hidden">
            <div class="absolute top-4 right-6 font-serif text-[100px] text-primary select-none pointer-events-none opacity-5 leading-none">
              ${w[0] || '學'}
            </div>

            <div class="flex items-center justify-between gap-space-sm flex-wrap">
              <div class="flex items-center gap-2 flex-wrap">
                ${n ? `<span class="px-2.5 py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-xs font-semibold">TOCFL ${esc(bandsOf(n).join(' · ') || 'Cá nhân')}</span>` : '<span class="px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-xs">Mở rộng CC-CEDICT</span>'}
                ${it.pos ? `<span class="px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-xs">${esc(it.pos)}</span>` : ''}
                ${it.hv ? `<span class="px-2.5 py-0.5 rounded-full bg-paper-muted text-on-surface font-code text-xs">Hán Việt: <strong>${esc(it.hv)}</strong></span>` : ''}
              </div>
              <div class="flex items-center gap-2">
                ${n ? `
                  <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${inLearn ? 'bg-jade-subtle text-secondary border border-secondary/30' : 'bg-primary-container text-white hover:bg-primary'}" id="addLearn">
                    ${inLearn ? '✓ Đang trong lịch học' : '+ Thêm vào lịch học'}
                  </button>
                ` : ''}
              </div>
            </div>

            <div class="flex items-baseline gap-4 flex-wrap mt-2">
              <h1 class="font-headline-lg text-5xl md:text-6xl text-on-surface font-serif font-bold select-all">${esc(w)}</h1>
              <div class="flex items-center gap-3">
                <span class="font-code text-2xl text-tertiary font-bold">${esc(it.py)}</span>
                <button type="button" class="w-10 h-10 rounded-full bg-jade-subtle hover:bg-secondary-fixed text-secondary flex items-center justify-center transition-colors shadow-2xs" onclick="say('${esc(w)}')" title="Phát âm tiếng Đài">
                  <span class="material-symbols-outlined text-[22px]">volume_up</span>
                </button>
              </div>
            </div>

            <!-- Meaning -->
            <div class="flex flex-col gap-1 pt-3 border-t border-border-subtle">
              <span class="text-xs uppercase font-semibold text-outline">Nghĩa tiếng Việt</span>
              <div class="text-xl font-headline-md text-on-surface font-semibold">
                ${esc(it.vn || it.en || 'Chưa có định nghĩa tiếng Việt')}
              </div>
              ${it.en ? `<div class="text-sm text-on-surface-variant font-body-sm mt-0.5">${esc(it.en)}</div>` : ''}
            </div>

            <!-- Examples -->
            ${it.e1 || it.e2 ? `
              <div class="p-space-md rounded-xl bg-paper-muted border border-border-subtle flex flex-col gap-2 mt-2">
                <div class="flex items-center justify-between text-xs text-secondary font-semibold uppercase">
                  <span>Ví dụ thực tế</span>
                  <button type="button" class="text-secondary hover:text-primary" onclick="say('${esc(it.e1 || it.e2)}')" title="Nghe câu">
                    <span class="material-symbols-outlined text-[18px]">volume_up</span>
                  </button>
                </div>
                <div class="font-serif text-lg text-on-surface">${ruby(it.e1 || it.e2)}</div>
                ${(it.e1p || it.e2p) ? `<div class="font-code text-xs text-on-surface-variant">${esc(it.e1p || it.e2p)}</div>` : ''}
                ${(it.e1v || it.e2v) ? `<div class="text-xs text-on-surface font-medium">${esc(it.e1v || it.e2v)}</div>` : ''}
              </div>
            ` : ''}

            <!-- 6 Memory Rating Buttons for this word -->
            ${n ? `
              <div class="pt-space-md border-t border-border-subtle flex flex-col gap-2 mt-2">
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
                  }).join('')}
                </div>
                <div id="levelStatus" class="text-xs text-secondary text-center font-semibold mt-1"></div>
              </div>
            ` : ''}
          </div>

          <!-- CC-CEDICT English Definitions -->
          ${e ? `
            <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-2">
              <h3 class="font-headline-md text-base font-bold text-on-surface">Từ điển giải nghĩa Anh-Hoa (CC-CEDICT)</h3>
              <div class="flex flex-col gap-2 text-sm">
                ${e.map(([py, defs]) => `
                  <div class="p-2.5 rounded-xl bg-surface-container-low flex flex-col sm:flex-row sm:items-baseline gap-2">
                    <span class="font-code text-xs font-bold text-tertiary sm:w-28 shrink-0">${esc(py)}</span>
                    <span class="text-on-surface">${esc(defs.replace(/\\[[^\\]]*\\d\\]/g, "").split("/").join("; "))}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Sidebar Column: Strokes & Related Words (4 cols) -->
        <div class="lg:col-span-4 flex flex-col gap-space-md">
          <!-- Stroke Order Box (Hanzi Writer) -->
          <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-primary text-[20px]">draw</span>
              <h3 class="font-headline-md text-base font-bold text-on-surface">Thứ tự nét viết chữ Hán</h3>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-4 py-2">
              ${chars.map((c, k) => `
                <div class="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-surface-container-low border border-border-subtle shadow-2xs">
                  <div id="wordHw${k}"></div>
                  <span class="font-headline-md font-bold text-sm text-on-surface">${esc(c)}</span>
                  <div class="flex gap-1">
                    <button type="button" class="text-xs px-2.5 py-1 rounded-lg bg-paper-card hover:bg-cinnabar-subtle text-primary font-medium border border-border-subtle" data-anim-w="${k}">Xem nét</button>
                    <button type="button" class="text-xs px-2.5 py-1 rounded-lg bg-paper-card hover:bg-jade-subtle text-secondary font-medium border border-border-subtle" data-quiz-w="${k}">Viết thử</button>
                  </div>
                </div>
              `).join('')}
            </div>
            <div class="text-[11px] text-outline text-center">Nét vẽ tương tác theo quy chuẩn Bộ Giáo dục Đài Loan.</div>
          </div>

          <!-- Related Words Containing Characters -->
          ${chars.map((c) => {
            const cs = containing(c);
            if (!cs.length) return '';
            return `
              <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-2">
                <div class="text-xs font-semibold text-outline uppercase">Từ chứa chữ <strong class="text-on-surface font-serif text-sm">${c}</strong></div>
                <div class="flex flex-wrap gap-1.5 pt-1">
                  ${cs.map((x) => `
                    <a class="px-2.5 py-1 rounded-lg bg-surface-container-low hover:bg-surface-container text-xs font-medium text-on-surface border border-border-subtle/50 flex items-center gap-1" href="#tu/${encodeURIComponent(x.w)}">
                      <span class="font-serif font-bold">${esc(x.w)}</span>
                      <span class="font-code text-[11px] text-tertiary">${esc(itemOf(x).py)}</span>
                    </a>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `);

  // Initialize Hanzi Writer
  chars.forEach((c, k) => {
    const el = $("#wordHw" + k);
    if (el && window.HanziWriter) {
      const writer = HanziWriter.create(el, c, {
        width: 110, height: 110, padding: 5, showOutline: true,
        strokeColor: "#86090a", outlineColor: "#EBE2D8", highlightColor: "#176b4b",
        charDataLoader: (ch, onLoad, onErr) => strokeData(ch).then(onLoad).catch(onErr)
      });
      const btnAnim = $(`[data-anim-w="${k}"]`);
      if (btnAnim) btnAnim.onclick = () => writer.animateCharacter();
      const btnQuiz = $(`[data-quiz-w="${k}"]`);
      if (btnQuiz) btnQuiz.onclick = () => writer.quiz();
    }
  });

  const add = $("#addLearn");
  if (add && n) {
    add.onclick = async () => {
      S.settings.extra[n.w] = true;
      await saveSettings();
      VIEWS["tu"](w);
    };
  }

  if (n) {
    bindLevelPicker(n, () => {
      VIEWS["tu"](w);
    });
  }
};

// =========================================================================
// 6. CHÉP CHÍNH TẢ & 7. THI THỬ TOCFL (Stitch Design)
// =========================================================================
VIEWS["chinh-ta"] = () => {
  const d = S.dict;
  d.score = d.score || { ok: 0, total: 0 };
  const sources = ["Tất cả", "Câu ví dụ trong thẻ", ...(S.packs || []).map((p) => p.name)];

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
      <!-- Page Header -->
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
        <div>
          <div class="flex items-center gap-space-xs text-secondary font-label-sm text-xs font-semibold tracking-wider uppercase mb-space-xs">
            <span class="w-1.5 h-3.5 bg-secondary rounded-full"></span>
            <span>Luyện Thính Lực &amp; Viết • 聽寫訓練</span>
          </div>
          <h1 class="font-headline-lg text-2xl md:text-3xl text-on-surface font-bold tracking-tight">
            Chép chính tả tiếng Hoa Phồn thể
          </h1>
          <p class="font-body-md text-sm text-on-surface-variant mt-1">
            Nghe câu rồi viết lại. Hệ thống ưu tiên câu chứa từ bạn đang học hoặc hay quên, so sánh từng ký tự sai bằng thuật toán LCS.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div class="px-3.5 py-1.5 rounded-xl bg-paper-card border border-border-subtle shadow-xs text-xs font-semibold text-outline">
            Đúng: <strong class="text-secondary font-bold" id="dictScore">${d.score.ok}/${d.score.total}</strong>
          </div>
        </div>
      </div>

      <!-- Controls Ribbon -->
      <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
        <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
          <span>Cách trả lời:</span>
          <select id="dm" class="py-2 px-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-xs font-medium">
            <option value="han" ${d.mode === "han" ? "selected" : ""}>Gõ chữ Hán</option>
            <option value="paper" ${d.mode === "paper" ? "selected" : ""}>Viết ra giấy rồi tự chấm</option>
            <option value="word" ${d.mode === "word" ? "selected" : ""}>Chỉ chép từ (không cả câu)</option>
          </select>
        </label>

        <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
          <span>Theo Band TOCFL:</span>
          <select id="dband" class="py-2 px-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-xs font-medium">
            <option value="all" ${d.band === "all" ? "selected" : ""}>Mọi band</option>
            ${S.bands.map((b) => `<option value="${esc(b)}" ${d.band === b ? "selected" : ""}>TOCFL ${esc(b)}</option>`).join("")}
          </select>
        </label>

        <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
          <span>Nguồn câu:</span>
          <select id="dsrc" class="py-2 px-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-xs font-medium">
            ${sources.map((s) => `<option ${d.src === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
        </label>

        <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
          <span>Tốc độ đọc:</span>
          <select id="dsp" class="py-2 px-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-xs font-medium">
            <option value="0.9" ${String(d.speed) === "0.9" ? "selected" : ""}>Bình thường (0.9x)</option>
            <option value="0.7" ${String(d.speed) === "0.7" ? "selected" : ""}>Chậm (0.7x)</option>
            <option value="0.55" ${String(d.speed) === "0.55" ? "selected" : ""}>Rất chậm (0.55x)</option>
          </select>
        </label>
      </div>

      <!-- Main Dictation Workplace: 2 Columns -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <!-- Left: Dictation Workspace -->
        <div class="lg:col-span-8 flex flex-col gap-space-md">
          <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-lg" id="dictCard">
            <!-- Audio Player Banner -->
            <div class="p-space-md md:p-space-lg rounded-2xl bg-paper-muted border border-border-subtle flex flex-col sm:flex-row items-center justify-between gap-space-md">
              <div class="flex items-center gap-space-md">
                <button type="button" class="w-14 h-14 rounded-2xl bg-primary-container text-white flex items-center justify-center hover:bg-primary transition-all shadow-sm active:scale-95 shrink-0" id="btnPlaySentence">
                  <span class="material-symbols-outlined text-[28px]">volume_up</span>
                </button>
                <div class="flex flex-col">
                  <span class="font-headline-md font-bold text-base text-on-surface">Đoạn âm tiếng Đài Chuẩn</span>
                  <span class="text-xs text-outline mt-0.5">Bấm nút hoặc nhấn phím <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">R</kbd> để nghe lại</span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" class="px-3.5 py-2 rounded-xl bg-paper-card border border-border-subtle hover:bg-surface-container text-xs font-semibold text-on-surface transition-colors" id="btnNextSentence">
                  Bỏ qua / Câu khác →
                </button>
              </div>
            </div>

            <!-- Typing Area or Paper Evaluation Area -->
            <div id="dictExerciseArea" class="flex flex-col gap-space-md"></div>
          </div>
        </div>

        <!-- Right: Custom Packs & Info -->
        <div class="lg:col-span-4 flex flex-col gap-space-md">
          <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-secondary text-[20px]">folder_special</span>
              <h3 class="font-headline-md font-bold text-base text-on-surface">Bộ câu tự nhập (${(S.packs || []).length})</h3>
            </div>
            <p class="text-xs text-on-surface-variant leading-relaxed">
              Bạn có thể nạp các bộ câu .json trích từ giáo trình hay đề thi riêng vào trình duyệt của bạn.
            </p>
            <div class="flex flex-col gap-2 pt-2 border-t border-border-subtle">
              <label class="cursor-pointer inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-colors">
                <span class="material-symbols-outlined text-[18px]">upload_file</span>
                <span>Nạp tệp bộ câu (.json)</span>
                <input type="file" id="dpackFile" accept=".json,application/json" class="hidden">
              </label>
              ${(S.packs || []).map((p, idx) => `
                <div class="p-2.5 rounded-xl bg-surface-container-low flex items-center justify-between text-xs">
                  <span class="font-medium truncate max-w-[180px]">${esc(p.name)} (${(p.items || []).length} câu)</span>
                  <button type="button" class="text-primary hover:underline" data-rmpack="${idx}">Xóa</button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  // Bind settings change
  $("#dm").onchange = (e) => { d.mode = e.target.value; pickSentence(); };
  $("#dband").onchange = (e) => { d.band = e.target.value; pickSentence(); };
  $("#dsrc").onchange = (e) => { d.src = e.target.value; pickSentence(); };
  $("#dsp").onchange = (e) => { d.speed = Number(e.target.value); };

  // Pack file uploader
  $("#dpackFile").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      if (!Array.isArray(obj.items)) throw new Error("File phải có trường 'items' là mảng các câu.");
      S.packs = S.packs || [];
      S.packs.push({ name: obj.name || f.name.replace(/\.json$/i, ""), items: obj.items });
      await Store.put("kv", "packs", S.packs);
      VIEWS["chinh-ta"]();
    } catch (err) {
      alert("Lỗi đọc file bộ câu: " + err.message);
    }
  };

  document.querySelectorAll("[data-rmpack]").forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.rmpack);
      S.packs.splice(idx, 1);
      await Store.put("kv", "packs", S.packs);
      VIEWS["chinh-ta"]();
    };
  });

  // Longest Common Subsequence (LCS) comparison for dictation
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

  // Pick weighted sentence
  function pickSentence() {
    const bank = sentenceBank();
    const mode = d.mode || "han";
    const band = d.band || "all";
    const src = d.src || "Tất cả";

    let candidates = bank.filter((s) => {
      if (src !== "Tất cả" && (src === "Câu ví dụ trong thẻ" ? s.src !== "cards" : s.src !== src)) return false;
      if (band !== "all" && s.note && !inBand(s.note, band)) return false;
      return true;
    });

    if (!candidates.length) candidates = bank;
    if (!candidates.length) {
      $("#dictExerciseArea").innerHTML = `<div class="p-6 text-center text-sm text-outline">Chưa có câu ví dụ nào trong các thẻ đang học.</div>`;
      return;
    }

    const cur = candidates[Math.floor(Math.random() * candidates.length)];
    d.cur = cur;
    d.checked = false;

    renderExercise();

    const target = (mode === "word" && cur.note) ? cur.note.w : cur.zh;
    say(target, d.speed || 0.9);
  }

  function renderExercise() {
    const cur = d.cur;
    if (!cur) return;
    const mode = d.mode || "han";
    const target = (mode === "word" && cur.note) ? cur.note.w : cur.zh;

    const area = $("#dictExerciseArea");
    if (!d.checked) {
      area.innerHTML = `
        <div class="flex flex-col gap-3">
          ${mode === "paper" ? `
            <div class="p-4 rounded-xl bg-amber-subtle text-tertiary text-sm font-medium">
              Lấy giấy bút ra và viết câu bạn vừa nghe được. Sau khi viết xong, bấm nút "Xem đáp án" để tự chấm đối chiếu.
            </div>
            <button type="button" class="py-3 px-6 rounded-xl bg-primary-container text-white font-semibold text-sm hover:bg-primary shadow-xs" id="btnRevealDict">
              Xem đáp án &amp; Chấm điểm
            </button>
          ` : `
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-semibold text-outline">Gõ lại bằng chữ Hán Phồn thể:</span>
              <input type="text" id="dictInput" class="w-full p-3.5 rounded-xl bg-surface-container-low border border-border-subtle text-lg font-serif text-on-surface focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary/20" placeholder="Gõ câu nghe được vào đây..." autocomplete="off">
            </label>
            <button type="button" class="py-3 px-6 rounded-xl bg-primary-container text-white font-semibold text-sm hover:bg-primary shadow-xs" id="btnCheckDict">
              Kiểm tra câu trả lời
            </button>
          `}
        </div>
      `;

      const inp = $("#dictInput");
      if (inp) {
        inp.focus();
        inp.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            $("#btnCheckDict")?.click();
          }
        };
      }

      const btnCheck = $("#btnCheckDict");
      if (btnCheck) {
        btnCheck.onclick = () => {
          const rawVal = inp?.value || "";
          const userText = clean(rawVal);
          const cleanTarget = clean(target);
          d.checked = true;
          d.userText = rawVal;
          const isCorrect = userText && (userText === cleanTarget);
          d.score.total++;
          if (isCorrect) {
            d.score.ok++;
            playChime(true);
          } else {
            playChime(false);
          }
          renderExercise();
          say(target, d.speed || 0.9);
        };
      }

      const btnRev = $("#btnRevealDict");
      if (btnRev) {
        btnRev.onclick = () => {
          d.checked = true;
          d.userText = "";
          renderExercise();
          say(target, d.speed || 0.9);
        };
      }
    } else {
      // Checked view
      const userText = d.userText || "";
      const diffHTML = diffMarks(target, userText);
      const isCorrect = clean(userText) === clean(target);
      const segmented = segment(target);

      area.innerHTML = `
        <div class="flex flex-col gap-4">
          <div class="p-4 rounded-xl ${isCorrect ? 'bg-jade-subtle border border-jade-subtle text-secondary' : 'bg-paper-muted border border-border-subtle text-on-surface'} flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs font-bold uppercase">
              <span class="${isCorrect ? 'text-secondary' : 'text-primary'}">${isCorrect ? '✓ Hoàn toàn chính xác!' : 'Đáp án đối chiếu (chữ đỏ là chưa khớp):'}</span>
              <span class="font-code">${clean(userText) ? `${clean(userText).length}/${clean(target).length} chữ` : ''}</span>
            </div>
            <div class="font-serif text-2xl md:text-3xl font-medium leading-relaxed">${diffHTML}</div>
            ${cur.py ? `<div class="font-code text-sm text-tertiary font-semibold">${esc(cur.py)}</div>` : ''}
            ${cur.vn ? `<div class="text-sm text-on-surface font-medium">${esc(cur.vn)}</div>` : ''}
          </div>

          <!-- Clickable Tokens to open dictionary -->
          <div class="flex flex-col gap-1.5">
            <span class="text-xs text-outline font-semibold uppercase">Bấm vào từ vựng để mở từ điển tra cứu:</span>
            <div class="flex flex-wrap gap-2">
              ${segmented.map(tok => `
                <a href="#tu/${encodeURIComponent(tok.t)}" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-cinnabar-subtle hover:text-primary text-xs font-serif font-bold text-on-surface border border-border-subtle/50 transition-colors">
                  ${esc(tok.t)}
                </a>
              `).join('')}
            </div>
          </div>

          ${mode === "paper" ? `
            <div class="flex items-center justify-between pt-2 border-t border-border-subtle">
              <span class="text-xs font-semibold text-outline">Điểm số: <strong class="text-secondary">${d.score.ok}/${d.score.total}</strong></span>
              <div class="flex items-center gap-2">
                <button type="button" class="py-2.5 px-4 rounded-xl bg-surface-container hover:bg-cinnabar-subtle text-primary font-semibold text-xs transition-colors" id="btnPaperWrong">
                  ✕ Tự nhận: Viết sai
                </button>
                <button type="button" class="py-2.5 px-5 rounded-xl bg-secondary hover:bg-secondary-fixed text-white font-semibold text-xs shadow-xs transition-colors" id="btnPaperRight">
                  ✓ Tự nhận: Viết đúng
                </button>
              </div>
            </div>
          ` : `
            <div class="flex items-center justify-between pt-2 border-t border-border-subtle">
              <span class="text-xs font-semibold text-outline">Điểm số: <strong class="text-secondary">${d.score.ok}/${d.score.total}</strong></span>
              <button type="button" class="py-2.5 px-6 rounded-xl bg-primary-container text-white font-semibold text-xs hover:bg-primary shadow-xs" id="btnNextEx">
                Luyện câu tiếp theo →
              </button>
            </div>
          `}
        </div>
      `;

      $("#dictScore").textContent = `${d.score.ok}/${d.score.total}`;
      const btnNext = $("#btnNextEx");
      if (btnNext) {
        btnNext.focus();
        btnNext.onclick = pickSentence;
      }
      const btnPaperWrong = $("#btnPaperWrong");
      if (btnPaperWrong) {
        btnPaperWrong.onclick = () => {
          d.score.total++;
          pickSentence();
        };
      }
      const btnPaperRight = $("#btnPaperRight");
      if (btnPaperRight) {
        btnPaperRight.onclick = () => {
          d.score.total++;
          d.score.ok++;
          playChime(true);
          pickSentence();
        };
      }
    }

    // Bind audio button
    const btnPlay = $("#btnPlaySentence");
    if (btnPlay) {
      btnPlay.onclick = () => {
        say(target, d.speed || 0.9);
      };
    }
  }

  $("#btnPlaySentence").onclick = () => {
    if (d.cur) {
      const mode = d.mode || "han";
      const target = (mode === "word" && d.cur.note) ? d.cur.note.w : d.cur.zh;
      say(target, d.speed || 0.9);
    }
  };
  $("#btnNextSentence").onclick = pickSentence;

  // Handle keydown for Chép chính tả (R to replay, Enter/Space to advance)
  if (!window._dictKeyBound) {
    window._dictKeyBound = true;
    document.addEventListener("keydown", (e) => {
      if (!location.hash.startsWith("#chinh-ta")) return;
      const isInput = ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
      if (!isInput && e.key.toLowerCase() === "r") {
        e.preventDefault();
        $("#btnPlaySentence")?.click();
      } else if (!isInput && (e.key === "Enter" || e.key === " ")) {
        const btnNext = $("#btnNextEx");
        if (btnNext) {
          e.preventDefault();
          btnNext.click();
        }
      }
    });
  }

  pickSentence();
};

// =========================================================================
// 7. THI THỬ TOCFL CAT-B (SC-TOP Mock Exam)
// =========================================================================
VIEWS["thi-thu"] = () => {
  const sampleQuestions = [
    {
      id: 1, part: "Nghe hiểu (聽力測驗)",
      context: "Đoạn đối thoại giữa hai đồng nghiệp tại ga tàu điện ngầm Đài Bắc.",
      zh: "請問這班捷運是開往淡水還是新店？",
      audio: "請問這班捷運是開往淡水還是新店？",
      q: "1. 根據這段對話，這位先生想去哪裡？",
      options: [
        "A. 他要去淡水老街逛逛。",
        "B. 他要去新店碧潭看風景。",
        "C. 他在確認列車行駛的方向。",
        "D. 他要搭火車去基隆港。"
      ],
      correct: 2,
      explain: "Câu hỏi '這班捷運是開往淡水還是新店' (chuyến tàu điện này đi Đạm Thủy hay Tân Điếm) thể hiện người nói đang xác nhận hướng đi của tàu."
    },
    {
      id: 2, part: "Đọc hiểu (閱讀測驗)",
      context: "Thông báo tuyển dụng tại một công ty công nghệ Đài Bắc.",
      zh: "本公司誠徵軟體工程師，具備繁體中文讀寫能力及團隊溝通經驗者尤佳。工作地點位於臺北市信義區，享勞健保及三節禮金。",
      q: "2. 這則徵才啟事主要在尋找什麼樣的人才？",
      options: [
        "A. 具備軟體開發能力與中文溝通經驗的人。",
        "B. 只要有中文能力，不需任何技術背景。",
        "C. 專門負責海外市場行銷的業務代表。",
        "D. 只能在例假日兼職實習的工讀生。"
      ],
      correct: 0,
      explain: "Đoạn văn ghi rõ: '誠徵軟體工程師，具備繁體中文讀寫能力及團隊溝通經驗者尤佳'."
    },
    {
      id: 3, part: "Đọc hiểu (閱讀測驗)",
      context: "Thông báo bảo trì tại ký túc xá Đại học Đài Loan.",
      zh: "各位住宿同學請注意：本週六上午九點至下午五點進行全棟水管清洗，屆時將暫停供水，請各位同學提早儲水備用。",
      q: "3. 根據這則公告，住宿生在週六應該做什麼？",
      options: [
        "A. 必須在週六上午搬離宿舍。",
        "B. 提早準備好需要使用的水。",
        "C. 週六全天宿舍將暫停供電。",
        "D. 所有人必須參加大掃除活動。"
      ],
      correct: 1,
      explain: "'屆時將暫停供水，請各位同學提早儲水備用' -> Sinh viên cần trữ sẵn nước để dùng."
    },
    {
      id: 4, part: "Nghe hiểu (聽力測驗)",
      context: "Đối thoại tại một quán trà sữa Đài Loan.",
      zh: "一杯珍珠奶茶，半糖去冰，內用還是外帶？",
      audio: "一杯珍珠奶茶，半糖去冰，內用還是外帶？",
      q: "4. 店員問顧客什麼問題？",
      options: [
        "A. 問他要喝幾杯飲料。",
        "B. 問他要不要加珍珠。",
        "C. 問他在店裡喝還是帶走。",
        "D. 問他什麼時候要來拿。"
      ],
      correct: 2,
      explain: "'內用還是外帶' = Uống tại quán hay mang về."
    }
  ];

  let curQ = 0;
  let userAnswers = {};
  let secondsLeft = 50 * 60; // 50 minutes

  function formatTime(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function renderExam() {
    const q = sampleQuestions[curQ];
    const total = sampleQuestions.length;

    setView(`
      <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
        <!-- Header Bar -->
        <div class="bg-paper-card rounded-2xl p-space-md md:p-space-lg border border-border-subtle shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-space-md">
          <div>
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
              <h1 class="font-headline-lg text-xl md:text-2xl font-bold text-on-surface">Luyện tập Định dạng Đề thi TOCFL Band B (Demo 4 câu)</h1>
            </div>
            <p class="text-xs text-on-surface-variant mt-0.5">Làm quen cấu trúc đề &amp; ngữ cảnh giao tiếp Đài Loan · Mô phỏng câu hỏi SC-TOP</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="font-code text-xl font-bold text-primary bg-cinnabar-subtle px-4 py-1.5 rounded-xl border border-primary/20 flex items-center gap-1.5 shadow-2xs">
              ⏱ ${formatTime(secondsLeft)}
            </div>
            <button type="button" class="px-5 py-2 rounded-xl bg-primary-container text-white font-semibold text-xs hover:bg-primary shadow-xs transition-colors" id="btnSubmitExam">
              Nộp bài (繳卷)
            </button>
          </div>
        </div>

        <!-- Informative Context Note -->
        <div class="p-3.5 rounded-xl bg-amber-subtle/80 border border-amber-300 text-tertiary text-xs flex items-start gap-2.5">
          <span class="material-symbols-outlined text-[18px] shrink-0 text-tertiary mt-0.5">info</span>
          <div>
            <strong>Lưu ý về bài luyện tập:</strong> Đây là bộ câu hỏi mẫu (4 câu) giúp bạn làm quen với cấu trúc ngữ cảnh và dạng câu hỏi thực tế của TOCFL Band B (B1/B2). Kỳ thi CAT chính thức của SC-TOP Đài Loan gồm ~70 câu (35 câu nghe + 35 câu đọc) sử dụng giải thuật thích ứng để xếp loại trình độ.
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
          <!-- Question Content (8 cols) -->
          <div class="lg:col-span-8 flex flex-col gap-space-md">
            <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
              <div class="flex items-center justify-between text-xs text-outline font-medium">
                <span class="text-primary font-bold uppercase">${esc(q.part)} · Câu ${curQ + 1} / ${total}</span>
                <span>Tương đương Band B1/B2</span>
              </div>

              ${q.audio ? `
                <div class="p-4 rounded-xl bg-paper-muted border border-border-subtle flex items-center justify-between gap-2">
                  <div class="flex items-center gap-3">
                    <button type="button" class="px-4 py-2 rounded-xl bg-jade-subtle text-secondary font-bold text-xs hover:bg-secondary-fixed transition-colors border border-secondary/20 flex items-center gap-1.5" onclick="say('${esc(q.audio)}')">
                      <span class="material-symbols-outlined text-[18px]">volume_up</span>
                      <span>▶ Nghe đoạn âm thi</span>
                    </button>
                    <span class="text-xs text-outline">Bấm để nghe âm thanh khảo thí chuẩn Đài Bắc</span>
                  </div>
                </div>
              ` : ''}

              <div class="p-4 rounded-xl bg-surface-container-low border border-border-subtle font-serif text-lg md:text-xl text-on-surface leading-relaxed">
                ${esc(q.zh)}
              </div>

              <div class="font-headline-md text-base md:text-lg font-bold text-on-surface mt-2">
                ${esc(q.q)}
              </div>

              <div class="grid gap-2.5 mt-2">
                ${q.options.map((opt, optIdx) => {
                  const isSelected = userAnswers[curQ] === optIdx;
                  return `
                    <button type="button" class="text-left p-3.5 rounded-xl border transition-all text-sm font-medium flex items-center gap-3 ${isSelected ? 'border-primary bg-cinnabar-subtle/70 text-primary font-bold shadow-2xs' : 'border-border-subtle bg-paper-card hover:bg-surface-container text-on-surface'}" onclick="VIEWS['thi-thu-ans'](${curQ}, ${optIdx})">
                      <span class="w-6 h-6 rounded-full flex items-center justify-center font-code text-xs font-bold shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-surface-container text-outline'}">
                        ${String.fromCharCode(65 + optIdx)}
                      </span>
                      <span>${esc(opt)}</span>
                    </button>
                  `;
                }).join('')}
              </div>

              <div class="flex items-center justify-between pt-4 border-t border-border-subtle mt-4">
                <button type="button" class="px-4 py-2 rounded-xl border border-border-subtle text-xs font-semibold hover:bg-surface-container ${curQ === 0 ? 'opacity-40 cursor-not-allowed' : ''}" ${curQ === 0 ? 'disabled' : ''} onclick="VIEWS['thi-thu-nav'](${curQ - 1})">
                  ← Câu trước
                </button>
                <button type="button" class="px-4 py-2 rounded-xl bg-primary-container text-white text-xs font-semibold hover:bg-primary shadow-xs ${curQ + 1 >= total ? 'opacity-40 cursor-not-allowed' : ''}" ${curQ + 1 >= total ? 'disabled' : ''} onclick="VIEWS['thi-thu-nav'](${curQ + 1})">
                  Câu tiếp theo →
                </button>
              </div>
            </div>
          </div>

          <!-- Answer Sheet Navigator (4 cols) -->
          <div class="lg:col-span-4 flex flex-col gap-space-md">
            <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
              <h3 class="font-headline-md font-bold text-base text-on-surface">Phiếu trả lời (答題卡)</h3>
              <div class="grid grid-cols-4 gap-2">
                ${sampleQuestions.map((_, idx) => {
                  const answered = userAnswers[idx] !== undefined;
                  const isCurrent = idx === curQ;
                  return `
                    <button type="button" class="py-2.5 rounded-xl font-code text-xs font-bold transition-all border ${isCurrent ? 'border-primary bg-cinnabar-subtle text-primary ring-2 ring-primary/20' : (answered ? 'border-secondary bg-jade-subtle text-secondary' : 'border-border-subtle bg-surface-container-low text-outline')}" onclick="VIEWS['thi-thu-nav'](${idx})">
                      ${idx + 1}
                    </button>
                  `;
                }).join('')}
              </div>
              <div class="text-xs text-outline flex flex-col gap-1 pt-2 border-t border-border-subtle">
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded bg-jade-subtle border border-secondary/40"></span><span>Đã trả lời</span></div>
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded bg-cinnabar-subtle border border-primary/40"></span><span>Đang làm</span></div>
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded bg-surface-container-low border border-border-subtle"></span><span>Chưa làm</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    const submitBtn = $("#btnSubmitExam");
    if (submitBtn) {
      submitBtn.onclick = () => {
        let correctCount = 0;
        let listenCorrect = 0, listenTotal = 0;
        let readCorrect = 0, readTotal = 0;

        sampleQuestions.forEach((sq, i) => {
          const isCorrect = userAnswers[i] === sq.correct;
          if (isCorrect) correctCount++;
          if (sq.part.includes("Nghe")) {
            listenTotal++;
            if (isCorrect) listenCorrect++;
          } else {
            readTotal++;
            if (isCorrect) readCorrect++;
          }
        });

        const pct = Math.round((correctCount / total) * 100);

        setView(`
          <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
            <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-sm flex flex-col gap-space-md">
              <div class="flex items-center gap-2">
                <span class="w-2 h-5 rounded-full bg-primary-container"></span>
                <h1 class="font-headline-lg text-2xl md:text-3xl font-bold text-on-surface">Kết Quả Luyện Tập Định Dạng TOCFL Band B</h1>
              </div>
              <p class="text-xs md:text-sm text-outline">Bài kiểm tra mẫu 4 câu mô phỏng phân môn Nghe &amp; Đọc hiểu chuẩn SC-TOP Đài Loan</p>

              <!-- Overall Score Bento -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-space-md my-2">
                <div class="bg-surface-container-low p-4 rounded-xl border border-border-subtle flex flex-col items-center justify-center text-center">
                  <span class="text-xs text-outline font-semibold uppercase">Tổng số câu đúng</span>
                  <span class="text-3xl font-bold font-code text-primary mt-1">${correctCount} / ${total}</span>
                  <span class="text-xs text-on-surface-variant font-medium mt-0.5">Tỷ lệ chính xác: ${pct}%</span>
                </div>
                <div class="bg-surface-container-low p-4 rounded-xl border border-border-subtle flex flex-col items-center justify-center text-center">
                  <span class="text-xs text-outline font-semibold uppercase">Phân môn Đọc hiểu (閱讀)</span>
                  <span class="text-3xl font-bold font-code text-secondary mt-1">${readCorrect} / ${readTotal}</span>
                  <span class="text-xs text-on-surface-variant font-medium mt-0.5">3 câu đọc hiểu</span>
                </div>
                <div class="bg-surface-container-low p-4 rounded-xl border border-border-subtle flex flex-col items-center justify-center text-center">
                  <span class="text-xs text-outline font-semibold uppercase">Phân môn Nghe hiểu (聽力)</span>
                  <span class="text-3xl font-bold font-code text-tertiary mt-1">${listenCorrect} / ${listenTotal}</span>
                  <span class="text-xs text-on-surface-variant font-medium mt-0.5">1 câu hội thoại</span>
                </div>
              </div>

              <!-- Important Pedagogical Disclaimer Notice -->
              <div class="p-4 rounded-xl bg-amber-subtle/80 border border-amber-300 text-tertiary text-xs md:text-sm leading-relaxed flex items-start gap-3">
                <span class="material-symbols-outlined text-[22px] shrink-0 text-tertiary mt-0.5">info</span>
                <div>
                  <strong>Thông tin chuẩn hóa khảo thí TOCFL:</strong>
                  <p class="mt-1">
                    Đây là bộ đề 4 câu demo định dạng để bạn làm quen với ngữ cảnh đời sống Đài Loan. Kỳ thi chính thức TOCFL CAT gồm ~70 câu (35 câu nghe + 35 câu đọc), sử dụng thuật toán khảo thí thích ứng máy tính (CAT - Computer Adaptive Testing) và thang điểm chuẩn 0 - 80 của Ủy ban SC-TOP. Kết quả 4 câu này không phản ánh đậu/rớt mà là chỉ số tham khảo để tiếp tục bồi dưỡng từ vựng.
                  </p>
                </div>
              </div>

              <!-- Question-by-Question Review with Explanations -->
              <div class="flex flex-col gap-3 mt-2">
                <h2 class="font-headline-md text-base font-bold text-on-surface">Chi tiết từng câu &amp; Giải thích ngữ cảnh:</h2>
                ${sampleQuestions.map((sq, i) => {
                  const isRight = userAnswers[i] === sq.correct;
                  const userAnsLabel = userAnswers[i] !== undefined ? String.fromCharCode(65 + userAnswers[i]) : "Chưa chọn";
                  const rightAnsLabel = String.fromCharCode(65 + sq.correct);
                  return `
                    <div class="p-4 rounded-xl border ${isRight ? 'border-secondary/40 bg-jade-subtle/40' : 'border-primary/40 bg-cinnabar-subtle/40'} flex flex-col gap-2">
                      <div class="flex items-center justify-between text-xs font-semibold">
                        <span class="${isRight ? 'text-secondary' : 'text-primary'} flex items-center gap-1 font-bold">
                          <span class="material-symbols-outlined text-[16px]">${isRight ? 'check_circle' : 'cancel'}</span>
                          Câu ${i + 1}: ${esc(sq.part)} — ${isRight ? 'Đúng' : 'Chưa đúng'}
                        </span>
                        <span class="font-code text-outline">Bạn chọn: <strong>${userAnsLabel}</strong> | Đáp án: <strong class="text-secondary">${rightAnsLabel}</strong></span>
                      </div>
                      <div class="font-serif text-sm font-medium text-on-surface">${esc(sq.zh)}</div>
                      <div class="text-xs font-semibold text-on-surface-variant">${esc(sq.q)}</div>
                      <div class="text-xs text-outline bg-paper-card p-2.5 rounded-lg border border-border-subtle/50 mt-1">
                        💡 <strong>Giải nghĩa:</strong> ${esc(sq.explain)}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>

              <!-- Action buttons -->
              <div class="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle mt-2">
                <a href="#trang-chu" class="px-5 py-2.5 rounded-xl border border-border-subtle bg-paper-card hover:bg-surface-container text-xs font-semibold text-on-surface">
                  Về Trang chủ
                </a>
                <button type="button" class="px-6 py-2.5 rounded-xl bg-primary-container text-white text-xs font-semibold hover:bg-primary shadow-xs" id="btnRetryExam">
                  Làm lại bài luyện tập
                </button>
              </div>
            </div>
          </div>
        `);

        const retryBtn = $("#btnRetryExam");
        if (retryBtn) {
          retryBtn.onclick = () => {
            userAnswers = {};
            curQ = 0;
            renderExam();
          };
        }
      };
    }
  }

  VIEWS['thi-thu-ans'] = (qIdx, optIdx) => {
    userAnswers[qIdx] = optIdx;
    renderExam();
  };

  VIEWS['thi-thu-nav'] = (qIdx) => {
    curQ = qIdx;
    renderExam();
  };

  renderExam();
};

// =========================================================================
// 8. NHẬP TỪ & 9. CÀI ĐẶT & ĐỒNG BỘ (Stitch Design)
// =========================================================================
VIEWS["nhap"] = () => {
  setView(`
    <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-xl flex flex-col gap-space-lg">
      <!-- Input Card -->
      <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
          <h1 class="font-headline-lg text-2xl font-bold text-on-surface">Nhập từ vựng mới</h1>
        </div>
        <p class="font-body-md text-sm text-on-surface-variant">
          Gặp từ mới khi xem phim, nghe podcast hay trên lớp thì ghi vào đây. Trang tự kiểm tra từ đã có trong bảng TOCFL chưa. Từ có trong bảng thì thêm thẳng vào lịch học được.
        </p>

        <form class="flex flex-col gap-space-md mt-2" id="f" autocomplete="off">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold text-on-surface-variant">Từ mới (chữ Phồn thể):</span>
            <input id="w" class="w-full p-3.5 rounded-xl bg-surface-container-low border border-border-subtle text-xl font-serif text-on-surface focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary/20" placeholder="Ví dụ：機會" maxlength="16">
          </label>

          <div class="p-3 rounded-xl bg-surface-container-low border border-border-subtle text-xs text-outline font-medium" id="check">
            Gõ một từ để kiểm tra với kho dữ liệu TOCFL.
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
              <span>Gặp ở đâu:</span>
              <input id="where" placeholder="Podcast, lớp học, phim Đài Loan..." maxlength="60" class="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-xs">
            </label>
            <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
              <span>Ghi chú thêm:</span>
              <input id="note" placeholder="Ý nghĩa ngữ cảnh..." maxlength="200" class="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-xs">
            </label>
          </div>

          <div class="flex items-center justify-between pt-2">
            <span class="text-xs text-secondary font-semibold" id="msg"></span>
            <button class="px-6 py-2.5 rounded-xl bg-primary-container text-white font-semibold text-xs hover:bg-primary transition-colors shadow-xs disabled:opacity-40 disabled:cursor-not-allowed" id="save" type="submit" disabled>
              Lưu từ mới
            </button>
          </div>
        </form>
      </div>

      <!-- Imported Words List -->
      <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
        <div class="flex items-center justify-between">
          <h2 class="font-headline-lg text-lg font-bold text-on-surface">Từ đã nhập trong Hộp thư (${S.inbox.size})</h2>
          <span class="text-xs text-outline">Lưu trữ cục bộ trong trình duyệt</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md" id="ilist"></div>
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
    if ([...S.inbox.values()].some((x) => x.w === w)) {
      box.className = "p-3 rounded-xl bg-amber-subtle border border-amber-subtle text-xs font-medium text-tertiary";
      box.textContent = "Bạn đã nhập từ này vào Hộp thư rồi.";
      btn.disabled = true;
      return null;
    }
    if (n) {
      box.className = "p-3 rounded-xl bg-jade-subtle border border-secondary/30 text-xs font-medium text-secondary";
      box.innerHTML = `✓ Từ này đã có trong bảng chuẩn <strong>TOCFL ${esc(bandsOf(n).join(" · ") || "")}</strong>: <span class="font-serif font-bold">${esc(n.w)}</span> (${esc(itemOf(n).py)}) — ${esc(meaningOf(n))}`;
      return { n, w };
    }
    if (e) {
      box.className = "p-3 rounded-xl bg-surface-container text-xs font-medium text-on-surface";
      box.innerHTML = `Chưa có trong TOCFL, nhưng có trong CC-CEDICT: <span class="font-serif font-bold">${esc(w)}</span> (${esc(e[0][0])}) — ${esc(e[0][1].split("/").join("; "))}`;
      return { w, py: e[0][0], en: e[0][1].split("/").join("; ") };
    }
    box.className = "p-3 rounded-xl bg-surface-container-low border border-border-subtle text-xs font-medium text-outline";
    box.textContent = "Từ mới hoàn toàn (chưa có trong bảng TOCFL và CC-CEDICT).";
    return { w };
  };

  $("#w").oninput = check;

  const drawInbox = () => {
    const list = $("#ilist");
    if (!list) return;
    const items = [...S.inbox.values()].sort((a, b) => b.at - a.at);
    if (!items.length) {
      list.innerHTML = `<div class="col-span-full p-6 text-center text-xs text-outline">Chưa có từ nào trong Hộp thư.</div>`;
      return;
    }
    list.innerHTML = items.map((it) => `
      <div class="p-3.5 rounded-xl bg-surface-container-low border border-border-subtle flex items-start justify-between gap-2">
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-2">
            <a href="#tu/${encodeURIComponent(it.w)}" class="font-serif font-bold text-lg text-on-surface hover:text-primary">${esc(it.w)}</a>
            ${it.py ? `<span class="font-code text-xs text-tertiary">${esc(it.py)}</span>` : ''}
            <button type="button" class="text-secondary hover:text-primary" onclick="say('${esc(it.w)}')" title="Nghe phát âm">
              <span class="material-symbols-outlined text-[16px]">volume_up</span>
            </button>
          </div>
          ${it.where ? `<div class="text-[11px] text-outline truncate">Gặp ở: ${esc(it.where)}</div>` : ''}
          ${it.note ? `<div class="text-[11px] text-on-surface-variant line-clamp-1">${esc(it.note)}</div>` : ''}
        </div>
        <button type="button" class="text-xs text-primary hover:underline font-medium shrink-0" data-del-inbox="${esc(it.id)}">Xóa</button>
      </div>
    `).join('');

    list.querySelectorAll("[data-del-inbox]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.delInbox;
        S.inbox.delete(id);
        await Store.del("inbox", id);
        drawInbox();
      };
    });
  };

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const c = check();
    if (!c) return;
    const id = "inbox~" + Date.now();
    const entry = { id, w: c.w, py: c.py || (c.n ? itemOf(c.n).py : ""), where: clean($("#where").value), note: clean($("#note").value), at: Date.now() };
    await Store.put("inbox", id, entry);
    S.inbox.set(id, entry);
    $("#w").value = "";
    $("#where").value = "";
    $("#note").value = "";
    $("#msg").textContent = `✓ Đã lưu từ "${c.w}" vào Hộp thư.`;
    check();
    drawInbox();
  };

  drawInbox();
};

// =========================================================================
// 9. CÀI ĐẶT & ĐỒNG BỘ ĐA THIẾT BỊ (Stitch Design)
// =========================================================================
VIEWS["cai-dat"] = () => {
  const syncCfg = window.Sync ? Sync.getConfig() : {};
  const isConnected = window.Sync && Sync.isConfigured();
  const vocab = S.notes.filter(n => n.kind === "vocab");

  setView(`
    <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-xl flex flex-col gap-space-xl">
      <!-- Page Header -->
      <div class="flex flex-col gap-space-xs">
        <div class="flex items-center gap-space-xs text-primary font-label-sm text-xs font-semibold tracking-wider uppercase">
          <span class="w-1.5 h-3.5 bg-primary-container rounded-full"></span>
          <span>Thiết lập &amp; Đám mây • 系統設定</span>
        </div>
        <h1 class="font-headline-lg text-2xl md:text-3xl text-on-surface font-bold tracking-tight">
          Cài đặt hệ thống &amp; Đồng bộ
        </h1>
        <p class="font-body-md text-sm text-on-surface-variant">
          Quản lý tiến độ học tập, kết nối tự động 2 chiều qua GitHub Gist và thiết lập mục tiêu cá nhân.
        </p>
      </div>

      <!-- SECTION 1: CLOUD SYNC & FAST CODE SYNC -->
      <section class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex items-center justify-between pb-space-sm border-b border-border-subtle">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-secondary text-[22px]">cloud_sync</span>
            <h2 class="font-headline-md text-lg font-bold text-on-surface">Đồng bộ tiến độ giữa điện thoại &amp; máy tính</h2>
          </div>
          <span class="text-xs px-2.5 py-1 rounded-full font-semibold ${isConnected ? 'bg-jade-subtle text-secondary' : 'bg-surface-container text-outline'}" id="syncStatusBadge">
            ${isConnected ? '✓ Đã kết nối Đám mây' : 'Chưa kết nối'}
          </span>
        </div>

        <!-- Method 1: GitHub Gist -->
        <div class="p-space-md rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-space-sm">
          <div class="flex items-center justify-between">
            <h3 class="font-headline-md text-sm font-bold text-secondary">Cách 1: Tự động qua Đám mây (GitHub Gist cá nhân)</h3>
            <span class="text-[11px] font-semibold text-secondary bg-jade-subtle px-2 py-0.5 rounded">Khuyên dùng</span>
          </div>
          <p class="text-xs text-on-surface-variant leading-relaxed">
            Tiến độ tự động lưu ngầm lên Gist cá nhân của bạn mỗi khi học xong thẻ hoặc mở trang. Không bao giờ lo mất dữ liệu.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md pt-2">
            <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
              <span>GitHub Personal Access Token (classic, quyền gist):</span>
              <input type="password" id="ghToken" placeholder="ghp_..." value="${esc(syncCfg.token || '')}" class="p-2.5 rounded-xl bg-paper-card border border-border-subtle text-xs font-code">
            </label>
            <label class="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
              <span>Gist ID (để trống nếu tạo mới):</span>
              <input type="text" id="ghGistId" placeholder="Mã hash Gist..." value="${esc(syncCfg.gistId || '')}" class="p-2.5 rounded-xl bg-paper-card border border-border-subtle text-xs font-code">
            </label>
          </div>

          <div class="flex items-center justify-between pt-2 flex-wrap gap-2">
            <span class="text-xs text-secondary font-semibold" id="gistMsg"></span>
            <div class="flex items-center gap-2">
              ${isConnected ? `
                <button type="button" class="px-3.5 py-2 rounded-xl bg-paper-card border border-border-subtle hover:bg-surface-container text-xs font-semibold text-outline hover:text-primary" id="btnDisconnectSync">
                  Ngắt kết nối
                </button>
              ` : ''}
              <button type="button" class="px-4 py-2 rounded-xl bg-paper-card border border-border-subtle hover:bg-surface-container text-xs font-semibold text-on-surface" id="btnTestSync">
                Kiểm tra kết nối
              </button>
              <button type="button" class="px-4 py-2 rounded-xl bg-primary-container text-white hover:bg-primary text-xs font-semibold shadow-xs" id="btnSaveSync">
                Lưu &amp; Đồng bộ ngay
              </button>
            </div>
          </div>
        </div>

        <!-- Method 2: Fast Sync Code -->
        <div class="p-space-md rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-space-sm">
          <h3 class="font-headline-md text-sm font-bold text-on-surface">Cách 2: Đồng bộ nhanh bằng mã kết nối thiết bị</h3>
          <p class="text-xs text-on-surface-variant">
            Tạo mã thiết lập nhanh để quét hoặc dán vào trình duyệt máy khác mà không cần nhập lại Token:
          </p>
          <div class="flex items-center gap-2 pt-2 flex-wrap">
            <button type="button" class="px-3.5 py-2 rounded-xl bg-paper-card border border-border-subtle hover:bg-surface-container text-xs font-semibold text-on-surface" id="btnCopyFastCode">
              Sao chép mã đồng bộ nhanh
            </button>
            <div class="flex-1 min-w-[200px] flex items-center gap-2">
              <input type="text" id="pasteFastCode" placeholder="Dán mã đồng bộ từ thiết bị kia vào đây..." class="flex-1 p-2 rounded-xl bg-paper-card border border-border-subtle text-xs font-code">
              <button type="button" class="px-3.5 py-2 rounded-xl bg-secondary text-white hover:bg-secondary/90 text-xs font-semibold shadow-xs" id="btnApplyFastCode">
                Áp dụng
              </button>
            </div>
          </div>
          <span class="text-xs text-secondary font-semibold" id="fastCodeMsg"></span>
        </div>
      </section>

      <!-- SECTION 2: DAILY GOALS & PREFERENCES -->
      <section class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex items-center justify-between pb-space-sm border-b border-border-subtle">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-[22px]">tune</span>
            <h2 class="font-headline-md text-lg font-bold text-on-surface">Mục tiêu học mỗi ngày &amp; Hiển thị</h2>
          </div>
        </div>

        <!-- Goal Presets Recommendation for Band B -->
        <div class="flex flex-col gap-2">
          <span class="text-xs font-semibold text-outline uppercase tracking-wider">Gợi ý lộ trình mục tiêu theo thời gian:</span>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button type="button" class="btn-setting-preset p-3 rounded-xl border border-secondary/40 bg-jade-subtle text-secondary text-left text-xs font-medium hover:bg-secondary-fixed transition-all" data-preset-new="8" data-preset-rev="30">
              <div class="font-bold flex items-center gap-1.5"><span>🎯 Band B Khuyến nghị</span></div>
              <div class="text-[11px] opacity-85 mt-0.5">8 từ mới • 30 lượt ôn (15-25p/ngày)</div>
            </button>
            <button type="button" class="btn-setting-preset p-3 rounded-xl border border-border-subtle bg-surface-container-low text-on-surface text-left text-xs font-medium hover:bg-surface-container transition-all" data-preset-new="5" data-preset-rev="20">
              <div class="font-bold flex items-center gap-1.5"><span>🌱 Nhẹ nhàng duy trì</span></div>
              <div class="text-[11px] text-outline mt-0.5">5 từ mới • 20 lượt ôn (10-15p/ngày)</div>
            </button>
            <button type="button" class="btn-setting-preset p-3 rounded-xl border border-primary/30 bg-cinnabar-subtle text-primary text-left text-xs font-medium hover:bg-primary-container hover:text-white transition-all" data-preset-new="15" data-preset-rev="50">
              <div class="font-bold flex items-center gap-1.5"><span>🚀 Tăng tốc cấp tốc</span></div>
              <div class="text-[11px] opacity-85 mt-0.5">15 từ mới • 50 lượt ôn (35-45p/ngày)</div>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
          <label class="flex flex-col gap-1.5 p-3.5 rounded-xl bg-surface-container-low border border-border-subtle">
            <span class="text-xs font-semibold text-on-surface">Thẻ mới mỗi ngày (newPerDay):</span>
            <input type="number" id="setNewPerDay" min="1" max="200" value="${S.settings.newPerDay || 8}" class="p-2 rounded-xl bg-paper-card border border-border-subtle text-sm font-code font-bold text-primary">
            <span class="text-[11px] text-outline">Khuyến nghị 8 từ/ngày để ôn sâu và không bị quá tải</span>
          </label>

          <label class="flex flex-col gap-1.5 p-3.5 rounded-xl bg-surface-container-low border border-border-subtle">
            <span class="text-xs font-semibold text-on-surface">Chỉ tiêu ôn mỗi ngày (reviewPerDay):</span>
            <input type="number" id="setRevPerDay" min="5" max="500" value="${S.settings.reviewPerDay || 30}" class="p-2 rounded-xl bg-paper-card border border-border-subtle text-sm font-code font-bold text-secondary">
            <span class="text-[11px] text-outline">Dùng để tính thanh tiến độ nhiệm vụ ngày</span>
          </label>
        </div>

        <!-- Preferences -->
        <div class="flex flex-col gap-2 pt-2">
          <label class="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low border border-border-subtle cursor-pointer">
            <input type="checkbox" id="setRuby" ${S.settings.ruby !== false ? 'checked' : ''} class="w-4 h-4 rounded text-primary">
            <div class="flex flex-col">
              <span class="text-xs font-semibold text-on-surface">Hiện phiên âm Pinyin Ruby trên câu ví dụ</span>
              <span class="text-[11px] text-outline">Gắn chữ pinyin nhỏ trên từng chữ Hán để dễ đọc</span>
            </div>
          </label>
        </div>

        <div class="flex justify-end pt-2">
          <button type="button" class="px-5 py-2.5 rounded-xl bg-primary-container text-white text-xs font-semibold hover:bg-primary shadow-xs" id="btnSaveGoals">
            Lưu thiết lập
          </button>
        </div>
      </section>

      <!-- SECTION 3: BACKUP, RESTORE & CACHE -->
      <section class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex items-center justify-between pb-space-sm border-b border-border-subtle">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-outline text-[22px]">database</span>
            <h2 class="font-headline-md text-lg font-bold text-on-surface">Sao lưu tệp JSON &amp; Bộ nhớ</h2>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
          <!-- Export -->
          <div class="p-space-md rounded-xl bg-surface-container-low border border-border-subtle flex flex-col justify-between gap-2">
            <div>
              <h3 class="font-headline-md text-sm font-bold text-on-surface">Xuất dữ liệu dự phòng</h3>
              <p class="text-xs text-on-surface-variant mt-0.5">Tải toàn bộ tiến độ SRS, thống kê và ghi chú về máy thành file .json.</p>
            </div>
            <button type="button" class="w-full py-2.5 px-4 rounded-xl bg-paper-card border border-border-subtle hover:bg-surface-container text-xs font-semibold text-on-surface text-center" id="btnExportJSON">
              Tải file backup (.json)
            </button>
          </div>

          <!-- Import -->
          <div class="p-space-md rounded-xl bg-surface-container-low border border-border-subtle flex flex-col justify-between gap-2">
            <div>
              <h3 class="font-headline-md text-sm font-bold text-on-surface">Nhập tệp sao lưu</h3>
              <p class="text-xs text-on-surface-variant mt-0.5">Phục hồi tiến độ từ file .json đã lưu trước đó.</p>
            </div>
            <label class="w-full py-2.5 px-4 rounded-xl bg-paper-card border border-border-subtle hover:bg-surface-container text-xs font-semibold text-on-surface text-center cursor-pointer">
              Chọn tệp để phục hồi...
              <input type="file" id="importFile" accept=".json,application/json" class="hidden">
            </label>
          </div>
        </div>

        <!-- Reset Cache Button -->
        <div class="pt-2 border-t border-border-subtle flex items-center justify-between text-xs text-outline">
          <span>Khởi động lại cache phiên bản ứng dụng:</span>
          <button type="button" class="text-primary hover:underline font-semibold" id="btnClearCache">
            Xóa cache &amp; Tải lại trang
          </button>
        </div>
      </section>
    </div>
  `);

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
      const badge = $("#syncStatusBadge");
      if (badge) {
        badge.className = "text-xs px-2.5 py-1 rounded-full font-semibold bg-jade-subtle text-secondary";
        badge.textContent = "✓ Đã kết nối Đám mây";
      }
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
      const badge = $("#syncStatusBadge");
      if (badge) {
        badge.className = "text-xs px-2.5 py-1 rounded-full font-semibold bg-jade-subtle text-secondary";
        badge.textContent = "✓ Đã kết nối Đám mây";
      }
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
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      await Store.importAll(obj, "merge");
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
      await Promise.all(keys.map(k => caches.delete(k)));
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
    S.ready = true;
    initSyncUI();
    route();
    if (window.Sync && Sync.isConfigured() && Sync.getConfig().autoSync) {
      Sync.syncNow().then(() => {
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
