/**
 * 死请求字段门禁 —— 冻结表模式在**请求字段**上的同款翻版，同样不会以任何形式报错。
 *
 * 冻结表是"表建好了没人写/没人读"；这一类是"字段进了契约、前端认真地发、
 * 后端一个字都不读"。CI 全绿、类型全过、zod 校验通过（因为 schema 里确实有这个字段），
 * 用户点着一个承诺得明明白白的按钮，拿到的是一个从来没实现过的功能。
 *
 * 真实案例（2026-07-17 智能分析测评抓到，各静默数月）：
 * - `compareWith`：契约里有、前端发、UI 明确承诺"拉两家真实数据并排比，不跳走"，
 *   而 `research.ts` 里写死 `compare: null`。answerComposer 的 buildCompareBlock() 和
 *   整段对比作答规则全是死代码。用户拿到的是模型凭记忆写的定性段落。
 * - `documents`：用户上传年报 → 解析 → 每轮请求都发 → `research.ts` 从不读 `input.documents`。
 *   实测上传只含"毛利率 42.7%"的文档并直接问它，回答里没有 42.7。UI 却提示"已上传 N 个资料"。
 *
 * 为什么单元测试抓不到：这两个字段**有** zod schema、**有**类型、**有**前端调用点。
 * 每一层单独看都是对的，只有"从契约到消费方"这条端到端的线是断的。
 *
 * 检查方式：契约里声明的每个请求字段，必须能在服务端消费方代码里找到读取点。
 * 找不到 = 要么接上，要么从契约里删掉（"前端发了但没人要"本身就是该删的东西）。
 */
import { readFileSync } from "node:fs";
import process from "node:process";

/**
 * 被检查的契约请求字段 → 谁该消费它。
 *
 * 只列**承载用户意图**的字段（用户提供了它就期待它影响结果）。像 sessionId/conversationId
 * 这种纯管道字段不列——它们的消费方是持久化层，不是研究链路。
 */
const CONTRACT_FIELDS = [
  { field: "compareWith", contract: "packages/contracts/src/ask.ts", consumers: ["packages/application/src/research.ts"] },
  { field: "documents", contract: "packages/contracts/src/ask.ts", consumers: ["packages/application/src/research.ts"] },
  { field: "history", contract: "packages/contracts/src/ask.ts", consumers: ["packages/application/src/research.ts"] }
];

/**
 * 已记账的例外。key 是字段名，value 必须写明解除条件。
 * 加条目前先问一句：这真的是"等外部依赖"，还是"我刚把它接漏了"？
 */
const ALLOWED = {
  // 目前没有例外。compareWith / documents 已于 2026-07-17 接通。
};

const SELF = "scripts/quality/check-dead-request-fields.mjs";

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const failures = [];
const stale = [];

for (const { field, contract, consumers } of CONTRACT_FIELDS) {
  const contractSource = read(contract);
  if (contractSource === null) {
    failures.push(`契约文件读不到：${contract}`);
    continue;
  }
  // 字段得先真的在契约里；契约删了字段而这里还列着，说明这份清单自己过期了。
  if (!new RegExp(`(^|\\s)${field}\\s*:`, "m").test(contractSource)) {
    stale.push(`${field}：已不在 ${contract} 里，请从本脚本的 CONTRACT_FIELDS 删除`);
    continue;
  }

  const consumed = consumers.some((path) => {
    const source = read(path);
    if (source === null) return false;
    // 只认"真的读了这个字段"：input.field / input?.field / 解构 { field }。
    // 单纯出现字段名（比如注释里提一嘴）不算——那正是我们要抓的自欺。
    const readPatterns = [
      new RegExp(`input\\s*\\??\\.\\s*${field}\\b`),
      new RegExp(`\\{[^}]*\\b${field}\\b[^}]*\\}\\s*=\\s*input\\b`)
    ];
    // 注释行不参与判定：`// compare: null 已接通` 这种句子不能证明代码读了它。
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    return readPatterns.some((re) => re.test(code));
  });

  if (ALLOWED[field]) {
    if (consumed) stale.push(`${field}：已经有真实消费方了，请从 ALLOWED 删除该条目（留着会替真问题挡枪）`);
    continue;
  }
  if (!consumed) {
    failures.push(
      `${field}（声明于 ${contract}）在 ${consumers.join(" / ")} 里没有任何读取点。\n` +
        `      前端发了、契约收了、后端不读 = 这个功能对用户不存在，且不会报错。\n` +
        `      要么接上消费方，要么从契约里删掉这个字段。`
    );
  }
}

if (stale.length || failures.length) {
  for (const s of stale) console.error(`[dead-request-fields] 清单过期：${s}`);
  for (const f of failures) console.error(`[dead-request-fields] 死字段：${f}`);
  process.exit(1);
}

console.log(`[dead-request-fields] clean: ${CONTRACT_FIELDS.length} 个契约请求字段都有真实消费方`);
void SELF;
