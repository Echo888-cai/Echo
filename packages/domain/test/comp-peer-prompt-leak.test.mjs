// 同业倍数的离群防线必须在**离开领域层的每一个出口**上都成立——尤其是提示词。
//
// 事故回放（2026-07-17 智能分析测评实测）：compPeerRules 的 PE 100x 可比上限**算对了**
// （BIDU 647.5x 被判 matched:false、不进锚点），但 compPeersPromptLine 当时 map 的是
// 整个 peers 数组，把 "BIDU PE 647.5x" 原样打进提示词，紧接着又告诉模型"只能引用这里
// 列出的公司和倍数"——等于授权它引用。真实回答里于是出现了「同业对照中，百度PE 647.5x」。
// 防线在锚点上生效、在用户真正读到的散文里没有：数字换了条路照样到达用户。
//
// 修复时还差点做半套：把离群 peer 从清单里拿掉、却把 annotatePeer 的 reason 原样打印，
// 而 reason 本身就长这样——"PE 647.5x 超出可比上限 100x（…）"。数字还在，只是换了位置。
// 本仓库的教训是：**给了模型数字，它就会引用**，靠嘱咐去对冲一个已递到手里的数字，
// 是把防线建在模型的服从性上。
//
// 所以这份测试断言的是一条硬性质：**被排除 peer 的倍数值，一个字符都不许出现在提示词里。**
import { buildCompPeers, createAnswerComposer, classifyResearchIntent, RESEARCH_INTENTS } from "../src/index.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function promptFor(compPeers) {
  const composer = createAnswerComposer({
    researchStatusLabels: { watch: "持续观察" },
    companies: [],
    companyByTicker: () => null,
    classifyResearchIntent,
    researchIntents: RESEARCH_INTENTS,
    webEvidenceToPrompt: () => "无",
    financialsToMarkdown: () => "无",
    buybacksToPrompt: () => "无",
    documentsToPrompt: () => "",
    beijingMinute: () => "2026-07-17 19:00"
  });
  const panel = {
    ticker: "0700.HK", companyName: "腾讯控股", researchStatus: "watch",
    keyDrivers: [], missingData: [], price: {}, dataCompleteness: 60
  };
  return composer.buildChatPrompt("腾讯贵不贵", panel, {}, {
    valuation: { compPeers }, marketSnapshot: {}, financialsData: {}
  });
}

// 真实事故数据：BIDU TTM 盈利几乎归零 → Finnhub 仍吐出 peTTM 647.5
const subject = { providerStatus: "ok", eps: 24.98, netMargin: 30.4, revenueGrowth: -1.06 };

console.log("[1] 离群 peer：不进锚点，也不进提示词");
{
  const cp = buildCompPeers(subject, [
    { ticker: "BIDU", pe: 647.5, epsTtm: 0.1, netMargin: 0.4, revenueGrowth: 1 },
    { ticker: "BILI", pe: 35.9, epsTtm: 2.1, netMargin: 5, revenueGrowth: 8 }
  ]);
  check("BIDU 被判不可比", cp.peers.find((p) => p.ticker === "BIDU")?.matched === false);
  const prompt = promptFor(cp);
  check("提示词不含 647.5", !prompt.includes("647.5"), prompt.slice(prompt.indexOf("同业"), prompt.indexOf("同业") + 200));
  check("提示词不含 647", !/647/.test(prompt));
  check("提示词仍保留可比的 BILI 35.9x", prompt.includes("BILI") && prompt.includes("35.9"));
  check("提示词说明有同业被剔除", /未计入|被排除|剔除/.test(prompt));
}

console.log("[2] 全部 peer 都离群：不能只字不提，但也不能泄漏数字");
{
  const cp = buildCompPeers(subject, [
    { ticker: "BIDU", pe: 647.5, epsTtm: 0.1, netMargin: 0.4, revenueGrowth: 1 },
    { ticker: "IONQ", pe: 512.3, epsTtm: 0.05, netMargin: 0.2, revenueGrowth: 2 }
  ]);
  const prompt = promptFor(cp);
  check("提示词不含 647.5", !prompt.includes("647.5"));
  check("提示词不含 512.3", !prompt.includes("512.3"));
  check("明确告知本轮无可引用同业倍数", /没有.{0,6}可引用的同业倍数|不可比/.test(prompt));
  check("仍然禁止模型自行编造倍数", /不能给任何具体公司的具体倍数|绝对不能/.test(prompt));
}

console.log("[3] 阶段不同的 peer 同样不泄漏其倍数");
{
  // 亏损股：PE 桶与盈利主体不同桶，annotatePeer 判 matched:false 且 reason 带"阶段不同"
  const cp = buildCompPeers(subject, [
    { ticker: "SNAP", pe: null, evRevenue: 4.2, epsTtm: -0.5, netMargin: -12, revenueGrowth: 15 },
    { ticker: "BILI", pe: 35.9, epsTtm: 2.1, netMargin: 5, revenueGrowth: 8 }
  ]);
  const prompt = promptFor(cp);
  check("提示词不含亏损 peer 的 EV/Sales 4.2", !/SNAP[^。；]{0,20}4\.2/.test(prompt));
}

console.log(`\nComp peer prompt leak: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
