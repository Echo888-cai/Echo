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

US tickers can be typed bare (`AAPL`), by Chinese/English name (`苹果` / `Nvidia`), or explicitly with `$NVDA` / `TSLA.US`.

Interaction principles:

- one research conversation, not scattered pages
- lightweight, Apple-grade white interface with calm motion
- **clickable evidence provenance cards** — source type, date, credibility dot
- **confidence chips** and a **valuation range bar** (bear / base / bull + reward:risk odds)
- honest "thinking" state — a calm indicator, no fake step-progress
- **export** a research session to Markdown
- **smooth company switching** — mention a new company mid-chat and Luvio opens a fresh, clean session for it
- research history stored locally in SQLite, collapsible so it never steals the screen

---

## Core Capabilities

### Market-aware data routing

A single `src/market.js` layer knows whether a ticker is HK or US and spells it correctly for every provider:

- **HK quotes** → Tencent Finance (free), with Finnhub / Alpha Vantage / Yahoo fallback.
- **US quotes** → Finnhub / Alpha Vantage / Yahoo.
- **Fundamentals** → FMP (new `/stable` API) for US; HK falls back to Tencent/Yahoo basics.
- Currency is inferred per market (USD / HKD).

> FMP's **free tier covers US fundamentals** (real EPS / FCF / margins), so US names get a real **profit-quality score** and a valuation range. HK full statements need a paid source; HK valuation shows a self-consistent PE band.

### Research conversation

Luvio identifies the company, keeps context, and routes intent: company status, business model, moat, **financial quality** (incl. colloquial "赚钱吗 / 赚不赚钱"), valuation, **falsification conditions**, and deep research.

### Evidence-aware reasoning

Judgment first, then the basis, then (folded at the end) what's still missing. Web evidence is retrieved, **URL-validated (no dead links)**, junk-filtered, credibility-scored, body-extracted, cached, and merged into the decision panel so it persists and powers the provenance cards. (Add `TAVILY_API_KEY` to unlock stable full-coverage web search.)

### Valuation & odds

A multi-method valuation engine (PE / Forward PE / FCF yield / DCF) with a display-safe guard: if the range is incoherent with the live price, it falls back to a self-consistent PE band. The answer renders a range bar and a reward:risk ratio, and the same numbers are fed to the model so prose and visual never contradict.

### Local research memory

Sessions persist in SQLite (thread, company, decision panel, valuation, sources, generated content) — an iterative research notebook, not a disposable chat.

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
│   │   ├── routes/                # chat, reports, companies, research, status, documents
│   │   ├── services/              # answerComposer, valuationEngine, financialQuality,
│   │   │                          #   webEvidenceService, agentService, decisionPanel, …
│   │   └── repositories/          # SQLite access
│   └── data/                      # HK stock seed data
├── scripts/seed-db.js             # SQLite seeding
├── tests/                         # smoke · reliability · phase3
└── docs/                          # product, architecture, data-source notes
```

The chat route is thin: it orchestrates a single data+evidence pass, one model call, and one DB write. All answer composition lives in `services/answerComposer.js`.

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

# Fundamentals — FMP free tier covers US (real EPS/FCF → US valuation differentiates).
# HK fundamentals need a paid FMP plan or another HK source.
FMP_API_KEY=

# Web evidence — optional; without it Luvio uses DuckDuckGo/Yahoo/Bing (404-checked).
# Tavily free tier is 1000/mo: https://tavily.com
TAVILY_API_KEY=
SERPAPI_API_KEY=
```

---

## Status

**Working:** HK + US research conversation · market-aware quotes & fundamentals · US real profit-quality scores · intent routing (incl. financial-quality & falsification) · evidence provenance with URL validation · confidence chips · valuation range + odds · Markdown export · smooth per-company sessions · single-pass chat (one model call, one DB write) · SQLite history · Apple-grade UI.

**Next:** `TAVILY_API_KEY` for stable web coverage · paid/alternate HK fundamentals · HKEX & IR PDF ingestion · consensus estimates & comps · deploy-ready auth.

---

## Product Direction

Make Luvio feel like a calm investment research desk: ask one good question, get a useful judgment, see what it rests on, know what could prove it wrong, and keep the conversation going — across HK and US — without losing the thread.

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Data Pipeline](docs/DATA_PIPELINE.md)
- [Data Source Strategy](docs/DATA_SOURCE_STRATEGY.md) · [Product Requirements](docs/PRD.md)
- [Platform Benchmark](docs/PLATFORM_BENCHMARK.md) · [AI Integration](docs/AI_INTEGRATION.md) · [GitHub Workflow](docs/GITHUB_WORKFLOW.md)

---

## License

Private research prototype. License to be decided.
