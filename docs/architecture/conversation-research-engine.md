# Conversation research engine

`route_research_intent` 先用纯规则确定意图、深度与回答风格；`build_panel` 对同一家公司计算阶段感知估值区间和数据完备度；模型网关只负责自然语言表达。无 provider 时返回结构化事实和 `unavailable`，不会拼接假答案。

模型生成文本和用户草稿共用 `verify_answer_numbers` 数字护栏。来源段不扫描，币种不匹配不通过，符号翻转是硬失败，缺少实时事实就明确“未核到”。研究响应成功后 best-effort 写入 `research_sessions`，落库失败不吞掉本轮回答。

深度研究的长期事实、证伪线和通知由 PostgreSQL 工作区仓储承接；Worker 只调用这些仓储和纯领域规则，不在定时任务中复制估值或通知策略。
