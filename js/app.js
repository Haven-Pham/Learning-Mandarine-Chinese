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
  ced: null, cedList: null, vi: new Map(),
  srs: new Map(), stats: new Map(), inbox: new Map(),
  settings: { newPerDay: 20, decks: {}, bands: {}, extra: {} },
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
    if (richNote) { for (const f of forms) if (!S.noteByWord.has(f)) S.noteByWord.set(f, richNote); richNote.official = richNote.official || { w, py, band, pos }; return; }
    if (S.noteByKey.has(`t~${forms[0]}`) || forms.some((f) => S.noteByWord.has(f) && S.noteByWord.get(f).basic)) return; // same word at a higher band: keep the first
    const n = { key: `t~${forms[0]}`, kind: "vocab", basic: true, w: forms[0], forms, display: w, py, band, pos, theme, idx };
    add(n); for (const f of forms) if (!S.noteByWord.has(f)) S.noteByWord.set(f, n);
  });
}
function cedFirst(w) { const e = S.ced && S.ced.get(w); return e ? e : null; }
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
  if (n.rich) return VOCAB_TYPES;
  const it = itemOf(n); const t = [["rec", "Nhận diện"], ["lis", "Nghe"]];
  if (it.vn || it.en) t.push(["wri", "Nói và viết"]);
  if (it.e2 && it.e2.includes(n.w)) t.push(["clo", "Điền từ"]);
  return t;
}
const cardId = (n, t) => n.rich ? `${n.deck.id}~${n.i}~${t}` : `t~${n.w}~${t}`;
function noteLevel(n) {
  const ls = typesOf(n).map(([t]) => S.srs.get(cardId(n, t))).filter((s) => s && s.state !== "new").map(cardLevel);
  return ls.length ? Math.min(...ls) : 0;
}
function noteLapses(n) { return typesOf(n).reduce((a, [t]) => a + ((S.srs.get(cardId(n, t)) || {}).lapses || 0), 0); }
function levelPill(n) { const l = noteLevel(n); return `<span class="pill lv-${l}">${esc(LEVELS[l])}</span>` + (noteLapses(n) >= 4 ? ` <span class="pill forget">Hay quên</span>` : ""); }
function meaningOf(n) { const it = itemOf(n); return it.vn || it.en || ""; }

// ---------------- study queue ----------------
const deckOn = (id) => S.settings.decks[id] !== false;
function activeNotes() {
  const out = [];
  for (const n of S.notes) {
    if (n.rich) { if (deckOn(n.deck.id)) out.push(n); }
    else if (S.settings.bands[n.band] || S.settings.extra[n.w]) out.push(n);
  }
  return out;
}
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
  if (r.t === "rec") return `<div class="front"><div class="big">${esc(it.w)}</div><div class="task">Nghĩa là gì? Đọc thế nào?</div></div>`;
  if (r.t === "lis") return `<div class="front"><div class="emoji" aria-hidden="true">🎧</div><div class="prompt">Nghe và đoán nghĩa</div>
    <div class="actions center">${sp(it.w, "nghe từ")}${it.e1 ? sp(it.e1, "nghe câu") : ""}</div><div class="task">Nói nghĩa của từ${it.e1 ? " và của câu ví dụ" : ""}</div></div>`;
  if (r.t === "wri") return `<div class="front">${it.img ? `<div class="emoji" aria-hidden="true">${esc(it.img)}</div>` : ""}<div class="prompt">${esc(it.vn || it.en)}</div>
    <div class="task">${it.vn && it.en ? esc(it.en) + " · " : ""}${esc(it.pos || "")}<br>Nói to rồi viết từ này ra giấy</div></div>`;
  const cz = it.e2.split(it.w).join("＿".repeat([...it.w].length));
  return `<div class="front"><div class="cz">${esc(cz)}</div><div class="task">${esc(it.e2v || "")}<br>Điền từ còn thiếu</div></div>`;
}
function kv(rows) { return rows.filter(([, v]) => v).map(([k, v]) => `<div><span class="k">${esc(k)}</span><span class="mix">${esc(v)}</span></div>`).join(""); }
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
      <div class="tip"><b>Cấu trúc</b><span class="han">${esc(it.st)}</span></div>
      ${[1, 2, 3].map((k) => it["e" + k] ? `<div class="ex"><div class="zh">${esc(it["e" + k])} ${sp(it["e" + k])}</div><div class="exs">${esc(it["e" + k + "p"])}<br>${esc(it["e" + k + "v"])}</div></div>` : "").join("")}
      ${it.tw ? `<div class="tw"><b>Người Đài nói thế nào</b><span class="han">${esc(it.tw)}</span></div>` : ""}
      <div class="miss"><b>Lỗi hay gặp:</b> ${esc(it.mk)}</div>
      <details class="more" open><summary>Xem thêm</summary><div class="kv">${kv([["Cách dùng", it.us], ["So sánh với mẫu gần giống", it.cmp], ["Nguồn", it.src]])}</div></details></div>`;
  }
  const band = n.band && S.bands.includes(n.band) ? `TOCFL ${n.band}` : "ngoài bảng TOCFL";
  return `<div class="ans">
    <div class="head">${it.img ? `<div class="emoji-s" aria-hidden="true">${esc(it.img)}</div>` : ""}<div class="w">${esc(it.w)}</div>
      <div class="py">${esc(it.py)} ${sp(it.w)}</div>
      <div class="sub">${[it.pos, it.hv ? "Hán Việt: " + it.hv : "", band].filter(Boolean).map(esc).join(" · ")}</div>
      ${it.vn ? `<div class="vn">${esc(it.vn)}</div>` : `<div class="vn muted">Chưa có nghĩa tiếng Việt</div>`}${it.en ? `<div class="sub">${esc(it.en)}</div>` : ""}</div><!--body-->
    ${it.mi || it.mh || it.ms ? `<div class="tip"><b>Mẹo nhớ</b>${it.mi ? `<div><b>Hình:</b> ${esc(it.mi)}</div>` : ""}${it.mh ? `<div><b>Hán Việt:</b> ${esc(it.mh)}</div>` : ""}${it.ms ? `<div><b>Chuyện:</b> ${esc(it.ms)}</div>` : ""}</div>` : ""}
    ${it.e1 ? `<div class="ex"><div class="zh">${esc(it.e1)} ${sp(it.e1)}</div><div class="exs">${esc(it.e1p || "")}<br>${esc(it.e1v || "")}</div></div>` : ""}
    ${it.e2 ? `<div class="ex"><div class="zh">${esc(it.e2)} ${sp(it.e2)}</div><div class="exs">${esc(it.e2p || "")}<br>${esc(it.e2v || "")}</div></div>` : ""}
    ${it.tw ? `<div class="tw"><b>Người Đài nói thế nào</b><span class="han">${esc(it.tw)}</span></div>` : ""}
    ${it.mk ? `<div class="miss"><b>Lỗi hay gặp:</b> ${esc(it.mk)}</div>` : ""}
    ${(it.us || it.co || it.sy || it.an || it.cf || it.pa || it.fa) ? `<details class="more" open><summary>Xem thêm</summary><div class="kv">${kv([["Cách dùng", it.us], ["Cụm hay gặp", it.co], ["Đồng nghĩa, gần nghĩa", it.sy], ["Trái nghĩa", it.an], ["Dễ nhầm với", it.cf], ["Cấu tạo chữ", it.pa], ["Họ từ", it.fa], ["Nguồn", it.src]])}</div></details>` : ""}
    ${opts.link !== false && n.kind === "vocab" ? `<a class="link" href="#tu/${encodeURIComponent(it.w)}">Mở trong từ điển: nét viết, chữ cấu thành →</a>` : ""}
  </div>`;
}

// ---------------- views ----------------
const VIEWS = {};
function setView(html) { $("#view").innerHTML = html; }
function route() {
  const h = decodeURIComponent(location.hash.slice(1) || "trang-chu");
  const [name, ...rest] = h.split("/"); const arg = rest.join("/");
  document.querySelectorAll("nav.tabs a").forEach((a) => { if (a.dataset.view === name || (name === "tu" && a.dataset.view === "tu-dien")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const fn = VIEWS[name] || VIEWS["trang-chu"];
  if (name !== "hoc") S.session = null;
  fn(arg); window.scrollTo(0, 0); updateBadge();
}
addEventListener("hashchange", route);
function updateBadge() { const b = $("#tabBadge"); if (!b || !S.ready) return; const c = todayCounts().total; b.hidden = !c; b.textContent = c; }

// --- Trang chủ ---
VIEWS["trang-chu"] = () => {
  const vocab = S.notes.filter((n) => n.kind === "vocab");
  const lv = [0, 0, 0, 0, 0, 0]; for (const n of vocab) lv[noteLevel(n)]++;
  const learned = vocab.length - lv[0]; const c = todayCounts();
  const bandCards = S.bands.map((b) => {
    const ns = vocab.filter((n) => (n.official ? n.official.band : n.band) === b);
    const learnedB = ns.filter((n) => noteLevel(n) > 0).length; const pct = ns.length ? (learnedB / ns.length) * 100 : 0;
    return `<a class="folder" href="#thu-muc/${encodeURIComponent(b)}"><div class="fname">${esc(b)}</div><div class="fsub">${esc(BAND_INFO[b])}</div>
      <div class="bar"><span class="cov" style="width:${pct}%"></span></div>
      <div class="fstat num">${fmt(learnedB)} / ${fmt(ns.length)} từ đã học${S.settings.bands[b] ? ` · <b>đang học</b>` : ""}</div></a>`;
  }).join("");
  const mine = S.decks.map((d) => {
    const ns = S.notes.filter((n) => n.rich && n.deck.id === d.id); const l = ns.filter((n) => noteLevel(n) > 0).length;
    return `<a class="folder mine" href="#thu-muc/${encodeURIComponent(d.id)}"><div class="fname">${esc(d.name)}</div>
      <div class="bar"><span class="cov" style="width:${ns.length ? (l / ns.length) * 100 : 0}%"></span></div><div class="fstat num">${fmt(l)} / ${fmt(ns.length)} ${d.kind === "grammar" ? "mẫu" : "từ"} đã học</div></a>`;
  }).join("");
  const days = []; for (let k = 13; k >= 0; k--) { const t = Date.now() - k * DAY; days.push([dayKey(t), new Date(dayStart(t))]); }
  const max = Math.max(1, ...days.map(([key]) => (S.stats.get(key) || {}).reviews || 0));
  setView(`<section class="view"><div class="home-top">
    <div class="hero panel">
      <div class="hero-top"><div><span class="bignum num">${fmt(learned)}</span> <span class="lead-s">từ đã học</span></div>
        <a class="primary btn" href="#hoc">Học ngay${c.total ? ` · ${fmt(c.total)} thẻ` : ""}</a></div>
      <div class="rings">${[1, 2, 3, 4, 5].map((l) => `<div class="ring lv-ring-${l}"><b class="num">${fmt(lv[l])}</b><span>${esc(LEVELS[l])}</span></div>`).join("")}</div>
      <div class="sub">Hôm nay: <b class="num">${fmt(c.due)}</b> thẻ cần ôn · <b class="num">${fmt(c.fresh)}</b> thẻ mới · đã trả lời <b class="num">${fmt(todayStats().reviews)}</b> thẻ</div>
    </div>
    <div class="panel"><div class="eyebrow">Số thẻ đã trả lời, 14 ngày gần nhất</div><div class="week">${days.map(([key, d]) => { const v = (S.stats.get(key) || {}).reviews || 0;
      return `<div title="${esc(key)}: ${v} thẻ"><span class="num">${v || ""}</span><i class="${v ? "" : "zero"}" style="height:${Math.max(2, (v / max) * 60)}px"></i><span>${d.getDate()}</span></div>`; }).join("")}</div></div></div>
    <div><h2 class="h2">Từ vựng TOCFL theo band</h2><p class="lead">${fmt(S.tocfl.length)} từ của bảng chính thức 2024. Mở một band để xem từ và đưa cả band vào lịch học.</p></div>
    <div class="folders">${bandCards}</div>
    <div><h2 class="h2">Thư mục của tôi</h2><p class="lead">Thẻ soạn đầy đủ: từ lớp học, các đợt TOCFL, ngữ pháp.</p></div>
    <div class="folders">${mine}</div>
  </section>`);
};

// --- Học ---
VIEWS["hoc"] = () => {
  if (!S.session) {
    const c = todayCounts();
    setView(`<section class="view"><div class="today">
      <div class="due"><b class="num">${fmt(c.due)}</b><span>thẻ đến hạn ôn</span></div><div class="new"><b class="num">${fmt(c.fresh)}</b><span>thẻ mới hôm nay</span></div>
      <div class="done"><b class="num">${fmt(todayStats().reviews)}</b><span>đã trả lời hôm nay</span></div></div>
      ${c.total ? `<div class="panel"><span class="lead">Ôn thẻ đến hạn trước, rồi học thẻ mới. Tự trả lời trong đầu, bấm “Xem đáp án”, rồi chấm mình nhớ đến đâu.</span>
        <button class="primary reveal" id="start" type="button">Bắt đầu học (${fmt(c.total)} thẻ)</button></div>`
      : `<div class="panel"><b>Xong phần hôm nay.</b><span class="lead">${c.q.freshTotal ? `Còn ${fmt(c.q.freshTotal)} thẻ mới chờ. Muốn học thêm thì tăng số thẻ mới mỗi ngày trong Cài đặt.` : `Chưa có thẻ mới. Vào Thư mục, mở một band và bấm “Đưa band này vào lịch học”.`}</span></div>`}
    </section>`);
    const b = $("#start"); if (b) b.onclick = () => { S.session = { answered: 0, shown: false, start: c.total, lastNote: null }; S.session.current = nextCard(Date.now()); renderCard(); };
    return;
  }
  renderCard();
};
function renderCard() {
  const ss = S.session;
  if (!ss.current) { setView(`<section class="view"><div class="panel"><b>Xong phần hôm nay. Đã trả lời ${fmt(ss.answered)} thẻ.</b>
    <span class="lead">Thẻ chấm “Quên” quay lại sau ít phút; mở lại mục Học lúc đó để ôn nốt.</span><a class="link" href="#trang-chu">Về trang chủ</a></div></section>`); updateBadge(); return; }
  const r = ss.current; const types = typesOf(r.n); const label = (types.find(([t]) => t === r.t) || [r.t, r.t])[1];
  const pct = Math.min(100, (ss.answered / Math.max(ss.start, ss.answered + 1)) * 100);
  const src = r.n.rich ? r.n.deck.name : `TOCFL ${r.n.band}`;
  const kindRow = `<div class="kind"><span>${esc(label)} · ${esc(src)}</span><span>${r.s && r.s.state !== "new" ? esc(LEVELS[cardLevel(r.s)]) : "Thẻ mới"}</span></div>`;
  const tail = `<div class="msg err" id="saveErr"></div><button type="button" class="link" id="stop">Dừng, học tiếp sau</button>`;
  let html = `<section class="view"><div class="sessbar"><span style="width:${pct}%"></span></div>`;
  if (ss.shown) {
    const now = Date.now(); const p = detailParts(r.n, { answer: r.t === "clo" });
    const grades = `<div class="grades">${[1, 2, 3, 4].map((g) => { const ns = schedule(r.s, g, now);
      return `<button type="button" class="g${g}" data-g="${g}">${["", "Quên", "Khó", "Nhớ", "Dễ"][g]}<small>${esc(fmtGap(ns.due - now))}</small></button>`; }).join("")}</div>
      <div class="keys">Bàn phím: 1 Quên · 2 Khó · 3 Nhớ · 4 Dễ</div>`;
    html += `<article class="card split"><div class="col-a">${kindRow}${frontHTML(r)}<div class="ans">${p.head}</div>${grades}${tail}</div>
      <div class="col-b ans">${p.body}</div></article>`;
  } else html += `<article class="card">${kindRow}${frontHTML(r)}<button class="primary reveal" type="button" id="reveal">Xem đáp án</button><div class="keys">Bàn phím: phím cách để xem đáp án</div>${tail}</article>`;
  html += `</section>`;
  setView(html);
  const rv = $("#reveal"); if (rv) rv.onclick = reveal;
  document.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => grade(Number(b.dataset.g))));
  $("#stop").onclick = () => { S.session = null; location.hash = "#trang-chu"; };
  if (!ss.shown && r.t === "lis" && r.n.kind !== "grammar") say(itemOf(r.n).w);
}
function reveal() { const ss = S.session; if (!ss || !ss.current || ss.shown) return; ss.shown = true; renderCard(); window.scrollTo(0, 0);
  const r = ss.current; if (r.n.kind !== "grammar" && r.t !== "lis") say(itemOf(r.n).w); }
async function grade(g) {
  const ss = S.session; if (!ss || !ss.current || !ss.shown) return;
  const r = ss.current, now = Date.now(); const wasNew = !r.s || r.s.state === "new";
  const ns = schedule(r.s, g, now); ns.firstSeen = wasNew ? now : (r.s.firstSeen || r.s.last || now);
  Object.assign(ns, { w: itemOf(r.n).w });
  S.srs.set(r.id, ns);
  const key = dayKey(now); const st = Object.assign({ reviews: 0, newCards: 0, again: 0 }, S.stats.get(key));
  st.reviews++; if (wasNew) st.newCards++; if (g === 1) st.again++; S.stats.set(key, st);
  ss.answered++; ss.lastNote = r.n.key; ss.shown = false; ss.current = nextCard(now);
  renderCard(); window.scrollTo(0, 0); updateBadge();
  try { await Store.put("srs", r.id, ns); await Store.put("stats", key, st); }
  catch (e) { const el = $("#saveErr"); if (el) el.textContent = "Chưa lưu được tiến độ vào trình duyệt: " + (e && e.message || e); }
}
document.addEventListener("keydown", (e) => {
  const ss = S.session; if (!ss || !ss.current || !location.hash.startsWith("#hoc")) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (!ss.shown && (e.key === " " || e.key === "Enter")) { e.preventDefault(); reveal(); }
  else if (ss.shown && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); grade(Number(e.key)); }
});

// --- Tra từ ---
VIEWS["tu-dien"] = (arg) => {
  setView(`<section class="view"><label for="dq" class="biglabel">Tra từ: chữ Hán, pinyin (không cần dấu), tiếng Việt hoặc tiếng Anh
    <input id="dq" class="bigin" placeholder="例如：學生 · xuesheng · học sinh · student" value="${esc(arg || "")}" autocomplete="off"></label>
    <div class="count" id="dcount"></div><div class="list grid2" id="dres"></div></section>`);
  const inp = $("#dq"); let tmr = null;
  inp.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => searchDict(inp.value), 150); };
  inp.focus(); searchDict(inp.value);
};
function searchDict(raw) {
  const out = $("#dres"), cnt = $("#dcount"); if (!out) return;
  const q = clean(raw); if (!q) { cnt.textContent = ""; out.innerHTML = `<div class="empty">Gõ từ cần tra. Kết quả hiện từ TOCFL trước, sau đó đến từ điển đầy đủ ${S.ced ? `(${fmt(S.ced.size)} mục)` : "(đang tải…)"}.</div>`; return; }
  const res = []; const seen = new Set();
  const push = (w, n, pri) => { if (seen.has(w)) return; seen.add(w); res.push({ w, n, pri }); };
  if (isHan(q)) {
    for (const [w, n] of S.noteByWord) if (w.includes(q)) push(w, n, w === q ? 0 : w.startsWith(q) ? 1 : 2);
    if (S.ced) for (const w of S.ced.keys()) { if (res.length > 400) break; if (w.includes(q)) push(w, null, w === q ? 0 : w.startsWith(q) ? 3 : 4); }
  } else {
    const f = fold(q);
    for (const n of S.notes) { const it = itemOf(n); const p = fold(it.py);
      if (p === f) push(it.w, n, 0); else if (p.startsWith(f)) push(it.w, n, 1); else if (f.length >= 2 && (fold(it.vn).includes(f) || fold(it.en).includes(f))) push(it.w, n, 2); }
    if (S.ced && f.length >= 2) for (const [w, es] of S.ced) { if (res.length > 400) break;
      for (const [py, defs] of es) { const p = fold(py); if (p === f) { push(w, null, 3); break; } if (f.length >= 3 && fold(defs).includes(f)) { push(w, null, 5); break; } } }
  }
  res.sort((a, b) => a.pri - b.pri || a.w.length - b.w.length);
  cnt.textContent = `${fmt(Math.min(res.length, 80))}${res.length > 80 ? "+" : ""} kết quả`;
  out.innerHTML = res.slice(0, 80).map(({ w, n }) => {
    const e = cedFirst(w); const py = n ? itemOf(n).py : e ? e[0][0] : ""; const m = n ? meaningOf(n) : enOf(w);
    return `<a class="item" href="#tu/${encodeURIComponent(w)}"><div class="w">${esc(w)}</div><div class="meta"><div class="py">${esc(py)}</div><div class="vn">${esc(m)}</div></div>
      <div class="side">${n ? `<span class="pill band">${esc(n.official ? n.official.band : S.bands.includes(n.band) ? n.band : "Lớp học")}</span>${levelPill(n)}` : `<span class="pill">ngoài TOCFL</span>`}</div></a>`;
  }).join("") || `<div class="empty">Không tìm thấy. Thử gõ chữ Hán Phồn thể hoặc pinyin không dấu.</div>`;
}
VIEWS["tu"] = (w) => {
  const n = S.noteByWord.get(w); const e = cedFirst(w);
  const inLearn = n && (n.rich ? deckOn(n.deck.id) : (S.settings.bands[n.band] || S.settings.extra[n.w]));
  const chars = [...new Set([...hanOnly(w)])];
  const containing = (c) => S.notes.filter((x) => x.kind === "vocab" && x.w.includes(c) && x.w !== w).slice(0, 16);
  setView(`<section class="view"><a class="link" href="#tu-dien">← Tra từ khác</a><div class="cols"><div class="c1">
    ${n ? detailHTML(n, { link: false }) : `<div class="ans"><div class="head"><div class="w">${esc(w)}</div><div class="py">${esc(e ? e[0][0] : "")} ${sp(w)}</div><div class="sub">ngoài bảng TOCFL</div></div></div>`}
    ${n ? `<div class="actions"><span>Mức nhớ: ${levelPill(n)}</span>${n.basic ? (inLearn ? `<span class="pill lv-2">Đang trong lịch học</span>` : `<button type="button" class="primary" id="addLearn">Thêm từ này vào lịch học</button>`) : ""}</div>` : ""}
    ${e ? `<div class="panel"><div class="eyebrow">Nghĩa tiếng Anh (CC-CEDICT)</div>${e.map(([py, defs]) => `<div class="cedrow"><span class="py">${esc(py)}</span> ${esc(defs.replace(/\[[^\]]*\d\]/g, "").split("/").join("; "))}</div>`).join("")}</div>` : ""}
    </div><div class="c2"><div class="panel"><div class="eyebrow">Nét viết · bấm “Xem nét” hoặc “Viết thử”</div><div class="strokes">${chars.map((c, k) => `
      <div class="sbox"><div class="hw" id="hw${k}" data-c="${esc(c)}"></div><div class="actions center"><button type="button" class="small" data-anim="${k}">Xem nét</button><button type="button" class="small" data-quiz="${k}">Viết thử</button></div>
      <div class="sub center">${esc(c)} · ${esc((cedFirst(c) || [[""]])[0][0])}</div></div>`).join("")}</div>
      <div class="sub">Thứ tự nét lấy từ Make Me a Hanzi, theo chuẩn Trung Quốc đại lục; vài chữ có thể khác thứ tự nét chuẩn Đài Loan.</div></div>
    ${chars.map((c) => { const cs = containing(c); const ce = cedFirst(c);
      return `<div class="panel"><div class="eyebrow">Chữ ${esc(c)}</div><div class="charline"><span class="han bigc">${esc(c)}</span><span>${esc(ce ? ce.map(([py, d]) => py + ": " + d.replace(/\[[^\]]*\d\]/g, "").split("/").slice(0, 3).join("; ")).slice(0, 2).join(" | ") : "")}</span></div>
        ${cs.length ? `<div class="sub">Từ TOCFL có chữ này:</div><div class="chips">${cs.map((x) => `<a class="chip" href="#tu/${encodeURIComponent(x.w)}"><span class="han">${esc(x.w)}</span> ${esc(itemOf(x).py)}</a>`).join("")}</div>` : ""}</div>`; }).join("")}
  </div></div></section>`);
  const add = $("#addLearn"); if (add) add.onclick = async () => { S.settings.extra[n.w] = true; await saveSettings(); route(); };
  chars.forEach((c, k) => drawChar(k, c));
};
const strokeCache = new Map();
async function strokeData(c) {
  const k = String(c.codePointAt(0) % 64).padStart(2, "0");
  if (!strokeCache.has(k)) strokeCache.set(k, getJSON(`data/strokes/${k}.json`));
  const chunk = await strokeCache.get(k); if (!chunk[c]) throw new Error("no data"); return chunk[c];
}
const writers = {};
function drawChar(k, c) {
  const el = $("#hw" + k); if (!el || !window.HanziWriter) return;
  const css = getComputedStyle(document.documentElement);
  const w = HanziWriter.create(el, c, { width: 150, height: 150, padding: 6, showOutline: true, strokeColor: css.getPropertyValue("--ink").trim() || "#18212E",
    outlineColor: css.getPropertyValue("--line").trim() || "#ddd", highlightColor: css.getPropertyValue("--jade").trim() || "#1C7563", drawingColor: css.getPropertyValue("--indigo").trim() || "#333",
    strokeAnimationSpeed: 1, delayBetweenStrokes: 250, charDataLoader: (ch, onLoad, onErr) => { strokeData(ch).then(onLoad).catch(() => { el.innerHTML = `<div class="nodata">Chưa có dữ liệu nét cho chữ này</div>`; onErr && onErr(); }); } });
  writers[k] = w;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-anim]"); if (a && writers[a.dataset.anim]) { writers[a.dataset.anim].animateCharacter(); return; }
  const q = e.target.closest("[data-quiz]"); if (q && writers[q.dataset.quiz]) { writers[q.dataset.quiz].quiz({ showHintAfterMisses: 2 }); }
});

// --- Thư mục ---
VIEWS["thu-muc"] = (id) => {
  if (!id) {
    setView(`<section class="view"><h2 class="h2">Thư mục</h2><div class="folders">${S.bands.map((b) => `<a class="folder" href="#thu-muc/${encodeURIComponent(b)}"><div class="fname">${esc(b)}</div><div class="fsub">${esc(BAND_INFO[b])}</div></a>`).join("")}
      ${S.decks.map((d) => `<a class="folder mine" href="#thu-muc/${encodeURIComponent(d.id)}"><div class="fname">${esc(d.name)}</div></a>`).join("")}</div></section>`); return;
  }
  const isBand = S.bands.includes(id); const deck = S.decks.find((d) => d.id === id);
  const ns = isBand ? S.notes.filter((n) => n.kind === "vocab" && (n.official ? n.official.band : n.band) === id) : S.notes.filter((n) => n.rich && n.deck.id === id);
  const on = isBand ? !!S.settings.bands[id] : deckOn(id);
  const lv = [0, 0, 0, 0, 0, 0]; ns.forEach((n) => lv[noteLevel(n)]++);
  setView(`<section class="view"><a class="link" href="#trang-chu">← Trang chủ</a>
    <div class="panel"><h2 class="h2">${esc(isBand ? `TOCFL ${id}` : deck ? deck.name : id)}</h2><div class="sub">${isBand ? esc(BAND_INFO[id]) + " · " : ""}${fmt(ns.length)} ${deck && deck.kind === "grammar" ? "mẫu" : "từ"} · ${LEVELS.map((l, i) => lv[i] ? `${l} ${lv[i]}` : "").filter(Boolean).join(" · ")}</div>
      <div class="actions"><button type="button" class="${on ? "" : "primary"}" id="toggleLearn">${on ? "Tạm dừng học thư mục này" : isBand ? "Đưa band này vào lịch học" : "Học thư mục này"}</button>
      <span class="sub">${on ? "Từ mới của thư mục này đang được đưa vào mục Học, theo thứ tự trong danh sách." : "Thẻ đã học vẫn được ôn đúng lịch dù tạm dừng."}</span></div>
      <label for="fq">Lọc trong thư mục<input id="fq" placeholder="chữ Hán, pinyin hoặc nghĩa"></label></div>
    <div class="list grid2" id="flist"></div></section>`);
  const draw = () => { const f = fold($("#fq").value);
    $("#flist").innerHTML = ns.filter((n) => { if (!f) return true; const it = itemOf(n); return fold(it.w).includes(f) || fold(it.py).includes(f) || fold(meaningOf(n)).includes(f); }).map((n) => { const it = itemOf(n);
      const inner = `<div class="w ${n.kind === "grammar" ? "gram" : ""}">${esc(n.basic ? n.display : it.w)}</div>
        <div class="meta"><div class="py">${esc(it.py)}</div><div class="vn">${esc(meaningOf(n) || "…")}</div></div><div class="side">${levelPill(n)}</div>`;
      return n.kind === "grammar" ? `<div class="item clickable" role="button" tabindex="0" data-gram="${esc(n.key)}">${inner}</div>` : `<a class="item" href="#tu/${encodeURIComponent(it.w)}">${inner}</a>`; }).join("") || `<div class="empty">Không có mục nào khớp.</div>`; };
  $("#fq").oninput = draw; draw();
  $("#flist").addEventListener("click", (e) => { const g = e.target.closest("[data-gram]"); if (!g) return; e.preventDefault(); const n = S.noteByKey.get(g.dataset.gram);
    g.insertAdjacentHTML("afterend", `<div class="panel">${detailHTML(n, { link: false })}</div>`); g.removeAttribute("data-gram"); });
  $("#toggleLearn").onclick = async () => { if (isBand) S.settings.bands[id] = !on; else S.settings.decks[id] = !on; await saveSettings(); route(); };
};

// --- Chép chính tả ---
// Sentence bank: example sentences from our own cards (public) + private packs the user loads from a file.
function segment(zh) {
  // greedy longest match: TOCFL / card words first, then CC-CEDICT
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
    for (const k of n.kind === "grammar" ? [1, 2, 3] : [1, 2]) if (it["e" + k]) out.push({ zh: it["e" + k], py: it["e" + k + "p"], vn: it["e" + k + "v"], src: n.rich ? n.deck.name : `TOCFL ${n.band}`, own: true });
  }
  for (const p of S.packs || []) for (const s of p.sentences || []) out.push({ zh: s.zh, py: s.py || "", vn: s.vn || "", src: s.src || p.name, pack: p.name });
  return out;
}
function weightOf(tokens) {
  let w = 0;
  for (const k of tokens) if (k.n) { const l = noteLevel(k.n); if (l > 0) w += 1 + (5 - l) + Math.min(4, noteLapses(k.n)); }
  return w;
}
VIEWS["chinh-ta"] = () => {
  const d = S.dict; d.score = d.score || { ok: 0, total: 0 };
  const sources = ["Tất cả", "Câu ví dụ trong thẻ", ...(S.packs || []).map((p) => p.name)];
  setView(`<section class="view"><div class="panel"><h2 class="h2">Chép chính tả</h2>
    <p class="lead">Nghe một câu rồi viết lại. Trang ưu tiên câu có chứa từ bạn đang học, nhất là từ còn yếu hoặc hay quên. Chấm xong, bấm vào từ gạch chân để mở từ điển.</p>
    <div class="row3"><label for="dm">Cách trả lời<select id="dm"><option value="han">Gõ chữ Hán</option><option value="paper">Viết ra giấy rồi tự chấm</option><option value="word">Chỉ chép từ (không cả câu)</option></select></label>
      <label for="dsrc">Nguồn câu<select id="dsrc">${sources.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
      <label for="dsp">Tốc độ đọc<select id="dsp"><option value="0.9">Bình thường</option><option value="0.7">Chậm</option><option value="0.55">Rất chậm</option></select></label></div>
    <details class="packs"><summary>Bộ câu riêng (${(S.packs || []).length})</summary>
      <p class="sub">Câu trích từ giáo trình hay đề thi chỉ nên giữ riêng, không đăng lên web. Mở file bộ câu (.json) trong Google Drive, thư mục “10 Website học tiếng Hoa/bo-cau-rieng”. Câu được lưu trong trình duyệt của bạn.</p>
      <div class="actions"><label class="filebtn" for="packfile">Nạp bộ câu từ file<input type="file" id="packfile" accept=".json,application/json"></label><span class="msg" id="pmsg"></span></div>
      <div class="list">${(S.packs || []).map((p, i) => `<div class="item"><div class="meta"><div class="vn">${esc(p.name)}</div><div class="sub">${fmt(p.sentences.length)} câu</div></div><div class="side"><button type="button" class="link" data-rmpack="${i}">Gỡ</button></div></div>`).join("")}</div>
    </details></div>
    <div id="dict"></div></section>`);
  $("#dm").value = d.mode || "han"; $("#dsrc").value = d.srcSel || "Tất cả"; $("#dsp").value = String(d.rate || 0.9);
  $("#dm").onchange = (e) => { d.mode = e.target.value; nextDict(); };
  $("#dsrc").onchange = (e) => { d.srcSel = e.target.value; nextDict(); };
  $("#dsp").onchange = (e) => { d.rate = Number(e.target.value); };
  $("#packfile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const p = JSON.parse(await f.text()); if (p.app !== "so-hoc-tieng-hoa-pack" || !Array.isArray(p.sentences)) throw new Error("File không đúng định dạng bộ câu.");
      S.packs = (S.packs || []).filter((x) => x.name !== p.name).concat([{ name: p.name, sentences: p.sentences.filter((s) => s && s.zh) }]);
      await Store.put("kv", "packs", S.packs); route(); }
    catch (err) { $("#pmsg").textContent = "Không nạp được: " + err.message; }
  };
  document.querySelectorAll("[data-rmpack]").forEach((b) => (b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Bấm lần nữa để gỡ"; return; }
    S.packs.splice(Number(b.dataset.rmpack), 1); await Store.put("kv", "packs", S.packs); route(); }));
  nextDict();
};
function nextDict() {
  const d = S.dict, box = $("#dict"); if (!box) return;
  if (d.mode === "word") return nextWordDict();
  let bank = sentenceBank();
  if (d.srcSel && d.srcSel !== "Tất cả") bank = bank.filter((s) => d.srcSel === "Câu ví dụ trong thẻ" ? s.own : s.pack === d.srcSel);
  if (!bank.length) { box.innerHTML = `<div class="note">Chưa có câu nào ở nguồn này. Nạp bộ câu riêng hoặc chọn nguồn khác.</div>`; return; }
  const scored = bank.map((s) => { const tokens = segment(s.zh); return { s, tokens, w: weightOf(tokens) }; });
  const learned = scored.filter((x) => x.w > 0);
  const pool = learned.length >= 3 ? learned : scored;
  const total = pool.reduce((a, x) => a + (x.w || 1), 0); let r = Math.random() * total; let pick = pool[0];
  for (const x of pool) { r -= (x.w || 1); if (r <= 0) { pick = x; break; } }
  d.cur = pick;
  const linked = pick.tokens.filter((k) => k.n && noteLevel(k.n) > 0).length;
  box.innerHTML = `<article class="card"><div class="kind"><span>Đã chép ${d.score.total} câu · đúng ${d.score.ok}</span><span>${esc(pick.s.src)}</span></div>
    <div class="front"><div class="emoji" aria-hidden="true">🎧</div>
      <div class="actions center"><button type="button" class="speak" id="play">▶ nghe câu</button><button type="button" class="speak" id="playslow">▶ nghe chậm</button></div>
      <div class="task">Câu có ${[...hanOnly(pick.s.zh)].length} chữ${linked ? ` · chứa ${linked} từ bạn đang học` : ""}</div>
      ${d.mode === "paper" ? `<div class="task">Viết ra giấy, xong bấm “Xem đáp án”.</div>` : `<textarea id="dans" class="bigin han" rows="2" placeholder="Gõ chữ Hán bạn nghe được" autocomplete="off"></textarea>`}</div>
    <button type="button" class="primary reveal" id="dcheck">${d.mode === "paper" ? "Xem đáp án" : "Kiểm tra"}</button><div id="dout"></div></article>`;
  const play = (rate) => say(pick.s.zh, rate);
  $("#play").onclick = () => play(d.rate || 0.9); $("#playslow").onclick = () => play(0.6);
  play(d.rate || 0.9);
  const inp = $("#dans"); if (inp) { inp.focus(); inp.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#dcheck").click(); } }; }
  $("#dcheck").onclick = checkDict;
}
// mark which characters of the target the learner got (longest common subsequence)
function diffMarks(target, typed) {
  const a = [...target], b = [...typed]; const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ok = new Array(m).fill(false); let i = 0, j = 0;
  while (i < m && j < n) { if (a[i] === b[j]) { ok[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return ok;
}
function sentenceAnswer(cur, marks) {
  let ci = 0;
  const html = cur.tokens.map((k) => {
    const chars = [...k.t].map((c) => { if (!isHan(c)) return esc(c); const good = !marks || marks[ci++]; return good ? esc(c) : `<span class="wrongc">${esc(c)}</span>`; }).join("");
    if (k.n) { const l = noteLevel(k.n); return `<a class="tok lv-u-${l}" href="#tu/${encodeURIComponent(k.n.w)}" title="${esc(itemOf(k.n).py + " · " + meaningOf(k.n) + " · " + LEVELS[l])}">${chars}</a>`; }
    return isHan(k.t) && S.ced && S.ced.has(k.t) ? `<a class="tok" href="#tu/${encodeURIComponent(k.t)}">${chars}</a>` : chars;
  }).join("");
  const py = cur.s.py || autoPinyin(cur.tokens);
  const words = cur.tokens.filter((k) => k.n && noteLevel(k.n) > 0).map((k) => k.n).filter((n, i, arr) => arr.indexOf(n) === i);
  return `<div class="ans"><div class="sentence han">${html}</div><div class="py sub-py">${esc(py)}${cur.s.py ? "" : ` <span class="sub">(pinyin tự động, có thể sai chữ đa âm)</span>`}</div>
    ${cur.s.vn ? `<div class="vn-s">${esc(cur.s.vn)}</div>` : ""}
    ${words.length ? `<div class="sub center">Từ bạn đang học trong câu:</div><div class="chips center">${words.map((n) => `<a class="chip" href="#tu/${encodeURIComponent(n.w)}"><span class="han">${esc(n.w)}</span> ${esc(meaningOf(n).slice(0, 40))} ${levelPill(n)}</a>`).join("")}</div>` : `<div class="sub center">Bấm vào chữ trong câu để tra từ.</div>`}</div>`;
}
function checkDict() {
  const d = S.dict, c = d.cur, btn = $("#dcheck"); if (!c) return;
  if (btn.dataset.done) { nextDict(); return; }
  const target = hanOnly(c.s.zh);
  if (d.mode === "paper") {
    $("#dout").innerHTML = sentenceAnswer(c, null) + `<div class="actions center"><button type="button" class="g1" id="selfNo">Viết sai</button><button type="button" class="g3" id="selfYes">Viết đúng</button></div>`;
    const fin = (v) => { d.score.total++; if (v) d.score.ok++; nextDict(); };
    $("#selfNo").onclick = () => fin(false); $("#selfYes").onclick = () => fin(true); btn.hidden = true; return;
  }
  const typed = hanOnly($("#dans").value); const marks = diffMarks(target, typed);
  const right = marks.filter(Boolean).length; const ok = typed === target;
  d.score.total++; if (ok) d.score.ok++;
  $("#dout").innerHTML = `<div class="verdict ${ok ? "good" : "bad"}">${ok ? "Đúng hết!" : `Đúng ${right}/${target.length} chữ. Chữ đỏ là chữ còn thiếu hoặc sai.`}</div>` + sentenceAnswer(c, marks);
  btn.textContent = "Câu tiếp theo"; btn.dataset.done = "1";
}
function nextWordDict() {
  const d = S.dict, box = $("#dict");
  const pool = S.notes.filter((n) => n.kind === "vocab" && noteLevel(n) > 0);
  const list = pool.length >= 5 ? pool : activeNotes().filter((n) => n.kind === "vocab").slice(0, 80);
  if (!list.length) { box.innerHTML = `<div class="note">Chưa có từ nào. Vào Thư mục để đưa một band vào lịch học trước.</div>`; return; }
  const n = list[Math.floor(Math.random() * list.length)], it = itemOf(n);
  d.cur = { s: { zh: it.w, py: it.py, vn: meaningOf(n), src: "Từ đang học" }, tokens: [{ t: it.w, n }] };
  box.innerHTML = `<article class="card"><div class="kind"><span>Đã chép ${d.score.total} · đúng ${d.score.ok}</span><span>Chép từ</span></div>
    <div class="front"><div class="emoji" aria-hidden="true">🎧</div><div class="actions center"><button type="button" class="speak" id="play">▶ nghe</button></div>
    <input id="dans" class="bigin han" placeholder="Gõ chữ Hán" autocomplete="off"></div>
    <button type="button" class="primary reveal" id="dcheck">Kiểm tra</button><div id="dout"></div></article>`;
  $("#play").onclick = () => say(it.w, d.rate || 0.9); say(it.w, d.rate || 0.9);
  const inp = $("#dans"); inp.focus(); inp.onkeydown = (e) => { if (e.key === "Enter") $("#dcheck").click(); };
  $("#dcheck").onclick = checkDict;
}

// --- Nhập từ ---
VIEWS["nhap"] = () => {
  setView(`<section class="view"><p class="lead">Gặp từ mới khi nghe, đọc hay trên lớp thì ghi vào đây. Trang tự kiểm tra từ đã có trong bảng TOCFL chưa. Từ có trong bảng thì thêm thẳng vào lịch học được.</p>
    <form class="panel" id="f" autocomplete="off"><label for="w">Từ mới (chữ Phồn thể)<input id="w" class="bigin han" placeholder="例如：機會" maxlength="16"></label>
      <div class="check" id="check">Gõ một từ để kiểm tra.</div>
      <div class="row2"><label for="where">Gặp ở đâu<input id="where" placeholder="Podcast, lớp học, phim…" maxlength="60"></label><label for="note">Ghi chú<input id="note" maxlength="200"></label></div>
      <div class="actions"><button class="primary" id="save" type="submit" disabled>Lưu từ</button><span class="msg" id="msg"></span></div></form>
    <h2 class="h2">Từ đã nhập</h2><div class="list" id="ilist"></div></section>`);
  const check = () => {
    const w = clean($("#w").value), box = $("#check"), btn = $("#save"); btn.disabled = true; box.className = "check";
    if (!w) { box.textContent = "Gõ một từ để kiểm tra."; return null; }
    if (!/^[㐀-鿿豈-﫿]+$/.test(w)) { box.className = "check warn"; box.textContent = "Chỉ nhập chữ Hán Phồn thể."; return null; }
    const n = S.noteByWord.get(w); const e = cedFirst(w); btn.disabled = false;
    if ([...S.inbox.values()].some((x) => x.w === w)) { box.className = "check warn"; box.textContent = "Bạn đã nhập từ này rồi."; btn.disabled = true; return null; }
    if (n) { box.className = "check have"; box.innerHTML = `<b class="han">${esc(w)}</b> có trong ${n.rich ? esc(n.deck.name) : "TOCFL " + esc(n.band)} · ${esc(itemOf(n).py)} · ${esc(meaningOf(n))}. Mức nhớ: ${levelPill(n)}`; return { w, n }; }
    box.className = "check new"; box.innerHTML = `<b class="han">${esc(w)}</b> không có trong bảng TOCFL${e ? ` · ${esc(e[0][0])} · ${esc(enOf(w))}` : ""}. Từ này được lưu để soạn thẻ sau.`;
    return { w, n: null };
  };
  $("#w").oninput = check;
  $("#f").onsubmit = async (ev) => { ev.preventDefault(); const r = check(); if (!r) return;
    const id = String(Date.now()); const rec = { w: r.w, where: $("#where").value.trim(), note: $("#note").value.trim(), date: dayKey(Date.now()), createdAt: Date.now(), status: r.n ? "Có trong TOCFL" : "Chờ làm thẻ" };
    if (r.n && r.n.basic) { S.settings.extra[r.n.w] = true; await saveSettings(); rec.status = "Đã thêm vào lịch học"; }
    S.inbox.set(id, rec); await Store.put("inbox", id, rec); $("#w").value = ""; $("#note").value = ""; $("#msg").textContent = `Đã lưu ${r.w}.`; check(); drawInbox(); };
  drawInbox();
};
function drawInbox() {
  const el = $("#ilist"); if (!el) return;
  const rows = [...S.inbox.entries()].sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  el.innerHTML = rows.map(([id, e]) => `<div class="item"><a class="w" href="#tu/${encodeURIComponent(e.w)}">${esc(e.w)}</a><div class="meta"><div class="vn">${esc(e.status)}</div>
    <div class="sub">${esc(e.date)}${e.where ? " · " + esc(e.where) : ""}${e.note ? " · " + esc(e.note) : ""}</div></div><div class="side"><button type="button" class="link" data-del="${esc(id)}">Xóa</button></div></div>`).join("")
    || `<div class="empty">Chưa có từ nào.</div>`;
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (b.dataset.sure) { S.inbox.delete(b.dataset.del); await Store.del("inbox", b.dataset.del); drawInbox(); } else { b.dataset.sure = "1"; b.textContent = "Bấm lần nữa để xóa"; } }));
}

// --- Cài đặt ---
VIEWS["cai-dat"] = () => {
  setView(`<section class="view"><div class="panel"><h2 class="h2">Học mỗi ngày</h2>
      <label for="npd">Số thẻ mới mỗi ngày<select id="npd">${[10, 15, 20, 30, 40, 60].map((v) => `<option>${v}</option>`).join("")}</select></label>
      <div class="sub">Mỗi từ có 3–4 thẻ. Ngày đầu chỉ gặp thẻ nhận diện, các thẻ còn lại mở từ hôm sau.</div>
      <div class="eyebrow">Thư mục đang học</div><div class="decks">
      ${S.decks.map((d) => `<label><input type="checkbox" data-deck="${esc(d.id)}" ${deckOn(d.id) ? "checked" : ""}> ${esc(d.name)}</label>`).join("")}
      ${S.bands.map((b) => `<label><input type="checkbox" data-band="${esc(b)}" ${S.settings.bands[b] ? "checked" : ""}> TOCFL ${esc(b)} (cả band)</label>`).join("")}</div></div>
    <div class="panel"><h2 class="h2">Giọng đọc</h2><div class="sub" id="vinfo"></div><div class="actions"><button type="button" class="speak" data-say="你好，我們開始學中文吧。">▶ Nghe thử</button></div></div>
    <div class="panel"><h2 class="h2">Sao lưu và khôi phục</h2>
      <p class="lead">Tiến độ chỉ lưu trong trình duyệt của máy này. Sao lưu thường xuyên và cất file vào Google Drive (thư mục “10 Website học tiếng Hoa”). Đổi máy thì bấm Khôi phục và chọn file đó.</p>
      <div class="actions"><button type="button" class="primary" id="backup">Sao lưu ra file</button>
        <label class="filebtn" for="restore">Khôi phục từ file<input type="file" id="restore" accept="application/json,.json"></label></div>
      <div class="row2"><label><span><input type="radio" name="rmode" value="merge" checked> Gộp: giữ kết quả mới hơn của từng thẻ</span></label><label><span><input type="radio" name="rmode" value="replace"> Thay toàn bộ bằng file</span></label></div>
      <div class="msg" id="bmsg"></div></div>
    <div class="panel"><h2 class="h2">Nguồn dữ liệu</h2><ul class="src">
      <li>Bảng từ TOCFL 2024 (華語八千詞表), Trung tâm SC-TOP · tocfl.edu.tw</li>
      <li>CC-CEDICT, giấy phép CC BY-SA 4.0 · mdbg.net</li>
      <li>Make Me a Hanzi (nét viết), giấy phép Arphic PL / LGPL · github.com/skishore/makemeahanzi</li>
      <li>Hanzi Writer (vẽ nét), giấy phép MIT</li>
      <li>Nghĩa tiếng Việt, mẹo nhớ, ví dụ: soạn riêng cho trang này</li></ul></div></section>`);
  $("#npd").value = String(S.settings.newPerDay || 20); $("#npd").onchange = async (e) => { S.settings.newPerDay = Number(e.target.value); await saveSettings(); };
  document.querySelectorAll("[data-deck]").forEach((c) => (c.onchange = async () => { S.settings.decks[c.dataset.deck] = c.checked; await saveSettings(); }));
  document.querySelectorAll("[data-band]").forEach((c) => (c.onchange = async () => { S.settings.bands[c.dataset.band] = c.checked; await saveSettings(); }));
  $("#vinfo").textContent = !("speechSynthesis" in window) ? "Trình duyệt này không đọc được thành tiếng." : voice ? `Đang dùng giọng ${voice.name} (${voice.lang}).` : "Chưa thấy giọng tiếng Hoa. Trên điện thoại, vào Cài đặt › Chuyển văn bản thành giọng nói và tải giọng 中文 (台灣).";
  $("#backup").onclick = async () => {
    const data = await Store.exportAll(); data.kv = Object.assign(data.kv || {}, { settings: S.settings });
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" }); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `so-hoc-tieng-hoa-sao-luu-${dayKey(Date.now())}.json`; document.body.appendChild(a); a.click(); a.remove();
    $("#bmsg").textContent = `Đã tạo file sao lưu (${fmt(Object.keys(data.srs).length)} thẻ có tiến độ). Cất file vào Google Drive.`;
  };
  $("#restore").onchange = async (e) => { const f = e.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await f.text()); const mode = document.querySelector("input[name=rmode]:checked").value; await Store.importAll(data, mode); await loadProgress();
      $("#bmsg").textContent = `Đã khôi phục ${fmt(Object.keys(data.srs || {}).length)} thẻ từ ${f.name}.`; }
    catch (err) { $("#bmsg").textContent = "Không khôi phục được: " + err.message; } };
};
async function saveSettings() { await Store.put("kv", "settings", JSON.parse(JSON.stringify(S.settings))); updateBadge(); }
async function loadProgress() {
  S.srs = await Store.all("srs"); S.stats = await Store.all("stats"); S.inbox = await Store.all("inbox");
  const kv = await Store.all("kv"); S.packs = kv.get("packs") || []; if (kv.get("settings")) S.settings = Object.assign({ newPerDay: 20, decks: {}, bands: {}, extra: {} }, kv.get("settings"));
}

// ---------------- boot ----------------
(async function boot() {
  try {
    $("#view").innerHTML = `<div class="note">Đang tải bảng từ…</div>`;
    const [t, decks] = await Promise.all([getJSON("data/tocfl.json"), getJSON("data/decks.json")]);
    S.bands = t.bands; S.tocfl = t.words; S.decks = decks;
    try { const vi = await getJSON("data/vi/index.json"); for (const f of vi.files || []) { const part = await getJSON("data/vi/" + f); for (const [w, v] of Object.entries(part)) S.vi.set(w, v); } } catch (e) { /* Vietnamese batches not added yet */ }
    buildNotes();
    $("#view").innerHTML = `<div class="note">Đang mở tiến độ học…</div>`;
    try { await loadProgress(); } catch (e) { S.storageError = true; }
    S.ready = true; route();
    if (S.storageError) $("#view").insertAdjacentHTML("afterbegin", `<div class="note">Trình duyệt chưa cho lưu tiến độ (có thể đang ở chế độ ẩn danh). Bạn vẫn học được, nhưng kết quả có thể không được giữ lại.</div>`);
    fetch("data/cedict.tsv").then((r) => r.text()).then((txt) => {
      const m = new Map(); for (const line of txt.split("\n")) { const [w, py, defs] = line.split("\t"); if (!w) continue; if (!m.has(w)) m.set(w, []); m.get(w).push([py, defs]); }
      S.ced = m; const h = location.hash; if (h.startsWith("#tu") || h.startsWith("#thu-muc") || h.startsWith("#nhap")) route();
    }).catch(() => {});
  } catch (e) { $("#view").innerHTML = `<div class="note">Không tải được dữ liệu: ${esc(e.message)}. Nếu mở bằng file trực tiếp trên máy, hãy dùng đường link GitHub Pages.</div>`; }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
