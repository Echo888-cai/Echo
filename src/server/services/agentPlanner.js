// EA-2 受控规划器：规则优先，覆盖一类现有管道接不住的真实复合问题——
// "两只标的对比"（如"英伟达和 AMD 谁赔率好"）。现有会话是单公司绑定，
// entityExtractor 的多标的抽取只在"持仓语境"（持有/仓位/分别…）下才触发，
// 纯比较句式（无持仓词）会被当成单公司问题，第二只标的直接被漏答。
//
// 红线：不做自主多跳 ReAct——这里只是"识别到确定的模式 → 拆出候选标的 → 逐个
// resolveCompany（EA-1 工具层）→ 命中两个不同标的才算数"，步数由候选数量天然
// 封顶（≤3 次 resolveCompany）。命中即复用已有 runChat 管道（company + compareWith），
// 对比表/估值条前端已支持，零新增前端代码；命中不了就返回 null，调用方原样落回
// 既有路由，不影响任何现有行为。
import { getTool } from "./agentTools.js";

const COMPARE_VERB = /谁(的)?(赔率|胜率|更值得|机会|更好|风险回报|更稳)|哪(个|家)更(好|值得|稳)|哪个更值得买|对比一下|比较一下|谁更好|谁更值得买|\bvs\.?\b|\bpk\b/i;
const LIST_SPLIT = /\s+vs\.?\s+|\s+pk\s+|[、，,&]|和|与|跟|以及|还有|及/i;
const TRAILING_NOISE = /(?:谁|哪个|哪家)?(?:的)?(?:赔率|胜率|机会|风险回报)?(?:更好|更高|更稳|更值得买|更值得|怎么样|好)?[?？!！。.\s]*$/;

export function comparisonCandidates(question = "") {
  return String(question || "")
    .split(LIST_SPLIT)
    .map((s) => s.replace(COMPARE_VERB, "").replace(TRAILING_NOISE, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 12);
}

/** 纯文本判定：句子里是否含比较句式词汇（"谁更好""对比一下"…）。无网络，可单测。 */
export function looksLikeCompareQuestion(question = "") {
  return COMPARE_VERB.test(String(question || "")) && comparisonCandidates(question).length >= 1;
}

/**
 * 尝试把比较句式拆成 { primary, secondary } 两个已解析公司 + 可回显的执行步骤。
 * - 已有 primaryCompany（会话/前端已解析）时，只需再解析出 1 个不同标的当 secondary
 *   （用户只说了新提到的那只，如"阿里巴巴谁更好"）。
 * - 没有时，需要从候选片段里解析出 2 个不同标的，第一个当 primary。
 * 命中不了所需数量的不同标的就返回 null（调用方据此落回既有单公司/发现层路由）。
 */
export async function planCompare(question, { primaryCompany = null } = {}) {
  const text = String(question || "");
  if (!COMPARE_VERB.test(text)) return null;
  const segments = comparisonCandidates(text).slice(0, 3);
  const need = primaryCompany ? 1 : 2;
  if (segments.length < need) return null;
  const resolveCompany = getTool("resolveCompany");
  const seen = new Set(primaryCompany?.ticker ? [String(primaryCompany.ticker).toUpperCase()] : []);
  const found = [];
  const steps = [];
  for (const seg of segments) {
    if (found.length >= need) break;
    const result = await resolveCompany.run({ query: seg });
    steps.push({ tool: "resolveCompany", args: { query: seg }, status: result.status });
    if (result.status !== "ok") continue;
    const ticker = String(result.data.ticker).toUpperCase();
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    found.push(result.data);
  }
  const primary = primaryCompany || found[0];
  const secondary = primaryCompany ? found[0] : found[1];
  if (!primary?.ticker || !secondary?.ticker || primary.ticker === secondary.ticker) return null;
  steps.push({ tool: "compareCompanies", args: { ticker: secondary.ticker } });
  return { primary, secondary, plan: steps };
}
