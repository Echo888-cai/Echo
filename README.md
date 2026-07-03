# Echo Research

**An AI research desk for Hong Kong & US equities.**

> Seek signal. Ignore noise. — 喧声之外，见真知。

Echo Research is a quiet, analyst-style workspace for asking better questions about public companies — in **HK and US markets**. It is built around one continuous conversation: start with a company, ask what matters, inspect the evidence, and turn scattered market information into a judgment you can revisit.

It is not a trading-signal machine. It is closer to a patient research partner: direct, skeptical, source-aware, and comfortable saying what is known, what is inferred, and what still needs to be verified.

---

## Why Echo Research Exists

Most investing tools are built around noise: price flashes, chart widgets, crowded dashboards, and generic AI summaries. Echo Research takes the opposite direction. It tries to answer a simpler question:

> If I were sitting with a sharp research analyst, what would I expect them to tell me about this company right now?

That means the product is optimized for:

- **clear thinking over busy screens**
- **evidence before confidence** — every answer carries clickable, credibility-scored sources
- **continuous follow-up instead of disconnected reports**
- **plain-language financial reasoning**
- **honest confidence** — confidence chips and a self-consistent valuation range, never fake certainty

Echo Research covers **Hong Kong and US listings** — large-cap technology, internet, consumer, financial, semiconductor and infrastructure names.

The look is deliberate: warm kraft-paper surfaces, ink type, a terracotta accent, and calm motion — a research journal, not a trading terminal.

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

**Honest about what it can't resolve.** If a question names a company Echo Research genuinely can't pin to a ticker, it says so and asks for a code — it will **never silently answer as the previously-open company**. A-share-only names (`贵州茅台`) are recognized and politely declined, since coverage is HK + US. Follow-ups (`护城河是什么？` / `估值贵不贵？`) are understood as questions about the current company, not mistaken for new ones.

**Dual-listed names** (Alibaba `9988.HK` / `BABA`, JD, Baidu, NetEase, NIO, Li Auto, …) are recognized as one company. Because FMP's free tier covers the US ADR but not the HK line, fundamentals & valuation route **to the US ADR** (richer data) while both tickers and a "双重上市" note are shown — so you always know it's the same business and which side the numbers come from.

**Beyond a single company.** Open-ended questions route to a discovery layer instead of the company pipeline: a **screener** (`帮我筛美股半导体 PE<20` → sector / PE / price / market-cap filters over the FMP screener, plus your already-researched names) and a **macro** lane (`美股今晚有什么关键事件` → live index quotes + web evidence + a sourced macro read). Any result is one click from opening a full company research session.

Interaction principles:

- one research conversation, not scattered pages
- lightweight, Apple-grade interface with **light & dark themes** and calm motion
- **structured answers** — the analyst's reply is split into labelled research sections (结论 / 事实 / 推断 / 估值·风险 / 证伪条件 / 我的判断 / 来源), with the verdict promoted to a highlighted card so a long answer is scannable, not a wall of text
- **clickable evidence provenance cards** — source type, date, credibility dot
- **a data-grounding bar at the top of every answer** — `行情✓ 财报✓ 新闻✗ 预期 + 完整度%`, so low confidence is always explainable
- **confidence chips** (scored by how many data slots are actually grounded), an **analyst-consensus block** (buy/hold/sell distribution + consensus target & upside), and a **valuation range bar** (bear / base / bull + reward:risk odds, with the cross-validated method list)
- **real-time streaming answers** — the reply streams in token by token over SSE with a live caret, then settles into the structured, sourced final card (graceful fallback to a non-streaming request if streaming is unavailable)
- **export** a research session to Markdown
- **smooth company switching** — mention a new company mid-chat and a fresh, clean session opens for it
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

> Every provider degrades gracefully. FMP's free tier gates the statement endpoints (`402 Special Endpoint`), so US fundamentals come from **Finnhub's free metric endpoint** — real EPS / PE / margins / ROE — which still powers the **profit-quality score** and the **valuation range bar**. A premium-gated endpoint never cools down the whole FMP key (so search/resolve keep working). HK full statements need a paid source or the first-party filing pipeline below.

### Research conversation

Echo Research identifies the company, keeps context, and routes intent: company status, business model, moat, **financial quality** (incl. colloquial "赚吗 / 赚不赚钱"), valuation, **falsification conditions**, and deep research.

### Discovery layer

Questions that aren't bound to one company are split off before company resolution: a **screener** (natural-language filters → FMP company-screener + your researched pool) and a **macro** read (index quotes + macro web evidence + a sourced short take, with an honest local fallback when no model key is set).

### Evidence-aware reasoning

Judgment first, then the basis, then (folded at the end) what's still missing. Web evidence is retrieved, **URL-validated (no dead links)**, junk-filtered, credibility-scored, body-extracted, cached, and merged into the decision panel so it persists and powers the provenance cards. (Add `TAVILY_API_KEY` to unlock stable full-coverage web search.)

### Valuation & odds

A multi-method valuation engine (PE / Forward PE / FCF yield / DCF) with a display-safe guard: if the range is incoherent with the live price, it falls back to a self-consistent PE band. The answer renders a range bar and a reward:risk ratio, surfaces the **cross-validated method list** and key assumptions, and — when analyst data is available — overlays an **analyst consensus target anchor**. The same numbers are fed to the model so prose and visual never contradict.

### Analyst consensus

When the data is available (Finnhub recommendations for the buy/hold/sell distribution, Yahoo as a best-effort target-price fallback), answers carry an **analyst-consensus block**: the rating distribution as a coloured bar, the consensus direction, and the consensus target with upside-to-target. The presence of consensus data also **raises the confidence score** — confidence is scored by how many real data dimensions (price / fundamentals / estimates / filings / news) are grounded.

### First-party HK filings pipeline

For HK names, an ingestion pipeline pulls HKEX results-announcement PDFs, extracts the key financial tables (revenue / profit / operating cash flow), and structures them into the same financial-snapshot shape the rest of the app reads — closing the biggest data gap on the HK side. US first-party filings route through SEC EDGAR (8-K / 10-Q / 10-K, free, no key).

### Event digest

An on-demand pre-/after-market digest for the companies you research or hold. Events are pulled from the earnings calendar, major news and position discipline, then **graded** (🔴 high / 🟡 medium / ⚪ low), **grouped by company**, and de-noised: law-firm class-action wire spam is dropped, and a **relevance gate** keeps a company's feed about *that* company. Failures are surfaced honestly — you can tell "nothing happened" apart from "couldn't fetch".

### Proactive scheduler & notifications

A scheduler runs pre-/after-market digests and watch-rule checks on a cadence and writes to a local notification centre (bell + unread count), so the highest-value moments — the open, a breached stop — don't depend on you having the tab open.

### Portfolio ledger

Record holdings in plain language (`耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5`) or add/edit them manually. The portfolio panel shows **live price, market value, unrealized P&L (¥/%), and distance to your stop / take lines** per position; the event digest watches those lines and flags large drawdowns.

### Company portrait (long-term memory)

Each researched company accretes a **portrait document**: a Markdown master file (key metrics, moat, risk ledger) plus an event timeline that records *changes* — with reasons, evidence links, and a jump back to the session where the view shifted. It renders on the company page and exports.

### Local research memory

Sessions persist in SQLite (thread, company, decision panel, valuation, sources, generated content) — an iterative research notebook, not a disposable chat. Each turn's answer keeps its own meta (valuation bar, evidence cards, confidence chip), so reopening a past session **renders exactly like the live answer**.

### Model safety

Structured-output validation with one repair pass and a safe local fallback. No buy/sell/hold instructions — only research judgments, monitoring conditions and risk checkpoints.

---

## Architecture

Plain Node (single runtime dependency: `better-sqlite3`) and a build-less, framework-less native-ESM front end. No bundler, no transpile step — the browser loads `src/app.js` as a module directly.

```text
Echo Research
├── index.html                     # SPA shell (loads src/app.js as an ES module)
├── server.js                      # Thin HTTP router — only the endpoints the UI uses
├── src/
│   ├── app.js                     # Front-end entry: route dispatch + global event delegation
│   ├── ui/                        # Modular front end (no framework)
│   │   ├── state.js api.js resolve.js format.js markdown.js
│   │   ├── shell.js research.js watch.js settings.js portfolio.js
│   │   └── notifications.js components.js
│   ├── styles/                    # Layered CSS (00-foundation → 07-brand)
│   ├── market.js                  # HK/US detection + per-provider symbol mapping
│   ├── data.js marketData.js financialData.js newsData.js filingData.js
│   ├── fmpClient.js secFilings.js documentParser.js prompts.js
│   ├── server/
│   │   ├── routes/                # chat · discover · companies · research · reports ·
│   │   │                          #   documents · events · portfolio · portraits ·
│   │   │                          #   watch · notifications · hkFinancials · status
│   │   ├── services/              # agentService · answerComposer · valuationEngine ·
│   │   │                          #   financialQuality · webEvidenceService · eventEngine ·
│   │   │                          #   companyPortrait · discovery · intentClassifier ·
│   │   │                          #   twoStageChat · scheduler · notifier · riskEngine ·
│   │   │                          #   hkFilingsPipeline · modelGateway · decisionPanel · …
│   │   ├── repositories/          # SQLite access (sessions, profiles, portfolio, watch, …)
│   │   ├── schemas/               # structured-output validation
│   │   └── utils/                 # time anchoring, async, env
│   └── data/                      # HK stock seed data
├── scripts/                       # seed-db, doctor, one-off migrations
├── tests/                         # smoke · reliability · phase3/4/6/7 · notifications
└── docs/                          # product, architecture, data-source & plan notes
```

The chat route is thin: it orchestrates a single data+evidence pass, a two-stage model call (search-triage → **streamed** answer), and one DB write. Streaming and non-streaming requests share one `finalizeChat` post-processor, so both paths persist and render identically. All answer composition lives in `services/answerComposer.js`; every model call goes through `services/modelGateway.js` (provider priority + fallback).

---

## Local Setup

```bash
npm install        # dependencies
npm run seed       # seed the local SQLite DB
npm run dev        # run → http://127.0.0.1:4173
npm test           # smoke + reliability + phase/notification suites

# Optional (HK first-party filing pipeline): Chinese-font CMap tables for the
# HKEX results-announcement PDFs (Adobe-CNS1 CID, no ToUnicode).
pip3 install --user pdfminer.six
```

The backend has **no hot reload** — after editing `src/server/**` or `src/*.js`, restart the node process. For isolated local runs against a throwaway DB:

```bash
LUVIO_DB_PATH=$TMPDIR/x.db PORT=4199 node server.js
```

---

## Environment

Copy `.env.example` to `.env` and fill what you have. It runs without any keys (local fallback), but the keys below unlock real research:

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
# FMP is used for company search/resolve, the screener, and statements when your
# plan allows; its free tier gates the statement endpoints, so Finnhub is the
# US fundamentals fallback.
FMP_API_KEY=

# Web evidence — optional; without it, search falls back to DuckDuckGo/Yahoo/Bing
# (404-checked). Tavily free tier is 1000/mo: https://tavily.com
TAVILY_API_KEY=
SERPAPI_API_KEY=
```

---

## Status

**Working:** HK + US research conversation · dual-listing routing (HK ↔ US ADR) · discovery layer (screener + macro) · market-aware quotes & fundamentals · US real profit-quality scores · intent routing (incl. financial-quality & falsification) · evidence provenance with URL validation · data-grounding bar + completeness % · data-dimension confidence scoring · analyst consensus (distribution + target anchor) · valuation range + odds + cross-validated methods · structured section answers · real-time SSE streaming · company-grouped event digest with severity + relevance gate · proactive scheduler + notification centre · portfolio panel with live P&L · company portrait documents · HK first-party filing ingestion · Markdown export · SQLite history · light & dark UI.

**Next:** stable web coverage (`TAVILY_API_KEY` + non-sandbox verification) · deeper agentic reasoning across stocks · mobile (responsive + PWA) · deploy-ready auth & multi-user. See the plan docs below.

---

## Documentation

- **[Master Plan（评审 + 分阶段改进计划 + 接手协议）](docs/MASTER_PLAN_2026-07-02.md)** ← start here to contribute
- [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Data Pipeline](docs/DATA_PIPELINE.md)
- [Data Source Strategy](docs/DATA_SOURCE_STRATEGY.md) · [Product Requirements](docs/PRD.md)
- [平台调研备忘](docs/PLATFORM_BENCHMARK.md) · [AI Integration](docs/AI_INTEGRATION.md) · [GitHub Workflow](docs/GITHUB_WORKFLOW.md)

---

## License

Private research prototype. License to be decided.
