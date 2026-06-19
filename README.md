# Luvio

**An AI research console for Hong Kong equities.**

Luvio is a quiet, analyst-style research workspace for asking better questions about public companies. It is designed around one continuous conversation: start with a company, ask what matters, inspect the evidence, and turn scattered market information into a judgment you can revisit.

It is not a trading signal machine. It is closer to a patient research partner: direct, skeptical, source-aware, and comfortable saying what is known, what is inferred, and what still needs to be verified.

---

## Why Luvio Exists

Most investing tools are built around noise: price flashes, chart widgets, crowded dashboards, and generic AI summaries.

Luvio takes the opposite direction.

It tries to answer a simpler question:

> If I were sitting with a sharp research analyst, what would I expect them to tell me about this company right now?

That means the product is optimized for:

- **clear thinking over busy screens**
- **evidence before confidence**
- **continuous follow-up instead of disconnected reports**
- **plain-language financial reasoning**
- **visible data gaps instead of fake certainty**

The first product focus is Hong Kong-listed companies, especially large-cap technology, internet, consumer, financial, and infrastructure names.

---

## Product Experience

Luvio opens as a clean research room.

You ask:

```text
阿里巴巴最近怎么样？
```

Then continue naturally:

```text
它主要靠什么赚钱？
护城河是什么？
利润还能不能修复？
什么情况会证伪？
```

The system keeps the company context, avoids restarting the whole report every time, and adapts the answer format to the question. A broad company question can produce a structured research view; a focused follow-up gets a focused analyst response.

Current interaction principles:

- one research conversation, not scattered pages
- lightweight Apple-style white interface
- source links rendered as clickable references
- waiting state with elapsed seconds, so the user is not left staring at silence
- answer cards with copy action for saving useful research notes
- historical research stored locally and restorable from SQLite

---

## Core Capabilities

### Research Conversation

Luvio identifies the company, keeps context, and responds like an analyst rather than a template generator.

It can distinguish between:

- general company status
- business model questions
- moat and competitive advantage questions
- valuation pressure
- operating quality
- risk and falsification conditions
- deep research mode

### Evidence-Aware Reasoning

Every serious answer is built around three layers:

1. **Facts**: market data, company profile, filings, financials, local documents, and available sources.
2. **Inference**: business model, profit pool, industry structure, risk, and valuation logic.
3. **Gaps**: missing financials, missing consensus, incomplete announcements, or unavailable web evidence.

When data is missing, Luvio should not stop thinking. It lowers confidence, names the gap, and still gives a reasoned interim judgment.

### Local Research Memory

Research sessions are persisted in SQLite, including:

- conversation thread
- selected company
- decision panel
- generated research content
- uploaded document references

This makes the product usable as an iterative research notebook rather than a disposable chat window.

### Data Foundation

The project includes a seeded Hong Kong equity database with 650+ companies and richer local portraits for selected names.

Current backend modules support:

- company search
- ticker normalization
- market snapshot lookup
- company profiles
- financial quality analysis
- valuation scaffolding
- risk radar
- document persistence
- research session persistence
- model gateway with local fallback

### Model Safety And Reliability

The research engine uses structured output validation where appropriate. If model output breaks the expected schema, the backend attempts repair and falls back safely when needed.

The product deliberately avoids direct buy/sell/hold instructions. It frames outputs as research judgments, monitoring conditions, and risk checkpoints.

---

## Architecture

```text
Luvio
├── index.html              # Single-page app shell
├── server.js               # Node server entry
├── src/
│   ├── app.js              # Frontend interaction layer
│   ├── styles.css          # Apple-white research UI
│   ├── data/               # HK stock seed data and company profiles
│   ├── server/             # API routes, persistence, model gateway
│   └── research/           # Financial quality, valuation, risk logic
├── scripts/
│   └── seed-db.js          # SQLite database seeding
├── tests/                  # Smoke, reliability, phase tests
└── docs/                   # Product, architecture, data-source notes
```

The frontend is intentionally simple: no heavy framework, no unnecessary UI surface. The core product value is in the research flow, backend reasoning, and data architecture.

---

## Local Setup

Install dependencies:

```bash
npm install
```

Seed the local database:

```bash
npm run seed
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:4173
```

Run tests:

```bash
npm test
```

---

## Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Optional model and data providers can be configured in `.env`.

```text
OPENAI_API_KEY=
OPENAI_MODEL=

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=

FMP_API_KEY=
FINNHUB_API_KEY=
ALPHAVANTAGE_API_KEY=
TWELVEDATA_API_KEY=
```

If no model key is configured, Luvio still runs with local fallback responses for development and UI testing.

---

## Current Status

Luvio is an early research product prototype.

What already works:

- clean single-room research UI
- company recognition and context retention
- focused follow-up answers
- deep research generation path
- SQLite-backed research history
- local company database
- document upload persistence
- model fallback behavior
- test coverage for core backend reliability

What is still being built:

- stronger live web search agent
- more complete financial statement ingestion
- HKEX and IR announcement pipelines
- consensus estimates and valuation comps
- richer source ranking and citation confidence
- deploy-ready production auth and user accounts

---

## Product Direction

The goal is not to become another dashboard.

The goal is to make Luvio feel like a calm investment research desk:

- ask one good question
- receive a useful judgment
- see what the judgment rests on
- know what could prove it wrong
- continue the conversation without losing the thread

In the long run, Luvio should help users build a repeatable research process, not just generate beautiful text.

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Data Pipeline](docs/DATA_PIPELINE.md)
- [Data Source Strategy](docs/DATA_SOURCE_STRATEGY.md)
- [Product Requirements](docs/PRD.md)
- [Platform Benchmark](docs/PLATFORM_BENCHMARK.md)
- [AI Integration](docs/AI_INTEGRATION.md)
- [GitHub Workflow](docs/GITHUB_WORKFLOW.md)

---

## License

Private research prototype. License to be decided.
