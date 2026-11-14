// Spaced repetition: FSRS (via ts-fsrs) with SM-2 fallback. No network, no AI.
const MIN = 60000, DAY = 86400000;
const STEPS = [1 * MIN, 10 * MIN];   // learning steps for new cards
const RELEARN = [10 * MIN];          // after forgetting a review card
const DAY_START_HOUR = 4;            // a study day starts at 4:00
let _fsrsInstance = null;
function getFSRS() {
  if (_fsrsInstance) return _fsrsInstance;
  if (typeof FSRS !== "undefined" && typeof FSRS.fsrs === "function") {
    _fsrsInstance = FSRS.fsrs({ request_retention: 0.9, enable_fuzz: true });
  }
  return _fsrsInstance;
}

function dayStart(t) {
  const d = new Date(t);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d.getTime();
}
function dayKey(t) {
  const d = new Date(dayStart(t));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function freshState() { return { state: "new", ease: 2.5, ivl: 0, step: 0, reps: 0, lapses: 0, due: 0, last: 0 }; }

// grade: 1 = Quên, 2 = Khó, 3 = Nhớ, 4 = Dễ
function schedule(prev, grade, now) {
  const f = getFSRS();
  if (f && typeof FSRS !== "undefined") {
    const nowDate = new Date(now);
    let card;
    if (prev && prev.fsrs) {
      const pr = prev.fsrs;
      card = {
        due: new Date(pr.due || now),
        stability: pr.stability || 0,
        difficulty: pr.difficulty || 0,
        elapsed_days: pr.elapsed_days || 0,
        scheduled_days: pr.scheduled_days || 0,
        reps: pr.reps || 0,
        lapses: pr.lapses || 0,
        state: pr.state || 0,
        learning_steps: pr.learning_steps || 0,
        last_review: pr.last_review ? new Date(pr.last_review) : undefined
      };
    } else if (prev && prev.state === "review" && prev.ivl > 0) {
      card = {
        due: new Date(prev.due || now),
        stability: Math.max(1, prev.ivl),
        difficulty: 5,
        elapsed_days: prev.ivl,
        scheduled_days: prev.ivl,
        reps: prev.reps || 1,
        lapses: prev.lapses || 0,
        state: 2,
        learning_steps: 0,
        last_review: new Date(prev.last || (now - prev.ivl * DAY))
      };
    } else {
      card = FSRS.createEmptyCard(nowDate);
    }
    const res = f.next(card, nowDate, grade);
    const c = res.card;
    const stateMap = ["new", "learn", "review", "relearn"];
    const stName = stateMap[c.state] || "learn";
    const dueMs = c.due instanceof Date ? c.due.getTime() : Number(c.due);
    return Object.assign(freshState(), prev || {}, {
      state: stName,
      ivl: c.scheduled_days || 0,
      step: c.learning_steps || 0,
      reps: c.reps || 0,
      lapses: c.lapses || 0,
      due: stName === "review" ? dayStart(dueMs) : dueMs,
      last: now,
      fsrs: {
        due: dueMs,
        stability: c.stability,
        difficulty: c.difficulty,
        elapsed_days: c.elapsed_days,
        scheduled_days: c.scheduled_days,
        reps: c.reps,
        lapses: c.lapses,
        state: c.state,
        learning_steps: c.learning_steps || 0,
        last_review: now
      }
    });
  }
  const s = Object.assign(freshState(), prev || {});
  const wasNew = s.state === "new";
  s.reps += 1; s.last = now;
  const graduate = (ivl) => { s.state = "review"; s.ivl = ivl; s.step = 0; s.due = dayStart(now) + ivl * DAY; };
  if (s.state === "new" || s.state === "learn") {
    if (grade === 1) { s.state = "learn"; s.step = 0; s.due = now + STEPS[0]; }
    else if (grade === 2) { s.state = "learn"; s.due = now + (s.step === 0 ? (STEPS[0] + STEPS[1]) / 2 : STEPS[s.step]); }
    else if (grade === 3) {
      const next = wasNew ? 1 : s.step + 1;
      if (next < STEPS.length) { s.state = "learn"; s.step = next; s.due = now + STEPS[next]; }
      else graduate(1);
    } else graduate(4);
  } else if (s.state === "relearn") {
    if (grade <= 2) s.due = now + RELEARN[0];
    else graduate(Math.max(1, s.ivl) + (grade === 4 ? 1 : 0));
  } else {
    if (grade === 1) {
      s.lapses += 1; s.ease = Math.max(1.3, s.ease - 0.2);
      s.ivl = Math.max(1, Math.round(s.ivl * 0.5)); s.state = "relearn"; s.step = 0; s.due = now + RELEARN[0];
    } else if (grade === 2) { s.ease = Math.max(1.3, s.ease - 0.15); graduate(Math.max(s.ivl + 1, Math.round(s.ivl * 1.2))); }
    else if (grade === 3) graduate(Math.max(s.ivl + 1, Math.round(s.ivl * s.ease)));
    else { const iv = Math.max(s.ivl + 1, Math.round(s.ivl * s.ease * 1.3)); s.ease += 0.15; graduate(iv); }
  }
  return s;
}
// Six-level answer for ONE card. The level you press is how well you remembered this time;
// the interval grows from the card's history and never goes past that level's range,
// so a word reaches "Thông thạo" only after several good reviews.
// 0 reset · 1 Mới học (quên) · 2 Nhớ tạm · 3 Nhớ lâu · 4 Thuộc lòng · 5 Thông thạo
const LEVEL_MAX = [0, 0, 6, 20, 89, 365];
const FIRST_IVL = [0, 0, 1, 3, 4, 7];
function scheduleLevel(prev, level, now) {
  if (level === 0) return freshState();
  const s = Object.assign(freshState(), prev || {});
  const isReview = s.state === "review";
  s.reps += 1; s.last = now; s.step = 0;
  if (level === 1) {
    if (isReview) { s.lapses += 1; s.ease = Math.max(1.3, s.ease - 0.2); s.ivl = Math.max(1, Math.round(s.ivl * 0.25)); s.state = "relearn"; s.due = now + RELEARN[0]; }
    else { s.state = "learn"; s.due = now + STEPS[0]; }
    return s;
  }
  let ivl;
  if (s.state === "relearn" && s.ivl) ivl = level === 2 ? 1 : s.ivl; // just forgot: restart from the shortened interval
  else if (!isReview || !s.ivl) ivl = FIRST_IVL[level];
  else if (level === 2) { s.ease = Math.max(1.3, s.ease - 0.15); ivl = Math.max(s.ivl + 1, Math.round(s.ivl * 1.2)); }
  else if (level === 3) ivl = Math.max(s.ivl + 1, Math.round(s.ivl * s.ease));
  else { ivl = Math.max(s.ivl + 1, Math.round(s.ivl * s.ease * (level === 4 ? 1.3 : 1.6))); s.ease = Math.min(3.5, s.ease + 0.1); }
  ivl = Math.min(ivl, LEVEL_MAX[level]);
  s.state = "review"; s.ivl = ivl; s.due = dayStart(now) + ivl * DAY;
  return s;
}
function fmtGap(ms) {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} phút`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} giờ`;
  const d = Math.round(ms / DAY);
  if (d < 30) return `${d} ngày`;
  if (d < 365) return `${Math.round(d / 30)} tháng`;
  return `${(d / 365).toFixed(1)} năm`;
}
// 0 Chưa học · 1 Mới học · 2 Nhớ tạm · 3 Nhớ lâu · 4 Thuộc lòng · 5 Thông thạo
const LEVELS = ["Chưa học", "Mới học", "Nhớ tạm", "Nhớ lâu", "Thuộc lòng", "Thông thạo"];
const LEVEL_HINT = ["chưa học lần nào", "đang ở bước học hoặc vừa quên", "ôn cách dưới 7 ngày", "ôn cách 7–20 ngày", "ôn cách 21–89 ngày", "ôn cách từ 90 ngày"];
function cardLevel(s) {
  if (!s || s.state === "new") return 0;
  if (s.state === "learn" || s.state === "relearn") return 1;
  return s.ivl < 7 ? 2 : s.ivl < 21 ? 3 : s.ivl < 90 ? 4 : 5;
}
