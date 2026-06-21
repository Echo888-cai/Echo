/**
 * 时间锚点工具 —— 让研究链路有明确的时间感。
 *
 * 对标顶级投研 AI 的"时间先对齐，再做判断"纪律：
 * - 涉及"今天/最新/盘前"等相对时间时，先对齐北京时间
 * - 搜索前把模糊时间词改写成绝对日期（"今天非农" → "2026-04-04 非农"）
 */

const RELATIVE_TIME_RE = /今天|今日|昨天|昨日|今晚|刚刚|最新|最近|近期|本周|这周|本月|当前|目前|现在|盘前|盘后|today|tonight|latest|recent|this week|this month|premarket|after[- ]?hours/i;

/** 当前北京日期，格式 YYYY-MM-DD。 */
export function beijingDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** 当前北京时间，精确到分，格式 YYYY-MM-DD HH:MM。 */
export function beijingMinute(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

/** 当前北京年份（数字），用于把搜索关键词锚到当年。 */
export function beijingYear(date = new Date()) {
  return Number(beijingDate(date).slice(0, 4));
}

/** 问题里是否含相对时间词，需要先对齐时间再判断/搜索。 */
export function hasRelativeTime(question = "") {
  return RELATIVE_TIME_RE.test(String(question || ""));
}

/**
 * 查询改写：含相对时间词时，把绝对日期前缀进查询，避免"今天怎么样"原样搜。
 * 例如 "AAPL latest news" → "2026-04-04 AAPL latest news"。
 */
export function anchorQueryToDate(query = "", question = "", date = new Date()) {
  const q = String(query || "").trim();
  if (!q || !hasRelativeTime(question)) return q;
  const day = beijingDate(date);
  // 已含完整日期就不重复加。
  if (q.includes(day)) return q;
  return `${day} ${q}`;
}
