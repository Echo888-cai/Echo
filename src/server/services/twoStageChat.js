/**
 * twoStageChat — 两阶段"检索分流 → 作答"编排（对标 HoneClaw 的 search→answer runner）。
 *
 * 阶段 1（检索分流 agent）：基于问题 + 公司 + 已接入数据 + 网页证据，产出一份
 *   紧凑的内部研究笔记——已验证事实 / 关键缺口 / 实体确认 / 回答角度。强制检索纪律：
 *   - 模糊/疑似拼错的 ticker 且要求买卖动作时，先澄清，不猜实体。
 *   - 指代词（"这只""它"）指向不明时，不从历史里翻旧标的。
 *   - 以当前用户消息为事实源，不复活历史里的旧公司。
 *   - 区分已验证事实与推断，缺数据只说一句。
 * 阶段 2（作答 agent）：基于阶段 1 的研究笔记 + 决策面板 + 估值，写最终回答。
 *
 * 有模型 key 时启用；阶段 1 失败/超时则回退为单段作答（现有行为），绝不回归。
 */

import { callModel, callModelStream } from "./modelGateway.js";
import { withTimeout } from "../utils/async.js";
import { buildChatPrompt } from "./answerComposer.js";
import { beijingMinute } from "../utils/time.js";

const SEARCH_STAGE_TIMEOUT_MS = 15000;
const ANSWER_STAGE_TIMEOUT_MS = 30000;

const SEARCH_STAGE_SYSTEM = `你是研究流程里的"检索分流 agent"，不是最终作答者。你的产出是一份**纯文本内部研究笔记**，供下游作答 agent 使用，用户不会直接看到。

纪律：
- 以当前用户问题为事实源。不要从历史里翻出旧标的、旧公司当成本轮主题。
- 若问题里的代码疑似拼错、近似或非标准，且用户要求买卖/加减仓动作，先标注"需澄清实体"，不要猜。
- 若问题用"这只/那只/它/这个"等指代词，且指向不明，标注"指代不明，需澄清"，不要从旧上下文硬认。
- 严格区分【已验证事实】（来自下方已接入数据/网页证据）与【推断】。不要编造具体数字。
- 缺数据只在【关键缺口】里列一两条，不展开。

只输出这四段纯文本，不要 Markdown 表格、不要代码块、不要客套：
实体确认：<确认/需澄清，及原因>
已验证事实：<逐条，引用来源；无则写"本轮无可直接引用的硬数据">
关键缺口：<逐条；无则写"无重大缺口">
回答角度：<这个问题应该重点回答什么，一句话>`;

/** 阶段 1 的用户提示词：复用 buildChatPrompt 的素材，但只要研究笔记。 */
function buildSearchStagePrompt(question, panel, dataSources, context) {
  // 复用 buildChatPrompt 已经组织好的全部素材（数据、证据、档案、画像），
  // 但把任务改成"产出研究笔记"而不是"作答"。
  const material = buildChatPrompt(question, panel, dataSources, context);
  return `${material}

——————————
现在不要作答。请只输出上面规定的四段研究笔记（实体确认 / 已验证事实 / 关键缺口 / 回答角度），供下游作答 agent 使用。当前北京时间：${beijingMinute()}。`;
}

/** 阶段 2 的用户提示词：把研究笔记作为已验证素材交给作答 agent。 */
function buildAnswerStagePrompt(question, panel, dataSources, context, researchNote) {
  const material = buildChatPrompt(question, panel, dataSources, context);
  return `${material}

——————————
检索分流 agent 已经核验并整理出以下研究笔记（已验证事实优先采用，不要照抄它的格式）：
"""
${researchNote}
"""

若研究笔记标注"需澄清实体"或"指代不明"，你的回答应先用一句话请用户确认标的，不要给出价格目标或买卖动作。否则按上面的回答规则作答。`;
}

/**
 * 两阶段作答。返回 { content, provider, model, stages }；
 * - stages: "two_stage" | "single" | "none"
 * - 任一阶段失败回退：阶段1失败→单段；模型整体不可用→content=null，调用方用本地兜底。
 */
export async function runTwoStageChat({ question, panel, dataSources, context, system }) {
  // 阶段 1：检索分流，产出研究笔记（短超时，失败就跳过）。
  let researchNote = "";
  let searchModel = null;
  try {
    searchModel = await withTimeout(
      callModel({ system: SEARCH_STAGE_SYSTEM, user: buildSearchStagePrompt(question, panel, dataSources, context) }),
      SEARCH_STAGE_TIMEOUT_MS,
      null
    );
    if (searchModel?.content && searchModel.content.trim().length > 10) {
      researchNote = searchModel.content.trim();
    }
  } catch {
    researchNote = "";
  }

  // 阶段 2：作答。有研究笔记走两阶段提示，否则退回单段提示。
  const answerUser = researchNote
    ? buildAnswerStagePrompt(question, panel, dataSources, context, researchNote)
    : buildChatPrompt(question, panel, dataSources, context);

  let answerModel = null;
  try {
    answerModel = await withTimeout(
      callModel({ system, user: answerUser }),
      ANSWER_STAGE_TIMEOUT_MS,
      null
    );
  } catch {
    answerModel = null;
  }

  if (!answerModel?.content) {
    return { content: null, provider: null, model: null, stages: "none" };
  }
  return {
    content: answerModel.content,
    provider: answerModel.provider,
    model: answerModel.model,
    stages: researchNote ? "two_stage" : "single"
  };
}

/** 阶段 1（内部研究笔记）的复用：非流式、用户不可见。返回 researchNote 字符串。 */
async function runSearchStage({ question, panel, dataSources, context }) {
  try {
    const searchModel = await withTimeout(
      callModel({ system: SEARCH_STAGE_SYSTEM, user: buildSearchStagePrompt(question, panel, dataSources, context) }),
      SEARCH_STAGE_TIMEOUT_MS,
      null
    );
    if (searchModel?.content && searchModel.content.trim().length > 10) return searchModel.content.trim();
  } catch { /* 阶段1失败→单段 */ }
  return "";
}

/**
 * 流式版两阶段作答。阶段 1 与非流式一致（内部笔记，用户不可见）；阶段 2 用
 * callModelStream 把答案增量通过 onToken 推出去。返回与 runTwoStageChat 同形的对象
 * （含完整 content，供下游归一化/落库）。阶段 2 不可用时 content=null，调用方走本地兜底。
 */
export async function runTwoStageChatStream({ question, panel, dataSources, context, system, onToken, onReasoning }) {
  const researchNote = await runSearchStage({ question, panel, dataSources, context });
  const answerUser = researchNote
    ? buildAnswerStagePrompt(question, panel, dataSources, context, researchNote)
    : buildChatPrompt(question, panel, dataSources, context);

  let answerModel = null;
  try {
    answerModel = await callModelStream({ system, user: answerUser, onToken, onReasoning });
  } catch {
    answerModel = null;
  }

  if (!answerModel?.content) {
    return { content: null, provider: null, model: null, stages: "none" };
  }
  return {
    content: answerModel.content,
    provider: answerModel.provider,
    model: answerModel.model,
    stages: researchNote ? "two_stage" : "single"
  };
}
