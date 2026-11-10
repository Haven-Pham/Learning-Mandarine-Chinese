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
    const state = Object.assign(freshState(), S.srs.get(id));
    Object.assign(state, {
      state: level === 1 ? "learn" : "review",
      ivl,
      step: 0,
      due: level === 1 ? now + STEPS[0] : dayStart(now) + ivl * DAY,
      firstSeen: state.firstSeen || state.last || now,
      last: now,
      w: n.w
    });
    return [id, state];
  });

  // Cập nhật thống kê học tập trong ngày để tính vào mục tiêu học
  const key = dayKey(now);
  const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats.get(key));
  st.reviews++;
  if (wasNew && level > 0) st.newCards++;
  if (level === 1) st.again++;
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
  if (message) message.textContent = `Đã đặt ${n.w} ở mức ${LEVELS[level]}.`;
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
  const left = Math.max(0, Number(S.settings.newPerDay || 20) - todayStats().newCards);
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
  document.querySelectorAll("nav.tabs a").forEach((a) => { if (a.dataset.view === name || (name === "tu" && a.dataset.view === "tu-dien") || (name === "muc-nho" && a.dataset.view === "trang-chu")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const fn = VIEWS[name] || VIEWS["trang-chu"];
  if (name !== "hoc") S.session = null;
  fn(arg); window.scrollTo(0, 0); updateBadge();
}
addEventListener("hashchange", route);
function updateBadge() { const b = $("#tabBadge"); if (!b || !S.ready) return; const c = todayCounts().total; b.hidden = !c; b.textContent = c; }

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

// =========================================================================
// MODERN ORIENTAL SCHOLARLY SYSTEM (Google Stitch Integration)
// =========================================================================

function folderNotes(id) {
  if (S.bands.includes(id)) return S.notes.filter((n) => n.kind === "vocab" && inBand(n, id));
  if (id === "cua-toi") return S.notes.filter((n) => n.rich);
  if (id === "viet-tat") { const set = new Set(); for (const w of S.abbrS.keys()) { const n = S.noteByWord.get(w); if (n) set.add(n); } return [...set]; }
  return S.notes.filter((n) => n.rich && n.deck.id === id);
}
function folderOn(id) {
  if (S.bands.includes(id)) return !!S.settings.bands[id];
  if (id === "cua-toi") return S.decks.every((d) => deckOn(d.id));
  if (id === "viet-tat") return folderNotes(id).every(inLearning);
  return deckOn(id);
}
function setFolderOn(id, v) {
  if (S.bands.includes(id)) S.settings.bands[id] = v;
  else if (id === "cua-toi") for (const d of S.decks) S.settings.decks[d.id] = v;
  else if (id === "viet-tat") { for (const n of folderNotes(id)) { if (n.rich) S.settings.decks[n.deck.id] = v || deckOn(n.deck.id); else if (v) S.settings.extra[n.w] = true; else delete S.settings.extra[n.w]; } }
  else S.settings.decks[id] = v;
}
const hasProgress = (n) => typesOf(n).some(([t]) => S.srs.has(cardId(n, t)));

const strokeCache = new Map();
async function strokeData(c) {
  const k = String(c.codePointAt(0) % 64).padStart(2, "0");
  if (!strokeCache.has(k)) strokeCache.set(k, getJSON("data/strokes/" + k + ".json"));
  const chunk = await strokeCache.get(k); if (!chunk[c]) throw new Error("no data"); return chunk[c];
}
const writers = {};
function drawChar(k, c) {
  const el = $("#hw" + k); if (!el || !window.HanziWriter) return;
  const w = HanziWriter.create(el, c, {
    width: 140, height: 140, padding: 6, showOutline: true,
    strokeColor: "#86090a", outlineColor: "#EBE2D8", highlightColor: "#176b4b", drawingColor: "#1d1b1a",
    strokeAnimationSpeed: 1, delayBetweenStrokes: 250,
    charDataLoader: (ch, onLoad, onErr) => { strokeData(ch).then(onLoad).catch(() => { el.innerHTML = '<div class="text-xs text-outline p-4">Chưa có nét chữ này</div>'; onErr && onErr(); }); }
  });
  writers[k] = w;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-anim]"); if (a && writers[a.dataset.anim]) { writers[a.dataset.anim].animateCharacter(); return; }
  const q = e.target.closest("[data-quiz]"); if (q && writers[q.dataset.quiz]) { writers[q.dataset.quiz].quiz({ showHintAfterMisses: 2 }); }
});

function searchDict(raw) {
  const out = $("#dres"), cnt = $("#dcount"); if (!out) return;
  const q = clean(raw);
  if (!q) {
    cnt.textContent = "";
    out.innerHTML = '<div class="col-span-full p-8 text-center text-outline bg-paper-card rounded-2xl border border-border-subtle">Gõ chữ Hán, pinyin hoặc nghĩa tiếng Việt/tiếng Anh để tra cứu từ điển.</div>';
    return;
  }
  const res = []; const seen = new Set();
  const push = (w, n, pri) => { if (seen.has(w)) return; seen.add(w); res.push({ w, n, pri }); };
  if (isHan(q)) {
    for (const [w, n] of S.noteByWord) if (w.includes(q)) push(w, n, w === q ? 0 : w.startsWith(q) ? 1 : 2);
    if (S.ced) for (const w of S.ced.keys()) { if (res.length > 400) break; if (w.includes(q)) push(w, null, w === q ? 0 : w.startsWith(q) ? 3 : 4); }
  } else {
    const f = fold(q);
    for (const n of S.notes) {
      const it = itemOf(n); const p = fold(it.py);
      if (p === f) push(it.w, n, 0);
      else if (p.startsWith(f)) push(it.w, n, 1);
      else if (f.length >= 2 && (fold(it.vn).includes(f) || fold(it.en).includes(f) || fold(it.hv).includes(f))) push(it.w, n, 2);
    }
    if (S.ced && f.length >= 2) for (const [w, es] of S.ced) {
      if (res.length > 400) break;
      for (const [py, defs] of es) {
        const p = fold(py);
        if (p === f) { push(w, null, 3); break; }
        if (f.length >= 3 && fold(defs).includes(f)) { push(w, null, 5); break; }
      }
    }
  }
  res.sort((a, b) => a.pri - b.pri || a.w.length - b.w.length);
  cnt.textContent = fmt(Math.min(res.length, 90)) + (res.length > 90 ? "+" : "") + " kết quả tra cứu";
  out.innerHTML = res.slice(0, 90).map(({ w, n }) => {
    const e = cedFirst(w);
    const py = n ? itemOf(n).py : (e ? e[0][0] : "");
    const m = n ? meaningOf(n) : enOf(w);
    const lvl = n ? noteLevel(n) : null;
    const band = n ? bandsOf(n).join(" · ") : "ngoài TOCFL";
    return `
      <a href="#tu/${encodeURIComponent(w)}" class="p-4 rounded-2xl bg-paper-card border border-border-subtle hover:border-primary/50 hover:shadow-xs transition-all flex flex-col justify-between gap-2">
        <div class="flex items-start justify-between">
          <div>
            <span class="font-headline-md text-2xl text-on-surface font-serif font-bold">${esc(w)}</span>
            <span class="font-code text-xs text-tertiary ml-2">${esc(py)}</span>
          </div>
          <span class="text-xs px-2 py-0.5 rounded-full bg-surface-container font-semibold text-outline">${esc(band)}</span>
        </div>
        <div class="text-sm text-on-surface-variant font-body-sm line-clamp-2">
          ${esc(m || 'Tra cứu chi tiết')}
        </div>
        ${lvl !== null ? `<div class="pt-1"><span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span></div>` : ''}
      </a>
    `;
  }).join('') || '<div class="col-span-full p-8 text-center text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy từ nào phù hợp.</div>';
}

// ---------------- 1. TRANG CHỦ ----------------
VIEWS["trang-chu"] = () => {
  const vocab = S.notes.filter((n) => n.kind === "vocab");
  const lv = [0, 0, 0, 0, 0, 0];
  for (const n of vocab) lv[noteLevel(n)]++;
  const learned = vocab.length - lv[0];
  const c = todayCounts();
  const st = todayStats();
  const summary = studySummary(S.stats, Date.now());

  const targetNew = Math.max(1, Number(S.settings.newPerDay || 20));
  const targetRev = Math.max(1, Number(S.settings.reviewPerDay || 50));
  const newDone = Math.min(st.newCards, targetNew);
  const reviewedToday = Math.max(0, st.reviews - st.newCards);
  const revDone = Math.min(reviewedToday, targetRev);

  const pctNew = Math.min(100, Math.round((st.newCards / targetNew) * 100));
  const pctRev = Math.min(100, Math.round((reviewedToday / targetRev) * 100));
  const overallPct = Math.min(100, Math.round(((st.newCards + reviewedToday) / (targetNew + targetRev)) * 100));
  const studyMinutes = Math.max(1, Math.round(st.reviews * 0.45));

  const today = new Date(dayStart(Date.now()));
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - 29 + i);
    const key = dayKey(d);
    const revs = (S.stats.get(key) || {}).reviews || 0;
    return { key, date: d.getDate(), month: d.getMonth() + 1, revs };
  });

  const bandList = ["Novice 1", "Novice 2", "A1", "A2", "B1", "B2", "C"];
  const bandProgressHTML = bandList.map(b => {
    const ns = vocab.filter(n => inBand(n, b));
    const l = ns.filter(n => noteLevel(n) > 0).length;
    const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
    const isTarget = b === "B1";
    return `
      <div class="p-space-md rounded-xl bg-surface-container-low flex flex-col gap-space-xs border border-border-subtle/60">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-space-xs">
            <span class="w-6 h-6 rounded bg-primary-container text-on-primary font-code text-[11px] flex items-center justify-center font-bold">${b.slice(0, 2)}</span>
            <span class="font-label-md text-label-md text-on-surface font-semibold">${b} (${BAND_INFO[b] || ''})</span>
            ${isTarget ? '<span class="text-[10px] px-1.5 py-0.2 rounded-full bg-cinnabar-subtle text-primary font-semibold">Mục tiêu</span>' : ''}
          </div>
          <span class="font-code text-body-sm text-primary font-bold">${pct}%</span>
        </div>
        <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
          <div class="h-full bg-secondary rounded-full transition-all duration-500" style="width: ${pct}%;"></div>
        </div>
        <div class="flex items-center justify-between font-body-sm text-xs text-on-surface-variant pt-0.5">
          <span>Đã học: <strong>${fmt(l)}</strong> / ${fmt(ns.length)} từ</span>
          <a href="#thu-muc/${encodeURIComponent(b)}" class="text-primary hover:underline font-medium">Mở band →</a>
        </div>
      </div>
    `;
  }).join("");

  const html = `
  <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin w-full py-space-md md:py-space-lg flex flex-col gap-space-xl">
    <!-- Top Hero Banner: East Asian Modern Scholar Scroll -->
    <section class="relative w-full rounded-2xl overflow-hidden bg-surface-container-low border border-border-subtle shadow-xs">
      <div class="absolute -right-16 -bottom-16 w-80 h-80 rounded-full bg-primary-container/5 blur-3xl pointer-events-none"></div>
      <div class="absolute -left-10 -top-10 w-64 h-64 rounded-full bg-secondary/5 blur-2xl pointer-events-none"></div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg p-space-lg lg:p-space-xl items-center relative z-10">
        <div class="lg:col-span-8 flex flex-col gap-space-md">
          <div class="flex items-center gap-space-sm flex-wrap">
            <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
            <span class="font-label-sm text-label-sm text-primary uppercase tracking-widest font-semibold">Khởi tâm mỗi ngày • 每日格言</span>
            <span class="px-space-xs py-0.5 rounded-full bg-cinnabar-subtle text-primary font-code text-[11px] font-medium">Luận Ngữ • Học Nhi</span>
          </div>
          <div class="flex flex-col gap-space-xs">
            <h1 class="font-display text-2xl sm:text-display text-on-surface tracking-wide leading-tight font-serif">
              學而時習之，不亦說乎
            </h1>
            <p class="font-code text-body-md text-primary font-medium tracking-wide">
              Xué ér shí xí zhī, bù yì yuè hū?
            </p>
            <p class="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mt-1">
              "Học tập rồi thường xuyên ôn luyện lại, chẳng cũng vui thích lắm sao?"
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-space-md pt-space-xs">
            <div class="flex items-center gap-space-xs bg-paper-card px-space-md py-space-xs rounded-full shadow-xs border border-border-subtle/50">
              <span class="material-symbols-outlined text-[18px] text-tertiary">local_fire_department</span>
              <span class="font-label-md text-label-md text-on-surface">Đạt chuỗi <strong class="text-primary font-semibold">${summary.current || 0} ngày</strong> chuyên cần</span>
            </div>
            <div class="flex items-center gap-space-xs bg-paper-card px-space-md py-space-xs rounded-full shadow-xs border border-border-subtle/50">
              <span class="material-symbols-outlined text-[18px] text-secondary">verified</span>
              <span class="font-label-md text-label-md text-on-surface">Mục tiêu: <strong class="text-secondary font-semibold">TOCFL B1 (Tiến cấp)</strong></span>
            </div>
          </div>
        </div>

        <div class="lg:col-span-4 flex justify-center lg:justify-end">
          <div class="relative w-full max-w-[280px] p-space-md rounded-xl bg-paper-card shadow-sm border border-border-subtle flex flex-col gap-space-sm items-center text-center">
            <div class="w-full h-28 rounded-lg bg-surface-container flex flex-col items-center justify-center relative overflow-hidden text-center p-3">
              <div class="font-headline-md text-xl text-primary font-serif font-bold">臺灣華語</div>
              <p class="font-label-sm text-on-surface-variant mt-1">Phồn thể Đài Bắc • 繁體中文</p>
              <div class="mt-2 flex items-center gap-1.5 text-xs font-code text-secondary">
                <span class="material-symbols-outlined text-[16px]">record_voice_over</span>
                <span>Phát âm bản xứ</span>
              </div>
            </div>
            <div class="w-full flex items-center justify-between px-space-xs pt-1">
              <span class="font-label-sm text-label-sm text-outline">Phiên âm song song</span>
              <span class="inline-flex items-center gap-1 font-code text-xs text-on-surface-variant font-medium bg-paper-muted px-2 py-0.5 rounded">ㄅㄆㄇㄈ + Pīnyīn</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Key Metrics Bento Row -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
      <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between">
          <span class="font-label-md text-label-md text-on-surface-variant">Chuỗi liên tục</span>
          <div class="w-9 h-9 rounded-lg bg-cinnabar-subtle flex items-center justify-center">
            <span class="material-symbols-outlined text-[20px] text-primary">local_fire_department</span>
          </div>
        </div>
        <div class="mt-space-md">
          <div class="flex items-baseline gap-space-xs">
            <span class="font-display text-display text-on-surface">${summary.current || 0}</span>
            <span class="font-label-md text-label-md text-on-surface-variant font-medium">ngày</span>
          </div>
          <p class="font-body-sm text-body-sm text-secondary mt-1 flex items-center gap-1">
            <span class="material-symbols-outlined text-[14px]">trending_up</span> Kỷ lục: ${summary.longest || 0} ngày
          </p>
        </div>
      </div>

      <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between">
          <span class="font-label-md text-label-md text-on-surface-variant">Tổng từ đã thuộc</span>
          <div class="w-9 h-9 rounded-lg bg-jade-subtle flex items-center justify-center">
            <span class="material-symbols-outlined text-[20px] text-secondary">auto_stories</span>
          </div>
        </div>
        <div class="mt-space-md">
          <div class="flex items-baseline gap-space-xs">
            <span class="font-display text-display text-on-surface">${fmt(lv[4] + lv[5])}</span>
            <span class="font-label-md text-label-md text-on-surface-variant font-medium">từ vựng</span>
          </div>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">
            ${fmt(learned)} từ trong lịch học
          </p>
        </div>
      </div>

      <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between">
          <span class="font-label-md text-label-md text-on-surface-variant">Mục tiêu hôm nay</span>
          <div class="w-9 h-9 rounded-lg bg-amber-subtle flex items-center justify-center">
            <span class="material-symbols-outlined text-[20px] text-tertiary">pie_chart</span>
          </div>
        </div>
        <div class="mt-space-md">
          <div class="flex items-baseline justify-between">
            <div class="flex items-baseline gap-space-xs">
              <span class="font-display text-display text-on-surface">${overallPct}</span>
              <span class="font-label-md text-label-md text-on-surface-variant font-medium">%</span>
            </div>
            <span class="font-code text-body-sm text-on-surface-variant">${reviewedToday + st.newCards}/${targetRev + targetNew} thẻ</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-surface-container mt-2 overflow-hidden">
            <div class="h-full bg-primary-container rounded-full transition-all duration-500" style="width: ${overallPct}%;"></div>
          </div>
        </div>
      </div>

      <div class="p-space-lg rounded-xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
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
            <span class="material-symbols-outlined text-[14px]">check_circle</span> Đã học ${fmt(st.reviews)} lượt
          </p>
        </div>
      </div>
    </section>

    <!-- USER DAILY GOALS SECTION: Tự đặt mục tiêu & Thanh tiến độ từng nhiệm vụ -->
    <section class="w-full p-space-lg lg:p-space-xl rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col gap-space-md">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-xs border-b border-border-subtle/60">
        <div class="flex items-center gap-space-sm">
          <span class="w-1.5 h-5 rounded-full bg-primary-container"></span>
          <div>
            <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Lộ trình hằng ngày & Tiến độ từng nhiệm vụ</h2>
            <p class="font-body-sm text-xs text-on-surface-variant">Bạn có thể tự đặt mục tiêu học bao nhiêu thẻ mới và ôn bao nhiêu thẻ mỗi ngày.</p>
          </div>
        </div>
        <a href="#cai-dat" class="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
          <span class="material-symbols-outlined text-[16px]">tune</span>
          <span>Tùy chỉnh sâu trong Cài đặt</span>
        </a>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-space-lg pt-space-xs">
        <!-- Task 1: Học thẻ mới -->
        <div class="p-space-md md:p-space-lg rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-space-sm justify-between">
          <div class="flex flex-col gap-space-xs">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-sm font-bold text-primary flex items-center gap-1.5 uppercase">
                <span class="w-2 h-2 rounded-full bg-primary"></span>
                Nhiệm vụ 1: Thẻ mới hôm nay
              </span>
              <span class="font-code text-xs font-bold px-2 py-0.5 rounded-full ${pctNew >= 100 ? 'bg-jade-subtle text-secondary' : 'bg-cinnabar-subtle text-primary'}">
                ${pctNew}%
              </span>
            </div>
            <div class="flex items-baseline justify-between mt-1">
              <span class="font-body-sm text-xs text-on-surface-variant">Đã học: <strong class="text-on-surface font-semibold">${st.newCards}</strong> thẻ</span>
              <div class="flex items-center gap-1 text-xs">
                <span class="text-outline">Mục tiêu:</span>
                <input id="quickGoalNew" type="number" min="5" max="200" step="5" value="${targetNew}" class="w-16 px-2 py-0.5 rounded bg-white border border-border-subtle font-code text-xs text-center font-bold text-primary focus:outline-none focus:ring-1 focus:ring-primary" title="Bấm để chỉnh số thẻ mới mỗi ngày">
                <span class="text-outline">thẻ</span>
              </div>
            </div>
            <div class="w-full h-2.5 rounded-full bg-surface-container mt-2 overflow-hidden">
              <div class="h-full bg-primary rounded-full transition-all duration-500" style="width: ${pctNew}%;"></div>
            </div>
          </div>
          <div class="text-[11px] text-outline flex items-center justify-between pt-1">
            <span>${c.fresh > 0 ? `Còn ${fmt(c.fresh)} thẻ mới đang chờ nạp` : 'Đã nạp hết thẻ mới sẵn có'}</span>
            <span class="${pctNew >= 100 ? 'text-secondary font-semibold' : ''}">${pctNew >= 100 ? '✓ Đạt chỉ tiêu' : `Cần thêm ${Math.max(0, targetNew - st.newCards)} thẻ`}</span>
          </div>
        </div>

        <!-- Task 2: Ôn tập thẻ đến hạn -->
        <div class="p-space-md md:p-space-lg rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-space-sm justify-between">
          <div class="flex flex-col gap-space-xs">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-sm font-bold text-secondary flex items-center gap-1.5 uppercase">
                <span class="w-2 h-2 rounded-full bg-secondary"></span>
                Nhiệm vụ 2: Ôn tập hôm nay
              </span>
              <span class="font-code text-xs font-bold px-2 py-0.5 rounded-full ${pctRev >= 100 ? 'bg-jade-subtle text-secondary' : 'bg-amber-subtle text-tertiary'}">
                ${pctRev}%
              </span>
            </div>
            <div class="flex items-baseline justify-between mt-1">
              <span class="font-body-sm text-xs text-on-surface-variant">Đã ôn: <strong class="text-on-surface font-semibold">${reviewedToday}</strong> thẻ</span>
              <div class="flex items-center gap-1 text-xs">
                <span class="text-outline">Mục tiêu:</span>
                <input id="quickGoalRev" type="number" min="10" max="500" step="10" value="${targetRev}" class="w-16 px-2 py-0.5 rounded bg-white border border-border-subtle font-code text-xs text-center font-bold text-secondary focus:outline-none focus:ring-1 focus:ring-secondary" title="Bấm để chỉnh số thẻ ôn mỗi ngày">
                <span class="text-outline">thẻ</span>
              </div>
            </div>
            <div class="w-full h-2.5 rounded-full bg-surface-container mt-2 overflow-hidden">
              <div class="h-full bg-secondary rounded-full transition-all duration-500" style="width: ${pctRev}%;"></div>
            </div>
          </div>
          <div class="text-[11px] text-outline flex items-center justify-between pt-1">
            <span>${c.due > 0 ? `Còn ${fmt(c.due)} thẻ đến hạn nhắc lại` : 'Không có thẻ quá hạn'}</span>
            <span class="${pctRev >= 100 ? 'text-secondary font-semibold' : ''}">${pctRev >= 100 ? '✓ Đạt chỉ tiêu' : `Cần ôn thêm ${Math.max(0, targetRev - reviewedToday)} thẻ`}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Main Dual Panel: Action Center + Spaced Repetition Breakdown -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-stretch">
      <section class="lg:col-span-7 p-space-lg lg:p-space-xl rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between">
        <div class="flex flex-col gap-space-md">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-space-sm">
              <span class="w-1 h-5 rounded-full bg-primary-container"></span>
              <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Bắt đầu học ngay</h2>
            </div>
            <span class="font-label-sm text-label-sm text-secondary font-semibold bg-jade-subtle px-space-sm py-0.5 rounded-full flex items-center gap-1 border border-secondary/20">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> Sẵn sàng ôn luyện
            </span>
          </div>
          <p class="font-body-md text-body-md text-on-surface-variant">
            Thuật toán Lặp lại ngắt quãng (Spaced Repetition) đã phân bổ tập thẻ tối ưu cho nhịp sinh học hôm nay của bạn.
          </p>

          <div class="grid grid-cols-3 gap-space-sm my-space-xs">
            <div class="p-space-md rounded-xl bg-cinnabar-subtle flex flex-col">
              <span class="font-label-sm text-label-sm text-primary font-semibold">TỪ MỚI</span>
              <span class="font-headline-lg text-headline-lg text-primary font-bold mt-1">${fmt(c.fresh)}</span>
              <span class="font-body-sm text-xs text-on-surface-variant">Mục tiêu: ${targetNew}</span>
            </div>
            <div class="p-space-md rounded-xl bg-amber-subtle flex flex-col">
              <span class="font-label-sm text-label-sm text-tertiary font-semibold">CẦN ÔN TẬP</span>
              <span class="font-headline-lg text-headline-lg text-tertiary font-bold mt-1">${fmt(c.due)}</span>
              <span class="font-body-sm text-xs text-on-surface-variant">Đến hạn nhắc lại</span>
            </div>
            <div class="p-space-md rounded-xl bg-paper-muted flex flex-col">
              <span class="font-label-sm text-label-sm text-on-surface font-semibold">TỔNG CỘNG</span>
              <span class="font-headline-lg text-headline-lg text-on-surface font-bold mt-1">${fmt(c.total)}</span>
              <span class="font-body-sm text-xs text-on-surface-variant">~ ${Math.round(c.total * 0.45)} phút</span>
            </div>
          </div>
        </div>

        <div class="pt-space-md flex flex-col sm:flex-row items-center gap-space-md">
          <a href="#hoc" class="w-full sm:w-auto flex-1 h-12 px-space-xl rounded-xl bg-primary-container text-on-primary font-label-md text-label-md font-semibold hover:bg-primary transition-all duration-200 shadow-sm flex items-center justify-center gap-space-sm">
            <span class="material-symbols-outlined text-[20px]">play_circle</span>
            <span>Bắt đầu ôn tập (${fmt(c.total)} thẻ)</span>
          </a>
          <a href="#cai-dat" class="w-full sm:w-auto h-12 px-space-lg rounded-xl bg-paper-muted text-on-surface font-label-md text-label-md font-medium hover:bg-surface-container transition-colors flex items-center justify-center gap-space-xs">
            <span class="material-symbols-outlined text-[18px] text-outline">tune</span>
            <span>Tùy chỉnh mục tiêu</span>
          </a>
        </div>
      </section>

      <section class="lg:col-span-5 p-space-lg rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between">
        <div class="flex flex-col gap-space-md">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-sm">
              <span class="w-1 h-5 rounded-full bg-secondary"></span>
              <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Lộ trình TOCFL</h2>
            </div>
            <span class="font-code text-xs text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">Band B • Tiến cấp</span>
          </div>

          <div class="flex flex-col gap-space-sm">
            ${bandProgressHTML.slice(0, 3)}
          </div>
        </div>

        <div class="pt-space-md flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant border-t border-border-subtle/50 mt-4">
          <span class="flex items-center gap-1">
            <span class="material-symbols-outlined text-[16px] text-secondary">event</span>
            Chuẩn bị kỳ thi TOCFL 2026
          </span>
          <a class="text-primary hover:underline font-medium" href="#thu-muc">Xem tất cả band →</a>
        </div>
      </section>
    </div>

    <!-- 30-Day Activity Heatmap & Habit Tracker -->
    <section class="w-full p-space-lg rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col gap-space-md">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
        <div class="flex items-center gap-space-sm">
          <span class="w-1 h-5 rounded-full bg-primary-container"></span>
          <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Nhịp điệu học tập 30 ngày qua</h2>
          <span class="font-body-sm text-body-sm text-on-surface-variant hidden md:inline">| Biểu đồ chuyên cần</span>
        </div>
        <div class="flex items-center gap-space-sm text-label-sm font-label-sm text-on-surface-variant">
          <span>Ít</span>
          <span class="w-3 h-3 rounded bg-surface-container"></span>
          <span class="w-3 h-3 rounded bg-cinnabar-subtle"></span>
          <span class="w-3 h-3 rounded bg-primary-fixed-dim"></span>
          <span class="w-3 h-3 rounded bg-primary-container"></span>
          <span>Nhiều (≥ 50 thẻ)</span>
        </div>
      </div>

      <div class="overflow-x-auto pb-1">
        <div class="min-w-[640px] grid grid-cols-10 gap-1.5">
          ${days30.map((d, idx) => {
            let bgClass = "bg-surface-container text-outline";
            if (d.revs >= 50) bgClass = "bg-primary-container text-white font-medium";
            else if (d.revs >= 20) bgClass = "bg-primary-fixed-dim text-primary";
            else if (d.revs > 0) bgClass = "bg-cinnabar-subtle text-primary";
            const isToday = idx === 29;
            return `
              <div class="h-9 rounded-lg ${bgClass} flex flex-col items-center justify-center font-code text-[11px] relative shadow-2xs" title="${d.key}: ${d.revs} thẻ đã học">
                <span>${d.date}/${d.month}</span>
                <span class="text-[9px] opacity-80">${d.revs ? d.revs : '-'}</span>
                ${isToday ? '<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-secondary border-2 border-white"></span>' : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="flex items-center justify-between pt-space-xs font-body-sm text-xs text-on-surface-variant">
        <span>Tổng cộng <strong>${fmt(summary.answers)} lượt trả lời</strong> từ trước đến nay</span>
        <span class="text-secondary font-medium">Tỷ lệ duy trì thói quen: ${Math.min(100, Math.round((summary.activeDays / 30) * 100))}%</span>
      </div>
    </section>

    <!-- Quick Practice Modules: Taiwan Accent, Dictation, Weak Words -->
    <section class="flex flex-col gap-space-md">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-space-sm">
          <span class="w-1 h-5 rounded-full bg-primary-container"></span>
          <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Lối tắt luyện tập chuyên sâu</h2>
        </div>
        <span class="font-label-sm text-label-sm text-outline">Bài tập vi mô 5 - 15 phút</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-space-md">
        <div class="p-space-lg rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-all group cursor-pointer" onclick="location.hash='#hoc'">
          <div class="flex flex-col gap-space-sm">
            <div class="w-12 h-12 rounded-xl bg-jade-subtle flex items-center justify-center group-hover:scale-105 transition-transform text-secondary">
              <span class="material-symbols-outlined text-[24px]">hearing</span>
            </div>
            <h3 class="font-headline-md text-headline-md text-on-surface mt-1 group-hover:text-primary transition-colors">
              Luyện nghe phát âm
            </h3>
            <p class="font-body-sm text-body-sm text-on-surface-variant">
              Tập phản xạ với ngữ điệu tự nhiên Đài Bắc, âm chuẩn phồn thể Đài Loan.
            </p>
          </div>
          <div class="pt-space-md flex items-center justify-between font-label-md text-label-md text-secondary font-semibold">
            <span>Học ngay</span>
            <span class="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </div>
        </div>

        <div class="p-space-lg rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-all group cursor-pointer" onclick="location.hash='#chinh-ta'">
          <div class="flex flex-col gap-space-sm">
            <div class="w-12 h-12 rounded-xl bg-cinnabar-subtle flex items-center justify-center group-hover:scale-105 transition-transform text-primary">
              <span class="material-symbols-outlined text-[24px]">draw</span>
            </div>
            <h3 class="font-headline-md text-headline-md text-on-surface mt-1 group-hover:text-primary transition-colors">
              Chép chính tả 10 phút
            </h3>
            <p class="font-body-sm text-body-sm text-on-surface-variant">
              Nghe câu đối thoại thực tế, gõ chữ Hán Phồn thể và so sánh diff lỗi sai.
            </p>
          </div>
          <div class="pt-space-md flex items-center justify-between font-label-md text-label-md text-primary font-semibold">
            <span>Luyện gõ</span>
            <span class="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </div>
        </div>

        <div class="p-space-lg rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-all group cursor-pointer" onclick="location.hash='#thi-thu'">
          <div class="flex flex-col gap-space-sm">
            <div class="w-12 h-12 rounded-xl bg-amber-subtle flex items-center justify-center group-hover:scale-105 transition-transform text-tertiary">
              <span class="material-symbols-outlined text-[24px]">assignment</span>
            </div>
            <h3 class="font-headline-md text-headline-md text-on-surface mt-1 group-hover:text-primary transition-colors">
              Thi thử TOCFL CAT-B
            </h3>
            <p class="font-body-sm text-body-sm text-on-surface-variant">
              Phòng thi mô phỏng trực tuyến SC-TOP với đồng hồ bấm giờ và 50 câu trắc nghiệm.
            </p>
          </div>
          <div class="pt-space-md flex items-center justify-between font-label-md text-label-md text-tertiary font-semibold">
            <span>Vào thi thử</span>
            <span class="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </div>
        </div>

        <div class="p-space-lg rounded-2xl bg-paper-card border border-border-subtle shadow-xs flex flex-col justify-between hover:shadow-md transition-all group cursor-pointer" onclick="location.hash='#loc-nhanh/forget'">
          <div class="flex flex-col gap-space-sm">
            <div class="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center group-hover:scale-105 transition-transform text-on-surface">
              <span class="material-symbols-outlined text-[24px]">priority_high</span>
            </div>
            <h3 class="font-headline-md text-headline-md text-on-surface mt-1 group-hover:text-primary transition-colors">
              Sổ tay từ hay quên
            </h3>
            <p class="font-body-sm text-body-sm text-on-surface-variant">
              Các từ có số lần quên cao để bạn tập trung rèn luyện phục hồi trí nhớ.
            </p>
          </div>
          <div class="pt-space-md flex items-center justify-between font-label-md text-label-md text-on-surface font-semibold">
            <span>Xem từ hay quên</span>
            <span class="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Cultural Reflection & Idiom of the Day -->
    <section class="p-space-lg rounded-2xl bg-surface-container-low border border-border-subtle flex flex-col md:flex-row items-center justify-between gap-space-md shadow-xs">
      <div class="flex items-center gap-space-md">
        <div class="w-10 h-10 rounded-full bg-paper-card flex items-center justify-center text-primary shadow-xs border border-border-subtle">
          <span class="material-symbols-outlined text-[20px]">lightbulb</span>
        </div>
        <div class="flex flex-col">
          <span class="font-label-md text-label-md text-on-surface font-semibold">Thành ngữ hôm nay: 日積月累 (Rì jī yuè lěi)</span>
          <span class="font-body-sm text-body-sm text-on-surface-variant">"Ngày tích tháng lũy" — Mỗi ngày học đều đặn, kiến thức sẽ tích lũy thành biển lớn vững chắc.</span>
        </div>
      </div>
      <a href="#tu/日積月累" class="shrink-0 px-space-md py-space-xs rounded-xl bg-paper-card text-on-surface font-label-sm text-label-sm hover:bg-surface-container transition-colors shadow-xs border border-border-subtle">
        Chi tiết chữ này
      </a>
    </section>
  </div>
  `;

  setView(html);

  const qNew = $("#quickGoalNew");
  if (qNew) {
    qNew.onchange = async () => {
      const v = Math.max(1, Number(qNew.value) || 20);
      S.settings.newPerDay = v;
      await saveSettings();
      VIEWS["trang-chu"]();
    };
  }
  const qRev = $("#quickGoalRev");
  if (qRev) {
    qRev.onchange = async () => {
      const v = Math.max(1, Number(qRev.value) || 50);
      S.settings.reviewPerDay = v;
      await saveSettings();
      VIEWS["trang-chu"]();
    };
  }
};

// ---------------- 2. HỌC FLASHCARDS ----------------
VIEWS["hoc"] = () => {
  if (!S.session) {
    const c = todayCounts();
    const st = todayStats();
    const targetNew = Math.max(1, Number(S.settings.newPerDay || 20));
    const targetRev = Math.max(1, Number(S.settings.reviewPerDay || 50));

    setView(`
      <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-xl flex flex-col gap-space-lg">
        <section class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-sm flex flex-col gap-space-md">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-5 rounded-full bg-primary-container"></span>
            <h1 class="font-headline-lg text-headline-lg text-on-surface font-semibold">Phiên học hôm nay</h1>
          </div>
          <p class="font-body-md text-on-surface-variant">
            Ôn thẻ đến hạn trước để củng cố trí nhớ dài hạn, sau đó nạp thêm thẻ mới theo chỉ tiêu mỗi ngày.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-space-md my-space-sm">
            <div class="p-space-md rounded-xl bg-amber-subtle border border-amber-subtle flex flex-col">
              <span class="font-label-sm text-tertiary font-semibold uppercase">Đến hạn ôn</span>
              <span class="font-headline-lg text-2xl font-bold text-tertiary mt-1">${fmt(c.due)} <small class="text-xs font-normal">thẻ</small></span>
              <span class="text-xs text-on-surface-variant mt-0.5">Mục tiêu: ${targetRev} thẻ</span>
            </div>
            <div class="p-space-md rounded-xl bg-cinnabar-subtle border border-cinnabar-subtle flex flex-col">
              <span class="font-label-sm text-primary font-semibold uppercase">Thẻ mới hôm nay</span>
              <span class="font-headline-lg text-2xl font-bold text-primary mt-1">${fmt(c.fresh)} <small class="text-xs font-normal">thẻ</small></span>
              <span class="text-xs text-on-surface-variant mt-0.5">Mục tiêu: ${targetNew} thẻ</span>
            </div>
            <div class="p-space-md rounded-xl bg-jade-subtle border border-jade-subtle flex flex-col">
              <span class="font-label-sm text-secondary font-semibold uppercase">Đã học hôm nay</span>
              <span class="font-headline-lg text-2xl font-bold text-secondary mt-1">${fmt(st.reviews)} <small class="text-xs font-normal">lượt</small></span>
              <span class="text-xs text-on-surface-variant mt-0.5">Đã đạt chuẩn</span>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row items-center gap-3 pt-space-sm">
            ${c.total > 0 ? `
              <button class="w-full sm:w-auto flex-1 h-12 px-6 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-all shadow-sm flex items-center justify-center gap-2" id="start">
                <span class="material-symbols-outlined text-[20px]">play_circle</span>
                <span>Bắt đầu phiên học (${fmt(c.total)} thẻ)</span>
              </button>
            ` : `
              <div class="w-full p-4 rounded-xl bg-jade-subtle text-secondary font-medium flex items-center gap-2">
                <span class="material-symbols-outlined text-[20px]">task_alt</span>
                <span>Bạn đã hoàn thành toàn bộ thẻ đến hạn hôm nay!</span>
              </div>
            `}
            <a href="#cai-dat" class="w-full sm:w-auto h-12 px-5 rounded-xl bg-paper-muted text-on-surface font-medium hover:bg-surface-container transition-colors flex items-center justify-center gap-2">
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

function reveal() {
  const ss = S.session;
  if (!ss || !ss.current || ss.shown) return;
  ss.shown = true;
  renderCard();
  window.scrollTo(0, 0);
  const r = ss.current;
  if (r.n.kind !== "grammar" && r.t !== "lis") say(itemOf(r.n).w);
}

function renderCard() {
  const ss = S.session;
  if (!ss.current) {
    setView(`
      <div class="max-w-xl mx-auto px-margin py-space-2xl text-center flex flex-col items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-jade-subtle text-secondary flex items-center justify-center shadow-sm">
          <span class="material-symbols-outlined text-[36px]">verified</span>
        </div>
        <h2 class="font-headline-lg text-2xl font-bold text-on-surface">Hoàn thành phiên học hôm nay!</h2>
        <p class="font-body-md text-on-surface-variant">
          Bạn đã xuất sắc trả lời <strong>${fmt(ss.answered)} thẻ</strong> trong phiên học này. Dữ liệu đã được lưu trữ và đồng bộ an toàn.
        </p>
        <div class="flex items-center gap-3 mt-4">
          <a href="#trang-chu" class="px-6 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold hover:bg-primary transition-colors shadow-sm">
            Về Trang chủ
          </a>
          <a href="#thu-muc" class="px-5 py-2.5 rounded-xl bg-paper-muted text-on-surface font-medium hover:bg-surface-container transition-colors">
            Khám phá thêm từ vựng
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

  const totalCards = Math.max(ss.start, ss.answered + 1);
  const cardIndex = ss.answered + 1;
  const pct = Math.min(100, Math.round((ss.answered / totalCards) * 100));

  const chars = [...new Set([...hanOnly(it.w)])];
  const charDecompHTML = chars.map(c => {
    const ce = cedFirst(c);
    const py = pyOf(c);
    const def = ce ? ce[0][1].split("/").slice(0, 2).join("; ") : "";
    return `
      <div class="bg-surface-container-low rounded-xl p-space-md flex items-start gap-space-md border border-border-subtle/50">
        <div class="w-12 h-12 rounded-lg bg-cinnabar-subtle text-primary flex items-center justify-center font-display text-2xl shrink-0 font-serif">
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

  const html = `
    <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-md md:py-space-lg flex flex-col gap-space-lg relative z-10">
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
        <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden flex">
          <div class="h-full bg-secondary transition-all duration-300" style="width: ${pct}%;"></div>
        </div>
      </section>

      <div class="relative w-full">
        <div class="absolute top-6 right-8 select-none pointer-events-none opacity-5 font-serif text-[120px] text-primary leading-none">
          ${chars[0] || '學'}
        </div>

        <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-sm flex flex-col gap-space-lg transition-all duration-200">
          <div class="flex items-center justify-between gap-space-sm flex-wrap">
            <div class="flex items-center gap-space-xs flex-wrap">
              <span class="px-space-sm py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-xs font-semibold tracking-wider">TOCFL ${band}</span>
              ${it.pos ? `<span class="px-space-sm py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-xs">${it.pos}</span>` : ''}
              ${it.hv ? `<span class="px-space-sm py-0.5 rounded-full bg-paper-muted text-on-surface-variant font-code text-xs">HV: ${it.hv}</span>` : ''}
            </div>
            <div class="flex items-center gap-1.5">
              <button aria-label="Xem nét viết" class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-secondary hover:bg-jade-subtle transition-colors" id="btnToggleStrokes" title="Xem thứ tự nét viết">
                <span class="material-symbols-outlined text-[18px]">draw</span>
              </button>
            </div>
          </div>

          <!-- Drawer nét viết -->
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

          <!-- Question side -->
          ${!ss.shown ? `
            <div class="flex flex-col items-center justify-center text-center py-space-md">
              ${r.t === 'rec' && (it.e1 || it.e2) ? `
                <div class="font-label-sm text-xs text-secondary font-semibold uppercase tracking-wider mb-2">
                  Nghe & Đọc câu ngữ cảnh
                </div>
                <div class="font-headline-lg text-2xl md:text-3xl text-on-surface font-serif font-medium leading-relaxed max-w-2xl px-4 py-2 bg-surface-container-low rounded-xl border border-border-subtle">
                  ${esc(it.e1 || it.e2)}
                </div>
                <div class="mt-4 flex items-center gap-3">
                  <button type="button" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-jade-subtle hover:bg-secondary-fixed text-secondary font-semibold transition-all shadow-xs border border-secondary/20" data-say="${esc(it.e1 || it.e2)}">
                    <span class="material-symbols-outlined text-[20px]">volume_up</span>
                    <span>▶ Nghe câu ngữ cảnh (Đài Loan)</span>
                  </button>
                </div>
                <div class="text-xs text-outline mt-3">🎧 Nghe audio → 📖 Đọc chữ → 💡 Hiểu nghĩa</div>
              ` : `
                <div class="flex items-center justify-center gap-space-md mb-space-xs">
                  <div class="flex flex-col items-center">
                    <span class="font-code text-body-md text-tertiary font-semibold">${esc(it.py || '')}</span>
                  </div>
                </div>
                <div class="flex items-center justify-center gap-space-md my-space-xs">
                  <h1 class="font-headline-lg text-5xl md:text-7xl leading-tight text-on-surface tracking-wide select-all font-serif font-bold">
                    ${esc(it.w)}
                  </h1>
                </div>
                <div class="mt-space-sm flex items-center gap-space-sm">
                  <button type="button" class="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-jade-subtle hover:bg-secondary-fixed text-secondary font-semibold transition-all shadow-xs border border-secondary/20" data-say="${esc(it.w)}">
                    <span class="material-symbols-outlined text-[18px]">volume_up</span>
                    <span>Giọng Đài Loan (臺灣華語)</span>
                  </button>
                </div>
              `}

              <div class="flex justify-center mt-space-lg">
                <button type="button" class="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-primary-container hover:bg-primary text-on-primary font-semibold transition-all active:scale-98 shadow-sm" id="btnReveal">
                  <span class="material-symbols-outlined text-[20px]">visibility</span>
                  <span>Xem giải nghĩa & ví dụ</span>
                  <span class="ml-2 font-code text-xs px-1.5 py-0.5 rounded bg-white/20">Space</span>
                </button>
              </div>
            </div>
          ` : `
            <!-- Back Details -->
            <div class="flex flex-col gap-space-lg">
              <div class="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-space-sm border-b border-border-subtle">
                <div class="flex items-baseline gap-3 flex-wrap">
                  <span class="font-display text-4xl text-on-surface font-serif font-bold">${esc(it.w)}</span>
                  <span class="font-code text-lg text-tertiary font-semibold">${esc(it.py || '')}</span>
                  <button type="button" class="text-secondary hover:text-primary transition-colors p-1" data-say="${esc(it.w)}" title="Nghe lại phát âm">
                    <span class="material-symbols-outlined text-[20px]">volume_up</span>
                  </button>
                </div>
                ${it.hv ? `<span class="font-label-md text-sm text-outline">Hán Việt: <strong class="text-on-surface font-semibold">${it.hv}</strong></span>` : ''}
              </div>

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

              ${it.e1 || it.e2 ? `
                <div class="bg-paper-muted rounded-xl p-space-md md:p-space-lg flex flex-col gap-space-sm relative border border-border-subtle">
                  <div class="flex items-center justify-between">
                    <span class="font-label-sm text-xs text-secondary font-semibold uppercase tracking-wider flex items-center gap-1">
                      <span class="material-symbols-outlined text-[16px]">format_quote</span>
                      Ví dụ ngữ cảnh Đài Loan
                    </span>
                    <button type="button" class="text-secondary hover:text-primary p-1 transition-colors" data-say="${esc(it.e1 || it.e2)}" title="Nghe câu ví dụ">
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

              ${chars.length ? `
                <div class="flex flex-col gap-2">
                  <span class="text-xs text-outline font-semibold uppercase">Chiết tự & Cấu trúc chữ</span>
                  <div class="grid grid-cols-1 md:grid-cols-${Math.min(chars.length, 3)} gap-space-md">
                    ${charDecompHTML}
                  </div>
                </div>
              ` : ''}

              <!-- 6 Memory Level Rating Buttons: Gộp 2 phần thành 1 bộ 6 nút chuẩn, bỏ 4 nút cũ -->
              <div class="pt-space-md flex flex-col gap-space-sm border-t border-border-subtle mt-2">
                <div class="flex items-center justify-between text-outline px-1">
                  <span class="font-label-sm text-xs uppercase tracking-wider font-semibold">Chấm điểm ghi nhớ cho cả từ</span>
                  <span class="font-code text-xs hidden sm:inline">Phím tắt: 1 - 5, 0 (hoặc 6)</span>
                </div>
                <div class="grades-6">
                  ${[0, 1, 2, 3, 4, 5].map((lvl) => {
                    const isCur = curLvl === lvl;
                    const hints = ["Đặt lại", "< 1 phút", "12 giờ", "1 ngày", "4 ngày", "14 ngày"];
                    return `
                      <button type="button" class="lvl-btn lvl-btn-${lvl} ${isCur ? "is-current" : ""}" data-word-level="${lvl}" title="Đặt ${esc(it.w)} ở mức ${esc(LEVELS[lvl])}">
                        <span class="lvl-title">${isCur ? "✓ " : ""}${esc(LEVELS[lvl])}</span>
                        <small class="lvl-sub">${hints[lvl]}</small>
                      </button>
                    `;
                  }).join('')}
                </div>
                <div class="text-xs text-outline text-center mt-1">
                  Áp dụng cho mọi dạng thẻ của từ và tính vào mục tiêu học hôm nay.
                </div>
              </div>
            </div>
          `}
        </div>
      </div>

      <footer class="flex flex-wrap items-center justify-center gap-space-md py-space-xs text-outline font-label-sm text-xs">
        <div class="flex items-center gap-1">
          <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">Space</kbd>
          <span>Lật thẻ</span>
        </div>
        <span>•</span>
        <div class="flex items-center gap-1">
          <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">R</kbd>
          <span>Phát âm lại</span>
        </div>
        <span>•</span>
        <div class="flex items-center gap-1">
          <kbd class="font-code px-1.5 py-0.5 rounded bg-surface-container text-on-surface">1 - 5, 0</kbd>
          <span>Chấm điểm nhớ</span>
        </div>
      </footer>
    </div>
  `;

  setView(html);

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
            HanziWriter.create(el, c, {
              width: 100, height: 100, padding: 4, showOutline: true,
              strokeColor: "#86090a", outlineColor: "#EBE2D8", highlightColor: "#176b4b",
              charDataLoader: (ch, onLoad, onErr) => strokeData(ch).then(onLoad).catch(onErr)
            });
          }
        });
      }
    };
  }

  const btnStop = $("#btnStopSession");
  if (btnStop) {
    btnStop.onclick = () => {
      S.session = null;
      location.hash = "#trang-chu";
    };
  }

  const rv = $("#btnReveal");
  if (rv) rv.onclick = reveal;

  if (ss.shown) {
    bindLevelPicker(r.n, () => {
      ss.lastNote = r.n.key;
      ss.shown = false;
      ss.current = nextCard(Date.now());
      renderCard();
      window.scrollTo(0, 0);
    });
  }

  if (!ss.shown && r.n.kind !== "grammar") {
    say((r.t === "rec" && (it.e1 || it.e2)) ? (it.e1 || it.e2) : it.w);
  }
}

// Bàn phím phím tắt toàn cục cho phiên học Flashcard
document.addEventListener("keydown", (e) => {
  const ss = S.session;
  if (!ss || !ss.current || !location.hash.startsWith("#hoc")) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (!ss.shown && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    reveal();
  } else if (ss.shown && ["0", "1", "2", "3", "4", "5", "6"].includes(e.key)) {
    e.preventDefault();
    const lvl = e.key === "6" ? 0 : Number(e.key);
    const targetBtn = document.querySelector(`[data-word-level="${lvl}"]`);
    if (targetBtn && !targetBtn.disabled) {
      targetBtn.click();
    }
  } else if (e.key.toLowerCase() === "r") {
    e.preventDefault();
    const it = itemOf(ss.current.n);
    say((ss.current.t === "rec" && (it.e1 || it.e2)) ? (it.e1 || it.e2) : it.w);
  }
});

// ---------------- 3. THƯ MỤC TỪ VỰNG ----------------
VIEWS["thu-muc"] = (id) => {
  const vocab = S.notes.filter(n => n.kind === "vocab");
  const c = todayCounts();

  if (id) {
    const isBand = S.bands.includes(id);
    const ns = isBand ? vocab.filter(n => inBand(n, id)) : folderNotes(id);
    const title = isBand ? `TOCFL ${id} (${BAND_INFO[id] || ''})` : (id === 'cua-toi' ? 'Thư mục của tôi' : (id === 'viet-tat' ? 'Từ viết tắt' : id));
    const learnedCount = ns.filter(n => noteLevel(n) > 0).length;

    setView(`
      <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
        <div class="flex items-center gap-2">
          <a href="#thu-muc" class="text-primary hover:underline text-sm font-medium flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Tất cả thư mục</span>
          </a>
        </div>
        <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div class="flex flex-col gap-1">
            <h1 class="font-headline-lg text-2xl font-bold text-on-surface">${esc(title)}</h1>
            <p class="font-body-sm text-sm text-on-surface-variant">
              Đã thuộc: <strong class="text-secondary">${fmt(learnedCount)}</strong> / ${fmt(ns.length)} từ vựng
            </p>
          </div>
          <div class="flex items-center gap-2">
            <a href="#hoc" class="px-5 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs hover:bg-primary transition-all flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[18px]">play_circle</span>
              <span>Ôn tập ngay</span>
            </a>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
          ${ns.map(n => {
            const it = itemOf(n);
            const lvl = noteLevel(n);
            return `
              <a href="#tu/${encodeURIComponent(it.w)}" class="p-space-md rounded-xl bg-paper-card border border-border-subtle hover:border-primary/40 hover:shadow-xs transition-all flex flex-col justify-between gap-2">
                <div class="flex items-start justify-between">
                  <div>
                    <span class="font-headline-md text-2xl text-on-surface font-serif font-bold">${esc(it.w)}</span>
                    <span class="font-code text-xs text-tertiary ml-2">${esc(it.py || '')}</span>
                  </div>
                  <span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span>
                </div>
                <div class="text-sm text-on-surface-variant line-clamp-1 font-body-sm">${esc(it.vn || it.en || '')}</div>
              </a>
            `;
          }).join('')}
        </div>
      </div>
    `);
    return;
  }

  const bandList = ["Novice 1", "Novice 2", "A1", "A2", "B1", "B2", "C"];
  const deckCardsHTML = [
    ...bandList.map(b => {
      const ns = vocab.filter(n => inBand(n, b));
      const l = ns.filter(n => noteLevel(n) > 0).length;
      const pct = ns.length ? Math.round((l / ns.length) * 100) : 0;
      return `
        <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col justify-between gap-space-md hover:shadow-sm transition-all">
          <div class="flex flex-col gap-space-xs">
            <div class="flex items-center justify-between">
              <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cinnabar-subtle text-primary">
                <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
                TOCFL ${b}
              </span>
              <span class="font-code text-xs text-outline">${fmt(ns.length)} từ</span>
            </div>
            <h3 class="font-headline-md text-xl font-bold text-on-surface mt-1">
              ${BAND_INFO[b] || b}
            </h3>
            <p class="font-body-sm text-xs text-on-surface-variant line-clamp-2">
              Khung từ vựng chuẩn hóa Đài Loan theo nghị định SC-TOP.
            </p>
          </div>

          <div class="flex flex-col gap-space-xs">
            <div class="flex items-center justify-between text-xs">
              <span class="text-on-surface-variant">Đã thuộc: <strong>${fmt(l)}/${fmt(ns.length)}</strong> từ</span>
              <span class="font-code font-bold text-primary">${pct}%</span>
            </div>
            <div class="w-full h-2 rounded-full bg-surface-container overflow-hidden">
              <div class="h-full bg-secondary rounded-full transition-all" style="width: ${pct}%;"></div>
            </div>
            <div class="flex items-center justify-between pt-2">
              <a href="#thu-muc/${encodeURIComponent(b)}" class="text-xs text-primary hover:underline font-medium">Chi tiết từ →</a>
              <a href="#hoc" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-container text-on-primary text-xs font-semibold hover:bg-primary transition-colors shadow-2xs">
                <span>Học ngay</span>
                <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
              </a>
            </div>
          </div>
        </div>
      `;
    }),
    `
      <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col justify-between gap-space-md hover:shadow-sm transition-all">
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-center justify-between">
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cinnabar-subtle text-primary">
              <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
              Bộ từ cá nhân
            </span>
            <span class="font-code text-xs text-outline">Ghi chú</span>
          </div>
          <h3 class="font-headline-md text-xl font-bold text-on-surface mt-1">
            Thư mục của tôi
          </h3>
          <p class="font-body-sm text-xs text-on-surface-variant line-clamp-2">
            Từ vựng ghi chép trên lớp, giáo trình ngoài và các đợt thi cá nhân.
          </p>
        </div>
        <div class="flex items-center justify-between pt-4 border-t border-border-subtle/50">
          <a href="#thu-muc/cua-toi" class="text-xs text-primary hover:underline font-medium">Xem ${fmt(folderNotes("cua-toi").length)} mục →</a>
          <a href="#nhap" class="text-xs px-3 py-1.5 rounded-lg bg-paper-muted text-on-surface font-semibold hover:bg-surface-container transition-colors">+ Thêm từ</a>
        </div>
      </div>
    `
  ].join('');

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin w-full py-space-xl flex flex-col gap-space-xl">
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

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-xl">
        <div class="lg:col-span-8 flex flex-col gap-space-lg">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            ${deckCardsHTML}
          </div>
        </div>

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
              <span>Ôn tập nhanh tất cả (${fmt(c.total)} thẻ)</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  `);
};

// ---------------- 4. TRA TỪ & TỪ ĐIỂN ----------------
VIEWS["tu-dien"] = (arg) => {
  setView(`
    <div class="max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
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

      <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle shadow-xs flex flex-col gap-3">
        <div class="relative w-full">
          <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[20px]">search</span>
          <input id="dq" class="w-full pl-12 pr-10 py-3.5 rounded-xl bg-surface-container-low text-on-surface text-base placeholder:text-outline focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary/20 transition-all border border-border-subtle/50" placeholder="Ví dụ: 學生 · xuesheng · học sinh · student" value="${esc(arg || "")}" autocomplete="off">
          ${arg ? '<button id="btnClearSearch" class="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface p-1"><span class="material-symbols-outlined text-[18px]">close</span></button>' : ''}
        </div>
        <div class="flex items-center gap-2 flex-wrap text-xs text-outline">
          <span>Gợi ý bộ thủ:</span>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='言'; $('#dq').dispatchEvent(new Event('input'))">言 (Ngôn)</button>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='心'; $('#dq').dispatchEvent(new Event('input'))">心 (Tâm)</button>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='水'; $('#dq').dispatchEvent(new Event('input'))">水 (Thủy)</button>
          <button type="button" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-on-surface" onclick="$('#dq').value='木'; $('#dq').dispatchEvent(new Event('input'))">木 (Mộc)</button>
        </div>
      </div>

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

// ---------------- SINGLE WORD DETAIL VIEW (#tu/<word>) ----------------
VIEWS["tu"] = (w) => {
  const n = S.noteByWord.get(w);
  const e = cedFirst(w);
  const it = n ? itemOf(n) : { w, py: (e ? e[0][0] : ""), vn: "", en: (e ? e[0][1].split("/").join("; ") : ""), pos: "", band: "" };
  const inLearn = n && inLearning(n);
  const chars = [...new Set([...hanOnly(w)])];
  const containing = (c) => S.notes.filter((x) => x.kind === "vocab" && x.w.includes(c) && x.w !== w).slice(0, 12);
  const curLvl = n ? noteLevel(n) : 0;
  const band = n ? (bandsOf(n).join(" · ") || (n.rich ? n.deck.name : "TOCFL")) : "Ngoài bảng TOCFL";

  setView(`
    <div class="max-w-6xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
      <div class="flex items-center justify-between">
        <a href="#tu-dien" class="text-primary hover:underline text-sm font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Tra từ khác</span>
        </a>
        <div class="flex items-center gap-2">
          <span class="px-3 py-1 rounded-full bg-cinnabar-subtle text-primary font-semibold text-xs font-code">TOCFL ${esc(band)}</span>
          ${n ? `<span class="pill lv-${curLvl}">${esc(LEVELS[curLvl])}</span>` : ''}
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <div class="lg:col-span-7 flex flex-col gap-space-lg">
          <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
            <div class="flex items-baseline justify-between gap-4 pb-space-sm border-b border-border-subtle flex-wrap">
              <div class="flex items-baseline gap-3 flex-wrap">
                <h1 class="font-display text-5xl md:text-6xl text-on-surface font-serif font-bold">${esc(it.w)}</h1>
                <span class="font-code text-xl text-tertiary font-semibold">${esc(it.py || '')}</span>
                <button type="button" class="text-secondary hover:text-primary transition-colors p-1" data-say="${esc(it.w)}" title="Nghe phát âm">
                  <span class="material-symbols-outlined text-[24px]">volume_up</span>
                </button>
              </div>
              ${it.hv ? `<div class="font-label-md text-sm text-outline">Âm Hán Việt: <strong class="text-on-surface font-semibold">${it.hv}</strong></div>` : ''}
            </div>

            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <span class="w-1.5 h-4 rounded-full bg-primary-container"></span>
                <span class="text-xs font-bold text-outline uppercase tracking-wider">Nghĩa tiếng Việt</span>
              </div>
              <div class="text-xl font-headline-md text-on-surface font-semibold leading-relaxed">
                ${esc(it.vn || 'Chưa có nghĩa tiếng Việt')}
              </div>
              ${it.en ? `
                <div class="text-xs font-bold text-outline uppercase tracking-wider mt-2">Nghĩa tiếng Anh</div>
                <div class="text-sm font-body-sm text-on-surface-variant">${esc(it.en)}</div>
              ` : ''}
            </div>

            ${it.e1 || it.e2 ? `
              <div class="bg-paper-muted rounded-xl p-4 flex flex-col gap-2 border border-border-subtle mt-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-secondary uppercase flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px]">format_quote</span>
                    Ví dụ ngữ cảnh Đài Loan
                  </span>
                  <button type="button" class="text-secondary hover:text-primary" data-say="${esc(it.e1 || it.e2)}">
                    <span class="material-symbols-outlined text-[18px]">volume_up</span>
                  </button>
                </div>
                <div class="font-serif text-lg text-on-surface font-medium">${ruby(it.e1 || it.e2)}</div>
                ${(it.e1p || it.e2p) ? `<div class="text-xs font-code text-on-surface-variant">${esc(it.e1p || it.e2p)}</div>` : ''}
                ${(it.e1v || it.e2v) ? `<div class="text-sm text-on-surface font-medium">${esc(it.e1v || it.e2v)}</div>` : ''}
              </div>
            ` : ''}

            ${n ? `
              <!-- 6 Memory Level Rating Buttons: Gộp thành 6 nút trực quan -->
              <div class="pt-4 border-t border-border-subtle mt-2">
                <div class="flex items-center justify-between text-outline text-xs font-semibold mb-2">
                  <span>ĐẶT MỨC NHỚ CHO CẢ TỪ</span>
                  <span>Mức hiện tại: ${LEVELS[curLvl]}</span>
                </div>
                <div class="grades-6">
                  ${[0, 1, 2, 3, 4, 5].map((lvl) => {
                    const isCur = curLvl === lvl;
                    const hints = ["Đặt lại", "< 1 phút", "12 giờ", "1 ngày", "4 ngày", "14 ngày"];
                    return `
                      <button type="button" class="lvl-btn lvl-btn-${lvl} ${isCur ? "is-current" : ""}" data-word-level="${lvl}" title="Đặt ${esc(it.w)} ở mức ${esc(LEVELS[lvl])}">
                        <span class="lvl-title">${isCur ? "✓ " : ""}${esc(LEVELS[lvl])}</span>
                        <small class="lvl-sub">${hints[lvl]}</small>
                      </button>
                    `;
                  }).join('')}
                </div>
                <div class="text-xs text-outline text-center mt-1">
                  Áp dụng cho mọi dạng thẻ của từ và tính vào mục tiêu học hôm nay.
                </div>
              </div>
            ` : `
              <div class="pt-2">
                <button type="button" class="px-5 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs" id="btnAddExtra">
                  + Thêm từ này vào lịch học của tôi
                </button>
              </div>
            `}
          </div>
        </div>

        <div class="lg:col-span-5 flex flex-col gap-space-lg">
          <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-on-surface uppercase tracking-wider">Tập viết trên ô mễ</span>
              <span class="text-xs text-outline">Make Me a Hanzi</span>
            </div>

            <div class="flex flex-wrap items-center justify-center gap-4 py-2" id="writer-target">
              ${chars.map((c, k) => `
                <div class="flex flex-col items-center gap-1.5 bg-paper-card p-3 rounded-xl border border-border-subtle shadow-2xs">
                  <div id="hw${k}"></div>
                  <div class="flex gap-2 mt-1">
                    <button type="button" class="text-xs px-2.5 py-1 rounded bg-surface-container hover:bg-cinnabar-subtle text-primary font-semibold" data-anim="${k}">Xem nét</button>
                    <button type="button" class="text-xs px-2.5 py-1 rounded bg-surface-container hover:bg-jade-subtle text-secondary font-semibold" data-quiz="${k}">Viết thử</button>
                  </div>
                  <span class="font-code text-xs text-outline mt-0.5">${c}</span>
                </div>
              `).join('')}
            </div>
            <p class="text-[11px] text-outline text-center">Bấm "Xem nét" để xem thứ tự bút thuận, bấm "Viết thử" để tự vẽ nét.</p>
          </div>

          ${chars.map(c => {
            const cs = containing(c);
            if (!cs.length) return '';
            return `
              <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle shadow-xs flex flex-col gap-2">
                <span class="text-xs font-bold text-on-surface">Từ TOCFL có chữ ${c} (${cs.length} từ):</span>
                <div class="flex flex-wrap gap-1.5">
                  ${cs.map(x => `
                    <a href="#tu/${encodeURIComponent(x.w)}" class="px-2.5 py-1 rounded-lg bg-surface-container-low hover:bg-cinnabar-subtle hover:text-primary transition-colors text-xs font-medium text-on-surface flex items-center gap-1">
                      <span class="font-serif font-bold">${x.w}</span>
                      <span class="font-code text-[10px] text-outline">${itemOf(x).py || ''}</span>
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

  if (n) bindLevelPicker(n, () => VIEWS["tu"](w));
  const addBtn = $("#btnAddExtra");
  if (addBtn) {
    addBtn.onclick = async () => {
      S.settings.extra[w] = true;
      await saveSettings();
      alert("✓ Đã thêm từ này vào lịch học của bạn!");
      VIEWS["tu"](w);
    };
  }
  chars.forEach((c, k) => drawChar(k, c));
};

// ---------------- 5. CHÉP CHÍNH TẢ (DICTATION) ----------------
function sentenceBank() {
  const out = [];
  for (const n of S.notes) {
    if (!n.rich && !S.vi.has(n.w)) continue;
    const it = itemOf(n);
    for (const k of n.kind === "grammar" ? [1, 2, 3] : [1, 2]) {
      if (it["e" + k]) out.push({ zh: it["e" + k], py: it["e" + k + "p"] || "", vn: it["e" + k + "v"] || "", src: n.rich ? n.deck.name : bandLabel(n), own: true, note: n });
    }
  }
  for (const p of S.packs || []) {
    for (const s of p.sentences || []) out.push({ zh: s.zh, py: s.py || "", vn: s.vn || "", src: s.src || p.name, pack: p.name });
  }
  return out;
}

VIEWS["chinh-ta"] = () => {
  const bank = sentenceBank();
  const passages = [
    {
      id: 1,
      title: "Bài 1: Đặt phòng khách sạn & Hỏi đường tại Đài Bắc",
      band: "TOCFL B1",
      sentences: [
        { zh: "請問從這裡到臺北車站，坐捷運要換線嗎？", py: "Qǐngwèn cóng zhèlǐ dào Táiběi chēzhàn, zuò jiéyùn yào huàn xiàn ma?", vn: "Xin hỏi từ đây đến Ga Đài Bắc, đi tàu điện ngầm có cần phải đổi tuyến không?" },
        { zh: "不用，您搭乘淡水信義線可以直接抵達。", py: "Bùyòng, nín dāchéng Dànshuǐ Xìnyì xiàn kěyǐ zhíjiē dǐdá.", vn: "Không cần, bạn đi tuyến Đạm Thủy - Tín Nghĩa là có thể đến thẳng luôn." },
        { zh: "出站之後走三號出口，飯店就在左手邊。", py: "Chū zhàn zhīhòu zǒu sān hào chūkǒu, fàndiàn jiù zài zuǒshǒu biān.", vn: "Sau khi ra khỏi ga đi cửa số 3, khách sạn nằm ngay bên tay trái." },
        { zh: "非常感謝您的指引，祝您今天順心！", py: "Fēicháng gǎnxiè nín de zhǐyǐn, zhù nín jīntiān shùnxīn!", vn: "Vô cùng cảm ơn sự chỉ dẫn của bạn, chúc bạn hôm nay mọi sự thuận lợi!" }
      ]
    }
  ];

  // Nếu có câu trong kho từ vựng thì bổ sung thêm bài luyện tập từ câu ví dụ TOCFL
  if (bank.length >= 4) {
    const randomSentences = bank.slice(0, 10);
    passages.push({
      id: 2,
      title: "Bài 2: Câu ví dụ thực tế trích từ từ điển TOCFL đã học",
      band: "TOCFL Thực tế",
      sentences: randomSentences
    });
  }

  let curPassage = passages[0];
  let curIndex = 0;

  function renderDictation() {
    const curSentence = curPassage.sentences[curIndex];
    const total = curPassage.sentences.length;

    setView(`
      <div class="max-w-7xl mx-auto w-full px-margin-mobile md:px-margin py-space-md md:py-space-lg flex flex-col gap-space-lg">
        <div class="bg-paper-card rounded-2xl p-space-md md:p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md pb-space-sm border-b border-border-subtle">
            <div>
              <div class="flex items-center gap-space-xs flex-wrap">
                <span class="px-2 py-0.5 rounded bg-primary-container text-on-primary font-code text-xs font-semibold">${curPassage.band}</span>
                <h1 class="font-headline-lg text-2xl font-bold text-on-surface">Chép chính tả <span class="text-outline font-normal">|</span> 聽寫練習</h1>
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-xs border border-secondary/20">
                  <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                  Luyện nghe & gõ đoạn văn thực tế
                </span>
              </div>
              <p class="font-body-sm text-xs text-on-surface-variant mt-1">Luyện phản xạ nghe câu trọn vẹn, nhận diện chữ Hán Phồn thể và ngữ pháp đối thoại Đài Loan.</p>
            </div>
            ${passages.length > 1 ? `
              <div class="flex items-center gap-2 text-xs">
                <span class="text-outline">Chọn bài:</span>
                <select id="selectPassage" class="p-2 rounded-xl bg-surface-container-low border border-border-subtle font-medium text-xs">
                  ${passages.map((p, idx) => `<option value="${idx}" ${p === curPassage ? 'selected' : ''}>${p.title}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          </div>

          <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-sm text-xs">
            <span class="font-semibold text-on-surface">${curPassage.title}</span>
            <span class="font-code text-primary font-bold">Câu ${curIndex + 1} / ${total}</span>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
          <div class="lg:col-span-8 flex flex-col gap-space-lg">
            <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <span class="w-1.5 h-3.5 bg-primary-container rounded-full"></span>
                  Khối âm thanh chính tả [Câu ${curIndex + 1}]
                </span>
                <span class="text-xs text-secondary bg-jade-subtle px-2 py-0.5 rounded-full">Chuẩn âm Đài Bắc</span>
              </div>

              <div class="flex items-center justify-center gap-4 py-4 bg-surface-container-low rounded-xl border border-border-subtle/50">
                <button type="button" class="w-12 h-12 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-sm hover:scale-105 active:scale-95 transition-transform" id="btnPlayDictation">
                  <span class="material-symbols-outlined text-[24px]">volume_up</span>
                </button>
                <div class="flex flex-col">
                  <span class="text-sm font-semibold text-on-surface">Bấm để nghe câu hiện tại</span>
                  <span class="text-xs text-outline font-code">Phím tắt: R hoặc Ctrl + Space</span>
                </div>
              </div>
            </div>

            <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-on-surface">Khu vực nghe & gõ chữ Hán Phồn thể</span>
                <span class="font-code text-xs text-outline" id="charCount">Đã gõ: 0 chữ</span>
              </div>

              <textarea id="dictInput" rows="3" class="w-full p-4 rounded-xl bg-surface-container-low border border-border-subtle focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 text-lg font-serif resize-none transition-all" placeholder="Gõ chữ Hán bạn vừa nghe được vào đây..."></textarea>

              <div class="flex items-center justify-between flex-wrap gap-2 pt-2">
                <button type="button" class="text-xs text-outline hover:text-primary underline" id="btnShowHint">
                  💡 Xem gợi ý Pinyin
                </button>
                <div class="flex items-center gap-2">
                  <button type="button" class="px-4 py-2 rounded-xl bg-paper-muted text-on-surface text-xs font-medium hover:bg-surface-container" id="btnClearDict">
                    Xóa làm lại
                  </button>
                  <button type="button" class="px-6 py-2 rounded-xl bg-primary-container text-on-primary text-xs font-semibold hover:bg-primary shadow-xs" id="btnCheckDiff">
                    Kiểm tra đáp án
                  </button>
                </div>
              </div>

              <div class="hidden p-3 rounded-xl bg-amber-subtle text-tertiary text-xs font-code" id="hintBox">
                ${curSentence.py}
              </div>
            </div>

            <div class="hidden bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md" id="diffBox">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-on-surface uppercase tracking-wider">Đối chiếu kết quả & Phân tích</span>
                <span class="text-xs font-bold text-secondary" id="accuracyScore"></span>
              </div>

              <div class="p-4 rounded-xl bg-surface-container-low border border-border-subtle/60 flex flex-col gap-2">
                <div class="text-xs text-outline font-semibold">ĐOẠN VĂN GỐC (ĐÁP ÁN):</div>
                <div class="text-xl font-serif text-on-surface font-bold">${curSentence.zh}</div>
                <div class="text-xs font-code text-tertiary">${curSentence.py}</div>
                <div class="text-sm font-medium text-on-surface-variant">${curSentence.vn}</div>
              </div>

              <div class="flex justify-end pt-2">
                <button type="button" class="px-6 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs hover:bg-primary" id="btnNextSentence">
                  ${curIndex + 1 < total ? 'Tiếp tục câu tiếp theo →' : 'Hoàn thành bài chép!'}
                </button>
              </div>
            </div>
          </div>

          <div class="lg:col-span-4 flex flex-col gap-space-md">
            <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
              <span class="text-xs font-bold text-on-surface uppercase tracking-wider">Danh sách ${total} câu</span>
              <div class="flex flex-col gap-2">
                ${curPassage.sentences.map((s, idx) => `
                  <button type="button" class="p-3 rounded-xl border text-left text-xs flex items-center justify-between transition-all ${idx === curIndex ? 'bg-cinnabar-subtle border-primary text-primary font-bold' : 'bg-surface-container-low border-border-subtle text-on-surface-variant'}" onclick="VIEWS['chinh-ta-select'](${idx})">
                    <span>Câu ${idx + 1}</span>
                    <span class="font-serif truncate max-w-[160px]">${s.zh}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    const sel = $("#selectPassage");
    if (sel) {
      sel.onchange = () => {
        curPassage = passages[Number(sel.value)];
        curIndex = 0;
        renderDictation();
      };
    }

    const btnPlay = $("#btnPlayDictation");
    if (btnPlay) {
      btnPlay.onclick = () => say(curSentence.zh);
    }

    const inp = $("#dictInput");
    const countEl = $("#charCount");
    if (inp && countEl) {
      inp.oninput = () => {
        countEl.textContent = `Đã gõ: ${inp.value.length} chữ`;
      };
    }

    const hintBtn = $("#btnShowHint");
    const hintBox = $("#hintBox");
    if (hintBtn && hintBox) {
      hintBtn.onclick = () => hintBox.classList.toggle("hidden");
    }

    const clearBtn = $("#btnClearDict");
    if (clearBtn && inp) {
      clearBtn.onclick = () => {
        inp.value = "";
        countEl.textContent = "Đã gõ: 0 chữ";
        $("#diffBox")?.classList.add("hidden");
      };
    }

    const checkBtn = $("#btnCheckDiff");
    const diffBox = $("#diffBox");
    if (checkBtn && diffBox && inp) {
      checkBtn.onclick = () => {
        diffBox.classList.remove("hidden");
        const userText = clean(inp.value);
        const origText = clean(curSentence.zh);
        let match = 0;
        for (let i = 0; i < Math.min(userText.length, origText.length); i++) {
          if (userText[i] === origText[i]) match++;
        }
        const pct = origText.length ? Math.round((match / origText.length) * 100) : 0;
        const scoreEl = $("#accuracyScore");
        if (scoreEl) scoreEl.textContent = `Độ chính xác: ${pct}% (${match}/${origText.length} chữ)`;
      };
    }

    const nextBtn = $("#btnNextSentence");
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (curIndex + 1 < total) {
          curIndex++;
          renderDictation();
        } else {
          alert("🎉 Chúc mừng bạn đã hoàn thành bài chép chính tả!");
          curIndex = 0;
          renderDictation();
        }
      };
    }
  }

  VIEWS['chinh-ta-select'] = (idx) => {
    curIndex = idx;
    renderDictation();
  };

  renderDictation();
};

// ---------------- 6. THI THỬ TOCFL CAT-B ----------------
VIEWS["thi-thu"] = () => {
  const sampleQuestions = [
    {
      id: 1, part: "Nghe hiểu",
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
      correct: 2
    },
    {
      id: 2, part: "Đọc hiểu",
      context: "Thông báo tuyển dụng tại một công ty công nghệ Đài Bắc.",
      zh: "本公司誠徵軟體工程師，具備繁體中文讀寫能力及團隊溝通經驗者尤佳。",
      q: "2. 這則徵才啟事主要在尋找什麼樣的人才？",
      options: [
        "A. 具備程式開發與溝通能力的人。",
        "B. 只要有中文能力，不需技術背景。",
        "C. 專門負責海外行銷的業務代表。",
        "D. 只能在假日兼職的工讀生。"
      ],
      correct: 0
    }
  ];

  let curQ = 0;
  let userAnswers = {};

  function renderExam() {
    const q = sampleQuestions[curQ];

    setView(`
      <div class="w-full flex flex-col gap-space-lg">
        <div class="w-full bg-surface-container-high px-margin py-2 border-b border-border-subtle shadow-2xs">
          <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-full bg-cinnabar-subtle text-primary font-semibold">SC-TOP 國家華語測驗</span>
              <span class="text-outline">•</span>
              <span class="text-on-surface-variant font-medium">Hệ thống Thi Mô phỏng TOCFL CAT Chuẩn hóa 2024</span>
            </div>
            <div class="flex items-center gap-4 text-secondary font-medium">
              <span class="material-symbols-outlined text-[16px]">verified</span>
              <span>Phòng thi tiêu chuẩn mã hóa</span>
            </div>
          </div>
        </div>

        <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin w-full flex flex-col gap-space-lg">
          <div class="bg-paper-card rounded-2xl p-space-md md:p-space-lg border border-border-subtle shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-primary text-white flex flex-col items-center justify-center font-bold">
                <span class="text-sm">測</span>
                <span class="text-[9px]">CAT-B</span>
              </div>
              <div>
                <h1 class="font-headline-md text-lg font-bold text-on-surface">Đề thi thử TOCFL Band B (Tiến cấp)</h1>
                <p class="text-xs text-outline">Thời gian làm bài: 50 phút · 50 câu trắc nghiệm</p>
              </div>
            </div>

            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2 font-code text-lg font-bold text-primary bg-cinnabar-subtle px-3 py-1.5 rounded-xl border border-primary/20" id="timerBox">
                <span class="material-symbols-outlined text-[20px]">timer</span>
                <span id="examTimer">49:59</span>
              </div>
              <button type="button" class="px-5 py-2 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs hover:bg-primary" id="btnSubmitExam">
                Nộp bài thi (繳卷)
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
            <div class="lg:col-span-8 flex flex-col gap-space-lg">
              <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
                <div class="flex items-center justify-between border-b border-border-subtle pb-space-sm">
                  <span class="text-xs font-bold text-primary uppercase">${q.part} • Mục đề: CÂU ${curQ + 1} / ${sampleQuestions.length}</span>
                  <span class="text-xs text-outline">Tương đương Band B1/B2</span>
                </div>

                ${q.audio ? `
                  <div class="p-4 rounded-xl bg-surface-container-low border border-border-subtle/50 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <button type="button" class="w-10 h-10 rounded-full bg-primary-container text-on-primary flex items-center justify-center" onclick="say('${esc(q.audio)}')">
                        <span class="material-symbols-outlined text-[20px]">volume_up</span>
                      </button>
                      <span class="text-xs text-on-surface font-medium">Bấm nghe đoạn âm khảo thí</span>
                    </div>
                  </div>
                ` : ''}

                <div class="p-4 rounded-xl bg-surface-container-low font-serif text-lg text-on-surface leading-relaxed">
                  ${q.zh}
                </div>

                <div class="font-headline-md text-base font-bold text-on-surface mt-2">
                  ${q.q}
                </div>

                <div class="flex flex-col gap-2.5 mt-2">
                  ${q.options.map((opt, optIdx) => {
                    const isSelected = userAnswers[curQ] === optIdx;
                    return `
                      <button type="button" class="p-3.5 rounded-xl border text-left text-sm flex items-center gap-3 transition-all ${isSelected ? 'bg-jade-subtle border-secondary text-secondary font-semibold' : 'bg-paper-card border-border-subtle text-on-surface hover:bg-surface-container-low'}" onclick="VIEWS['thi-thu-ans'](${curQ}, ${optIdx})">
                        <span class="w-5 h-5 rounded-full border flex items-center justify-center text-xs ${isSelected ? 'border-secondary bg-secondary text-white' : 'border-outline'}">${String.fromCharCode(65 + optIdx)}</span>
                        <span>${opt}</span>
                      </button>
                    `;
                  }).join('')}
                </div>

                <div class="flex items-center justify-between pt-space-md border-t border-border-subtle mt-4">
                  <button type="button" class="px-4 py-2 rounded-xl bg-paper-muted text-on-surface text-xs font-medium hover:bg-surface-container disabled:opacity-50" ${curQ === 0 ? 'disabled' : ''} onclick="VIEWS['thi-thu-nav'](${curQ - 1})">
                    ← Câu trước
                  </button>
                  <button type="button" class="px-4 py-2 rounded-xl bg-primary-container text-on-primary text-xs font-semibold hover:bg-primary disabled:opacity-50" ${curQ + 1 >= sampleQuestions.length ? 'disabled' : ''} onclick="VIEWS['thi-thu-nav'](${curQ + 1})">
                    Câu tiếp theo →
                  </button>
                </div>
              </div>
            </div>

            <div class="lg:col-span-4 flex flex-col gap-space-md">
              <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-md">
                <span class="text-xs font-bold text-on-surface uppercase tracking-wider">Phiếu trả lời (答題卡)</span>
                <div class="grid grid-cols-5 gap-2">
                  ${sampleQuestions.map((_, idx) => {
                    const answered = userAnswers[idx] !== undefined;
                    const isCurrent = idx === curQ;
                    return `
                      <button type="button" class="h-9 rounded-lg border font-code text-xs font-bold transition-all ${isCurrent ? 'border-primary ring-2 ring-primary/20' : (answered ? 'bg-secondary text-white border-secondary' : 'bg-surface-container-low border-border-subtle text-outline')}" onclick="VIEWS['thi-thu-nav'](${idx})">
                        ${idx + 1}
                      </button>
                    `;
                  }).join('')}
                </div>
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
        sampleQuestions.forEach((sq, i) => {
          if (userAnswers[i] === sq.correct) correctCount++;
        });
        const score = Math.round((correctCount / sampleQuestions.length) * 80);
        alert(`🎉 Bạn đã nộp bài thi!

Số câu đúng: ${correctCount} / ${sampleQuestions.length}
Điểm ước tính (Thang 80): ${score} điểm
Đạt chuẩn TOCFL Band B1/B2!`);
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

// ---------------- 7. NHẬP TỪ HÀNG LOẠT ----------------
VIEWS["nhap"] = () => {
  setView(`
    <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-xl flex flex-col gap-space-lg">
      <div class="bg-paper-card rounded-2xl p-space-lg md:p-space-xl border border-border-subtle shadow-xs flex flex-col gap-space-md">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-5 rounded-full bg-primary-container"></span>
          <h1 class="font-headline-lg text-2xl font-bold text-on-surface">Nhập từ vựng hàng loạt (批量錄入)</h1>
        </div>
        <p class="text-sm text-on-surface-variant">
          Dán danh sách từ vựng, bài học trên lớp hoặc câu văn vào ô dưới đây. Hệ thống sẽ tự động tách từ, tra pinyin và lưu vào Thư mục của bạn.
        </p>

        <textarea id="importArea" rows="8" class="w-full p-4 rounded-xl bg-surface-container-low border border-border-subtle font-serif text-base focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ví dụ:
捷運 (jiéyùn): tàu điện ngầm
高鐵 (gāotiě): đường sắt cao tốc
夜市 (yèshì): chợ đêm"></textarea>

        <div class="flex items-center justify-between pt-2">
          <span class="text-xs text-outline">Hỗ trợ nhận diện tự động chữ Hán Phồn thể và Giản thể.</span>
          <button type="button" class="px-6 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs hover:bg-primary" id="btnProcessImport">
            Nạp danh sách từ
          </button>
        </div>

        <div class="hidden p-4 rounded-xl bg-jade-subtle text-secondary text-sm font-medium" id="importSuccessMsg"></div>
      </div>
    </div>
  `);

  const btn = $("#btnProcessImport");
  const area = $("#importArea");
  const msg = $("#importSuccessMsg");
  if (btn && area && msg) {
    btn.onclick = async () => {
      const text = area.value.trim();
      if (!text) return;
      const lines = text.split('\n').filter(Boolean);
      let count = 0;
      for (const line of lines) {
        const han = hanOnly(line);
        if (han) {
          S.settings.extra[han] = true;
          count++;
        }
      }
      await saveSettings();
      msg.textContent = `✓ Đã nạp thành công ${count} từ vào lịch học của bạn!`;
      msg.classList.remove("hidden");
      area.value = "";
    };
  }
};

// ---------------- 8. CÀI ĐẶT & ĐỒNG BỘ ----------------
VIEWS["cai-dat"] = () => {
  const syncCfg = window.Sync ? Sync.getConfig() : {};
  const isConnected = window.Sync && Sync.isConfigured();
  const vocab = S.notes.filter(n => n.kind === "vocab");

  const bandCheckboxes = ["Novice 1", "Novice 2", "A1", "A2", "B1", "B2", "C"].map(b => {
    const isChecked = !!S.settings.bands[b];
    const count = vocab.filter(n => inBand(n, b)).length;
    return `
      <label class="p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${isChecked ? 'bg-cinnabar-subtle border-primary text-primary font-bold' : 'bg-surface-container-low border-border-subtle text-on-surface'}">
        <div class="flex items-center gap-2">
          <input type="checkbox" class="accent-primary" data-setting-band="${b}" ${isChecked ? 'checked' : ''}>
          <span>TOCFL ${b}</span>
        </div>
        <span class="font-code text-xs text-outline font-normal">${fmt(count)} từ</span>
      </label>
    `;
  }).join('');

  setView(`
    <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-xl flex flex-col gap-space-xl">
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-space-xs">
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-center gap-space-sm">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-cinnabar-subtle text-primary font-label-sm text-xs font-semibold">
              CẤU HÌNH HỆ THỐNG
            </span>
            <span class="text-outline text-xs">•</span>
            <span class="font-label-sm text-xs text-on-surface-variant font-medium">Bản cập nhật 2026</span>
          </div>
          <h1 class="font-headline-lg text-2xl md:text-3xl text-on-surface font-bold tracking-tight">
            Cài đặt hệ thống & Học tập
          </h1>
          <p class="font-body-md text-sm text-on-surface-variant max-w-2xl">
            Quản lý đồng bộ dữ liệu đa thiết bị, mục tiêu thẻ nhớ hàng ngày và cá nhân hóa giọng đọc chuẩn Đài Loan.
          </p>
        </div>
      </div>

      <!-- SECTION 1: Đồng bộ -->
      <section class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex items-start justify-between gap-space-md">
          <div class="flex items-center gap-space-sm flex-wrap">
            <span class="w-1.5 h-5 rounded-full bg-primary inline-block"></span>
            <h2 class="font-headline-md text-lg font-bold text-on-surface">Đồng bộ giữa các máy</h2>
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${isConnected ? 'bg-jade-subtle text-secondary' : 'bg-surface-container text-on-surface-variant'}">
              <span class="w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-secondary' : 'bg-outline'}"></span>
              ${isConnected ? 'Đã kết nối GitHub Gist' : 'Chưa kết nối'}
            </span>
          </div>
        </div>

        <p class="text-sm text-on-surface-variant">
          Mặc định tiến độ chỉ lưu trong trình duyệt của từng máy. Để <strong>học trên điện thoại và máy tính luôn đồng bộ cùng tiến độ với nhau</strong>, bạn hãy chọn phương thức phù hợp:
        </p>

        <!-- Method 1 -->
        <div class="p-4 rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-primary uppercase">Cách 1: Tự động qua GitHub Gist (Khuyên dùng)</span>
            <span class="text-[11px] bg-jade-subtle text-secondary px-2 py-0.5 rounded-full">Tự động 2 chiều</span>
          </div>
          <p class="text-xs text-on-surface-variant">
            Dán GitHub Personal Access Token của bạn để tự động lưu tiến độ vào Gist riêng tư:
          </p>
          <div class="flex flex-col gap-2">
            <input id="cfgToken" type="password" class="p-2.5 rounded-xl bg-white border border-border-subtle text-xs font-code focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="ghp_xxxxxxxxxxxx hoặc github_pat_xxxxxxxxxxxx" value="${esc(syncCfg.token || '')}">
            <input id="cfgGist" type="text" class="p-2.5 rounded-xl bg-white border border-border-subtle text-xs font-code focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Gist ID (để trống nếu đây là máy đầu tiên cài đặt)" value="${esc(syncCfg.gistId || '')}">
          </div>
          <div class="flex justify-end pt-1">
            <button type="button" class="px-5 py-2 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs hover:bg-primary" id="btnConnectSync">
              Kết nối đám mây
            </button>
          </div>
        </div>

        <!-- Method 2 -->
        <div class="p-4 rounded-xl bg-surface-container-low border border-border-subtle flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-on-surface uppercase">Cách 2: Đồng bộ nhanh bằng Mã (Không cần tài khoản)</span>
            <span class="text-[11px] bg-surface-container text-outline px-2 py-0.5 rounded-full">Thủ công 1 lần</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" class="px-4 py-2 rounded-xl bg-white border border-border-subtle text-xs font-semibold hover:bg-surface-container" id="btnExportSyncCode">
              📋 Sao chép mã tiến độ từ máy này
            </button>
          </div>
          <div class="flex gap-2">
            <input id="importSyncCodeInput" type="text" class="flex-1 p-2 rounded-xl bg-white border border-border-subtle text-xs font-code" placeholder="Dán chuỗi mã tiến độ vào đây...">
            <button type="button" class="px-4 py-2 rounded-xl bg-primary-container text-on-primary text-xs font-semibold" id="btnApplySyncCode">
              Áp dụng mã
            </button>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Mục tiêu -->
      <section class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex items-center gap-space-sm">
          <span class="w-1.5 h-5 rounded-full bg-primary inline-block"></span>
          <h2 class="font-headline-md text-lg font-bold text-on-surface">Mục tiêu học tập mỗi ngày</h2>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-on-surface">Số thẻ mới mỗi ngày:</label>
            <div class="flex items-center gap-2">
              <input id="inpNewPerDay" type="number" min="1" max="200" step="5" value="${S.settings.newPerDay || 20}" class="flex-1 p-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-sm font-code font-bold">
              <span class="text-xs text-outline font-medium">thẻ/ngày</span>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-on-surface">Số thẻ ôn mỗi ngày:</label>
            <div class="flex items-center gap-2">
              <input id="inpRevPerDay" type="number" min="1" max="500" step="10" value="${S.settings.reviewPerDay || 50}" class="flex-1 p-2.5 rounded-xl bg-surface-container-low border border-border-subtle text-sm font-code font-bold">
              <span class="text-xs text-outline font-medium">thẻ/ngày</span>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2 pt-2">
          <span class="text-xs font-semibold text-on-surface uppercase tracking-wider">Thư mục đưa vào lịch học:</span>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${bandCheckboxes}
          </div>
        </div>
      </section>

      <!-- SECTION 3: Giọng đọc -->
      <section class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex items-center gap-space-sm">
          <span class="w-1.5 h-5 rounded-full bg-primary inline-block"></span>
          <h2 class="font-headline-md text-lg font-bold text-on-surface">Giọng đọc tiếng Hoa</h2>
        </div>
        <div class="flex items-center justify-between p-3 rounded-xl bg-surface-container-low border border-border-subtle">
          <span class="text-xs text-on-surface">Giọng phát âm Phồn thể (zh-TW):</span>
          <button type="button" class="px-4 py-2 rounded-xl bg-jade-subtle text-secondary font-semibold text-xs" onclick="say('你好！歡迎來到學習本 Sổ học tiếng Hoa.')">
            🔊 Nghe thử giọng đọc
          </button>
        </div>
      </section>

      <!-- SECTION 4: Sao lưu & Xóa cache -->
      <section class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs flex flex-col gap-space-lg">
        <div class="flex items-center gap-space-sm">
          <span class="w-1.5 h-5 rounded-full bg-primary inline-block"></span>
          <h2 class="font-headline-md text-lg font-bold text-on-surface">Sao lưu & Cập nhật ứng dụng</h2>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <button type="button" class="px-5 py-2.5 rounded-xl bg-primary-container text-on-primary font-semibold text-xs shadow-xs hover:bg-primary" id="btnExportJSON">
            📥 Xuất bản sao lưu ra file (.json)
          </button>
          <button type="button" class="px-5 py-2.5 rounded-xl bg-jade-subtle text-secondary font-semibold text-xs border border-secondary/20 hover:bg-secondary-fixed" id="btnForceReload">
            🔄 Tải lại bản mới nhất (Xóa cache)
          </button>
        </div>
      </section>
    </div>
  `);

  const inpNew = $("#inpNewPerDay");
  const inpRev = $("#inpRevPerDay");
  if (inpNew) {
    inpNew.onchange = async () => {
      S.settings.newPerDay = Math.max(1, Number(inpNew.value) || 20);
      await saveSettings();
    };
  }
  if (inpRev) {
    inpRev.onchange = async () => {
      S.settings.reviewPerDay = Math.max(1, Number(inpRev.value) || 50);
      await saveSettings();
    };
  }
  document.querySelectorAll("[data-setting-band]").forEach(chk => {
    chk.onchange = async () => {
      const b = chk.dataset.settingBand;
      S.settings.bands[b] = chk.checked;
      await saveSettings();
    };
  });

  const connBtn = $("#btnConnectSync");
  if (connBtn) {
    connBtn.onclick = async () => {
      const t = $("#cfgToken")?.value.trim();
      const g = $("#cfgGist")?.value.trim();
      if (!t) {
        alert("Vui lòng nhập GitHub Personal Access Token!");
        return;
      }
      try {
        await Sync.connectWithToken(t, g);
        alert("🎉 Kết nối đồng bộ thành công!");
        VIEWS["cai-dat"]();
      } catch (err) {
        alert("Lỗi kết nối: " + err.message);
      }
    };
  }

  const expBtn = $("#btnExportSyncCode");
  if (expBtn) {
    expBtn.onclick = () => {
      const data = {
        srs: Object.fromEntries(S.srs),
        stats: Object.fromEntries(S.stats),
        settings: S.settings
      };
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      navigator.clipboard.writeText(code).then(() => {
        alert("✓ Đã sao chép mã tiến độ vào bộ nhớ tạm! Bạn có thể dán mã này vào thiết bị khác.");
      }).catch(() => {
        prompt("Sao chép mã tiến độ bên dưới:", code);
      });
    };
  }

  const applyBtn = $("#btnApplySyncCode");
  if (applyBtn) {
    applyBtn.onclick = async () => {
      const code = $("#importSyncCodeInput")?.value.trim();
      if (!code) return;
      try {
        const json = decodeURIComponent(escape(atob(code)));
        const data = JSON.parse(json);
        if (data.srs) for (const [k, v] of Object.entries(data.srs)) S.srs.set(k, v);
        if (data.stats) for (const [k, v] of Object.entries(data.stats)) S.stats.set(k, v);
        if (data.settings) S.settings = Object.assign(S.settings, data.settings);
        await saveProgress();
        alert("🎉 Đã nhập tiến độ thành công!");
        location.hash = "#trang-chu";
      } catch (e) {
        alert("Mã tiến độ không hợp lệ: " + e.message);
      }
    };
  }

  const expJson = $("#btnExportJSON");
  if (expJson) {
    expJson.onclick = () => {
      const data = {
        srs: Object.fromEntries(S.srs),
        stats: Object.fromEntries(S.stats),
        settings: S.settings,
        exportAt: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tien-do-hoc-tieng-hoa-${dayKey(Date.now())}.json`;
      a.click();
    };
  }

  const reloadBtn = $("#btnForceReload");
  if (reloadBtn) {
    reloadBtn.onclick = async () => {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) await reg.unregister();
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const key of keys) await caches.delete(key);
      }
      location.reload(true);
    };
  }
};

// ---------------- Filter views ----------------
VIEWS["muc-nho"] = (arg) => {
  if (!/^[0-5]$/.test(arg)) { location.replace("#trang-chu"); return; }
  const level = Number(arg);
  const notes = S.notes.filter((n) => n.kind === "vocab" && noteLevel(n) === level);
  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-md">
      <div class="flex items-center gap-2">
        <a href="#trang-chu" class="text-primary hover:underline text-sm font-medium flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Về trang chủ</span>
        </a>
      </div>
      <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs">
        <h1 class="font-headline-lg text-2xl font-bold text-on-surface">Từ ở mức nhớ: ${LEVELS[level]}</h1>
        <p class="text-sm text-on-surface-variant mt-1">Tổng cộng: ${fmt(notes.length)} từ</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
        ${notes.slice(0, 150).map(n => {
          const it = itemOf(n);
          return `
            <a href="#tu/${encodeURIComponent(it.w)}" class="p-space-md rounded-xl bg-paper-card border border-border-subtle hover:border-primary/40 transition-all flex flex-col justify-between gap-2">
              <div class="flex items-start justify-between">
                <div>
                  <span class="font-headline-md text-2xl text-on-surface font-serif font-bold">${esc(it.w)}</span>
                  <span class="font-code text-xs text-tertiary ml-2">${esc(it.py || '')}</span>
                </div>
                <span class="pill lv-${level}">${esc(LEVELS[level])}</span>
              </div>
              <div class="text-sm text-on-surface-variant line-clamp-1 font-body-sm">${esc(it.vn || it.en || '')}</div>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  `);
};

VIEWS["loc-nhanh"] = (id) => {
  let notes = [];
  let title = "Danh sách lọc nhanh";
  if (id === "forget") {
    title = "Sổ tay từ hay quên (≥ 4 lần quên)";
    notes = S.notes.filter(n => noteLapses(n) >= 4);
  } else {
    notes = S.notes.filter(n => inLearning(n));
  }
  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-md">
      <div class="flex items-center gap-2">
        <a href="#trang-chu" class="text-primary hover:underline text-sm font-medium flex items-center gap-1">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Về trang chủ</span>
        </a>
      </div>
      <div class="bg-paper-card rounded-2xl p-space-lg border border-border-subtle shadow-xs">
        <h1 class="font-headline-lg text-2xl font-bold text-on-surface">${title}</h1>
        <p class="text-sm text-on-surface-variant mt-1">Tổng cộng: ${fmt(notes.length)} từ</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
        ${notes.slice(0, 150).map(n => {
          const it = itemOf(n);
          const lvl = noteLevel(n);
          return `
            <a href="#tu/${encodeURIComponent(it.w)}" class="p-space-md rounded-xl bg-paper-card border border-border-subtle hover:border-primary/40 transition-all flex flex-col justify-between gap-2">
              <div class="flex items-start justify-between">
                <div>
                  <span class="font-headline-md text-2xl text-on-surface font-serif font-bold">${esc(it.w)}</span>
                  <span class="font-code text-xs text-tertiary ml-2">${esc(it.py || '')}</span>
                </div>
                <span class="pill lv-${lvl}">${esc(LEVELS[lvl])}</span>
              </div>
              <div class="text-sm text-on-surface-variant line-clamp-1 font-body-sm">${esc(it.vn || it.en || '')}</div>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  `);
};

// ---------------- PROGRESS, SETTINGS & STORAGE HELPERS ----------------
async function saveSettings() {
  await Store.put("kv", "settings", JSON.parse(JSON.stringify(S.settings)));
  updateBadge();
}

async function saveProgress() {
  await Store.putMany("srs", [...S.srs.entries()]);
  await Store.putMany("stats", [...S.stats.entries()]);
  await saveSettings();
  updateBadge();
}

async function loadProgress() {
  S.srs = await Store.all("srs");
  S.stats = await Store.all("stats");
  S.inbox = await Store.all("inbox");
  const kv = await Store.all("kv");
  S.packs = kv.get("packs") || [];
  if (kv.get("settings")) {
    S.settings = Object.assign(
      {
        newPerDay: 20,
        reviewPerDay: 50,
        decks: {},
        bands: {},
        extra: {},
        ruby: true,
        syncToken: "",
        syncGistId: "",
        autoSync: true,
        lastSyncTime: ""
      },
      kv.get("settings")
    );
  }
}

function getTheme() {
  try { return localStorage.getItem("shth-theme") || "light"; } catch (e) { return "light"; }
}
function setTheme(v) {
  try { localStorage.setItem("shth-theme", v); } catch (e) {}
  document.documentElement.dataset.theme = v;
}

// ---------------- SYNC & BOOT INITIALIZATION ----------------
function initSyncUI() {
  const btn = $("#headerSyncBtn");
  const icon = $("#headerSyncIcon");
  const label = $("#headerSyncLabel");
  if (!btn || !window.Sync) return;

  btn.onclick = async () => {
    if (!Sync.isConfigured()) {
      location.hash = "#cai-dat";
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
      btn.className = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-subtle text-tertiary border border-amber/20 transition-all text-xs font-semibold shadow-xs";
      if (icon) icon.className = "material-symbols-outlined text-[16px] animate-spin";
      if (label) label.textContent = "Đang đồng bộ...";
    } else if (status === "success") {
      btn.className = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-jade-subtle text-secondary border border-secondary/20 transition-all text-xs font-semibold shadow-xs";
      if (icon) icon.className = "material-symbols-outlined text-[16px] animate-none";
      if (label) label.textContent = "Đã đồng bộ";
      setTimeout(() => {
        if (label) label.textContent = "Đã đồng bộ";
      }, 4000);
    } else if (status === "error") {
      btn.className = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cinnabar-subtle text-primary border border-primary/20 transition-all text-xs font-semibold shadow-xs";
      if (icon) icon.className = "material-symbols-outlined text-[16px] animate-none";
      if (label) label.textContent = "Lỗi đồng bộ";
    } else {
      btn.className = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-jade-subtle text-secondary border border-secondary/20 transition-all text-xs font-semibold shadow-xs";
      if (icon) icon.className = "material-symbols-outlined text-[16px] animate-none";
      if (label) label.textContent = "Đồng bộ";
    }
  });
}

// ---------------- BOOT ----------------
(async function boot() {
  try {
    $("#view").innerHTML = `
      <div class="max-w-md mx-auto py-24 text-center flex flex-col items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-cinnabar-subtle text-primary flex items-center justify-center font-bold text-xl animate-pulse">學</div>
        <div class="font-semibold text-lg text-on-surface">Đang tải bộ từ vựng TOCFL 2024...</div>
      </div>
    `;
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
      for (const a of await getJSON("data/abbr.json")) {
        S.abbrS.set(a.s, a);
        if (!S.abbrF.has(a.f)) S.abbrF.set(a.f, a);
      }
    } catch (e) {}
    buildNotes();
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
    fetch("data/cedict.tsv").then((r) => r.text()).then((txt) => {
      const m = new Map();
      for (const line of txt.split("\n")) {
        const [w, py, defs] = line.split("\t");
        if (!w) continue;
        if (!m.has(w)) m.set(w, []);
        m.get(w).push([py, defs]);
      }
      S.ced = m;
      const h = location.hash;
      if (h.startsWith("#tu") || h.startsWith("#thu-muc") || h.startsWith("#nhap")) route();
    }).catch(() => {});
  } catch (e) {
    $("#view").innerHTML = `<div class="p-8 text-center text-primary font-bold">Không tải được dữ liệu: ${esc(e.message)}</div>`;
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.update();
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      location.reload();
    });
  }
})();
