/**
 * 冻结表门禁 —— 拦住本仓库反复出现、且**不会以任何形式报错**的一类缺陷：
 * repository 写好了、schema 建好了、upsert 写好了、领域逻辑也写好了，就是没人调。
 * 表永远是空的，端点永远返回空，巡检永远遍历零条规则，而 CI 全绿、日志干净。
 *
 * 真实案例（每一个都是事后靠人肉扫描才发现的，各静默了数周到数月）：
 * - earnings_calendar（#28）：`upsertEarningsCalendar` 无调用方，表里是某次临时脚本
 *   写入的冻结脏数据，永不刷新。
 * - comp_peers（#31）：同款，冻结在 2026-07-10。
 * - research_snapshots / watch_rules / company_profiles.falsifiers（#32）：#27 终局迁移
 *   重建底盘时把 `persistResearch` 的副作用**连同覆盖它们的测试一起删了**——测试没了，
 *   所以两个月无人报警；`research.scorecard` 一直在对着零条快照算命中率。
 * - hk_buybacks（#32）：**反向**——写入方一直在采（腾讯 29 条真实记录），但没有任何
 *   读取方，数据白采半年，而提示词还在说"回购口径还没核到"。
 *
 * 两个方向都要拦：
 * - 写入函数零调用 → 表永远不会被写，任何读取方都在读空表/陈旧脏数据。
 * - 读取函数零调用 → 采集管道白跑，或者某个功能被悄悄摘掉了。
 *
 * 白名单不是"关掉检查"，是"记账"：每条必须写明为什么允许、解除条件是什么。
 * 白名单本身也会腐烂，所以条目一旦重新有了调用方，这里会**报错要求删除该条目**——
 * 否则下次真的退化时它会替真问题挡枪。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const REPO_DIR = "packages/db/src/repositories/";
// 本文件必须把自己排除在扫描之外，否则 ALLOWED 里那些形如
// "authRepository.ts::listInvites" 的 key 会让每个被记账的函数都显得"有人用"，
// 全体误报成"白名单已过期"。本地一度是绿的，只因为脚本当时还没被 git 跟踪——
// 一提交进 CI 就全红。它是描述 repository 的元文件，不是消费方。
const SELF = "scripts/quality/check-frozen-tables.mjs";

/**
 * 已知且**已记账**的例外。key 是 `文件名::导出函数名`，value 必须说明解除条件。
 * 加条目前先问一句：这真的是"等外部依赖"，还是"我刚把它接漏了"？
 */
const ALLOWED = {
  // docs/PLAN.md P1/P2：三张表都缺真实数据源，不是缺接线。硬接=编数据，撞红线。
  "historicalValuationRepository.ts::upsertHistoricalValuationSeries":
    "等真实历史 PE 序列源（market_snapshots 自建只有 7 天深、每天 +1 行，等不出五年分位）",
  "historicalValuationRepository.ts::getHistoricalValuationRow":
    "同上——写入方到位后本函数会被 answerComposer 的历史分位块消费",
  "insiderActivityRepository.ts::upsertInsiderActivity":
    "等内部人交易数据源（尚无任何已授权适配器）",
  "insiderActivityRepository.ts::getInsiderActivityRow":
    "同上",
  "webEvidenceRepository.ts::saveWebEvidence":
    "等网页证据源（Tavily 键已超配额，docs/PLAN.md P1 '暂停'记录）",
  "webEvidenceRepository.ts::listWebEvidence":
    "同上——composerContext.webEvidence 目前诚实传 null",

  // 供未来消费方使用的读取接口，写入方已真实接通，非冻结。
  "hkBuybackRepository.ts::getLatestHkBuybackFetchedAt":
    "回购新鲜度查询，留给 status 页真探测接入（#32 已接通写入与研究链路消费）",

  // ── 以下为 2026-07-15 门禁上线时的存量，逐个人工核实过零调用。都不是"接漏了"，
  //    而是功能未建/已被更好的实现取代。一次性删除属策略里的"大规模代码删除"，
  //    需单独 PR 并先问过用户，故此处先记账。
  "financialsRepository.ts::createFinancialsRepository":
    "存量死代码：工厂函数已被模块级导出取代，无任何调用方。待清理 PR 删除",
  "companyProfilesRepository.ts::listProfileEvents":
    "存量冗余：getCompanyProfile() 的 hydrate 已内联返回 events，本函数无人再用。待清理 PR 删除",
  "canaryRepository.ts::getLatestBatchResults":
    "存量：status 页改用 getSourceHealthSummary() 后本函数无人调用。待清理 PR 删除",
  "companyRepository.ts::getAllCompanies":
    "刻意不用：answerComposition.ts 的 companies 端口传空数组——每次提问加载 ~650 家公司按行业字符串猜同业既浪费又误导（同行业≠同可比）。同业改由 compPeers 真实接通",
  "companyRepository.ts::getCompaniesBySector":
    "同上——同行业不等于同可比，不做基于 sector 的同业猜测",
  "factGuardRepository.ts::getRecentHardFails":
    "等设置页 FactGuardCard 接入真实流量后消费（docs/PLAN.md P2）",
  "llmAuditRepository.ts::getRecentLlmAudits":
    "等设置页 LLM 用量/成本卡（docs/PLAN.md P4 商业化需要成本可见）",
  "feedbackRepository.ts::listFeedback":
    "等反馈队列管理界面（docs/PLAN.md P3 '反馈闭环进可追踪队列'）",
  "authRepository.ts::listInvites":
    "等 owner 的邀请码管理界面（当前只有生成，没有列表）",
  "authRepository.ts::deleteSessionsForUser":
    "等'登出所有设备'功能（安全能力，P4 发布准备）",
  "portfolioRepository.ts::getPosition":
    "单条持仓查询；当前所有消费方走 listPositions()。待清理 PR 删除",
  "documentRepository.ts::getDocument":
    "文档详情，等前端文档管理页（docs/PLAN.md P3）",
  "documentRepository.ts::getDocumentsCount":
    "同上",
  "documentRepository.ts::deleteDocument":
    "文档删除闭环，等前端文档管理页（docs/PLAN.md P3）",
};

const WRITE_RE = /^(?:upsert|insert|save|replace|record|write|create|delete|update|add|mark|bump|destroy)/i;

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

/** repository 文件里所有导出的函数名。 */
function exportedFunctions(file) {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
}

/**
 * 判定"有人用"时，注释与 import 都必须剔除，只认真正的调用点。
 *
 * 两个都是本门禁自己踩出来的真实漏洞（回放 #27 事故——删掉写入方调用但 import 还在
 * ——门禁两次都是绿的）：
 * - **残留的未使用 import** 让函数名照样出现。lint 通常会清掉，但门禁不能把自己的
 *   正确性寄托在另一条规则上。
 * - **注释里的提及**同样算数：本文件顶部记录事故案例时写了那几个函数名，而 scripts/
 *   也在扫描范围内，于是这份文档把它要抓的函数"救活"了。
 */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import\s[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*import\s*\(?\s*["'][^"']+["']\s*\)?;?\s*$/gm, "");
}

const files = trackedFiles();
const repositoryFiles = files.filter((f) => f.startsWith(REPO_DIR) && f.endsWith("Repository.ts"));
// 生产调用点：排除 repository 自身、测试、barrel re-export。
// 测试必须排除——测试调用证明不了生产在用，而 #27 删掉写入方时把旧测试一起删了，
// 正是这个盲区让三条链路静默了两个月。barrel 的 re-export 同理不算"有人用"。
const productionFiles = files.filter((f) =>
  /\.(?:[cm]?js|jsx|ts|tsx)$/.test(f) &&
  f !== SELF &&
  !f.startsWith(REPO_DIR) &&
  !/\.test\.|\/test\/|\/tests\/|__tests__/.test(f) &&
  !/\/index\.(?:ts|js)$/.test(f) &&
  (f.startsWith("apps/") || f.startsWith("packages/") || f.startsWith("scripts/"))
);
// 逐文件剔除后再拼接：先 join 再剔会让某个文件里的 `/*`（例如正则字面量 `/\/\*/`）
// 一路吃到另一个文件的 `*/`，把中间的真实代码整段吞掉——实测会把 insertSession 这类
// 明显在用的函数误报成冻结。
const productionHaystack = productionFiles.map((f) => stripNonCode(readFileSync(f, "utf8"))).join("\n");
const sourceOf = new Map(repositoryFiles.map((f) => [f, stripNonCode(readFileSync(f, "utf8"))]));
const exportsOf = new Map(repositoryFiles.map((f) => [f, exportedFunctions(f)]));

/**
 * repository 之间的互调**只在被调方所在文件本身能被生产代码触达时**才算"有人用"。
 * 直接把整个 repository 目录当调用方是错的：一簇互相调用、但生产一个都没接的
 * repository 会集体显得健在，正好放过本门禁要抓的那种病。所以按文件级可达性求不动点
 * ——真实用例：`notificationEnabled` 的唯一调用方是同目录的 `insertNotification`
 * （偏好检查刻意收敛到那一个咽喉，避免 5 个调用方各自遗漏），而 `insertNotification`
 * 确实被 worker/api 调用，因此这条互调成立。
 */
const reachable = new Set(
  repositoryFiles.filter((f) => exportsOf.get(f).some((fn) => new RegExp(`\\b${fn}\\b`).test(productionHaystack)))
);
for (let changed = true; changed; ) {
  changed = false;
  for (const file of repositoryFiles) {
    if (reachable.has(file)) continue;
    const reachableSource = [...reachable].map((f) => sourceOf.get(f)).join("\n");
    if (exportsOf.get(file).some((fn) => new RegExp(`\\b${fn}\\b`).test(reachableSource))) {
      reachable.add(file);
      changed = true;
    }
  }
}

const frozen = [];
const staleAllowlist = [];

for (const file of repositoryFiles) {
  const name = file.slice(REPO_DIR.length);
  // 可达的兄弟 repository 是合法调用点。
  const siblingHaystack = [...reachable].filter((f) => f !== file).map((f) => sourceOf.get(f)).join("\n");
  const ownSource = sourceOf.get(file);
  for (const fn of exportsOf.get(file)) {
    const key = `${name}::${fn}`;
    // 注意：带 g 的正则不能拿来连续 .test()——lastIndex 有状态，第二次调用会从上次的
    // 位置续查，结果随调用顺序漂移。计数用 g，判定用无状态的那个。
    const pattern = new RegExp(`\\b${fn}\\b`);
    // 文件内部的调用只在**该文件本身可达**时才算数：可达文件里的内部调用会真的被执行
    // （真实用例：renderProfileMarkdown 只被同文件的 upsertCompanyProfile 调用——它是活的，
    // 多余的只是 export）；不可达文件则不算，否则一簇互相调用、生产一个都没接的
    // repository 会集体显得健在，正好放过本门禁要抓的那种病。
    // 匹配数 > 1 才算：定义本身必然贡献 1 次。
    const ownUses = reachable.has(file) && (ownSource.match(new RegExp(`\\b${fn}\\b`, "g")) || []).length > 1;
    const used = pattern.test(productionHaystack) || pattern.test(siblingHaystack) || ownUses;
    const allowed = Object.hasOwn(ALLOWED, key);

    if (!used && !allowed) {
      frozen.push(`${file} :: ${fn}() —— ${WRITE_RE.test(fn)
        ? "写入函数零调用：这张表永远不会被写，任何读取方都在读空表"
        : "读取函数零调用：数据采了没人用，或某个功能被悄悄摘掉了"}`);
    }
    if (used && allowed) {
      staleAllowlist.push(`${key} —— 已重新有调用方，请从 ALLOWED 删除该条目（白名单不能替真问题挡枪）`);
    }
  }
}

if (frozen.length || staleAllowlist.length) {
  const lines = [];
  if (frozen.length) {
    lines.push("发现冻结表（repository 有接口但无生产调用方）：", ...frozen.map((v) => `- ${v}`), "",
      "这类缺陷不会报错、不会告警，只是永远不生效。要么接回主链路，",
      "要么在 scripts/quality/check-frozen-tables.mjs 的 ALLOWED 里记账并写明解除条件。");
  }
  if (staleAllowlist.length) {
    if (lines.length) lines.push("");
    lines.push("白名单已过期：", ...staleAllowlist.map((v) => `- ${v}`));
  }
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(1);
}

process.stdout.write(
  `[frozen-tables] clean: ${repositoryFiles.length} repositories checked, ${Object.keys(ALLOWED).length} accounted-for exceptions\n`
);
