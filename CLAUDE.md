# CLAUDE.md — Claude Code Instructions

## Effort Policy

- **Default to medium effort** for normal work.
- **Use high effort** only for: tricky debugging, multi-file refactors, architecture decisions.
- **Use low effort** for: formatting, renames, simple edits, boilerplate, sub-agent execution.
- If a task would require max effort on Sonnet 5, first evaluate whether Opus 4.8 at high or Fable 5 at medium is better on quality and cost.

## Routing Rule

- **Default to Sonnet 5** for: knowledge work, everyday coding, brownfield maintenance, research & summarization.
- **Escalate to Opus 4.8 or Fable 5** only on clear evidence the task is in the hardest tier (long-horizon autonomous loops, deepest multi-step reasoning, security-sensitive).
- **Fable 5 is reserved** for ambitious, multi-day autonomous projects where its planning and self-validation actually change the outcome.
