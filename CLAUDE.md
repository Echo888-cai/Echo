# CLAUDE.md — Claude Code Instructions

## Project

- **唯一计划文档：`docs/PLAN.md`**（终局架构 + 已拍板决策 + 1→7 执行步骤 + 宪法红线）。做任何改动前先读它；不要创建新计划、分轨、ADR 或候选方案。
- 生产在旧底盘（`server.js` + `src/` + SQLite，后端无热重载）；`npm run lint`、`npm run typecheck`、`npm run typecheck:workspaces`、`npm test`、契约测试和 React build 必须全绿再提交。

## Effort Policy

- **Default to medium effort** for normal work.
- **Use high effort** only for: tricky debugging, multi-file refactors, architecture decisions.
- **Use low effort** for: formatting, renames, simple edits, boilerplate, sub-agent execution.
- If a task would require max effort on Sonnet 5, first evaluate whether Opus 4.8 at high or Fable 5 at medium is better on quality and cost.

## Routing Rule

- **Default to Sonnet 5** for: knowledge work, everyday coding, brownfield maintenance, research & summarization.
- **Escalate to Opus 4.8 or Fable 5** only on clear evidence the task is in the hardest tier (long-horizon autonomous loops, deepest multi-step reasoning, security-sensitive).
- **Fable 5 is reserved** for ambitious, multi-day autonomous projects where its planning and self-validation actually change the outcome.
