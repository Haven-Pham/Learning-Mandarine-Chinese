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
  ced: null, cedList: null, hanziDict: null, tbcl: null, vi: new Map(), abbrS: new Map(), abbrF: new Map(), packs: [],
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
window.speak = say;
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
function noteOfWord(w) {
  if (!w) return null;
  return S.noteByWord.get(w) || formsOf(w).map((f) => S.noteByWord.get(f)).find(Boolean) || null;
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
  if (typeof ensureRadicalNotes === "function") ensureRadicalNotes();
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
const hasRichExpl = (it) => !!(it && (it.us || it.mh || it.mi || (it.ng && it.ng.length)));
const needsRich = (n) => !!(n && n.kind !== "grammar" && (!n.rich || !hasRichExpl(n.it)));
function itemOf(n) {
  const v = S.vi.get(n.w) || (n.display && S.vi.get(n.display)) || (n.official && S.vi.get(n.official.w)) || {};
  if (n.rich) {
    if (hasRichExpl(n.it)) return n.it;
    return Object.assign({}, v, n.it, {
      w: n.it.w,
      band: n.it.band || v.band,
      ng: n.it.ng || v.ng,
      vd: n.it.vd || v.vd
    });
  }
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
// --- OpenCC (Simplified -> Taiwan Traditional) & pinyin-pro Helpers ---
let _twConverter = null;
function toTraditionalTw(text) {
  const s = String(text || "");
  if (!s) return "";
  if (!_twConverter && typeof OpenCC !== "undefined" && typeof OpenCC.Converter === "function") {
    try { _twConverter = OpenCC.Converter({ from: "cn", to: "twp" }); } catch (e) {}
  }
  return _twConverter ? _twConverter(s) : s;
}
function pinyinProOf(zh) {
  const s = String(zh || "");
  if (!s) return "";
  if (typeof pinyinPro !== "undefined" && typeof pinyinPro.pinyin === "function") {
    try { return pinyinPro.pinyin(s, { toneType: "symbol" }); } catch (e) {}
  }
  return "";
}
const _origPyOf = typeof pyOf === "function" ? pyOf : null;
pyOf = function(w) {
  const base = _origPyOf ? _origPyOf(w) : "";
  if (base) return base;
  return pinyinProOf(w);
};

// --- MakeMeAHanzi, TBCL/TOCFL & Live Moedict Helpers ---
function hanziInfo(ch) {
  return (S.hanziDict && ch) ? S.hanziDict[ch] || null : null;
}
// A TBCL example worth showing: a short, plain sentence that contains the word
// (the TBCL corpus also has long subtitle lines that make poor examples).
function tbclSentence(w, tb) {
  if (!tb || !tb.ex || !w) return "";
  const f = String(w).split("/")[0].replace(/[()]/g, "");
  const ss = String(tb.ex).split(/(?<=[。！？])/).map((x) => x.trim()).filter(Boolean);
  const ok = (x) => x.includes(f) && x.length <= 32 && /[。！？]$/.test(x) && !/[「」“”"()（）《》…—\-]|\.\.\./.test(x);
  return ss.find((x) => S.viEx && S.viEx[x] && x.includes(f)) || ss.find(ok) || "";
}
// Vietnamese meaning for words outside the TOCFL list (words you add, dictionary lookups):
// data/vi-dict/NN.json from CVDICT, NN = first character code point % 64, loaded only when needed.
const VI_SHARDS = new Map();
async function ensureVi(words) {
  const need = [...new Set(words)].filter((w) => w && !((S.vi.get(w) || {}).vn) && /^[㐀-鿿豈-﫿]+$/.test(w));
  if (!need.length) return false;
  const ks = [...new Set(need.map((w) => w.codePointAt(0) % 64))];
  await Promise.all(ks.map(async (k) => {
    if (VI_SHARDS.has(k)) return;
    try { VI_SHARDS.set(k, await getJSON(`data/vi-dict/${String(k).padStart(2, "0")}.json`)); } catch (e) { VI_SHARDS.set(k, {}); }
  }));
  let changed = false;
  for (const w of need) {
    const e = VI_SHARDS.get(w.codePointAt(0) % 64)[w];
    if (!e) continue;
    const v = S.vi.get(w) || {};
    S.vi.set(w, Object.assign({}, v, { vn: e[0], hv: v.hv || e[1] }));
    changed = true;
  }
  return changed;
}
window.ensureVi = ensureVi;
// Full explanations for single words (data/rich-tu/NN.json, built by tools/build_rich_words.py), loaded per shard when needed.
const RICH_SHARDS = new Map(); const RICH_ALIAS = new Set(); let RICH_INDEX = null;
async function ensureRich(words) {
  if (RICH_INDEX === null) { try { RICH_INDEX = new Set((await getJSON("data/rich-tu/index.json")).shards); } catch (e) { RICH_INDEX = new Set(); } }
  const expanded = words.filter(Boolean).flatMap((w) => {
    const n = noteOfWord(w);
    return [w, ...formsOf(w), ...(n ? [n.w, n.display, ...(n.forms || []), n.official && n.official.w] : [])];
  }).filter(Boolean);
  const ks = [...new Set(expanded.map((w) => w.codePointAt(0) % 64))].filter((k) => RICH_INDEX.has(k) && !RICH_SHARDS.has(k));
  if (!ks.length) return false;
  let changed = false;
  const putRich = (k, r, alias) => {
    const v = S.vi.get(k) || {};
    const hasOwn = !RICH_ALIAS.has(k) && (v.us || (v.ng && v.ng.length));
    if (hasOwn || (alias && (v.us || (v.ng && v.ng.length)))) return;
    if (alias) RICH_ALIAS.add(k); else RICH_ALIAS.delete(k);
    S.vi.set(k, Object.assign({}, v, r));
    changed = true;
  };
  await Promise.all(ks.map(async (k) => {
    let d = {};
    try { d = await getJSON(`data/rich-tu/${String(k).padStart(2, "0")}.json`); } catch (e) { /* offline: try again later */ return; }
    RICH_SHARDS.set(k, d);
    for (const [w, r] of Object.entries(d)) putRich(w, r, false);
    for (const [w, r] of Object.entries(d)) for (const f of formsOf(w)) if (f !== w) putRich(f, r, true);
  }));
  return changed;
}
window.ensureRich = ensureRich;
function tbclInfo(w) {
  if (!S.tbcl || !w) return null;
  return S.tbcl[w] || S.tbcl[String(w).replace(/[()]/g, "")] || null;
}
function formatDecompHTML(ch) {
  const info = hanziInfo(ch);
  const code = "U+" + ch.codePointAt(0).toString(16).toUpperCase();
  if (!info) {
    return `<strong class="text-primary font-display text-base">${esc(ch)}</strong>: Chữ Hán Phồn thể chuẩn Đài Loan (Mã <span class="font-code text-xs">${code}</span>).`;
  }
  const typeMap = { ideographic: "Hội ý", pictophonetic: "Hình thanh", pictographic: "Tượng hình" };
  const parts = [];
  if (info.r) parts.push(`Bộ thủ: <strong class="text-on-surface">${esc(info.r)}</strong>`);
  if (info.d && info.d !== "？") parts.push(`Cấu trúc: <span class="font-code text-xs bg-surface-container px-1.5 py-0.5 rounded">${esc(info.d)}</span>`);
  if (info.t) parts.push(`Loại: <strong>${esc(typeMap[info.t] || info.t)}</strong>${info.s ? ` (ý: ${esc(info.s)}` + (info.p ? `, âm: ${esc(info.p)}` : "") + ")" : ""}`);
  if (info.h) parts.push(`<span class="text-outline italic">${esc(info.h)}</span>`);
  return `<strong class="text-primary font-display text-base">${esc(ch)}</strong> (${code}) — ${parts.join(" · ")}`;
}
const _moedictCache = new Map();
async function fetchMoedictLive(w, host) {
  const box = (host && typeof host.querySelector === "function") ? host.querySelector("#moedictLiveBox") : $("#moedictLiveBox");
  if (!box || !w) return;
  try {
    let data = _moedictCache.get(w);
    if (!data) {
      const r = await fetch("https://www.moedict.tw/uni/" + encodeURIComponent(w));
      if (!r.ok) throw new Error("not found");
      data = await r.json();
      _moedictCache.set(w, data);
    }
    const h = (data.heteronyms && data.heteronyms[0]) || null;
    if (!h || !h.definitions || !h.definitions.length) {
      box.innerHTML = `<span class="text-xs text-outline">Không tìm thấy mục từ "${esc(w)}" trên Moedict.</span>`;
      return;
    }
    const defs = h.definitions.slice(0, 4).map((d, i) => `
      <div class="text-xs text-on-surface leading-relaxed">
        <span class="font-bold text-primary mr-1">${i + 1}.</span>${d.type ? `<span class="px-1.5 py-0.5 rounded bg-surface-container text-[10px] mr-1">${esc(d.type)}</span>` : ""}${esc(d.def || "")}
        ${d.example && d.example.length ? `<div class="text-on-surface-variant italic pl-4 mt-0.5">${esc(d.example[0])}</div>` : ""}
      </div>
    `).join("");
    box.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-border-subtle/50">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold text-xs text-secondary uppercase">🇹🇼 Từ điển Bộ Giáo dục Đài Loan (萌典)</span>
          ${h.bopomofo ? `<span class="px-2 py-0.5 rounded bg-jade-subtle text-secondary font-code text-xs font-bold">${esc(h.bopomofo)}</span>` : ""}
          ${h.pinyin ? `<span class="font-code text-xs text-tertiary">${esc(h.pinyin)}</span>` : ""}
        </div>
        ${h.synonyms ? `<span class="text-[11px] text-outline">Đồng nghĩa: ${esc(h.synonyms)}</span>` : ""}
      </div>
      <div class="flex flex-col gap-1.5 mt-1">${defs}</div>
    `;
  } catch (e) {
    box.innerHTML = `<span class="text-xs text-outline">Tra trực tiếp Bộ GD Đài Loan tạm offline — hãy bấm nút 萌典 phía trên để mở trang gốc.</span>`;
  }
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
// ---------------- one word = one progress ----------------
// The same word can live in several places (a class deck, a topic deck, the TOCFL list), each with its own card ids,
// and old progress can sit under an id the word no longer uses (t~word~type after the word joined a deck).
// Progress belongs to the word: what is set on one copy is copied to the others, and the queue shows a word+skill once.
function kinNotes(n) {
  if (!n || n.kind !== "vocab" || (n.deck && n.deck.id === "bo-thu")) return [];
  if (!S._kin || S._kinSize !== S.notes.length) {
    S._kin = new Map(); S._kinSize = S.notes.length;
    for (const x of S.notes) {
      if (x.kind !== "vocab" || (x.deck && x.deck.id === "bo-thu")) continue;
      const a = S._kin.get(x.w); if (a) a.push(x); else S._kin.set(x.w, [x]);
    }
  }
  return (S._kin.get(n.w) || []).filter((x) => x !== n);
}
// Every skill a word may get. Điền từ (and Nói và viết) can appear only after the full explanation is loaded,
// so a level set "for the whole word" must also cover them, or they come back later as new cards.
function allSkillsOf(n) {
  if (!n || n.kind !== "vocab") return [];
  const out = ["rec", "lis", "wri", "clo"];
  if (S.abbrS && S.abbrS.has(n.w)) out.push("abr");
  return out;
}
function shareWithKin(n, entries) {
  const out = [];
  for (const [cid, st] of entries) {
    const t = cid.split("~").pop();
    for (const k of kinNotes(n)) {
      if (!typesOf(k).some(([x]) => x === t)) continue;
      const kid = cardId(k, t); if (kid === cid) continue;
      const c = Object.assign({}, st);
      S.srs.set(kid, c); if (S.cards) S.cards.set(kid, c); out.push([kid, c]);
    }
  }
  return out;
}
async function saveKin(n, entries) {
  const kin = shareWithKin(n, entries);
  if (kin.length) { try { await Store.putMany("srs", kin); } catch (e) {} }
}
// On load: give every copy of a word the newest progress found under any id of that word.
async function reconcileWordProgress() {
  if (!S.notes || !S.srs) return 0;
  const best = new Map();
  for (const [id, st] of S.srs) {
    if (!st || typeof st.state !== "string") continue;
    if (st.state === "new" && !st.reset) continue;
    const t = id.split("~").pop();
    let w = st.w; if (!w) { const n = noteFromCard(id); if (!n) continue; w = n.w; }
    const key = w + "~" + t, b = best.get(key);
    if (!b || (st.last || 0) > (b.last || 0)) best.set(key, st);
  }
  const fix = [];
  for (const n of S.notes) {
    if (n.kind !== "vocab" || (n.deck && n.deck.id === "bo-thu")) continue;
    for (const [t] of typesOf(n)) {
      const id = cardId(n, t), b = best.get(n.w + "~" + t); if (!b) continue;
      const cur = S.srs.get(id);
      if (cur === b) continue;
      if (!cur || (cur.state === "new" && !cur.reset) || (cur.last || 0) < (b.last || 0)) {
        const c = Object.assign({}, b); S.srs.set(id, c); fix.push([id, c]);
      }
    }
  }
  // A skill that appeared after the word was already well known (level 3+ on every started skill) takes the word's newest state.
  for (const n of S.notes) {
    if (n.kind !== "vocab" || (n.deck && n.deck.id === "bo-thu")) continue;
    const st = [...new Set([...typesOf(n).map(([t]) => t), ...allSkillsOf(n)])].map((t) => [t, S.srs.get(cardId(n, t))]);
    const started = st.filter(([, x]) => x && x.state !== "new");
    if (!started.length || started.length === st.length || started.some(([, x]) => cardLevel(x) < 3)) continue;
    const src = started.reduce((a, b) => ((b[1].last || 0) > (a[1].last || 0) ? b : a))[1];
    for (const [t, x] of st) {
      if (x && (x.state !== "new" || x.reset)) continue;
      const c = Object.assign({}, src); const id = cardId(n, t); S.srs.set(id, c); fix.push([id, c]);
    }
  }
  if (fix.length) { try { await Store.putMany("srs", fix); } catch (e) {} }
  return fix.length;
}

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
  markWordSeen(n.key, cid);
  await Store.put("srs", cid, s);
  await saveKin(n, [[cid, s]]);

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
const _recentWordsMem = [];
function getRecentWords() {
  try {
    const raw = typeof sessionStorage !== "undefined" && sessionStorage.getItem("shth-recent-words");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {}
  return _recentWordsMem.slice();
}
function markWordSeen(wordKey, cid) {
  if (S.session) {
    if (!S.session.seenCounts) S.session.seenCounts = new Map();
    if (cid) S.session.seenCounts.set(cid, (S.session.seenCounts.get(cid) || 0) + 1);
    if (!S.session.seenWords) S.session.seenWords = new Set();
    if (wordKey) S.session.seenWords.add(wordKey);
  }
  if (wordKey) {
    const idx = _recentWordsMem.indexOf(wordKey);
    if (idx !== -1) _recentWordsMem.splice(idx, 1);
    _recentWordsMem.push(wordKey);
    while (_recentWordsMem.length > 10) _recentWordsMem.shift();
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem("shth-recent-words", JSON.stringify(_recentWordsMem));
    } catch (e) {}
  }
}
async function pruneAndSyncSrs() {
  if (!S.srs || !S.notes || !S.notes.length) return;
  const toPut = [];
  const toDel = [];
  const now = Date.now();
  const tomorrow0 = dayStart(now) + DAY;
  for (const [id, s] of [...S.srs.entries()]) {
    if (!s || typeof s !== "object") { S.srs.delete(id); toDel.push(id); continue; }
    if (typeof s.state !== "string") s.state = "learn";
    const n = noteFromCard(id) || (s.w && S.noteByWord.get(s.w));
    if (!n) { S.srs.delete(id); toDel.push(id); continue; }
    const vTypes = typesOf(n).map(([k]) => k);
    const rawT = id.split("~").pop();
    const targetT = vTypes.includes(rawT) ? rawT : vTypes[0];
    const canonicalId = cardId(n, targetT);
    if (id !== canonicalId) {
      if (!S.srs.has(canonicalId) && s.state !== "new") {
        S.srs.set(canonicalId, s);
        toPut.push([canonicalId, s]);
      }
      S.srs.delete(id);
      toDel.push(id);
      continue;
    }
    // Graduate cards that were stuck in learn loop across multiple reviews without lapses
    if ((s.state === "learn" || s.state === "relearn") && (s.reps || 0) >= 2 && (s.lapses || 0) === 0) {
      s.state = "review";
      s.ivl = Math.max(1, s.ivl || 1);
      s.step = 0;
      s.due = Math.max(s.due || 0, tomorrow0);
      toPut.push([id, s]);
    }
  }
  // Sync sibling skills left in learn by older inbox sync when primary skill is already reviewed
  for (const n of S.notes) {
    const vTypes = typesOf(n).map(([k]) => k);
    const states = vTypes.map((t) => [t, cardId(n, t), S.srs.get(cardId(n, t))]);
    const rev = states.find(([, , st]) => st && st.state === "review" && (st.ivl || 0) >= 1);
    if (rev) {
      for (const [, cid, st] of states) {
        if (st && (st.state === "learn" || st.state === "relearn") && (st.lapses || 0) === 0 && (st.reps || 0) <= 1) {
          Object.assign(st, { state: "review", ivl: rev[2].ivl, step: 0, due: rev[2].due, last: rev[2].last || now });
          toPut.push([cid, st]);
        }
      }
    }
  }
  try {
    if (toPut.length) await Store.putMany("srs", toPut);
    for (const id of toDel) await Store.del("srs", id);
  } catch (e) {}
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
  const validTypes = typesOf(n).map(([t]) => t);
  const targets = applyToAll ? [...new Set([...validTypes, ...allSkillsOf(n), type].filter(Boolean))] : [type];
  const wasNewWord = noteLevel(n) === 0;
  let anyWasNew = false;
  const entries = targets.map((t) => {
    const cid = cardId(n, t);
    const prev = S.srs.get(cid);
    if (!prev || prev.state === "new") anyWasNew = true;
    if (targetLvl === 0) {
      const s = typeof freshState === "function" ? freshState() : { state: "new", ivl: 0, due: now };
      s.w = n.w; s.last = now; s.reset = true;
      return [cid, s];
    }
    const s = Object.assign(scheduleLevel(prev, targetLvl, now), {
      firstSeen: (prev && (prev.firstSeen || prev.last)) || now,
      w: n.w
    });
    return [cid, s];
  });
  const entryMap = new Map(entries);
  // Also clean or update any existing S.srs keys belonging to this note so orphaned skills never trap the queue
  if (applyToAll || targetLvl >= 2) {
    for (const [k, st] of [...S.srs.entries()]) {
      if (entryMap.has(k)) continue;
      if (noteFromCard(k) === n) {
        const kt = k.split("~").pop();
        if (validTypes.includes(kt) && k === cardId(n, kt)) {
          if (applyToAll || ((st.state === "learn" || st.state === "relearn") && (st.lapses || 0) === 0 && (st.reps || 0) <= 1)) {
            const s = targetLvl === 0
              ? Object.assign(freshState(), { w: n.w, last: now, reset: true })
              : Object.assign(scheduleLevel(st, targetLvl, now), { firstSeen: st.firstSeen || st.last || now, w: n.w });
            entries.push([k, s]);
            entryMap.set(k, s);
          }
        } else {
          S.srs.delete(k);
          try { await Store.del("srs", k); } catch (e) {}
        }
      }
    }
  }
  for (const [cid, s] of entries) {
    S.srs.set(cid, s);
    S.cards.set(cid, s);
    markWordSeen(n.key, cid);
  }
  markWordSeen(n.key, cardId(n, type));
  if (entries.length === 1) {
    await Store.put("srs", entries[0][0], entries[0][1]);
  } else if (entries.length > 1) {
    await Store.putMany("srs", entries);
  }
  await saveKin(n, entries);
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

  const entries = [...new Set([...typesOf(n).map(([t]) => t), ...allSkillsOf(n)])].map((type) => {
    const id = cardId(n, type);
    if (level === 0) {
      const state = freshState();
      state.w = n.w; state.last = now; state.reset = true;
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
  await saveKin(n, entries);
  if (window.Sync && typeof Sync.onCardGraded === "function") Sync.onCardGraded();

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
      const all = root.querySelectorAll("[data-word-level]");
      all.forEach((b) => (b.disabled = true));
      const lvl = Number(btn.dataset.wordLevel);
      const st = root.querySelector ? root.querySelector("#levelStatus") : null;
      try {
        await applyWordLevel(n, lvl, afterSave);
        // show the new level on the buttons (the page is not re-rendered)
        const now = noteLevel(n);
        all.forEach((b) => {
          const L = Number(b.dataset.wordLevel), t = b.querySelector(".lvl-title");
          b.classList.toggle("is-current", L === now);
          if (t) t.textContent = (L === now ? "✓ " : "") + LEVELS[L];
        });
        const cur = root.querySelector ? root.querySelector("[data-cur-level]") : null;
        if (cur) cur.textContent = LEVELS[now];
        if (st) st.textContent = lvl === 0 ? `Đã đặt lại ${n.w} về Chưa học.` : `Đã lưu: ${n.w} ở mức ${LEVELS[lvl]}.`;
      } catch (e) {
        if (st) st.textContent = "Chưa lưu được, bạn bấm lại nhé.";
        console.warn(e);
      } finally {
        all.forEach((b) => (b.disabled = false));
      }
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
const inLearning = (n) => n.rich ? (deckOn(n.deck.id) || bandOn(n) || !!S.settings.extra[n.w]) : (bandOn(n) || !!S.settings.extra[n.w]);
function activeNotes() { return S.notes.filter(inLearning); }
function todayStats() { return S.stats.get(dayKey(Date.now())) || { reviews: 0, newCards: 0, again: 0 }; }
// The word's own progress, over every copy of it (all decks) and every skill.
function wordStates(n) {
  const out = [];
  for (const x of [n, ...kinNotes(n)]) for (const t of new Set([...typesOf(x).map(([k]) => k), ...allSkillsOf(x)])) {
    const st = S.srs.get(cardId(x, t)); if (st && st.state !== "new") out.push(st);
  }
  return out;
}
// A skill card that never started, of a word the user already knows well (Thuộc lòng / Thông thạo on every started
// card): it takes the word's newest state instead of being taught again as a new card. Returns true if adopted.
const _adoptWrites = [];
function adoptKnownWord(n, t) {
  if (!n || n.kind !== "vocab" || (n.deck && n.deck.id === "bo-thu")) return false;
  const sts = wordStates(n); if (!sts.length || sts.some((x) => cardLevel(x) < 4)) return false;
  const src = sts.reduce((a, b) => ((b.last || 0) > (a.last || 0) ? b : a));
  const id = cardId(n, t), cur = S.srs.get(id); if (cur && cur.reset) return false;
  const c = Object.assign({}, src, { w: n.w }); S.srs.set(id, c); if (S.cards) S.cards.set(id, c); _adoptWrites.push([id, c]);
  return true;
}
function flushAdopted() {
  if (!_adoptWrites.length) return;
  const w = _adoptWrites.splice(0); Store.putMany("srs", w).catch(() => {});
  if (window.Sync && typeof Sync.onCardGraded === "function") Sync.onCardGraded();
}
function buildQueue(now) {
  const learn = [], review = [], fresh = []; const end = dayStart(now) + DAY, today0 = dayStart(now);
  const seen = new Set(), wordSkill = new Set();   // wordSkill: "word~skill" already started (in any deck)
  const wsKey = (n, t) => (n.deck && n.deck.id === "bo-thu" ? "bo-thu:" : "") + n.w + "~" + t;
  // reviews: every card with a state, whatever deck or band is switched on
  for (const [id, s] of S.srs) {
    if (!s || s.state === "new" || typeof s.state !== "string") continue;
    const n = noteFromCard(id); if (!n) continue;
    const t = id.split("~").pop();
    if (!typesOf(n).some(([k]) => k === t) || id !== cardId(n, t)) continue;
    seen.add(id);
    const wk = wsKey(n, t);
    if (wordSkill.has(wk)) continue;   // the same word+skill from another deck: show it once
    wordSkill.add(wk);
    const ref = { id, n, t, s };
    if (s.state === "learn" || s.state === "relearn") learn.push(ref); else if (s.due < end) review.push(ref);
  }
  for (const n of activeNotes()) {
    const types = typesOf(n); const first = S.srs.get(cardId(n, types[0][0]));
    types.forEach(([t], k) => {
      const id = cardId(n, t); if (seen.has(id)) return;
      const wk = wsKey(n, t); if (wordSkill.has(wk)) return;   // already started or queued under another deck
      wordSkill.add(wk);
      if (adoptKnownWord(n, t)) return;   // already known word: never re-taught as new
      if (k === 0 || (first && first.state !== "new" && (first.firstSeen || first.last) > 0 && dayStart(first.firstSeen || first.last) < today0)) fresh.push({ id, n, t, s: null });
    });
  }
  flushAdopted();
  learn.sort((a, b) => ((a.s.last || 0) - (b.s.last || 0)) || (a.s.due - b.s.due));
  review.sort((a, b) => a.s.due - b.s.due);
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
  if (parts[0] === "t") {
    const w = parts.slice(1).join("~");
    return S.noteByKey.get(`t~${w}`) || S.noteByWord.get(w);
  }
  return S.noteByKey.get(parts.join("~"));
}
// Single canonical nextCard() is defined below after folderNotes()
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
  if (it.ng && it.ng.length) parts.push(`<div class="rich-sec rich-senses"><h4>Giải nghĩa đầy đủ</h4><ol>${it.ng.map((x) => `<li>${ruby(x)}</li>`).join("")}</ol></div>`);
  if (it.vd && it.vd.length) parts.push(`<div class="rich-sec rich-vd"><h4>Câu theo tình huống</h4>${it.vd.map((v) => `<div class="rich-ex">${v.t ? `<span class="rich-tag">${esc(v.t)}</span>` : ""}<div class="zh" lang="zh-Hant">${esc(v.zh)} ${sp(v.zh)}</div><div class="py">${esc(v.py || "")}</div><div class="vn">${esc(v.vn)}</div></div>`).join("")}</div>`);
  const rows = [["Cách dùng", it.us, "us"], ["Cụm hay gặp", it.co, "co"], ["Đồng nghĩa, gần nghĩa", it.sy, "sy"], ["Trái nghĩa", it.an, "an"], ["Dễ nhầm với", it.cf, "cf"], ["Lượng từ", it.lt, "lt"]].filter(([, v]) => v);
  if (rows.length) parts.push(`<div class="rich-sec"><dl class="rich-kv">${rows.map(([k, v, c]) => `<div class="kv-${c}"><dt>${k}</dt><dd>${ruby(v)}</dd></div>`).join("")}</dl></div>`);
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
    setView(`<section class="view"><div class="panel center"><h2 class="h2">Đang kết nối đồng bộ...</h2><p class="lead">Đang nối máy này vào cùng tiến độ học với các máy khác...</p><div class="sync-spin" style="font-size: 32px; margin: 16px 0;">🔄</div></div></section>`);
    try {
      await Sync.connectWithToken(token, gistId);
      alert("🎉 Kết nối đồng bộ thành công!\n\nMáy này đã vào chung tiến độ học với các máy khác. Từ bây giờ mỗi khi bạn học, dữ liệu sẽ tự động đồng bộ 2 chiều.");
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
  let h = rawHash || "trang-chu";
  try { h = decodeURIComponent(h); } catch (e) {}
  if (h === "tra-tu") h = "tu-dien";
  if (h === "tu-vung") h = "thu-muc";
  else if (h.startsWith("tu-vung/")) h = "thu-muc/" + h.slice("tu-vung/".length);
  if (h === "chep-chinh-ta") h = "chinh-ta";
  const [name, ...rest] = h.split("/"); const arg = rest.join("/");
  // Stop any lingering audio / dialogue queue / exam timer when changing routes
  window._dialoguePlayId = (window._dialoguePlayId || 0) + 1;
  if (window._dialogueTimer) { clearTimeout(window._dialogueTimer); window._dialogueTimer = null; }
  if (name !== "thi-thu") {
    if (typeof stopExamAudio === "function") stopExamAudio();
    if (window._tocflTimerInterval) { clearInterval(window._tocflTimerInterval); window._tocflTimerInterval = null; }
  } else if ("speechSynthesis" in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
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
  if (name === "tu" && arg && S.ready) {
    const at = location.hash;
    Promise.all([ensureVi([arg]), ensureRich([arg])]).then(([a, b]) => { if ((a || b) && location.hash === at) fn(arg); }).catch(() => {});
  }
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
  if (id === "bo-thu") {
    if (typeof ensureRadicalNotes === "function") ensureRadicalNotes();
    return S.notes.filter((n) => n.rich && n.deck && n.deck.id === "bo-thu");
  }
  if (S.bands.includes(id)) return S.notes.filter((n) => n.kind === "vocab" && inBand(n, id));
  if (id === "cua-toi") return S.notes.filter((n) => (n.rich && (!n.deck || n.deck.id !== "bo-thu")) || (S.settings && S.settings.extra && S.settings.extra[n.w]) || (S.inbox && [...S.inbox.values()].some(x => x.w === n.w)));
  if (id === "viet-tat") { const set = new Set(); for (const w of (S.abbrS ? S.abbrS.keys() : [])) { const n = S.noteByWord.get(w); if (n) set.add(n); } return [...set]; }
  if (String(id).startsWith("cd-")) {
    const tp = (S.topics || []).find((x) => x.id === id); if (!tp) return [];
    const set = new Set();
    for (const w of tp.words) { const n = S.noteByWord.get(w) || S.noteByWord.get(w.split("/")[0]); if (n && n.kind === "vocab") set.add(n); }
    return [...set];
  }
  return S.notes.filter((n) => n.rich && n.deck && n.deck.id === id);
}
function folderOn(id) {
  if (!S.settings) S.settings = {};
  if (!S.settings.bands) S.settings.bands = {};
  if (!S.settings.decks) S.settings.decks = {};
  if (S.bands.includes(id)) return !!S.settings.bands[id];
  if (id === "cua-toi") return (S.decks || []).every((d) => deckOn(d.id));
  if (id === "viet-tat" || String(id).startsWith("cd-")) { const ns = folderNotes(id); return ns.length > 0 && ns.every(inLearning); }
  return deckOn(id);
}
function setFolderOn(id, v) {
  if (!S.settings) S.settings = {};
  if (!S.settings.bands) S.settings.bands = {};
  if (!S.settings.decks) S.settings.decks = {};
  if (!S.settings.extra) S.settings.extra = {};
  if (S.bands.includes(id)) S.settings.bands[id] = v;
  else if (id === "cua-toi") for (const d of (S.decks || [])) S.settings.decks[d.id] = v;
  else if (String(id).startsWith("cd-")) { for (const n of folderNotes(id)) { if (v) S.settings.extra[n.w] = true; else delete S.settings.extra[n.w]; } }
  else if (id === "viet-tat") { for (const n of folderNotes(id)) { if (n.rich) S.settings.decks[n.deck.id] = v || deckOn(n.deck.id); else if (v) S.settings.extra[n.w] = true; else delete S.settings.extra[n.w]; } }
  else S.settings.decks[id] = v;
}
const hasProgress = (n) => typesOf(n).some(([t]) => (S.cards && S.cards.has(cardId(n, t))) || (S.srs && S.srs.has(cardId(n, t))));

function nextCard(now) {
  const q = buildQueue(now);
  const ss = S.session;
  const last = ss && ss.lastNote;
  const mode = (ss && ss.mode) || "all";
  const seen = ss && ss.seenCounts;
  const seenWords = (ss && ss.seenWords) || new Set();
  const recentSet = new Set(getRecentWords());
  const seenCount = (r) => (seen ? (seen.get(r.id) || 0) : 0);
  const unseen = (arr) => arr.filter((r) => !seenWords.has(r.n.key) && seenCount(r) === 0);
  const pick = (arr) => {
    const nonRecent = arr.filter((r) => r.n.key !== last && !recentSet.has(r.n.key));
    if (nonRecent.length) return nonRecent[0];
    return arr.find((r) => r.n.key !== last) || arr[0];
  };
  const pickAhead = (arr) => {
    const cand = unseen(arr);
    if (!cand.length) return null;
    return pick(cand);
  };
  // Extra review pool: other learned words in S.srs (sorted by earliest due) so user can keep reviewing beyond just 2 learn words
  const extraReviewCards = (filterSet) => {
    const out = [];
    const usedWords = new Set();
    for (const [id, s] of S.srs) {
      if (!s || s.state === "new" || typeof s.state !== "string") continue;
      // only weak cards (Mới học / Nhớ tạm) may be pulled early; Nhớ lâu, Thuộc lòng, Thông thạo wait for their date
      if (cardLevel(s) > 2 && s.due > dayStart(now) + DAY) continue;
      const n = noteFromCard(id);
      if (!n || seenWords.has(n.key) || n.key === last || usedWords.has(n.w)) continue;
      if (filterSet && !filterSet.has(n.key)) continue;
      const t = id.split("~").pop();
      if (!typesOf(n).some(([k]) => k === t) || id !== cardId(n, t)) continue;
      usedWords.add(n.w);
      out.push({ id, n, t, s });
    }
    out.sort((a, b) => (a.s.due - b.s.due) || ((a.s.last || 0) - (b.s.last || 0)));
    return out;
  };
  // Extra fresh pool when daily newPerDay cap blocked q.fresh but user is actively continuing in session
  const extraFreshCards = () => {
    const out = [];
    for (const n of activeNotes()) {
      if (seenWords.has(n.key) || n.key === last) continue;
      const t0 = typesOf(n)[0][0];
      const id = cardId(n, t0);
      if (S.srs.has(id) && S.srs.get(id).state !== "new") continue;
      if (adoptKnownWord(n, t0) || wordStates(n).length) continue;
      out.push({ id, n, t: t0, s: null });
    }
    flushAdopted();
    return out;
  };

  if (ss && ss.folderFilter) {
    const fNotes = folderNotes(ss.folderFilter);
    const fKeys = new Set(fNotes.map((n) => n.key));
    const fDueLearn = q.learn.filter((r) => fKeys.has(r.n.key) && r.s.due <= now);
    const fDueUnseen = unseen(fDueLearn);
    if (fDueUnseen.length) return pick(fDueUnseen);
    const fReview = unseen(q.review.filter((r) => fKeys.has(r.n.key)));
    if (fReview.length) return pick(fReview);
    const fFresh = [];
    for (const n of fNotes) {
      if (seenWords.has(n.key)) continue;
      const types = typesOf(n);
      const firstId = cardId(n, types[0][0]);
      const firstS = S.srs && S.srs.get(firstId);
      if ((!firstS || firstS.state === "new") && !adoptKnownWord(n, types[0][0]) && !wordStates(n).length) {
        fFresh.push({ id: firstId, n, t: types[0][0], s: null });
      }
    }
    flushAdopted();
    if (fFresh.length) return pick(fFresh);
    const fAhead = pickAhead(q.learn.filter((r) => fKeys.has(r.n.key) && r.s.due <= now + 20 * MIN));
    if (fAhead) return fAhead;
    const fExtraRev = extraReviewCards(fKeys);
    if (fExtraRev.length && (!ss.start || ss.answered < ss.start)) return pick(fExtraRev);
    return null;
  }

  const dueLearn = q.learn.filter((r) => r.s.due <= now);
  if (mode === "new") {
    const newKeys = ss && ss.newKeys;
    const newDueLearn = newKeys ? dueLearn.filter((r) => newKeys.has(r.n.key)) : [];
    const newDueUnseen = unseen(newDueLearn);
    if (newDueUnseen.length) return pick(newDueUnseen);
    const freshUnseen = unseen(q.fresh);
    if (freshUnseen.length) return pick(freshUnseen);
    const newAhead = newKeys ? q.learn.filter((r) => newKeys.has(r.n.key) && r.s.due <= now + 20 * MIN) : [];
    return pickAhead(newAhead);
  }
  if (mode === "review") {
    const dueUnseen = unseen(dueLearn);
    if (dueUnseen.length) return pick(dueUnseen);
    const revUnseen = unseen(q.review);
    if (revUnseen.length) return pick(revUnseen);
    const aheadCard = pickAhead(q.learn.filter((r) => r.s.due <= now + 20 * MIN));
    if (aheadCard) return aheadCard;
    const extraRev = extraReviewCards(null);
    const maxRev = Math.max((ss && ss.start) || 0, Number(S.settings.reviewPerDay || 30));
    if (extraRev.length && (!ss || ss.answered < maxRev)) return pick(extraRev);
    return null;
  }

  // mode === "all": finish unseen learn cards, then due reviews & fresh cards, then other learned/active cards so user never gets stuck on 2 words
  const dueUnseen = unseen(dueLearn);
  if (dueUnseen.length) return pick(dueUnseen);
  const revUnseen = unseen(q.review);
  if (revUnseen.length) return pick(revUnseen);
  const freshUnseen = unseen(q.fresh);
  if (freshUnseen.length) return pick(freshUnseen);
  const aheadCard = pickAhead(q.learn.filter((r) => r.s.due <= now + 20 * MIN));
  if (aheadCard) return aheadCard;
  const maxAll = Math.max((ss && ss.start) || 0, Number(S.settings.reviewPerDay || 30));
  if (!ss || ss.answered < maxAll) {
    const extraRev = extraReviewCards(null);
    if (extraRev.length) return pick(extraRev);
    const extraFr = extraFreshCards();
    if (extraFr.length && (!ss || ss.answered < Math.max(ss.start || 0, Number(S.settings.newPerDay || 8)))) return pick(extraFr);
  }
  return null;
}

// ---------------- set a whole folder to one level ----------------
// For words already known before using the app (e.g. "Novice 2 is all Thông thạo"). One write for the whole folder;
// it does not count as new words learned today, so the daily new-word quota is untouched.
function bulkLevelHTML(id, dark) {
  const opts = LEVELS.map((l, i) => `<option value="${i}"${i === 5 ? " selected" : ""}>${esc(l)}</option>`).join("");
  return `<span class="inline-flex items-center gap-1.5 flex-wrap ${dark ? "text-white" : "text-on-surface"}">
    <span class="text-xs font-semibold">Đặt cả thư mục:</span>
    <select id="bulkLevelSel" class="px-2 py-1.5 rounded-lg text-xs border ${dark ? "bg-black/30 border-white/25 text-white" : "bg-paper-card border-border-subtle text-on-surface"}">${opts}</select>
    <button type="button" id="bulkLevelBtn" data-folder="${esc(id)}" class="px-3 py-1.5 rounded-lg text-xs font-semibold border ${dark ? "border-white/25 hover:bg-white/10" : "border-border-subtle bg-paper-card hover:bg-surface-container"}">Áp dụng</button>
    <span id="bulkLevelMsg" class="text-xs"></span>
  </span>`;
}
async function setFolderLevel(id, level) {
  const notes = folderNotes(id).filter((n) => n.kind === "vocab" || n.kind === "grammar");
  const now = Date.now(), ivl = [0, 0, 1, 7, 21, 90][level];
  const entries = [];
  for (const n of notes) {
    const types = [...new Set([...typesOf(n).map(([t]) => t), ...allSkillsOf(n)])];
    const local = [];
    for (const t of types) {
      const cid = cardId(n, t);
      let st;
      if (level === 0) st = Object.assign(freshState(), { w: n.w, last: now, reset: true });
      else st = Object.assign(freshState(), S.srs.get(cid) || {}, {
        state: level === 1 ? "learn" : "review", ivl, step: 0,
        due: level === 1 ? now + STEPS[0] : dayStart(now) + ivl * DAY,
        firstSeen: ((S.srs.get(cid) || {}).firstSeen) || now, last: now, w: n.w
      });
      delete st.fsrs;
      S.srs.set(cid, st); if (S.cards) S.cards.set(cid, st);
      local.push([cid, st]);
    }
    entries.push(...local, ...shareWithKin(n, local));
  }
  await Store.putMany("srs", entries);
  updateBadge();
  return notes.length;
}
function bindBulkLevel(id, redraw) {
  const btn = $("#bulkLevelBtn"), sel = $("#bulkLevelSel"), msg = $("#bulkLevelMsg");
  if (!btn || !sel) return;
  btn.onclick = async () => {
    const lvl = Number(sel.value), cnt = folderNotes(id).length;
    if (!confirm(`Đặt toàn bộ ${fmt(cnt)} từ trong thư mục này về mức "${LEVELS[lvl]}"?\nTiến độ hiện tại của các từ này sẽ được thay bằng mức mới.`)) return;
    btn.disabled = true; if (msg) msg.textContent = "Đang lưu…";
    try {
      const n = await setFolderLevel(id, lvl);
      if (msg) msg.textContent = `Đã đặt ${fmt(n)} từ về ${LEVELS[lvl]}.`;
      if (typeof Sync !== "undefined" && Sync.onCardGraded) { try { Sync.onCardGraded(); } catch (e) {} }
      if (typeof redraw === "function") setTimeout(redraw, 700);
    } catch (e) {
      console.warn(e); if (msg) msg.textContent = "Chưa lưu được, bạn bấm lại nhé.";
    } finally { btn.disabled = false; }
  };
}

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
    if (S.vi) {
      const prev = S.vi.get(w) || {};
      const cleanNote = (entry.note && entry.note !== "Từ vựng bổ sung") ? entry.note : "";
      S.vi.set(w, Object.assign({}, prev, {
        vn: prev.vn || cleanNote || vn,
        py: prev.py || py,
        hv: prev.hv || entry.hv || "",
        pos: prev.pos || entry.pos || "",
        ng: (prev.ng && prev.ng.length) ? prev.ng : (Array.isArray(entry.ng) && entry.ng.length ? entry.ng : undefined)
      }));
    }
  } else {
    if (entry.where && !note.theme) note.theme = entry.where;
    if (S.vi) {
      const prev = S.vi.get(w) || {};
      const cleanNote = (entry.note && entry.note !== "Từ vựng bổ sung") ? entry.note : "";
      if ((!prev.vn && cleanNote) || (!prev.hv && entry.hv) || (!(prev.ng && prev.ng.length) && Array.isArray(entry.ng) && entry.ng.length)) {
        S.vi.set(w, Object.assign({}, prev, {
          vn: prev.vn || cleanNote,
          hv: prev.hv || entry.hv || "",
          pos: prev.pos || entry.pos || "",
          ng: (prev.ng && prev.ng.length) ? prev.ng : (Array.isArray(entry.ng) && entry.ng.length ? entry.ng : undefined)
        }));
      }
    }
  }

  if (scheduleNow) {
    const now = Date.now();
    const types = typesOf(note);
    const firstType = types[0] ? types[0][0] : "rec";
    const cid = cardId(note, firstType);
    const prev = S.srs ? S.srs.get(cid) : null;
    const wasNew = !prev || prev.state === "new";
    const ops = [saveSettings()];
    if (wasNew) {
      const next = typeof scheduleLevel === "function" ? scheduleLevel(prev, 1, now) : { due: now, ivl: 0, reps: 0, ease: 250, lapses: 0, state: 0 };
      next.w = note.w;
      next.due = now; // Ready to study immediately!
      next.firstSeen = now;
      if (S.srs) S.srs.set(cid, next);
      if (S.cards) S.cards.set(cid, next);
      ops.push(Store.put("srs", cid, next));
      const key = dayKey(now);
      const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats.get(key));
      st.reviews++;
      st.newCards++;
      S.stats.set(key, st);
      ops.push(Store.put("stats", key, st));
    }
    Promise.all(ops).then(() => {
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
  const t0 = typesOf(n)[0][0];
  const s = (S.srs && S.srs.get(cardId(n, t0))) || freshState();
  S.session = {
    folderFilter: null,
    answered: 0,
    shown: false,
    start: 1,
    lastNote: null,
    mode: "all",
    newKeys: new Set(),
    queue: [],
    seenCounts: new Map(),
    current: { n, t: t0, s }
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
        try { await saveSettings(); } catch (e) {}
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
      try { await saveSettings(); } catch (e) {}
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
    const hi = hanziInfo(c);
    const def = ce ? ce[0][1].split("/").slice(0, 2).join("; ") : "";
    const meta = hi ? [hi.r ? `Bộ ${hi.r}` : "", hi.d && hi.d !== "？" ? hi.d : ""].filter(Boolean).join(" · ") : "";
    return `
      <div class="bg-surface-container-low rounded-xl p-space-md flex items-start gap-space-md border border-border-subtle/50">
        <div class="w-12 h-12 rounded-lg bg-cinnabar-subtle text-primary flex items-center justify-center font-display text-2xl shrink-0 font-serif font-bold">
          ${c}
        </div>
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-space-xs flex-wrap">
            <span class="font-label-md font-bold text-on-surface">${c} (${py})</span>
            ${meta ? `<span class="text-[11px] font-code px-1.5 py-0.5 rounded bg-paper-card border border-border-subtle text-tertiary">${esc(meta)}</span>` : ""}
          </div>
          <p class="font-body-sm text-xs text-on-surface-variant mt-0.5 line-clamp-2">
            ${(hi && hi.h) ? `${esc(hi.h)}${def ? " — " + esc(def) : ""}` : (def || 'Chữ Hán Phồn thể chuẩn')}
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
    <div class="${ss.shown ? "study-wide" : "max-w-4xl"} mx-auto px-margin-mobile md:px-margin py-space-md md:py-space-lg flex flex-col gap-space-lg relative z-10">
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
            <button type="button" class="text-xs text-secondary hover:text-primary transition-colors font-semibold underline ml-2" id="btnNextWord" title="Chuyển sang từ tiếp theo">
              Từ tiếp →
            </button>
            <button type="button" class="text-xs text-outline hover:text-primary transition-colors underline ml-1" id="btnStopSession">
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
        <!-- Ambient Seal Watermark (front side only: on the answer side it would sit under the text) -->
        <div class="${ss.shown ? "hidden " : ""}absolute top-6 right-8 select-none pointer-events-none opacity-5 font-serif text-[120px] text-primary leading-none">
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
            <!-- Back Details (Expanded Answer Side): wide screens show two columns,
                 left = word, meaning, example and grading (always in view), right = full explanation -->
            <div class="study-back">
             <div class="sb-main flex flex-col gap-space-lg">
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

              <!-- Contextual Example Box (local or TBCL/TOCFL) -->
              ${(() => {
                const tb = tbclInfo(it.w);
                const own = it.e1 || it.e2 || "";
                const exZh = own || tbclSentence(it.w, tb);
                const exPy = (own ? (it.e1 ? it.e1p : it.e2p) : "") || (exZh ? pinyinProOf(exZh) : "");
                const exVn = (own ? (it.e1 ? it.e1v : it.e2v) : "") || (S.viEx && S.viEx[exZh]) || "";
                if (!exZh && !(tb && tb.cmp)) return "";
                return `
                <div class="bg-paper-muted rounded-xl p-space-md md:p-space-lg flex flex-col gap-space-sm relative border border-border-subtle">
                  <div class="flex items-center justify-between">
                    <span class="font-label-sm text-xs text-secondary font-semibold uppercase tracking-wider flex items-center gap-1">
                      <span class="material-symbols-outlined text-[16px]">format_quote</span>
                      Ví dụ ngữ cảnh Đài Loan ${!own && exZh ? '(TBCL)' : ''}
                    </span>
                    ${exZh ? `<button type="button" class="text-secondary hover:text-primary p-1 transition-colors" onclick="say('${esc(exZh)}')" title="Nghe câu ví dụ"><span class="material-symbols-outlined text-[20px]">volume_up</span></button>` : ''}
                  </div>
                  ${exZh ? `<p class="font-headline-md text-lg md:text-xl text-on-surface font-serif font-medium leading-relaxed" lang="zh-Hant">${esc(exZh)}</p>` : ''}
                  ${exPy ? `<p class="font-code text-xs text-on-surface-variant">${esc(exPy)}</p>` : ''}
                  ${exZh ? (exVn ? `<p class="font-body-md text-sm text-on-surface font-medium">${esc(exVn)}</p>` : `<p class="text-xs text-outline">Câu này chưa có bản dịch tiếng Việt.</p>`) : ''}
                  ${tb && tb.cmp ? `<div class="text-xs text-outline pt-1 border-t border-border-subtle/50">Từ ghép thường dùng: <strong class="text-on-surface">${esc(tb.cmp)}</strong></div>` : ''}
                </div>
                `;
              })()}

             </div>
             <div class="sb-more flex flex-col gap-space-lg">
              ${richDetailHTML(it) || `<p class="sb-empty">Từ này chưa có phần giải thích đầy đủ (cách dùng, cụm từ, lỗi hay gặp, câu tình huống). Phần này đang được soạn dần theo bài.</p>`}

              <!-- Character Decomposition Bento Cards -->
              ${chars.length ? `
                <div class="flex flex-col gap-2">
                  <span class="text-xs text-outline font-semibold uppercase">Chiết tự & Cấu trúc chữ</span>
                  <div class="grid grid-cols-1 md:grid-cols-${Math.min(chars.length, 3)} gap-space-md">
                    ${charDecompHTML}
                  </div>
                </div>
              ` : ''}

             </div>
              <!-- SECTION: SRS EVALUATION & SKILL MASTERY -->
              <div class="sb-grade pt-space-md flex flex-col gap-space-md border-t border-border-subtle mt-2">
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
                      const locked = false;
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
                    ${clozeMissed ? `<b class="text-primary">Bạn vừa chọn sai đáp án: nên chấm Mới học hoặc Nhớ tạm.</b> ` : ""}Số dưới mỗi ô là lần ôn tới. Bấm mức nào thì từ nằm trong khoảng ngày của mức đó.
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

  // Bind skip/next word button so user can always move past any card immediately
  const btnNextWord = $("#btnNextWord");
  if (btnNextWord) {
    btnNextWord.onclick = async () => {
      markWordSeen(r.n.key, curCid);
      // If card was stuck in learn, schedule it to tomorrow so it won't block the queue
      const st = S.srs.get(curCid);
      if (st && (st.state === "learn" || st.state === "relearn")) {
        await applyCardLevel(r.n, r.t, 2, true);
      }
      ss.lastNote = r.n.key;
      ss.shown = false;
      ss.current = nextCard(Date.now());
      renderCard();
      window.scrollTo(0, 0);
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

  // load the full explanation of this word if it lives in a shard not loaded yet, then redraw the answer side
  if (ss.shown && needsRich(r.n)) {
    const cur = ss.current;
    ensureRich([r.n.w]).then((ch) => { if (ch && S.session === ss && ss.current === cur && ss.shown) renderCard(); }).catch(() => {});
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
// BỘ THỦ CHỮ HÁN TRỌNG TÂM (60 KANGXI RADICALS • 部首寶典)
// =========================================================================
const KANGXI_RADICALS = [
  { no: 9, r: "人", v: "亻", strokes: 2, cat: "con-nguoi", hv: "Bộ Nhân", py: "rén", vn: "Con người, hành vi của người", posHint: "Biến thể 亻 (nhân đứng) luôn đứng bên trái chữ.", ex: ["休 (nghỉ ngơi)", "你 (bạn)", "他 (anh ấy)", "作 (làm)"] },
  { no: 18, r: "刀", v: "刂", strokes: 2, cat: "do-vat-nha-cua", hv: "Bộ Đao", py: "dāo", vn: "Con dao, vật sắc bén, cắt gọt", posHint: "Biến thể 刂 (đao đứng) thường nằm bên phải chữ.", ex: ["切 (cắt)", "分 (chia)", "到 (đến)", "利 (sắc bén)"] },
  { no: 19, r: "力", v: "", strokes: 2, cat: "hanh-dong", hv: "Bộ Lực", py: "lì", vn: "Sức mạnh, gắng sức, lao động", posHint: "Thường đứng bên phải hoặc dưới để chỉ việc dùng sức.", ex: ["動 (chuyển động)", "助 (giúp đỡ)", "努 (nỗ lực)", "勞 (lao động)"] },
  { no: 29, r: "又", v: "", strokes: 2, cat: "hanh-dong", hv: "Bộ Hựu", py: "yòu", vn: "Bàn tay phải, lặp lại một lần nữa", posHint: "Gốc tượng hình bàn tay; xuất hiện trong các chữ chỉ cầm nắm, giao tiếp.", ex: ["友 (bạn bè)", "受 (nhận)", "取 (lấy)", "反 (ngược lại)"] },
  { no: 15, r: "冫", v: "", strokes: 2, cat: "thien-nhien", hv: "Bộ Băng", py: "bīng", vn: "Nước đá, giá lạnh, đóng băng", posHint: "Gồm 2 nét chấm bên trái; phân biệt với 氵 (3 chấm thủy).", ex: ["冷 (lạnh)", "冰 (băng đá)", "凍 (đông lạnh)", "涼 (mát)"] },
  { no: 30, r: "口", v: "", strokes: 3, cat: "con-nguoi", hv: "Bộ Khẩu", py: "kǒu", vn: "Cái miệng, lời nói, ăn uống, lối ra vào", posHint: "Đứng bên trái khi chỉ hoạt động của miệng (ăn, uống, gọi, hỏi).", ex: ["吃 (ăn)", "喝 (uống)", "叫 (gọi)", "問 (hỏi)"] },
  { no: 31, r: "囗", v: "", strokes: 3, cat: "do-vat-nha-cua", hv: "Bộ Vi", py: "wéi", vn: "Bao vây, khuôn viên khép kín", posHint: "Khung lớn bao quanh toàn bộ chữ bên trong (khác với 口 nhỏ).", ex: ["國 (đất nước)", "園 (vườn)", "圖 (bản đồ)", "團 (đoàn thể)"] },
  { no: 32, r: "土", v: "", strokes: 3, cat: "thien-nhien", hv: "Bộ Thổ", py: "tǔ", vn: "Đất đai, địa hình, nơi chốn, xây dựng", posHint: "Đứng bên trái (提土旁) hoặc dưới đáy chữ.", ex: ["地 (đất)", "坐 (ngồi)", "城 (thành phố)", "場 (sân bãi)"] },
  { no: 38, r: "女", v: "", strokes: 3, cat: "con-nguoi", hv: "Bộ Nữ", py: "nǚ", vn: "Phụ nữ, phái nữ, quan hệ gia đình", posHint: "Thường đứng bên trái hoặc dưới chữ.", ex: ["好 (tốt)", "媽 (mẹ)", "姐 (chị)", "婚 (hôn nhân)"] },
  { no: 39, r: "子", v: "孑", strokes: 3, cat: "con-nguoi", hv: "Bộ Tử", py: "zǐ", vn: "Con cái, đứa trẻ, hạt giống, học tập", posHint: "Đứng trái, dưới hoặc bao quanh liên quan đến trẻ nhỏ, sinh sôi.", ex: ["字 (chữ)", "學 (học)", "孩 (trẻ em)", "孫 (cháu)"] },
  { no: 40, r: "宀", v: "", strokes: 3, cat: "do-vat-nha-cua", hv: "Bộ Miên", py: "mián", vn: "Mái nhà, phòng ốc, sự che chở", posHint: "Luôn chụp ở phía trên chữ như mái nhà có ống khói.", ex: ["家 (nhà)", "安 (yên ổn)", "室 (phòng)", "宿 (ký túc)"] },
  { no: 41, r: "寸", v: "", strokes: 3, cat: "hanh-dong", hv: "Bộ Thốn", py: "cùn", vn: "Đơn vị đo (tấc), bàn tay, khuôn phép", posHint: "Chỉ mạch cổ tay cách bàn tay 1 tấc; biểu thị chừng mực.", ex: ["對 (đúng)", "導 (hướng dẫn)", "專 (chuyên tâm)", "尊 (tôn kính)"] },
  { no: 46, r: "山", v: "", strokes: 3, cat: "thien-nhien", hv: "Bộ Sơn", py: "shān", vn: "Núi non, địa thế cao, đảo đá", posHint: "Tượng hình 3 đỉnh núi; đứng trái, trên hoặc dưới.", ex: ["島 (hòn đảo)", "岸 (bờ biển)", "峰 (đỉnh núi)", "峽 (hẻm núi)"] },
  { no: 50, r: "巾", v: "", strokes: 3, cat: "do-vat-nha-cua", hv: "Bộ Cân", py: "jīn", vn: "Khăn vải, màn trướng, đồ may mặc", posHint: "Thường đứng trái hoặc dưới chữ chỉ vật làm bằng vải.", ex: ["布 (vải)", "帽 (mũ nón)", "帶 (đai, mang)", "帳 (màn, sổ)"] },
  { no: 53, r: "广", v: "", strokes: 3, cat: "do-vat-nha-cua", hv: "Bộ Nghiễm", py: "guǎng", vn: "Mái nhà tựa vách núi, công trình rộng", posHint: "Bao phía trên và bên trái chữ (khác với 疒 có thêm 2 nét bên trái).", ex: ["店 (cửa hàng)", "府 (phủ)", "座 (chỗ ngồi)", "庭 (sân vườn)"] },
  { no: 57, r: "弓", v: "", strokes: 3, cat: "do-vat-nha-cua", hv: "Bộ Cung", py: "gōng", vn: "Cây cung, lực căng, uốn cong", posHint: "Thường đứng bên trái chữ.", ex: ["張 (mở rộng)", "強 (mạnh mẽ)", "引 (dẫn dắt)", "彎 (uốn cong)"] },
  { no: 60, r: "彳", v: "", strokes: 3, cat: "hanh-dong", hv: "Bộ Xích", py: "chì", vn: "Bước chân trái, đi lại, đường phố", posHint: "Luôn đứng bên trái (雙人旁 - hai nhân đứng).", ex: ["行 (đi)", "往 (hướng tới)", "待 (đợi)", "得 (đạt được)"] },
  { no: 61, r: "心", v: "忄/⺗", strokes: 4, cat: "con-nguoi", hv: "Bộ Tâm", py: "xīn", vn: "Trái tim, tâm trạng, cảm xúc, suy nghĩ", posHint: "Biến thể 忄 (tâm đứng) nằm bên trái;的心 nằm dưới đáy chữ.", ex: ["想 (nghĩ)", "忙 (bận)", "快 (nhanh/vui)", "情 (tình cảm)"] },
  { no: 62, r: "戈", v: "", strokes: 4, cat: "hanh-dong", hv: "Bộ Qua", py: "gē", vn: "Kích giáo, vũ khí cổ, chiến đấu, bảo vệ", posHint: "Thường nằm bên phải hoặc bao góc phải.", ex: ["我 (tôi)", "戰 (chiến đấu)", "成 (thành công)", "戒 (răn đe)"] },
  { no: 63, r: "戶", v: "", strokes: 4, cat: "do-vat-nha-cua", hv: "Bộ Hộ", py: "hù", vn: "Cửa một cánh, hộ gia đình, căn phòng", posHint: "Bao phía trên bên trái.", ex: ["房 (căn phòng)", "所 (nơi chốn)", "扇 (cánh quạt/cửa)"] },
  { no: 64, r: "手", v: "扌", strokes: 4, cat: "con-nguoi", hv: "Bộ Thủ", py: "shǒu", vn: "Bàn tay, động tác cầm nắm, đánh, đẩy", posHint: "Biến thể 扌 (thủ gẩy) luôn đứng bên trái các động từ tay.", ex: ["打 (đánh)", "找 (tìm)", "拿 (cầm)", "推 (đẩy)"] },
  { no: 66, r: "攴", v: "攵", strokes: 4, cat: "hanh-dong", hv: "Bộ Phộc", py: "pū", vn: "Gõ nhẹ, thúc đẩy, chỉnh đốn hành động", posHint: "Biến thể 攵 (4 nét) luôn đứng bên phải chữ.", ex: ["教 (dạy)", "收 (thu nhận)", "改 (sửa đổi)", "放 (đặt, thả)"] },
  { no: 72, r: "日", v: "", strokes: 4, cat: "thien-nhien", hv: "Bộ Nhật", py: "rì", vn: "Mặt trời, ánh sáng, ngày tháng, thời gian", posHint: "Đứng trái, trên hoặc dưới các chữ chỉ thời gian và độ sáng.", ex: ["明 (sáng)", "時 (thời gian)", "早 (sáng sớm)", "晚 (buổi tối)"] },
  { no: 74, r: "月", v: "", strokes: 4, cat: "thien-nhien", hv: "Bộ Nguyệt", py: "yuè", vn: "Mặt trăng, tháng năm, kỳ hạn", posHint: "Chú ý: Khi đứng bên trái nhiều chữ chỉ cơ thể, 月 thực chất là biến thể của Bộ Nhục (肉).", ex: ["期 (kỳ hạn)", "明 (sáng)", "朝 (buổi sớm)", "望 (ngóng trông)"] },
  { no: 75, r: "木", v: "", strokes: 4, cat: "thien-nhien", hv: "Bộ Mộc", py: "mù", vn: "Cây cối, gỗ, đồ mộc, thực vật thân gỗ", posHint: "Đứng trái hoặc dưới chữ.", ex: ["林 (rừng)", "樹 (cây)", "桌 (cái bàn)", "椅 (cái ghế)"] },
  { no: 76, r: "欠", v: "", strokes: 4, cat: "hanh-dong", hv: "Bộ Khiếm", py: "qiàn", vn: "Há miệng thở, thiếu thốn, ca hát, cảm thán", posHint: "Thường đứng bên phải chữ.", ex: ["歌 (bài hát)", "歡 (vui mừng)", "次 (lần)", "欲 (mong muốn)"] },
  { no: 77, r: "止", v: "", strokes: 4, cat: "hanh-dong", hv: "Bộ Chỉ", py: "zhǐ", vn: "Bàn chân, dừng lại, bước đi", posHint: "Tượng hình bàn chân có ngón cái.", ex: ["正 (chính xác)", "步 (bước chân)", "歷 (trải qua)", "歸 (trở về)"] },
  { no: 85, r: "水", v: "氵", strokes: 4, cat: "thien-nhien", hv: "Bộ Thủy", py: "shuǐ", vn: "Nước, chất lỏng, sông hồ, biển cả", posHint: "Biến thể 氵 (3 chấm thủy) là một trong những bộ xuất hiện nhiều nhất bên trái chữ Hán.", ex: ["海 (biển)", "灣 (vịnh)", "河 (sông)", "洗 (rửa)"] },
  { no: 86, r: "火", v: "灬", strokes: 4, cat: "thien-nhien", hv: "Bộ Hỏa", py: "huǒ", vn: "Ngọn lửa, sức nóng, đun nấu, đốt cháy", posHint: "Đứng trái là 火; đứng dưới đáy biến thành 灬 (4 chấm hỏa).", ex: ["熱 (nóng)", "燒 (đốt/nướng)", "烤 (nướng)", "燈 (đèn)"] },
  { no: 93, r: "牛", v: "牜", strokes: 4, cat: "dong-thuc-vat", hv: "Bộ Ngưu", py: "niú", vn: "Con trâu, bò, gia súc, vật nuôi", posHint: "Biến thể 牜 đứng bên trái chữ.", ex: ["物 (sự vật)", "特 (đặc biệt)", "牧 (chăn nuôi)"] },
  { no: 94, r: "犬", v: "犭", strokes: 4, cat: "dong-thuc-vat", hv: "Bộ Khuyển", py: "quǎn", vn: "Con chó, loài thú bốn chân, tính chất hoang dã", posHint: "Biến thể 犭 (khuyển gẩy) luôn đứng bên trái chữ chỉ loài thú.", ex: ["狗 (chó)", "貓 (mèo)", "豬 (heo)", "獨 (độc lập)"] },
  { no: 96, r: "玉", v: "王", strokes: 5, cat: "do-vat-nha-cua", hv: "Bộ Ngọc", py: "yù", vn: "Đá quý, ngọc bích, vật trân quý", posHint: "Khi ghép bên trái mất dấu chấm thành 王 (tên gọi 王字旁).", ex: ["現 (hiện tại)", "球 (quả cầu)", "理 (lý lẽ)", "環 (vòng ngọc)"] },
  { no: 102, r: "田", v: "", strokes: 5, cat: "thien-nhien", hv: "Bộ Điền", py: "tián", vn: "Ruộng đất, canh tác, vùng đất", posHint: "Hình ô ruộng vuông vức.", ex: ["男 (đàn ông)", "界 (ranh giới)", "留 (lưu lại)", "畫 (vẽ/tranh)"] },
  { no: 104, r: "疒", v: "", strokes: 5, cat: "hanh-dong", hv: "Bộ Nạch", py: "nè", vn: "Bệnh tật, đau ốm, triệu chứng cơ thể", posHint: "Bao phía trên và bên trái (có 2 nét bên trái giường bệnh).", ex: ["病 (bệnh)", "痛 (đau)", "瘦 (gầy)", "療 (điều trị)"] },
  { no: 108, r: "皿", v: "", strokes: 5, cat: "do-vat-nha-cua", hv: "Bộ Mãnh", py: "mǐn", vn: "Bát đĩa, đồ đựng thức ăn, chậu hộp", posHint: "Thường làm đế ở dưới đáy chữ.", ex: ["盤 (cái đĩa)", "盒 (cái hộp)", "盆 (cái chậu)", "盡 (hết)"] },
  { no: 109, r: "目", v: "", strokes: 5, cat: "con-nguoi", hv: "Bộ Mục", py: "mù", vn: "Con mắt, nhìn ngắm, quan sát", posHint: "Hình con mắt dựng đứng; thường đứng bên trái chữ.", ex: ["看 (nhìn)", "眼 (con mắt)", "睡 (ngủ)", "睛 (con ngươi)"] },
  { no: 112, r: "石", v: "", strokes: 5, cat: "thien-nhien", hv: "Bộ Thạch", py: "shí", vn: "Đá, khoáng vật, cứng rắn", posHint: "Thường đứng bên trái chữ.", ex: ["破 (vỡ)", "硬 (cứng)", "碗 (cái bát)", "確 (chính xác)"] },
  { no: 113, r: "示", v: "礻", strokes: 5, cat: "hanh-dong", hv: "Bộ Thị", py: "shì", vn: "Thần linh, lễ nghi, cầu phúc, chỉ bảo", posHint: "Biến thể 礻 (1 chấm, khác với 衤 2 chấm của Bộ Y).", ex: ["神 (thần)", "福 (hạnh phúc)", "禮 (lễ phép)", "祝 (chúc mừng)"] },
  { no: 115, r: "禾", v: "", strokes: 5, cat: "dong-thuc-vat", hv: "Bộ Hòa", py: "hé", vn: "Cây lúa, mùa màng, ngũ cốc", posHint: "Có nét phẩy trên đỉnh tượng trưng bông lúa trĩu hạt.", ex: ["秋 (mùa thu)", "種 (trồng/loại)", "科 (khoa/môn)", "租 (thuê)"] },
  { no: 116, r: "穴", v: "", strokes: 5, cat: "hanh-dong", hv: "Bộ Huyệt", py: "xué", vn: "Hang động, khoảng trống, cửa sổ", posHint: "Luôn nằm trên đỉnh chữ.", ex: ["空 (trống/trời)", "窗 (cửa sổ)", "穿 (mặc/xuyên)", "究 (nghiên cứu)"] },
  { no: 117, r: "立", v: "", strokes: 5, cat: "hanh-dong", hv: "Bộ Lập", py: "lì", vn: "Đứng thẳng, thiết lập, chờ đợi", posHint: "Hình người đứng thẳng trên mặt đất.", ex: ["站 (đứng/trạm)", "端 (đầu mối)", "章 (chương)", "競 (cạnh tranh)"] },
  { no: 118, r: "竹", v: "⺮", strokes: 6, cat: "dong-thuc-vat", hv: "Bộ Trúc", py: "zhú", vn: "Tre trúc, đồ đan lát, thẻ sách", posHint: "Luôn nằm trên đỉnh chữ thành ⺮.", ex: ["笑 (cười)", "筆 (cây bút)", "算 (tính toán)", "籃 (cái rổ)"] },
  { no: 119, r: "米", v: "", strokes: 6, cat: "dong-thuc-vat", hv: "Bộ Mễ", py: "mǐ", vn: "Hạt gạo, lương thực, bánh kẹo", posHint: "Đứng bên trái hoặc dưới chữ chỉ thực phẩm từ bột/gạo.", ex: ["粉 (bột/bún)", "糖 (đường/kẹo)", "粒 (hạt)", "精 (tinh túy)"] },
  { no: 120, r: "糸", v: "糹", strokes: 6, cat: "do-vat-nha-cua", hv: "Bộ Mịch", py: "mì", vn: "Sợi tơ, dây buộc, dệt may, màu sắc, liên kết", posHint: "Chữ Phồn thể giữ nguyên 糹 (3 chấm dưới) rất đặc trưng.", ex: ["紅 (màu đỏ)", "紙 (giấy)", "練 (luyện tập)", "給 (cho/đưa)"] },
  { no: 123, r: "羊", v: "⺶", strokes: 6, cat: "dong-thuc-vat", hv: "Bộ Dương", py: "yáng", vn: "Con dê/cừu, tốt đẹp, hiền lành", posHint: "Xuất hiện trong chữ Mỹ (美), Nghĩa (義).", ex: ["美 (đẹp)", "群 (đàn/nhóm)", "義 (ý nghĩa)", "羞 (xấu hổ)"] },
  { no: 128, r: "耳", v: "", strokes: 6, cat: "con-nguoi", hv: "Bộ Nhĩ", py: "ěr", vn: "Cái tai, lắng nghe, âm thanh", posHint: "Đứng bên trái hoặc dưới chữ.", ex: ["聽 (nghe)", "聲 (âm thanh)", "聞 (nghe thấy)", "職 (chức vụ)"] },
  { no: 130, r: "肉", v: "⺼(月)", strokes: 6, cat: "con-nguoi", hv: "Bộ Nhục", py: "ròu", vn: "Thịt, các bộ phận cơ thể người", posHint: "Khi ghép chữ biến thành ⺼ (giống chữ 月).", ex: ["臉 (khuôn mặt)", "腳 (bàn chân)", "背 (lưng)", "胖 (béo)"] },
  { no: 137, r: "舟", v: "", strokes: 6, cat: "do-vat-nha-cua", hv: "Bộ Chu", py: "zhōu", vn: "Thuyền bè, tàu thủy, hàng hải", posHint: "Luôn đứng bên trái chữ chỉ phương tiện đường thủy.", ex: ["船 (con thuyền)", "航 (hàng không/hải)", "般 (loại/cách)"] },
  { no: 140, r: "艸", v: "艹", strokes: 6, cat: "dong-thuc-vat", hv: "Bộ Thảo", py: "cǎo", vn: "Cỏ cây, hoa lá, thảo mộc, trà thuốc", posHint: "Biến thể 艹 (thảo đầu) luôn nằm trên đỉnh chữ.", ex: ["花 (hoa)", "茶 (trà)", "菜 (rau/món ăn)", "藥 (thuốc)"] },
  { no: 142, r: "虫", v: "", strokes: 6, cat: "dong-thuc-vat", hv: "Bộ Trùng", py: "chóng", vn: "Côn trùng, loài bò sát, hải sản vỏ cứng", posHint: "Đứng bên trái hoặc dưới chữ.", ex: ["蝦 (tôm)", "蜂 (con ong)", "蝶 (con bướm)", "蚊 (con muỗi)"] },
  { no: 145, r: "衣", v: "衤", strokes: 6, cat: "do-vat-nha-cua", hv: "Bộ Y", py: "yī", vn: "Quần áo, trang phục, vải vóc", posHint: "Biến thể 衤 có 2 nét chấm bên phải (khác với 礻 Bộ Thị chỉ 1 nét).", ex: ["褲 (quần)", "襯 (áo sơ mi)", "被 (chăn/bị)", "袋 (túi)"] },
  { no: 147, r: "見", v: "", strokes: 7, cat: "con-nguoi", hv: "Bộ Kiến", py: "jiàn", vn: "Nhìn thấy, quan sát, gặp gỡ, nhận thức", posHint: "Mắt (目) gắn trên đôi chân người (儿) — Phồn thể giữ nguyên 見.", ex: ["視 (nhìn/tivi)", "覺 (cảm thấy)", "親 (thân thiết)", "觀 (quan sát)"] },
  { no: 149, r: "言", v: "讠", strokes: 7, cat: "con-nguoi", hv: "Bộ Ngôn", py: "yán", vn: "Lời nói, ngôn ngữ, thảo luận, giao tiếp", posHint: "Chữ Phồn thể Đài Loan giữ nguyên 7 nét 言 bên trái.", ex: ["話 (lời nói)", "說 (nói)", "請 (mời)", "謝 (cảm ơn)"] },
  { no: 154, r: "貝", v: "", strokes: 7, cat: "dong-thuc-vat", hv: "Bộ Bối", py: "bèi", vn: "Vỏ sò (tiền cổ), tiền bạc, mua bán, tài sản", posHint: "Chữ Phồn thể giữ nguyên 貝 trong mọi từ kinh tế, tài chính.", ex: ["買 (mua)", "賣 (bán)", "貴 (đắt/quý)", "費 (chi phí)"] },
  { no: 156, r: "走", v: "", strokes: 7, cat: "hanh-dong", hv: "Bộ Tẩu", py: "zǒu", vn: "Đi bộ, chạy, vượt qua", posHint: "Bao phía dưới bên trái chữ.", ex: ["起 (dậy/bắt đầu)", "超 (vượt qua)", "趕 (vội đuổi)", "越 (càng/vượt)"] },
  { no: 157, r: "足", v: "⻊", strokes: 7, cat: "con-nguoi", hv: "Bộ Túc", py: "zú", vn: "Bàn chân, chạy nhảy, đạp, đường đi", posHint: "Biến thể ⻊ nằm bên trái các động từ dùng chân.", ex: ["跑 (chạy)", "跳 (nhảy)", "路 (con đường)", "跟 (đi theo/cùng)"] },
  { no: 159, r: "車", v: "", strokes: 7, cat: "do-vat-nha-cua", hv: "Bộ Xa", py: "chē", vn: "Xe cộ, bánh xe, vận chuyển", posHint: "Phồn thể giữ nguyên 7 nét 車.", ex: ["較 (so sánh)", "輕 (nhẹ)", "轉 (chuyển/rẽ)", "輛 (chiếc xe)"] },
  { no: 162, r: "辵", v: "辶", strokes: 7, cat: "hanh-dong", hv: "Bộ Sước", py: "chuò", vn: "Bước đi chợt dừng, di chuyển, quãng đường", posHint: "Biến thể 辶 (quay xước) bao phía dưới bên trái.", ex: ["近 (gần)", "遠 (xa)", "送 (tiễn/tặng)", "選 (chọn)"] },
  { no: 163, r: "邑", v: "阝(phải)", strokes: 7, cat: "thien-nhien", hv: "Bộ Ấp", py: "yì", vn: "Vùng đất, thành thị, khu dân cư", posHint: "Biến thể 阝 nằm BÊN PHẢI chữ (nhớ: phải = Ấp thành phố).", ex: ["都 (đô thị/đều)", "部 (bộ phận)", "郵 (bưu điện)", "鄰 (hàng xóm)"] },
  { no: 164, r: "酉", v: "", strokes: 7, cat: "do-vat-nha-cua", hv: "Bộ Dậu", py: "yǒu", vn: "Bình rượu, lên men, đồ uống, y dược", posHint: "Thường đứng bên trái chữ.", ex: ["酒 (rượu)", "酸 (chua)", "醫 (y tế)", "醒 (tỉnh táo)"] },
  { no: 167, r: "金", v: "釒", strokes: 8, cat: "thien-nhien", hv: "Bộ Kim", py: "jīn", vn: "Kim loại, vàng bạc, tiền tệ, vật sắc nhọn", posHint: "Biến thể Phồn thể 釒 đứng bên trái chữ.", ex: ["錢 (tiền)", "銀 (bạc/ngân hàng)", "錯 (sai)", "鐘 (đồng hồ)"] },
  { no: 169, r: "門", v: "", strokes: 8, cat: "do-vat-nha-cua", hv: "Bộ Môn", py: "mén", vn: "Cổng lớn hai cánh, cửa ra vào", posHint: "Khung cổng bao bên ngoài chữ.", ex: ["開 (mở)", "關 (đóng)", "間 (gian/giữa)", "聞 (nghe)"] },
  { no: 170, r: "阜", v: "阝(trái)", strokes: 8, cat: "thien-nhien", hv: "Bộ Phụ", py: "fù", vn: "Gò đất, đồi núi, bậc thang lên xuống", posHint: "Biến thể 阝 nằm BÊN TRÁI chữ (nhớ: trái = Phụ đồi núi).", ex: ["院 (viện/sân)", "除 (trừ bỏ)", "陽 (mặt trời)", "階 (bậc thang)"] },
  { no: 173, r: "雨", v: "⻗", strokes: 8, cat: "thien-nhien", hv: "Bộ Vũ", py: "yǔ", vn: "Mưa, mây mù, sấm điện, hiện tượng khí quyển", posHint: "Luôn nằm trên đỉnh các chữ chỉ thời tiết và điện.", ex: ["電 (điện)", "雪 (tuyết)", "雲 (mây)", "需 (cần)"] },
  { no: 181, r: "頁", v: "", strokes: 9, cat: "con-nguoi", hv: "Bộ Hiệt", py: "yè", vn: "Đầu người, khuôn mặt, trang giấy", posHint: "Thường đứng bên phải các chữ chỉ đầu, mặt, suy nghĩ.", ex: ["頭 (cái đầu)", "題 (đề mục)", "顏 (nhan sắc)", "願 (mong ước)"] },
  { no: 184, r: "食", v: "飠", strokes: 9, cat: "do-vat-nha-cua", hv: "Bộ Thực", py: "shí", vn: "Thức ăn, cơm bánh, bữa ăn, nuôi dưỡng", posHint: "Biến thể Phồn thể 飠 đứng bên trái các từ ẩm thực.", ex: ["飯 (cơm)", "館 (quán/nhà hàng)", "餓 (đói)", "飽 (no)"] },
  { no: 187, r: "馬", v: "", strokes: 10, cat: "dong-thuc-vat", hv: "Bộ Mã", py: "mǎ", vn: "Con ngựa, chạy nhanh, vận chuyển", posHint: "Phồn thể giữ 4 chấm chân ngựa và bờm.", ex: ["騎 (cưỡi/lái)", "驗 (kiểm nghiệm)", "驚 (kinh ngạc)", "駐 (đóng trú)"] },
  { no: 195, r: "魚", v: "", strokes: 11, cat: "dong-thuc-vat", hv: "Bộ Ngư", py: "yú", vn: "Con cá, thủy hải sản", posHint: "Phồn thể có 4 chấm đuôi cá bên dưới.", ex: ["鮮 (tươi ngon)", "魯 (lỗ mãng)", "鯨 (cá voi)"] },
  { no: 196, r: "鳥", v: "", strokes: 11, cat: "dong-thuc-vat", hv: "Bộ Điểu", py: "niǎo", vn: "Chim chóc, gia cầm có cánh", posHint: "Tượng hình đầu, mắt, lông vũ và chân chim.", ex: ["雞 (con gà)", "鴨 (con vịt)", "鵝 (con ngỗng)"] }
];

const RADICAL_CATEGORIES = [
  { id: "all", label: "Tất cả bộ thủ", icon: "grid_view" },
  { id: "con-nguoi", label: "👤 Con người & Cơ thể", icon: "accessibility_new" },
  { id: "thien-nhien", label: "🌊 Thiên nhiên & Nguyên tố", icon: "landscape" },
  { id: "dong-thuc-vat", label: "🌿 Động & Thực vật", icon: "Forest" },
  { id: "do-vat-nha-cua", label: "🏠 Đồ vật & Đời sống", icon: "home_work" },
  { id: "hanh-dong", label: "🏃 Hành động & Di chuyển", icon: "directions_walk" }
];

function ensureRadicalNotes() {
  if (!S.notes || !S.noteByKey) return;
  if (S.noteByKey.has("bo-thu~0")) return;
  if (!S.settings) S.settings = { newPerDay: 8, reviewPerDay: 30, decks: {}, bands: {}, extra: {} };
  if (!S.settings.decks) S.settings.decks = {};
  if (S.settings.decks["bo-thu"] === undefined) S.settings.decks["bo-thu"] = false;
  const radDeck = {
    id: "bo-thu",
    name: "Bộ thủ chữ Hán • 部首寶典",
    kind: "vocab",
    badge: "Khang Hy • 部首",
    emoji: "🧩",
    sub: "60 bộ thủ chữ Hán Phồn thể cốt lõi giúp nhớ nhanh cấu trúc và đoán nghĩa từ vựng TOCFL.",
    items: KANGXI_RADICALS.map((rad) => ({
      w: rad.r,
      py: rad.py,
      pos: `Bộ thủ #${rad.no} (${rad.strokes} nét)${rad.v ? " · Biến thể: " + rad.v : ""}`,
      band: "Bộ thủ",
      hv: rad.hv,
      vn: `${rad.hv}${rad.v ? " (" + rad.v + ")" : ""} — ${rad.vn}`,
      en: `Kangxi Radical #${rad.no}`,
      us: rad.posHint,
      co: rad.ex.join(" · "),
      mh: `${rad.hv} (${rad.py}): ${rad.vn}. ${rad.posHint}`,
      e1: `「${rad.r}」${rad.v ? `（${rad.v}）` : ""}常見於：${rad.ex.map(x => x.split(" ")[0]).join("、")}。`,
      e1p: rad.py,
      e1v: `${rad.hv}: ${rad.vn} (Gặp trong: ${rad.ex.join(", ")}).`
    }))
  };
  radDeck.items.forEach((it, i) => {
    const n = { key: `bo-thu~${i}`, deck: radDeck, i, kind: "vocab", rich: true, w: it.w, band: "Bộ thủ", it, isRadical: true, rad: KANGXI_RADICALS[i] };
    S.notes.push(n);
    S.noteByKey.set(n.key, n);
    if (!S.noteByWord.has(it.w)) S.noteByWord.set(it.w, n);
  });
}

let _radQuizState = { active: false, curIdx: 0, choices: [], answered: null, streak: 0, score: 0, total: 0 };
let _radFilterCat = "all";
let _radFilterStrokes = "all";
let _radSearch = "";
let _radWriterChar = null;

function renderRadicalsSectionHTML(isStandalone = false) {
  ensureRadicalNotes();
  const radNotes = folderNotes("bo-thu");
  const learnedCount = radNotes.filter((n) => noteLevel(n) > 0).length;
  const pct = radNotes.length ? Math.round((learnedCount / radNotes.length) * 100) : 0;
  const isOn = folderOn("bo-thu");

  return `
    <div class="flex flex-col gap-space-lg">
      ${isStandalone ? `
        <div class="flex items-center justify-between">
          <a href="#thu-muc" class="text-primary hover:underline text-sm font-semibold flex items-center gap-1.5 no-underline">
            <span class="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Quay lại Trung tâm Từ vựng</span>
          </a>
          <span class="text-xs font-code text-outline">Bộ thủ Khang Hy chuẩn Phồn thể Đài Loan</span>
        </div>
      ` : ""}

      <!-- HERO BANNER BỘ THỦ -->
      <div class="bg-gradient-to-r from-[#7c1d18] via-[#8f241e] to-[#5e1612] text-white p-5 md:p-6 rounded-3xl shadow-md border border-white/15 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div class="flex items-start sm:items-center gap-4">
          <div class="w-14 h-14 md:w-16 md:h-16 rounded-2xl border-2 border-white/80 bg-black/25 flex items-center justify-center text-3xl font-serif font-bold shrink-0 shadow-inner">
            部
          </div>
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold tracking-wider uppercase">Chiết tự &amp; Gốc chữ Hán • 部首寶典</span>
              <span class="px-2.5 py-0.5 rounded-full bg-black/25 text-xs font-code">${learnedCount} / ${KANGXI_RADICALS.length} bộ đã học (${pct}%)</span>
            </div>
            <h2 class="text-2xl md:text-3xl font-bold font-serif tracking-wide text-white mt-0.5">
              Học Bộ Thủ Chữ Hán Trọng Tâm (${KANGXI_RADICALS.length} Bộ Khang Hy)
            </h2>
            <p class="text-xs md:text-sm text-white/85 max-w-2xl">
              Nắm vững các bộ thủ cốt lõi và biến thể (氵, 忄, 扌, 艹, 辶, 衤, 飠...) giúp bạn nhìn chữ đoán nghĩa, nhớ mặt chữ Phồn thể nhanh gấp 3 lần.
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2.5 flex-wrap shrink-0">
          <button type="button" class="px-4 py-2.5 rounded-xl font-bold text-xs bg-white text-[#7c1d18] hover:bg-amber-50 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer" onclick="startStudyFolder('bo-thu')">
            <span class="material-symbols-outlined text-[18px]">play_circle</span>
            <span>Học Flashcard SRS Bộ Thủ</span>
          </button>
          <button type="button" class="px-4 py-2.5 rounded-xl font-semibold text-xs bg-black/30 hover:bg-black/45 text-white border border-white/25 transition-all flex items-center gap-1.5 cursor-pointer" id="btn-toggle-rad-quiz">
            <span class="material-symbols-outlined text-[18px]">quiz</span>
            <span>🎯 Trắc nghiệm nhớ nhanh</span>
          </button>
          <button type="button" class="px-3.5 py-2.5 rounded-xl font-semibold text-xs ${isOn ? "bg-emerald-600/80 text-white" : "bg-white/15 hover:bg-white/25 text-white"} border border-white/20 transition-all cursor-pointer" id="btn-toggle-rad-deck">
            ${isOn ? "✓ Đang bật trong lịch học" : "+ Đưa vào lịch học ngày"}
          </button>
        </div>
      </div>

      <!-- MINI-GAME TRẮC NGHIỆM PHẢN XẠ BỘ THỦ (Ẩn/Hiện) -->
      <div id="rad-quiz-panel" class="${_radQuizState.active ? "flex" : "hidden"} flex-col gap-space-md bg-paper-card p-space-lg rounded-2xl border-2 border-primary/30 shadow-sm"></div>

      <!-- HỘP TẬP VIẾT NÉT BỘ THỦ (HANZI WRITER DRAWER) -->
      <div id="rad-writer-panel" class="${_radWriterChar ? "flex" : "hidden"} flex-col sm:flex-row items-center justify-between gap-4 bg-paper-card p-space-md rounded-2xl border border-secondary/40 shadow-sm"></div>

      <!-- BỘ LỌC NHÓM Ý NGHĨA, SỐ NÉT & TÌM KIẾM -->
      <div class="bg-paper-card p-space-md rounded-2xl border border-border-subtle shadow-xs flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 flex-wrap" id="rad-cat-tabs">
            ${RADICAL_CATEGORIES.map((c) => `
              <button type="button" data-rad-cat="${c.id}" class="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${_radFilterCat === c.id ? "bg-primary-container text-white shadow-xs" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"}">
                ${c.label}
              </button>
            `).join("")}
          </div>
          <div class="flex items-center gap-1 flex-wrap" id="rad-stroke-tabs">
            ${[
              ["all", "Mọi số nét"],
              ["1-2", "1–2 nét"],
              ["3", "3 nét"],
              ["4", "4 nét"],
              ["5-6", "5–6 nét"],
              ["7+", "7+ nét"]
            ].map(([val, lbl]) => `
              <button type="button" data-rad-stk="${val}" class="px-2.5 py-1 rounded-lg text-[11px] font-code font-semibold transition-all cursor-pointer ${_radFilterStrokes === val ? "bg-secondary text-white" : "bg-paper-muted text-outline hover:text-on-surface"}">
                ${lbl}
              </button>
            `).join("")}
          </div>
        </div>
        <div class="relative w-full">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input id="rad-search-input" value="${esc(_radSearch)}" class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-low text-on-surface text-sm placeholder:text-outline border border-border-subtle/60 focus:outline-none focus:bg-white" placeholder="Tìm bộ thủ theo chữ Hán (水), biến thể (氵, 忄, 扌...), tên Hán Việt (Bộ Thủy, Tâm, Ngôn...) hoặc ý nghĩa...">
        </div>
      </div>

      <!-- LƯỚI THẺ BỘ THỦ (3 CỘT) -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md" id="rad-cards-grid"></div>
    </div>
  `;
}

function bindRadicalsSectionEvents(rootEl = document) {
  ensureRadicalNotes();
  const radNotes = folderNotes("bo-thu");
  const noteByRad = new Map(radNotes.map((n) => [n.w, n]));

  const drawWriterPanel = () => {
    const panel = $("#rad-writer-panel", rootEl);
    if (!panel) return;
    if (!_radWriterChar) {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
      return;
    }
    const rad = KANGXI_RADICALS.find((x) => x.r === _radWriterChar) || KANGXI_RADICALS[0];
    const matchingWords = S.notes.filter((n) => !n.isRadical && n.kind === "vocab" && n.w.includes(rad.r)).slice(0, 8);
    panel.classList.remove("hidden");
    panel.classList.add("flex");
    panel.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="flex flex-col items-center gap-1.5 bg-paper-base p-3 rounded-2xl border border-border-subtle shadow-2xs">
          <div id="rad-hw-box" class="w-[110px] h-[110px] flex items-center justify-center"></div>
          <div class="flex gap-1.5">
            <button type="button" id="btn-rad-hw-anim" class="px-2.5 py-1 rounded-lg bg-cinnabar-subtle text-primary text-xs font-semibold cursor-pointer">▶ Xem nét</button>
            <button type="button" id="btn-rad-hw-quiz" class="px-2.5 py-1 rounded-lg bg-jade-subtle text-secondary text-xs font-semibold cursor-pointer">✍️ Viết thử</button>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="text-2xl font-serif font-bold text-primary">${esc(rad.r)}${rad.v ? ` (${esc(rad.v)})` : ""}</span>
            <span class="font-bold text-base text-on-surface">${esc(rad.hv)}</span>
            <span class="font-code text-xs text-tertiary">${esc(rad.py)} • ${rad.strokes} nét</span>
          </div>
          <p class="text-sm text-on-surface font-medium">${esc(rad.vn)}</p>
          <p class="text-xs text-outline">${esc(rad.posHint)}</p>
          ${matchingWords.length ? `
            <div class="flex items-center gap-1.5 flex-wrap mt-1">
              <span class="text-[11px] text-outline font-semibold">Từ vựng trong kho:</span>
              ${matchingWords.map((mw) => `<a href="#tu/${encodeURIComponent(mw.w)}" class="px-2 py-0.5 rounded bg-surface-container hover:bg-cinnabar-subtle text-xs font-serif font-semibold text-on-surface hover:text-primary no-underline">${esc(mw.w)} (${esc(meaningOf(mw).slice(0, 18))})</a>`).join("")}
            </div>
          ` : ""}
        </div>
      </div>
      <button type="button" id="btn-close-rad-writer" class="px-3 py-1.5 rounded-lg bg-surface-container text-xs font-semibold text-outline hover:text-on-surface self-end sm:self-center cursor-pointer">Đóng ✕</button>
    `;
    const hwBox = $("#rad-hw-box", panel);
    if (hwBox && window.HanziWriter) {
      hwBox.innerHTML = "";
      const writer = HanziWriter.create(hwBox, rad.r, {
        width: 108, height: 108, padding: 6, showOutline: true,
        strokeColor: "#86090a", outlineColor: "#EBE2D8", highlightColor: "#176b4b",
        charDataLoader: (ch, onLoad, onErr) => strokeData(ch).then(onLoad).catch(onErr)
      });
      const bAnim = $("#btn-rad-hw-anim", panel);
      if (bAnim) bAnim.onclick = () => writer.animateCharacter();
      const bQuiz = $("#btn-rad-hw-quiz", panel);
      if (bQuiz) bQuiz.onclick = () => writer.quiz();
    }
    const bClose = $("#btn-close-rad-writer", panel);
    if (bClose) bClose.onclick = () => { _radWriterChar = null; drawWriterPanel(); };
  };

  const nextQuizQuestion = () => {
    const idx = Math.floor(Math.random() * KANGXI_RADICALS.length);
    const target = KANGXI_RADICALS[idx];
    const distractors = KANGXI_RADICALS.filter((_, i) => i !== idx).sort(() => Math.random() - 0.5).slice(0, 3);
    const choices = [target, ...distractors].sort(() => Math.random() - 0.5);
    _radQuizState.curIdx = idx;
    _radQuizState.choices = choices;
    _radQuizState.answered = null;
    drawQuizPanel();
  };

  const drawQuizPanel = () => {
    const panel = $("#rad-quiz-panel", rootEl);
    if (!panel) return;
    if (!_radQuizState.active) {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
      return;
    }
    panel.classList.remove("hidden");
    panel.classList.add("flex");
    if (!_radQuizState.choices.length) {
      nextQuizQuestion();
      return;
    }
    const target = KANGXI_RADICALS[_radQuizState.curIdx];
    const answered = _radQuizState.answered;
    panel.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border-subtle">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-full bg-cinnabar-subtle text-primary text-xs font-bold">🎯 Luyện phản xạ Bộ Thủ</span>
          <span class="text-xs font-code text-outline">Đúng: <strong>${_radQuizState.score}/${_radQuizState.total}</strong> • Chuỗi: 🔥 <strong>${_radQuizState.streak}</strong></span>
        </div>
        <button type="button" id="btn-close-rad-quiz" class="text-xs text-outline hover:text-on-surface font-semibold cursor-pointer">Đóng ✕</button>
      </div>
      <div class="flex flex-col md:flex-row items-center justify-between gap-6 py-2">
        <div class="flex flex-col items-center text-center min-w-[200px] p-4 rounded-2xl bg-paper-base border border-border-subtle">
          <span class="text-xs text-outline uppercase font-semibold">Bộ thủ #${target.no} (${target.strokes} nét)</span>
          <div class="text-6xl font-serif font-bold text-primary my-2">${esc(target.r)}${target.v ? ` <span class="text-3xl text-secondary">(${esc(target.v)})</span>` : ""}</div>
          <button type="button" class="text-xs text-secondary hover:underline font-semibold flex items-center gap-1 cursor-pointer" onclick="say('${esc(target.r)}')">
            <span class="material-symbols-outlined text-[16px]">volume_up</span> Nghe âm (${esc(target.py)})
          </button>
        </div>
        <div class="flex-1 w-full flex flex-col gap-2.5">
          <div class="text-sm font-semibold text-on-surface">Bộ thủ trên mang tên Hán Việt và ý nghĩa nào?</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            ${_radQuizState.choices.map((ch, i) => {
              const isTarget = ch.r === target.r;
              const isPicked = answered === ch.r;
              let cls = "p-3 rounded-xl border text-left transition-all flex flex-col gap-0.5 cursor-pointer ";
              if (answered) {
                if (isTarget) cls += "bg-jade-subtle border-secondary text-secondary font-bold";
                else if (isPicked) cls += "bg-cinnabar-subtle border-primary text-primary line-through";
                else cls += "bg-surface-container-low border-border-subtle opacity-60";
              } else {
                cls += "bg-surface-container-low hover:bg-surface-container border-border-subtle text-on-surface";
              }
              return `
                <button type="button" data-rad-ans="${esc(ch.r)}" class="${cls}" ${answered ? "disabled" : ""}>
                  <span class="text-xs font-bold">${"ABCD"[i]}. ${esc(ch.hv)} (${esc(ch.py)})</span>
                  <span class="text-xs">${esc(ch.vn)}</span>
                </button>
              `;
            }).join("")}
          </div>
          ${answered ? `
            <div class="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div class="text-xs ${answered === target.r ? "text-secondary" : "text-primary"} font-semibold">
                ${answered === target.r ? "✓ Chính xác! Đã cộng tiến độ nhớ cho " + esc(target.hv) : "✕ Chưa đúng! Đáp án là " + esc(target.hv) + ": " + esc(target.vn)}
                • Ví dụ: ${esc(target.ex.join(", "))}
              </div>
              <button type="button" id="btn-next-rad-quiz" class="px-4 py-1.5 rounded-xl bg-primary-container text-white text-xs font-semibold hover:bg-primary cursor-pointer">Câu tiếp theo →</button>
            </div>
          ` : ""}
        </div>
      </div>
    `;
    const bClose = $("#btn-close-rad-quiz", panel);
    if (bClose) bClose.onclick = () => { _radQuizState.active = false; drawQuizPanel(); };
    const bNext = $("#btn-next-rad-quiz", panel);
    if (bNext) bNext.onclick = nextQuizQuestion;
    panel.querySelectorAll("[data-rad-ans]").forEach((btn) => {
      btn.onclick = async () => {
        const picked = btn.dataset.radAns;
        _radQuizState.answered = picked;
        _radQuizState.total++;
        const ok = picked === target.r;
        if (ok) {
          _radQuizState.score++;
          _radQuizState.streak++;
          if (typeof playChime === "function") playChime(true);
          say(target.r);
          const n = noteByRad.get(target.r);
          if (n) await applyWordLevel(n, Math.min(5, Math.max(2, noteLevel(n) + 1)));
        } else {
          _radQuizState.streak = 0;
          if (typeof playChime === "function") playChime(false);
        }
        drawQuizPanel();
        drawCards();
      };
    });
  };

  const drawCards = () => {
    const grid = $("#rad-cards-grid", rootEl);
    if (!grid) return;
    const q = fold(_radSearch);
    const filtered = KANGXI_RADICALS.filter((rad) => {
      if (_radFilterCat !== "all" && rad.cat !== _radFilterCat) return false;
      if (_radFilterStrokes === "1-2" && rad.strokes > 2) return false;
      if (_radFilterStrokes === "3" && rad.strokes !== 3) return false;
      if (_radFilterStrokes === "4" && rad.strokes !== 4) return false;
      if (_radFilterStrokes === "5-6" && (rad.strokes < 5 || rad.strokes > 6)) return false;
      if (_radFilterStrokes === "7+" && rad.strokes < 7) return false;
      if (!q) return true;
      return (
        rad.r.includes(_radSearch.trim()) ||
        (rad.v && rad.v.includes(_radSearch.trim())) ||
        fold(rad.hv).includes(q) ||
        fold(rad.py).includes(q) ||
        fold(rad.vn).includes(q) ||
        fold(rad.ex.join(" ")).includes(q)
      );
    });

    grid.innerHTML = filtered.map((rad) => {
      const n = noteByRad.get(rad.r);
      const lvl = n ? noteLevel(n) : 0;
      return `
        <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle hover:border-primary/40 shadow-xs hover:shadow-md transition-all flex flex-col justify-between gap-3">
          <div class="flex flex-col gap-2">
            <!-- Top Row: Radical Box + Title + Level Pill -->
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="w-14 h-14 rounded-2xl bg-cinnabar-subtle text-primary border border-primary/20 flex flex-col items-center justify-center shrink-0 shadow-2xs">
                  <span class="font-serif text-3xl font-bold leading-none">${esc(rad.r)}</span>
                  ${rad.v ? `<span class="text-[11px] font-serif font-semibold text-secondary mt-0.5">${esc(rad.v)}</span>` : ""}
                </div>
                <div class="flex flex-col">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-headline-md text-base font-bold text-on-surface">${esc(rad.hv)}</span>
                    <span class="font-code text-xs text-tertiary font-semibold">${esc(rad.py)}</span>
                    <button type="button" class="text-secondary hover:text-primary p-0.5 cursor-pointer" onclick="say('${esc(rad.r)}')" title="Nghe phát âm bộ thủ">
                      <span class="material-symbols-outlined text-[16px]">volume_up</span>
                    </button>
                  </div>
                  <div class="text-[11px] font-code text-outline">
                    Khang Hy #${rad.no} • ${rad.strokes} nét${rad.v ? ` • Biến thể: <strong class="text-secondary">${esc(rad.v)}</strong>` : ""}
                  </div>
                </div>
              </div>
              <span class="pill lv-${lvl} shrink-0">${esc(LEVELS[lvl])}</span>
            </div>

            <!-- Meaning & Position Hint -->
            <div class="text-sm font-semibold text-on-surface">${esc(rad.vn)}</div>
            <div class="text-xs text-on-surface-variant bg-surface-container-low p-2.5 rounded-xl border border-border-subtle/50 leading-relaxed">
              💡 ${esc(rad.posHint)}
            </div>

            <!-- Example Characters -->
            <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span class="text-[11px] text-outline font-semibold">Chữ tiêu biểu:</span>
              ${rad.ex.map((exItem) => {
                const ch = exItem.split(" ")[0];
                return `<a href="#tu/${encodeURIComponent(ch)}" class="px-2 py-0.5 rounded-lg bg-paper-muted hover:bg-cinnabar-subtle text-on-surface hover:text-primary text-xs font-medium no-underline transition-colors">${esc(exItem)}</a>`;
              }).join("")}
            </div>
          </div>

          <!-- Bottom Actions: Write Strokes, Level Select, Study Card -->
          <div class="pt-2.5 border-t border-border-subtle/60 flex items-center justify-between gap-2 flex-wrap">
            <button type="button" data-rad-write="${esc(rad.r)}" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-jade-subtle text-on-surface hover:text-secondary text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer">
              <span class="material-symbols-outlined text-[15px]">draw</span>
              <span>Tập viết nét</span>
            </button>
            <div class="flex items-center gap-1.5">
              <select data-rad-lvl="${esc(rad.r)}" class="text-[11px] font-medium bg-paper-base border border-border-subtle rounded-lg px-2 py-1 text-on-surface cursor-pointer" title="Đặt mức nhớ SRS">
                ${LEVELS.map((lName, idx) => `<option value="${idx}"${lvl === idx ? " selected" : ""}>${esc(lName)}</option>`).join("")}
              </select>
              <button type="button" onclick="startStudyWord('${esc(rad.r)}')" class="px-2.5 py-1 rounded-lg bg-primary-container text-white hover:bg-primary text-xs font-semibold cursor-pointer">
                Học →
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("") || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy bộ thủ nào khớp với bộ lọc hiện tại.</div>`;

    grid.querySelectorAll("[data-rad-write]").forEach((btn) => {
      btn.onclick = () => {
        _radWriterChar = btn.dataset.radWrite;
        drawWriterPanel();
        $("#rad-writer-panel", rootEl)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    });

    grid.querySelectorAll("[data-rad-lvl]").forEach((sel) => {
      sel.onchange = async () => {
        const n = noteByRad.get(sel.dataset.radLvl);
        if (n) {
          await applyWordLevel(n, Number(sel.value));
          drawCards();
        }
      };
    });
  };

  const bQuiz = $("#btn-toggle-rad-quiz", rootEl);
  if (bQuiz) {
    bQuiz.onclick = () => {
      _radQuizState.active = !_radQuizState.active;
      if (_radQuizState.active && !_radQuizState.choices.length) nextQuizQuestion();
      else drawQuizPanel();
    };
  }

  const bDeck = $("#btn-toggle-rad-deck", rootEl);
  if (bDeck) {
    bDeck.onclick = async () => {
      setFolderOn("bo-thu", !folderOn("bo-thu"));
      await saveSettings();
      if (location.hash === "#thu-muc/bo-thu") VIEWS["thu-muc"]("bo-thu");
      else {
        bDeck.textContent = folderOn("bo-thu") ? "✓ Đang bật trong lịch học" : "+ Đưa vào lịch học ngày";
      }
    };
  }

  rootEl.querySelectorAll("[data-rad-cat]").forEach((btn) => {
    btn.onclick = () => {
      _radFilterCat = btn.dataset.radCat;
      rootEl.querySelectorAll("[data-rad-cat]").forEach((b) => {
        b.className = b.dataset.radCat === _radFilterCat
          ? "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer bg-primary-container text-white shadow-xs"
          : "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer bg-surface-container-low text-on-surface-variant hover:bg-surface-container";
      });
      drawCards();
    };
  });

  rootEl.querySelectorAll("[data-rad-stk]").forEach((btn) => {
    btn.onclick = () => {
      _radFilterStrokes = btn.dataset.radStk;
      rootEl.querySelectorAll("[data-rad-stk]").forEach((b) => {
        b.className = b.dataset.radStk === _radFilterStrokes
          ? "px-2.5 py-1 rounded-lg text-[11px] font-code font-semibold transition-all cursor-pointer bg-secondary text-white"
          : "px-2.5 py-1 rounded-lg text-[11px] font-code font-semibold transition-all cursor-pointer bg-paper-muted text-outline hover:text-on-surface";
      });
      drawCards();
    };
  });

  const sInp = $("#rad-search-input", rootEl);
  if (sInp) {
    sInp.oninput = () => {
      _radSearch = sInp.value;
      drawCards();
    };
  }

  drawWriterPanel();
  drawQuizPanel();
  drawCards();
}

// =========================================================================
// 3. THƯ MỤC TỪ VỰNG & FLASHCARD SRS (Exact Stitch Design + Luxury Emerald Topics)
// =========================================================================
VIEWS["thu-muc"] = (id) => {
  ensureRadicalNotes();
  const vocab = S.notes.filter((n) => n.kind === "vocab");
  const c = todayCounts();

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 1: XEM CHI TIẾT MỘT THƯ MỤC CỤ THỂ (id)
  // -------------------------------------------------------------
  if (id) {
    if (id === "bo-thu") {
      setView(`<div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg">${renderRadicalsSectionHTML(true)}</div>`);
      bindRadicalsSectionEvents(document);
      return;
    }
    if (id === "hay-quen") {
      const weakNotes = vocab.filter((n) => noteLapses(n) > 0 || noteLevel(n) === 1);
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
                    <span class="text-outline">Quên: ${noteLapses(n)} lần</span>
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
    const topicDef = String(id).startsWith("cd-") ? (S.topics || []).find((x) => x.id === id) : null;
    const title = isBand ? `TOCFL ${id} (${BAND_INFO[id] || ""})` : (id === "cua-toi" ? "Thư mục của tôi" : (id === "viet-tat" ? "Từ viết tắt" : (deck ? deck.name : (topicDef ? `Chủ đề · ${topicDef.vn} ${topicDef.zh}` : id))));
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
              ${bulkLevelHTML(id, true)}
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
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border whitespace-nowrap ${filterLvl === -1 ? 'bg-[#22c55e] text-zinc-950 border-transparent' : 'bg-[#181d1a] text-zinc-300 border-[#2b3931] hover:bg-[#202723]'}" data-lvl="-1">
                  Tất cả (${ns.length})
                </button>
                ${LEVELS.map((label, lvlIdx) => (lvlIdx === 0 || lvlIdx === 2 || lvlIdx === 4 || lv[lvlIdx] > 0) ? `
                  <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border whitespace-nowrap ${filterLvl === lvlIdx ? 'bg-[#22c55e] text-zinc-950 border-transparent' : 'bg-[#181d1a] text-zinc-300 border-[#2b3931] hover:bg-[#202723]'}" data-lvl="${lvlIdx}">
                    ${esc(label)} (${lv[lvlIdx]})
                  </button>
                ` : '').join('')}
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
                <button type="button" class="w-8 h-8 rounded-full bg-white/5 hover:bg-[#22c55e]/20 text-zinc-300 hover:text-[#4ade80] flex items-center justify-center transition-colors" title="Phát âm tiếng Đài Loan" onclick="event.stopPropagation(); say('${esc(it.w)}');">
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

      bindBulkLevel(id, () => VIEWS["thu-muc"](id));
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
            ${bulkLevelHTML(id, false)}
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
    bindBulkLevel(id, () => VIEWS["thu-muc"](id));
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
  // TRƯỜNG HỢP 2: TRANG TỔNG QUAN TỪ VỰNG (đơn giản: Tra nhanh | Thư mục + Tiến độ)
  // -------------------------------------------------------------
  const lvAll = [0, 0, 0, 0, 0, 0];
  vocab.forEach((n) => lvAll[noteLevel(n)]++);
  const totalVocab = Math.max(1, vocab.length);

  const folderStat = (ns) => {
    const l = ns.filter((n) => noteLevel(n) > 0).length;
    return { learned: l, total: ns.length, pct: ns.length ? Math.round((l / ns.length) * 100) : 0 };
  };
  const mkFolder = (id, cat, iconText, title, sub, ns) => ({ id, cat, iconText, title, sub, ...folderStat(ns), isBand: S.bands.includes(id), isLearning: folderOn(id) });
  const decks = S.decks || [];
  const lopDecks = decks.filter((d) => d.id.startsWith("lop-"));
  const ownDecks = decks.filter((d) => !d.id.startsWith("lop-") && d.category !== "topic" && !d.id.startsWith("band-") && d.id !== "tu-viet-tat");
  const topicDecks = decks.filter((d) => d.category === "topic" || d.id.startsWith("band-"));
  const allFolderItems = [
    mkFolder("cua-toi", "personal", "我", "Thư mục của tôi", "Tất cả từ có giải thích đầy đủ, từ tự thêm và từ trong hộp nhận.", folderNotes("cua-toi")),
    ...lopDecks.map((d) => mkFolder(d.id, "lop", d.kind === "grammar" ? "法" : "課", d.name, d.kind === "grammar" ? "Ngữ pháp chép trong vở lớp học." : "Từ chép trong vở lớp học.", folderNotes(d.id))),
    ...ownDecks.map((d) => mkFolder(d.id, "personal", "冊", d.name, d.sub || "Bộ từ đã nhập.", folderNotes(d.id))),
    mkFolder("viet-tat", "personal", "臺", "Khẩu ngữ & từ viết tắt Đài Loan", "北車, 健保, 高鐵… (nguồn 萌典)", folderNotes("viet-tat")),
    ...(S.topics || []).map((tp) => mkFolder(tp.id, "topics", tp.icon || "題", tp.vn, `${tp.zh} · ${fmt(tp.words.length)} từ, từ Novice đến C`, folderNotes(tp.id))),
    ...topicDecks.map((d) => mkFolder(d.id, "topics", d.emoji || "題", d.name, d.sub || "Từ theo chủ đề.", folderNotes(d.id))),
    ...S.bands.map((b) => mkFolder(b, "bands", b.replace("Novice ", "N"), `TOCFL ${b}`, BAND_INFO[b] || "", vocab.filter((n) => inBand(n, b)))),
    mkFolder("bo-thu", "radicals", "部", "Bộ thủ chữ Hán", "Bộ thủ cốt lõi và biến thể (氵, 忄, 扌, 艹, 辶…), tập viết và trắc nghiệm.", folderNotes("bo-thu"))
  ];
  const CATS = [
    ["all", "Tất cả"], ["personal", "Của tôi"], ["lop", "Lớp học"], ["topics", "Chủ đề"], ["bands", "TOCFL"], ["radicals", "Bộ thủ"]
  ];
  const catCount = (k) => k === "all" ? allFolderItems.length : allFolderItems.filter((f) => f.cat === k).length;
  const pillCls = (on) => on
    ? "px-3 py-1 rounded-full bg-primary-container text-on-primary text-label-sm font-label-sm font-semibold shadow-sm"
    : "px-3 py-1 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted text-label-sm font-label-sm border border-border-subtle/70 transition-colors";

  const bandRows = S.bands.map((b) => {
    const s = folderStat(vocab.filter((n) => inBand(n, b)));
    return `
      <a href="#thu-muc/${encodeURIComponent(b)}" class="flex flex-col gap-1 no-underline group">
        <div class="flex justify-between text-xs">
          <span class="font-semibold text-on-surface group-hover:text-primary">${esc(b)}</span>
          <span class="font-code text-outline">${fmt(s.learned)} / ${fmt(s.total)} · ${s.pct}%</span>
        </div>
        <div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden"><div class="h-full bg-secondary rounded-full" style="width:${s.pct}%"></div></div>
      </a>`;
  }).join("");
  const lvColors = ["bg-outline/40", "bg-tertiary-fixed-dim", "bg-tertiary", "bg-secondary-fixed-dim", "bg-secondary", "bg-primary-container"];

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg">
      <section class="flex flex-col sm:flex-row sm:items-end justify-between gap-space-md pb-space-md border-b border-border-subtle/70">
        <div>
          <h1 class="font-display text-display text-on-surface tracking-tight font-semibold">Từ vựng <span class="text-outline font-normal text-2xl">詞彙</span></h1>
          <p class="font-body-md text-body-md text-on-surface-variant">Tra từ, chọn thư mục để học, xem tiến độ.</p>
        </div>
        <div class="flex flex-wrap items-center gap-space-sm">
          <a href="#nhap" class="px-space-md py-2.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface hover:bg-paper-muted text-label-md font-label-md shadow-sm flex items-center gap-1.5 no-underline">
            <span class="material-symbols-outlined text-[18px] text-outline">file_upload</span><span>Nhập bộ từ</span>
          </a>
          <a href="#hoc" class="px-space-lg py-2.5 rounded-lg bg-primary-container text-on-primary hover:bg-primary text-label-md font-label-md shadow-[0_2px_8px_rgba(168,38,31,0.25)] flex items-center gap-2 no-underline">
            <span class="material-symbols-outlined text-[18px]">play_circle</span>
            <span class="font-semibold">Học hôm nay</span>
            <span class="px-1.5 py-0.5 rounded-full bg-on-primary/20 font-code text-[11px]">${fmt(c.total)} thẻ · ${fmt(c.due)} ôn · ${fmt(c.fresh)} mới</span>
          </a>
        </div>
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        <!-- Cột trái: Tra từ nhanh -->
        <aside class="lg:col-span-4 xl:col-span-3 lg:sticky lg:top-24">
          <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle/70 shadow-[0_2px_12px_rgba(44,42,41,0.04)] flex flex-col gap-space-sm">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[18px] text-tertiary">search</span>
                <span class="font-headline-md text-on-surface font-semibold">Tra từ nhanh</span>
              </div>
              <kbd class="px-1.5 py-0.5 rounded bg-surface-container text-outline font-code text-[10px]">Alt + D</kbd>
            </div>
            <div class="relative">
              <input class="w-full pl-3 pr-8 py-2 rounded-xl bg-paper-base border border-border-subtle focus:border-primary-container focus:ring-2 focus:ring-primary-container/20 text-body-md text-on-surface outline-none" id="quick-search-input" placeholder="Chữ Hán, pinyin hoặc nghĩa…" type="search" autocomplete="off"/>
              <button type="button" class="absolute right-2.5 top-2.5 text-outline hover:text-on-surface hidden" id="btn-clear-quick-search" title="Xóa">
                <span class="material-symbols-outlined text-[16px]">cancel</span>
              </button>
            </div>
            <div class="flex flex-col gap-1 max-h-[65vh] overflow-y-auto" id="quick-search-preview"></div>
          </div>
        </aside>

        <!-- Cột phải: Thư mục + Tiến độ -->
        <div class="lg:col-span-8 xl:col-span-9 flex flex-col gap-space-lg">
          <section class="flex flex-col gap-space-md">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
              <div class="flex items-center gap-1.5 flex-wrap" id="folderTabs">
                ${CATS.filter(([k]) => catCount(k)).map(([k, t]) => `<button type="button" class="${pillCls(k === "all")}" data-tab="${k}">${t} (${catCount(k)})</button>`).join("")}
              </div>
              <input id="folderSearchInput" class="w-full md:w-60 px-3 py-1.5 rounded-xl bg-paper-card border border-border-subtle focus:border-primary-container text-body-sm text-on-surface outline-none" placeholder="Tìm thư mục…" type="search"/>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md" id="stitch-folders-grid"></div>
          </section>

          <details class="bg-paper-card rounded-2xl border border-border-subtle/70 shadow-[0_2px_12px_rgba(44,42,41,0.04)]" id="tv-progress">
            <summary class="cursor-pointer select-none p-space-md flex items-center justify-between font-headline-md text-on-surface font-semibold">
              <span class="flex items-center gap-2"><span class="material-symbols-outlined text-[20px] text-primary">insights</span>Tiến độ</span>
              <span class="font-code text-xs text-outline font-normal">${fmt(Math.max(0, vocab.length - lvAll[0]))} / ${fmt(vocab.length)} từ đã học</span>
            </summary>
            <div class="px-space-md pb-space-md grid grid-cols-1 md:grid-cols-2 gap-space-lg">
              <div class="flex flex-col gap-space-sm">
                <span class="text-label-sm font-label-sm text-outline">Theo cấp TOCFL</span>
                ${bandRows}
              </div>
              <div class="flex flex-col gap-space-sm">
                <span class="text-label-sm font-label-sm text-outline">Phân bổ 6 cấp nhớ</span>
                <div class="w-full h-3 rounded-full bg-surface-container flex overflow-hidden">
                  ${lvAll.map((v, i) => `<div class="h-full ${lvColors[i]}" style="width:${(v / totalVocab) * 100}%" title="${esc(LEVELS[i])}: ${fmt(v)}"></div>`).join("")}
                </div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  ${lvAll.map((v, i) => `<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm ${lvColors[i]}"></span><span class="text-on-surface-variant">${esc(LEVELS[i])}</span><span class="font-code text-outline ml-auto">${fmt(v)}</span></span>`).join("")}
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  `);

  // Tra từ nhanh: danh sách tối đa 10 kết quả
  const renderQuickLookup = () => {
    const inp = $("#quick-search-input");
    const box = $("#quick-search-preview");
    if (!inp || !box) return;
    const raw = inp.value.trim();
    const clr = $("#btn-clear-quick-search");
    if (clr) clr.classList.toggle("hidden", !raw);
    if (!raw) {
      box.innerHTML = `<p class="text-xs text-outline p-2 leading-relaxed">Gõ chữ Hán (考試), pinyin không dấu (kaoshi) hoặc nghĩa tiếng Việt (thi). Bấm vào từ để xem giải thích đầy đủ.</p>`;
      return;
    }
    const q = fold(raw);
    const scored = [];
    for (const n of vocab) {
      const w = fold(n.w);
      let s = -1;
      if (w === q) s = 0;
      else if (w.startsWith(q)) s = 1;
      else if (w.includes(q)) s = 2;
      else {
        const py = fold(itemOf(n).py || "");
        if (py === q) s = 1;
        else if (py.startsWith(q)) s = 3;
        else if (q.length >= 2 && fold(meaningOf(n)).includes(q)) s = 4;
      }
      if (s >= 0) { scored.push([s, n.w.length, n]); if (scored.length > 400) break; }
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const top = scored.slice(0, 10).map((x) => x[2]);
    if (!top.length) {
      box.innerHTML = `<div class="text-xs text-outline p-3 text-center">Không tìm thấy. <a href="#tu-dien" class="text-primary">Tra từ điển đầy đủ →</a></div>`;
      return;
    }
    box.innerHTML = top.map((n) => {
      const it = itemOf(n);
      const lvl = noteLevel(n);
      return `
        <div class="p-2 rounded-xl hover:bg-surface-container-low flex items-start gap-2 border-b border-border-subtle/40 last:border-0">
          <a href="#tu/${encodeURIComponent(n.w)}" class="flex-1 min-w-0 no-underline">
            <div class="flex items-baseline gap-1.5 flex-wrap">
              <span class="text-lg font-bold text-on-surface">${esc(n.w)}</span>
              <span class="font-code text-xs text-tertiary-container">${esc(it.py || "")}</span>
            </div>
            <div class="text-xs text-on-surface-variant line-clamp-2">${esc(meaningOf(n))}</div>
            <div class="text-[10px] text-outline mt-0.5">${esc(it.band && S.bands.includes(it.band) ? `TOCFL ${it.band}` : (n.deck ? n.deck.name : (it.band || "Từ vựng")))} · ${esc(LEVELS[lvl])}</div>
          </a>
          <div class="flex flex-col gap-1 shrink-0">
            <button type="button" class="p-1 rounded text-primary hover:bg-surface-container" data-say="${esc(n.w)}" title="Phát âm"><span class="material-symbols-outlined text-[16px]">volume_up</span></button>
            <button type="button" class="p-1 rounded text-secondary hover:bg-surface-container" data-study="${esc(n.w)}" title="Học từ này"><span class="material-symbols-outlined text-[16px]">play_arrow</span></button>
          </div>
        </div>`;
    }).join("");
    box.querySelectorAll("[data-say]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); say(b.dataset.say); }; });
    box.querySelectorAll("[data-study]").forEach((b) => { b.onclick = () => startStudyWord(b.dataset.study); });
  };

  // Lưới thư mục
  let curCat = "all";
  const renderFolderCards = () => {
    const q = fold($("#folderSearchInput")?.value || "");
    const grid = $("#stitch-folders-grid");
    if (!grid) return;
    const filtered = allFolderItems.filter((f) => (curCat === "all" || f.cat === curCat) && (!q || fold(f.title).includes(q) || fold(f.sub).includes(q)));
    grid.innerHTML = filtered.map((f) => `
      <div class="bg-paper-card rounded-2xl p-space-md border border-border-subtle/70 shadow-[0_2px_8px_rgba(44,42,41,0.03)] hover:shadow-md transition-shadow flex flex-col gap-space-sm group">
        <div class="flex items-start gap-space-sm">
          <a href="#thu-muc/${encodeURIComponent(f.id)}" class="w-10 h-10 shrink-0 rounded-xl bg-surface-container text-on-surface flex items-center justify-center no-underline font-headline-md font-bold">${esc(f.iconText)}</a>
          <div class="min-w-0 flex-1">
            <a href="#thu-muc/${encodeURIComponent(f.id)}" class="no-underline"><h3 class="font-semibold text-on-surface group-hover:text-primary leading-snug">${esc(f.title)}</h3></a>
            <p class="text-xs text-on-surface-variant line-clamp-2">${esc(f.sub)}</p>
          </div>
          ${f.isBand ? `<button type="button" class="shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold border ${f.isLearning ? "bg-jade-subtle text-secondary border-secondary/30" : "bg-paper-muted text-outline border-border-subtle"}" data-toggle-band="${esc(f.id)}">${f.isLearning ? "Đang học" : "+ Bật"}</button>` : ""}
        </div>
        <div class="mt-auto">
          <div class="flex justify-between text-xs mb-1"><span class="text-outline">Đã học</span><span class="font-code text-on-surface font-semibold">${fmt(f.learned)} / ${fmt(f.total)} (${f.pct}%)</span></div>
          <div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden"><div class="h-full rounded-full bg-secondary" style="width:${f.pct}%"></div></div>
        </div>
        <div class="flex items-center justify-between pt-space-xs border-t border-border-subtle/50">
          <a href="#thu-muc/${encodeURIComponent(f.id)}" class="text-xs text-primary hover:underline font-semibold no-underline">Xem từ →</a>
          <button type="button" class="px-3 py-1.5 rounded-lg bg-primary-container text-on-primary text-label-sm font-semibold hover:bg-primary flex items-center gap-1 shadow-sm" data-study-folder="${esc(f.id)}">
            <span class="material-symbols-outlined text-[16px]">play_arrow</span><span>Học</span>
          </button>
        </div>
      </div>
    `).join("") || `<div class="col-span-full p-8 text-center text-sm text-outline bg-paper-card rounded-2xl border border-border-subtle">Không tìm thấy thư mục nào khớp.</div>`;
    grid.querySelectorAll("[data-study-folder]").forEach((b) => { b.onclick = () => startStudyFolder(b.dataset.studyFolder); });
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

  renderQuickLookup();
  renderFolderCards();

  const qInput = $("#quick-search-input");
  let qTimer = 0;
  if (qInput) qInput.oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(renderQuickLookup, 120); };
  const qClear = $("#btn-clear-quick-search");
  if (qClear) qClear.onclick = () => { if (qInput) { qInput.value = ""; qInput.focus(); renderQuickLookup(); } };
  const fSearch = $("#folderSearchInput");
  if (fSearch) fSearch.oninput = renderFolderCards;
  document.querySelectorAll("#folderTabs button").forEach((btn) => {
    btn.onclick = () => {
      curCat = btn.dataset.tab || "all";
      document.querySelectorAll("#folderTabs button").forEach((b) => { b.className = pillCls(b.dataset.tab === curCat); });
      renderFolderCards();
    };
  });

  // Alt + D: đưa con trỏ vào ô Tra từ nhanh
  window.onkeydown = (e) => {
    if (!location.hash.startsWith("#thu-muc") && location.hash !== "#tu-vung") return;
    if (e.altKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      const inp = $("#quick-search-input");
      if (inp) { inp.focus(); inp.select(); }
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
  const name = S.bands.includes(T.id) ? `TOCFL ${T.id}` : (T.id === "cua-toi" ? "Thư mục của tôi" : (T.id === "viet-tat" ? "Từ viết tắt" : (((S.topics || []).find((x) => x.id === T.id) || {}).vn || ((S.decks || []).find((d) => d.id === T.id) || {}).name || T.id)));
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
      zh: "你沒有明天要考試嗎？為什麼不看書？",
      py: "Nǐ méiyǒu míngtiān yào kǎoshì ma? Wèishénme bù kànshū?",
      reason: 'Sai vì dùng "沒有...嗎" để hỏi phản vấn khẳng định. Phải dùng "不是...嗎" (chẳng phải... sao).'
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
      reason: 'Sai vì sau 與其 phải đi kèm cặp với "不如", không dùng "還是".'
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

function loadCustomGrammarNotes() {
  try {
    const raw = localStorage.getItem("custom_grammar_notes");
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    const existing = new Set(GRAMMAR_MASTER_LIST.map(g => g.id));
    for (const item of arr) {
      if (item && item.id && !existing.has(item.id)) {
        GRAMMAR_MASTER_LIST.push(item);
        existing.add(item.id);
      }
    }
  } catch (e) {}
}

function saveCustomGrammarNotes() {
  try {
    const customs = GRAMMAR_MASTER_LIST.filter(g => String(g.id || "").startsWith("custom_"));
    localStorage.setItem("custom_grammar_notes", JSON.stringify(customs));
  } catch (e) {}
}

// Helpers
window.checkPractice = function(choice) {
  const resultDiv = document.getElementById("practice-result");
  if (!resultDiv) return;
  const current = GRAMMAR_MASTER_LIST.find(g => g.id === window.ACTIVE_GRAMMAR_ID) || GRAMMAR_MASTER_LIST[0];
  const opt = current.quiz.opts.find(o => o.key === choice) || current.quiz.opts[0];

  if (opt.correct) {
    resultDiv.className = "mt-space-sm p-space-sm rounded-lg font-body-sm text-body-sm bg-jade-subtle text-secondary block border border-secondary/20 shadow-xs";
    resultDiv.innerHTML = opt.explain;
    if (typeof playChime === "function") playChime(true);
  } else {
    resultDiv.className = "mt-space-sm p-space-sm rounded-lg font-body-sm text-body-sm bg-cinnabar-subtle text-primary block border border-primary/20 shadow-xs";
    resultDiv.innerHTML = opt.explain;
    if (typeof playChime === "function") playChime(false);
  }
};

window.selectGrammarSpotlight = function(id) {
  window.ACTIVE_GRAMMAR_ID = id;
  const h = "#ngu-phap/" + encodeURIComponent(id);
  if (location.hash !== h) { location.hash = h; return; }
  const el = document.getElementById("grammar-spotlight-container");
  if (el) {
    const item = GRAMMAR_MASTER_LIST.find(g => g.id === id) || GRAMMAR_MASTER_LIST[0];
    el.innerHTML = renderSpotlightContent(item);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  updateGrammarGrid();
};

window.filterGrammarTab = function(level, btnEl) {
  window.ACTIVE_GRAMMAR_FILTER = level;
  document.querySelectorAll(".grammar-tab-btn").forEach(b => {
    const isAct = (btnEl ? b === btnEl : b.dataset && b.dataset.gband === level);
    b.className = isAct
      ? "grammar-tab-btn px-3 py-1 rounded-full bg-primary-container text-on-primary font-label-sm text-xs font-semibold whitespace-nowrap shadow-xs transition-colors"
      : "grammar-tab-btn px-3 py-1 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted font-label-sm text-xs font-medium whitespace-nowrap border border-border-subtle/70 transition-colors";
  });
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
  } catch (e) {}
  if (window.ACTIVE_GRAMMAR_ID === id) {
    const el = document.getElementById("grammar-spotlight-container");
    const item = GRAMMAR_MASTER_LIST.find(g => g.id === id);
    if (el && item) el.innerHTML = renderSpotlightContent(item);
  }
  const statSaved = document.getElementById("grammar-saved-stat");
  if (statSaved) statSaved.textContent = fmt(window.GRAMMAR_BOOKMARKS.size);
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
    freq: "Tự tạo",
    summary: note.trim() || "Mẫu ngữ pháp tự ghi chú vào sổ tay cá nhân.",
    cond1: { title: "Ghi chú cá nhân", desc: note.trim() || "Cần ôn tập thường xuyên." },
    cond2: { title: "Cấu trúc áp dụng", desc: formula.trim() || "Áp dụng trong bài đọc và hội thoại." },
    wrong: { zh: "", py: "", reason: "Chưa ghi nhận lỗi sai." },
    correct: { zh: name.trim(), py: "", reason: "Mẫu câu do bạn tự bổ sung." },
    examples: [],
    quiz: { q: name.trim(), opts: [{ key: "ok", label: "Đã thuộc", correct: true, explain: "Tuyệt vời!" }] }
  });
  saveCustomGrammarNotes();
  window.GRAMMAR_BOOKMARKS.add(customId);
  try {
    localStorage.setItem("bookmarked_grammar", JSON.stringify(Array.from(window.GRAMMAR_BOOKMARKS)));
  } catch (e) {}
  const statSaved = document.getElementById("grammar-saved-stat");
  if (statSaved) statSaved.textContent = fmt(window.GRAMMAR_BOOKMARKS.size);
  selectGrammarSpotlight(customId);
  renderSidebarNotebook();
};

function renderSpotlightContent(item) {
  const isBookmarked = window.GRAMMAR_BOOKMARKS.has(item.id);
  const exHtml = (item.examples || []).map(ex => `
    <div class="p-3 rounded-xl bg-paper-base hover:bg-surface-container-low transition-colors flex items-start justify-between gap-3 border border-border-subtle/50">
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="font-headline-md text-base md:text-lg text-on-surface font-semibold font-serif">${esc(ex.zh)}</span>
          ${ex.tag ? `<span class="font-label-sm text-[11px] font-medium px-2 py-0.5 rounded bg-${ex.tagColor || 'cinnabar-subtle'} ${ex.tagText || 'text-primary'}">${esc(ex.tag)}</span>` : ''}
        </div>
        <div class="font-code text-xs text-outline mt-0.5">${esc(ex.py)}</div>
        <div class="font-body-md text-sm text-on-surface-variant mt-0.5">${esc(ex.vn)}</div>
      </div>
      <button type="button" class="w-9 h-9 rounded-full bg-paper-card text-on-surface-variant hover:text-primary shadow-xs flex items-center justify-center transition-colors shrink-0 border border-border-subtle/60" onclick="say('${esc(ex.zh).replace(/'/g, "\\\'")}')" title="Nghe phát âm chuẩn Đài Loan">
        <span class="material-symbols-outlined text-[18px]">volume_up</span>
      </button>
    </div>
  `).join("");

  const quizOptsHtml = (item.quiz && item.quiz.opts || []).map(opt => `
    <button type="button" class="px-3.5 py-1.5 rounded-lg bg-surface-container hover:bg-cinnabar-subtle hover:text-primary font-body-md text-sm text-on-surface transition-colors" onclick="checkPractice('${opt.key}')">
      ${esc(opt.label)}
    </button>
  `).join("");

  return `
    <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border-subtle/60">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="px-2.5 py-0.5 rounded-full bg-jade-subtle text-secondary font-label-sm text-xs font-semibold">${esc(item.band)}</span>
        <h2 class="font-headline-md text-lg md:text-xl text-on-surface font-semibold font-serif">${esc(item.name)}</h2>
      </div>
      <button type="button" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg ${isBookmarked ? 'bg-amber-subtle text-tertiary' : 'bg-paper-base text-outline hover:text-primary'} font-label-sm text-xs font-semibold transition-colors border border-border-subtle/60" onclick="toggleGrammarBookmark('${item.id}')">
        <span class="material-symbols-outlined text-[16px]">${isBookmarked ? 'bookmark' : 'bookmark_add'}</span>
        <span>${isBookmarked ? 'Đã lưu sổ tay' : 'Lưu sổ tay'}</span>
      </button>
    </div>

    <div class="mt-3 p-3 rounded-xl bg-paper-base border border-border-subtle/70 font-code text-sm md:text-base text-primary font-bold">
      ${esc(item.formula)}
    </div>
    <p class="font-body-sm text-sm text-on-surface-variant mt-2 leading-relaxed">${esc(item.summary)}</p>

    <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
      <div class="p-3 rounded-lg bg-surface-container-low border border-border-subtle/50">
        <div class="flex items-center gap-1 text-on-surface font-label-md text-xs font-semibold mb-1">
          <span class="material-symbols-outlined text-secondary text-[16px]">check_circle</span>
          ${esc(item.cond1.title)}
        </div>
        <p class="font-body-sm text-xs text-on-surface-variant leading-relaxed">${esc(item.cond1.desc)}</p>
      </div>
      <div class="p-3 rounded-lg bg-surface-container-low border border-border-subtle/50">
        <div class="flex items-center gap-1 text-on-surface font-label-md text-xs font-semibold mb-1">
          <span class="material-symbols-outlined text-secondary text-[16px]">transform</span>
          ${esc(item.cond2.title)}
        </div>
        <p class="font-body-sm text-xs text-on-surface-variant leading-relaxed">${esc(item.cond2.desc)}</p>
      </div>
    </div>

    ${(item.wrong && item.wrong.zh) || (item.correct && item.correct.zh) ? `
    <div class="mt-4">
      <h3 class="font-headline-md text-sm font-semibold text-on-surface mb-2 flex items-center gap-1.5">
        <span class="material-symbols-outlined text-primary text-[18px]">troubleshoot</span>
        Tránh bẫy đề thi TOCFL (Sai vs Đúng)
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        ${item.wrong && item.wrong.zh ? `
        <div class="p-3 rounded-xl bg-cinnabar-subtle/60 border border-primary/20 flex flex-col justify-between gap-1.5">
          <div>
            <div class="text-primary font-label-sm text-[11px] font-bold uppercase mb-0.5">✕ Sai ngữ pháp</div>
            <div class="font-serif text-base text-on-surface line-through decoration-primary/60">${esc(item.wrong.zh)}</div>
            <div class="font-code text-[11px] text-outline">${esc(item.wrong.py)}</div>
          </div>
          <p class="text-xs text-on-surface-variant bg-paper-card/80 p-2 rounded">${esc(item.wrong.reason)}</p>
        </div>` : ''}
        <div class="p-3 rounded-xl bg-jade-subtle border border-secondary/20 flex flex-col justify-between gap-1.5">
          <div>
            <div class="text-secondary font-label-sm text-[11px] font-bold uppercase mb-0.5">✓ Chuẩn Đài Loan</div>
            <div class="font-serif text-base text-secondary font-semibold">${esc(item.correct.zh)}</div>
            <div class="font-code text-[11px] text-on-secondary-container">${esc(item.correct.py)}</div>
          </div>
          <p class="text-xs text-on-surface-variant bg-paper-card/80 p-2 rounded">${esc(item.correct.reason)}</p>
        </div>
      </div>
    </div>` : ''}

    ${exHtml ? `
    <div class="mt-4">
      <h3 class="font-headline-md text-sm font-semibold text-on-surface mb-2 flex items-center gap-1.5">
        <span class="material-symbols-outlined text-secondary text-[18px]">record_voice_over</span>
        Ví dụ thực tế Đài Loan
      </h3>
      <div class="space-y-2">${exHtml}</div>
    </div>` : ''}

    ${item.quiz ? `
    <div class="mt-4 p-3.5 rounded-xl bg-cinnabar-subtle/35 border border-primary/20">
      <div class="font-label-md text-xs text-primary font-bold flex items-center gap-1.5 mb-2">
        <span class="material-symbols-outlined text-[16px]">quiz</span>
        Luyện tập nhanh
      </div>
      <div class="bg-paper-card p-3 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 border border-border-subtle/50">
        <div class="font-serif text-base text-on-surface font-medium">${esc(item.quiz.q)}</div>
        <div class="flex items-center gap-2 flex-wrap">${quizOptsHtml}</div>
      </div>
      <div class="hidden mt-2 p-2.5 rounded-lg font-body-sm text-xs" id="practice-result"></div>
    </div>` : ''}
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
      <div class="text-center py-8 text-on-surface-variant bg-paper-card rounded-xl border border-border-subtle">
        <span class="material-symbols-outlined text-[32px] text-outline mb-1">search_off</span>
        <p class="text-sm">Không tìm thấy cấu trúc phù hợp với "${esc(q)}".</p>
      </div>
    `;
    return;
  }

  const BAND_GROUPS = [
    { key: "A1/A2", label: "Band A · Sơ cấp (A1–A2)", badge: "bg-jade-subtle text-secondary" },
    { key: "B1", label: "Band B · Trung cấp (B1)", badge: "bg-cinnabar-subtle text-primary" },
    { key: "B2", label: "Band B · Cao cấp (B2)", badge: "bg-amber-subtle text-tertiary" },
    { key: "C", label: "Band C · Lưu loát (C1–C2)", badge: "bg-primary-container text-on-primary" },
    { key: "Khẩu ngữ", label: "Khẩu ngữ Đài Loan & Ghi chú", badge: "bg-surface-container text-on-surface" }
  ];

  const renderCard = (g, badgeCls) => {
    const isBookmarked = window.GRAMMAR_BOOKMARKS.has(g.id);
    const isCurrent = g.id === window.ACTIVE_GRAMMAR_ID;
    return `
      <div class="bg-paper-card rounded-xl p-3.5 transition-all cursor-pointer border ${isCurrent ? 'border-primary ring-2 ring-primary/15 shadow-sm' : 'border-border-subtle/80 hover:border-primary/40 hover:shadow-xs'} flex items-start justify-between gap-2.5" onclick="selectGrammarSpotlight('${g.id}')">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded ${badgeCls} font-label-sm text-[11px] font-semibold">${esc(g.band)}</span>
            <h3 class="font-headline-md text-sm font-semibold text-on-surface font-serif truncate">${esc(g.name)}</h3>
          </div>
          <div class="font-code text-xs text-primary mt-1 truncate">${esc(g.formula)}</div>
          <p class="font-body-sm text-xs text-on-surface-variant mt-1 line-clamp-1">${esc(g.summary)}</p>
        </div>
        <button type="button" class="w-8 h-8 rounded-lg shrink-0 ${isBookmarked ? 'text-tertiary bg-amber-subtle' : 'text-outline hover:text-primary hover:bg-cinnabar-subtle'} flex items-center justify-center transition-colors" onclick="event.stopPropagation(); toggleGrammarBookmark('${g.id}')" title="${isBookmarked ? 'Bỏ lưu sổ tay' : 'Lưu vào sổ tay'}">
          <span class="material-symbols-outlined text-[18px]">${isBookmarked ? 'bookmark' : 'bookmark_border'}</span>
        </button>
      </div>
    `;
  };

  const groupsToRender = BAND_GROUPS
    .map(grp => ({ ...grp, items: filtered.filter(g => g.levelGroup === grp.key) }))
    .filter(grp => grp.items.length > 0);

  container.innerHTML = groupsToRender.map(grp => `
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-on-surface-variant uppercase tracking-wide flex items-center gap-1.5">
          <span class="w-1.5 h-3.5 rounded-full bg-primary inline-block"></span>
          ${esc(grp.label)}
        </span>
        <span class="font-code text-[11px] text-outline">${grp.items.length} mẫu</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        ${grp.items.map(g => renderCard(g, grp.badge)).join("")}
      </div>
    </div>
  `).join("");
}

function renderSidebarNotebook() {
  const container = document.getElementById("sidebar-notebook-items");
  const countEl = document.getElementById("sidebar-notebook-count");
  if (countEl) countEl.textContent = `${window.GRAMMAR_BOOKMARKS.size} mục`;
  if (!container) return;

  const bookmarkedList = GRAMMAR_MASTER_LIST.filter(g => window.GRAMMAR_BOOKMARKS.has(g.id));
  if (bookmarkedList.length === 0) {
    container.innerHTML = `
      <div class="p-3 text-center text-xs text-outline bg-paper-base rounded-lg border border-border-subtle/50">
        Chưa có mẫu câu nào được ghim. Nhấn biểu tượng bookmark để lưu mẫu cần nhớ.
      </div>
    `;
    return;
  }

  container.innerHTML = bookmarkedList.slice(0, 8).map(g => `
    <div class="p-2.5 rounded-lg bg-paper-base hover:bg-surface-container transition-colors group cursor-pointer border border-border-subtle/40 flex items-center justify-between gap-2" onclick="selectGrammarSpotlight('${g.id}')">
      <div class="flex flex-col min-w-0">
        <span class="font-headline-md text-xs text-on-surface font-semibold group-hover:text-primary font-serif truncate">${esc(g.name)}</span>
        <span class="font-code text-[11px] text-outline truncate">${esc(g.formula)}</span>
      </div>
      <span class="material-symbols-outlined text-tertiary text-[16px] shrink-0">bookmark</span>
    </div>
  `).join("");
}

function grammarStatsHTML() {
  const notes = S.notes.filter((n) => n.kind === "grammar");
  const lv = notes.map(noteLevel);
  const learning = lv.filter((l) => l > 0).length;
  const end = dayStart(Date.now()) + DAY; let due = 0;
  for (const n of notes) for (const [t] of typesOf(n)) { const st = S.srs.get(cardId(n, t)); if (st && st.state !== "new" && st.due < end) due++; }
  const saved = (window.GRAMMAR_BOOKMARKS || new Set()).size;
  return `
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="px-3 py-1.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface-variant">
        Bài giảng: <strong class="text-on-surface font-code">${fmt(GRAMMAR_MASTER_LIST.length)}</strong>
      </span>
      ${notes.length ? `<a href="#thu-muc/lop-ngu-phap-dot1" class="px-3 py-1.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface-variant hover:border-primary no-underline">
        Thẻ ôn SRS: <strong class="text-on-surface font-code">${fmt(learning)}/${fmt(notes.length)}</strong>
      </a>` : ''}
      ${due ? `<a href="#hoc" class="px-3 py-1.5 rounded-lg bg-cinnabar-subtle border border-primary/30 text-primary font-semibold no-underline">
        Đến hạn: <strong class="font-code">${fmt(due)}</strong> thẻ →
      </a>` : ''}
      <span class="px-3 py-1.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface-variant">
        Sổ tay: <strong id="grammar-saved-stat" class="text-on-surface font-code">${fmt(saved)}</strong>
      </span>
    </div>
  `;
}

// Mẫu ngữ pháp soạn thêm (nguồn: du-lieu-tu-vung/ngu-phap/*.json → tools/build_ngu_phap.py → data/ngu-phap.json)
async function ensureGrammarData() {
  if (window._grammarDataLoaded) return false;
  window._grammarDataLoaded = true;
  try {
    const res = await fetch("data/ngu-phap.json", { cache: "no-cache" });
    if (!res.ok) return false;
    const arr = await res.json();
    const ids = new Set(GRAMMAR_MASTER_LIST.map(g => g.id));
    let added = 0;
    for (const it of arr) if (it && it.id && !ids.has(it.id)) { GRAMMAR_MASTER_LIST.push(it); ids.add(it.id); added++; }
    return added > 0;
  } catch (e) { return false; }
}

VIEWS["ngu-phap"] = (arg) => {
  if (!window._grammarDataLoaded) {
    ensureGrammarData().then((changed) => { if (changed && location.hash.startsWith("#ngu-phap")) VIEWS["ngu-phap"](arg); });
  }
  loadCustomGrammarNotes();
  try {
    const saved = localStorage.getItem("bookmarked_grammar");
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) window.GRAMMAR_BOOKMARKS = new Set(arr);
    }
  } catch (e) {}

  if (arg) {
    const item = GRAMMAR_MASTER_LIST.find(g => g.id === arg);
    if (item) {
      window.ACTIVE_GRAMMAR_ID = item.id;
      const idx = GRAMMAR_MASTER_LIST.indexOf(item);
      const prev = GRAMMAR_MASTER_LIST[idx - 1], next = GRAMMAR_MASTER_LIST[idx + 1];
      setView(`
        <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-md w-full">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <a href="#ngu-phap" class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-semibold flex items-center gap-1 no-underline"><span class="material-symbols-outlined text-[18px]">arrow_back</span>Danh sách ngữ pháp</a>
            <div class="flex items-center gap-2 text-sm">
              ${prev ? `<a href="#ngu-phap/${encodeURIComponent(prev.id)}" class="px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-surface-container no-underline text-on-surface">← ${esc(prev.name)}</a>` : ""}
              ${next ? `<a href="#ngu-phap/${encodeURIComponent(next.id)}" class="px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-surface-container no-underline text-on-surface">${esc(next.name)} →</a>` : ""}
            </div>
          </div>
          <article class="bg-paper-card rounded-2xl p-space-lg shadow-xs border border-border-subtle" id="grammar-spotlight-container">
            ${renderSpotlightContent(item)}
          </article>
        </div>
      `);
      return;
    }
  }
  const curFilter = window.ACTIVE_GRAMMAR_FILTER || "all";
  const countBy = (k) => k === "all" ? GRAMMAR_MASTER_LIST.length : GRAMMAR_MASTER_LIST.filter(g => g.levelGroup === k).length;
  const tabCls = (on) => on
    ? "grammar-tab-btn px-3 py-1 rounded-full bg-primary-container text-on-primary font-label-sm text-xs font-semibold whitespace-nowrap shadow-xs transition-colors"
    : "grammar-tab-btn px-3 py-1 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted font-label-sm text-xs font-medium whitespace-nowrap border border-border-subtle/70 transition-colors";
  const TABS = [
    ["all", "Tất cả"],
    ["A1/A2", "Band A · A1/A2"],
    ["B1", "Band B · B1"],
    ["B2", "Band B · B2"],
    ["C", "Band C"],
    ["Khẩu ngữ", "Khẩu ngữ Đài Loan"]
  ];

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg w-full">
      <!-- Compact Header -->
      <section class="flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-space-md border-b border-border-subtle/70">
        <div>
          <h1 class="font-display text-2xl md:text-3xl text-on-surface font-semibold tracking-tight font-serif">
            Học Ngữ pháp tiếng Hoa Phồn thể <span class="text-outline font-normal text-xl">文法</span>
          </h1>
          <p class="font-body-sm text-sm text-on-surface-variant mt-1">
            Tổng hợp mẫu câu chia theo Band TOCFL (A1/A2, B1, B2) và khẩu ngữ Đài Loan.
          </p>
        </div>
        <div class="relative w-full md:w-72">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline pointer-events-none">search</span>
          <input class="w-full h-10 pl-9 pr-3 rounded-xl bg-paper-card text-on-surface text-sm placeholder:text-outline border border-border-subtle focus:outline-none focus:border-primary" placeholder="Tìm mẫu câu (把, 被, 與其...)" type="search" id="grammarSearchInput" value="${esc(window.GRAMMAR_SEARCH_QUERY || "")}" oninput="filterGrammarSearch(this.value)"/>
        </div>
      </section>

      <!-- Band Level Filter Bar + Compact Stats -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-1.5 flex-wrap">
          ${TABS.map(([k, lbl]) => `<button type="button" data-gband="${k}" class="${tabCls(curFilter === k)}" onclick="filterGrammarTab('${k}', this)">${lbl} (${countBy(k)})</button>`).join("")}
        </div>
        ${grammarStatsHTML()}
      </div>

      <!-- Main 2-Column Layout -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        <div class="lg:col-span-8 flex flex-col gap-space-lg">
          <!-- Band-grouped Grammar Directory -->
          <section class="flex flex-col gap-4" id="grammar-cards-grid"></section>

        </div>

        <!-- Compact Sidebar -->
        <aside class="lg:col-span-4 flex flex-col gap-space-md w-full">
          <div class="bg-paper-card rounded-2xl p-space-md shadow-xs border border-border-subtle">
            <div class="flex items-center justify-between pb-2 border-b border-border-subtle/60">
              <h3 class="font-headline-md text-sm text-on-surface font-semibold font-serif flex items-center gap-1.5">
                <span class="material-symbols-outlined text-primary text-[18px]">stylus_note</span>
                Sổ tay ngữ pháp của bạn
              </h3>
              <span class="px-2 py-0.5 rounded-full bg-paper-base text-outline font-code text-xs font-semibold" id="sidebar-notebook-count">0 mục</span>
            </div>
            <div class="mt-2.5 space-y-1.5" id="sidebar-notebook-items"></div>
            <button type="button" class="w-full mt-3 py-2 rounded-xl border border-dashed border-outline/40 hover:border-primary text-outline hover:text-primary font-label-md text-xs font-semibold transition-colors flex items-center justify-center gap-1" onclick="promptAddGrammarNote()">
              <span class="material-symbols-outlined text-[16px]">edit_note</span>
              <span>Thêm ghi chú mới</span>
            </button>
          </div>

          <details open class="bg-paper-card rounded-2xl p-space-md shadow-xs border border-border-subtle">
            <summary class="cursor-pointer select-none flex items-center gap-2 font-headline-md text-sm font-semibold text-on-surface font-serif">
              <span class="material-symbols-outlined text-primary text-[18px]">lightbulb</span>
              Mẹo thi TOCFL Band B
            </summary>
            <div class="mt-3 space-y-2 text-xs text-on-surface-variant leading-relaxed">
              <div class="p-2.5 rounded-lg bg-paper-base border border-border-subtle/50">
                <strong class="text-primary block">1. Bẫy liên từ tương phản</strong>
                Chú ý cặp <strong class="text-on-surface">儘管…卻/還是</strong> và <strong class="text-on-surface">固然…但是</strong>.
              </div>
              <div class="p-2.5 rounded-lg bg-paper-base border border-border-subtle/50">
                <strong class="text-secondary block">2. Thời gian &amp; Địa điểm trước hành động</strong>
                Cụm <strong class="text-on-surface">在 + Địa điểm</strong> luôn đứng trước động từ chính.
              </div>
              <div class="p-2.5 rounded-lg bg-paper-base border border-border-subtle/50">
                <strong class="text-tertiary block">3. Bổ ngữ kết quả vs khả năng</strong>
                Phân biệt <strong class="text-on-surface">看懂</strong> (đã hiểu) với <strong class="text-on-surface">看得懂 / 看不懂</strong> (có thể / không thể hiểu).
              </div>
            </div>
          </details>
        </aside>
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

function showcaseItemOf(w) {
  const n = noteOfWord(w);
  const e = cedFirst(w) || (n ? cedFirst(n.w) : null);
  const customVi = S.vi ? (S.vi.get(w) || formsOf(w).map((f) => S.vi.get(f)).find(Boolean)) : null;
  const it = n
    ? itemOf(n)
    : Object.assign({}, customVi || {}, {
        w,
        py: (customVi && customVi.py) || (e ? e[0][0] : (w === "璀璨" ? "cuǐ càn" : "")),
        vn: (customVi && customVi.vn) || (w === "璀璨" ? "Mô tả sắc ngọc quý toả ánh sáng lấp lánh rạng ngời, hoa lệ rực rỡ tuyệt mỹ." : ""),
        hv: (customVi && customVi.hv) || (w === "璀璨" ? "Tuy Xán" : ""),
        en: e ? e[0][1].split("/").join("; ") : (w === "璀璨" ? "bright and resplendent; glittering" : ""),
        pos: (customVi && customVi.pos) || (w === "璀璨" ? "Tính từ (形容詞)" : "Từ vựng"),
        band: (customVi && customVi.band) || (w === "璀璨" ? "C1 • Lưu loát" : "")
      });
  return { n, e, inLearn: !!(n && inLearning(n)), it };
}

// Shared helper to render the Stitch 7+5 Master Dictionary Showcase for any word `w`
function buildStitchWordShowcaseHTML(w) {
  const { n, e, inLearn, it } = showcaseItemOf(w);
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
                  ${formatDecompHTML(ch)}
                </div>
              `).join("")}
            </div>
          </div>

          <!-- Live Moedict (Bộ Giáo dục Đài Loan - 萌典) -->
          <div id="moedictLiveBox" class="p-space-md bg-paper-base rounded-xl border border-border-subtle/70 flex flex-col gap-1.5 relative z-10 text-xs text-outline">
            Đang tải dữ liệu chuẩn Bộ Giáo dục Đài Loan (萌典)…
          </div>

          <!-- Real-World Taiwanese Context Examples with Audio -->
          <div class="flex flex-col gap-space-sm relative z-10">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1.5">
                <span class="material-symbols-outlined text-primary text-[18px]">format_quote</span>
                Ví dụ câu chuẩn ngữ cảnh Đài Loan
              </span>
              <span class="font-label-sm text-label-sm text-outline">Câu ví dụ</span>
            </div>
            <div class="flex flex-col gap-space-sm">
              <div class="p-space-md rounded-xl bg-paper-base hover:bg-surface-container-low transition-colors flex flex-col gap-space-xs">
                ${(() => {
                  const tb = tbclInfo(w);
                  const own = it.e1 || "";
                  const exZh = own || tbclSentence(w, tb);
                  const exPy = (own ? it.e1p : "") || (exZh ? pinyinProOf(exZh) : "");
                  const exVn = (own ? it.e1v : "") || (S.viEx && S.viEx[exZh]) || "";
                  const extra = tb && (tb.lv || tb.cmp) ? `<p class="text-xs text-secondary font-medium">${tb.lv ? `TBCL Cấp ${esc(tb.lv)}` : ""}${tb.lv && tb.cmp ? " · " : ""}${tb.cmp ? `Từ ghép: ${esc(tb.cmp)}` : ""}</p>` : "";
                  if (!exZh) return `<p class="text-sm text-outline">Từ này chưa có câu ví dụ.</p>${extra}`;
                  return `
                  <div class="flex items-center justify-between gap-2">
                    <p class="font-headline-md text-headline-md text-on-surface font-normal" lang="zh-Hant">${esc(exZh)}</p>
                    <button type="button" class="p-1 rounded-full text-on-surface-variant hover:text-primary hover:bg-paper-card transition-colors shrink-0" onclick="say('${esc(exZh)}')" title="Nghe câu ví dụ">
                      <span class="material-symbols-outlined text-[18px]">volume_up</span>
                    </button>
                  </div>
                  <p class="font-code text-body-sm text-outline">${esc(exPy)}</p>
                  <p class="font-body-md text-body-md text-on-surface-variant">${exVn ? esc(exVn) : '<span class="text-xs text-outline">Câu này chưa có bản dịch tiếng Việt.</span>'}</p>
                  ${extra}`;
                })()}
              </div>
            </div>
          </div>

          ${richDetailHTML(it, { lessonOpen: true })}

          <!-- 6 Memory Rating Buttons for this word -->
          ${n ? `
            <div class="pt-space-md border-t border-border-subtle flex flex-col gap-2 relative z-10">
              <div class="flex items-center justify-between text-xs text-outline font-semibold uppercase">
                <span>Mức độ ghi nhớ hiện tại</span>
                <span class="text-primary font-bold" data-cur-level>${LEVELS[curLvl]}</span>
              </div>
              <div class="grades-6">
                ${[0, 1, 2, 3, 4, 5].map((lvl) => {
                  const isCur = curLvl === lvl;
                  const hints = ["Đặt lại", "Ôn lại ngay", "1–6 ngày", "7–20 ngày", "21–89 ngày", "90+ ngày"];
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
  const { n, it } = showcaseItemOf(w);
  const chars = [...new Set([...hanOnly(w)])];
  if (!chars.length && w) chars.push(w[0]);
  host.innerHTML = buildStitchWordShowcaseHTML(w);
  host._showcaseWord = w;
  fetchMoedictLive(w, host);
  if (S.ready && (!n || needsRich(n))) {
    Promise.all([ensureVi([w]), ensureRich([w])]).then(([a, b]) => {
      if ((a || b) && host._showcaseWord === w && (!document.contains || document.contains(host))) {
        renderStitchWordShowcase(w, containerSelector, onRefresh);
      }
    }).catch(() => {});
  }

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

  const refreshShowcase = (newW) => renderStitchWordShowcase(newW, "#stitch-dict-showcase", refreshShowcase);
  const updateAll = (qVal) => {
    const topMatch = searchDict(qVal);
    const showcaseWord = topMatch || (isHan(clean(qVal)) ? clean(qVal) : initialWord);
    refreshShowcase(showcaseWord);
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
  const q = typeof toTraditionalTw === "function" ? toTraditionalTw(clean(raw)) : clean(raw);
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
    const res = await fetch("data/tocfl_band_b_5_de.json");
    if (res.ok) {
      const data = await res.json();
      const tests = Array.isArray(data) ? data : (data && data.tests);
      if (Array.isArray(tests) && tests.length) {
        window._MOCK_TESTS = tests;
        try { await Store.put("kv", "mockTests", tests); } catch (e) {}
        return tests;
      }
    }
  } catch (e) {}
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
      <h1 class="font-headline-lg text-2xl font-bold text-on-surface">Thi thử TOCFL Band B</h1>
      <p class="text-on-surface-variant">Đang tải 5 bộ đề TOCFL Band B Phồn thể chính thức (Đề 1 – Đề 5)...</p>
      <label class="inline-flex items-center gap-2 self-start px-5 py-2.5 rounded-xl bg-primary-container hover:bg-primary text-on-primary font-semibold cursor-pointer">
        <span class="material-symbols-outlined text-[20px]">upload_file</span><span>Nạp gói đề thi JSON</span>
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
  window._dialoguePlayId = (window._dialoguePlayId || 0) + 1;
  const playId = window._dialoguePlayId;
  if (window._dialogueTimer) { clearTimeout(window._dialogueTimer); window._dialogueTimer = null; }
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
    if (window._dialoguePlayId !== playId) return;
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
      if (window._dialoguePlayId !== playId) return;
      window._dialogueTimer = setTimeout(speakNext, 220);
    };
    u.onerror = () => {
      if (window._dialoguePlayId !== playId) return;
      window._dialogueTimer = setTimeout(speakNext, 100);
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
      basic: true,
      inbox: true,
      w: word,
      forms: [word],
      display: word,
      py: py || "",
      pos: "N",
      band: band || "Hộp thư",
      bands: new Set([band || "Hộp thư"]),
      theme: "Sổ từ của tôi",
      key: "t~" + word,
      idx: Date.now()
    };
    S.notes.push(note);
    S.noteByWord.set(word, note);
    S.noteByKey.set(note.key, note);
    if (S.vi && !S.vi.has(word)) {
      S.vi.set(word, { vn: vn || "", py: py || "", hv: "" });
    }
    const entry = { w: word, py: py || "", note: vn || "", hv: "", pos: "Từ vựng", where: "Chép chính tả", at: Date.now() };
    if (!S.inbox) S.inbox = new Map();
    S.inbox.set("inbox_" + word, entry);
    try { await Store.put("inbox", "inbox_" + word, entry); } catch (e) {}
  }

  if (typeof applyCardLevel === "function") {
    await applyCardLevel(note, typesOf(note)[0][0], 1, false);
  }
  try { await saveSettings(); } catch (e) {}

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
    bandFilter: "all",
    topicCategory: "all",
    passageId: "dia_copier_repair",
    sentenceIdx: 0,
    score: { ok: 0, total: 0 },
    doneMap: {},
    showDetails: true,
    checked: false,
    viewMode: "dictation",
    explorerOpen: true,
    _lastPlayedKey: ""
  }, S.dict || {});
  if (!d.doneMap) d.doneMap = {};

  const allTopics = await getDictationTopics();
  const selId = decodeURIComponent(location.hash).startsWith("#chinh-ta/") ? decodeURIComponent(location.hash).slice("#chinh-ta/".length) : "";
  if (selId && selId !== d.passageId && allTopics.some(t => t.id === selId)) { d.passageId = selId; d.sentenceIdx = 0; d.checked = false; d._lastPlayedKey = ""; }
  const inLesson = !!selId;
  const topicBandOf = (t) => {
    const b = String(t.band || "");
    if (b.includes("A1") || b.includes("A2") || b.includes("Band A")) return "A";
    if (b.includes("B2")) return "B2";
    if (b.includes("B1")) return "B1";
    if (b.includes("C")) return "C";
    return "B1";
  };

  const curTopic = allTopics.find(t => t.id === d.passageId) || allTopics[0];
  d.curTopic = curTopic;
  if (!d.doneMap[curTopic.id]) d.doneMap[curTopic.id] = {};
  const topicDone = d.doneMap[curTopic.id];

  if (d.sentenceIdx >= curTopic.sentences.length) d.sentenceIdx = 0;
  const curSent = curTopic.sentences[d.sentenceIdx] || { zh: "", py: "", vn: "", speaker: "" };
  d.cur = curSent;

  const filteredTopics = allTopics.filter(t => {
    if (d.bandFilter !== "all" && topicBandOf(t) !== d.bandFilter) return false;
    if (d.topicCategory !== "all" && t.category !== d.topicCategory) return false;
    return true;
  });

  const BAND_GROUPS = [
    { key: "A", label: "Band A · Cơ bản (A1–A2)" },
    { key: "B1", label: "Band B · Trung cấp (B1)" },
    { key: "B2", label: "Band B · Cao cấp (B2)" },
    { key: "C", label: "Band C · Lưu loát" }
  ].map(g => ({ ...g, items: filteredTopics.filter(t => topicBandOf(t) === g.key) }))
   .filter(g => g.items.length > 0);

  const availBands = ["A", "B1", "B2", "C"].filter(k => allTopics.some(t => topicBandOf(t) === k));
  const pillCls = (on) => on
    ? "px-2.5 py-1 rounded-full bg-primary-container text-on-primary text-xs font-semibold shadow-xs transition-colors"
    : "px-2.5 py-1 rounded-full bg-paper-card text-on-surface-variant hover:bg-paper-muted text-xs font-medium border border-border-subtle/70 transition-colors";

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
      if (a[i] === b[j]) { ok[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    let cleanIdx = 0;
    return [...target].map((c) => {
      if (!clean(c)) return `<span class="text-outline font-normal">${esc(c)}</span>`;
      const isOk = ok[cleanIdx++];
      return isOk ? `<span class="text-secondary font-bold">${esc(c)}</span>` : `<span class="wrongc font-bold">${esc(c)}</span>`;
    }).join("");
  }

  const doneCountInTopic = Object.keys(topicDone).length;

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-lg w-full">
      <!-- Compact Header -->
      <section class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-space-md border-b border-border-subtle/70">
        <div>
          <h1 class="font-display text-2xl md:text-3xl text-on-surface font-semibold tracking-tight font-serif">
            Chép chính tả <span class="text-outline font-normal text-xl">聽寫</span>
          </h1>
          <p class="font-body-sm text-sm text-on-surface-variant mt-0.5">
            Luyện nghe giọng Nam/Nữ Đài Loan xen kẽ theo chủ đề &amp; Band TOCFL. Nhấn <kbd class="px-1.5 py-0.5 rounded bg-surface-container font-code text-xs font-bold text-primary">Shift</kbd> để nghe lại.
          </p>
        </div>
        <div class="${inLesson ? 'flex' : 'hidden'} items-center gap-2 self-start sm:self-auto flex-wrap">
        <a href="#chinh-ta" class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-semibold flex items-center gap-1 no-underline"><span class="material-symbols-outlined text-[18px]">arrow_back</span>Danh sách bài</a>
        <div class="flex items-center gap-1 bg-surface-container p-1 rounded-xl">
          <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${d.viewMode === 'dictation' ? 'bg-paper-card text-primary shadow-xs' : 'text-on-surface-variant hover:text-on-surface'}" id="tab-mode-dictation">
            <span class="material-symbols-outlined text-[16px]">draw</span> Luyện chép
          </button>
          <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${d.viewMode === 'transcript' ? 'bg-paper-card text-primary shadow-xs' : 'text-on-surface-variant hover:text-on-surface'}" id="tab-mode-transcript">
            <span class="material-symbols-outlined text-[16px]">segment</span> Transcript
          </button>
        </div>
        </div>
      </section>

      <!-- Simplified Band & Topic Selector -->
      <details open id="section-topic-explorer" class="${inLesson ? 'hidden' : ''} bg-paper-card rounded-2xl border border-border-subtle/80 shadow-xs">
        <summary class="cursor-pointer select-none px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span class="font-headline-md text-sm font-semibold text-on-surface flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-[18px]">folder_open</span>
            Chọn bài để luyện
          </span>
          <span class="text-xs text-outline font-code">${allTopics.length} bài</span>
        </summary>
        <div class="px-4 pb-4 pt-1 flex flex-col gap-3 border-t border-border-subtle/50">
          <div class="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[11px] font-bold text-outline uppercase mr-1">Band:</span>
              <button type="button" class="${pillCls(d.bandFilter === 'all')}" data-dict-band="all">Tất cả (${allTopics.length})</button>
              ${availBands.map(b => `<button type="button" class="${pillCls(d.bandFilter === b)}" data-dict-band="${b}">Band ${b} (${allTopics.filter(t => topicBandOf(t) === b).length})</button>`).join("")}
            </div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[11px] font-bold text-outline uppercase mr-1">Chủ đề:</span>
              ${[["all","Tất cả"],["dialogue","Hội thoại"],["story","Câu chuyện"],["tocfl","TOCFL"],["news","Tin tức"]].map(([k, lbl]) => `<button type="button" class="${pillCls(d.topicCategory === k)}" data-topic-cat="${k}">${lbl}</button>`).join("")}
            </div>
          </div>

          <div class="flex flex-col gap-3">
            ${BAND_GROUPS.length ? BAND_GROUPS.map(grp => `
              <div class="flex flex-col gap-1.5">
                <div class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide flex items-center gap-1.5">
                  <span class="w-1.5 h-3 rounded-full bg-secondary inline-block"></span>
                  ${esc(grp.label)}
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  ${grp.items.map(top => {
                    const active = top.id === curTopic.id;
                    const doneN = Object.keys(d.doneMap[top.id] || {}).length;
                    return `
                      <button type="button" class="text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 ${active ? 'border-primary bg-cinnabar-subtle/50 ring-1 ring-primary/30' : 'border-border-subtle/70 bg-paper-base hover:bg-surface-container-low'}" data-select-topic="${esc(top.id)}">
                        <div class="min-w-0 flex-1">
                          <div class="text-xs font-semibold text-on-surface truncate">${esc(top.title)}</div>
                          <div class="text-[11px] text-outline truncate mt-0.5">${esc(top.categoryName || '')} · ${top.sentences.length} câu${doneN ? ` · xong ${doneN}` : ''}</div>
                        </div>
                        <span class="text-xs font-bold ${active ? 'text-primary' : 'text-outline'} shrink-0">${active ? '●' : '→'}</span>
                      </button>
                    `;
                  }).join("")}
                </div>
              </div>
            `).join("") : `<div class="text-xs text-outline text-center py-4">Không có bài nào khớp bộ lọc.</div>`}
          </div>
        </div>
      </details>

      <!-- Workspace (8 + 4) -->
      <div class="${inLesson ? 'grid' : 'hidden'} grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        <div class="lg:col-span-8 flex flex-col gap-space-md">
          <!-- Main Dictation Card -->
          <div class="${d.viewMode === 'dictation' ? 'flex' : 'hidden'} bg-paper-card p-space-lg rounded-2xl shadow-xs border border-border-subtle flex-col gap-space-md" id="dictationCard">
            <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border-subtle/60">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap text-xs">
                  <span class="px-2 py-0.5 rounded bg-cinnabar-subtle text-primary font-bold">${esc(curTopic.band)}</span>
                  <span class="text-secondary font-medium">${esc(curTopic.categoryName)}</span>
                </div>
                <h2 class="font-headline-md text-lg font-bold text-on-surface mt-1">${esc(curTopic.title)}</h2>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface" id="btn-prev-sentence" title="Câu trước">
                  <span class="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                <span class="font-code text-sm font-bold text-primary" id="current-sentence-idx">${d.sentenceIdx + 1}/${curTopic.sentences.length}</span>
                <button type="button" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface" id="btn-next-sentence" title="Câu kế tiếp">
                  <span class="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
                <span class="px-2.5 py-1 rounded-lg bg-jade-subtle text-secondary font-code text-xs font-bold border border-secondary/20" id="dictScoreBadge">
                  Đúng: <span id="dictOkCount">${d.score.ok}</span>/<span id="dictTotalCount">${d.score.total}</span>
                </span>
              </div>
            </div>

            <!-- Compact Audio Bar -->
            <div class="bg-surface-container-low p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 border border-border-subtle/50">
              <div class="flex items-center gap-2">
                <button type="button" class="w-11 h-11 rounded-full bg-primary hover:bg-primary-container text-on-primary flex items-center justify-center shadow-sm active:scale-95 transition-transform" id="btn-play-pause" title="Nghe lại câu hiện tại (Shift)">
                  <span class="material-symbols-outlined text-[24px]" id="icon-play" style="font-variation-settings: 'FILL' 1;">volume_up</span>
                </button>
                <button type="button" class="px-3 py-1.5 rounded-lg bg-paper-card hover:bg-surface-container text-on-surface text-xs font-semibold border border-border-subtle flex items-center gap-1" id="btn-play-full-topic" title="Nghe toàn bộ bài hội thoại">
                  <span class="material-symbols-outlined text-[16px] text-secondary">playlist_play</span>
                  <span>Nghe toàn bài</span>
                </button>
              </div>
              <div class="text-xs text-on-surface-variant flex-1 min-w-[140px]">
                Người nói: <strong class="text-on-surface">${esc(curSent.speaker || "Bản xứ Đài Loan")}</strong>
              </div>
              <div class="flex items-center gap-1">
                ${[0.75, 1.0, 1.25].map(sp => `<button type="button" class="speed-toggle px-2 py-1 rounded font-code text-xs ${d.speed === sp ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container'}" data-speed="${sp}">${sp}x</button>`).join("")}
              </div>
            </div>

            <!-- Input -->
            <div class="flex flex-col gap-1.5">
              <textarea class="w-full bg-paper-base rounded-xl p-3.5 text-xl md:text-2xl font-serif text-on-surface placeholder:text-outline/60 focus:outline-none focus:bg-paper-card border border-border-subtle focus:border-primary transition-all resize-none leading-relaxed" id="dictation-input" placeholder="Gõ chữ Hán Phồn thể bạn nghe được... (Shift để nghe lại, Enter để kiểm tra)" rows="3"></textarea>
              <div class="flex items-center justify-between text-xs text-outline">
                <span>${curTopic.vocab && curTopic.vocab[0] ? `Gợi ý: <strong class="text-tertiary font-code">${esc(curTopic.vocab[0].w)}</strong> (${esc(curTopic.vocab[0].vn)})` : ''}</span>
                <span class="font-code" id="char-counter">0 ký tự</span>
              </div>
            </div>

            <!-- Action Row -->
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <button type="button" class="px-4 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold shadow-xs flex items-center gap-1.5" id="btn-check-answer">
                  <span class="material-symbols-outlined text-[18px]">check_circle</span> Kiểm tra (Enter)
                </button>
                <button type="button" class="px-3 py-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant text-xs font-medium" id="btn-skip-sentence">
                  Xem đáp án
                </button>
                <button type="button" class="p-2 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-low" id="btn-clear-input" title="Xóa ô nhập">
                  <span class="material-symbols-outlined text-[18px]">refresh</span>
                </button>
              </div>
              <label class="flex items-center gap-1.5 cursor-pointer text-xs text-on-surface-variant">
                <input ${d.showDetails ? 'checked' : ''} class="w-4 h-4 rounded accent-primary" id="chk-auto-show" type="checkbox"/>
                <span>Hiện Pinyin &amp; dịch</span>
              </label>
            </div>

            <!-- Feedback Panel -->
            <div class="hidden flex-col gap-3 pt-3 bg-paper-base rounded-xl p-3.5 border border-border-subtle" id="feedback-panel">
              <div class="hidden flex-col gap-2.5" id="state-correct">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <span class="text-sm font-bold text-secondary flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[20px]">check_circle</span> Chính xác! (正確)
                  </span>
                  <div class="flex items-center gap-1.5">
                    <button type="button" class="px-2.5 py-1 rounded-md bg-paper-card hover:bg-surface-container text-on-surface text-xs font-medium border border-border-subtle" id="btn-save-current-sentence">+ Sổ từ</button>
                    <button type="button" class="px-3 py-1 rounded-md bg-secondary text-white text-xs font-semibold" id="btn-next-action">Câu tiếp →</button>
                  </div>
                </div>
                <div class="dict-detail-box grid grid-cols-1 md:grid-cols-2 gap-2 text-xs ${d.showDetails ? '' : 'hidden'}">
                  <div class="bg-paper-card p-2.5 rounded-lg border border-border-subtle"><span class="text-outline block mb-0.5">Pinyin</span><span class="font-code text-primary">${esc(curSent.py)}</span></div>
                  <div class="bg-paper-card p-2.5 rounded-lg border border-border-subtle"><span class="text-outline block mb-0.5">Dịch nghĩa</span><span class="text-on-surface font-medium">${esc(curSent.vn)}</span></div>
                </div>
              </div>

              <div class="hidden flex-col gap-2.5" id="state-incorrect">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <span class="text-sm font-bold text-primary flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[20px]">info</span> Đáp án &amp; đối chiếu (chữ đỏ chưa khớp)
                  </span>
                  <button type="button" class="px-3 py-1 rounded-md bg-primary text-white text-xs font-semibold" id="btn-next-action-inc">Câu tiếp →</button>
                </div>
                <div class="p-3 bg-paper-card rounded-lg border border-border-subtle font-serif text-xl md:text-2xl leading-relaxed" id="diffComparison"></div>
                <div class="dict-detail-box grid grid-cols-1 md:grid-cols-2 gap-2 text-xs ${d.showDetails ? '' : 'hidden'}">
                  <div class="bg-paper-card p-2.5 rounded-lg border border-border-subtle"><span class="text-outline block mb-0.5">Pinyin chuẩn</span><span class="font-code text-primary">${esc(curSent.py)}</span></div>
                  <div class="bg-paper-card p-2.5 rounded-lg border border-border-subtle"><span class="text-outline block mb-0.5">Dịch nghĩa</span><span class="text-on-surface font-medium">${esc(curSent.vn)}</span></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Transcript Container -->
          <div class="${d.viewMode === 'transcript' ? 'flex' : 'hidden'} flex-col gap-3 bg-paper-card p-space-lg rounded-2xl shadow-xs border border-border-subtle" id="transcript-container">
            <div class="flex items-center justify-between border-b border-border-subtle pb-2">
              <h3 class="font-headline-md text-base text-on-surface font-bold">Toàn bộ Transcript · ${esc(curTopic.title)}</h3>
              <span class="text-xs font-code text-outline">${curTopic.sentences.length} câu</span>
            </div>
            <div class="flex flex-col gap-2 max-h-[520px] overflow-y-auto pr-1">
              ${curTopic.sentences.map((s, idx) => `
                <div class="p-3 rounded-xl border transition-all text-xs flex items-start justify-between gap-3 cursor-pointer ${idx === d.sentenceIdx ? 'border-primary bg-cinnabar-subtle/40' : 'border-border-subtle bg-paper-base hover:bg-surface-container-low'}" data-jump-sentence="${idx}">
                  <div class="flex items-start gap-2.5 min-w-0">
                    <span class="w-6 h-6 rounded-full flex items-center justify-center font-code text-[11px] font-bold shrink-0 ${idx === d.sentenceIdx ? 'bg-primary text-white' : 'bg-surface-container text-outline'}">${idx + 1}</span>
                    <div class="flex flex-col gap-0.5">
                      <span class="font-serif text-sm font-semibold text-on-surface">${s.speaker ? `<strong class="text-secondary">[${esc(s.speaker)}]</strong> ` : ''}${esc(s.zh)}</span>
                      <span class="font-code text-outline text-[11px]">${esc(s.py)}</span>
                      <span class="text-on-surface-variant text-[11px]">${esc(s.vn)}</span>
                    </div>
                  </div>
                  <button type="button" class="w-7 h-7 rounded-full bg-paper-card hover:bg-primary hover:text-white flex items-center justify-center text-outline border border-border-subtle shrink-0" data-play-sent-idx="${idx}" title="Nghe câu này">
                    <span class="material-symbols-outlined text-[16px]">play_arrow</span>
                  </button>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <!-- Compact Sidebar -->
        <aside class="lg:col-span-4 flex flex-col gap-space-md">
          <div class="bg-paper-card p-space-md rounded-2xl shadow-xs border border-border-subtle flex flex-col gap-3">
            <div class="flex items-center justify-between pb-2 border-b border-border-subtle/60">
              <h3 class="font-label-md text-xs font-bold text-on-surface uppercase">Tiến độ bài (${doneCountInTopic}/${curTopic.sentences.length})</h3>
              <span class="text-xs font-code text-primary font-bold">Câu ${d.sentenceIdx + 1}</span>
            </div>
            <div class="grid grid-cols-5 gap-1.5">
              ${curTopic.sentences.map((_, idx) => {
                const status = topicDone[idx];
                const isCurrent = idx === d.sentenceIdx;
                let cls = "bg-surface-container-low hover:bg-surface-container text-on-surface-variant";
                if (isCurrent) cls = "bg-primary text-white font-bold shadow-xs";
                else if (status === "ok") cls = "bg-jade-subtle text-secondary font-bold border border-secondary/30";
                else if (status === "skip" || status === "miss") cls = "bg-amber-subtle text-tertiary font-bold border border-tertiary/30";
                return `<button type="button" class="h-8 rounded-lg ${cls} font-code text-xs flex items-center justify-center transition-all" data-jump-sentence="${idx}">${status === "ok" && !isCurrent ? '✓' : idx + 1}</button>`;
              }).join("")}
            </div>
          </div>

          <div class="bg-paper-card p-space-md rounded-2xl shadow-xs border border-border-subtle flex flex-col gap-2.5">
            <div class="flex items-center justify-between pb-2 border-b border-border-subtle/60">
              <h3 class="font-label-md text-xs font-bold text-on-surface uppercase">Từ vựng trọng tâm</h3>
              <button type="button" class="text-primary hover:underline text-xs font-semibold" id="btn-save-all-vocab">Lưu tất cả</button>
            </div>
            <div class="flex flex-col gap-2">
              ${(curTopic.vocab || []).map((v) => `
                <div class="p-2 rounded-lg bg-paper-base border border-border-subtle/60 flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="font-serif text-sm font-bold text-on-surface">${esc(v.w)}</span>
                      <span class="font-code text-[11px] text-primary">${esc(v.py)}</span>
                    </div>
                    <span class="text-xs text-on-surface-variant block truncate">${esc(v.vn)}</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button type="button" class="w-7 h-7 rounded-full bg-paper-card text-outline hover:text-primary flex items-center justify-center border border-border-subtle/50" data-say-vocab="${esc(v.w)}" title="Phát âm">
                      <span class="material-symbols-outlined text-[15px]">volume_up</span>
                    </button>
                    <button type="button" class="w-7 h-7 rounded-full bg-paper-card text-outline hover:text-secondary flex items-center justify-center border border-border-subtle/50" data-save-vocab="${esc(v.w)}" data-vocab-py="${esc(v.py)}" data-vocab-vn="${esc(v.vn)}" data-vocab-band="${esc(v.band || 'B1')}" title="Lưu vào sổ từ">
                      <span class="material-symbols-outlined text-[15px]">bookmark_add</span>
                    </button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </aside>
      </div>
    </div>
  `);

  const txtInput = $("#dictation-input");
  const charCounter = $("#char-counter");
  const btnPlayPause = $("#btn-play-pause");
  const btnPlayFull = $("#btn-play-full-topic");

  function speakerRole(s) {
    if (/林經理|小姐|女|房東|顧客|同學/.test(s.speaker || "")) return "female";
    if (/傑克|小陳|男|先生|記者|經理/.test(s.speaker || "")) return "male";
    return "narrator";
  }

  function playSentenceAudio(sent) {
    if (!sent || !sent.zh) return;
    playDialogueAudio([{ speaker: speakerRole(sent), text: sent.zh }], d.speed || 1.0);
    if (btnPlayPause && btnPlayPause.classList) {
      btnPlayPause.classList.add("ring-4", "ring-primary/40");
      setTimeout(() => btnPlayPause.classList.remove("ring-4", "ring-primary/40"), 250);
    }
  }

  function playCurrentAudio() {
    playSentenceAudio(curSent);
  }

  function playFullDialogueAudio() {
    if (!curTopic || !curTopic.sentences || !curTopic.sentences.length) return;
    const allSegs = curTopic.sentences.map(s => ({ speaker: speakerRole(s), text: s.zh }));
    playDialogueAudio(allSegs, d.speed || 1.0);
  }

  // Only auto-play when entering a new sentence/topic (not on filter/explorer toggle)
  const curPlayKey = `${curTopic.id}:${d.sentenceIdx}`;
  if (inLesson && d.viewMode === "dictation" && d._lastPlayedKey !== curPlayKey) {
    d._lastPlayedKey = curPlayKey;
    playCurrentAudio();
  }

  if (btnPlayFull) btnPlayFull.onclick = playFullDialogueAudio;
  if (btnPlayPause) btnPlayPause.onclick = playCurrentAudio;

  if (txtInput && charCounter) {
    txtInput.oninput = () => { charCounter.textContent = `${txtInput.value.length} ký tự`; };
  }

  const chkShow = $("#chk-auto-show");
  if (chkShow) {
    chkShow.onchange = () => {
      d.showDetails = !!chkShow.checked;
      document.querySelectorAll(".dict-detail-box").forEach(el => el.classList.toggle("hidden", !d.showDetails));
    };
  }

  document.querySelectorAll(".speed-toggle").forEach((btn) => {
    btn.onclick = () => {
      d.speed = Number(btn.dataset.speed || 1.0);
      document.querySelectorAll(".speed-toggle").forEach(b => {
        b.className = "speed-toggle px-2 py-1 rounded font-code text-xs text-on-surface-variant hover:bg-surface-container";
      });
      btn.className = "speed-toggle px-2 py-1 rounded font-code text-xs bg-primary text-on-primary font-bold";
      playCurrentAudio();
    };
  });

  const goNextSentence = () => {
    if (d.sentenceIdx < curTopic.sentences.length - 1) {
      d.sentenceIdx++;
      d.checked = false;
      VIEWS["chinh-ta"]();
    } else {
      showToast(`Hoàn thành bài "${curTopic.title}"! Bạn có thể chọn bài tiếp theo ở phía trên.`);
    }
  };

  if ($("#btn-prev-sentence")) {
    $("#btn-prev-sentence").onclick = () => {
      if (d.sentenceIdx > 0) { d.sentenceIdx--; d.checked = false; VIEWS["chinh-ta"](); }
    };
  }
  if ($("#btn-next-sentence")) $("#btn-next-sentence").onclick = goNextSentence;

  document.querySelectorAll("[data-play-sent-idx]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const s = curTopic.sentences[Number(btn.dataset.playSentIdx)];
      if (s) playSentenceAudio(s);
    };
  });

  document.querySelectorAll("[data-jump-sentence]").forEach((el) => {
    el.onclick = () => {
      d.sentenceIdx = Number(el.dataset.jumpSentence);
      d.checked = false;
      d.viewMode = "dictation";
      VIEWS["chinh-ta"]();
    };
  });

  function updateScoreDOM() {
    const okEl = $("#dictOkCount");
    const totEl = $("#dictTotalCount");
    if (okEl) okEl.textContent = d.score.ok;
    if (totEl) totEl.textContent = d.score.total;
  }

  function handleCheck(isRevealOnly = false) {
    if (!txtInput) return;
    const typed = isRevealOnly ? "" : txtInput.value.trim();
    const cleanTyped = clean(typed);
    const cleanTarget = clean(curSent.zh);
    const isExact = !isRevealOnly && cleanTyped === cleanTarget && cleanTarget.length > 0;
    const alreadyCounted = !!topicDone[d.sentenceIdx];

    d.checked = true;
    if (!alreadyCounted) {
      d.score.total++;
      if (isExact) {
        d.score.ok++;
        topicDone[d.sentenceIdx] = "ok";
      } else {
        topicDone[d.sentenceIdx] = isRevealOnly ? "skip" : "miss";
      }
      updateScoreDOM();
    } else if (isExact && topicDone[d.sentenceIdx] !== "ok") {
      topicDone[d.sentenceIdx] = "ok";
      d.score.ok++;
      updateScoreDOM();
    }

    const feedbackPanel = $("#feedback-panel");
    const stateCorrect = $("#state-correct");
    const stateIncorrect = $("#state-incorrect");
    feedbackPanel.classList.remove("hidden");
    feedbackPanel.classList.add("flex");

    if (isExact) {
      stateCorrect.classList.remove("hidden");
      stateCorrect.classList.add("flex");
      stateIncorrect.classList.add("hidden");
      stateIncorrect.classList.remove("flex");
      playChime(true);
    } else {
      stateCorrect.classList.add("hidden");
      stateCorrect.classList.remove("flex");
      stateIncorrect.classList.remove("hidden");
      stateIncorrect.classList.add("flex");
      const diffEl = $("#diffComparison");
      if (diffEl) diffEl.innerHTML = diffMarks(curSent.zh, typed);
    }
  }

  if ($("#btn-check-answer")) $("#btn-check-answer").onclick = () => handleCheck(false);
  if ($("#btn-skip-sentence")) $("#btn-skip-sentence").onclick = () => handleCheck(true);
  if ($("#btn-clear-input")) {
    $("#btn-clear-input").onclick = () => {
      if (txtInput) { txtInput.value = ""; if (charCounter) charCounter.textContent = "0 ký tự"; txtInput.focus(); }
    };
  }
  if ($("#btn-next-action")) $("#btn-next-action").onclick = goNextSentence;
  if ($("#btn-next-action-inc")) $("#btn-next-action-inc").onclick = goNextSentence;

  if ($("#btn-save-current-sentence")) {
    $("#btn-save-current-sentence").onclick = () => saveWordToNotebook(curSent.zh, curSent.py, curSent.vn, curTopic.band || "B1");
  }
  document.querySelectorAll("[data-say-vocab]").forEach((btn) => {
    btn.onclick = () => say(btn.dataset.sayVocab, 0.9);
  });
  document.querySelectorAll("[data-save-vocab]").forEach((btn) => {
    btn.onclick = () => saveWordToNotebook(btn.dataset.saveVocab, btn.dataset.vocabPy, btn.dataset.vocabVn, btn.dataset.vocabBand);
  });
  if ($("#btn-save-all-vocab")) {
    $("#btn-save-all-vocab").onclick = async () => {
      for (const v of curTopic.vocab || []) await saveWordToNotebook(v.w, v.py, v.vn, v.band);
      showToast(`Đã lưu toàn bộ từ vựng bài "${curTopic.title}" vào Sổ từ!`);
    };
  }

  const expDetails = $("#section-topic-explorer");
  if (expDetails) expDetails.ontoggle = () => { d.explorerOpen = !!expDetails.open; };

  if ($("#tab-mode-dictation")) $("#tab-mode-dictation").onclick = () => { d.viewMode = "dictation"; VIEWS["chinh-ta"](); };
  if ($("#tab-mode-transcript")) $("#tab-mode-transcript").onclick = () => { d.viewMode = "transcript"; VIEWS["chinh-ta"](); };

  document.querySelectorAll("[data-dict-band]").forEach((chip) => {
    chip.onclick = () => { d.bandFilter = chip.dataset.dictBand; d.explorerOpen = true; VIEWS["chinh-ta"](); };
  });
  document.querySelectorAll("[data-topic-cat]").forEach((chip) => {
    chip.onclick = () => { d.topicCategory = chip.dataset.topicCat; d.explorerOpen = true; VIEWS["chinh-ta"](); };
  });
  document.querySelectorAll("[data-select-topic]").forEach((card) => {
    card.onclick = () => {
      if (card.dataset.selectTopic !== d.passageId) { d.sentenceIdx = 0; d.checked = false; d._lastPlayedKey = ""; }
      d.passageId = card.dataset.selectTopic;
      location.hash = "#chinh-ta/" + encodeURIComponent(card.dataset.selectTopic);
    };
  });

  // KEYBOARD SHORTCUT: Shift Replay (no double firing)
  if (txtInput) {
    txtInput.onkeydown = (e) => {
      if (e.key === "Shift" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        playCurrentAudio();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        if (e.preventDefault) e.preventDefault();
        handleCheck(false);
        return;
      }
    };
  }

  window.onkeydown = (e) => {
    if (!location.hash.startsWith("#chinh-ta/")) return;
    if (e.key === "Shift" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      playCurrentAudio();
    }
  };
};

// =========================================================================
// 7. VIEW THI THỬ TOCFL (5 ĐỀ CHÍNH THỨC BAND B PHỒN THỂ: NGHE & ĐỌC)
// =========================================================================
function stopExamAudio() {
  if (window._examAudioEl) {
    try {
      window._examAudioEl.pause();
      window._examAudioEl.onended = null;
      window._examAudioEl.ontimeupdate = null;
      window._examAudioEl.src = "";
    } catch (e) {}
  }
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  if (window._examAudioState) {
    window._examAudioState.playing = false;
  }
}

function fmtAudioSec(sec) {
  if (!sec || !isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

VIEWS["thi-thu"] = async () => {
  const exam = S.exam = Object.assign({
    subview: "review",
    testId: "mock_b1",
    bandFilter: "Band B",
    curQuestionIdx: 0,
    lastListenIdx: 0,
    lastReadIdx: 50,
    answers: {},
    flagged: {},
    revealedQs: {},
    byTest: {},
    history: [],
    timerLeft: 7200,
    isExamMode: true,
    lastResult: null,
    historyModalOpen: false,
    submitModalOpen: false,
    fontSizeClass: "text-headline-md",
    sheetSection: "auto"
  }, S.exam || {});
  exam.subview = location.hash.startsWith("#thi-thu/") ? "review" : "overview";
  if (exam.subview === "overview" && typeof stopExamAudio === "function") stopExamAudio();

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

  const bandBTests = allTests.filter(t => String(t.band || "").includes("Band B") || String(t.id || "").startsWith("mock_b"));
  const displayTests = bandBTests.length ? bandBTests : allTests;
  const curTest = displayTests.find(t => t.id === exam.testId) || displayTests[0];
  exam.testId = curTest.id;
  exam.curTest = curTest;

  if (!exam.byTest) exam.byTest = {};
  if (!exam.byTest[curTest.id]) {
    const isFirstInit = Object.keys(exam.byTest).length === 0;
    const firstR = curTest.questions.findIndex(q => q.section !== "listening");
    exam.byTest[curTest.id] = {
      answers: isFirstInit && exam.answers ? Object.assign({}, exam.answers) : {},
      flagged: isFirstInit && exam.flagged ? Object.assign({}, exam.flagged) : {},
      revealedQs: isFirstInit && exam.revealedQs ? Object.assign({}, exam.revealedQs) : {},
      lastListenIdx: 0,
      lastReadIdx: firstR >= 0 ? firstR : 50,
      timerLeft: 7200,
      isExamMode: true
    };
  }
  const tState = exam.byTest[curTest.id];
  exam.answers = tState.answers;
  exam.flagged = tState.flagged;
  exam.revealedQs = tState.revealedQs;
  if (typeof tState.timerLeft === "number") exam.timerLeft = tState.timerLeft;

  try {
    const savedHist = await Store.get("kv", "tocfl_history");
    if (Array.isArray(savedHist)) exam.history = savedHist;
  } catch (e) {}

  if (exam.curQuestionIdx < 0 || exam.curQuestionIdx >= curTest.questions.length) {
    exam.curQuestionIdx = 0;
  }
  const curQ = curTest.questions[exam.curQuestionIdx] || curTest.questions[0];
  const qNum = curQ.qNum || (curQ.section === "listening" ? curQ.id : (curQ.id > 50 ? curQ.id - 50 : curQ.id));
  if (curQ.section === "listening") tState.lastListenIdx = exam.curQuestionIdx;
  else tState.lastReadIdx = exam.curQuestionIdx;

  const curAudioKey = `${curTest.id}_${curQ.id}`;
  if (window._examAudioState && window._examAudioState.key !== curAudioKey) {
    stopExamAudio();
  }

  const totalQ = curTest.questions.length || 100;
  const listeningQs = curTest.questions.filter(q => q.section === "listening");
  const readingQs = curTest.questions.filter(q => q.section !== "listening");
  const firstReadIdx = readingQs.length ? curTest.questions.indexOf(readingQs[0]) : 50;
  const doneListening = listeningQs.filter(q => exam.answers[q.id] !== undefined).length;
  const doneReading = readingQs.filter(q => exam.answers[q.id] !== undefined).length;
  const totalDone = doneListening + doneReading;
  const totalUnanswered = Math.max(0, totalQ - totalDone);
  const totalFlagged = Object.keys(exam.flagged || {}).filter(k => exam.flagged[k]).length;

  const mins = Math.floor((exam.timerLeft || 0) / 60);
  const secs = (exam.timerLeft || 0) % 60;
  const timerStr = `${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;

  const audioFiles = Array.isArray(curQ.audioFiles) ? curQ.audioFiles : [];
  const hasTwoTracks = audioFiles.length >= 2;
  const showAnswerBox = !exam.isExamMode || !!(exam.revealedQs && exam.revealedQs[curQ.id]);
  const activeSheetSec = exam.sheetSection === "auto" ? (curQ.section === "listening" ? "listening" : "reading") : exam.sheetSection;

  function updateAudioPlayerDOM() {
    const st = window._examAudioState || {};
    const iconEl = $("#exam-audio-icon");
    const statusEl = $("#exam-audio-status");
    const timeEl = $("#exam-audio-time");
    const barEl = $("#exam-audio-bar");
    if (iconEl) iconEl.textContent = st.playing ? "pause" : "volume_up";
    if (statusEl) {
      if (st.playing) {
        statusEl.textContent = hasTwoTracks
          ? (st.trackIdx === 0 ? `Đang phát: Đoạn hội thoại/bài nói (1/${audioFiles.length})...` : `Đang phát: Câu hỏi ${qNum} (2/${audioFiles.length})...`)
          : `Đang phát câu ${qNum}...`;
      } else if (st.pausedAt > 0) {
        statusEl.textContent = `Tạm dừng · Bấm loa để nghe tiếp`;
      } else {
        statusEl.textContent = `Bấm vào cái loa để nghe câu ${qNum}`;
      }
    }
    if (timeEl && st.el) {
      timeEl.textContent = `${fmtAudioSec(st.el.currentTime)} / ${fmtAudioSec(st.el.duration)}`;
    }
    if (barEl && st.el && st.el.duration > 0) {
      barEl.style.width = `${Math.min(100, Math.round((st.el.currentTime / st.el.duration) * 100))}%`;
    }
  }

  function playExamAudio(mode) {
    if (!curQ || curQ.section !== "listening") return;
    const btn = $("#btn-play-exam-audio");
    if (btn && btn.classList) {
      btn.classList.add("ring-4", "ring-primary/40");
      setTimeout(() => btn.classList.remove("ring-4", "ring-primary/40"), 300);
    }

    if (typeof Audio === "undefined" || !audioFiles.length) {
      const segs = curQ.dialogueSegments && curQ.dialogueSegments.length ? curQ.dialogueSegments : (curQ.dialogue || curQ.audio);
      if (segs) playDialogueAudio(segs, 0.9);
      return;
    }

    if (!window._examAudioEl) window._examAudioEl = new Audio();
    const el = window._examAudioEl;
    const st = window._examAudioState = window._examAudioState || {};

    if (mode === undefined && st.key === curAudioKey && st.el === el && el.src) {
      if (st.playing && !el.paused) {
        el.pause(); st.playing = false; st.pausedAt = el.currentTime || 0.1; updateAudioPlayerDOM(); return;
      } else if (!st.playing && st.pausedAt > 0 && !el.ended) {
        st.playing = true; el.play().catch(() => {}); updateAudioPlayerDOM(); return;
      }
    }

    stopExamAudio();
    let queue = audioFiles.slice();
    let startTrackIdx = 0;
    if (mode === 0 && audioFiles[0]) { queue = [audioFiles[0]]; startTrackIdx = 0; }
    else if (mode === 1 && audioFiles[1]) { queue = [audioFiles[1]]; startTrackIdx = 1; }

    let qIdx = 0;
    st.key = curAudioKey; st.el = el; st.playing = true; st.pausedAt = 0; st.trackIdx = startTrackIdx;

    const playCurrentInQueue = () => {
      if (qIdx >= queue.length) { st.playing = false; st.pausedAt = 0; updateAudioPlayerDOM(); return; }
      st.trackIdx = (mode === undefined) ? qIdx : startTrackIdx;
      el.src = queue[qIdx];
      el.currentTime = 0;
      el.ontimeupdate = () => updateAudioPlayerDOM();
      el.onloadedmetadata = () => updateAudioPlayerDOM();
      el.onended = () => {
        qIdx++;
        if (qIdx < queue.length) playCurrentInQueue();
        else { st.playing = false; st.pausedAt = 0; updateAudioPlayerDOM(); }
      };
      el.onerror = () => {
        st.playing = false;
        const segs = curQ.dialogueSegments && curQ.dialogueSegments.length ? curQ.dialogueSegments : (curQ.dialogue || curQ.audio);
        if (segs) playDialogueAudio(segs, 0.9);
      };
      updateAudioPlayerDOM();
      const playP = el.play();
      if (playP && typeof playP.catch === "function") {
        playP.catch(() => { st.playing = false; updateAudioPlayerDOM(); });
      }
    };
    playCurrentInQueue();
  }

  function formatReadingContextHTML(q) {
    if (!q.context) return "";
    let html = esc(q.context);
    if (q.section === "reading") {
      html = html.replace(/【\s*(\d{1,2})\s*】/g, (_, numStr) => {
        const n = Number(numStr);
        if (n === qNum) {
          return `<span class="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md bg-primary text-white font-code font-bold text-sm">【 ${n} 】</span>`;
        }
        const ansIdx = exam.answers[50 + n];
        const filled = ansIdx !== undefined ? ` (${["A","B","C","D"][ansIdx]})` : "";
        return `<span class="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-surface-container-high text-primary font-code font-semibold text-xs border border-primary/20">【${n}${filled}】</span>`;
      });
    }
    return html;
  }

  const renderQGrid = (qs, isListen) => qs.map((q) => {
    const idx = curTest.questions.indexOf(q);
    const isCurrent = idx === exam.curQuestionIdx;
    const hasAns = exam.answers[q.id] !== undefined;
    const isFlagged = exam.flagged && exam.flagged[q.id];
    const isCorrect = exam.answers[q.id] === q.ans;
    let cls = "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest";
    if (isCurrent) cls = isListen ? "bg-primary text-on-primary font-bold shadow-xs" : "bg-secondary text-white font-bold shadow-xs";
    else if (isFlagged) cls = "bg-amber-subtle text-tertiary-container font-bold";
    else if (hasAns) {
      cls = exam.isExamMode
        ? "bg-cinnabar-subtle text-primary font-semibold"
        : (isCorrect ? "bg-jade-subtle text-secondary font-bold border border-secondary/30" : "bg-cinnabar-subtle text-primary font-bold border border-primary/30");
    }
    const nLabel = q.qNum || (isListen ? q.id : (q.id > 50 ? q.id - 50 : q.id));
    return `<button type="button" class="h-8 rounded ${cls} font-code text-xs flex items-center justify-center relative transition-all cursor-pointer" data-jump-q="${idx}" title="${isListen ? 'Nghe' : 'Đọc'} câu ${nLabel}">${nLabel < 10 ? "0" + nLabel : nLabel}${isFlagged ? '<span class="w-1.5 h-1.5 rounded-full bg-tertiary absolute top-0.5 right-0.5"></span>' : ''}</button>`;
  }).join("");

  const totalPct = Math.round((totalDone / Math.max(1, totalQ)) * 100);

  setView(`
    <div class="max-w-7xl mx-auto px-margin-mobile md:px-margin py-space-lg flex flex-col gap-space-md w-full">
      <!-- Single Compact Exam Header (Band Level -> Đề 1..5 + Controls) -->
      <header class="bg-paper-card rounded-2xl p-space-md border border-border-subtle shadow-xs flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 flex-wrap">
            <h1 class="font-display text-xl md:text-2xl font-bold text-on-surface font-serif">Thi thử TOCFL</h1>
            <span class="px-2.5 py-0.5 rounded-full bg-primary text-on-primary font-code text-xs font-bold">Band B · B1–B2</span>
            ${exam.subview === 'review' ? `<span class="px-2 py-0.5 rounded-full bg-amber-subtle text-tertiary-container font-code text-xs font-semibold flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">timer</span>
              <span id="examTimerDisplay">${timerStr}</span>
            </span>` : ""}
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            ${exam.subview === 'review' ? `<button type="button" class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-semibold flex items-center gap-1 cursor-pointer" id="tabOverviewBtn"><span class="material-symbols-outlined text-[18px]">arrow_back</span>Danh sách đề</button>` : ""}
            <button type="button" class="px-2.5 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-medium border border-border-subtle flex items-center gap-1 cursor-pointer" id="btnOpenHistory">
              <span class="material-symbols-outlined text-primary text-[16px]">history_edu</span>
              <span>Lịch sử (${exam.history.length})</span>
            </button>
            ${exam.subview !== 'review' ? "" : exam.isExamMode ? `
              <button type="button" class="px-3 py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container text-xs font-bold shadow-xs cursor-pointer" id="btnSubmitExam">Nộp bài</button>
            ` : `
              <button type="button" class="px-3 py-1.5 rounded-lg bg-secondary text-white text-xs font-bold shadow-xs cursor-pointer" id="btnRetakeExam">Làm lại</button>
            `}
          </div>
        </div>

        <!-- Inline Band B -> Đề 1..5 Pills -->
        <div class="${exam.subview === 'review' ? 'flex' : 'hidden'} flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-subtle/60">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold text-outline mr-1">Band B:</span>
            ${displayTests.map((t, i) => `
              <button type="button" class="px-3 py-1 rounded-full text-xs font-code font-semibold transition-all cursor-pointer ${t.id === curTest.id ? 'bg-primary-container text-on-primary shadow-xs' : 'bg-paper-base text-on-surface-variant hover:bg-surface-container border border-border-subtle/70'}" data-quick-test="${esc(t.id)}">
                Đề ${i + 1}
              </button>
            `).join("")}
          </div>
          <span class="text-xs font-code text-outline">Đã chọn ${totalDone}/${totalQ} (${totalPct}%)</span>
        </div>
      </header>

      <!-- SUBVIEW 1: OVERVIEW (BAND B -> ĐỀ 1..5) -->
      <div class="${exam.subview === 'overview' ? 'flex' : 'hidden'} flex-col gap-4" id="viewOverview">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-on-surface-variant uppercase tracking-wide flex items-center gap-1.5">
            <span class="w-1.5 h-4 rounded-full bg-primary inline-block"></span>
            Band B · 進階級 (B1) &amp; 高階級 (B2) — ${displayTests.length} đề chính thức Phồn thể
          </span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md">
          ${displayTests.map((t, idx) => {
            const ts = (exam.byTest && exam.byTest[t.id]) ? exam.byTest[t.id] : { answers: {} };
            const tAns = ts.answers || {};
            const lQs = t.questions.filter(q => q.section === "listening");
            const rQs = t.questions.filter(q => q.section !== "listening");
            const lDone = lQs.filter(q => tAns[q.id] !== undefined).length;
            const rDone = rQs.filter(q => tAns[q.id] !== undefined).length;
            return `
              <div class="bg-paper-card p-space-md rounded-2xl border ${t.id === curTest.id ? 'border-primary ring-1 ring-primary/30' : 'border-border-subtle'} shadow-xs flex flex-col justify-between gap-3">
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="px-2 py-0.5 rounded bg-cinnabar-subtle text-primary font-code text-[11px] font-bold">Band B · Đề ${idx + 1}</span>
                    <span class="font-code text-[11px] text-outline">${lDone + rDone}/${t.questions.length} câu</span>
                  </div>
                  <h3 class="font-headline-md text-sm font-bold text-on-surface">${esc(t.title)}</h3>
                  <div class="grid grid-cols-2 gap-2 mt-2.5 text-xs">
                    <div class="p-2 rounded-lg bg-paper-base border border-border-subtle/60">
                      <span class="text-primary font-semibold block">Nghe hiểu</span>
                      <span class="font-code text-on-surface">${lDone}/${lQs.length} câu</span>
                    </div>
                    <div class="p-2 rounded-lg bg-paper-base border border-border-subtle/60">
                      <span class="text-secondary font-semibold block">Đọc hiểu</span>
                      <span class="font-code text-on-surface">${rDone}/${rQs.length} câu</span>
                    </div>
                  </div>
                </div>
                <div class="flex flex-col gap-1.5">
                  <div class="grid grid-cols-2 gap-1.5">
                    <button type="button" class="py-1.5 px-2.5 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer" data-start-exam="${esc(t.id)}" data-start-sec="listening">Phần Nghe</button>
                    <button type="button" class="py-1.5 px-2.5 rounded-lg bg-secondary text-white text-xs font-semibold cursor-pointer" data-start-exam="${esc(t.id)}" data-start-sec="reading">Phần Đọc</button>
                  </div>
                  <button type="button" class="w-full py-1.5 px-2.5 rounded-lg bg-paper-base hover:bg-surface-container text-on-surface-variant text-xs font-medium border border-border-subtle cursor-pointer" data-review-exam="${esc(t.id)}">Xem đáp án &amp; lời thoại</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <!-- SUBVIEW 2: EXAM WORKSTATION -->
      <div class="${exam.subview === 'review' ? 'flex' : 'hidden'} flex-col gap-space-md" id="viewReview">
        ${exam.lastResult && exam.lastResult.testId === curTest.id && !exam.isExamMode ? `
          <div class="bg-paper-card p-space-md rounded-2xl border-2 border-secondary shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div>
              <span class="px-2 py-0.5 rounded-full bg-secondary text-white text-[11px] font-bold">KẾT QUẢ SC-TOP</span>
              <span class="font-headline-md text-sm font-bold text-on-surface ml-2">${esc(exam.lastResult.level)}</span>
              <p class="text-xs text-on-surface-variant mt-1">
                Đúng <strong>${exam.lastResult.score}/${exam.lastResult.total}</strong> (${exam.lastResult.pct}%) ·
                Nghe: <strong>${exam.lastResult.listenScaled}/80</strong> (${exam.lastResult.listenCorrect}/50) ·
                Đọc: <strong>${exam.lastResult.readScaled}/80</strong> (${exam.lastResult.readCorrect}/50)
              </p>
            </div>
            <button type="button" class="px-3.5 py-1.5 rounded-lg bg-primary text-white text-xs font-bold cursor-pointer shrink-0" id="btnRetakeFromBanner">Làm lại đề này</button>
          </div>
        ` : ''}

        <!-- Compact 2-Section Switcher (Nghe | Đọc) -->
        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="btnSwitchListening" class="flex items-center justify-between px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer ${curQ.section === 'listening' ? 'bg-cinnabar-subtle border-primary text-primary' : 'bg-paper-card border-border-subtle text-on-surface-variant hover:bg-surface-container-low'}">
            <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[18px]">headphones</span> Phần 1: Nghe hiểu</span>
            <span class="font-code text-xs">${doneListening}/${listeningQs.length}</span>
          </button>
          <button type="button" id="btnSwitchReading" class="flex items-center justify-between px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer ${curQ.section !== 'listening' ? 'bg-jade-subtle border-secondary text-secondary' : 'bg-paper-card border-border-subtle text-on-surface-variant hover:bg-surface-container-low'}">
            <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[18px]">menu_book</span> Phần 2: Đọc hiểu</span>
            <span class="font-code text-xs">${doneReading}/${readingQs.length}</span>
          </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
          <!-- LEFT COLUMN: Question & Audio/Reading -->
          <section class="lg:col-span-8 flex flex-col gap-space-md">
            <div class="bg-paper-card rounded-2xl p-space-lg shadow-xs border border-border-subtle flex flex-col gap-space-md">
              <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border-subtle/60">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2.5 py-0.5 rounded-full ${curQ.section === 'listening' ? 'bg-cinnabar-subtle text-primary' : 'bg-jade-subtle text-secondary'} font-code text-xs font-bold">
                    ${curQ.section === 'listening' ? 'NGHE' : 'ĐỌC'} CÂU ${qNum} / 50
                  </span>
                  <span class="text-xs text-outline">${esc(curQ.part)}</span>
                </div>
                <button type="button" id="btnToggleRevealQ" class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer flex items-center gap-1 ${showAnswerBox ? 'bg-jade-subtle border-secondary text-secondary' : 'bg-paper-base border-border-subtle text-on-surface-variant hover:text-on-surface'}">
                  <span class="material-symbols-outlined text-[15px]">${showAnswerBox ? 'visibility_off' : 'visibility'}</span>
                  <span>${showAnswerBox ? 'Ẩn đáp án' : (curQ.section === 'listening' ? 'Đáp án &amp; Lời thoại' : 'Xem đáp án')}</span>
                </button>
              </div>

              <!-- Listening MP3 Audio Box (click-speaker-only, zero auto-play) -->
              ${curQ.section === 'listening' ? `
                <div class="bg-surface-container-low rounded-xl p-3.5 flex flex-col gap-2.5 border border-border-subtle/70">
                  <div class="flex items-center gap-3">
                    <button type="button" class="w-11 h-11 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-sm hover:bg-primary-container active:scale-95 shrink-0 cursor-pointer" id="btn-play-exam-audio" title="Ấn vào loa để phát / tạm dừng câu ${qNum}">
                      <span class="material-symbols-outlined text-[24px]" id="exam-audio-icon">volume_up</span>
                    </button>
                    <div class="flex-1 flex flex-col gap-1 min-w-0">
                      <div class="h-8 w-full flex items-center px-3 bg-paper-card rounded-lg overflow-hidden relative cursor-pointer border border-border-subtle/80" id="exam-audio-wave">
                        <div class="absolute left-0 top-0 bottom-0 bg-cinnabar-subtle/80 transition-all duration-150" id="exam-audio-bar" style="width: 0%;"></div>
                        <span class="relative z-10 text-xs font-medium text-on-surface truncate" id="exam-audio-status">Bấm vào cái loa để nghe câu ${qNum}</span>
                      </div>
                      <div class="flex justify-between text-[11px] font-code text-outline px-0.5">
                        <span class="truncate">${esc(audioFiles.map(f => f.split('/').pop()).join(' + ') || 'Audio SC-TOP')}</span>
                        <span id="exam-audio-time" class="shrink-0">00:00 / --:--</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    ${hasTwoTracks ? `
                      <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-card hover:bg-surface-container text-on-surface text-xs font-medium border border-border-subtle cursor-pointer" data-play-track="0">1. Đoạn nói</button>
                      <button type="button" class="px-2.5 py-1 rounded-lg bg-paper-card hover:bg-surface-container text-on-surface text-xs font-medium border border-border-subtle cursor-pointer" data-play-track="1">2. Câu hỏi ${qNum}</button>
                    ` : ''}
                    <button type="button" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-xs font-medium cursor-pointer" data-play-track="restart">Phát lại</button>
                  </div>
                </div>
              ` : ''}

              <!-- Reading Passage / Graphic -->
              ${curQ.section !== 'listening' && (curQ.image || curQ.context) ? `
                <div class="bg-paper-base p-3.5 rounded-xl border border-border-subtle flex flex-col gap-3">
                  ${curQ.image ? `
                    <div class="w-full overflow-x-auto bg-white rounded-lg p-2 border border-border-subtle">
                      <img src="${esc(curQ.image)}" alt="Ngữ liệu câu ${qNum}" class="max-w-full h-auto mx-auto rounded" loading="eager">
                    </div>
                  ` : ''}
                  ${curQ.context && (!curQ.image || curQ.id === 86 || curQ.id === 87) ? `
                    <div class="font-serif ${exam.fontSizeClass === 'text-headline-lg' ? 'text-xl leading-loose' : (exam.fontSizeClass === 'text-body-lg' ? 'text-sm leading-relaxed' : 'text-base leading-relaxed')} text-on-surface whitespace-pre-wrap">${formatReadingContextHTML(curQ)}</div>
                  ` : (curQ.context ? `
                    <details class="text-xs text-on-surface-variant">
                      <summary class="cursor-pointer font-semibold text-secondary hover:underline">Xem văn bản trích xuất (文字版)</summary>
                      <div class="mt-2 p-3 rounded-lg bg-paper-card font-serif text-sm text-on-surface whitespace-pre-wrap leading-relaxed">${formatReadingContextHTML(curQ)}</div>
                    </details>
                  ` : '')}
                </div>
              ` : ''}

              <!-- Question Stem -->
              <div class="flex items-start gap-2">
                <span class="font-code text-lg text-primary font-bold">${qNum}.</span>
                <h2 class="font-serif ${exam.fontSizeClass === 'text-headline-lg' ? 'text-2xl' : (exam.fontSizeClass === 'text-body-lg' ? 'text-base' : 'text-xl')} text-on-surface font-bold leading-snug" id="target-question-text" lang="zh-Hant">${esc(curQ.q)}</h2>
              </div>

              <!-- 4 Options -->
              <div class="flex flex-col gap-2" id="mcq-options-container">
                ${curQ.options.map((opt, optIdx) => {
                  const letter = ["A", "B", "C", "D"][optIdx];
                  const isSelected = exam.answers[curQ.id] === optIdx;
                  const isCorrect = curQ.ans === optIdx;
                  let optClass = "bg-paper-base hover:bg-surface-container-low border-border-subtle/80 text-on-surface";
                  if (!showAnswerBox) {
                    if (isSelected) optClass = "bg-cinnabar-subtle border-primary text-on-surface font-semibold ring-1 ring-primary/30";
                  } else {
                    if (isCorrect) optClass = "bg-jade-subtle border-secondary text-secondary font-bold ring-1 ring-secondary/40";
                    else if (isSelected && !isCorrect) optClass = "bg-cinnabar-subtle border-primary text-primary font-bold";
                  }
                  return `
                    <div class="flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${optClass}" data-select-opt="${optIdx}">
                      <input ${isSelected ? 'checked' : ''} class="mt-1 w-4 h-4 accent-primary pointer-events-none" type="radio" name="tocfl_q_${curQ.id}" value="${letter}">
                      <span class="font-code font-bold ${isSelected ? 'text-primary' : 'text-outline'}">${letter}.</span>
                      <span class="font-serif text-base text-on-surface flex-1" lang="zh-Hant">${esc(opt)}</span>
                      ${showAnswerBox && isCorrect ? '<span class="material-symbols-outlined text-secondary text-[18px]">check_circle</span>' : ''}
                      ${showAnswerBox && isSelected && !isCorrect ? '<span class="material-symbols-outlined text-primary text-[18px]">cancel</span>' : ''}
                    </div>
                  `;
                }).join("")}
              </div>

              <!-- Answer & Transcript -->
              ${showAnswerBox ? `
                <div class="p-3.5 rounded-xl bg-jade-subtle border border-secondary/30 flex flex-col gap-1.5 text-xs">
                  <div class="text-secondary font-bold">Đáp án đúng: (${curQ.ansChar || ["A","B","C","D"][curQ.ans]}) ${esc(curQ.options[curQ.ans] || "")}</div>
                  ${curQ.explain ? `<p class="text-on-surface leading-relaxed">${esc(curQ.explain)}</p>` : ''}
                  ${curQ.dialogue ? `
                    <div class="mt-1.5 pt-1.5 border-t border-secondary/20">
                      <span class="font-bold text-secondary block mb-1">Lời thoại (聽力文本):</span>
                      <p class="font-serif text-sm text-on-surface whitespace-pre-wrap leading-relaxed" lang="zh-Hant">${esc(curQ.dialogue)}</p>
                    </div>
                  ` : ''}
                </div>
              ` : ''}

              <!-- Prev / Flag / Next -->
              <div class="flex items-center justify-between gap-2 pt-3 border-t border-border-subtle">
                <button type="button" class="px-3.5 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center gap-1 cursor-pointer ${exam.curQuestionIdx === 0 ? 'opacity-40 cursor-not-allowed' : ''}" id="btnPrevQ" ${exam.curQuestionIdx === 0 ? 'disabled' : ''}>
                  <span class="material-symbols-outlined text-[16px]">arrow_back</span> Câu trước
                </button>
                <button type="button" class="px-3 py-2 rounded-lg ${exam.flagged && exam.flagged[curQ.id] ? 'bg-amber-subtle text-tertiary-container font-semibold' : 'bg-surface-container text-on-surface'} text-xs flex items-center gap-1 cursor-pointer" id="flag-btn">
                  <span class="material-symbols-outlined text-[16px]" style="font-variation-settings: 'FILL' ${exam.flagged && exam.flagged[curQ.id] ? 1 : 0};">flag</span>
                  <span>${exam.flagged && exam.flagged[curQ.id] ? 'Đã đánh dấu' : 'Đánh dấu'}</span>
                </button>
                <button type="button" class="px-4 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold flex items-center gap-1 cursor-pointer ${exam.curQuestionIdx >= totalQ - 1 ? 'opacity-40 cursor-not-allowed' : ''}" id="btnNextQ" ${exam.curQuestionIdx >= totalQ - 1 ? 'disabled' : ''}>
                  Câu tiếp <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              </div>
            </div>
          </section>

          <!-- RIGHT COLUMN: Compact Answer Sheet + Utilities -->
          <aside class="lg:col-span-4 flex flex-col gap-space-md">
            <div class="bg-paper-card p-space-md rounded-2xl shadow-xs border border-border-subtle flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <h3 class="font-headline-md text-sm font-bold text-on-surface">Phiếu trả lời (${totalDone}/${totalQ})</h3>
                <div class="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg text-[11px]">
                  <button type="button" class="px-2 py-0.5 rounded font-semibold cursor-pointer ${activeSheetSec === 'listening' ? 'bg-paper-card text-primary shadow-2xs' : 'text-outline'}" data-sheet-sec="listening">Nghe (${doneListening}/50)</button>
                  <button type="button" class="px-2 py-0.5 rounded font-semibold cursor-pointer ${activeSheetSec === 'reading' ? 'bg-paper-card text-secondary shadow-2xs' : 'text-outline'}" data-sheet-sec="reading">Đọc (${doneReading}/50)</button>
                </div>
              </div>
              <div class="grid grid-cols-10 lg:grid-cols-5 gap-1.5">
                ${activeSheetSec === 'listening' ? renderQGrid(listeningQs, true) : renderQGrid(readingQs, false)}
              </div>
              <div class="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle/60">
                <button type="button" class="flex-1 py-1.5 px-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-medium cursor-pointer" id="btn-unanswered-filter">Câu chưa làm (${totalUnanswered})</button>
                <button type="button" class="flex-1 py-1.5 px-2.5 rounded-lg bg-primary text-on-primary text-xs font-bold cursor-pointer" id="btn-final-submit">Nộp bài</button>
              </div>
            </div>

            <div class="bg-paper-card p-space-md rounded-2xl shadow-xs border border-border-subtle flex flex-col gap-2.5 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-on-surface-variant font-medium">Cỡ chữ đề thi</span>
                <div class="flex items-center gap-1">
                  <button type="button" class="w-7 h-7 rounded bg-surface-container hover:bg-surface-container-high font-code font-bold cursor-pointer" id="font-decrease">A-</button>
                  <button type="button" class="px-2 h-7 rounded bg-primary text-on-primary font-code font-semibold cursor-pointer" id="font-reset">Chuẩn</button>
                  <button type="button" class="w-7 h-7 rounded bg-surface-container hover:bg-surface-container-high font-code font-bold cursor-pointer" id="font-increase">A+</button>
                </div>
              </div>
              <div class="pt-2 border-t border-border-subtle/60 text-on-surface-variant space-y-0.5">
                <div><strong>Chuẩn đạt Band B:</strong></div>
                <div>• B1 (進階級): Nghe ≥ 46/80 · Đọc ≥ 48/80</div>
                <div>• B2 (高階級): Nghe ≥ 61/80 · Đọc ≥ 64/80</div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <!-- SUBMIT CONFIRMATION MODAL -->
      <div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-margin hidden" id="submit-modal">
        <div class="bg-paper-card rounded-2xl max-w-md w-full p-space-lg shadow-2xl flex flex-col gap-4 border border-border-subtle">
          <div class="text-center">
            <h3 class="font-headline-md text-lg text-on-surface font-bold">Xác nhận nộp bài ${esc(curTest.shortTitle || 'Band B')}?</h3>
            <p class="text-xs text-on-surface-variant mt-1">Chấm điểm 50 câu Nghe &amp; 50 câu Đọc theo thang 80 điểm chuẩn SC-TOP.</p>
          </div>
          <div class="bg-surface-container-low p-3 rounded-xl flex justify-around text-center border border-border-subtle">
            <div><span class="text-outline text-[11px] block">Đã làm</span><span class="font-code text-lg font-bold text-secondary" id="modalStatAns">${totalDone}</span></div>
            <div><span class="text-outline text-[11px] block">Chưa làm</span><span class="font-code text-lg font-bold text-primary" id="modalStatUnans">${totalUnanswered}</span></div>
            <div><span class="text-outline text-[11px] block">Đánh dấu</span><span class="font-code text-lg font-bold text-tertiary" id="modalStatFlag">${totalFlagged}</span></div>
          </div>
          <div class="flex items-center justify-end gap-2">
            <button type="button" class="px-3.5 py-2 rounded-lg bg-surface-container text-on-surface text-xs font-medium cursor-pointer" id="modal-cancel-btn">Làm tiếp</button>
            <button type="button" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-bold cursor-pointer" id="modal-confirm-btn">Nộp bài ngay</button>
          </div>
        </div>
      </div>

      <!-- HISTORY MODAL -->
      <div class="${exam.historyModalOpen ? 'flex' : 'hidden'} fixed inset-0 z-[100] bg-black/40 backdrop-blur-xs items-center justify-center p-4" id="historyModal">
        <div class="bg-paper-card w-full max-w-lg rounded-2xl p-space-lg shadow-2xl flex flex-col gap-3 border border-border-subtle">
          <div class="flex items-center justify-between border-b pb-2 border-border-subtle">
            <h3 class="font-headline-md text-base text-on-surface font-bold">Lịch sử giải đề TOCFL Band B</h3>
            <button type="button" class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-outline cursor-pointer" id="btnCloseHistory">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <div class="max-h-[300px] overflow-y-auto flex flex-col gap-2">
            ${exam.history.length === 0 ? `<div class="p-6 text-center text-xs text-outline">Chưa có lượt nộp bài nào.</div>` : exam.history.map((h) => `
              <div class="p-3 rounded-xl bg-surface-container-low border border-border-subtle flex items-center justify-between gap-3 text-xs">
                <div>
                  <span class="font-bold text-on-surface">${esc(h.testTitle || "TOCFL Band B")}</span>
                  <div class="text-[11px] text-outline mt-0.5">${esc(h.date)} · Đúng ${h.score}/${h.total}${h.detail ? ' · ' + esc(h.detail) : ''}</div>
                </div>
                <span class="px-2 py-0.5 rounded font-code font-bold shrink-0 ${h.pct >= 55 ? 'bg-jade-subtle text-secondary' : 'bg-cinnabar-subtle text-primary'}">${esc(h.level || '')}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
  `);

  // Strictly click-speaker-only: sync DOM bar state without auto-playing
  updateAudioPlayerDOM();

  const btnPlayEx = $("#btn-play-exam-audio");
  if (btnPlayEx) btnPlayEx.onclick = () => playExamAudio();
  const waveBox = $("#exam-audio-wave");
  if (waveBox) waveBox.onclick = () => playExamAudio();
  document.querySelectorAll("[data-play-track]").forEach((btn) => {
    btn.onclick = () => {
      const tr = btn.dataset.playTrack;
      if (tr === "restart") playExamAudio("restart");
      else playExamAudio(Number(tr));
    };
  });

  if ($("#btnToggleRevealQ")) {
    $("#btnToggleRevealQ").onclick = () => {
      if (!exam.revealedQs) exam.revealedQs = {};
      exam.revealedQs[curQ.id] = !exam.revealedQs[curQ.id];
      return VIEWS["thi-thu"]();
    };
  }

  if ($("#btnSwitchListening")) {
    $("#btnSwitchListening").onclick = () => {
      stopExamAudio();
      examGo(true);
      exam.sheetSection = "auto";
      exam.curQuestionIdx = (tState.lastListenIdx >= 0 && tState.lastListenIdx < firstReadIdx) ? tState.lastListenIdx : 0;
      return VIEWS["thi-thu"]();
    };
  }
  if ($("#btnSwitchReading")) {
    $("#btnSwitchReading").onclick = () => {
      stopExamAudio();
      examGo(true);
      exam.sheetSection = "auto";
      exam.curQuestionIdx = (tState.lastReadIdx >= firstReadIdx && tState.lastReadIdx < totalQ) ? tState.lastReadIdx : firstReadIdx;
      return VIEWS["thi-thu"]();
    };
  }

  document.querySelectorAll("[data-sheet-sec]").forEach((btn) => {
    btn.onclick = () => { exam.sheetSection = btn.dataset.sheetSec; VIEWS["thi-thu"](); };
  });

  document.querySelectorAll("[data-quick-test]").forEach((btn) => {
    btn.onclick = () => {
      stopExamAudio();
      exam.testId = btn.dataset.quickTest;
      examGo(true);
      exam.sheetSection = "auto";
      exam.curQuestionIdx = 0;
      return VIEWS["thi-thu"]();
    };
  });

  document.querySelectorAll("[data-select-opt]").forEach((card) => {
    card.onclick = () => {
      exam.answers[curQ.id] = Number(card.dataset.selectOpt);
      return VIEWS["thi-thu"]();
    };
  });

  if ($("#btnPrevQ")) {
    $("#btnPrevQ").onclick = () => {
      if (exam.curQuestionIdx > 0) { stopExamAudio(); exam.curQuestionIdx--; exam.sheetSection = "auto"; return VIEWS["thi-thu"](); }
    };
  }
  if ($("#btnNextQ")) {
    $("#btnNextQ").onclick = () => {
      if (exam.curQuestionIdx < curTest.questions.length - 1) { stopExamAudio(); exam.curQuestionIdx++; exam.sheetSection = "auto"; return VIEWS["thi-thu"](); }
    };
  }
  if ($("#flag-btn")) {
    $("#flag-btn").onclick = () => {
      if (!exam.flagged) exam.flagged = {};
      exam.flagged[curQ.id] = !exam.flagged[curQ.id];
      return VIEWS["thi-thu"]();
    };
  }
  if ($("#btn-unanswered-filter")) {
    $("#btn-unanswered-filter").onclick = () => {
      const nextUnidx = curTest.questions.findIndex(q => exam.answers[q.id] === undefined);
      if (nextUnidx !== -1) { stopExamAudio(); exam.curQuestionIdx = nextUnidx; exam.sheetSection = "auto"; return VIEWS["thi-thu"](); }
    };
  }

  if ($("#font-decrease")) $("#font-decrease").onclick = () => { exam.fontSizeClass = "text-body-lg"; VIEWS["thi-thu"](); };
  if ($("#font-reset")) $("#font-reset").onclick = () => { exam.fontSizeClass = "text-headline-md"; VIEWS["thi-thu"](); };
  if ($("#font-increase")) $("#font-increase").onclick = () => { exam.fontSizeClass = "text-headline-lg"; VIEWS["thi-thu"](); };

  document.querySelectorAll("[data-jump-q]").forEach((btn) => {
    btn.onclick = () => { stopExamAudio(); exam.curQuestionIdx = Number(btn.dataset.jumpQ); exam.sheetSection = "auto"; VIEWS["thi-thu"](); };
  });

  if ($("#tabOverviewBtn")) $("#tabOverviewBtn").onclick = () => { stopExamAudio(); location.hash = "#thi-thu"; };
  if ($("#tabReviewBtn")) $("#tabReviewBtn").onclick = () => { examGo(true); VIEWS["thi-thu"](); };

  document.querySelectorAll("[data-start-exam]").forEach((btn) => {
    btn.onclick = () => {
      stopExamAudio();
      const tid = btn.dataset.startExam;
      const sec = btn.dataset.startSec || "listening";
      exam.testId = tid;
      examGo(true);
      exam.sheetSection = "auto";
      exam.isExamMode = true;
      const targetTest = displayTests.find(t => t.id === tid) || curTest;
      const rStart = targetTest.questions.findIndex(q => q.section !== "listening");
      exam.curQuestionIdx = (sec === "reading" && rStart >= 0) ? rStart : 0;
      VIEWS["thi-thu"]();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });
  document.querySelectorAll("[data-review-exam]").forEach((btn) => {
    btn.onclick = () => {
      stopExamAudio();
      exam.testId = btn.dataset.reviewExam;
      examGo(true);
      exam.sheetSection = "auto";
      exam.isExamMode = false;
      exam.curQuestionIdx = 0;
      VIEWS["thi-thu"]();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });

  async function doSubmitExam() {
    stopExamAudio();
    let listenCorrect = 0, readCorrect = 0;
    for (const q of listeningQs) if (exam.answers[q.id] === q.ans) listenCorrect++;
    for (const q of readingQs) if (exam.answers[q.id] === q.ans) readCorrect++;
    const correct = listenCorrect + readCorrect;
    const total = curTest.questions.length;
    const pct = Math.round((correct / Math.max(1, total)) * 100);
    const listenScaled = (curTest.scoreTableListen && curTest.scoreTableListen[String(listenCorrect)] !== undefined)
      ? curTest.scoreTableListen[String(listenCorrect)]
      : Math.round((listenCorrect / Math.max(1, listeningQs.length)) * 80);
    const readScaled = (curTest.scoreTableRead && curTest.scoreTableRead[String(readCorrect)] !== undefined)
      ? curTest.scoreTableRead[String(readCorrect)]
      : Math.round((readCorrect / Math.max(1, readingQs.length)) * 80);

    const listenBand = listenScaled >= 61 ? "B2 (高階級)" : (listenScaled >= 46 ? "B1 (進階級)" : "Chưa đạt B1");
    const readBand = readScaled >= 64 ? "B2 (高階級)" : (readScaled >= 48 ? "B1 (進階級)" : "Chưa đạt B1");
    let level = "Chưa đạt Band B";
    if (listenScaled >= 61 && readScaled >= 64) level = "Đạt TOCFL B2 (高階級 • Cấp 4)";
    else if (listenScaled >= 46 && readScaled >= 48) level = "Đạt TOCFL B1 (進階級 • Cấp 3)";
    else if (listenScaled >= 46 || readScaled >= 48) level = `Đạt 1 kỹ năng (Nghe: ${listenBand} • Đọc: ${readBand})`;

    const attempt = {
      testId: curTest.id,
      testTitle: curTest.title,
      date: new Date().toLocaleDateString("vi-VN") + " " + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      score: correct,
      total,
      pct,
      listenCorrect,
      readCorrect,
      listenScaled,
      readScaled,
      listenBand,
      readBand,
      detail: `Nghe ${listenScaled}/80 (${listenCorrect}/50) • Đọc ${readScaled}/80 (${readCorrect}/50)`,
      level
    };

    exam.lastResult = attempt;
    exam.history = exam.history || [];
    exam.history.unshift(attempt);
    exam.isExamMode = false;
    tState.isExamMode = false;
    try { await Store.put("kv", "tocfl_history", exam.history); } catch (e) {}

    VIEWS["thi-thu"]();
  }

  const resetCurrentExam = () => {
    stopExamAudio();
    exam.isExamMode = true;
    tState.isExamMode = true;
    exam.curQuestionIdx = 0;
    exam.sheetSection = "auto";
    tState.answers = exam.answers = {};
    tState.flagged = exam.flagged = {};
    tState.revealedQs = exam.revealedQs = {};
    tState.timerLeft = exam.timerLeft = 7200;
    exam.lastResult = null;
    VIEWS["thi-thu"]();
  };

  if ($("#btnRetakeExam")) $("#btnRetakeExam").onclick = resetCurrentExam;
  if ($("#btnRetakeFromBanner")) $("#btnRetakeFromBanner").onclick = resetCurrentExam;
  if ($("#btnOpenHistory")) $("#btnOpenHistory").onclick = () => { exam.historyModalOpen = true; VIEWS["thi-thu"](); };
  if ($("#btnCloseHistory")) $("#btnCloseHistory").onclick = () => { exam.historyModalOpen = false; VIEWS["thi-thu"](); };

  if (window._tocflTimerInterval) {
    clearInterval(window._tocflTimerInterval);
    window._tocflTimerInterval = null;
  }
  if (exam.isExamMode && exam.timerLeft > 0) {
    window._tocflTimerInterval = setInterval(() => {
      if (!location.hash.startsWith("#thi-thu/") || !exam.isExamMode) {
        clearInterval(window._tocflTimerInterval);
        return;
      }
      exam.timerLeft--;
      tState.timerLeft = exam.timerLeft;
      if (exam.timerLeft <= 0) {
        clearInterval(window._tocflTimerInterval);
        doSubmitExam();
        return;
      }
      const m = Math.floor(exam.timerLeft / 60);
      const s = exam.timerLeft % 60;
      const display = document.getElementById("examTimerDisplay");
      if (display) display.textContent = `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
    }, 1000);
  }

  const submitModal = $("#submit-modal");
  if ($("#modal-cancel-btn")) $("#modal-cancel-btn").onclick = () => { if (submitModal) submitModal.classList.add("hidden"); };
  if ($("#modal-confirm-btn")) $("#modal-confirm-btn").onclick = () => { if (submitModal) submitModal.classList.add("hidden"); return doSubmitExam(); };

  async function promptSubmitModal() {
    if ($("#modalStatAns")) $("#modalStatAns").textContent = totalDone;
    if ($("#modalStatUnans")) $("#modalStatUnans").textContent = totalUnanswered;
    if ($("#modalStatFlag")) $("#modalStatFlag").textContent = totalFlagged;
    if (submitModal && submitModal.classList) submitModal.classList.remove("hidden");
    if (typeof document !== "undefined" && !document.body) await doSubmitExam();
  }

  if ($("#btn-final-submit")) $("#btn-final-submit").onclick = promptSubmitModal;
  if ($("#btnSubmitExam")) $("#btnSubmitExam").onclick = promptSubmitModal;

  window.onkeydown = (e) => {
    if (!location.hash.startsWith("#thi-thu/")) return;
    if (e.key === "Shift" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      playExamAudio();
    }
  };
};

function examGo(inExam) {
  const h = inExam ? "#thi-thu/lam" : "#thi-thu";
  if (location.hash !== h) history.pushState(null, "", h);
  if (S.exam) S.exam.subview = inExam ? "review" : "overview";
}
window.examQuickStart = (testId, section) => {
  stopExamAudio();
  if (S.exam) {
    S.exam.testId = testId;
    examGo(true);
    S.exam.isExamMode = true;
    S.exam.curQuestionIdx = section === "reading" ? 50 : 0;
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
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="font-headline-lg text-lg font-bold text-on-surface">Từ đã nhập trong Hộp thư (<span id="inbox-count">${S.inbox ? S.inbox.size : 0}</span>)</h2>
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-jade-subtle text-secondary border border-secondary/20">Hiển thị đầy đủ các nghĩa &amp; đồng bộ SRS</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span id="inboxEnrichStatus" class="text-xs text-secondary font-medium"></span>
              <button type="button" id="btn-enrich-all-inbox" class="px-3 py-1.5 rounded-lg bg-jade-subtle hover:bg-secondary-container text-secondary border border-secondary/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer">
                <span class="material-symbols-outlined text-[16px]">auto_fix_high</span>
                <span>Cập nhật đầy đủ nghĩa tất cả</span>
              </button>
            </div>
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

  function isPlaceholderNote(txt) {
    const t = String(txt || "").trim();
    return !t || t === "Từ vựng bổ sung" || t === "…";
  }

  function resolveFullInfoForWord(w, entry) {
    const n = S.noteByWord.get(w) || noteOfWord(w);
    const itN = n ? itemOf(n) : {};
    const viRec = (S.vi && (S.vi.get(w) || formsOf(w).map((f) => S.vi.get(f)).find(Boolean))) || {};
    const e = cedFirst(w);
    const py = itN.py || viRec.py || (entry && entry.py) || (e ? e[0][0] : "") || (typeof pinyinProOf === "function" ? pinyinProOf(w) : "");
    const hv = itN.hv || viRec.hv || (entry && entry.hv) || "";
    const pos = itN.pos || viRec.pos || (entry && entry.pos) || "";
    const ng = (Array.isArray(itN.ng) && itN.ng.length) ? itN.ng
      : ((Array.isArray(viRec.ng) && viRec.ng.length) ? viRec.ng
      : ((entry && Array.isArray(entry.ng) && entry.ng.length) ? entry.ng : []));
    const dictVn = itN.vn || viRec.vn || "";
    const userNote = entry && !isPlaceholderNote(entry.note) ? String(entry.note).trim() : "";
    const en = itN.en || (e ? e[0][1].split("/").slice(0, 4).join("; ") : "");
    const band = n ? (bandsOf(n).join(" · ") || (n.deck ? n.deck.name : "")) : "";
    return { n, py, hv, pos, ng, dictVn, userNote, en, band };
  }

  async function enrichInboxKeys(keys, allowRemote = false) {
    if (!S.inbox || !keys.length) return 0;
    const words = keys.map((k) => (S.inbox.get(k) || {}).w).filter(Boolean);
    try {
      await Promise.all([ensureVi(words), ensureRich(words)]);
    } catch (e) {}

    let updatedCount = 0;
    const statusEl = $("#inboxEnrichStatus");
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const entry = S.inbox.get(k);
      if (!entry || !entry.w) continue;
      const w = entry.w;
      if (allowRemote && statusEl && keys.length > 1) {
        statusEl.textContent = `Đang cập nhật ${i + 1}/${keys.length}: ${w}...`;
      }
      let info = resolveFullInfoForWord(w, entry);
      let finalVn = info.dictVn || info.userNote;
      let finalNg = info.ng.slice();

      // If no Vietnamese meaning found locally (or only English), translate automatically when requested
      const looksEnglishOnly = finalVn && !/[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(finalVn) && /^[a-zA-Z0-9\s;,.()/'-]+$/.test(finalVn);
      if (allowRemote && (!finalVn || looksEnglishOnly)) {
        try {
          let trans = await autoTranslateZhToVi(w);
          if ((!trans || trans.toLowerCase() === w.toLowerCase()) && info.en) {
            const tEn = await autoTranslateEnToVi(info.en);
            if (tEn) trans = tEn;
          }
          if (trans && trans.toLowerCase() !== w.toLowerCase()) {
            finalVn = trans;
          }
        } catch (e) {}
      }

      if (!finalNg.length && finalVn && finalVn.includes(";")) {
        finalNg = finalVn.split(/;+/).map((x) => x.trim()).filter(Boolean);
      }

      const nextEntry = Object.assign({}, entry, {
        id: entry.id || k,
        py: info.py || entry.py || "",
        hv: info.hv || entry.hv || "",
        pos: info.pos || entry.pos || "",
        note: finalVn || entry.note || "",
        ng: finalNg.length ? finalNg : (entry.ng || [])
      });

      const changed =
        nextEntry.note !== (entry.note || "") ||
        nextEntry.py !== (entry.py || "") ||
        nextEntry.hv !== (entry.hv || "") ||
        JSON.stringify(nextEntry.ng || []) !== JSON.stringify(entry.ng || []);

      if (changed) {
        updatedCount++;
        S.inbox.set(k, nextEntry);
        try { await Store.put("inbox", k, nextEntry); } catch (e) {}
        if (S.vi) {
          const prevVi = S.vi.get(w) || {};
          const mergedVi = Object.assign({}, prevVi, {
            vn: nextEntry.note || prevVi.vn || "",
            py: nextEntry.py || prevVi.py || "",
            hv: nextEntry.hv || prevVi.hv || "",
            pos: nextEntry.pos || prevVi.pos || "",
            ng: (prevVi.ng && prevVi.ng.length) ? prevVi.ng : (nextEntry.ng && nextEntry.ng.length ? nextEntry.ng : undefined)
          });
          S.vi.set(w, mergedVi);
          try { await Store.put("kv", "vi_" + w, mergedVi); } catch (e) {}
        }
        if (typeof syncInboxWordToLearning === "function") syncInboxWordToLearning(nextEntry, false);
      }
    }
    if (updatedCount > 0 && window.Sync && typeof Sync.onCardGraded === "function") {
      Sync.onCardGraded();
    }
    return updatedCount;
  }

  let editingInboxKey = null;

  const drawInbox = () => {
    const list = $("#ilist");
    const countEl = $("#inbox-count");
    if (countEl) countEl.textContent = S.inbox ? S.inbox.size : 0;
    if (!list) return;
    const entries = S.inbox ? [...S.inbox.entries()].sort((a, b) => (b[1].at || 0) - (a[1].at || 0)) : [];
    if (!entries.length) {
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

    list.innerHTML = entries.map(([key, it]) => {
      let n = S.noteByWord.get(it.w);
      if (!n && typeof syncInboxWordToLearning === "function") {
        n = syncInboxWordToLearning(it, false);
      }
      const lvl = n ? noteLevel(n) : 0;
      const isDue = n && typesOf(n).some(([t]) => {
        const s = S.srs.get(cardId(n, t));
        return s && s.due <= Date.now();
      });

      const info = resolveFullInfoForWord(it.w, it);
      const summaryMeaning = info.dictVn || info.userNote || info.en || "";
      const hasMultiSenses = info.ng && info.ng.length > 0;
      const showUserNoteSeparately = info.userNote && info.dictVn && info.userNote.toLowerCase() !== info.dictVn.toLowerCase();
      const isEditing = editingInboxKey === key;

      return `
        <div class="p-4 rounded-2xl bg-surface-container-low border border-border-subtle hover:border-primary/40 transition-all flex flex-col justify-between gap-3 shadow-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-col min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <a href="#tu/${encodeURIComponent(it.w)}" class="font-serif font-bold text-xl text-on-surface hover:text-primary transition-colors no-underline">${esc(it.w)}</a>
                ${info.py ? `<span class="font-code text-xs text-tertiary font-medium bg-amber-subtle/50 px-2 py-0.5 rounded-md border border-amber-subtle/40">${esc(info.py)}</span>` : ""}
                ${info.band ? `<span class="px-1.5 py-0.5 rounded bg-surface-container text-[10px] font-code font-semibold text-outline">${esc(info.band)}</span>` : ""}
                <button type="button" class="text-secondary hover:text-primary transition-colors p-1 rounded-lg hover:bg-paper-card" onclick="say('${esc(it.w)}')" title="Nghe phát âm">
                  <span class="material-symbols-outlined text-[18px]">volume_up</span>
                </button>
              </div>
              ${info.hv || info.pos ? `
                <div class="text-[11px] text-outline mt-1 flex items-center gap-2 flex-wrap">
                  ${info.hv ? `<span>Hán Việt: <strong class="text-on-surface-variant">${esc(info.hv)}</strong></span>` : ""}
                  ${info.pos ? `<span>· ${esc(info.pos)}</span>` : ""}
                </div>
              ` : ""}
              ${hasMultiSenses ? `
                <ul class="mt-1.5 space-y-1 text-xs text-on-surface leading-relaxed list-disc pl-4">
                  ${info.ng.map((sense) => `<li>${esc(sense)}</li>`).join("")}
                </ul>
              ` : (summaryMeaning ? `<div class="text-xs text-on-surface font-medium mt-1.5 leading-relaxed">${esc(summaryMeaning)}</div>` : `<div class="text-xs text-outline italic mt-1.5">Chưa có nghĩa tiếng Việt — bấm 🔄 để cập nhật tự động.</div>`)}
              ${showUserNoteSeparately ? `<div class="text-[11px] text-tertiary mt-1 bg-amber-subtle/50 px-2 py-1 rounded-lg">Ghi chú của bạn: ${esc(info.userNote)}</div>` : ""}
              ${it.where ? `<div class="text-[11px] text-outline mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">location_on</span><span>${esc(it.where)}</span></div>` : ""}
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button type="button" class="text-xs text-secondary hover:text-primary transition-colors p-1 rounded-lg hover:bg-paper-card" data-enrich-inbox="${esc(key)}" title="Cập nhật nghĩa đầy đủ tự động">
                <span class="material-symbols-outlined text-[16px]">sync</span>
              </button>
              <button type="button" class="text-xs text-outline hover:text-primary transition-colors p-1 rounded-lg hover:bg-paper-card" data-edit-inbox="${esc(key)}" title="Sửa / thêm nghĩa cho từ này">
                <span class="material-symbols-outlined text-[16px]">edit</span>
              </button>
              <button type="button" class="text-xs text-outline hover:text-primary transition-colors p-1 rounded-lg hover:bg-paper-card" data-del-inbox="${esc(key)}" title="Xóa khỏi Hộp thư">
                <span class="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </div>

          ${isEditing ? `
            <div class="p-3 rounded-xl bg-paper-card border border-primary/30 flex flex-col gap-2">
              <label class="text-[11px] font-semibold text-on-surface-variant">Các nghĩa tiếng Việt (mỗi dòng 1 nghĩa hoặc ngăn bằng dấu ;):</label>
              <textarea class="w-full p-2 rounded-lg bg-paper-base border border-border-subtle text-xs text-on-surface resize-y" rows="3" data-edit-senses="${esc(key)}" placeholder="VD: (động từ) nghĩa 1&#10;(danh từ) nghĩa 2">${esc(hasMultiSenses ? info.ng.join("\n") : (info.userNote || info.dictVn || ""))}</textarea>
              <div class="grid grid-cols-2 gap-2">
                <input class="p-1.5 rounded-lg bg-paper-base border border-border-subtle text-xs text-on-surface" data-edit-py="${esc(key)}" value="${esc(info.py)}" placeholder="Pinyin">
                <input class="p-1.5 rounded-lg bg-paper-base border border-border-subtle text-xs text-on-surface" data-edit-hv="${esc(key)}" value="${esc(info.hv)}" placeholder="Âm Hán Việt">
              </div>
              <div class="flex items-center justify-end gap-2">
                <button type="button" class="px-2.5 py-1 rounded-lg bg-surface-container text-xs text-on-surface-variant" data-cancel-edit-inbox="${esc(key)}">Hủy</button>
                <button type="button" class="px-3 py-1 rounded-lg bg-primary text-white text-xs font-semibold" data-save-edit-inbox="${esc(key)}">Lưu nghĩa</button>
              </div>
            </div>
          ` : ""}

          <div class="pt-2.5 border-t border-border-subtle/60 flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border ${lvBadgeColors[lvl]}">
                ${esc(LEVELS[lvl])}
              </span>
              ${isDue ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cinnabar-subtle text-primary border border-cinnabar-subtle">Đến hạn ôn</span>` : ""}
            </div>

            <div class="flex items-center gap-2">
              <select class="text-[11px] font-medium bg-paper-card border border-border-subtle rounded-lg px-2 py-1 text-on-surface focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer" data-change-lvl="${esc(it.w)}" title="Đổi mức nhớ cho từ này">
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
        const key = btn.dataset.delInbox;
        const it = S.inbox.get(key);
        const w = it ? it.w : "";
        if (!confirm(`Bạn có chắc muốn xóa từ "${w}" khỏi Hộp thư không?`)) return;
        S.inbox.delete(key);
        await Store.del("inbox", key);
        if (editingInboxKey === key) editingInboxKey = null;
        drawInbox();
        updateBadge();
      };
    });

    list.querySelectorAll("[data-enrich-inbox]").forEach((btn) => {
      btn.onclick = async () => {
        const key = btn.dataset.enrichInbox;
        btn.disabled = true;
        try {
          const cnt = await enrichInboxKeys([key], true);
          drawInbox();
          const it = S.inbox.get(key);
          showToast(cnt ? `Đã cập nhật nghĩa đầy đủ cho "${it ? it.w : ""}"!` : `"${it ? it.w : ""}" đã có nghĩa đầy đủ mới nhất.`);
        } finally {
          btn.disabled = false;
        }
      };
    });

    list.querySelectorAll("[data-edit-inbox]").forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.editInbox;
        editingInboxKey = (editingInboxKey === key) ? null : key;
        drawInbox();
      };
    });

    list.querySelectorAll("[data-cancel-edit-inbox]").forEach((btn) => {
      btn.onclick = () => { editingInboxKey = null; drawInbox(); };
    });

    list.querySelectorAll("[data-save-edit-inbox]").forEach((btn) => {
      btn.onclick = async () => {
        const key = btn.dataset.saveEditInbox;
        const entry = S.inbox.get(key);
        if (!entry) return;
        const rawSenses = (list.querySelector(`[data-edit-senses="${CSS.escape ? CSS.escape(key) : key}"]`)?.value || "").trim();
        const pyVal = (list.querySelector(`[data-edit-py="${CSS.escape ? CSS.escape(key) : key}"]`)?.value || "").trim();
        const hvVal = (list.querySelector(`[data-edit-hv="${CSS.escape ? CSS.escape(key) : key}"]`)?.value || "").trim();
        const senseList = rawSenses.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const summary = senseList.join("; ");
        const updated = Object.assign({}, entry, {
          id: entry.id || key,
          note: summary,
          ng: senseList,
          py: pyVal || entry.py || "",
          hv: hvVal || entry.hv || ""
        });
        S.inbox.set(key, updated);
        try { await Store.put("inbox", key, updated); } catch (e) {}
        if (S.vi) {
          const mergedVi = Object.assign({}, S.vi.get(entry.w) || {}, {
            vn: summary,
            ng: senseList,
            py: updated.py,
            hv: updated.hv
          });
          S.vi.set(entry.w, mergedVi);
          try { await Store.put("kv", "vi_" + entry.w, mergedVi); } catch (e) {}
        }
        if (typeof syncInboxWordToLearning === "function") syncInboxWordToLearning(updated, false);
        if (window.Sync && typeof Sync.onCardGraded === "function") Sync.onCardGraded();
        editingInboxKey = null;
        drawInbox();
        showToast(`Đã lưu các nghĩa mới cho "${entry.w}"!`);
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

  const btnEnrichAll = $("#btn-enrich-all-inbox");
  if (btnEnrichAll) {
    btnEnrichAll.onclick = async () => {
      const keys = S.inbox ? [...S.inbox.keys()] : [];
      if (!keys.length) { showToast("Hộp thư hiện chưa có từ nào."); return; }
      btnEnrichAll.disabled = true;
      const statusEl = $("#inboxEnrichStatus");
      if (statusEl) statusEl.textContent = "Đang tra cứu & cập nhật nghĩa...";
      try {
        const cnt = await enrichInboxKeys(keys, true);
        if (statusEl) statusEl.textContent = cnt ? `✓ Đã cập nhật ${cnt} từ` : "✓ Tất cả từ đã có nghĩa đầy đủ";
        drawInbox();
        showToast(cnt ? `Đã cập nhật nghĩa đầy đủ cho ${cnt} từ trong Hộp thư!` : "Tất cả từ trong Hộp thư đã có nghĩa đầy đủ!");
      } finally {
        btnEnrichAll.disabled = false;
      }
    };
  }

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const c = check();
    if (!c) return;
    const id = "inbox~" + Date.now();
    const twWord = typeof toTraditionalTw === "function" ? toTraditionalTw(c.w) : c.w;
    try { await Promise.all([ensureVi([twWord]), ensureRich([twWord])]); } catch (err) {}
    const info = resolveFullInfoForWord(twWord, null);
    const typedNote = clean($("#note").value);
    const entry = {
      id,
      w: twWord,
      py: info.py || c.py || (c.n ? itemOf(c.n).py : "") || (typeof pyOf === "function" ? pyOf(twWord) : ""),
      hv: info.hv || "",
      pos: info.pos || "",
      ng: info.ng.length ? info.ng : (typedNote ? typedNote.split(/;+/).map((x) => x.trim()).filter(Boolean) : []),
      where: clean($("#where").value),
      note: typedNote || info.dictVn || info.en || "",
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
    $("#msg").innerHTML = `<span class="inline-flex items-center gap-1.5 text-secondary font-semibold"><span class="material-symbols-outlined text-[16px]">check_circle</span> Đã lưu từ "${esc(twWord)}" vào Hộp thư &amp; đồng bộ ngay vào hàng đợi Học/Ôn tập!</span>`;
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
      const rawW = mHan[0];
      const w = typeof toTraditionalTw === "function" ? toTraditionalTw(rawW) : rawW;
      const info = resolveFullInfoForWord(w, null);
      let rest = line.replace(/^\d+[\.\)\s-]*/, "").replace(rawW, "").replace(w, "").trim();
      let py = info.py || (typeof pyOf === "function" ? pyOf(w) : "");
      const mPy = rest.match(/\(([^)]+)\)/);
      if (mPy) {
        if (!py) py = mPy[1].trim();
        rest = rest.replace(mPy[0], "").trim();
      }
      rest = rest.replace(/^[-–—:]+/, "").trim();
      const vn = rest || info.dictVn || info.en || "";
      const band = info.band || "Cá nhân";
      parsedBatch.push({ w, py, vn, ng: info.ng, hv: info.hv, pos: info.pos, band });
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
          <td class="p-space-sm text-xs text-on-surface">${esc(it.vn || "Tự động cập nhật khi nạp")}</td>
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
  if (btnParse) {
    btnParse.onclick = async () => {
      parseBatchLines();
      const ws = parsedBatch.map((x) => x.w);
      if (ws.length) {
        try { await Promise.all([ensureVi(ws), ensureRich(ws)]); } catch (e) {}
        parseBatchLines();
      }
    };
  }
  const btnSample = $("#btn-batch-sample");
  if (btnSample) {
    btnSample.onclick = async () => {
      if (batchTa) {
        batchTa.value = "1. 璀璨 (cuǐcàn) - rực rỡ lấp lánh\n2. 靦腆 (miǎntiǎn) - bẽn lẽn, e ấp\n3. 奮鬥 (fèndòu) - phấn đấu kiên trì\n4. 絡繹不絕 (luòyìbùjué) - nườm nượp không ngớt";
        parseBatchLines();
        try { await Promise.all([ensureVi(parsedBatch.map((x) => x.w)), ensureRich(parsedBatch.map((x) => x.w))]); } catch (e) {}
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
      const addedKeys = [];
      for (const item of parsedBatch) {
        const id = "inbox~" + item.w;
        const entry = {
          id,
          w: item.w,
          py: item.py,
          hv: item.hv || "",
          pos: item.pos || "",
          ng: item.ng || [],
          where: "Nhập hàng loạt",
          note: item.vn || "",
          at: Date.now()
        };
        S.inbox.set(id, entry);
        addedKeys.push(id);
        try { await Store.put("inbox", id, entry); } catch (err) {}
        if (typeof syncInboxWordToLearning === "function") {
          syncInboxWordToLearning(entry, true);
        }
      }
      await enrichInboxKeys(addedKeys, true);
      drawInbox();
      if (typeof updateBadge === "function") updateBadge();
      const lbl = $("#btn-batch-commit-label");
      if (lbl) lbl.textContent = `✓ Đã nạp & cập nhật nghĩa cho ${parsedBatch.length} từ vào Hộp thư & SRS!`;
    };
  }

  drawInbox();

  // Auto-hydrate all saved inbox words with full senses from rich-tu & vi-dict on view open
  if (S.inbox && S.inbox.size) {
    const allKeys = [...S.inbox.keys()];
    enrichInboxKeys(allKeys, false).then((updated) => {
      if (location.hash === "#nhap") {
        drawInbox();
        if (updated > 0 && $("#inboxEnrichStatus")) {
          $("#inboxEnrichStatus").textContent = `✓ Tự động nạp nghĩa cho ${updated} từ`;
        }
      }
    }).catch(() => {});
  }
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
      <section id="sync-panel" class="bg-paper-card rounded-xl p-space-lg border border-border-subtle/70 shadow-sm flex flex-col gap-space-lg">
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
              <a class="text-primary font-medium hover:underline inline-flex items-center gap-0.5" href="https://github.com/settings/tokens/new?scopes=gist&description=Hoc%20tieng%20Hoa%20dong%20bo" rel="noopener noreferrer" target="_blank">
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

        ${isConnected ? `
        <div class="bg-jade-subtle/60 rounded-xl p-space-md md:p-space-lg border border-secondary/20 flex flex-col gap-space-sm" id="linkDevicePanel">
          <div class="flex items-center gap-space-sm">
            <span class="material-symbols-outlined text-secondary text-[22px]">devices</span>
            <span class="font-headline-md text-headline-md text-on-surface font-semibold">Kết nối điện thoại / tablet</span>
          </div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">Bấm nút dưới, rồi dùng <b>camera</b> của điện thoại hoặc tablet quét mã QR. Máy đó mở trang web và tự kết nối vào cùng tiến độ, không cần gõ token. Làm lần lượt cho từng máy.</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" id="btnShowLinkQR" class="inline-flex items-center gap-space-xs px-space-lg py-2.5 rounded-lg bg-secondary text-white font-label-md text-label-md font-semibold shadow-sm"><span class="material-symbols-outlined text-[18px]">qr_code_2</span><span>Hiện mã QR kết nối</span></button>
            <button type="button" id="btnCopyLink" class="px-space-md py-2.5 rounded-lg bg-paper-card border border-border-subtle text-on-surface font-label-md text-label-md font-semibold">Sao chép link (gửi qua Zalo cho chính mình)</button>
          </div>
          <div id="linkQRBox" class="hidden flex flex-col items-center gap-2 pt-2">
            <div id="linkQR" class="bg-white p-3 rounded-xl"></div>
            <span class="text-xs text-tertiary font-semibold text-center">⚠️ Mã này chứa chìa khóa đồng bộ của bạn: đừng chụp gửi cho người khác. Tự ẩn sau 2 phút.</span>
          </div>
          <span class="text-xs text-secondary font-semibold" id="linkMsg"></span>
        </div>` : ""}

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
      setTheme(themeSel.value === "dark" ? "dark" : "light");
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

  // Link another device: QR / link with the sync key (read only on this device, shown on demand)
  const linkUrl = () => { const c = Sync.getConfig(); return `${location.origin}${location.pathname}#sync-setup?t=${encodeURIComponent(c.token)}&g=${encodeURIComponent(c.gistId)}`; };
  const loadQR = () => window.qrcode ? Promise.resolve() : new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "vendor/qrcode.js"; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
  const btnQR = $("#btnShowLinkQR");
  if (btnQR) btnQR.onclick = async () => {
    const box = $("#linkQRBox"), el = $("#linkQR");
    if (!box.classList.contains("hidden")) { box.classList.add("hidden"); el.innerHTML = ""; return; }
    try {
      await loadQR();
      const qr = qrcode(0, "M"); qr.addData(linkUrl()); qr.make();
      el.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      const svg = el.querySelector("svg"); if (svg) { svg.style.width = "240px"; svg.style.height = "240px"; }
      box.classList.remove("hidden");
      clearTimeout(S._qrHide); S._qrHide = setTimeout(() => { box.classList.add("hidden"); el.innerHTML = ""; }, 120000);
    } catch (e) { $("#linkMsg").textContent = "Không tạo được mã QR, bạn dùng nút Sao chép link nhé."; }
  };
  const btnLink = $("#btnCopyLink");
  if (btnLink) btnLink.onclick = async () => {
    try { await navigator.clipboard.writeText(linkUrl()); $("#linkMsg").textContent = "✓ Đã sao chép. Gửi cho chính bạn (Zalo Cloud, tin nhắn tự gửi), rồi mở link trên điện thoại/tablet."; }
    catch (e) { $("#linkMsg").textContent = "Trình duyệt không cho sao chép, bạn dùng mã QR nhé."; }
  };

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
  if (S.notes && S.notes.length) { try { await reconcileWordProgress(); } catch (e) { console.warn(e); } }
  const kv = await Store.all("kv"); S.packs = kv.get("packs") || []; if (kv.get("settings")) S.settings = Object.assign({ newPerDay: 8, reviewPerDay: 30, decks: {}, bands: {}, extra: {}, ruby: true, syncToken: "", syncGistId: "", autoSync: true, lastSyncTime: "" }, kv.get("settings"));
  if (S.vi && kv && typeof kv.entries === "function") {
    for (const [k, v] of kv.entries()) {
      if (k.startsWith("vi_") && v && typeof v === "object") {
        const w = k.slice(3);
        S.vi.set(w, Object.assign({}, S.vi.get(w) || {}, v));
      }
    }
  }
}
// theme lives in localStorage so it applies before the page paints (see index.html)
function getTheme() { try { return localStorage.getItem("shth-theme") || "light"; } catch (e) { return "light"; } }
function setTheme(v) {
  const mode = v === "dark" ? "dark" : "light";
  try { localStorage.setItem("shth-theme", mode); } catch (e) {}
  if (document.documentElement) {
    document.documentElement.dataset.theme = mode;
    if (document.documentElement.classList) document.documentElement.classList.toggle("dark", mode === "dark");
  }
}

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
  try { setTheme(getTheme()); } catch (e) {}
  try {
    $("#view").innerHTML = `<div class="note">Đang tải bảng từ…</div>`;
    const [t, decks] = await Promise.all([getJSON("data/tocfl.json"), getJSON("data/decks.json")]);
    S.bands = t.bands; S.tocfl = t.words; S.decks = decks;
    try { S.topics = await getJSON("data/chu-de.json"); } catch (e) { S.topics = []; }
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
    if (typeof pruneAndSyncSrs === "function") await pruneAndSyncSrs();
    const fillMissingVi = (atBoot) => ensureVi(S.notes.filter((n) => !n.rich && (n.inbox || (S.settings.extra && S.settings.extra[n.w]) || noteLevel(n) > 0)).map((n) => n.w)).then((ch) => { if (ch && (atBoot || !location.hash.startsWith("#hoc"))) route(); }).catch(() => {});
    S.ready = true;
    initSyncUI();
    route();
    fillMissingVi(true);
    // background: explanations for the words in today's folders, so card types and the answer side are complete
    setTimeout(() => ensureRich(S.notes.filter((n) => needsRich(n) && (n.inbox || inLearning(n) || noteLevel(n) > 0)).map((n) => n.w)).catch(() => {}), 1200);
    if (window.Sync && Sync.isConfigured() && Sync.getConfig().autoSync) {
      Sync.syncNow().then(() => {
        if (typeof syncAllInboxNotes === "function") syncAllInboxNotes();
        fillMissingVi();
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
    getJSON("data/hanzi_dict.json").then((d) => {
      S.hanziDict = d;
      if (location.hash.startsWith("#tu")) route();
    }).catch(() => {});
    getJSON("data/vi-ex.json").then((d) => { S.viEx = d; }).catch(() => {});
    getJSON("data/tbcl_examples.json").then((d) => {
      S.tbcl = d;
      if (location.hash.startsWith("#tu")) route();
    }).catch(() => {});
  } catch (e) { $("#view").innerHTML = `<div class="note">Không tải được dữ liệu: ${esc(e.message)}. Nếu mở bằng file trực tiếp trên máy, hãy dùng đường link GitHub Pages.</div>`; }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.update();
    }).catch(() => {});
    let swReloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swReloading) return;
      swReloading = true;
      location.reload();
    });
  }
})();
