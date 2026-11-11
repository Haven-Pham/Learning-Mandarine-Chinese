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
    "desc": "Đề thi mẫu chuẩn chính thức SC-TOP gồm 25 câu Nghe hiểu và 25 câu Đọc hiểu (Hội thoại, độc thoại, điền từ, đọc hiểu văn bản).",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我想坐早上九點的火車到高雄去，中午到得了嗎？ 女：應該是到不了，到高雄大概要五個小時。 男：早上九點的火車什麼時候到高雄？",
        "dialogue": "男：我想坐早上九點的火車到高雄去，中午到得了嗎？\n女：應該是到不了，到高雄大概要五個小時。",
        "q": "男：早上九點的火車什麼時候到高雄？",
        "options": [
          "上午",
          "中午",
          "下午",
          "晚上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 下午. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小李最近好像在找房子，怎麼了？他不住了嗎？ 女：嗯，小李的房東要把房子賣了，他下個月就得搬家。 男：為什麼小李要搬家？",
        "dialogue": "男：小李最近好像在找房子，怎麼了？他不住了嗎？\n女：嗯，小李的房東要把房子賣了，他下個月就得搬家。",
        "q": "男：為什麼小李要搬家？",
        "options": [
          "他買了新房子",
          "他把房子賣了",
          "他找到更好的房子",
          "他的房東要賣房子"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他的房東要賣房子. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳去停車，為什麼去了這麼久？ 女：這附近都找不到能停車的地方，所以我找了比較遠的地方停車。 男：這位小姐的意思是什麼？",
        "dialogue": "男：妳去停車，為什麼去了這麼久？\n女：這附近都找不到能停車的地方，所以我找了比較遠的地方停車。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她很快就找到停車的位子",
          "她花了不少時間找地方停車",
          "她把車子停在比較近的地方",
          "她停車以後，找不到那位先生"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她花了不少時間找地方停車. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳怎麼在家？不和朋友到外面走走嗎？ 女：昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！ 男：這位小姐為什麼在家？",
        "dialogue": "男：妳怎麼在家？不和朋友到外面走走嗎？\n女：昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！",
        "q": "男：這位小姐為什麼在家？",
        "options": [
          "她覺得有點累",
          "她身體不舒服",
          "她剛剛才從外面回來",
          "她還沒想好去哪兒玩"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她覺得有點累. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳這麼喜歡出國旅遊，那妳多久旅遊一次？ 女：差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。 男：這位小姐說了什麼？",
        "dialogue": "男：妳這麼喜歡出國旅遊，那妳多久旅遊一次？\n女：差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。",
        "q": "男：這位小姐說了什麼？",
        "options": [
          "她一年出國旅遊兩次",
          "她今年不打算出國玩",
          "她每次去不一樣的國家玩",
          "她今年去韓國，明年想去日本"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她每次去不一樣的國家玩. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：老師要我們寫的作業，妳寫得怎麼樣？ 女：我想了好幾天，還是寫不出來。 男：這位小姐的意思是什麼？",
        "dialogue": "男：老師要我們寫的作業，妳寫得怎麼樣？\n女：我想了好幾天，還是寫不出來。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她不想寫作業",
          "她想不出來要寫什麼",
          "她不知道有什麼作業",
          "她記不得老師給的作業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她想不出來要寫什麼. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：一年以後，我們就買輛車子，到處去玩怎麼樣？ 女：別開玩笑了，哪來的錢呢？ 男：這位小姐的意思是什麼？",
        "dialogue": "男：一年以後，我們就買輛車子，到處去玩怎麼樣？\n女：別開玩笑了，哪來的錢呢？",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "他們沒錢買車子",
          "她不喜歡出去玩",
          "這位先生常常開玩笑",
          "她不知道哪裡借得到錢"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他們沒錢買車子. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：嗯！這些菜聞起來好香，味道更是沒話說。 女：謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。 男：這位小姐說了什麼？",
        "dialogue": "男：嗯！這些菜聞起來好香，味道更是沒話說。\n女：謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。",
        "q": "男：這位小姐說了什麼？",
        "options": [
          "她做菜做得不好",
          "她很喜歡自己做菜",
          "她喜歡吃別人煮的菜",
          "她只會吃東西，不會做菜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她很喜歡自己做菜. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：明天就要考試了！妳一點也不緊張嗎？ 女：有什麼好緊張的！我早就準備好了。 男：這位小姐的意思是什麼？",
        "dialogue": "男：明天就要考試了！妳一點也不緊張嗎？\n女：有什麼好緊張的！我早就準備好了。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她來不及把書讀完",
          "她對通過考試有信心",
          "她要這位先生別緊張",
          "她一聽見考試就開始緊張"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她對通過考試有信心. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？ 女：昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？ 男：這位小姐的意思是什麼？",
        "dialogue": "男：我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？\n女：昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她知道今天會下大雨",
          "沒有人知道今天會下雨",
          "她本來以為只是下小雨",
          "這位先生沒告訴她會下雨"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她本來以為只是下小雨. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：今天是我第一次上中文課，老師教了語法和二十五個漢字。 女：才上一次課，就學了二十多個漢字，不錯嘛！ 男：學漢字很有趣，不過，語法好難懂。 女：不要緊，有問題的話，就多問老師。 男：這位先生說了什麼？",
        "dialogue": "男：今天是我第一次上中文課，老師教了語法和二十五個漢字。\n女：才上一次課，就學了二十多個漢字，不錯嘛！\n男：學漢字很有趣，不過，語法好難懂。\n女：不要緊，有問題的話，就多問老師。",
        "q": "男：這位先生說了什麼？",
        "options": [
          "老師還沒教語法",
          "老師教了十個漢字",
          "他覺得語法很簡單",
          "他認為學漢字很有意思"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他認為學漢字很有意思. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳上個星期借的小說什麼時候可以還給我？ 女：不好意思！可不可以過兩天再還？ 男：妳看完了嗎？ 女：我看得差不多了。 男：這位小姐的意思是什麼？",
        "dialogue": "男：妳上個星期借的小說什麼時候可以還給我？\n女：不好意思！可不可以過兩天再還？\n男：妳看完了嗎？\n女：我看得差不多了。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她快看完了",
          "她還沒開始看",
          "她要再看一個星期",
          "她已經全部看完了"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她快看完了. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：多吃一點兒吧！ 女：不，謝了！我吃得很飽。 男：妳吃不下了嗎？這個蛋糕是我特別為妳買的。 女：好吧！吃一點兒蛋糕也沒關係。 男：這位小姐的意思是什麼？",
        "dialogue": "男：多吃一點兒吧！\n女：不，謝了！我吃得很飽。\n男：妳吃不下了嗎？這個蛋糕是我特別為妳買的。\n女：好吧！吃一點兒蛋糕也沒關係。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她還有點兒餓",
          "蛋糕有點兒難吃",
          "她可以再吃一點兒東西",
          "她沒辦法吃任何東西了"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她可以再吃一點兒東西. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：生日快樂！這是送給妳的。 女：謝謝。你不必買禮物給我的。你太客氣了！ 男：希望妳會喜歡，打開來看看吧。 女：啊，我喜歡這支手錶。你怎麼知道我要的就是這個？ 男：這位小姐的意思是什麼？",
        "dialogue": "男：生日快樂！這是送給妳的。\n女：謝謝。你不必買禮物給我的。你太客氣了！\n男：希望妳會喜歡，打開來看看吧。\n女：啊，我喜歡這支手錶。你怎麼知道我要的就是這個？",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她不需要手錶",
          "她想要別的禮物",
          "這位先生買錯手錶",
          "這位先生買對了禮物"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位先生買對了禮物. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小明這次考試考得太差了。 女：是不是考試太難了？ 男：不是吧！很多學生都考得不錯，有好幾個都考一百分呢！ 女：我看啊！應該是小明念書念不了幾頁，就想出去玩。 男：這兩個人說，小明成績差的原因是什麼？",
        "dialogue": "男：小明這次考試考得太差了。\n女：是不是考試太難了？\n男：不是吧！很多學生都考得不錯，有好幾個都考一百分呢！\n女：我看啊！應該是小明念書念不了幾頁，就想出去玩。",
        "q": "男：這兩個人說，小明成績差的原因是什麼？",
        "options": [
          "他不用功",
          "他不聰明",
          "考試太難",
          "他不小心寫錯"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他不用功. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳到新公司上班已經兩個星期了，一切還習慣嗎？ 女：嗯，我已經慢慢習慣那裡的環境了。 男：聽說在你們公司上班很辛苦，是真的嗎？ 女：辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有 一次旅遊活動喔！ 男：這位小姐的公司怎麼樣？",
        "dialogue": "男：妳到新公司上班已經兩個星期了，一切還習慣嗎？\n女：嗯，我已經慢慢習慣那裡的環境了。\n男：聽說在你們公司上班很辛苦，是真的嗎？\n女：辛苦是辛苦，不過公司對我們很好，不但每天下午有點心可以吃，每年還有\n一次旅遊活動喔！",
        "q": "男：這位小姐的公司怎麼樣？",
        "options": [
          "對她不好",
          "午餐不用錢",
          "工作不是太多",
          "每年辦旅遊活動"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 每年辦旅遊活動. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我覺得我的頭有點兒疼，我很久沒這樣了。 女：最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。 男：像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！ 女：再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。 男：這位小姐覺得這位先生應該怎麼做？",
        "dialogue": "男：我覺得我的頭有點兒疼，我很久沒這樣了。\n女：最近有流行性感冒，你常常搭公車上下班，很可能被傳染了。\n男：像我這種每天運動，又常吃蔬菜水果的人，身體是很健康的！\n女：再好的身體遇上病毒，還是得進醫院一趟，你先去檢查比較好。",
        "q": "男：這位小姐覺得這位先生應該怎麼做？",
        "options": [
          "不要搭公車",
          "到醫院看病",
          "多吃蔬菜水果",
          "養成運動的習慣"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 到醫院看病. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：玉珍，妳將來有什麼打算嗎？ 女：我打算以後過著單身生活，想去哪裡旅行就去哪裡。 男：萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？ 女：到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中 心，這樣就不用擔心了啊！ 男：這位小姐到了老年的時候有什麼計畫？",
        "dialogue": "男：玉珍，妳將來有什麼打算嗎？\n女：我打算以後過著單身生活，想去哪裡旅行就去哪裡。\n男：萬一妳老了，體力不行了，沒辦法到處旅行，又沒有人照顧妳怎麼辦？\n女：到老的時候，我就不再工作，我有一筆退休的錢，拿這些錢去住老人照顧中\n心，這樣就不用擔心了啊！",
        "q": "男：這位小姐到了老年的時候有什麼計畫？",
        "options": [
          "繼續工作",
          "組織一個家庭",
          "去世界各國旅行",
          "住在專門照顧老人的地方"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 住在專門照顧老人的地方. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：怎麼每一個人手上的盤子都堆滿食物啊！ 女：在這家餐廳，你要吃什麼就自己拿，拿多少就吃多少。 男：夾那麼多菜，這樣吃一頓下來應該要花不少錢吧？ 女：是啊！因為這裡的食物材料都是從國外進口，所以價格蠻高的，不過東西又 新鮮又多樣，飲料愛喝多少就喝多少，所有食物任你選，讓你吃到飽。 男：這家餐廳有什麼特色？",
        "dialogue": "男：怎麼每一個人手上的盤子都堆滿食物啊！\n女：在這家餐廳，你要吃什麼就自己拿，拿多少就吃多少。\n男：夾那麼多菜，這樣吃一頓下來應該要花不少錢吧？\n女：是啊！因為這裡的食物材料都是從國外進口，所以價格蠻高的，不過東西又\n新鮮又多樣，飲料愛喝多少就喝多少，所有食物任你選，讓你吃到飽。",
        "q": "男：這家餐廳有什麼特色？",
        "options": [
          "由服務生幫客人點餐",
          "食物材料從國外買進來",
          "每個人喝的飲料限制兩杯",
          "吃一頓飯所花的費用很便宜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 食物材料從國外買進來. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我明明就把電視的聲音調到最大了，為什麼聽起來還是這麼小？ 女：我們家的電視已經都用了十年以上，早該換一部新的了。 男：這部電視還能用，找人來修理就好了！我還真捨不得把它丟了！ 女：有什麼好捨不得的？光修理的費用就能買一部新的電視了呢！ 男：這位小姐想要怎樣處理這部電視？ 以下是兩個朋友之間的對話，請聽這段話，然後回答下面的兩個問題。 男：妳最近好像很忙，忙些什麼呢？ 女：我最近開始在網站上賣衣服，有好多事情要做。 男：妳已經有一份工作了，為什麼還要在網站上賣衣服呢？ 女：我有很多舊衣服，這些衣服已經不穿了，把它們賣掉，還可以賺錢，多好啊！ 男：這樣真不錯。我也有許多舊書，這些書都已經看完了，我看啊！我也來把它 們放到網站上賣給有需要的人好了。 女：我可以教你網站怎麼操作，你很快就能學會的。 21. 為什麼這位小姐要賣衣服？ 22. 這位先生想要做什麼？ 以下是一段兄妹的對話，請聽這段話，然後回答下面的兩個問題。 男：爸爸的生日快到了，我們送什麼樣的禮物給爸爸呢? 女：爸爸工作這麼忙，很久沒出國旅遊了，我們送爸爸飛機票跟旅遊的費用，讓 他好好的出國休假，你覺得怎麼樣？ 男：可是我想爸爸抽不出時間去旅遊吧！我覺得送運動器材比較好，讓爸爸多多 運動，身體才會健康。 女：好主意！爸爸的確需要多一點兒運動。 男：那我們就送爸爸一輛腳踏車吧！我們可以陪爸爸騎腳踏車，他一定很喜歡我 們跟他一起去運動。 女：聽起來不錯。不過，我們兩個都沒有腳踏車，所以我們一次要買三輛囉！況 且我自己得先學怎麼騎腳踏車才行。 23. 哥哥對爸爸的生日禮物有什麼看法？ 24. 關於腳踏車，妹妹最後有什麼想法？ 下面是一段和工作有關的對話。請你在聽完這段對話後，回答下面三個問題： 25. 這位小姐想到這家公司工作的原因是什麼？ 26. 這位小姐認為擔任業務人員最重要的能力是什麼？ 27. 這位主管說這位小姐缺少哪方面的經驗？ 現在請聽這段對話。 男：陳小姐，很高興認識妳！歡迎妳來應徵我們的工作，妳申請的工作是業務人 員，我想了解一下妳為什麼想到我們公司來呢？ 女：貴公司是世界有名的國際企業，而且公司規模也比我以前的公司大得多，我 相信在你們公司工作，未來一定有發展。 男：那麼，妳認為身為一個業務人員，最重要的能力是什麼？ 女：我覺得當業務人員最重要的能力，是開發新客戶以及新市場，現在各行各業 競爭非常激烈，必須盡快找到值得經營的市場，尋找新客戶。 男：這也是我們所想的。不過妳過去沒有開拓海外市場的經驗，而我們現在想要 徵求的是，能夠開發國外客戶，熟悉國外市場的人。 女：雖然我沒有這方面的經驗，但是我的英文能力不錯，能夠和國外客戶談生意， 我想我能夠達成任務。 男：其實妳的條件很不錯，我們決定了以後再通知妳。 女：謝謝你們給我這次面試機會，希望有機會能到貴公司工作。 下面是兩個朋友之間的對話。請你在聽完這段對話後，回答下面三個問題： 28. 快速約會是什麼樣的活動？ 29. 這位小姐認為快速約會的缺點是什麼？ 30. 這位先生覺得快速約會怎麼樣？ 現在請聽這段對話。 男：這一陣子工作忙，都沒時間認識女孩子。 女：說到這個，最近我參加了「快速約會」的活動，你也可以試試，說不定能從 中找到合適的交往對象。 男：「快速約會」？我沒聽過這個名詞。 女：這是只有單身的人才能夠參加的活動。每次活動只要五百塊錢，不算貴。一 次大概有四十到五十人，男女各一半，男生和女生兩個人面對面坐著以後， 有七分鐘的時間可以互相談話，七分鐘一到，男生們就站起來換一位新的聊 天對象，參加活動的人在很短的時間內就可以認識新朋友。 男：每七分鐘就能認識一個人，真快！但是，妳參加以後，真的能找到心目中理 想的交往對象嗎？ 女：我覺得的確可以認識比較多的人，不過，它的缺點是聊天只有短短幾分鐘， 無法深入地了解一個人。 男：不過和在網路上交朋友比起來，快速約會比較安全一點兒，至少是當面聊天， 可以從講話的態度、表情，稍微了解對方是個什麼樣的人。而且我最需要的 就是能夠認識多一點兒女孩子，這種活動很有效率，正好可以滿足我的需求。 女：既然你這麼有興趣，下次有快速約會的活動，我再找你一塊兒參加。 第二部分 段落 請聽這一段車站裡的廣播，然後回答下面的問題。 各位旅客，很抱歉！因為大雨的關係，十二點五十分往台北的一一零號火車 會晚半個小時到，要坐一一零號車的旅客請在月台上耐心等候。謝謝！ 31. 這段廣播說一一零號車怎麼樣？ 請聽這一段百貨公司的廣播，然後回答下面的問題。 趕快來！趕快來！只有十分鐘，本公司一樓皮包五折賣出，真皮皮包一個一 千塊，一個一千塊，買一送一，買一送一，只有十分鐘，現在不買就要等下次囉！ 32. 如果陳小姐想要兩個皮包，應該給多少錢？ 請聽這一段話，然後回答下面的問題。 各位同學，今天晚上的新年晚會有很多節目，有法國同學唱法國歌兒，還有 日本同學跳日本的舞，最特別的是有一位學生要學小鳥叫。最後，老師們會教大 家唱中國新年的歌兒。 33. 這段話說今天的晚會怎麼樣？ 請聽這一段話，然後回答下面的問題。 寒假的時候，王先生和家人到日本玩。因為王先生一家人都不會說日本話， 可是日本人認得漢字，所以他們常常用寫字的方式跟日本人談話。在飯館兒點菜 的時候，因為不知道日本菜的名字，他們只好看圖片點菜，還好都沒弄錯。 34. 王先生一家人在日本怎麼點菜？ 請聽這位老師說的話，然後回答下面的兩個問題。 同學們，第七課的課文我們已經上完了，你們有三個回家作業，第一是背課 文，第二是記住這一課全部的生字，第三是在一張練習紙上寫下五個句子。你們 也要複習第七課，下次一上課，我們就先考第七課的內容。 35. 學生的回家作業是什麼？ 36. 下一次上課，老師要先做什麼？ 請聽這一段天氣報告，然後回答下面的兩個問題。 秋天到了，白天的時間越來越短，晚上的時間越來越長，天氣也變得涼一點 兒，早晚的天氣變化很大，請大家注意。明天是不下雨的好天氣，白天是晴天， 感覺還是很熱，但是，夜裡風很大，有點兒冷，所以明天出門的時候，別忘了多 帶一件外套。 37. 這個季節的天氣怎麼樣？ 38. 明天的天氣怎麼樣？ 請聽這一段話，然後回答下面的兩個問題。 我昨天到動物園參觀，看到了很多動物，有生活在草原上的馬，還有住在森 林裡的鳥，在水裡游的魚。在這些動物裡面，我最喜歡鳥了，牠們身上有好多種 顏色，叫聲也很好聽，我覺得鳥兒真是可愛！那裡還有人在擠牛奶，我吃了那邊 賣的牛奶冰，牛奶冰很好吃！我覺得動物園真好玩，下次我一定還要再來！ 39. 說話的人最喜歡什麼動物？ 40. 說話的人在動物園做了什麼？ 請聽一段醫生對病人說的話，然後回答下面的兩個問題。 陳先生你一百七十公分高，但是卻有一百公斤重，如果不改變目前的生活習 慣，你的健康會越來越差。你最好從現在開始，每天運動一個小時，這一個小時 不必都做一樣的運動，你可以先騎腳踏車騎半個小時，再慢跑半個小時。除了運 動，還要少吃甜的東西，也不能吃太多肉，要多吃青菜，這麼做才能讓你變健康。 41. 這位先生的身體現在怎麼樣？ 42. 醫生要這位先生怎麼做？ 請聽這一段話，然後回答下面的兩個問題。 大偉想到一家公司上班，今天這家公司的人請他去談談。因為這家公司需要 有人在公司的網站上用英文寫文章，向外國人介紹公司的產品，所以老闆就問大 偉的文章寫得怎麼樣。大偉說他大學是念英國文學的，所以這項工作對他來說不 難。老闆再繼續問了一些問題以後，覺得大偉對工作內容很了解，態度也不錯， 所以決定先讓他工作三個月，看看他的表現怎麼樣。 43. 這家公司需要什麼樣的新人？ 44. 大偉談工作的結果怎麼樣？ 下面是關於睡眠的研究報告。請你聽完報告後，回答下面三個問題： 45. 說話的人認為什麼才是合適的睡眠？ 46. 我們可以根據哪件事知道自己究竟需要睡多久才夠？ 47. 這段報告的結論是什麼？ 現在請聽報告。 多數人認為每晚應該睡足八個小時，並且必須在晚上十一點以前睡才算正 確，但其實每個人對於睡眠的需要不同，有人越晚越有精神，有人一大早就起來 活動，每個人的睡眠是有個別差異的。睡足自己身體所需要的量，才是合適的睡 眠需要。 要如何才能了解自己究竟需要睡多久呢？建議可以養成評估白天精神的習 慣：一覺醒來很有精神為一百分；經過一夜睡眠，但身體的疲勞卻完全無法恢復 為零分。若評估白天的精神可達自己設定的八十分以上，就代表晚上睡眠的需求 已被滿足。 總而言之，睡得多不一定睡得飽，睡得少也不代表睡不好。當找到適合自己 的睡眠時數以後，就可以在白天擁有好精神，晚上擁有好睡眠。因此，與其說清 楚到底需要幾個小時的睡眠才健康，倒不如花些時間，觀察自己在白天的時候精 神、情緒等各方面是否良好及穩定。白天與晚上身體都覺得舒服，就是睡得夠。 下面是一則關於自行車的新聞報導。請你聽完這則報導後，回答下面三個問題： 48. 這則報導主要在說明什麼？ 49. 根據報導，我們可以從哪方面知道一座城市很適合把自行車當作主要交通工 具？ 50. 報導內容指出，怎麼做才能增加騎自行車的人數？ 現在請聽報導。 自行車是一種環保的交通工具，但是如何鼓勵民眾少開車、多騎自行車，卻 是每個關心環境的都市計劃人員傷腦筋的課題。越來越多的研究顯示，增加自行 車人口的最佳策略，就是找出究竟女性需要什麼？一位大學講師發表過幾篇關於 騎自行車與性別差異的研究報告，她表示：「如果你想知道都市環境適不適合騎 自行車，只需要計算自行車人口中的女性比例就行了，騎自行車的女性越多，就 表示這個都市越適合騎自行車。」 而女性被視為衡量都市環境是否適合騎自行車的標準，背後原因是來自於女 性比男性傾向避免任何冒險的行為，也就是說，得有更安全的自行車環境，女性 朋友才願意騎自行車上路。此外，女性通常得負責大部分照顧小孩子與購買生活 用品的工作，這也表示規劃自行車道路的時候，必須經過城市內生活機能較高的 區域，這也是說，設計自行車道路的路線，應該讓路線通往超級市場、學校或托 兒所等實用的目的地，才能有效提升自行車使用率。",
        "dialogue": "男：我明明就把電視的聲音調到最大了，為什麼聽起來還是這麼小？\n女：我們家的電視已經都用了十年以上，早該換一部新的了。\n男：這部電視還能用，找人來修理就好了！我還真捨不得把它丟了！\n女：有什麼好捨不得的？光修理的費用就能買一部新的電視了呢！\n男：這位小姐想要怎樣處理這部電視？\n以下是兩個朋友之間的對話，請聽這段話，然後回答下面的兩個問題。\n男：妳最近好像很忙，忙些什麼呢？\n女：我最近開始在網站上賣衣服，有好多事情要做。\n男：妳已經有一份工作了，為什麼還要在網站上賣衣服呢？\n女：我有很多舊衣服，這些衣服已經不穿了，把它們賣掉，還可以賺錢，多好啊！\n男：這樣真不錯。我也有許多舊書，這些書都已經看完了，我看啊！我也來把它\n們放到網站上賣給有需要的人好了。\n女：我可以教你網站怎麼操作，你很快就能學會的。\n21. 為什麼這位小姐要賣衣服？\n22. 這位先生想要做什麼？\n以下是一段兄妹的對話，請聽這段話，然後回答下面的兩個問題。\n男：爸爸的生日快到了，我們送什麼樣的禮物給爸爸呢?\n女：爸爸工作這麼忙，很久沒出國旅遊了，我們送爸爸飛機票跟旅遊的費用，讓\n他好好的出國休假，你覺得怎麼樣？\n男：可是我想爸爸抽不出時間去旅遊吧！我覺得送運動器材比較好，讓爸爸多多\n運動，身體才會健康。\n女：好主意！爸爸的確需要多一點兒運動。\n男：那我們就送爸爸一輛腳踏車吧！我們可以陪爸爸騎腳踏車，他一定很喜歡我\n們跟他一起去運動。\n女：聽起來不錯。不過，我們兩個都沒有腳踏車，所以我們一次要買三輛囉！況\n且我自己得先學怎麼騎腳踏車才行。\n23. 哥哥對爸爸的生日禮物有什麼看法？\n24. 關於腳踏車，妹妹最後有什麼想法？\n下面是一段和工作有關的對話。請你在聽完這段對話後，回答下面三個問題：\n25. 這位小姐想到這家公司工作的原因是什麼？\n26. 這位小姐認為擔任業務人員最重要的能力是什麼？\n27. 這位主管說這位小姐缺少哪方面的經驗？\n現在請聽這段對話。\n男：陳小姐，很高興認識妳！歡迎妳來應徵我們的工作，妳申請的工作是業務人\n員，我想了解一下妳為什麼想到我們公司來呢？\n女：貴公司是世界有名的國際企業，而且公司規模也比我以前的公司大得多，我\n相信在你們公司工作，未來一定有發展。\n男：那麼，妳認為身為一個業務人員，最重要的能力是什麼？\n女：我覺得當業務人員最重要的能力，是開發新客戶以及新市場，現在各行各業\n競爭非常激烈，必須盡快找到值得經營的市場，尋找新客戶。\n男：這也是我們所想的。不過妳過去沒有開拓海外市場的經驗，而我們現在想要\n徵求的是，能夠開發國外客戶，熟悉國外市場的人。\n女：雖然我沒有這方面的經驗，但是我的英文能力不錯，能夠和國外客戶談生意，\n我想我能夠達成任務。\n男：其實妳的條件很不錯，我們決定了以後再通知妳。\n女：謝謝你們給我這次面試機會，希望有機會能到貴公司工作。\n下面是兩個朋友之間的對話。請你在聽完這段對話後，回答下面三個問題：\n28. 快速約會是什麼樣的活動？\n29. 這位小姐認為快速約會的缺點是什麼？\n30. 這位先生覺得快速約會怎麼樣？\n現在請聽這段對話。\n男：這一陣子工作忙，都沒時間認識女孩子。\n女：說到這個，最近我參加了「快速約會」的活動，你也可以試試，說不定能從\n中找到合適的交往對象。\n男：「快速約會」？我沒聽過這個名詞。\n女：這是只有單身的人才能夠參加的活動。每次活動只要五百塊錢，不算貴。一\n次大概有四十到五十人，男女各一半，男生和女生兩個人面對面坐著以後，\n有七分鐘的時間可以互相談話，七分鐘一到，男生們就站起來換一位新的聊\n天對象，參加活動的人在很短的時間內就可以認識新朋友。\n男：每七分鐘就能認識一個人，真快！但是，妳參加以後，真的能找到心目中理\n想的交往對象嗎？\n女：我覺得的確可以認識比較多的人，不過，它的缺點是聊天只有短短幾分鐘，\n無法深入地了解一個人。\n男：不過和在網路上交朋友比起來，快速約會比較安全一點兒，至少是當面聊天，\n可以從講話的態度、表情，稍微了解對方是個什麼樣的人。而且我最需要的\n就是能夠認識多一點兒女孩子，這種活動很有效率，正好可以滿足我的需求。\n女：既然你這麼有興趣，下次有快速約會的活動，我再找你一塊兒參加。\n第二部分 段落\n請聽這一段車站裡的廣播，然後回答下面的問題。\n各位旅客，很抱歉！因為大雨的關係，十二點五十分往台北的一一零號火車\n會晚半個小時到，要坐一一零號車的旅客請在月台上耐心等候。謝謝！\n31. 這段廣播說一一零號車怎麼樣？\n請聽這一段百貨公司的廣播，然後回答下面的問題。\n趕快來！趕快來！只有十分鐘，本公司一樓皮包五折賣出，真皮皮包一個一\n千塊，一個一千塊，買一送一，買一送一，只有十分鐘，現在不買就要等下次囉！\n32. 如果陳小姐想要兩個皮包，應該給多少錢？\n請聽這一段話，然後回答下面的問題。\n各位同學，今天晚上的新年晚會有很多節目，有法國同學唱法國歌兒，還有\n日本同學跳日本的舞，最特別的是有一位學生要學小鳥叫。最後，老師們會教大\n家唱中國新年的歌兒。\n33. 這段話說今天的晚會怎麼樣？\n請聽這一段話，然後回答下面的問題。\n寒假的時候，王先生和家人到日本玩。因為王先生一家人都不會說日本話，\n可是日本人認得漢字，所以他們常常用寫字的方式跟日本人談話。在飯館兒點菜\n的時候，因為不知道日本菜的名字，他們只好看圖片點菜，還好都沒弄錯。\n34. 王先生一家人在日本怎麼點菜？\n請聽這位老師說的話，然後回答下面的兩個問題。\n同學們，第七課的課文我們已經上完了，你們有三個回家作業，第一是背課\n文，第二是記住這一課全部的生字，第三是在一張練習紙上寫下五個句子。你們\n也要複習第七課，下次一上課，我們就先考第七課的內容。\n35. 學生的回家作業是什麼？\n36. 下一次上課，老師要先做什麼？\n請聽這一段天氣報告，然後回答下面的兩個問題。\n秋天到了，白天的時間越來越短，晚上的時間越來越長，天氣也變得涼一點\n兒，早晚的天氣變化很大，請大家注意。明天是不下雨的好天氣，白天是晴天，\n感覺還是很熱，但是，夜裡風很大，有點兒冷，所以明天出門的時候，別忘了多\n帶一件外套。\n37. 這個季節的天氣怎麼樣？\n38. 明天的天氣怎麼樣？\n請聽這一段話，然後回答下面的兩個問題。\n我昨天到動物園參觀，看到了很多動物，有生活在草原上的馬，還有住在森\n林裡的鳥，在水裡游的魚。在這些動物裡面，我最喜歡鳥了，牠們身上有好多種\n顏色，叫聲也很好聽，我覺得鳥兒真是可愛！那裡還有人在擠牛奶，我吃了那邊\n賣的牛奶冰，牛奶冰很好吃！我覺得動物園真好玩，下次我一定還要再來！\n39. 說話的人最喜歡什麼動物？\n40. 說話的人在動物園做了什麼？\n請聽一段醫生對病人說的話，然後回答下面的兩個問題。\n陳先生你一百七十公分高，但是卻有一百公斤重，如果不改變目前的生活習\n慣，你的健康會越來越差。你最好從現在開始，每天運動一個小時，這一個小時\n不必都做一樣的運動，你可以先騎腳踏車騎半個小時，再慢跑半個小時。除了運\n動，還要少吃甜的東西，也不能吃太多肉，要多吃青菜，這麼做才能讓你變健康。\n41. 這位先生的身體現在怎麼樣？\n42. 醫生要這位先生怎麼做？\n請聽這一段話，然後回答下面的兩個問題。\n大偉想到一家公司上班，今天這家公司的人請他去談談。因為這家公司需要\n有人在公司的網站上用英文寫文章，向外國人介紹公司的產品，所以老闆就問大\n偉的文章寫得怎麼樣。大偉說他大學是念英國文學的，所以這項工作對他來說不\n難。老闆再繼續問了一些問題以後，覺得大偉對工作內容很了解，態度也不錯，\n所以決定先讓他工作三個月，看看他的表現怎麼樣。\n43. 這家公司需要什麼樣的新人？\n44. 大偉談工作的結果怎麼樣？\n下面是關於睡眠的研究報告。請你聽完報告後，回答下面三個問題：\n45. 說話的人認為什麼才是合適的睡眠？\n46. 我們可以根據哪件事知道自己究竟需要睡多久才夠？\n47. 這段報告的結論是什麼？\n現在請聽報告。\n多數人認為每晚應該睡足八個小時，並且必須在晚上十一點以前睡才算正\n確，但其實每個人對於睡眠的需要不同，有人越晚越有精神，有人一大早就起來\n活動，每個人的睡眠是有個別差異的。睡足自己身體所需要的量，才是合適的睡\n眠需要。\n要如何才能了解自己究竟需要睡多久呢？建議可以養成評估白天精神的習\n慣：一覺醒來很有精神為一百分；經過一夜睡眠，但身體的疲勞卻完全無法恢復\n為零分。若評估白天的精神可達自己設定的八十分以上，就代表晚上睡眠的需求\n已被滿足。\n總而言之，睡得多不一定睡得飽，睡得少也不代表睡不好。當找到適合自己\n的睡眠時數以後，就可以在白天擁有好精神，晚上擁有好睡眠。因此，與其說清\n楚到底需要幾個小時的睡眠才健康，倒不如花些時間，觀察自己在白天的時候精\n神、情緒等各方面是否良好及穩定。白天與晚上身體都覺得舒服，就是睡得夠。\n下面是一則關於自行車的新聞報導。請你聽完這則報導後，回答下面三個問題：\n48. 這則報導主要在說明什麼？\n49. 根據報導，我們可以從哪方面知道一座城市很適合把自行車當作主要交通工\n具？\n50. 報導內容指出，怎麼做才能增加騎自行車的人數？\n現在請聽報導。\n自行車是一種環保的交通工具，但是如何鼓勵民眾少開車、多騎自行車，卻\n是每個關心環境的都市計劃人員傷腦筋的課題。越來越多的研究顯示，增加自行\n車人口的最佳策略，就是找出究竟女性需要什麼？一位大學講師發表過幾篇關於\n騎自行車與性別差異的研究報告，她表示：「如果你想知道都市環境適不適合騎\n自行車，只需要計算自行車人口中的女性比例就行了，騎自行車的女性越多，就\n表示這個都市越適合騎自行車。」\n而女性被視為衡量都市環境是否適合騎自行車的標準，背後原因是來自於女\n性比男性傾向避免任何冒險的行為，也就是說，得有更安全的自行車環境，女性\n朋友才願意騎自行車上路。此外，女性通常得負責大部分照顧小孩子與購買生活\n用品的工作，這也表示規劃自行車道路的時候，必須經過城市內生活機能較高的\n區域，這也是說，設計自行車道路的路線，應該讓路線通往超級市場、學校或托",
        "q": "兒所等實用的目的地，才能有效提升自行車使用率。",
        "options": [
          "把它丟了",
          "繼續使用",
          "找人來修理",
          "把它賣給別人"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 把它丟了. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 21",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 21",
        "options": [
          "她找不到其他工作",
          "她買了很多新衣服",
          "朋友送給她很多衣服",
          "她有很多不需要的衣服"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她有很多不需要的衣服. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 22",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 22",
        "options": [
          "買新書",
          "賣舊書",
          "賣衣服",
          "買衣服"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 賣舊書. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 23",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 23",
        "options": [
          "送飛機票",
          "陪爸爸出差",
          "送運動器材",
          "帶爸爸出國旅遊"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 送運動器材. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 24",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 24",
        "options": [
          "她要跟朋友借腳踏車",
          "她要教爸爸騎腳踏車",
          "她不想陪爸爸騎腳踏車",
          "她也要買一輛腳踏車給自己"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她也要買一輛腳踏車給自己. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 25",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 25",
        "options": [
          "她不想再當業務人員",
          "她被原本的公司開除了",
          "她覺得在這家公司比較有前途",
          "這家公司主動請這位小姐來工作"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她覺得在這家公司比較有前途. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 1: Chọn từ thích hợp điền vào vị trí [1] trong bài.",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng bị động '被'送進了醫院 (được đưa vào bệnh viện).",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 2: Chọn từ thích hợp điền vào vị trí [2] trong bài.",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'陪'張太太到醫院去 (đi cùng / hộ tống vợ đến viện).",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 3: Chọn từ thích hợp điền vào vị trí [3] trong bài.",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'當'爸爸 (làm cha / làm bố).",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 4: Chọn từ thích hợp điền vào vị trí [4] trong bài.",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'為'這個孩子想了一個名字 (nghĩ tên 'cho' đứa trẻ).",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 5: Chọn từ thích hợp điền vào vị trí [5] trong bài.",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'希望' (hy vọng con gái sau này vừa xinh đẹp vừa vui vẻ).",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 6: Chọn từ thích hợp điền vào vị trí [6] trong bài.",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'大學時代' (thời kỳ đại học).",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 7: Chọn từ thích hợp điền vào vị trí [7] trong bài.",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp mặt.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 8: Chọn từ thích hợp điền vào vị trí [8] trong bài.",
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
        "id": 24,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 9: Chọn từ thích hợp điền vào vị trí [9] trong bài.",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'照'著信上的地址 (dựa theo / lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 10: Chọn từ thích hợp điền vào vị trí [10] trong bài.",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp được nữa).",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 11: Chọn từ thích hợp điền vào vị trí [11] trong bài.",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'安排'戶外活動 (sắp xếp thời gian hoạt động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 12: Chọn từ thích hợp điền vào vị trí [12] trong bài.",
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
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 13: Chọn từ thích hợp điền vào vị trí [13] trong bài.",
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
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 14: Chọn từ thích hợp điền vào vị trí [14] trong bài.",
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
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 15: Chọn từ thích hợp điền vào vị trí [15] trong bài.",
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
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "q": "Câu 16: 下面哪一個是對的？",
        "options": [
          "小明已經去過韓國兩次了",
          "小明想學習怎麼做韓國菜",
          "小明覺得韓國不怎麼好玩",
          "小明在韓國住了四個晚上"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết: '他在那兒玩了五天四夜' nghĩa là ở Hàn Quốc 4 đêm (住了四個晚上).",
        "pinyin": ""
      },
      {
        "id": 42,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 母親面對孩子的不安\n孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，態度怎麼樣？",
        "options": [
          "既害怕又不忍心",
          "不知道該怎麼辦",
          "覺得孩子很可憐",
          "鼓勵孩子自己解決"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ mỉm cười và kiên định nói: '你要學著去面對你自己的人生', khích lệ con tự đối diện và giải quyết.",
        "pinyin": ""
      },
      {
        "id": 43,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣夜市文化與電子支付\n以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "audio": "",
        "dialogue": "以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "q": "Câu 18: 根據這段文字，夜市引入行動支付帶來什麼好處？",
        "options": [
          "攤位租金變得更便宜",
          "結帳更快速且減少排隊",
          "觀光客可以買到打折商品",
          "大家不用再帶手機出門"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Bài viết nêu rõ: '減少了排隊找零的時間... 效率都因此大幅提升' (thanh toán nhanh hơn và giảm xếp hàng).",
        "pinyin": ""
      },
      {
        "id": 44,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北捷運環保便民措施\n台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "audio": "",
        "dialogue": "台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪一項特色？",
        "options": [
          "列車行駛速度世界第一",
          "車廂內提供免費餐點",
          "充滿人情味的便民服務",
          "票價比其他交通工具便宜"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả nhấn mạnh: '展現了台灣社會溫暖的人情味' (dịch vụ tiện dân ấm áp tình người).",
        "pinyin": ""
      },
      {
        "id": 45,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 垃圾分類與隨袋徵收政策\n台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "audio": "",
        "dialogue": "台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "q": "Câu 20: 『垃圾費隨袋徵收』政策如何有效減少垃圾量？",
        "options": [
          "規定每週只能倒一次垃圾",
          "透過購買專用垃圾袋促使民眾做好回收",
          "禁止市民購買任何塑膠包裝",
          "對亂丟垃圾的人處以重罰"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Người dân phải mua túi rác chuyên dụng cho rác thông thường, còn rác tái chế miễn phí, từ đó thúc đẩy phân loại triệt để.",
        "pinyin": ""
      },
      {
        "id": 46,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 高鐵對台灣一日生活圈的影響\n自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "audio": "",
        "dialogue": "自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "q": "Câu 21: 『一日生活圈』對人們生活產生什麼主要影響？",
        "options": [
          "所有人都要搬去南部居住",
          "高鐵車票價格大幅下降",
          "南北往返當天即可完成工作",
          "飛機成為主要交通工具"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đoạn văn minh họa sáng họp ở Đài Bắc, chiều kiểm tra nhà máy Đài Nam, tối về lại Đài Bắc (đi lại hoàn thành trong ngày).",
        "pinyin": ""
      },
      {
        "id": 47,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣全民健康保險制度\n台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "audio": "",
        "dialogue": "台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "q": "Câu 22: 健保雲端系統的主要功能是什麼？",
        "options": [
          "自動幫病患繳交健保費",
          "即時查詢用藥紀錄避免重複開藥",
          "線上直接替病患開刀手術",
          "向國外藥廠訂購廉價藥品"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Văn bản nêu: '即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 48,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 誠品書店的二十四小時閱讀風潮\n誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "q": "Câu 23: 這家二十四小時書店之所以成為文化地標，是因為什麼？",
        "options": [
          "深夜買書享有半價優惠",
          "將閱讀轉化為結合文創的生活風格",
          "只允許專業作家進去閱讀",
          "是台北唯一的書店"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn kết luận: '將閱讀轉化為一種優雅的生活風格' (biến đọc sách thành phong cách sống kết hợp sáng tạo).",
        "pinyin": ""
      },
      {
        "id": 49,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 外送平台在台灣的蓬勃發展\n智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "audio": "",
        "dialogue": "智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "q": "Câu 24: 作者對外送平台的快速發展抱持什麼觀點？",
        "options": [
          "認為應該全面禁止外送服務",
          "覺得外送食品比店內便宜",
          "肯定其便利但也提醒注意帶來的問題",
          "認為外送員賺錢太容易"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả viết: '雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思'.",
        "pinyin": ""
      },
      {
        "id": 50,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 傳統市場與現代超市的共存\n儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "q": "Câu 25: 傳統市場至今依然受歡迎的核心優勢是什麼？",
        "options": [
          "冷氣設備比超市更高級",
          "街坊人情味與依需求客製化的服務",
          "蔬菜肉類都是進口的高級品",
          "所有攤商都二十四小時營業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả chỉ ra: '濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的'.",
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
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：現在天氣真好，吃完午餐一起出去走走吧！ 女：下午可能下大雨，還是待在家吧。 男：今天天氣怎麼樣？",
        "dialogue": "男：現在天氣真好，吃完午餐一起出去走走吧！\n女：下午可能下大雨，還是待在家吧。",
        "q": "男：今天天氣怎麼樣？",
        "options": [
          "白天都是晴天",
          "沒有什麼變化",
          "下午天氣會改變",
          "從早到晚一直下雨"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 下午天氣會改變. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：這本書你看完了吧，覺得怎麼樣？ 女：我真想問問寫書的人，到底想寫什麼，我怎麼看都看不懂！ 男：這位小姐覺得這本書怎麼樣？",
        "dialogue": "男：這本書你看完了吧，覺得怎麼樣？\n女：我真想問問寫書的人，到底想寫什麼，我怎麼看都看不懂！",
        "q": "男：這位小姐覺得這本書怎麼樣？",
        "options": [
          "很生動",
          "很豐富",
          "很有趣",
          "很難懂"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 很難懂. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：美美今天早上和我說她頭疼得不得了。 女：她有點兒發燒，不知道是不是感冒了？我等會兒帶她去看病。 男：這位小姐的意思是什麼？",
        "dialogue": "男：美美今天早上和我說她頭疼得不得了。\n女：她有點兒發燒，不知道是不是感冒了？我等會兒帶她去看病。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她會陪美美去醫院",
          "她不知道美美生病了",
          "美美剛剛去過醫院了",
          "美美已經感冒一段時間了"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她會陪美美去醫院. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小張怎麼還沒來上班？ 女：我打個電話問問他吧！ 男：這位小姐的意思是什麼？",
        "dialogue": "男：小張怎麼還沒來上班？\n女：我打個電話問問他吧！",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "小張今天請假了",
          "她也不知道原因",
          "她剛剛打給小張了",
          "小張應該打電話給她"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她也不知道原因. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：啊，該吃藥了。 女：不行，你飯都還沒吃呢。醫生不是要你吃完飯以後三十分鐘，再吃嗎？ 男：這位小姐的意思是什麼？",
        "dialogue": "男：啊，該吃藥了。\n女：不行，你飯都還沒吃呢。醫生不是要你吃完飯以後三十分鐘，再吃嗎？",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "先吃飯，再吃藥",
          "吃飯前，先吃藥",
          "沒吃藥，不可以吃飯",
          "沒吃飯，也可以吃藥"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 先吃飯，再吃藥. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：這件衣服又便宜又特別。 女：要是再大一點就更好了！ 男：這位小姐的意思是什麼？",
        "dialogue": "男：這件衣服又便宜又特別。\n女：要是再大一點就更好了！",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "衣服大小剛好",
          "她有些不滿意",
          "價錢有一點貴",
          "設計不夠特別"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她有些不滿意. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：你決定新桌子的顏色了嗎？我想等一下就去買。 女：這件事沒那麼急，等我不忙的時候再說吧。 男：這位小姐什麼時候做決定？",
        "dialogue": "男：你決定新桌子的顏色了嗎？我想等一下就去買。\n女：這件事沒那麼急，等我不忙的時候再說吧。",
        "q": "男：這位小姐什麼時候做決定？",
        "options": [
          "她現在就要決定",
          "她等一下就會決定",
          "她有空的時候再決定",
          "她要這位先生自己決定"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她有空的時候再決定. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：媽媽為什麼這麼生氣？ 女：誰知道！問她什麼話都不說。 男：這位小姐的意思是什麼？",
        "dialogue": "男：媽媽為什麼這麼生氣？\n女：誰知道！問她什麼話都不說。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "媽媽很容易生氣",
          "他們讓媽媽生氣了",
          "沒人了解媽媽生氣的原因",
          "她不想知道媽媽為什麼生氣"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 沒人了解媽媽生氣的原因. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：張小姐呢？我好幾天沒看見她了。 女：難道你不知道她到美國去了？ 男：這段對話的意思是什麼？",
        "dialogue": "男：張小姐呢？我好幾天沒看見她了。\n女：難道你不知道她到美國去了？",
        "q": "男：這段對話的意思是什麼？",
        "options": [
          "張小姐出國了",
          "張小姐剛從美國回來",
          "沒人知道張小姐去哪兒",
          "沒人清楚張小姐這個人"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 張小姐出國了. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：週末是我們結婚滿四年的紀念日，我們就帶小寶到第一次約會的餐廳吧！ 女：這樣多沒意思啊！不如明天給媽媽打個電話，拜託她照顧小寶一天，我們倆 外出吃飯、看電影，放鬆一下。 男：這位太太希望怎麼慶祝？",
        "dialogue": "男：週末是我們結婚滿四年的紀念日，我們就帶小寶到第一次約會的餐廳吧！\n女：這樣多沒意思啊！不如明天給媽媽打個電話，拜託她照顧小寶一天，我們倆\n外出吃飯、看電影，放鬆一下。",
        "q": "男：這位太太希望怎麼慶祝？",
        "options": [
          "夫妻倆自己出門",
          "帶著家人看電影",
          "帶孩子到餐廳吃飯",
          "打電話約媽媽一同慶祝"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 夫妻倆自己出門. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：咦，你怎麼全買牛奶啊？家裡不是還有？ 女：嗯，今天牛奶很便宜，買三瓶送兩瓶。 男：那青菜水果呢？我們不是說好要買些青菜水果的… 女：啊，我忘了。 男：這位小姐為什麼去買東西？",
        "dialogue": "男：咦，你怎麼全買牛奶啊？家裡不是還有？\n女：嗯，今天牛奶很便宜，買三瓶送兩瓶。\n男：那青菜水果呢？我們不是說好要買些青菜水果的…\n女：啊，我忘了。",
        "q": "男：這位小姐為什麼去買東西？",
        "options": [
          "家裡已經沒牛奶了",
          "她要買青菜和水果",
          "今天牛奶比較便宜",
          "今天買青菜就送水果"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她要買青菜和水果. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：這星期六我想請你吃飯，你有空嗎？ 女：嗯，星期六不太方便，您不用麻煩了。 男：不行！我一定得請你吃飯，謝謝你幫我搬家。 女：您真是太客氣了，那只是小事一件。 男：這位小姐的意思是什麼?",
        "dialogue": "男：這星期六我想請你吃飯，你有空嗎？\n女：嗯，星期六不太方便，您不用麻煩了。\n男：不行！我一定得請你吃飯，謝謝你幫我搬家。\n女：您真是太客氣了，那只是小事一件。",
        "q": "男：這位小姐的意思是什麼?",
        "options": [
          "請客只是一件小事",
          "她有空就幫忙搬家",
          "她星期六不方便搬家",
          "這位先生不必請她吃飯"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位先生不必請她吃飯. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小美，這個禮拜天你有空嗎？ 女：我得在家寫功課。有什麼事嗎？ 男：那天是我的生日，我想約你一起去看電影。 女：當然沒問題啊！你的生日比任何事都重要。 男：這位小姐的意思是什麼？",
        "dialogue": "男：小美，這個禮拜天你有空嗎？\n女：我得在家寫功課。有什麼事嗎？\n男：那天是我的生日，我想約你一起去看電影。\n女：當然沒問題啊！你的生日比任何事都重要。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她得寫完功課才能看電影",
          "她想看電影，可是功課更重要",
          "她答應和這位先生一起看電影",
          "除了功課，最重要的事就是看電影"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她答應和這位先生一起看電影. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：你在看什麼啊？ 女：喔，是一位客人寄來的信，他說非常感謝我們對他的照顧。 男：這麼客氣，信裡還說些什麼呢？ 女：他說我們的服務很好，住在這裡，感覺就像是住在自己的家裡。 男：這位小姐在哪裡工作？",
        "dialogue": "男：你在看什麼啊？\n女：喔，是一位客人寄來的信，他說非常感謝我們對他的照顧。\n男：這麼客氣，信裡還說些什麼呢？\n女：他說我們的服務很好，住在這裡，感覺就像是住在自己的家裡。",
        "q": "男：這位小姐在哪裡工作？",
        "options": [
          "餐廳",
          "郵局",
          "旅館",
          "飛機上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 旅館. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小雪，我在這兒！ 女：啊！小林，不好意思，我來晚了！ 男：沒關係，坐吧，想喝什麼？我請你。 女：謝謝你！就來一杯和你一樣的吧！。 男：這位小姐的意思是什麼?",
        "dialogue": "男：小雪，我在這兒！\n女：啊！小林，不好意思，我來晚了！\n男：沒關係，坐吧，想喝什麼？我請你。\n女：謝謝你！就來一杯和你一樣的吧！。",
        "q": "男：這位小姐的意思是什麼?",
        "options": [
          "她要小林陪她喝飲料",
          "她要小林喝一點飲料",
          "她不好意思讓小林請客",
          "她點跟小林一樣的飲料"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 她點跟小林一樣的飲料. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：你覺得這個碗怎麼樣，很漂亮吧。 女：還可以，你看看旁邊這個杯子，怎麼樣？ 男：我還是比較喜歡這個碗。 女：那麼我們就各買各的吧！ 男：這位小姐的意思是什麼？",
        "dialogue": "男：你覺得這個碗怎麼樣，很漂亮吧。\n女：還可以，你看看旁邊這個杯子，怎麼樣？\n男：我還是比較喜歡這個碗。\n女：那麼我們就各買各的吧！",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "杯子和碗她都想買",
          "喜歡什麼就買什麼",
          "她同意這位男生說的話",
          "杯子和碗只能選擇一個"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 喜歡什麼就買什麼. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我這個週末想到東部走走。 女：怎麼去？搭火車還是開車呢？ 男：我打算搭火車。不過，我才剛搬來這裡，連火車站在哪都不知道。 女：這樣吧，我明天上午正好有事要到車站附近，我載你去。 男：這位小姐的意思是什麼?",
        "dialogue": "男：我這個週末想到東部走走。\n女：怎麼去？搭火車還是開車呢？\n男：我打算搭火車。不過，我才剛搬來這裡，連火車站在哪都不知道。\n女：這樣吧，我明天上午正好有事要到車站附近，我載你去。",
        "q": "男：這位小姐的意思是什麼?",
        "options": [
          "她也要搭火車到東部",
          "這位先生可以搭她的車",
          "她想載這位先生一起到東部去",
          "她想告訴這位先生怎麼去車站"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 這位先生可以搭她的車. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：你家裡缺不缺鍋子？ 女：怎麼了？要送我啊？ 男：我女朋友走了以後，沒人做飯給我吃，家裡那些鍋子，用不著了。 女：謝謝你的好意。我家裡什麼都缺，就是不缺鍋子。 男：這位小姐的意思是什麼?",
        "dialogue": "男：你家裡缺不缺鍋子？\n女：怎麼了？要送我啊？\n男：我女朋友走了以後，沒人做飯給我吃，家裡那些鍋子，用不著了。\n女：謝謝你的好意。我家裡什麼都缺，就是不缺鍋子。",
        "q": "男：這位小姐的意思是什麼?",
        "options": [
          "她目前不需要鍋子",
          "她最近正好缺了鍋子",
          "她喜歡自己買的鍋子",
          "她正想送鍋子給這位先生"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她目前不需要鍋子. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：玲玲，恭喜我吧！從下星期一開始，我們就是同事了。 女：你什麼時候到我們公司參加面試的，我怎麼不知道？ 男：我誰也沒說，就怕說了卻沒錄取，那可就難看了。 女：你真是愛面子，歡迎你加入我們的行列。 男：這位先生怎麼了?",
        "dialogue": "男：玲玲，恭喜我吧！從下星期一開始，我們就是同事了。\n女：你什麼時候到我們公司參加面試的，我怎麼不知道？\n男：我誰也沒說，就怕說了卻沒錄取，那可就難看了。\n女：你真是愛面子，歡迎你加入我們的行列。",
        "q": "男：這位先生怎麼了?",
        "options": [
          "他還沒找到工作",
          "他下星期要參加面試",
          "他只和玲玲說找工作的事",
          "他將和玲玲在同一家公司上班"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他將和玲玲在同一家公司上班. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：看你手上提著這麼多東西，連開門都需要人幫忙，你中大獎嗎？ 女：沒這回事。今天百貨公司打折，我去搶便宜，省了不少呢！ 男：就算是這樣，東西也多得太誇張了，是不是有朋友請你幫忙買？ 女：這些都是我的，我可是做足了功課才買的。要是錯過這次，那才叫損失。 男：從這段話，我們知道這位小姐什麼事？ 下面是同事之間的對話，請聽完對話後，回答兩個問題。 男：小雪，宣傳單、海報做好了嗎？ 女：什麼活動？ 男：慢跑活動啊！你看看白板，我還在上頭標記這件事很重要！ 女：糟糕！老闆，對不起，我真忘了。 男：你究竟記得哪件事啊！這件事來不及處理好的話，你就不用來了。 女：我馬上找老王、小陳來支援。 21. 小雪忘了哪件事？ 22. 最後，這位老闆的意思是什麼？ 下面是兩位朋友的對話，請聽完對話後，回答兩個問題。 男：真煩！最近什麼都不能吃，連奶粉都有問題。 女：我只聽說牛肉、雞肉有問題，怎麼連奶粉也出問題了？ 男：你還不知道啊！昨晚新聞說有幾家國內知名廠商的奶粉，在加工過程中偷偷 加入了會傷害人體健康的化學品。 女：這也太誇張了吧！奶粉不是從鮮奶直接加工來的嗎？為什麼還要加化學品 呢？ 男：據說可以降低製作成本，所以就有不良廠商這麼做。 女：那我得趕緊看看剛買的嬰兒奶粉是不是有問題的商家製造的。 23. 這位先生為什麼覺得煩？ 24. 從對話中可以知道什麼事？ 下面是一段朋友的對話，請聽完對話後，回答三個問題： 25. 根據對話，阿光怎麼了？ 26. 根據對話，阿光母親的態度怎麼樣？ 27. 小美對阿光說的事有什麼看法？ 現在請聽對話。 男：小美，我昨天和我媽說我想學做蛋糕，結果她聽完後竟然連話也不和我說。 女：為什麼？ 男：我媽媽對我的學業成績要求很高，她認為念書才是最重要的，根本不准我去 做其他事。 女：阿光，你的功課很好，每學期都拿獎學金，讀書對你來說應該不是問題。如 果你可以讓伯母覺得，就算你撥出一點時間來學做蛋糕，也不會影響你的課 業成績，這樣的話，伯母可能會妥協，你試試再和伯母溝通吧！ 下面是艾維和一位女同事的對話，請聽完對話後，回答三個問題： 28. 他們在討論哪方面的事？ 29. 根據對話，為什麼新生兒的父母要請客和送禮？ 30. 最後，艾維對這位小姐說的話有什麼看法？ 現在請聽對話。 女：艾維，你在做什麼啊？這麼專心。 男：我太太就快生了，最近收了很多紅包，讓我覺得很不好意思。所以我就用這 些錢買了寶寶用的東西，正準備寫成單子給大家看。 女：這樣啊！同事們給紅包應該不是想看這個禮物單子，他們只是希望給你們祝 福而已。這禮物單子可以免了，不過滿月酒啊、滿月禮之類的可不能少喔。 男：你指的是請大家吃飯、喝酒嗎？這倒沒問題。 女：事情可沒這麼簡單。對華人來說，在小孩出生後滿一個月的那一天，小孩的 爸媽會邀請親朋好友一起吃飯，慶祝媽媽安全生產，也會讓小孩和大家見面， 除了親自感謝大家的關心，還會準備一份滿月禮送給親朋好友。 男：天啊！又吃飯又送禮，可不可以只分享禮物單子啊？ 第二部分 段落 請聽這一段話，然後回答下面的兩個問題。 我家附近靠河邊的地方，原本是一片空地，那裡有非常多的樹木、花草，還 有很多人在那裡散步、騎腳踏車。有段時間，大家聽說這片空地要賣給建設公司， 變成辦公大樓。不過，在大家的爭取下，這片空地現在成了公園，讓住在這附近 的人有地方運動，這真是一件讓人開心的事。 31. 從這段話可以知道，說話的人住家附近有什麼？ 32. 說話的人因為哪一件事覺得很開心？ 請聽這段話，然後回答下面的兩個問題。 很多人想把小孩送到國外學習外國語，認為學習語言就應該到當地學習，但 是這樣就一定能把語言學好嗎？很多孩子到了當地，連話都不敢說，也交不到當 地的朋友，到最後還是只和自己國家的人走在一起，這樣出國不出國有什麼不 同！ 33. 說話的人認為孩子到國外念書會遇到什麼問題？ 34. 說話的人認為出國讀書怎麼樣？ 請聽這一段電話錄音，然後回答下面的兩個問題。 您好，我是小美，這幾天我有事出去，大概下週回來，不管您是要買花、請 我幫您種花，還是想來店裡喝一杯花茶，請先留下聯絡方式，我會再和您確認。 35. 小美希望打電話來的人，告訴她什麼事？ 36. 小美的工作是什麼？ 請聽這一段話，然後回答下面的兩個問題。 我媽媽很忙，她是電腦公司的老闆，所以每天都有做不完的工作。不過，她 從來不會忘記幫我們準備飯菜，冰箱裡總是有水果和點心，生日的時候一定有禮 物。只是，平常她總在公司工作到很晚，放了假在家裡，她還是在工作，我和她 聊天的機會不太多，真希望她不要這麼忙，能多陪我就好了！ 37. 關於這位媽媽的敘述，下面哪一個是對的？ 38. 說話的人想要什麼？ 請聽這一段話，然後回答下面的兩個問題。 李小姐，你好。我姓陳，是這間辦公室的主任。歡迎來我們公司工作！我們 辦公室就這麼大，一進來，右手邊有一間小廚房，可以煮咖啡喝，還有冰箱可以 使用，廚房的旁邊是洗手間。我的位子在窗戶旁邊，你如果有事可以隨時來找我。 39. 這段話主要在說什麼？ 40. 陳主任提到了辦公室裡有什麼？ 請聽這一段電腦購票系統的語音指示，然後回答下面的兩個問題。 您好，歡迎使用語音購票系統 請注意，本系統只接受信用卡購票 請輸入乘車日期，如7 月4 號，請輸入0704 請輸入訂票車次，如1097 車次，請按1097＃ 請選擇訂票張數。一張請按1 請注意，一人最多訂四張 螢幕顯示您的訂票資訊…確定請按1，取消請按2 請輸入信用卡卡號… 購票完成，請拿票，謝謝。 41. 用這套系統訂票，要提供哪些資料？ 42. 用這套系統訂車票，要注意什麼事？ 請聽這一段話，然後回答下面的兩個問題。 早上家裡的電話響個不停，一直沒人接，我只好起床接電話，原來是媽媽打 來的。因為今天有客人到家裡來，所以她一早就出門買菜了。她問我客人來了沒 有？要我把客廳整理乾淨，我告訴她，客人來了我會招待，請她不要擔心。 43. 媽媽為什麼打電話回家？ 44. 說話的人告訴媽媽什麼? 請聽一則和公共政策有關的報導，然後回答下面三個問題： 45. 根據報導，政府推動這項新政策主要是為了什麼？ 46. 報導中提到民眾對這項新政策的反應怎麼樣？ 47. 下面哪件事符合這項新政策的概念？ 現在請聽報導。 近年來，民眾越來越重視休閒生活，許多人都利用週末假期到戶外活動。但 是，快速增加的旅遊人潮不僅在旅遊景點造成了交通問題，也給當地帶來了廢氣 和噪音。因此，政府不久前開始積極推動「低碳旅遊」。實際的作法像是搭乘巴 士或火車到達較遠的景點，再利用腳踏車或步行的方式，完成短距離的移動。 低碳旅遊的觀念已經逐漸被民眾接受，最近更擴大到其他方面。除了交通， 也包括了旅行時自己準備餐具，住旅館時不使用旅館提供的一次性用品，或是只 食用當地、當季的飲食，以及不把垃圾留在旅遊地等等。目前許多旅遊業者正共 同推動低碳旅遊，只要消費者符合低碳旅遊的條件，旅遊業者就提供他們折扣。 請聽一則有關《大英百科全書》的報導，然後回答下面三個問題： 48. 《大英百科全書》銷售量下滑的主要原因是什麼？ 49. 《大英百科全書》的轉機是什麼？ 50. 報導最後用豪華轎車來說明什麼？ 現在請聽報導。 《大英百科全書》在1768 年出版，雖然價格昂貴，仍維持極高的市場佔有 率。但是隨著時代的轉變和科技的創新，改變了這部百科全書的命運，銷售金額 不但下滑了一半，甚至，一度被埋沒在資訊革命的潮流裡，直到1996 年瑞士商 人買下之後，才出現轉機，成為以線上資料庫為主的公司。 《大英百科全書》所面臨的銷售問題，還有另一深層的意義，以前，擁有一 套百科全書就好像擁有一部豪華轎車一樣，是財富與地位的象徵，但現在隨著獲 得知識的方法改變，人們也不再以擁有一套百科全書來作為展示自我的方式了。",
        "dialogue": "男：看你手上提著這麼多東西，連開門都需要人幫忙，你中大獎嗎？\n女：沒這回事。今天百貨公司打折，我去搶便宜，省了不少呢！\n男：就算是這樣，東西也多得太誇張了，是不是有朋友請你幫忙買？\n女：這些都是我的，我可是做足了功課才買的。要是錯過這次，那才叫損失。\n男：從這段話，我們知道這位小姐什麼事？\n下面是同事之間的對話，請聽完對話後，回答兩個問題。\n男：小雪，宣傳單、海報做好了嗎？\n女：什麼活動？\n男：慢跑活動啊！你看看白板，我還在上頭標記這件事很重要！\n女：糟糕！老闆，對不起，我真忘了。\n男：你究竟記得哪件事啊！這件事來不及處理好的話，你就不用來了。\n女：我馬上找老王、小陳來支援。\n21. 小雪忘了哪件事？\n22. 最後，這位老闆的意思是什麼？\n下面是兩位朋友的對話，請聽完對話後，回答兩個問題。\n男：真煩！最近什麼都不能吃，連奶粉都有問題。\n女：我只聽說牛肉、雞肉有問題，怎麼連奶粉也出問題了？\n男：你還不知道啊！昨晚新聞說有幾家國內知名廠商的奶粉，在加工過程中偷偷\n加入了會傷害人體健康的化學品。\n女：這也太誇張了吧！奶粉不是從鮮奶直接加工來的嗎？為什麼還要加化學品\n呢？\n男：據說可以降低製作成本，所以就有不良廠商這麼做。\n女：那我得趕緊看看剛買的嬰兒奶粉是不是有問題的商家製造的。\n23. 這位先生為什麼覺得煩？\n24. 從對話中可以知道什麼事？\n下面是一段朋友的對話，請聽完對話後，回答三個問題：\n25. 根據對話，阿光怎麼了？\n26. 根據對話，阿光母親的態度怎麼樣？\n27. 小美對阿光說的事有什麼看法？\n現在請聽對話。\n男：小美，我昨天和我媽說我想學做蛋糕，結果她聽完後竟然連話也不和我說。\n女：為什麼？\n男：我媽媽對我的學業成績要求很高，她認為念書才是最重要的，根本不准我去\n做其他事。\n女：阿光，你的功課很好，每學期都拿獎學金，讀書對你來說應該不是問題。如\n果你可以讓伯母覺得，就算你撥出一點時間來學做蛋糕，也不會影響你的課\n業成績，這樣的話，伯母可能會妥協，你試試再和伯母溝通吧！\n下面是艾維和一位女同事的對話，請聽完對話後，回答三個問題：\n28. 他們在討論哪方面的事？\n29. 根據對話，為什麼新生兒的父母要請客和送禮？\n30. 最後，艾維對這位小姐說的話有什麼看法？\n現在請聽對話。\n女：艾維，你在做什麼啊？這麼專心。\n男：我太太就快生了，最近收了很多紅包，讓我覺得很不好意思。所以我就用這\n些錢買了寶寶用的東西，正準備寫成單子給大家看。\n女：這樣啊！同事們給紅包應該不是想看這個禮物單子，他們只是希望給你們祝\n福而已。這禮物單子可以免了，不過滿月酒啊、滿月禮之類的可不能少喔。\n男：你指的是請大家吃飯、喝酒嗎？這倒沒問題。\n女：事情可沒這麼簡單。對華人來說，在小孩出生後滿一個月的那一天，小孩的\n爸媽會邀請親朋好友一起吃飯，慶祝媽媽安全生產，也會讓小孩和大家見面，\n除了親自感謝大家的關心，還會準備一份滿月禮送給親朋好友。\n男：天啊！又吃飯又送禮，可不可以只分享禮物單子啊？\n第二部分 段落\n請聽這一段話，然後回答下面的兩個問題。\n我家附近靠河邊的地方，原本是一片空地，那裡有非常多的樹木、花草，還\n有很多人在那裡散步、騎腳踏車。有段時間，大家聽說這片空地要賣給建設公司，\n變成辦公大樓。不過，在大家的爭取下，這片空地現在成了公園，讓住在這附近\n的人有地方運動，這真是一件讓人開心的事。\n31. 從這段話可以知道，說話的人住家附近有什麼？\n32. 說話的人因為哪一件事覺得很開心？\n請聽這段話，然後回答下面的兩個問題。\n很多人想把小孩送到國外學習外國語，認為學習語言就應該到當地學習，但\n是這樣就一定能把語言學好嗎？很多孩子到了當地，連話都不敢說，也交不到當\n地的朋友，到最後還是只和自己國家的人走在一起，這樣出國不出國有什麼不\n同！\n33. 說話的人認為孩子到國外念書會遇到什麼問題？\n34. 說話的人認為出國讀書怎麼樣？\n請聽這一段電話錄音，然後回答下面的兩個問題。\n您好，我是小美，這幾天我有事出去，大概下週回來，不管您是要買花、請\n我幫您種花，還是想來店裡喝一杯花茶，請先留下聯絡方式，我會再和您確認。\n35. 小美希望打電話來的人，告訴她什麼事？\n36. 小美的工作是什麼？\n請聽這一段話，然後回答下面的兩個問題。\n我媽媽很忙，她是電腦公司的老闆，所以每天都有做不完的工作。不過，她\n從來不會忘記幫我們準備飯菜，冰箱裡總是有水果和點心，生日的時候一定有禮\n物。只是，平常她總在公司工作到很晚，放了假在家裡，她還是在工作，我和她\n聊天的機會不太多，真希望她不要這麼忙，能多陪我就好了！\n37. 關於這位媽媽的敘述，下面哪一個是對的？\n38. 說話的人想要什麼？\n請聽這一段話，然後回答下面的兩個問題。\n李小姐，你好。我姓陳，是這間辦公室的主任。歡迎來我們公司工作！我們\n辦公室就這麼大，一進來，右手邊有一間小廚房，可以煮咖啡喝，還有冰箱可以\n使用，廚房的旁邊是洗手間。我的位子在窗戶旁邊，你如果有事可以隨時來找我。\n39. 這段話主要在說什麼？\n40. 陳主任提到了辦公室裡有什麼？\n請聽這一段電腦購票系統的語音指示，然後回答下面的兩個問題。\n您好，歡迎使用語音購票系統\n請注意，本系統只接受信用卡購票\n請輸入乘車日期，如7 月4 號，請輸入0704\n請輸入訂票車次，如1097 車次，請按1097＃\n請選擇訂票張數。一張請按1\n請注意，一人最多訂四張\n螢幕顯示您的訂票資訊…確定請按1，取消請按2\n請輸入信用卡卡號…\n購票完成，請拿票，謝謝。\n41. 用這套系統訂票，要提供哪些資料？\n42. 用這套系統訂車票，要注意什麼事？\n請聽這一段話，然後回答下面的兩個問題。\n早上家裡的電話響個不停，一直沒人接，我只好起床接電話，原來是媽媽打\n來的。因為今天有客人到家裡來，所以她一早就出門買菜了。她問我客人來了沒\n有？要我把客廳整理乾淨，我告訴她，客人來了我會招待，請她不要擔心。\n43. 媽媽為什麼打電話回家？\n44. 說話的人告訴媽媽什麼?\n請聽一則和公共政策有關的報導，然後回答下面三個問題：\n45. 根據報導，政府推動這項新政策主要是為了什麼？\n46. 報導中提到民眾對這項新政策的反應怎麼樣？\n47. 下面哪件事符合這項新政策的概念？\n現在請聽報導。\n近年來，民眾越來越重視休閒生活，許多人都利用週末假期到戶外活動。但\n是，快速增加的旅遊人潮不僅在旅遊景點造成了交通問題，也給當地帶來了廢氣\n和噪音。因此，政府不久前開始積極推動「低碳旅遊」。實際的作法像是搭乘巴\n士或火車到達較遠的景點，再利用腳踏車或步行的方式，完成短距離的移動。\n低碳旅遊的觀念已經逐漸被民眾接受，最近更擴大到其他方面。除了交通，\n也包括了旅行時自己準備餐具，住旅館時不使用旅館提供的一次性用品，或是只\n食用當地、當季的飲食，以及不把垃圾留在旅遊地等等。目前許多旅遊業者正共\n同推動低碳旅遊，只要消費者符合低碳旅遊的條件，旅遊業者就提供他們折扣。\n請聽一則有關《大英百科全書》的報導，然後回答下面三個問題：\n48. 《大英百科全書》銷售量下滑的主要原因是什麼？\n49. 《大英百科全書》的轉機是什麼？\n50. 報導最後用豪華轎車來說明什麼？\n現在請聽報導。\n《大英百科全書》在1768 年出版，雖然價格昂貴，仍維持極高的市場佔有\n率。但是隨著時代的轉變和科技的創新，改變了這部百科全書的命運，銷售金額\n不但下滑了一半，甚至，一度被埋沒在資訊革命的潮流裡，直到1996 年瑞士商\n人買下之後，才出現轉機，成為以線上資料庫為主的公司。\n《大英百科全書》所面臨的銷售問題，還有另一深層的意義，以前，擁有一\n套百科全書就好像擁有一部豪華轎車一樣，是財富與地位的象徵，但現在隨著獲",
        "q": "得知識的方法改變，人們也不再以擁有一套百科全書來作為展示自我的方式了。",
        "options": [
          "她準備充分後才購物",
          "她最近得到了一筆獎金",
          "她錯過了這次的折扣活動",
          "她答應順便幫朋友買東西"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她準備充分後才購物. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 21",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 21",
        "options": [
          "參加慢跑",
          "找人幫忙",
          "製作海報",
          "幫人報名"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 製作海報. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 22",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 22",
        "options": [
          "要小雪立刻辭職",
          "要小雪趕快補救",
          "要小雪別再宣傳活動",
          "要小雪記住重要的事"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 要小雪趕快補救. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 23",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 23",
        "options": [
          "他的健康出了問題",
          "買不到進口食品了",
          "肉類產品的供應持續缺乏",
          "越來越多的食物出了狀況"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 越來越多的食物出了狀況. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 24",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 24",
        "options": [
          "買大廠製的奶粉比較有保障",
          "商店聯合調高嬰兒奶粉的售價",
          "買奶粉時要留意問題廠商有哪些",
          "嬰兒奶粉缺貨的情況越來越嚴重"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 買奶粉時要留意問題廠商有哪些. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 25",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 25",
        "options": [
          "要幫忙賺錢養家",
          "不能做想做的事情",
          "成績太差，讓母親生氣",
          "找不到教他做蛋糕的人"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 不能做想做的事情. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 1: Chọn từ thích hợp điền vào vị trí [1] trong bài.",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng bị động '被'送進了醫院 (được đưa vào bệnh viện).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 2: Chọn từ thích hợp điền vào vị trí [2] trong bài.",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'陪'張太太到醫院去 (đi cùng / hộ tống vợ đến viện).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 3: Chọn từ thích hợp điền vào vị trí [3] trong bài.",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'當'爸爸 (làm cha / làm bố).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 4: Chọn từ thích hợp điền vào vị trí [4] trong bài.",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'為'這個孩子想了一個名字 (nghĩ tên 'cho' đứa trẻ).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 5: Chọn từ thích hợp điền vào vị trí [5] trong bài.",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'希望' (hy vọng con gái sau này vừa xinh đẹp vừa vui vẻ).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 6: Chọn từ thích hợp điền vào vị trí [6] trong bài.",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'大學時代' (thời kỳ đại học).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 7: Chọn từ thích hợp điền vào vị trí [7] trong bài.",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp mặt.",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 8: Chọn từ thích hợp điền vào vị trí [8] trong bài.",
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
        "q": "Câu 9: Chọn từ thích hợp điền vào vị trí [9] trong bài.",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'照'著信上的地址 (dựa theo / lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 10: Chọn từ thích hợp điền vào vị trí [10] trong bài.",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp được nữa).",
        "pinyin": ""
      },
      {
        "id": 36,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 11: Chọn từ thích hợp điền vào vị trí [11] trong bài.",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'安排'戶外活動 (sắp xếp thời gian hoạt động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 37,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 12: Chọn từ thích hợp điền vào vị trí [12] trong bài.",
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
        "q": "Câu 13: Chọn từ thích hợp điền vào vị trí [13] trong bài.",
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
        "q": "Câu 14: Chọn từ thích hợp điền vào vị trí [14] trong bài.",
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
        "q": "Câu 15: Chọn từ thích hợp điền vào vị trí [15] trong bài.",
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
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "q": "Câu 16: 下面哪一個是對的？",
        "options": [
          "小明已經去過韓國兩次了",
          "小明想學習怎麼做韓國菜",
          "小明覺得韓國不怎麼好玩",
          "小明在韓國住了四個晚上"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết: '他在那兒玩了五天四夜' nghĩa là ở Hàn Quốc 4 đêm (住了四個晚上).",
        "pinyin": ""
      },
      {
        "id": 42,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 母親面對孩子的不安\n孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，態度怎麼樣？",
        "options": [
          "既害怕又不忍心",
          "不知道該怎麼辦",
          "覺得孩子很可憐",
          "鼓勵孩子自己解決"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ mỉm cười và kiên định nói: '你要學著去面對你自己的人生', khích lệ con tự đối diện và giải quyết.",
        "pinyin": ""
      },
      {
        "id": 43,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣夜市文化與電子支付\n以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "audio": "",
        "dialogue": "以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "q": "Câu 18: 根據這段文字，夜市引入行動支付帶來什麼好處？",
        "options": [
          "攤位租金變得更便宜",
          "結帳更快速且減少排隊",
          "觀光客可以買到打折商品",
          "大家不用再帶手機出門"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Bài viết nêu rõ: '減少了排隊找零的時間... 效率都因此大幅提升' (thanh toán nhanh hơn và giảm xếp hàng).",
        "pinyin": ""
      },
      {
        "id": 44,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台北捷運環保便民措施\n台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "audio": "",
        "dialogue": "台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪一項特色？",
        "options": [
          "列車行駛速度世界第一",
          "車廂內提供免費餐點",
          "充滿人情味的便民服務",
          "票價比其他交通工具便宜"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả nhấn mạnh: '展現了台灣社會溫暖的人情味' (dịch vụ tiện dân ấm áp tình người).",
        "pinyin": ""
      },
      {
        "id": 45,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 垃圾分類與隨袋徵收政策\n台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "audio": "",
        "dialogue": "台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "q": "Câu 20: 『垃圾費隨袋徵收』政策如何有效減少垃圾量？",
        "options": [
          "規定每週只能倒一次垃圾",
          "透過購買專用垃圾袋促使民眾做好回收",
          "禁止市民購買任何塑膠包裝",
          "對亂丟垃圾的人處以重罰"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Người dân phải mua túi rác chuyên dụng cho rác thông thường, còn rác tái chế miễn phí, từ đó thúc đẩy phân loại triệt để.",
        "pinyin": ""
      },
      {
        "id": 46,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 高鐵對台灣一日生活圈的影響\n自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "audio": "",
        "dialogue": "自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "q": "Câu 21: 『一日生活圈』對人們生活產生什麼主要影響？",
        "options": [
          "所有人都要搬去南部居住",
          "高鐵車票價格大幅下降",
          "南北往返當天即可完成工作",
          "飛機成為主要交通工具"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đoạn văn minh họa sáng họp ở Đài Bắc, chiều kiểm tra nhà máy Đài Nam, tối về lại Đài Bắc (đi lại hoàn thành trong ngày).",
        "pinyin": ""
      },
      {
        "id": 47,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 台灣全民健康保險制度\n台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "audio": "",
        "dialogue": "台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "q": "Câu 22: 健保雲端系統的主要功能是什麼？",
        "options": [
          "自動幫病患繳交健保費",
          "即時查詢用藥紀錄避免重複開藥",
          "線上直接替病患開刀手術",
          "向國外藥廠訂購廉價藥品"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Văn bản nêu: '即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 48,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 誠品書店的二十四小時閱讀風潮\n誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "q": "Câu 23: 這家二十四小時書店之所以成為文化地標，是因為什麼？",
        "options": [
          "深夜買書享有半價優惠",
          "將閱讀轉化為結合文創的生活風格",
          "只允許專業作家進去閱讀",
          "是台北唯一的書店"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn kết luận: '將閱讀轉化為一種優雅的生活風格' (biến đọc sách thành phong cách sống kết hợp sáng tạo).",
        "pinyin": ""
      },
      {
        "id": 49,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 外送平台在台灣的蓬勃發展\n智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "audio": "",
        "dialogue": "智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "q": "Câu 24: 作者對外送平台的快速發展抱持什麼觀點？",
        "options": [
          "認為應該全面禁止外送服務",
          "覺得外送食品比店內便宜",
          "肯定其便利但也提醒注意帶來的問題",
          "認為外送員賺錢太容易"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả viết: '雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思'.",
        "pinyin": ""
      },
      {
        "id": 50,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解)",
        "context": "Đoản văn: 傳統市場與現代超市的共存\n儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "q": "Câu 25: 傳統市場至今依然受歡迎的核心優勢是什麼？",
        "options": [
          "冷氣設備比超市更高級",
          "街坊人情味與依需求客製化的服務",
          "蔬菜肉類都是進口的高級品",
          "所有攤商都二十四小時營業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả chỉ ra: '濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的'.",
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
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：下個月的歌唱比賽，你能不能和我一起合唱一首歌？ 女：只要人多，我就緊張得說不出話，更不用說唱歌了，我還是當觀眾幫你加油 就好。 男：關於唱歌比賽，這位小姐打算怎麼做？",
        "dialogue": "男：下個月的歌唱比賽，你能不能和我一起合唱一首歌？\n女：只要人多，我就緊張得說不出話，更不用說唱歌了，我還是當觀眾幫你加油\n就好。",
        "q": "男：關於唱歌比賽，這位小姐打算怎麼做？",
        "options": [
          "她不參加比賽",
          "她要自己唱一首歌",
          "她還沒決定要不要參加",
          "她要和這位先生一起練習"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她不參加比賽. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳聽過這首歌沒有？ 女：我妹妹天天都聽這首歌，我都會背了。 男：這位小姐的意思是什麼？",
        "dialogue": "男：妳聽過這首歌沒有？\n女：我妹妹天天都聽這首歌，我都會背了。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "妹妹教過她這首歌",
          "她一下子就記住這首歌",
          "這首歌她聽了好多次了",
          "妹妹唱過的歌，她都記得"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 這首歌她聽了好多次了. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：您年紀這麼大了，還去念研究所，真了不起！ 女：哪裡哪裡！活到老學到老嘛！ 男：這位女士的意思是什麼？",
        "dialogue": "男：您年紀這麼大了，還去念研究所，真了不起！\n女：哪裡哪裡！活到老學到老嘛！",
        "q": "男：這位女士的意思是什麼？",
        "options": [
          "她老了才打算開始唸書",
          "她認為人要不斷地學習",
          "她不清楚為什麼別人讚美她",
          "她認為多唸書，可以活得久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她認為人要不斷地學習. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：你快一點行不行？七點的電影快開始了！ 女：還有半個小時呢，坐計程車去，二十分鐘就到了。 男：這位小姐的意思是什麼？",
        "dialogue": "男：你快一點行不行？七點的電影快開始了！\n女：還有半個小時呢，坐計程車去，二十分鐘就到了。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "電影七點半才開始",
          "電影七點二十分才開始",
          "還有二十分電影才開始",
          "還有半小時電影才開始"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 還有半小時電影才開始. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：這家餐廳怎麼一個禮拜都沒開門？ 女：生意太差，老闆不做了。 男：這家餐廳怎麼了？",
        "dialogue": "男：這家餐廳怎麼一個禮拜都沒開門？\n女：生意太差，老闆不做了。",
        "q": "男：這家餐廳怎麼了？",
        "options": [
          "換了新的食物",
          "換了新的老闆",
          "不再做生意了",
          "休息七天才開門"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 不再做生意了. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小姐，請妳把嘴巴再張大一點，是這顆牙齒痛嗎？ 女：不是，要再往右邊一點，啊！就是這裡，疼得我什麼都不能吃。 男：這段話最可能發生在什麼地方？",
        "dialogue": "男：小姐，請妳把嘴巴再張大一點，是這顆牙齒痛嗎？\n女：不是，要再往右邊一點，啊！就是這裡，疼得我什麼都不能吃。",
        "q": "男：這段話最可能發生在什麼地方？",
        "options": [
          "醫院",
          "學校",
          "餐廳",
          "計程車上"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 醫院. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：這些錢請妳數一數，看看對不對？ 女：我數好了，一塊錢也沒少。 男：這些錢怎麼樣？",
        "dialogue": "男：這些錢請妳數一數，看看對不對？\n女：我數好了，一塊錢也沒少。",
        "q": "男：這些錢怎麼樣？",
        "options": [
          "少了一塊錢",
          "少了不少錢",
          "多了一塊錢",
          "錢不多也不少"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 錢不多也不少. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳知道嗎？剛剛那位醫生不但沒開藥給我，還說我不是感冒，只要多喝白開 水就可以了。 女：誰叫你平常只喝可樂、果汁之類的飲料，要你喝白開水，好像要你的命一樣。 現在醫生可站出來替你的身體說話囉！ 男：這位小姐認為這位先生怎麼樣？",
        "dialogue": "男：妳知道嗎？剛剛那位醫生不但沒開藥給我，還說我不是感冒，只要多喝白開\n水就可以了。\n女：誰叫你平常只喝可樂、果汁之類的飲料，要你喝白開水，好像要你的命一樣。\n現在醫生可站出來替你的身體說話囉！",
        "q": "男：這位小姐認為這位先生怎麼樣？",
        "options": [
          "感冒症狀比想像中嚴重",
          "光喝開水對身體沒幫助",
          "不吃藥可能會要他的命",
          "飲食習慣本來就有問題"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 飲食習慣本來就有問題. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：最近服務生的反應速度也太差了。 女：大概是電視節目一直宣傳的關係，客人突然增加，來不及應付吧！ 男：不過菜再好吃也沒用，常常無法維持服務品質，環境又吵，連我們這種老客 人也不想來了。 女：我看，我們又得重新找約會地點了。 男：這位先生和小姐現在對這家餐廳的看法是什麼？",
        "dialogue": "男：最近服務生的反應速度也太差了。\n女：大概是電視節目一直宣傳的關係，客人突然增加，來不及應付吧！\n男：不過菜再好吃也沒用，常常無法維持服務品質，環境又吵，連我們這種老客\n人也不想來了。\n女：我看，我們又得重新找約會地點了。",
        "q": "男：這位先生和小姐現在對這家餐廳的看法是什麼？",
        "options": [
          "客人太多讓服務的水準降低",
          "餐廳食物的味道沒以前的好",
          "不應該接受電視節目的訪問",
          "服務生得罪很多常來的客人"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 客人太多讓服務的水準降低. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我最近打算再試試其他工作，看看有沒有更好的。 女：上次不是聽你說，這工作待遇不錯，你覺得挺好的嗎？ 男：可是經常為了客戶的事，到了週末還得加班，我覺得太說不過去了。 女：喔，信不信由你，週末加班對我來說，根本是家常便飯。 男：這位小姐的意思是什麼？",
        "dialogue": "男：我最近打算再試試其他工作，看看有沒有更好的。\n女：上次不是聽你說，這工作待遇不錯，你覺得挺好的嗎？\n男：可是經常為了客戶的事，到了週末還得加班，我覺得太說不過去了。\n女：喔，信不信由你，週末加班對我來說，根本是家常便飯。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她已經習慣週末要加班",
          "她覺得自己的工作比較輕鬆",
          "她經常利用週末和客戶吃飯",
          "她不相信這位先生週末要加班"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她已經習慣週末要加班. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：現在景氣不好，別人會不會覺得我們產品的定價高得離譜？ 女：這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。 男：你這麼有把握啊！ 女：你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。 男：這位小姐的意思是什麼？",
        "dialogue": "男：現在景氣不好，別人會不會覺得我們產品的定價高得離譜？\n女：這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。\n男：你這麼有把握啊！\n女：你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "現在的皮椅都是七八十萬",
          "打折以後，買皮椅的人不少",
          "再貴一點的皮椅就沒有人買了",
          "不少人買得起七八十萬的皮椅"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不少人買得起七八十萬的皮椅. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。 女：你怎麼不勸勸他呢？ 男：我當然說啦！退一步海闊天空嘛！不過他聽不進去。 女：都到這個節骨眼了他還堅持己見，真是不可理喻。 男：這位太太說老劉怎麼樣？",
        "dialogue": "男：唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。\n女：你怎麼不勸勸他呢？\n男：我當然說啦！退一步海闊天空嘛！不過他聽不進去。\n女：都到這個節骨眼了他還堅持己見，真是不可理喻。",
        "q": "男：這位太太說老劉怎麼樣？",
        "options": [
          "沒法跟老劉講道理",
          "是個沒有原則的人",
          "堅持立場、值得尊敬",
          "再多勸一下，他就會讓步"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 沒法跟老劉講道理. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：怎麼啦？垂頭喪氣的？ 女：我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。 男：勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動 都進入決賽呢！ 女：就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！ 男：代表隊在這次比賽的表現怎麼樣？",
        "dialogue": "男：怎麼啦？垂頭喪氣的？\n女：我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。\n男：勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動\n都進入決賽呢！\n女：就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！",
        "q": "男：代表隊在這次比賽的表現怎麼樣？",
        "options": [
          "連決賽都沒進",
          "只得到一個獎",
          "一個獎都沒得到",
          "只有一項沒得獎"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 一個獎都沒得到. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小趙這孩子，頭腦不錯，就是個性太急躁。 女：哈哈，年輕人嘛！做事難免比較衝動。 男：正好老王那兒有缺，我想叫他去試一試。 女：嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。 男：為什麼小趙幫老王做事是種磨練？",
        "dialogue": "男：小趙這孩子，頭腦不錯，就是個性太急躁。\n女：哈哈，年輕人嘛！做事難免比較衝動。\n男：正好老王那兒有缺，我想叫他去試一試。\n女：嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。",
        "q": "男：為什麼小趙幫老王做事是種磨練？",
        "options": [
          "老王的眼睛不好",
          "老王做事很嚴謹",
          "老王個性很馬虎",
          "老王不喜歡小趙"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 老王做事很嚴謹. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：咦！最近你好像特別忙。 女：唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司， 偏偏那兒又需要好好整頓一番。 男：小趙怎麼樣，服務的時間久，學歷也不錯。 女：他人緣差不說，又經常敷衍了事，你想我能指望他嗎？ 男：這位女士的意思是什麼？",
        "dialogue": "男：咦！最近你好像特別忙。\n女：唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司，\n偏偏那兒又需要好好整頓一番。\n男：小趙怎麼樣，服務的時間久，學歷也不錯。\n女：他人緣差不說，又經常敷衍了事，你想我能指望他嗎？",
        "q": "男：這位女士的意思是什麼？",
        "options": [
          "小趙拒絕了她",
          "小趙不值得信賴",
          "小趙對工作很失望",
          "她怕小趙不會答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 小趙不值得信賴. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？ 女：保證萬無一失，絕對沒問題，你放心吧！ 男：這位小姐的話是什麼意思？",
        "dialogue": "男：妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？\n女：保證萬無一失，絕對沒問題，你放心吧！",
        "q": "男：這位小姐的話是什麼意思？",
        "options": [
          "這麼做一定行得通",
          "她想買保險以免發生問題",
          "因為已保了險，所以沒問題",
          "這麼做風險很高，但值得冒險嘗試"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 這麼做一定行得通. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小劉費盡心思取悅父母，結果卻失敗了。 女：誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂 啊！ 男：根據這位小姐的說法，小劉失敗的原因是什麼？",
        "dialogue": "男：小劉費盡心思取悅父母，結果卻失敗了。\n女：誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂\n啊！",
        "q": "男：根據這位小姐的說法，小劉失敗的原因是什麼？",
        "options": [
          "小劉的父母要求太多",
          "小劉還沒有顯著的成就",
          "小劉沒滿足父母最大的期待",
          "小劉的父母不要求兒子有成就"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 小劉沒滿足父母最大的期待. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：老闆說這個案子得在一個星期裡完成，這怎麼可能呢？ 女：還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！ 男：這位小姐有什麼意見？",
        "dialogue": "男：老闆說這個案子得在一個星期裡完成，這怎麼可能呢？\n女：還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！",
        "q": "男：這位小姐有什麼意見？",
        "options": [
          "做這個案子得花時間",
          "做這個案子並不容易",
          "做這個案子不必認真",
          "做這個案子要有能力"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 做這個案子不必認真. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置， 那裡的視野還不錯，可以清楚地看見吳老師演奏。 女：你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞 不是重點，你就把錢省下來吧！ 男：這位小姐對這次演奏會的座位有什麼看法？ 請聽這段對話，然後回答兩個問題。 男：你最近怎麼老躲著小王？ 女：他一直想約我單獨跟他出去，可是… 男：怎麼了？你好像不太願意？ 女：小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？ 20. 這位小姐對小王的感覺如何？ 21. 對小王的邀請，這位小姐覺得如何？ 請聽這段對話，然後回答下面的兩個問題。 男：你們又來了，這次又有什麼事？ 女：趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請 您共襄盛舉，捐點錢救濟災民。 男：不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道 就這樣送給你們？ 女：喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放 心啊！ 男：口說無憑，你不如先寄份帳冊來給我看吧！ 22. 關於這位先生，哪一個是對的？ 23. 這位先生最後的態度怎麼樣？ 下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。 男：小姐，我覺得這發票上的金額好像不太對。 女：好的，馬上為您處理。這些一共是500元，金額沒錯。 男：是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不 管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡， 為什麼沒打折？ 女：我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主 要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能 享有九折優惠。不好意思，我們店裡並沒有配合這個活動。 24. 店員和客人發生了什麼事？ 25. 有關宣傳單上的活動說明，下面哪一項是對的？ 請聽這一段和「味精」有關的討論，然後回答兩個問題。 男：佳美，你看這則味精的報導。 女：嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過 另外一篇報告，結果完全相反。 男：是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就 不碰吧！ 女：每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也 還沒證實，所以，你別太擔心了。 26. 這位先生覺得味精怎麼樣？ 27. 這位小姐的意思是什麼？ 下面是一段兄妹之間的對話，請聽完後，回答下面三個問題： 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 現在請聽對話。 男：昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還 來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪 氣的。 女：哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘， 該不會是… 男：長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘 的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想 到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一 會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！ 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 第二部分 段落 請聽這一段話，然後回答下面的問題。 小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋 糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和 小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小 青聽了，很高興，也很感謝。 31. 從這段話可以知道什麼？ 請聽這一段話，然後回答下面的問題。 如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常 聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生， 不過聽音樂絕不會對你造成傷害。 32. 這段話的意思是什麼？ 請聽這一段電話留言，然後回答下面的兩個問題。 小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上 我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影， 好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。 33. 阿秀今天下午要做什麼？ 34. 阿秀請小文拿什麼去學校？ 請聽這一段話，然後回答下面的兩個問題。 昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我 的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假 去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後， 吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就 不用再吃藥。」 35. 為什麼說話的人昨天晚上沒睡好？ 36. 醫生說了什麼？ 請聽這一段水果的介紹，然後回答下面的兩個問題。 這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。 它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特 別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰 箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香， 放到第四天，不但不好看，也不好吃了。 37. 這種水果怎麼樣？ 38. 這種水果不放冰箱的話，會先有什麼變化？ 請聽這一段話，然後回答下面的兩個問題。 小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不 習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。 他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回 來以後，小周決定下次還要帶家人去美國玩兒。 39. 這段話主要是說什麼？ 40. 下面哪一個是對的？ 請聽這一段廣告，然後回答下面的兩個問題。 寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年 2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只 要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水 果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電 話給我們。 41. 這二十間房間怎麼樣？ 42. 下面哪一個是對的？ 請聽這一段廣播，然後回答兩個問題。 各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會 兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學 離開位子的時候，把重要的東西一起拿走，謝謝！ 43. 學生在圖書館發生什麼事？ 44. 這段廣播提到，學校怎麼處理這個狀況？ 下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題： 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 現在請聽報導。 2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光 景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量 的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這 個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的 歷史氣息？還是，讓人口水直流的地方美食？ 「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出 了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也 就跟著消失？ 這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相 互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三 個問題。 現在請聽報導。 【新聞快訊】 香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金， 根據阿國警方調查，她們可能涉及偷運古董。 阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險， 替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派 指稱，花瓶破損，於是扣留她們的護照加以禁錮。 香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖 的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救 援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極 有用的情報。 48. 這則報導說明了什麼？ 49. 根據報導，兩名少女為什麼要做這些事？ 50. 根據報導，香港警方怎麼處理這件案子？",
        "dialogue": "男：吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置，\n那裡的視野還不錯，可以清楚地看見吳老師演奏。\n女：你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞\n不是重點，你就把錢省下來吧！\n男：這位小姐對這次演奏會的座位有什麼看法？\n請聽這段對話，然後回答兩個問題。\n男：你最近怎麼老躲著小王？\n女：他一直想約我單獨跟他出去，可是…\n男：怎麼了？你好像不太願意？\n女：小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？\n20. 這位小姐對小王的感覺如何？\n21. 對小王的邀請，這位小姐覺得如何？\n請聽這段對話，然後回答下面的兩個問題。\n男：你們又來了，這次又有什麼事？\n女：趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請\n您共襄盛舉，捐點錢救濟災民。\n男：不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道\n就這樣送給你們？\n女：喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放\n心啊！\n男：口說無憑，你不如先寄份帳冊來給我看吧！\n22. 關於這位先生，哪一個是對的？\n23. 這位先生最後的態度怎麼樣？\n下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。\n男：小姐，我覺得這發票上的金額好像不太對。\n女：好的，馬上為您處理。這些一共是500元，金額沒錯。\n男：是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不\n管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡，\n為什麼沒打折？\n女：我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主\n要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能\n享有九折優惠。不好意思，我們店裡並沒有配合這個活動。\n24. 店員和客人發生了什麼事？\n25. 有關宣傳單上的活動說明，下面哪一項是對的？\n請聽這一段和「味精」有關的討論，然後回答兩個問題。\n男：佳美，你看這則味精的報導。\n女：嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過\n另外一篇報告，結果完全相反。\n男：是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就\n不碰吧！\n女：每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也\n還沒證實，所以，你別太擔心了。\n26. 這位先生覺得味精怎麼樣？\n27. 這位小姐的意思是什麼？\n下面是一段兄妹之間的對話，請聽完後，回答下面三個問題：\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n現在請聽對話。\n男：昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還\n來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪\n氣的。\n女：哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘，\n該不會是…\n男：長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘\n的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想\n到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一\n會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n第二部分 段落\n請聽這一段話，然後回答下面的問題。\n小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋\n糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和\n小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小\n青聽了，很高興，也很感謝。\n31. 從這段話可以知道什麼？\n請聽這一段話，然後回答下面的問題。\n如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常\n聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生，\n不過聽音樂絕不會對你造成傷害。\n32. 這段話的意思是什麼？\n請聽這一段電話留言，然後回答下面的兩個問題。\n小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上\n我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影，\n好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。\n33. 阿秀今天下午要做什麼？\n34. 阿秀請小文拿什麼去學校？\n請聽這一段話，然後回答下面的兩個問題。\n昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我\n的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假\n去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後，\n吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就\n不用再吃藥。」\n35. 為什麼說話的人昨天晚上沒睡好？\n36. 醫生說了什麼？\n請聽這一段水果的介紹，然後回答下面的兩個問題。\n這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。\n它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特\n別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰\n箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香，\n放到第四天，不但不好看，也不好吃了。\n37. 這種水果怎麼樣？\n38. 這種水果不放冰箱的話，會先有什麼變化？\n請聽這一段話，然後回答下面的兩個問題。\n小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不\n習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。\n他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回\n來以後，小周決定下次還要帶家人去美國玩兒。\n39. 這段話主要是說什麼？\n40. 下面哪一個是對的？\n請聽這一段廣告，然後回答下面的兩個問題。\n寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年\n2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只\n要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水\n果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電\n話給我們。\n41. 這二十間房間怎麼樣？\n42. 下面哪一個是對的？\n請聽這一段廣播，然後回答兩個問題。\n各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會\n兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學\n離開位子的時候，把重要的東西一起拿走，謝謝！\n43. 學生在圖書館發生什麼事？\n44. 這段廣播提到，學校怎麼處理這個狀況？\n下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題：\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n現在請聽報導。\n2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光\n景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量\n的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這\n個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的\n歷史氣息？還是，讓人口水直流的地方美食？\n「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出\n了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也\n就跟著消失？\n這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相\n互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三\n個問題。\n現在請聽報導。\n【新聞快訊】\n香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金，\n根據阿國警方調查，她們可能涉及偷運古董。\n阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險，\n替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派\n指稱，花瓶破損，於是扣留她們的護照加以禁錮。\n香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖\n的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救\n援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極\n有用的情報。\n48. 這則報導說明了什麼？\n49. 根據報導，兩名少女為什麼要做這些事？",
        "q": "50. 根據報導，香港警方怎麼處理這件案子？",
        "options": [
          "二樓的視野比一樓好多了",
          "她認為這位先生的建議不錯",
          "一樓的票太貴了，她付不起",
          "沒必要考慮能不能看見表演者"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 沒必要考慮能不能看見表演者. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 20",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 20",
        "options": [
          "只想維持普通朋友的關係",
          "想進一步了解小王的為人",
          "覺得小王是不錯的交往對象",
          "和小王聊天一點意思也沒有"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 只想維持普通朋友的關係. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 21",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 21",
        "options": [
          "非常厭惡",
          "充滿期待",
          "不怎麼在乎",
          "不知怎麼處理"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不知怎麼處理. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 22",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 22",
        "options": [
          "他從來就沒捐過錢",
          "他不知道捐款的去向",
          "他自己也是水災災民",
          "他覺得自己捐的錢不夠多"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 他不知道捐款的去向. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 23",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 23",
        "options": [
          "他請對方把錢還給他",
          "他決定幫對方一起募款",
          "他請對方提出證明再說",
          "他覺得對方有誠意，答應捐錢"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 他請對方提出證明再說. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 24",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 24",
        "options": [
          "店員打錯發票",
          "店員算錯金額",
          "客人拿錯商品",
          "客人跑錯商店"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 客人跑錯商店. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 25",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 25",
        "options": [
          "若要享受折扣，得到指定的店家",
          "折扣活動從今年初到這個月月底",
          "這個活動是附近商店聯合舉辦的",
          "在這個月內消費就可以加入會員"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 若要享受折扣，得到指定的店家. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 1: Chọn từ thích hợp điền vào vị trí [1] trong bài.",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng bị động '被'送進了醫院 (được đưa vào bệnh viện).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 2: Chọn từ thích hợp điền vào vị trí [2] trong bài.",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'陪'張太太到醫院去 (đi cùng / hộ tống vợ đến viện).",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 3: Chọn từ thích hợp điền vào vị trí [3] trong bài.",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'當'爸爸 (làm cha / làm bố).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 4: Chọn từ thích hợp điền vào vị trí [4] trong bài.",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'為'這個孩子想了一個名字 (nghĩ tên 'cho' đứa trẻ).",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 5: Chọn từ thích hợp điền vào vị trí [5] trong bài.",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'希望' (hy vọng con gái sau này vừa xinh đẹp vừa vui vẻ).",
        "pinyin": ""
      },
      {
        "id": 31,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 6: Chọn từ thích hợp điền vào vị trí [6] trong bài.",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'大學時代' (thời kỳ đại học).",
        "pinyin": ""
      },
      {
        "id": 32,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 7: Chọn từ thích hợp điền vào vị trí [7] trong bài.",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp mặt.",
        "pinyin": ""
      },
      {
        "id": 33,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 8: Chọn từ thích hợp điền vào vị trí [8] trong bài.",
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
        "q": "Câu 9: Chọn từ thích hợp điền vào vị trí [9] trong bài.",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'照'著信上的地址 (dựa theo / lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 35,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 10: Chọn từ thích hợp điền vào vị trí [10] trong bài.",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp được nữa).",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 11: Chọn từ thích hợp điền vào vị trí [11] trong bài.",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'安排'戶外活動 (sắp xếp thời gian hoạt động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 12: Chọn từ thích hợp điền vào vị trí [12] trong bài.",
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
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 13: Chọn từ thích hợp điền vào vị trí [13] trong bài.",
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
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 14: Chọn từ thích hợp điền vào vị trí [14] trong bài.",
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
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 15: Chọn từ thích hợp điền vào vị trí [15] trong bài.",
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
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "q": "Câu 16: 下面哪一個是對的？",
        "options": [
          "小明已經去過韓國兩次了",
          "小明想學習怎麼做韓國菜",
          "小明覺得韓國不怎麼好玩",
          "小明在韓國住了四個晚上"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết: '他在那兒玩了五天四夜' nghĩa là ở Hàn Quốc 4 đêm (住了四個晚上).",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 母親面對孩子的不安\n孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，態度怎麼樣？",
        "options": [
          "既害怕又不忍心",
          "不知道該怎麼辦",
          "覺得孩子很可憐",
          "鼓勵孩子自己解決"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ mỉm cười và kiên định nói: '你要學著去面對你自己的人生', khích lệ con tự đối diện và giải quyết.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 台灣夜市文化與電子支付\n以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "audio": "",
        "dialogue": "以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "q": "Câu 18: 根據這段文字，夜市引入行動支付帶來什麼好處？",
        "options": [
          "攤位租金變得更便宜",
          "結帳更快速且減少排隊",
          "觀光客可以買到打折商品",
          "大家不用再帶手機出門"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Bài viết nêu rõ: '減少了排隊找零的時間... 效率都因此大幅提升' (thanh toán nhanh hơn và giảm xếp hàng).",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 台北捷運環保便民措施\n台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "audio": "",
        "dialogue": "台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪一項特色？",
        "options": [
          "列車行駛速度世界第一",
          "車廂內提供免費餐點",
          "充滿人情味的便民服務",
          "票價比其他交通工具便宜"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả nhấn mạnh: '展現了台灣社會溫暖的人情味' (dịch vụ tiện dân ấm áp tình người).",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 垃圾分類與隨袋徵收政策\n台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "audio": "",
        "dialogue": "台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "q": "Câu 20: 『垃圾費隨袋徵收』政策如何有效減少垃圾量？",
        "options": [
          "規定每週只能倒一次垃圾",
          "透過購買專用垃圾袋促使民眾做好回收",
          "禁止市民購買任何塑膠包裝",
          "對亂丟垃圾的人處以重罰"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Người dân phải mua túi rác chuyên dụng cho rác thông thường, còn rác tái chế miễn phí, từ đó thúc đẩy phân loại triệt để.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 高鐵對台灣一日生活圈的影響\n自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "audio": "",
        "dialogue": "自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "q": "Câu 21: 『一日生活圈』對人們生活產生什麼主要影響？",
        "options": [
          "所有人都要搬去南部居住",
          "高鐵車票價格大幅下降",
          "南北往返當天即可完成工作",
          "飛機成為主要交通工具"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đoạn văn minh họa sáng họp ở Đài Bắc, chiều kiểm tra nhà máy Đài Nam, tối về lại Đài Bắc (đi lại hoàn thành trong ngày).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 台灣全民健康保險制度\n台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "audio": "",
        "dialogue": "台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "q": "Câu 22: 健保雲端系統的主要功能是什麼？",
        "options": [
          "自動幫病患繳交健保費",
          "即時查詢用藥紀錄避免重複開藥",
          "線上直接替病患開刀手術",
          "向國外藥廠訂購廉價藥品"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Văn bản nêu: '即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 誠品書店的二十四小時閱讀風潮\n誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "q": "Câu 23: 這家二十四小時書店之所以成為文化地標，是因為什麼？",
        "options": [
          "深夜買書享有半價優惠",
          "將閱讀轉化為結合文創的生活風格",
          "只允許專業作家進去閱讀",
          "是台北唯一的書店"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn kết luận: '將閱讀轉化為一種優雅的生活風格' (biến đọc sách thành phong cách sống kết hợp sáng tạo).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 外送平台在台灣的蓬勃發展\n智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "audio": "",
        "dialogue": "智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "q": "Câu 24: 作者對外送平台的快速發展抱持什麼觀點？",
        "options": [
          "認為應該全面禁止外送服務",
          "覺得外送食品比店內便宜",
          "肯定其便利但也提醒注意帶來的問題",
          "認為外送員賺錢太容易"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả viết: '雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思'.",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 傳統市場與現代超市的共存\n儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "q": "Câu 25: 傳統市場至今依然受歡迎的核心優勢是什麼？",
        "options": [
          "冷氣設備比超市更高級",
          "街坊人情味與依需求客製化的服務",
          "蔬菜肉類都是進口的高級品",
          "所有攤商都二十四小時營業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả chỉ ra: '濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的'.",
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
    "totalQ": 30,
    "desc": "Dành cho người mới củng cố kiến thức sơ trung cấp: câu hỏi giao tiếp đời sống, mua sắm và hỏi đường.",
    "questions": [
      {
        "id": 1,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我想坐早上九點的火車到高雄去，中午到得了嗎？ 女：應該是到不了，到高雄大概要五個小時。 男：早上九點的火車什麼時候到高雄？",
        "dialogue": "男：我想坐早上九點的火車到高雄去，中午到得了嗎？\n女：應該是到不了，到高雄大概要五個小時。",
        "q": "男：早上九點的火車什麼時候到高雄？",
        "options": [
          "上午",
          "中午",
          "下午",
          "晚上"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 下午. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小李最近好像在找房子，怎麼了？他不住了嗎？ 女：嗯，小李的房東要把房子賣了，他下個月就得搬家。 男：為什麼小李要搬家？",
        "dialogue": "男：小李最近好像在找房子，怎麼了？他不住了嗎？\n女：嗯，小李的房東要把房子賣了，他下個月就得搬家。",
        "q": "男：為什麼小李要搬家？",
        "options": [
          "他買了新房子",
          "他把房子賣了",
          "他找到更好的房子",
          "他的房東要賣房子"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他的房東要賣房子. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳去停車，為什麼去了這麼久？ 女：這附近都找不到能停車的地方，所以我找了比較遠的地方停車。 男：這位小姐的意思是什麼？",
        "dialogue": "男：妳去停車，為什麼去了這麼久？\n女：這附近都找不到能停車的地方，所以我找了比較遠的地方停車。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她很快就找到停車的位子",
          "她花了不少時間找地方停車",
          "她把車子停在比較近的地方",
          "她停車以後，找不到那位先生"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她花了不少時間找地方停車. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳怎麼在家？不和朋友到外面走走嗎？ 女：昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！ 男：這位小姐為什麼在家？",
        "dialogue": "男：妳怎麼在家？不和朋友到外面走走嗎？\n女：昨天玩得太累了，今天又是寒假的最後一天，當然要好好地在家休息啊！",
        "q": "男：這位小姐為什麼在家？",
        "options": [
          "她覺得有點累",
          "她身體不舒服",
          "她剛剛才從外面回來",
          "她還沒想好去哪兒玩"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她覺得有點累. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳這麼喜歡出國旅遊，那妳多久旅遊一次？ 女：差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。 男：這位小姐說了什麼？",
        "dialogue": "男：妳這麼喜歡出國旅遊，那妳多久旅遊一次？\n女：差不多一年一次，每次去不同國家玩，去年去了韓國，今年打算去日本。",
        "q": "男：這位小姐說了什麼？",
        "options": [
          "她一年出國旅遊兩次",
          "她今年不打算出國玩",
          "她每次去不一樣的國家玩",
          "她今年去韓國，明年想去日本"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她每次去不一樣的國家玩. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：老師要我們寫的作業，妳寫得怎麼樣？ 女：我想了好幾天，還是寫不出來。 男：這位小姐的意思是什麼？",
        "dialogue": "男：老師要我們寫的作業，妳寫得怎麼樣？\n女：我想了好幾天，還是寫不出來。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她不想寫作業",
          "她想不出來要寫什麼",
          "她不知道有什麼作業",
          "她記不得老師給的作業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她想不出來要寫什麼. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：一年以後，我們就買輛車子，到處去玩怎麼樣？ 女：別開玩笑了，哪來的錢呢？ 男：這位小姐的意思是什麼？",
        "dialogue": "男：一年以後，我們就買輛車子，到處去玩怎麼樣？\n女：別開玩笑了，哪來的錢呢？",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "他們沒錢買車子",
          "她不喜歡出去玩",
          "這位先生常常開玩笑",
          "她不知道哪裡借得到錢"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他們沒錢買車子. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：嗯！這些菜聞起來好香，味道更是沒話說。 女：謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。 男：這位小姐說了什麼？",
        "dialogue": "男：嗯！這些菜聞起來好香，味道更是沒話說。\n女：謝謝！我對做菜一直很有興趣，我也喜歡吃自己煮的東西。",
        "q": "男：這位小姐說了什麼？",
        "options": [
          "她做菜做得不好",
          "她很喜歡自己做菜",
          "她喜歡吃別人煮的菜",
          "她只會吃東西，不會做菜"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她很喜歡自己做菜. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：明天就要考試了！妳一點也不緊張嗎？ 女：有什麼好緊張的！我早就準備好了。 男：這位小姐的意思是什麼？",
        "dialogue": "男：明天就要考試了！妳一點也不緊張嗎？\n女：有什麼好緊張的！我早就準備好了。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她來不及把書讀完",
          "她對通過考試有信心",
          "她要這位先生別緊張",
          "她一聽見考試就開始緊張"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 她對通過考試有信心. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？ 女：昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？ 男：這位小姐的意思是什麼？",
        "dialogue": "男：我早上出門的時候，天氣還好好的，現在怎麼下起大雨來了？\n女：昨天新聞說今天會下小雨，可是誰知道雨越下越大呢？",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她知道今天會下大雨",
          "沒有人知道今天會下雨",
          "她本來以為只是下小雨",
          "這位先生沒告訴她會下雨"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她本來以為只是下小雨. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：今天是我第一次上中文課，老師教了語法和二十五個漢字。 女：才上一次課，就學了二十多個漢字，不錯嘛！ 男：學漢字很有趣，不過，語法好難懂。 女：不要緊，有問題的話，就多問老師。 男：這位先生說了什麼？",
        "dialogue": "男：今天是我第一次上中文課，老師教了語法和二十五個漢字。\n女：才上一次課，就學了二十多個漢字，不錯嘛！\n男：學漢字很有趣，不過，語法好難懂。\n女：不要緊，有問題的話，就多問老師。",
        "q": "男：這位先生說了什麼？",
        "options": [
          "老師還沒教語法",
          "老師教了十個漢字",
          "他覺得語法很簡單",
          "他認為學漢字很有意思"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 他認為學漢字很有意思. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳上個星期借的小說什麼時候可以還給我？ 女：不好意思！可不可以過兩天再還？ 男：妳看完了嗎？ 女：我看得差不多了。 男：這位小姐的意思是什麼？",
        "dialogue": "男：妳上個星期借的小說什麼時候可以還給我？\n女：不好意思！可不可以過兩天再還？\n男：妳看完了嗎？\n女：我看得差不多了。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她快看完了",
          "她還沒開始看",
          "她要再看一個星期",
          "她已經全部看完了"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 她快看完了. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：多吃一點兒吧！ 女：不，謝了！我吃得很飽。 男：妳吃不下了嗎？這個蛋糕是我特別為妳買的。 女：好吧！吃一點兒蛋糕也沒關係。 男：這位小姐的意思是什麼？",
        "dialogue": "男：多吃一點兒吧！\n女：不，謝了！我吃得很飽。\n男：妳吃不下了嗎？這個蛋糕是我特別為妳買的。\n女：好吧！吃一點兒蛋糕也沒關係。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她還有點兒餓",
          "蛋糕有點兒難吃",
          "她可以再吃一點兒東西",
          "她沒辦法吃任何東西了"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 她可以再吃一點兒東西. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：生日快樂！這是送給妳的。 女：謝謝。你不必買禮物給我的。你太客氣了！ 男：希望妳會喜歡，打開來看看吧。 女：啊，我喜歡這支手錶。你怎麼知道我要的就是這個？ 男：這位小姐的意思是什麼？",
        "dialogue": "男：生日快樂！這是送給妳的。\n女：謝謝。你不必買禮物給我的。你太客氣了！\n男：希望妳會喜歡，打開來看看吧。\n女：啊，我喜歡這支手錶。你怎麼知道我要的就是這個？",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "她不需要手錶",
          "她想要別的禮物",
          "這位先生買錯手錶",
          "這位先生買對了禮物"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 這位先生買對了禮物. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Căn bản A1/A2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小明這次考試考得太差了。 女：是不是考試太難了？ 男：不是吧！很多學生都考得不錯，有好幾個都考一百分呢！ 女：我看啊！應該是小明念書念不了幾頁，就想出去玩。 男：這兩個人說，小明成績差的原因是什麼？",
        "dialogue": "男：小明這次考試考得太差了。\n女：是不是考試太難了？\n男：不是吧！很多學生都考得不錯，有好幾個都考一百分呢！\n女：我看啊！應該是小明念書念不了幾頁，就想出去玩。",
        "q": "男：這兩個人說，小明成績差的原因是什麼？",
        "options": [
          "他不用功",
          "他不聰明",
          "考試太難",
          "他不小心寫錯"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 他不用功. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 1: Chọn từ thích hợp điền vào vị trí [1] trong bài.",
        "options": [
          "把",
          "能",
          "被",
          "會"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Dùng bị động '被'送進了醫院 (được đưa vào bệnh viện).",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 2: Chọn từ thích hợp điền vào vị trí [2] trong bài.",
        "options": [
          "幫",
          "害",
          "陪",
          "請"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'陪'張太太到醫院去 (đi cùng / hộ tống vợ đến viện).",
        "pinyin": ""
      },
      {
        "id": 18,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 3: Chọn từ thích hợp điền vào vị trí [3] trong bài.",
        "options": [
          "當",
          "成",
          "裝",
          "弄"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'當'爸爸 (làm cha / làm bố).",
        "pinyin": ""
      },
      {
        "id": 19,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 4: Chọn từ thích hợp điền vào vị trí [4] trong bài.",
        "options": [
          "教",
          "為",
          "讓",
          "養"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'為'這個孩子想了一個名字 (nghĩ tên 'cho' đứa trẻ).",
        "pinyin": ""
      },
      {
        "id": 20,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 昨晚張太太去醫院 (Sắp sinh em bé)\n昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "audio": "",
        "dialogue": "昨晚張太太的肚子很痛，感覺小孩快要生出來了，所以她 [1] 送進了醫院。張先生也 [2] 張太太到醫院去，他又高興又緊張，因為他就要 [3] 爸爸了。五個小時以後，小孩生出來了，是一個可愛的小女生。張先生和張太太 [4] 這個孩子想了一個名字，叫「張美樂」， [5] 她將來「美麗」又「快樂」。",
        "q": "Câu 5: Chọn từ thích hợp điền vào vị trí [5] trong bài.",
        "options": [
          "覺得",
          "要求",
          "決定",
          "希望"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'希望' (hy vọng con gái sau này vừa xinh đẹp vừa vui vẻ).",
        "pinyin": ""
      },
      {
        "id": 21,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 6: Chọn từ thích hợp điền vào vị trí [6] trong bài.",
        "options": [
          "時代",
          "時間",
          "年級",
          "年紀"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'大學時代' (thời kỳ đại học).",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 7: Chọn từ thích hợp điền vào vị trí [7] trong bài.",
        "options": [
          "多久",
          "好幾",
          "很長",
          "很久"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đã '好幾'年 (nhiều năm) không gặp mặt.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 8: Chọn từ thích hợp điền vào vị trí [8] trong bài.",
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
        "id": 24,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 9: Chọn từ thích hợp điền vào vị trí [9] trong bài.",
        "options": [
          "跟",
          "接",
          "寫",
          "照"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "'照'著信上的地址 (dựa theo / lần theo địa chỉ trên thư).",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 小陳尋找老朋友 (Tình bạn thời đại học)\n小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "audio": "",
        "dialogue": "小陳和小李是大學 [6] 的好朋友，大學畢業以後，他們已經 [7] 年沒見面了。有一次小陳 [8] 想起和小李一起讀書的事，他很想知道小李現在過得怎麼樣，所以他找出小李以前寄給他的信， [9] 著信上的地址去找小李。可是小李的鄰居說小李一家人早就搬家了，小陳很難過，因為他 [10] 以後都見不到小李了。",
        "q": "Câu 10: Chọn từ thích hợp điền vào vị trí [10] trong bài.",
        "options": [
          "能夠",
          "只有",
          "可能",
          "要是"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "'可能'以後都見不到 (có thể sau này không gặp được nữa).",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 11: Chọn từ thích hợp điền vào vị trí [11] trong bài.",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "'安排'戶外活動 (sắp xếp thời gian hoạt động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 12: Chọn từ thích hợp điền vào vị trí [12] trong bài.",
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
        "id": 28,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 13: Chọn từ thích hợp điền vào vị trí [13] trong bài.",
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
        "id": 29,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 14: Chọn từ thích hợp điền vào vị trí [14] trong bài.",
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
        "id": 30,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Căn bản A1/A2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 15: Chọn từ thích hợp điền vào vị trí [15] trong bài.",
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
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：現在景氣不好，別人會不會覺得我們產品的定價高得離譜？ 女：這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。 男：你這麼有把握啊！ 女：你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。 男：這位小姐的意思是什麼？",
        "dialogue": "男：現在景氣不好，別人會不會覺得我們產品的定價高得離譜？\n女：這跟景氣無關，只要我們鎖定特定的族群，一樣很有市場。\n男：你這麼有把握啊！\n女：你沒看市面上動輒七八十萬的皮椅，買的人也不在少數。",
        "q": "男：這位小姐的意思是什麼？",
        "options": [
          "現在的皮椅都是七八十萬",
          "打折以後，買皮椅的人不少",
          "再貴一點的皮椅就沒有人買了",
          "不少人買得起七八十萬的皮椅"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不少人買得起七八十萬的皮椅. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 2,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。 女：你怎麼不勸勸他呢？ 男：我當然說啦！退一步海闊天空嘛！不過他聽不進去。 女：都到這個節骨眼了他還堅持己見，真是不可理喻。 男：這位太太說老劉怎麼樣？",
        "dialogue": "男：唉！客戶堅持要賠償，老劉堅持自己沒有錯，待會的協調會，場面可尷尬了。\n女：你怎麼不勸勸他呢？\n男：我當然說啦！退一步海闊天空嘛！不過他聽不進去。\n女：都到這個節骨眼了他還堅持己見，真是不可理喻。",
        "q": "男：這位太太說老劉怎麼樣？",
        "options": [
          "沒法跟老劉講道理",
          "是個沒有原則的人",
          "堅持立場、值得尊敬",
          "再多勸一下，他就會讓步"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 沒法跟老劉講道理. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 3,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：怎麼啦？垂頭喪氣的？ 女：我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。 男：勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動 都進入決賽呢！ 女：就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！ 男：代表隊在這次比賽的表現怎麼樣？",
        "dialogue": "男：怎麼啦？垂頭喪氣的？\n女：我們為了參加運動會，連續三個月都留校苦練，就是想拼出好成績。\n男：勝敗乃兵家常事，能代表學校出賽就是一種榮耀，更何況你們幾乎每項運動\n都進入決賽呢！\n女：就是因為這樣，本來想至少可以拿下一面獎牌，誰知道會全軍覆沒呢！",
        "q": "男：代表隊在這次比賽的表現怎麼樣？",
        "options": [
          "連決賽都沒進",
          "只得到一個獎",
          "一個獎都沒得到",
          "只有一項沒得獎"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 一個獎都沒得到. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 4,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小趙這孩子，頭腦不錯，就是個性太急躁。 女：哈哈，年輕人嘛！做事難免比較衝動。 男：正好老王那兒有缺，我想叫他去試一試。 女：嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。 男：為什麼小趙幫老王做事是種磨練？",
        "dialogue": "男：小趙這孩子，頭腦不錯，就是個性太急躁。\n女：哈哈，年輕人嘛！做事難免比較衝動。\n男：正好老王那兒有缺，我想叫他去試一試。\n女：嗯，老王做事一板一眼的，小趙去替他做事，馬虎不得，正好可以磨練磨練。",
        "q": "男：為什麼小趙幫老王做事是種磨練？",
        "options": [
          "老王的眼睛不好",
          "老王做事很嚴謹",
          "老王個性很馬虎",
          "老王不喜歡小趙"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 老王做事很嚴謹. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 5,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：咦！最近你好像特別忙。 女：唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司， 偏偏那兒又需要好好整頓一番。 男：小趙怎麼樣，服務的時間久，學歷也不錯。 女：他人緣差不說，又經常敷衍了事，你想我能指望他嗎？ 男：這位女士的意思是什麼？",
        "dialogue": "男：咦！最近你好像特別忙。\n女：唉！我最得力的助手出國唸書去了，一時找不到人來幫我管理南部的公司，\n偏偏那兒又需要好好整頓一番。\n男：小趙怎麼樣，服務的時間久，學歷也不錯。\n女：他人緣差不說，又經常敷衍了事，你想我能指望他嗎？",
        "q": "男：這位女士的意思是什麼？",
        "options": [
          "小趙拒絕了她",
          "小趙不值得信賴",
          "小趙對工作很失望",
          "她怕小趙不會答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 小趙不值得信賴. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 6,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？ 女：保證萬無一失，絕對沒問題，你放心吧！ 男：這位小姐的話是什麼意思？",
        "dialogue": "男：妳這樣做並不符合申請的程序，難道不怕案子被退回嗎？\n女：保證萬無一失，絕對沒問題，你放心吧！",
        "q": "男：這位小姐的話是什麼意思？",
        "options": [
          "這麼做一定行得通",
          "她想買保險以免發生問題",
          "因為已保了險，所以沒問題",
          "這麼做風險很高，但值得冒險嘗試"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 這麼做一定行得通. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 7,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：小劉費盡心思取悅父母，結果卻失敗了。 女：誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂 啊！ 男：根據這位小姐的說法，小劉失敗的原因是什麼？",
        "dialogue": "男：小劉費盡心思取悅父母，結果卻失敗了。\n女：誰叫他只立業不成家呢？功成名就固然很好，但老人家更想要的是子孫滿堂\n啊！",
        "q": "男：根據這位小姐的說法，小劉失敗的原因是什麼？",
        "options": [
          "小劉的父母要求太多",
          "小劉還沒有顯著的成就",
          "小劉沒滿足父母最大的期待",
          "小劉的父母不要求兒子有成就"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 小劉沒滿足父母最大的期待. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 8,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：老闆說這個案子得在一個星期裡完成，這怎麼可能呢？ 女：還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！ 男：這位小姐有什麼意見？",
        "dialogue": "男：老闆說這個案子得在一個星期裡完成，這怎麼可能呢？\n女：還不簡單？應付應付就行啦！我才不會為了這個案子多費功夫呢！",
        "q": "男：這位小姐有什麼意見？",
        "options": [
          "做這個案子得花時間",
          "做這個案子並不容易",
          "做這個案子不必認真",
          "做這個案子要有能力"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 做這個案子不必認真. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 9,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "男：吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置， 那裡的視野還不錯，可以清楚地看見吳老師演奏。 女：你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞 不是重點，你就把錢省下來吧！ 男：這位小姐對這次演奏會的座位有什麼看法？ 請聽這段對話，然後回答兩個問題。 男：你最近怎麼老躲著小王？ 女：他一直想約我單獨跟他出去，可是… 男：怎麼了？你好像不太願意？ 女：小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？ 20. 這位小姐對小王的感覺如何？ 21. 對小王的邀請，這位小姐覺得如何？ 請聽這段對話，然後回答下面的兩個問題。 男：你們又來了，這次又有什麼事？ 女：趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請 您共襄盛舉，捐點錢救濟災民。 男：不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道 就這樣送給你們？ 女：喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放 心啊！ 男：口說無憑，你不如先寄份帳冊來給我看吧！ 22. 關於這位先生，哪一個是對的？ 23. 這位先生最後的態度怎麼樣？ 下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。 男：小姐，我覺得這發票上的金額好像不太對。 女：好的，馬上為您處理。這些一共是500元，金額沒錯。 男：是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不 管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡， 為什麼沒打折？ 女：我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主 要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能 享有九折優惠。不好意思，我們店裡並沒有配合這個活動。 24. 店員和客人發生了什麼事？ 25. 有關宣傳單上的活動說明，下面哪一項是對的？ 請聽這一段和「味精」有關的討論，然後回答兩個問題。 男：佳美，你看這則味精的報導。 女：嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過 另外一篇報告，結果完全相反。 男：是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就 不碰吧！ 女：每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也 還沒證實，所以，你別太擔心了。 26. 這位先生覺得味精怎麼樣？ 27. 這位小姐的意思是什麼？ 下面是一段兄妹之間的對話，請聽完後，回答下面三個問題： 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 現在請聽對話。 男：昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還 來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪 氣的。 女：哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘， 該不會是… 男：長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘 的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想 到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一 會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！ 28. 這位先生為什麼說他的太太「陰陽怪氣」？ 29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？ 30. 這段對話告訴我們什麼事？ 第二部分 段落 請聽這一段話，然後回答下面的問題。 小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋 糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和 小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小 青聽了，很高興，也很感謝。 31. 從這段話可以知道什麼？ 請聽這一段話，然後回答下面的問題。 如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常 聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生， 不過聽音樂絕不會對你造成傷害。 32. 這段話的意思是什麼？ 請聽這一段電話留言，然後回答下面的兩個問題。 小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上 我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影， 好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。 33. 阿秀今天下午要做什麼？ 34. 阿秀請小文拿什麼去學校？ 請聽這一段話，然後回答下面的兩個問題。 昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我 的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假 去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後， 吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就 不用再吃藥。」 35. 為什麼說話的人昨天晚上沒睡好？ 36. 醫生說了什麼？ 請聽這一段水果的介紹，然後回答下面的兩個問題。 這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。 它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特 別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰 箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香， 放到第四天，不但不好看，也不好吃了。 37. 這種水果怎麼樣？ 38. 這種水果不放冰箱的話，會先有什麼變化？ 請聽這一段話，然後回答下面的兩個問題。 小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不 習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。 他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回 來以後，小周決定下次還要帶家人去美國玩兒。 39. 這段話主要是說什麼？ 40. 下面哪一個是對的？ 請聽這一段廣告，然後回答下面的兩個問題。 寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年 2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只 要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水 果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電 話給我們。 41. 這二十間房間怎麼樣？ 42. 下面哪一個是對的？ 請聽這一段廣播，然後回答兩個問題。 各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會 兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學 離開位子的時候，把重要的東西一起拿走，謝謝！ 43. 學生在圖書館發生什麼事？ 44. 這段廣播提到，學校怎麼處理這個狀況？ 下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題： 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 現在請聽報導。 2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光 景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量 的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這 個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的 歷史氣息？還是，讓人口水直流的地方美食？ 「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出 了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也 就跟著消失？ 這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相 互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。 45. 根據報導，小鎮為什麼成為新的景點？ 46. 根據報導，這部電影對小鎮造成什麼影響？ 47. 記者對當地飯店的經營者，提出哪些建議？ 香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三 個問題。 現在請聽報導。 【新聞快訊】 香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金， 根據阿國警方調查，她們可能涉及偷運古董。 阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險， 替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派 指稱，花瓶破損，於是扣留她們的護照加以禁錮。 香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖 的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救 援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極 有用的情報。 48. 這則報導說明了什麼？ 49. 根據報導，兩名少女為什麼要做這些事？ 50. 根據報導，香港警方怎麼處理這件案子？",
        "dialogue": "男：吳老師鋼琴演奏會的票開始賣了，我覺得可以考慮一樓第十排中間的位置，\n那裡的視野還不錯，可以清楚地看見吳老師演奏。\n女：你在二樓的後面幾排位子裡隨便挑就行。只是單純地欣賞音樂，視野的好壞\n不是重點，你就把錢省下來吧！\n男：這位小姐對這次演奏會的座位有什麼看法？\n請聽這段對話，然後回答兩個問題。\n男：你最近怎麼老躲著小王？\n女：他一直想約我單獨跟他出去，可是…\n男：怎麼了？你好像不太願意？\n女：小王人不錯，可是，我不想讓小王誤會我對他有意思，唉！該怎麼和他說呢？\n20. 這位小姐對小王的感覺如何？\n21. 對小王的邀請，這位小姐覺得如何？\n請聽這段對話，然後回答下面的兩個問題。\n男：你們又來了，這次又有什麼事？\n女：趙先生，今年水災損失慘重，許多災民都無家可歸。我們發起募捐運動，請\n您共襄盛舉，捐點錢救濟災民。\n男：不是我沒良心，只是以前我每次捐了錢就沒下文。錢也是我辛苦賺的，難道\n就這樣送給你們？\n女：喔，我們每年募得的款項，都會製作成帳冊，仔細說明捐款用途，您大可放\n心啊！\n男：口說無憑，你不如先寄份帳冊來給我看吧！\n22. 關於這位先生，哪一個是對的？\n23. 這位先生最後的態度怎麼樣？\n下面是店員和客人在商店的對話，請聽完對話後，回答兩個問題。\n男：小姐，我覺得這發票上的金額好像不太對。\n女：好的，馬上為您處理。這些一共是500元，金額沒錯。\n男：是嗎？這張宣傳單上寫著這個月是打折月，從五月一號到五月三十一號，不\n管消費多少錢，只要結帳時拿出會員卡，就打九折。喏！這是我的會員卡，\n為什麼沒打折？\n女：我看看，喔！先生，這是我們另一家分店的宣傳單，上頭說了，這個活動主\n要是為了慶祝他們開店滿一年而舉辦的特別活動，所以只有在那裡消費才能\n享有九折優惠。不好意思，我們店裡並沒有配合這個活動。\n24. 店員和客人發生了什麼事？\n25. 有關宣傳單上的活動說明，下面哪一項是對的？\n請聽這一段和「味精」有關的討論，然後回答兩個問題。\n男：佳美，你看這則味精的報導。\n女：嗯！我看看，這報導並沒有具體指出為什麼味精會對人體造成傷害，我看過\n另外一篇報告，結果完全相反。\n男：是嗎？可是有些人吃了加味精的食物後，就會不舒服。我想，我們能不碰就\n不碰吧！\n女：每種食物都有人適應不良，何況味精究竟會對人體造成什麼影響，醫學上也\n還沒證實，所以，你別太擔心了。\n26. 這位先生覺得味精怎麼樣？\n27. 這位小姐的意思是什麼？\n下面是一段兄妹之間的對話，請聽完後，回答下面三個問題：\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n現在請聽對話。\n男：昨天晚上，你嫂子做了一桌子的菜，醋溜魚片、醋溜白菜、醋溜蝦，飯後還\n來了杯青梅醋，一整晚話沒兩句，和平常多話的她判若兩人，整個人陰陽怪\n氣的。\n女：哥，我昨天和嫂嫂出門買東西，在捷運站看見你和一位長髮女性共撐一把傘，\n該不會是…\n男：長髮女性？昨天一出捷運站就下了個傾盆大雨，我身上沒傘，就跟附近賣傘\n的小販買了一把。那個年輕人做起生意來可積極了，邊說他還邊示範。沒想\n到，那時風大，小伙子留的一頭長髮給傘骨纏住了。兩個大男人拉扯了好一\n會兒才把頭髮救出來。不是我要說，一個大男人，留什麼長髮啊！\n28. 這位先生為什麼說他的太太「陰陽怪氣」？\n29. 根據這位先生的說法，他昨天出捷運站以後做了什麼事？\n30. 這段對話告訴我們什麼事？\n第二部分 段落\n請聽這一段話，然後回答下面的問題。\n小青的房東很會做點心，常常請小青來家裡吃點心。小青最喜歡吃她做的蛋\n糕，又香又好吃。她們總是一邊吃蛋糕，一邊聊自己的家人。房東說她的女兒和\n小青的年紀一樣大，因為讀書的關係不在家，所以她把小青當成自己的女兒。小\n青聽了，很高興，也很感謝。\n31. 從這段話可以知道什麼？\n請聽這一段話，然後回答下面的問題。\n如果你感到背痛或腿部酸痛，聽聽音樂可能會有幫助。一項研究發現，經常\n聽音樂是有好處的，因為音樂有助於減輕疼痛，但這並不表示它可以取代醫生，\n不過聽音樂絕不會對你造成傷害。\n32. 這段話的意思是什麼？\n請聽這一段電話留言，然後回答下面的兩個問題。\n小文，我是阿秀。我知道我們本來約好今天下午要去看電影，可是今天早上\n我有一點不舒服，所以我想在家休息。下次等我們都有空的時候再一起去看電影，\n好嗎？對了，明天上課的時候，請你把我借你的雨傘拿來學校，謝謝！明天見。\n33. 阿秀今天下午要做什麼？\n34. 阿秀請小文拿什麼去學校？\n請聽這一段話，然後回答下面的兩個問題。\n昨天晚上我很晚才回家。看到桌子上還剩一些飯菜，就吃了。到了夜裡，我\n的肚子開始痛了起來，就一直跑廁所。結果一個晚上都沒睡好。今天早上我請假\n去看醫生，醫生說我得吃藥，他給了我兩種藥，然後跟我說：「每天吃完飯以後，\n吃一包白色的藥，如果肚子還是不舒服，就吃綠色藥包的藥。如果身體好了，就\n不用再吃藥。」\n35. 為什麼說話的人昨天晚上沒睡好？\n36. 醫生說了什麼？\n請聽這一段水果的介紹，然後回答下面的兩個問題。\n這種水果夏天的時候才有，它的皮是不能吃的，我們吃的是裡面白白的肉。\n它的味道又香又甜，大人小孩都喜歡。聽說以前北方的人想吃這種水果，還得特\n別請人騎馬從南方送來。因為這種水果不能放太久，買回來以後，要趕快放進冰\n箱裡。如果不這樣做的話，紅色的皮很快就變成咖啡色了，過兩天味道已經不香，\n放到第四天，不但不好看，也不好吃了。\n37. 這種水果怎麼樣？\n38. 這種水果不放冰箱的話，會先有什麼變化？\n請聽這一段話，然後回答下面的兩個問題。\n小周上個月和太太、小孩一家三個人去美國玩兒。他們到的第一天有點兒不\n習慣，因為天氣比較冷。不過他們住的飯店又大又舒服，小周和太太還是很高興。\n他們每天都去不同的地方玩兒，在那兒他們常吃美國菜，有時候也吃中國菜。回\n來以後，小周決定下次還要帶家人去美國玩兒。\n39. 這段話主要是說什麼？\n40. 下面哪一個是對的？\n請聽這一段廣告，然後回答下面的兩個問題。\n寒假、過年和家人朋友出來玩，歡迎選擇圓山大飯店！從今年12 月到明年\n2 月底，我們每天提供二十間房間，雙人房一個晚上只要2100 元，四人房也只\n要3500 元。雖然費用變便宜了，我們提供的服務還是一樣，除了送您報紙和水\n果，使用停車場、游泳池也不必付錢。每天只有二十間！有興趣的人請趕快打電\n話給我們。\n41. 這二十間房間怎麼樣？\n42. 下面哪一個是對的？\n請聽這一段廣播，然後回答兩個問題。\n各位同學請注意，最近很多同學反應，他們在圖書館讀書，才離開位子一會\n兒，原本放在位子上的書包就不見了，學校已經派人調查這件事，也請各位同學\n離開位子的時候，把重要的東西一起拿走，謝謝！\n43. 學生在圖書館發生什麼事？\n44. 這段廣播提到，學校怎麼處理這個狀況？\n下面是關於電影與城市觀光的報導。請聽完報導後，回答三個問題：\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n現在請聽報導。\n2008 年，台灣一部以小鎮風光為背景的電影，讓這個小鎮，成了新的觀光\n景點，大量遊客來這裡，不僅創造了小鎮的經濟價值，也為當地居民增加了大量\n的工作機會。好的劇本、好的演員當然是電影成功的要素，但讓人好奇的是，這\n個小鎮，怎麼透過電影吸引這麼多人來參觀？是電影中那濃濃的人情味？厚重的\n歷史氣息？還是，讓人口水直流的地方美食？\n「觀眾透過電影看見了小鎮的魅力，所以想去感受感受。」導演的話，點出\n了答案。但是電影對小鎮的影響能有多久，是不是隨著電影結束，這股觀光熱也\n就跟著消失？\n這部電影的推銷手法，也許值得飯店經營者參考，若能將飯店與當地人文相\n互結合，那麼被電影所帶動的觀光風氣，也許就有可能持續下去。\n45. 根據報導，小鎮為什麼成為新的景點？\n46. 根據報導，這部電影對小鎮造成什麼影響？\n47. 記者對當地飯店的經營者，提出哪些建議？\n香港兩名少女至阿根廷旅遊，傳出遭人綁架。請聽這則報導，並根據內容回答三\n個問題。\n現在請聽報導。\n【新聞快訊】\n香港兩名到阿根廷遊玩的少女，上週傳出在當地被人脅持禁錮及勒索贖金，\n根據阿國警方調查，她們可能涉及偷運古董。\n阿國警方表示，她們是為了獲得阿根廷免費旅遊及6萬元報酬，才鋌而走險，\n替人運送價值連城的古董花瓶和字畫到阿國。但她們抵達阿根廷後，接貨的幫派\n指稱，花瓶破損，於是扣留她們的護照加以禁錮。\n香港警方接獲報案後，動用超級電腦，進行照片及阿根廷首都3D 立體地圖\n的分析，成功鎖定少女被禁錮的位置，並將資料提供給阿國警方，由他們負責救\n援行動。阿國警方認為，這次能成功地救出少女，都要歸功於香港警方提供了極\n有用的情報。\n48. 這則報導說明了什麼？\n49. 根據報導，兩名少女為什麼要做這些事？",
        "q": "50. 根據報導，香港警方怎麼處理這件案子？",
        "options": [
          "二樓的視野比一樓好多了",
          "她認為這位先生的建議不錯",
          "一樓的票太貴了，她付不起",
          "沒必要考慮能不能看見表演者"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 沒必要考慮能不能看見表演者. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 10,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 20",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 20",
        "options": [
          "只想維持普通朋友的關係",
          "想進一步了解小王的為人",
          "覺得小王是不錯的交往對象",
          "和小王聊天一點意思也沒有"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 只想維持普通朋友的關係. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 11,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 21",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 21",
        "options": [
          "非常厭惡",
          "充滿期待",
          "不怎麼在乎",
          "不知怎麼處理"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 不知怎麼處理. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 12,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 22",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 22",
        "options": [
          "他從來就沒捐過錢",
          "他不知道捐款的去向",
          "他自己也是水災災民",
          "他覺得自己捐的錢不夠多"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đáp án chính xác là (B): 他不知道捐款的去向. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 13,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 23",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 23",
        "options": [
          "他請對方把錢還給他",
          "他決定幫對方一起募款",
          "他請對方提出證明再說",
          "他覺得對方有誠意，答應捐錢"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đáp án chính xác là (C): 他請對方提出證明再說. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 14,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 24",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 24",
        "options": [
          "店員打錯發票",
          "店員算錯金額",
          "客人拿錯商品",
          "客人跑錯商店"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đáp án chính xác là (D): 客人跑錯商店. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 15,
        "section": "listening",
        "part": "Hội thoại đời sống (對話) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn đối thoại ngữ cảnh tự nhiên giữa hai người.",
        "audio": "Đang tải đoạn hội thoại... 題目 25",
        "dialogue": "Đang tải đoạn hội thoại...",
        "q": "題目 25",
        "options": [
          "若要享受折扣，得到指定的店家",
          "折扣活動從今年初到這個月月底",
          "這個活動是附近商店聯合舉辦的",
          "在這個月內消費就可以加入會員"
        ],
        "ans": 0,
        "ansChar": "A",
        "explain": "Đáp án chính xác là (A): 若要享受折扣，得到指定的店家. Lời thoại thể hiện rõ qua ngữ cảnh bài nghe.",
        "pinyin": ""
      },
      {
        "id": 16,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 11: Chọn từ thích hợp điền vào vị trí [11] trong bài.",
        "options": [
          "安排",
          "預備",
          "決定",
          "答應"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "'安排'戶外活動 (sắp xếp thời gian hoạt động ngoài trời).",
        "pinyin": ""
      },
      {
        "id": 17,
        "section": "reading",
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 12: Chọn từ thích hợp điền vào vị trí [12] trong bài.",
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
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 13: Chọn từ thích hợp điền vào vị trí [13] trong bài.",
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
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 14: Chọn từ thích hợp điền vào vị trí [14] trong bài.",
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
        "part": "Điền từ vào chỗ trống (選詞填空) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoạn văn: 保護眼睛與戶外運動 (Bảo vệ thị lực)\n現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "audio": "",
        "dialogue": "現代人長時間使用手機和電腦，眼睛容易疲勞。專家建議，每天應該 [11] 至少兩小時到戶外活動。在陽光下活動不僅能放鬆眼部肌肉，還能 [12] 身體吸收維生素D。如果 [13] 在室內看螢幕，近視的度數容易快速加深。因此，養成規律的運動習慣，是 [14] 視力健康不可缺少的一部分，千萬 [15] 輕視。",
        "q": "Câu 15: Chọn từ thích hợp điền vào vị trí [15] trong bài.",
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
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 小明到韓國旅遊\n上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "audio": "",
        "dialogue": "上星期小明第一次到韓國旅遊。他在那兒玩了五天四夜，其中一天，他去了韓國最高的山，那時候，山上下起了雪，他覺得這樣的風景真美。大部分的時間，他坐電車到幾個大城市去參觀有名的地方，也吃了不少味道特別的韓國菜。小明覺得韓國很好玩，他打算學習韓國的語言，以後有機會的話，他想到韓國讀書。",
        "q": "Câu 16: 下面哪一個是對的？",
        "options": [
          "小明已經去過韓國兩次了",
          "小明想學習怎麼做韓國菜",
          "小明覺得韓國不怎麼好玩",
          "小明在韓國住了四個晚上"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Đoạn văn viết: '他在那兒玩了五天四夜' nghĩa là ở Hàn Quốc 4 đêm (住了四個晚上).",
        "pinyin": ""
      },
      {
        "id": 22,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 母親面對孩子的不安\n孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "audio": "",
        "dialogue": "孩子，這是你改搭校車回家的第一天。媽媽沒忘記你早上出門前，不停地告訴我搭校車是件很恐怖的事，那語氣裡充滿了面對不確定的不安，更讓媽媽覺得不忍心。然而我只是笑著看你，聽你把所有預期中可怕的後果全部說完，然後篤定地告訴你：「這是你人生的另一個開始，你要學著去面對你自己的人生！」",
        "q": "Câu 17: 在這段短文裡，母親面對孩子的不安時，態度怎麼樣？",
        "options": [
          "既害怕又不忍心",
          "不知道該怎麼辦",
          "覺得孩子很可憐",
          "鼓勵孩子自己解決"
        ],
        "ans": 3,
        "ansChar": "D",
        "explain": "Người mẹ mỉm cười và kiên định nói: '你要學著去面對你自己的人生', khích lệ con tự đối diện và giải quyết.",
        "pinyin": ""
      },
      {
        "id": 23,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 台灣夜市文化與電子支付\n以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "audio": "",
        "dialogue": "以往去台灣夜市消費，大家習慣準備大量零錢紙鈔。近年來，隨著行動支付普及，越來越多攤商擺出悠遊卡感應機與QR Code立牌。消費者只要拿出手機輕輕一掃，幾秒鐘就能完成結帳。這項改變不僅減少了排隊找零的時間，也讓外國觀光客不必擔心看不懂台幣面額，夜市的衛生與效率都因此大幅提升。",
        "q": "Câu 18: 根據這段文字，夜市引入行動支付帶來什麼好處？",
        "options": [
          "攤位租金變得更便宜",
          "結帳更快速且減少排隊",
          "觀光客可以買到打折商品",
          "大家不用再帶手機出門"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Bài viết nêu rõ: '減少了排隊找零的時間... 效率都因此大幅提升' (thanh toán nhanh hơn và giảm xếp hàng).",
        "pinyin": ""
      },
      {
        "id": 24,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 台北捷運環保便民措施\n台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "audio": "",
        "dialogue": "台北捷運系統被譽為全球最乾淨的大眾運輸之一。除了站內禁止飲食的嚴格規定外，捷運公司更在各大站點設立『二手書漂書箱』與『愛心傘借還服務』。乘客只要持票卡登記，就能在下雨天免費借用愛心傘，隔天再歸還至任一車站。這種以信任為基礎的公共服務，展現了台灣社會溫暖的人情味。",
        "q": "Câu 19: 這段短文主要在讚揚台北捷運的哪一項特色？",
        "options": [
          "列車行駛速度世界第一",
          "車廂內提供免費餐點",
          "充滿人情味的便民服務",
          "票價比其他交通工具便宜"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả nhấn mạnh: '展現了台灣社會溫暖的人情味' (dịch vụ tiện dân ấm áp tình người).",
        "pinyin": ""
      },
      {
        "id": 25,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 垃圾分類與隨袋徵收政策\n台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "audio": "",
        "dialogue": "台北市自實施『垃圾費隨袋徵收』以來，一般垃圾量顯著減少。市民必須付費購買專用的藍色垃圾袋，而資源回收物如寶特瓶、紙箱、廚餘等則一律免費清運。這項政策促使家家戶戶認真做好垃圾分類，大幅降低了焚化爐的負擔，成為許多國際城市前來考察學習的典範。",
        "q": "Câu 20: 『垃圾費隨袋徵收』政策如何有效減少垃圾量？",
        "options": [
          "規定每週只能倒一次垃圾",
          "透過購買專用垃圾袋促使民眾做好回收",
          "禁止市民購買任何塑膠包裝",
          "對亂丟垃圾的人處以重罰"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Người dân phải mua túi rác chuyên dụng cho rác thông thường, còn rác tái chế miễn phí, từ đó thúc đẩy phân loại triệt để.",
        "pinyin": ""
      },
      {
        "id": 26,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 高鐵對台灣一日生活圈的影響\n自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "audio": "",
        "dialogue": "自從台灣高速鐵路通車後，從台北到高雄最快只需九十分鐘，大幅縮短了南北之間的時空距離。許多商務人士早上在台北開會，下午即可抵達台南工廠視察，傍晚再搭車返回北部家中晚餐。『一日生活圈』的形成，促進了各縣市之間的經濟交流與觀光發展。",
        "q": "Câu 21: 『一日生活圈』對人們生活產生什麼主要影響？",
        "options": [
          "所有人都要搬去南部居住",
          "高鐵車票價格大幅下降",
          "南北往返當天即可完成工作",
          "飛機成為主要交通工具"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Đoạn văn minh họa sáng họp ở Đài Bắc, chiều kiểm tra nhà máy Đài Nam, tối về lại Đài Bắc (đi lại hoàn thành trong ngày).",
        "pinyin": ""
      },
      {
        "id": 27,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 台灣全民健康保險制度\n台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "audio": "",
        "dialogue": "台灣的全民健康保險制度以高品質、低自費和高覆蓋率聞名。持有一張健保卡，民眾即可在全台各大醫院與基層診所自由就醫。不管是西醫、牙醫還是中醫，都能享有健保給付。醫師透過健保雲端系統即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險。",
        "q": "Câu 22: 健保雲端系統的主要功能是什麼？",
        "options": [
          "自動幫病患繳交健保費",
          "即時查詢用藥紀錄避免重複開藥",
          "線上直接替病患開刀手術",
          "向國外藥廠訂購廉價藥品"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Văn bản nêu: '即時查詢病患的用藥紀錄，避免了重複開藥與藥物交互作用的風險'.",
        "pinyin": ""
      },
      {
        "id": 28,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 誠品書店的二十四小時閱讀風潮\n誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "audio": "",
        "dialogue": "誠品書店首創的二十四小時不打烊營運模式，曾是台北夜生活最具代表性的文化地標。無論深夜兩點還是清晨五點，書店內總有愛書人席地而坐、靜靜翻閱。這裡不僅賣書，更結合了文創商品、展覽與講座，將閱讀轉化為一種優雅的生活風格。",
        "q": "Câu 23: 這家二十四小時書店之所以成為文化地標，是因為什麼？",
        "options": [
          "深夜買書享有半價優惠",
          "將閱讀轉化為結合文創的生活風格",
          "只允許專業作家進去閱讀",
          "是台北唯一的書店"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Đoạn văn kết luận: '將閱讀轉化為一種優雅的生活風格' (biến đọc sách thành phong cách sống kết hợp sáng tạo).",
        "pinyin": ""
      },
      {
        "id": 29,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 外送平台在台灣的蓬勃發展\n智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "audio": "",
        "dialogue": "智慧型手機的普及改變了台灣人的用餐型態。每到用餐尖峰時段，街頭巷尾隨處可見外送員騎著機車奔馳穿梭。從高檔餐廳料理到巷弄鹽酥雞，只要動動手指就能送達家門口。雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思。",
        "q": "Câu 24: 作者對外送平台的快速發展抱持什麼觀點？",
        "options": [
          "認為應該全面禁止外送服務",
          "覺得外送食品比店內便宜",
          "肯定其便利但也提醒注意帶來的問題",
          "認為外送員賺錢太容易"
        ],
        "ans": 2,
        "ansChar": "C",
        "explain": "Tác giả viết: '雖然外送帶來極大便利，但也伴隨交通安全、外送垃圾增加等社會議題值得大眾省思'.",
        "pinyin": ""
      },
      {
        "id": 30,
        "section": "reading",
        "part": "Đọc hiểu tài liệu & đoản văn (閱讀理解) (Lưu loát & Tinh thông C1/C2)",
        "context": "Đoản văn: 傳統市場與現代超市的共存\n儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "audio": "",
        "dialogue": "儘管連鎖超級市場乾淨整潔、營業時間彈性，台灣傳統傳統市場依舊深受許多長輩喜愛。在傳統市場裡，攤販不僅會熱情招呼、多送兩根蔥，還能依照顧客需求切肉配菜。這種濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的。",
        "q": "Câu 25: 傳統市場至今依然受歡迎的核心優勢是什麼？",
        "options": [
          "冷氣設備比超市更高級",
          "街坊人情味與依需求客製化的服務",
          "蔬菜肉類都是進口的高級品",
          "所有攤商都二十四小時營業"
        ],
        "ans": 1,
        "ansChar": "B",
        "explain": "Tác giả chỉ ra: '濃郁的街坊人情味與現場挑選新鮮食材的樂趣，是冰冷的冷氣超市難以取代的'.",
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
  
  // Grade as level 1 (Mới học / New) so it enters the SRS queue
  if (typeof applyCardLevel === "function") {
    await applyCardLevel(note, "recognition", 1, true);
  } else {
    await Store.put("settings", "user", S.settings);
  }
  
  // Show toast notification
  showToast(`Đã lưu "${word}" vào Sổ từ & Hàng đợi Flashcards!`);
}

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
    viewMode: "dictation", // "dictation" | "transcript"
    explorerOpen: false
  }, S.dict || {});

  const allTopics = await getDictationTopics();
  const curTopic = allTopics.find(t => t.id === d.passageId) || allTopics[0];
  d.curTopic = curTopic;
  
  if (d.sentenceIdx >= curTopic.sentences.length) d.sentenceIdx = 0;
  const curSent = curTopic.sentences[d.sentenceIdx] || { zh: "", py: "", vn: "", speaker: "" };
  d.cur = curSent;

  // Filter topics for explorer
  let filteredTopics = allTopics;
  if (d.topicCategory === "dialogue") filteredTopics = allTopics.filter(t => t.category === "dialogue");
  else if (d.topicCategory === "story") filteredTopics = allTopics.filter(t => t.category === "story");
  else if (d.topicCategory === "tocfl") filteredTopics = allTopics.filter(t => t.category === "tocfl");
  else if (d.topicCategory === "news") filteredTopics = allTopics.filter(t => t.category === "news");

  // Helper LCS for dictation diff
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

  // Render view
  setView(`
    <div class="w-full bg-paper-base pb-16">
      <div class="flex flex-col w-full">
        <!-- Top Banner & Quick Context Sub-header -->
        <div class="w-full bg-paper-base border-b border-border-subtle/50">
          <div class="max-w-7xl mx-auto px-margin py-space-md">
            <!-- Eyebrow & Status Row -->
            <div class="flex flex-wrap items-center justify-between gap-space-sm mb-space-sm">
              <div class="flex items-center gap-space-xs">
                <span class="w-2.5 h-2.5 rounded-full bg-primary inline-block"></span>
                <span class="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold">Luyện Thính Lực &amp; Viết • 聽寫訓練</span>
                <span class="text-outline text-[11px]">•</span>
                <span class="font-label-sm text-label-sm text-secondary font-medium">Giọng phát âm Đài Loan Chuẩn (臺灣華語)</span>
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

          <!-- SECTION 1: TOPIC EXPLORER & BAND SELECTOR (Collapsible Drawer / Toggleable) -->
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

            <!-- Category Filter Chips -->
            <div class="flex items-center gap-2 overflow-x-auto pb-1">
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'all' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="all">Tất cả chủ đề</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'dialogue' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="dialogue">💬 Đoạn hội thoại thực tế</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'story' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="story">📖 Câu chuyện ngắn</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'tocfl' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="tocfl">🎯 TOCFL Listening</button>
              <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${d.topicCategory === 'news' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-topic-cat="news">📺 Tin tức PTS Đài Loan</button>
            </div>

            <!-- Topics Cards Grid -->
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

          <!-- SECTION 2: WORKSPACE & SIDEBAR (Default view) -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">

            <!-- LEFT / MAIN COLUMN: DICTATION WORKSPACE (8 of 12 cols) -->
            <div class="lg:col-span-8 flex flex-col gap-space-lg">
              
              <!-- Lesson Header Card -->
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
                <!-- Top Card Utility Row: Sentence Counter & Settings -->
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

                  <!-- Settings Button & Modal Trigger -->
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
                    <!-- Play / Pause Action Button -->
                    <div class="flex items-center gap-space-xs">
                      <button class="w-12 h-12 rounded-full bg-primary hover:bg-primary-container text-on-primary flex items-center justify-center transition-all shadow-md active:scale-95" id="btn-play-pause" title="Bấm hoặc nhấn Shift để nghe lại">
                        <span class="material-symbols-outlined text-[26px]" id="icon-play" style="font-variation-settings: 'FILL' 1;">volume_up</span>
                      </button>
                      <button class="w-8 h-8 rounded-full bg-paper-card text-on-surface-variant hover:text-primary flex items-center justify-center transition-colors shadow-sm" id="btn-replay-5s" title="Nghe lại câu này">
                        <span class="material-symbols-outlined text-[18px]">replay</span>
                      </button>
                    </div>

                    <!-- Waveform / Scrubber Bar -->
                    <div class="flex-1 flex flex-col gap-1">
                      <div class="flex items-center justify-between text-code font-code text-outline text-[11px]">
                        <span>Người nói: <strong class="text-on-surface">${esc(curSent.speaker || "Người bản xứ")}</strong></span>
                        <span class="text-primary font-bold">Phím Shift nghe lại</span>
                      </div>
                      <div class="w-full h-2.5 bg-surface-container-high rounded-full overflow-hidden relative cursor-pointer" id="audio-progress-bar">
                        <div class="h-full bg-primary rounded-full transition-all" id="audio-progress-fill" style="width: 100%;"></div>
                      </div>
                    </div>

                    <!-- Speed Controller -->
                    <div class="flex items-center gap-1 shrink-0">
                      <button class="speed-toggle px-2 py-0.5 rounded font-code text-xs ${d.speed === 0.75 ? 'bg-primary text-on-primary font-bold shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}" data-speed="0.75">0.75x</button>
                      <button class="speed-toggle px-2 py-0.5 rounded font-code text-xs ${d.speed === 1.0 ? 'bg-primary text-on-primary font-bold shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}" data-speed="1.0">1.0x</button>
                      <button class="speed-toggle px-2 py-0.5 rounded font-code text-xs ${d.speed === 1.25 ? 'bg-primary text-on-primary font-bold shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}" data-speed="1.25">1.25x</button>
                    </div>
                  </div>
                </div>

                <!-- INPUT AREA: TRADITIONAL CHINESE DICTATION -->
                <div class="flex flex-col gap-space-xs relative">
                  <div class="relative">
                    <textarea class="w-full bg-paper-base rounded-xl p-space-md font-body-lg text-body-lg text-on-surface placeholder:text-outline/70 focus:outline-none focus:bg-paper-card border border-border-subtle focus:border-primary transition-all shadow-inner resize-none leading-relaxed" id="dictation-input" placeholder="Gõ chữ Hán Phồn thể bạn nghe được tại đây... (Nhấn Shift để nghe lại)" rows="3"></textarea>
                  </div>
                  <!-- Hint helper badge -->
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

                <!-- EVALUATION & FEEDBACK BLOCK -->
                <div class="hidden flex-col gap-space-md mt-space-xs pt-space-md bg-paper-base rounded-xl p-space-md border border-border-subtle" id="feedback-panel">
                  
                  <!-- CORRECT STATE -->
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

                    <!-- Details Box -->
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

                  <!-- INCORRECT STATE -->
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

                    <!-- Diff visualization -->
                    <div class="p-3 bg-paper-card rounded-lg border border-border-subtle font-serif text-lg leading-relaxed" id="diffComparison"></div>

                    <!-- Details -->
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

              <!-- TRANSCRIPT CONTAINER (Toggled via tab) -->
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

            <!-- RIGHT COLUMN: SIDEBAR (Progress & Key Vocabulary) (4 of 12 cols) -->
            <div class="lg:col-span-4 flex flex-col gap-space-lg">

              <!-- PROGRESS 17 QUESTIONS GRID -->
              <div class="bg-paper-card p-space-lg rounded-xl shadow-sm border border-border-subtle flex flex-col gap-space-md">
                <div class="flex items-center justify-between pb-space-xs border-b border-border-subtle">
                  <div class="flex items-center gap-space-xs">
                    <span class="material-symbols-outlined text-secondary text-[18px]">checklist</span>
                    <h3 class="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wide">Tiến độ ${curTopic.sentences.length} câu trong bài</h3>
                  </div>
                  <span class="text-xs font-code text-secondary font-bold">${d.sentenceIdx + 1}/${curTopic.sentences.length}</span>
                </div>

                <!-- Number Grid (1..N) -->
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

              <!-- KEY VOCABULARY SIDEBAR -->
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

  // Event handlers
  const txtInput = $("#dictation-input");
  const charCounter = $("#char-counter");
  const btnPlayPause = $("#btn-play-pause");

  // Play audio helper
  function playCurrentAudio() {
    if (!curSent || !curSent.zh) return;
    say(curSent.zh, d.speed || 1.0);
    if (btnPlayPause) {
      btnPlayPause.classList.add("ring-4", "ring-primary/40");
      setTimeout(() => btnPlayPause.classList.remove("ring-4", "ring-primary/40"), 250);
    }
  }

  // Play audio on initial load
  playCurrentAudio();

  // Character counter
  if (txtInput && charCounter) {
    txtInput.oninput = () => {
      charCounter.textContent = `${txtInput.value.length} ký tự`;
    };
  }

  // Play / Pause button
  if (btnPlayPause) {
    btnPlayPause.onclick = () => playCurrentAudio();
  }
  const btnReplay = $("#btn-replay-5s");
  if (btnReplay) {
    btnReplay.onclick = () => playCurrentAudio();
  }

  // Speed toggles
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

  // Previous & Next sentence
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

  // Jump to specific sentence
  document.querySelectorAll("[data-jump-sentence]").forEach((el) => {
    el.onclick = () => {
      d.sentenceIdx = Number(el.dataset.jumpSentence);
      d.checked = false;
      VIEWS["chinh-ta"]();
    };
  });

  // Check Answer Handler
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

  // Skip sentence
  $("#btn-skip-sentence").onclick = () => {
    if (txtInput) txtInput.value = curSent.zh;
    handleCheck();
  };

  // Clear input
  $("#btn-clear-input").onclick = () => {
    if (txtInput) {
      txtInput.value = "";
      charCounter.textContent = "0 ký tự";
      txtInput.focus();
    }
  };

  // Next action buttons
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

  // Save current sentence to notebook
  const btnSaveSent = $("#btn-save-current-sentence");
  if (btnSaveSent) {
    btnSaveSent.onclick = () => {
      saveWordToNotebook(curSent.zh, curSent.py, curSent.vn, curTopic.band || "B1");
    };
  }

  // Save vocabulary buttons
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

  // View Mode Tabs
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

  // Category filter chips in explorer
  document.querySelectorAll("[data-topic-cat]").forEach((chip) => {
    chip.onclick = () => {
      d.topicCategory = chip.dataset.topicCat;
      VIEWS["chinh-ta"]();
    };
  });

  // Select topic
  document.querySelectorAll("[data-select-topic]").forEach((card) => {
    card.onclick = () => {
      d.passageId = card.dataset.selectTopic;
      d.sentenceIdx = 0;
      d.checked = false;
      d.explorerOpen = false;
      VIEWS["chinh-ta"]();
    };
  });

  // KEYBOARD SHORTCUTS: Shift Replay
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

  // Global Shift Listener
  window.onkeydown = (e) => {
    if (location.hash !== "#chinh-ta") return;
    if (e.key === "Shift") {
      playCurrentAudio();
    }
  };
};

// =========================================================================
// 7. VIEW THI THỬ TOCFL (MOCK EXAMS & REVIEW - STITCH DESIGN)
// =========================================================================
VIEWS["thi-thu"] = async () => {
  const exam = S.exam = Object.assign({
    subview: "overview", // "overview" | "review"
    testId: "mock_b1",
    bandFilter: "all",
    curQuestionIdx: 0,
    answers: {},
    history: [],
    timerLeft: 3600,
    isExamMode: false,
    historyModalOpen: false
  }, S.exam || {});

  // Load official tests
  const allTests = await getMockTests();
  const curTest = allTests.find(t => t.id === exam.testId) || allTests[0];
  exam.curTest = curTest;

  // Load history from store
  try {
    const savedHist = await Store.get("kv", "tocfl_history");
    if (Array.isArray(savedHist)) exam.history = savedHist;
  } catch (e) {}

  const curQ = curTest.questions[exam.curQuestionIdx] || curTest.questions[0];

  // Helper play audio
  function playExamAudio() {
    if (!curQ || !curQ.audio) return;
    say(curQ.audio, 0.9);
    const btn = $("#btn-play-exam-audio");
    if (btn) {
      btn.classList.add("ring-4", "ring-primary/40");
      setTimeout(() => btn.classList.remove("ring-4", "ring-primary/40"), 250);
    }
  }

  // Render view
  setView(`
    <div class="w-full bg-paper-base pb-16">
      <div class="flex flex-col w-full">

        <!-- Top Navigation Sub-header (Matching Stitch Design) -->
        <div class="w-full bg-paper-base border-b border-border-subtle/50">
          <div class="max-w-7xl mx-auto px-margin py-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-md">
            <div>
              <div class="flex items-center gap-space-xs text-primary font-label-sm text-xs font-bold tracking-wider uppercase mb-1">
                <span class="w-2.5 h-2.5 rounded-full bg-primary inline-block"></span>
                <span>Khảo thí Trực tuyến • 華語文能力測驗 (SC-TOP)</span>
              </div>
              <h1 class="font-headline-lg text-2xl md:text-3xl font-bold text-on-surface">Thi thử TOCFL Chuẩn CAT</h1>
              <p class="font-body-sm text-xs text-on-surface-variant mt-0.5">Mô phỏng đề thi chính thức: Nghe hiểu &amp; Đọc hiểu với chấm điểm thích ứng và giải thích chi tiết.</p>
            </div>

            <!-- Segmented Switcher & History Button -->
            <div class="flex items-center gap-space-sm flex-wrap">
              <div class="flex items-center gap-1 bg-surface-container p-1 rounded-lg">
                <button class="flex items-center gap-1.5 px-space-md py-1.5 rounded-lg ${exam.subview === 'overview' ? 'bg-paper-card text-on-surface font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'} font-label-md text-xs transition-all" id="tabOverviewBtn">
                  <span class="material-symbols-outlined text-[16px]">grid_view</span>
                  <span>Tổng quan đề thi</span>
                </button>
                <button class="flex items-center gap-1.5 px-space-md py-1.5 rounded-lg ${exam.subview === 'review' ? 'bg-paper-card text-on-surface font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'} font-label-md text-xs transition-all" id="tabReviewBtn">
                  <span class="material-symbols-outlined text-[16px]">assignment</span>
                  <span>Làm đề &amp; Xem lại</span>
                </button>
              </div>

              <button class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-xs transition-colors border border-border-subtle shadow-xs" id="btnOpenHistory">
                <span class="material-symbols-outlined text-primary text-[18px]">history_edu</span>
                <span>Lịch sử thi (${exam.history.length})</span>
              </button>
            </div>
          </div>
        </div>

        <!-- MAIN BODY CONTENT -->
        <div class="max-w-7xl mx-auto px-margin py-space-lg w-full flex flex-col gap-space-lg">

          <!-- ======================================================== -->
          <!-- SUBVIEW 1: OVERVIEW (Danh sách đề & Chẩn đoán điểm yếu)  -->
          <!-- ======================================================== -->
          <div class="${exam.subview === 'overview' ? 'flex' : 'hidden'} flex-col gap-space-lg" id="viewOverview">

            <!-- Diagnostic Alert / Weakness Diagnostic Banner (Matching Stitch Design) -->
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
                    Theo ngân hàng đề chính thức SC-TOP, các dạng câu hỏi dưới đây thường có độ phân hóa cao:
                  </p>
                </div>

                <!-- Diagnostic Cards Grid -->
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
                      <span class="text-xs font-bold text-on-surface">Hội thoại đời sống thực tế</span>
                      <p class="text-[11px] text-outline mt-0.5">TOCFL A2/B1 • Bắt ý ngầm</p>
                    </div>
                    <button class="mt-2 text-primary font-bold text-xs hover:underline text-left" onclick="examQuickStart('mock_b2')">Luyện đề 2 →</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Band Filter Tabs -->
            <div class="flex items-center gap-2 overflow-x-auto pb-1">
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'all' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="all">Tất cả cấp độ</button>
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'Band B' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="Band B">Band B (Khuyên dùng • B1/B2)</button>
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'Band A' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="Band A">Band A (Căn bản A1/A2)</button>
              <button class="px-space-md py-2 rounded-lg font-label-md text-xs font-semibold transition-all ${exam.bandFilter === 'Band C' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}" data-band-filter="Band C">Band C (Cao cấp C1/C2)</button>
            </div>

            <!-- Test Cards Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
              ${allTests.filter(t => exam.bandFilter === 'all' || t.band.includes(exam.bandFilter)).map((t, idx) => `
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
          <!-- SUBVIEW 2: REVIEW & EXAM WORKSPACE                      -->
          <!-- ======================================================== -->
          <div class="${exam.subview === 'review' ? 'flex' : 'hidden'} flex-col gap-space-lg" id="viewReview">

            <!-- Top Test Header Action Bar -->
            <div class="bg-paper-card p-space-md rounded-2xl shadow-sm border border-border-subtle flex flex-wrap items-center justify-between gap-space-md">
              <div class="flex items-center gap-space-md">
                <button class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-variant text-on-surface font-label-md text-xs transition-colors" id="btnBackToOverview">
                  <span class="material-symbols-outlined text-[18px]">arrow_back</span>
                  <span>Trở về danh sách đề</span>
                </button>
                <div class="h-5 w-px bg-border-subtle"></div>
                <div>
                  <h2 class="font-headline-md text-base font-bold text-on-surface">${esc(curTest.title)}</h2>
                  <div class="flex items-center gap-2 text-xs text-outline mt-0.5">
                    <span>Mã đề: #${esc(curTest.id)}</span>
                    <span>•</span>
                    <span class="font-semibold ${exam.isExamMode ? 'text-primary' : 'text-secondary'}">${exam.isExamMode ? '⏱ Chế độ bấm giờ thi thử' : '📖 Chế độ xem đáp án & giải thích'}</span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-space-sm">
                ${exam.isExamMode ? `
                  <div class="px-3 py-1.5 rounded-lg bg-cinnabar-subtle text-primary font-code font-bold text-xs border border-primary/20 flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px]">timer</span>
                    <span id="examTimerDisplay">60:00</span>
                  </div>
                  <button class="px-space-md py-2 rounded-lg bg-secondary text-white hover:opacity-90 font-label-md text-xs font-bold transition-all shadow-sm" id="btnSubmitExam">
                    Nộp bài thi
                  </button>
                ` : `
                  <button class="px-space-md py-2 rounded-lg bg-primary text-white hover:bg-primary-container font-label-md text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm" id="btnRetakeExam">
                    <span class="material-symbols-outlined text-[16px]">replay</span>
                    <span>Làm lại đề này</span>
                  </button>
                `}
              </div>
            </div>

            <!-- Main Question & Sidebar Workspace -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">

              <!-- Left: Question Workspace (8 of 12 cols) -->
              <div class="lg:col-span-8 flex flex-col gap-space-lg">

                <div class="bg-paper-card p-space-lg rounded-2xl border border-border-subtle shadow-sm flex flex-col gap-space-md">
                  
                  <!-- Question Header: Index & Part -->
                  <div class="flex items-center justify-between pb-2 border-b border-border-subtle">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-4 rounded-full bg-primary"></span>
                      <span class="font-headline-md text-sm font-bold text-on-surface">Câu hỏi ${curQ.id} / ${curTest.questions.length}</span>
                      <span class="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-secondary">${esc(curQ.part)}</span>
                    </div>
                    <span class="text-xs text-outline font-medium">${esc(curQ.section === 'listening' ? 'Thính lực (聽力)' : 'Đọc hiểu (閱讀)')}</span>
                  </div>

                  <!-- Audio Player for Listening questions -->
                  ${curQ.section === 'listening' ? `
                    <div class="p-space-md rounded-xl bg-surface-container-low border border-border-subtle flex items-center justify-between gap-3">
                      <div class="flex items-center gap-3">
                        <button class="w-12 h-12 rounded-full bg-primary hover:bg-primary-container text-white flex items-center justify-center transition-all shadow-sm active:scale-95" id="btn-play-exam-audio" title="Nhấn để nghe hoặc nhấn Shift">
                          <span class="material-symbols-outlined text-[24px]">volume_up</span>
                        </button>
                        <div class="flex flex-col">
                          <span class="font-bold text-xs text-on-surface">Đoạn âm tiếng Đài Chuẩn</span>
                          <span class="text-[11px] text-outline mt-0.5">Nhấn phím <kbd class="px-1 py-0.5 bg-surface-container rounded font-code font-bold text-primary">Shift</kbd> để nghe lại bất cứ lúc nào</span>
                        </div>
                      </div>
                      <div class="text-xs font-code text-secondary font-bold bg-jade-subtle px-2 py-1 rounded">
                        Lossless zh-TW
                      </div>
                    </div>
                  ` : ''}

                  <!-- Context & Question Prompt -->
                  <div class="flex flex-col gap-2">
                    ${curQ.context ? `
                      <div class="p-3 bg-surface-container-low rounded-xl border border-border-subtle/70 text-xs text-on-surface font-serif leading-relaxed whitespace-pre-wrap">${esc(curQ.context)}</div>
                    ` : ''}
                    <h3 class="font-headline-md text-base font-bold text-on-surface mt-1">${esc(curQ.q)}</h3>
                  </div>

                  <!-- Options (A, B, C, D) -->
                  <div class="flex flex-col gap-2 pt-2">
                    ${curQ.options.map((opt, optIdx) => {
                      const letters = ["A", "B", "C", "D"];
                      const letter = letters[optIdx];
                      const userChoice = exam.answers[curQ.id];
                      const isSelected = userChoice === optIdx;
                      const isCorrect = curQ.ans === optIdx;
                      
                      let optClass = "border-border-subtle bg-surface-container-low hover:bg-surface-container text-on-surface";
                      if (exam.isExamMode) {
                        if (isSelected) optClass = "border-primary bg-cinnabar-subtle text-primary font-bold shadow-xs ring-2 ring-primary/20";
                      } else {
                        // Review mode
                        if (isCorrect) optClass = "border-secondary bg-jade-subtle text-secondary font-bold ring-2 ring-secondary/30";
                        else if (isSelected && !isCorrect) optClass = "border-primary bg-cinnabar-subtle text-primary font-bold";
                      }

                      return `
                        <div class="p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${optClass}" data-select-opt="${optIdx}">
                          <div class="flex items-center gap-3">
                            <span class="w-6 h-6 rounded-full flex items-center justify-center font-code text-xs font-bold shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-surface-container text-outline'}">
                              ${letter}
                            </span>
                            <span class="font-serif text-sm font-medium">${esc(opt)}</span>
                          </div>
                          ${!exam.isExamMode && isCorrect ? `<span class="material-symbols-outlined text-secondary text-[20px]">check_circle</span>` : ''}
                          ${!exam.isExamMode && isSelected && !isCorrect ? `<span class="material-symbols-outlined text-primary text-[20px]">cancel</span>` : ''}
                        </div>
                      `;
                    }).join("")}
                  </div>

                  <!-- Explanation Box (Shown in review mode or when answered) -->
                  ${!exam.isExamMode ? `
                    <div class="mt-space-md p-space-md rounded-xl bg-jade-subtle border border-secondary/30 flex flex-col gap-space-xs">
                      <div class="flex items-center gap-1.5 text-secondary font-bold text-xs">
                        <span class="material-symbols-outlined text-[18px]">verified</span>
                        <span>Đáp án chính xác: (${curQ.ansChar || ["A","B","C","D"][curQ.ans]})</span>
                      </div>
                      <p class="text-xs text-on-surface font-medium leading-relaxed">${esc(curQ.explain)}</p>
                      
                      ${curQ.dialogue ? `
                        <div class="mt-2 pt-2 border-t border-secondary/20 text-xs">
                          <span class="font-bold text-secondary block mb-1">Lời thoại chi tiết:</span>
                          <p class="font-serif text-on-surface whitespace-pre-wrap leading-relaxed">${esc(curQ.dialogue)}</p>
                        </div>
                      ` : ''}
                    </div>
                  ` : ''}

                  <!-- Navigation Actions -->
                  <div class="flex items-center justify-between pt-space-md border-t border-border-subtle">
                    <button class="px-space-md py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center gap-1 ${exam.curQuestionIdx === 0 ? 'opacity-40 cursor-not-allowed' : ''}" id="btnPrevQ" ${exam.curQuestionIdx === 0 ? 'disabled' : ''}>
                      <span class="material-symbols-outlined text-[16px]">arrow_back</span> Câu trước
                    </button>
                    <button class="px-space-md py-2 rounded-xl bg-primary hover:bg-primary-container text-white text-xs font-bold flex items-center gap-1 shadow-sm active:scale-95" id="btnNextQ">
                      Câu tiếp theo <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </button>
                  </div>

                </div>

              </div>

              <!-- Right: 50 Question Grid Navigator (4 of 12 cols) -->
              <div class="lg:col-span-4 flex flex-col gap-space-md">
                <div class="bg-paper-card p-space-lg rounded-2xl border border-border-subtle shadow-sm flex flex-col gap-space-md">
                  <div class="flex items-center justify-between pb-2 border-b border-border-subtle">
                    <div class="flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-secondary text-[20px]">apps</span>
                      <h3 class="font-headline-md text-sm font-bold text-on-surface">Danh sách 50 câu hỏi</h3>
                    </div>
                    <span class="font-code text-xs text-primary font-bold">Câu ${curQ.id}</span>
                  </div>

                  <!-- 50 Question Number Grid -->
                  <div class="grid grid-cols-5 gap-2 max-h-[380px] overflow-y-auto pr-1">
                    ${curTest.questions.map((q, idx) => {
                      const isCurrent = idx === exam.curQuestionIdx;
                      const hasAns = exam.answers[q.id] !== undefined;
                      const isCorrect = exam.answers[q.id] === q.ans;

                      let cls = "bg-surface-container-low hover:bg-surface-container text-outline";
                      if (exam.isExamMode) {
                        if (hasAns) cls = "bg-primary text-white font-bold shadow-2xs";
                      } else {
                        // Review mode
                        if (hasAns) {
                          cls = isCorrect ? "bg-jade-subtle text-secondary font-bold border border-secondary/30" : "bg-cinnabar-subtle text-primary font-bold border border-primary/30";
                        }
                      }
                      if (isCurrent) cls += " ring-2 ring-primary border-primary";

                      return `
                        <button class="h-9 rounded-lg ${cls} font-code text-xs flex items-center justify-center transition-all cursor-pointer" data-jump-q="${idx}">
                          ${q.id}
                        </button>
                      `;
                    }).join("")}
                  </div>

                  <!-- Legend -->
                  <div class="flex items-center justify-between pt-2 border-t border-border-subtle text-[11px] text-outline">
                    <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-primary"></span> Đã trả lời</span>
                    <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-surface-container"></span> Chưa làm</span>
                  </div>
                </div>
              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- HISTORY MODAL -->
      <div class="${exam.historyModalOpen ? 'flex' : 'hidden'} fixed inset-0 z-[100] bg-black/40 backdrop-blur-xs items-center justify-center p-4" id="historyModal">
        <div class="bg-paper-card w-full max-w-lg rounded-2xl p-space-lg shadow-2xl flex flex-col gap-space-md border border-border-subtle animate-in fade-in zoom-in-95 duration-150">
          <div class="flex items-center justify-between border-b pb-space-sm border-border-subtle">
            <div class="flex items-center gap-space-xs">
              <span class="material-symbols-outlined text-primary text-[22px]">history_edu</span>
              <h3 class="font-headline-md text-base text-on-surface font-bold">Lịch sử thi của bạn</h3>
            </div>
            <button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors" id="btnCloseHistory">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <p class="text-xs text-outline">
            Danh sách các lần nộp bài thi thử TOCFL gần nhất được lưu tự động trên thiết bị.
          </p>

          <div class="max-h-[300px] overflow-y-auto flex flex-col gap-2">
            ${exam.history.length === 0 ? `
              <div class="p-6 text-center text-xs text-outline">Chưa có lượt thi nào. Hãy bắt đầu làm bài thi thử đầu tiên!</div>
            ` : exam.history.map((h, idx) => `
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

  // Audio play in review/exam
  if (curQ.section === "listening") {
    playExamAudio();
  }
  const btnPlayEx = $("#btn-play-exam-audio");
  if (btnPlayEx) {
    btnPlayEx.onclick = () => playExamAudio();
  }

  // Option selection
  document.querySelectorAll("[data-select-opt]").forEach((card) => {
    card.onclick = () => {
      const optIdx = Number(card.dataset.selectOpt);
      exam.answers[curQ.id] = optIdx;
      VIEWS["thi-thu"]();
    };
  });

  // Navigation
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
  document.querySelectorAll("[data-jump-q]").forEach((btn) => {
    btn.onclick = () => {
      exam.curQuestionIdx = Number(btn.dataset.jumpQ);
      VIEWS["thi-thu"]();
    };
  });

  // Subview toggles
  $("#tabOverviewBtn").onclick = () => {
    exam.subview = "overview";
    VIEWS["thi-thu"]();
  };
  $("#tabReviewBtn").onclick = () => {
    exam.subview = "review";
    VIEWS["thi-thu"]();
  };
  $("#btnBackToOverview").onclick = () => {
    exam.subview = "overview";
    VIEWS["thi-thu"]();
  };

  // Band filters in overview
  document.querySelectorAll("[data-band-filter]").forEach((btn) => {
    btn.onclick = () => {
      exam.bandFilter = btn.dataset.bandFilter;
      VIEWS["thi-thu"]();
    };
  });

  // Start exam / Review exam
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

  // Submit Exam
  const btnSubmit = $("#btnSubmitExam");
  if (btnSubmit) {
    btnSubmit.onclick = async () => {
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
    };
  }

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

  // History modal
  $("#btnOpenHistory").onclick = () => {
    exam.historyModalOpen = true;
    VIEWS["thi-thu"]();
  };
  $("#btnCloseHistory").onclick = () => {
    exam.historyModalOpen = false;
    VIEWS["thi-thu"]();
  };

  // Keyboard shortcut: Shift Replay
  window.onkeydown = (e) => {
    if (location.hash !== "#thi-thu") return;
    if (e.key === "Shift") {
      playExamAudio();
    }
  };
};

// Quick helper for diagnostic clicks
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
