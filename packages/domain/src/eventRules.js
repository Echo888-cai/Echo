const LEGAL_AD_PATTERNS = [
  "shareholder alert", "investor alert", "investor deadline", "deadline alert",
  "class action", "securities fraud", "law firm", "law offices",
  "bernstein liebhard", "rosen law", "schall law", "pomerantz", "bragar eagel",
  "kessler topaz", "robbins geller", "investors who lost", "lost money",
  "投资者索赔", "集体诉讼", "律师事务所"
];

const HIGH_IMPACT_PATTERNS = [
  "bankruptcy", "chapter 11", "sec probe", "sec investigation", "delisting",
  "recall", "lawsuit", "sued", "fraud", "ceo resign", "ceo steps down",
  "ceo departure", "acquisition", "merger", "buyout", "takeover", "guidance cut",
  "profit warning", "default", "restate", "data breach",
  "破产", "退市", "立案调查", "处罚", "召回", "起诉", "造假", "辞任", "收购", "重组", "下调指引", "业绩预警", "停牌"
];

const MEDIUM_IMPACT_PATTERNS = [
  "earnings", "quarterly results", "guidance", "outlook", "dividend", "buyback",
  "share repurchase", "upgrade", "downgrade", "price target", "raises stake",
  "cuts stake", "stake in", "guidance raise", "beats estimates", "misses estimates",
  "财报", "业绩", "营收", "净利", "毛利", "指引", "分红", "派息", "回购", "评级",
  "目标价", "增持", "减持", "中标", "募资", "定增", "扩产", "一致预期"
];

const AMOUNT_TOKEN_RE = /([\d]+(?:\.\d+)?)\s*(亿|万)\s*(港元|美元|元)/g;
const SHARE_TOKEN_RE = /([\d]+(?:\.\d+)?)\s*万\s*股/g;
const AMOUNT_MATCH_TOLERANCE = 0.02;

function matchesAny(text, patterns) {
  const normalized = String(text || "").toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function tickerSymbol(ticker) {
  return String(ticker || "").toLowerCase().replace(/\.(?:hk|ss|sz|us)$/i, "");
}

function isUsTicker(ticker) {
  return !/\.(?:hk|ss|sz)$/i.test(String(ticker || ""));
}

export function newsMentionsCompany(article = {}, company = {}) {
  const raw = `${article.title || ""} ${article.description || ""}`;
  const text = raw.toLowerCase();
  const ticker = String(company.ticker || "");
  const symbol = tickerSymbol(ticker);
  if (isUsTicker(ticker)) {
    if (symbol && new RegExp(`\\b${symbol.replace(/[^a-z0-9]/g, "")}\\b`, "i").test(text)) return true;
  } else if (symbol && text.includes(symbol)) {
    return true;
  }
  const name = String(company.nameZh || "");
  const core = name.replace(/[-—]?[Ww]$/, "").replace(/股份|控股|集团|有限公司|公司/g, "").trim();
  if (core.length >= 2 && raw.includes(core)) return true;
  return name.length >= 2 && raw.includes(name);
}

export function classifyNewsSeverity(article = {}) {
  const text = `${article.title || ""} ${article.description || ""}`;
  if (matchesAny(text, LEGAL_AD_PATTERNS)) return "drop";
  if (matchesAny(text, HIGH_IMPACT_PATTERNS)) return "high";
  if (matchesAny(text, MEDIUM_IMPACT_PATTERNS)) return "medium";
  return "low";
}

function extractNumberTokens(title) {
  const text = String(title || "");
  const tokens = [];
  let match;
  AMOUNT_TOKEN_RE.lastIndex = 0;
  while ((match = AMOUNT_TOKEN_RE.exec(text))) {
    tokens.push(Number.parseFloat(match[1]) * (match[2] === "亿" ? 1e8 : 1e4));
  }
  SHARE_TOKEN_RE.lastIndex = 0;
  while ((match = SHARE_TOKEN_RE.exec(text))) tokens.push(Number.parseFloat(match[1]) * 1e4);
  return tokens.filter((value) => Number.isFinite(value) && value > 0);
}

function shareNumberToken(left, right) {
  return left.some((a) => right.some((b) => Math.abs(a - b) / Math.max(a, b) <= AMOUNT_MATCH_TOLERANCE));
}

/**
 * Only merge same-day news when both headlines share a concrete amount/share
 * count. Percent-only market flashes are deliberately never similarity-merged.
 */
export function dedupeSimilarNews(events = []) {
  const passthrough = [];
  const byDay = new Map();
  for (const event of events) {
    if (event.kind !== "news") {
      passthrough.push(event);
      continue;
    }
    const key = `${event.ticker}|${String(event.date || "").slice(0, 10)}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }

  const output = [...passthrough];
  for (const dayEvents of byDay.values()) {
    const clusters = [];
    for (const event of dayEvents) {
      const tokens = extractNumberTokens(event.title);
      const cluster = tokens.length
        ? clusters.find((candidate) => candidate.tokens.length && shareNumberToken(tokens, candidate.tokens))
        : null;
      if (cluster) {
        cluster.members.push(event);
        cluster.tokens.push(...tokens);
      } else {
        clusters.push({ tokens, members: [event] });
      }
    }
    for (const cluster of clusters) {
      const representative = cluster.members.reduce((longest, member) =>
        String(member.title || "").length > String(longest.title || "").length ? member : longest
      );
      output.push(cluster.members.length > 1
        ? { ...representative, relatedCount: cluster.members.length }
        : representative);
    }
  }
  return output;
}
