// 对话内对比块：把"对比对象"本轮已核到的真实数据拼进提示词。
//
// 背景：`compareWith` 在契约里、前端在发、UI 明确承诺"拉两家真实数据并排比，不跳走"，
// 而 research.ts 里 `compare: null` 写死——buildCompareBlock() 和整段对比作答规则
// 全是死代码，静默了数月（2026-07-17 智能分析测评抓到，属 PLAN §7「冻结表模式」
// 在请求字段上的翻版）。接回之后必须有确定性测试盯着，否则下次它照样能无声地断掉。
//
// 为什么在这里测而不是靠 live 探针：对比块拼得对不对是**纯函数**的性质，
// 该由确定性测试断言。live 探针只负责一件确定性的事——链路断掉时模型必然说
// "对比对象未核到"，那句话消失即链路接通。拿模型散文去验字段拼装会抖
// （实测把"现价必须出现在正文里"当断言，3 次里挂 1 次），抖的门禁等于没有门禁。
import { createAnswerComposer, classifyResearchIntent, RESEARCH_INTENTS } from "../src/index.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const composer = createAnswerComposer({
  researchStatusLabels: { watch: "持续观察" },
  companies: [],
  companyByTicker: () => null,
  classifyResearchIntent,
  researchIntents: RESEARCH_INTENTS,
  webEvidenceToPrompt: () => "无",
  financialsToMarkdown: (f) => `收入：${f?.revenue ?? "未核到"}`,
  buybacksToPrompt: () => "无",
  documentsToPrompt: () => "",
  beijingMinute: () => "2026-07-17 19:00"
});

const panel = {
  ticker: "0700.HK", companyName: "腾讯控股", researchStatus: "watch",
  keyDrivers: [], missingData: [], price: {}, dataCompleteness: 60
};
const build = (context) => composer.buildChatPrompt("把腾讯和阿里做个对比", panel, {}, {
  marketSnapshot: {}, financialsData: {}, ...context
});

console.log("[1] compare 为 null（链路断）：提示词里没有对比块，也不会走对比作答规则");
{
  const prompt = build({ compare: null });
  check("无对比对象块", !prompt.includes("对比对象"));
  check("不启用对比任务规则", !prompt.includes("本轮是【对比任务】"));
}

console.log("[2] compare 已接通：真实数据进提示词");
{
  const compare = {
    name: "阿里巴巴", ticker: "9988.HK",
    marketSnapshot: { providerStatus: "ok", price: 118.5, currency: "HKD", changePercent: -1.23 },
    financialsData: { providerStatus: "ok", revenue: 2365 },
    valuation: null, analyst: null, newsSnapshot: null
  };
  const prompt = build({ compare });
  check("出现对比对象块", prompt.includes("【对比对象：阿里巴巴（9988.HK）"));
  check("带上对比对象现价", prompt.includes("118.5"));
  check("带上对比对象币种", prompt.includes("HKD"));
  check("带上对比对象涨跌", prompt.includes("-1.23"));
  check("带上对比对象财报口径", prompt.includes("2365"));
  check("启用对比任务作答规则", prompt.includes("本轮是【对比任务】"));
  check("要求两家都讲", prompt.includes("每个维度都要两家都讲"));
  check("对比任务禁买卖建议", prompt.includes("禁止买卖建议"));
}

console.log("[3] compare 取数失败：诚实写未核到，不编，也不让整轮崩");
{
  const compare = {
    name: "阿里巴巴", ticker: "9988.HK",
    marketSnapshot: { providerStatus: "missing" },
    financialsData: { providerStatus: "missing" },
    valuation: null, analyst: null, newsSnapshot: null
  };
  const prompt = build({ compare });
  check("仍出现对比对象块", prompt.includes("【对比对象：阿里巴巴（9988.HK）"));
  check("现价诚实标未核到", /现价：未核到/.test(prompt));
  check("财报诚实标未核到", /完整三表未核到/.test(prompt));
  check("一致预期诚实留空（无授权源）", prompt.includes("暂无一致预期"));
}

console.log("[4] 对比与多标的互斥：有 compare 时不走组合任务模板");
{
  const compare = {
    name: "阿里巴巴", ticker: "9988.HK",
    marketSnapshot: { providerStatus: "ok", price: 118.5, currency: "HKD" },
    financialsData: { providerStatus: "missing" }, valuation: null, analyst: null, newsSnapshot: null
  };
  const prompt = build({ compare, otherHoldings: [{ company: { ticker: "AAPL" }, summary: {} }] });
  check("对比优先于多标的模板", prompt.includes("本轮是【对比任务】") && !prompt.includes("这是【多标的/组合任务】"));
}

console.log(`\nCompare block: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
