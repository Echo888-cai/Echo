# Luvio

**An AI research console for Hong Kong & US equities.**

Luvio is a quiet, analyst-style research workspace for asking better questions about public companies — in **HK and US markets**. It is designed around one continuous conversation: start with a company, ask what matters, inspect the evidence, and turn scattered market information into a judgment you can revisit.

It is not a trading signal machine. It is closer to a patient research partner: direct, skeptical, source-aware, and comfortable saying what is known, what is inferred, and what still needs to be verified.

---

## Why Luvio Exists

Most investing tools are built around noise: price flashes, chart widgets, crowded dashboards, and generic AI summaries. Luvio takes the opposite direction. It tries to answer a simpler question:

> If I were sitting with a sharp research analyst, what would I expect them to tell me about this company right now?

That means the product is optimized for:

- **clear thinking over busy screens**
- **evidence before confidence** — every answer carries clickable, credibility-scored sources
- **continuous follow-up instead of disconnected reports**
- **plain-language financial reasoning**
- **honest confidence** — confidence chips and a self-consistent valuation range, never fake certainty

Luvio covers **Hong Kong and US listings** — large-cap technology, internet, consumer, financial, semiconductor and infrastructure names.

---

## Product Experience

Ask in plain language, in either market:

```text
腾讯最近怎么样？        # HK by name
AAPL 赚钱吗？           # US by ticker
英伟达的护城河在哪？     # US by Chinese name
比亚迪 vs 特斯拉 哪个赔率好？
```

Then continue naturally — `它靠什么赚钱？` / `护城河是什么？` / `什么情况会证伪？`. The system keeps the company context, adapts the format to the question (focused follow-ups get focused answers), and never restarts the whole report each turn.

Company resolution is layered, so almost any name works: a built-in **Chinese/English alias table** (`美光` / `Micron`, `博通`, `礼来`, …), an **FMP name-search** for English/pinyin (`Robinhood` → `HOOD`, `Coinbase` → `COIN`), and an **LLM resolver** that maps a free-form Chinese name to the right ticker and **verifies it against FMP** before trusting it (`泛林集团` → `LRCX`, `商汤` → `0020.HK`). Explicit notation always works too (bare `AAPL`, `$NVDA`, `TSLA.US`, `0700.HK`).

**Honest about what it can't resolve.** If a question names a company Luvio genuinely can't pin to a ticker, it says so and asks for a code — it will **never silently answer as the previously-open company** (no more "ask about Micron, get an answer about a construction firm"). A-share-only names (`贵州茅台`) are recognized and politely declined, since Luvio covers HK + US. Follow-ups (`护城河是什么？` / `估值贵不贵？`) are understood as questions about the current company, not mistaken for new ones.

**Dual-listed names** (Alibaba `9988.HK` / `BABA`, JD, Baidu, NetEase, NIO, Li Auto, …) are recognized as one company. Because FMP's free tier covers the US ADR but not the HK line, Luvio routes **fundamentals & valuation to the US ADR** (richer data) while showing both tickers and a "双重上市" note — so you always know it's the same business and which side the numbers come from.

Interaction principles:

- one research conversation, not scattered pages
- lightweight, Apple-grade interface with **light & dark themes** and calm motion
- **structured answers** — the analyst's reply is split into labelled research sections (结论 / 事实 / 推断 / 估值·风险 / 证伪条件 / 我的判断 / 来源), with the verdict promoted to a highlighted card so a long answer is scannable, not a wall of text
- **clickable evidence provenance cards** — source type, date, credibility dot
- **a data-grounding bar at the top of every answer** — `行情✓ 财报✓ 新闻✗ 预期 + 完整度%`, so low confidence is always explainable
- **confidence chips** (scored by how many data slots are actually grounded), an **analyst-consensus block** (buy/hold/sell distribution + consensus target & upside), and a **valuation range bar** (bear / base / bull + reward:risk odds, with the cross-validated method list)
- **real-time streaming answers** — the analyst's reply streams in token by token over SSE with a live caret, then settles into the structured, sourced final card (graceful fallback to a non-streaming request if streaming is unavailable)
- **export** a research session to Markdown
- **smooth company switching** — mention a new company mid-chat and Luvio opens a fresh, clean session for it
- research history stored locally in SQLite, collapsible so it never steals the screen

---

## Core Capabilities

### Market-aware data routing

A single `src/market.js` layer knows whether a ticker is HK or US and spells it correctly for every provider:

- **HK quotes** → Tencent Finance (free), with Finnhub / Alpha Vantage / Yahoo fallback.
- **US quotes** → Finnhub / Alpha Vantage / Yahoo.
- **Fundamentals** → FMP `/stable` when the plan allows it, else **Finnhub `/stock/metric`** (free: EPS / PE / margins / ROE / growth), then Yahoo. HK falls back to Tencent/Yahoo basics.
- **Company news** → Finnhub `/company-news` (free, keyed, reliable) as the primary source, with Yahoo / Bing scraping as supplement.
- Currency is inferred per market (USD / HKD).

> Every provider degrades gracefully. FMP's free tier now gates the statement endpoints (`402 Special Endpoint`), so US fundamentals are sourced from **Finnhub's free metric endpoint** — real EPS / PE / margins / ROE — which still powers the **profit-quality score** and the **valuation range bar**. A premium-gated endpoint never cools down the whole FMP key (so search/resolve keep working). HK full statements need a paid source; HK valuation shows a self-consistent PE band.

### Research conversation

Luvio identifies the company, keeps context, and routes intent: company status, business model, moat, **financial quality** (incl. colloquial "赚钱吗 / 赚不赚钱"), valuation, **falsification conditions**, and deep research.

### Evidence-aware reasoning

Judgment first, then the basis, then (folded at the end) what's still missing. Web evidence is retrieved, **URL-validated (no dead links)**, junk-filtered, credibility-scored, body-extracted, cached, and merged into the decision panel so it persists and powers the provenance cards. (Add `TAVILY_API_KEY` to unlock stable full-coverage web search.)

### Valuation & odds

A multi-method valuation engine (PE / Forward PE / FCF yield / DCF) with a display-safe guard: if the range is incoherent with the live price, it falls back to a self-consistent PE band. The answer renders a range bar and a reward:risk ratio, surfaces the **cross-validated method list** and key assumptions, and — when analyst data is available — overlays an **analyst consensus target anchor**. The same numbers are fed to the model so prose and visual never contradict.

### Analyst consensus

When the data is available (Finnhub recommendations for the buy/hold/sell distribution, Yahoo as a best-effort target-price fallback), answers carry an **analyst-consensus block**: the rating distribution as a coloured bar, the consensus direction, and the consensus target with upside-to-target. The presence of consensus data also **raises the confidence score** — confidence is now scored by how many real data dimensions (price / fundamentals / estimates / filings / news) are grounded, instead of requiring HK-only filings.

### Event digest

An on-demand pre-/after-market digest for the companies you research or hold. Events are pulled from the earnings calendar, major news and position discipline, then **graded** (🔴 high / 🟡 medium / ⚪ low), **grouped by company**, and de-noised: law-firm class-action wire spam is dropped, and a **relevance gate** keeps a company's feed about *that* company (no competitor/market-wide bleed-in). Failures are surfaced honestly — you can tell "nothing happened" apart from "couldn't fetch", and HK names that FMP can't cover say so instead of silently showing empty.

### Portfolio ledger

Record holdings in plain language (`耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5`) or add/edit them manually. The portfolio panel shows **live price, market value, unrealized P&L (¥/%), and distance to your stop / take lines** per position; the event digest watches those lines and flags large drawdowns.

### Local research memory

Sessions persist in SQLite (thread, company, decision panel, valuation, sources, generated content) — an iterative research notebook, not a disposable chat. Each turn's answer keeps its own meta (valuation bar, evidence cards, confidence chip), so reopening a past session **renders exactly like the live answer** instead of losing the valuation bar.

### Model safety

Structured-output validation with one repair pass and a safe local fallback. No buy/sell/hold instructions — only research judgments, monitoring conditions and risk checkpoints.

---

## Architecture

```text
Luvio
├── index.html                     # Single-page app shell
├── server.js                      # Thin HTTP router (only the endpoints the UI uses)
├── src/
│   ├── app.js                     # Frontend interaction layer
│   ├── styles.css                 # Apple-grade research UI
│   ├── market.js                  # HK/US detection + per-provider symbol mapping
│   ├── data.js · marketData.js · financialData.js · newsData.js · filingData.js
│   ├── server/
│   │   ├── routes/                # chat, reports, companies, research, status, documents,
│   │   │                          #   events (digest), portfolio, portraits
│   │   ├── services/              # answerComposer, valuationEngine, financialQuality,
│   │   │                          #   webEvidenceService, eventEngine, companyPortrait,
│   │   │                          #   agentService, decisionPanel, …
│   │   └── repositories/          # SQLite access
│   └── data/                      # HK stock seed data
├── scripts/seed-db.js             # SQLite seeding
├── tests/                         # smoke · reliability · phase3
└── docs/                          # product, architecture, data-source notes
```

The chat route is thin: it orchestrates a single data+evidence pass, a two-stage model call (search-triage → **streamed** answer), and one DB write. Streaming and non-streaming requests share one `finalizeChat` post-processor, so both paths persist and render identically. All answer composition lives in `services/answerComposer.js`.

---

## Local Setup

```bash
npm install        # dependencies
npm run seed       # seed the local SQLite DB
npm run dev        # run → http://127.0.0.1:4173
npm test           # smoke + reliability + engine tests
```

---

## Environment

Copy `.env.example` to `.env` and fill what you have. Luvio runs without any keys (local fallback), but the keys below unlock real research:

```text
# Model (DeepSeek recommended for the analyst agent)
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

# Quotes (any one is enough; HK also has a free Tencent path)
FINNHUB_API_KEY=
ALPHAVANTAGE_API_KEY=
TWELVEDATA_API_KEY=

# Fundamentals & news — the FINNHUB_API_KEY above also powers US fundamentals
# (EPS/PE/margins via /stock/metric) and reliable company news on the free tier.
# FMP is used for company search/resolve and statements when your plan allows; its free
# tier now gates the statement endpoints, so Finnhub is the US fundamentals fallback.
FMP_API_KEY=

# Web evidence — optional; without it Luvio uses DuckDuckGo/Yahoo/Bing (404-checked).
# Tavily free tier is 1000/mo: https://tavily.com
TAVILY_API_KEY=
SERPAPI_API_KEY=
```

---

## Status

**Working:** HK + US research conversation · dual-listing routing (HK ↔ US ADR) · market-aware quotes & fundamentals · US real profit-quality scores · intent routing (incl. financial-quality & falsification) · evidence provenance with URL validation · **data-grounding bar + completeness %** · **data-dimension confidence scoring** · **analyst consensus (distribution + target anchor)** · valuation range + odds + cross-validated methods · **structured section answers** · **real-time SSE streaming** · **company-grouped event digest** with severity + relevance gate · **portfolio panel with live P&L** · Markdown export · smooth per-company sessions · streamed two-stage chat (one DB write) · SQLite history · **light & dark Apple-grade UI**.

**Next:** `TAVILY_API_KEY` for stable web coverage · **real HK three-statement fundamentals** (paid source or HKEX/IR PDF ingestion — the largest remaining gap) · multi-company comps · deploy-ready auth.

---

## Product Direction

Make Luvio feel like a calm investment research desk: ask one good question, get a useful judgment, see what it rests on, know what could prove it wrong, and keep the conversation going — across HK and US — without losing the thread.

---

## Documentation

- **[Master Plan（评审+分阶段改进计划+接手协议）](docs/MASTER_PLAN_2026-07-02.md)** ← start here to contribute
- [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Data Pipeline](docs/DATA_PIPELINE.md)
- [Data Source Strategy](docs/DATA_SOURCE_STRATEGY.md) · [Product Requirements](docs/PRD.md)
- [Platform Benchmark](docs/PLATFORM_BENCHMARK.md) · [AI Integration](docs/AI_INTEGRATION.md) · [GitHub Workflow](docs/GITHUB_WORKFLOW.md)

---

## License

Private research prototype. License to be decided.
