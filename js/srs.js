// Spaced repetition (SM-2 style, close to Anki defaults). No network, no AI.
const MIN = 60000, DAY = 86400000;
const STEPS = [1 * MIN, 10 * MIN];   // learning steps for new cards
const RELEARN = [10 * MIN];          // after forgetting a review card
const DAY_START_HOUR = 4;            // a study day starts at 4:00

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
