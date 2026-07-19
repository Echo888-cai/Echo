# Conversation research engine

Echo is conversation-first: every user turn becomes either a direct answer, a normal research turn, or a deep-research job. The UI does not invent progress. It renders the stage plan emitted by the backend.

```text
question
  -> deterministic intent/depth router
  -> model router only when rule confidence is low
  -> company resolution
  -> bounded recent context + PostgreSQL long-term memory
  -> depth-aware data gathering
  -> DeepSeek generation
  -> numeric/source fact guard
  -> conversation persistence + optional thesis memory update
```

## Routing contract

| Depth | Typical request | Pipeline | Answer contract |
| --- | --- | --- | --- |
| `brief` | “腾讯赚钱吗？” | route, resolve, market/financials, generate, verify | Direct answer; no research dashboard sections |
| `standard` | profitability, moat, competition, valuation | adds relevant evidence and valuation | Structured analyst answer with traceable sources |
| `deep` | explicit full report or multi-part thesis | full evidence, peer and valuation work | Long-form research artifact with falsifiers |

High-confidence cases take the deterministic fast path. Ambiguous cases use a small JSON-only model classification call whose result is cached in Redis. Redis failure falls back to an in-process TTL cache and never blocks a conversation.

## Context and memory

- Keep the eight most recent turns verbatim.
- Compress older turns into bounded semantic breadcrumbs.
- Cap prompt history at 24 messages and 12,000 characters.
- Read durable company facts and open questions from PostgreSQL.
- A `brief` answer is saved to the conversation but cannot silently rewrite the long-term investment thesis.
- Only `standard` and `deep` research may update company memory, research snapshots, or monitoring rules.

## Evidence discipline

The system prompt is written for a senior buy-side analyst. It separates verified facts, inference, and scenarios; prioritizes filings and official disclosures; exposes missing data; and forbids invented precision or trade instructions. The fact guard verifies financial numbers against the gathered registry before persistence.

## Runtime boundaries

- React/Vite owns the product surface.
- Hono/tRPC owns authenticated orchestration and contracts.
- PostgreSQL/RLS owns tenant data, conversations, billing state, and long-term memory.
- Redis owns disposable classification/result cache only.
- Rust remains the exact-decimal finance kernel behind N-API. It is used where correctness and numeric types matter; HTTP and product orchestration stay in TypeScript to avoid a high-risk rewrite with no research-quality gain.
- Temporal remains the durable boundary for long-running deep research.

## Honeclaw comparison

The design adopts the strongest ideas from [B-M-Capital-Research/honeclaw](https://github.com/B-M-Capital-Research/honeclaw): conversation-centric research, rational financial persona, long-term company memory, streaming progress, and a Rust correctness boundary. Echo keeps its existing enterprise advantages: PostgreSQL row-level tenant isolation, typed tRPC/REST contracts, explicit source and numeric guards, subscription/usage state, and Temporal recovery for durable jobs.

The remaining research-quality gap is primarily data coverage, not orchestration. FMP/Intrinio-class fundamentals, Finnhub estimates/calendar, and Tavily/SerpAPI evidence should be added through the existing adapter interfaces; the product must continue to show a capability as unavailable until its authorized source is connected.
