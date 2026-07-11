# Echo Research

**An AI research desk for Hong Kong, US & A-share equities.**

> Seek signal. Ignore noise. — 喧声之外，见真知。

Echo Research is a quiet, analyst-style workspace for asking better questions about public companies — in **HK, US and A-share (沪深) markets**. It is built around one continuous conversation: start with a company, ask what matters, inspect the evidence, and turn scattered market information into a judgment you can revisit.

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

Echo Research covers **Hong Kong and US listings**, plus a **staged core universe of A-share (沪深) names** — large-cap technology, internet, consumer, financial, semiconductor and infrastructure names, with A-share coverage focused on 主板/创业板 (main board + ChiNext) leaders rather than the full 5,000+ market.

The look is deliberate: warm kraft-paper surfaces, ink type, a terracotta accent, and calm motion — a research journal, not a trading terminal.

---

## Product Experience

Ask in plain language, in either market:

```text
腾讯最近怎么样？        # HK by name
AAPL 赚钱吗？           # US by ticker
英伟达的护城河在哪？     # US by Chinese name
贵州茅台赚钱吗？        # A-share by name
比亚迪 vs 特斯拉 哪个赔率好？
```

Then continue naturally — `它靠什么赚钱？` / `护城河是什么？` / `什么情况会证伪？`. The system keeps the company context, adapts the format to the question (focused follow-ups get focused answers), and never restarts the whole report each turn.

Company resolution is layered, so almost any name works: a built-in **Chinese/English alias table** (`美光` / `Micron`, `博通`, `礼来`, …), an **FMP name-search** for English/pinyin (`Robinhood` → `HOOD`, `Coinbase` → `COIN`), and an **LLM resolver** that maps a free-form Chinese name to the right ticker and **verifies it against FMP** before trusting it (`泛林集团` → `LRCX`, `商汤` → `0020.HK`). Explicit notation always works too (bare `AAPL`, `$NVDA`, `TSLA.US`, `0700.HK`).

**Honest about what it can't resolve.** If a question names a company Echo Research genuinely can't pin to a ticker, it says so and asks for a code — it will **never silently answer as the previously-open company**. A-share names outside the current staged universe are recognized as real companies but honestly flagged as not-yet-covered, rather than silently guessed at. Follow-ups (`护城河是什么？` / `估值贵不贵？`) are understood as questions about the current company, not mistaken for new ones.

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

A single `src/market.js` layer knows whether a ticker is HK, US or A-share (CN) and spells it correctly for every provider:

- **HK quotes** → Tencent Finance (free), with Finnhub / Alpha Vantage / Yahoo fallback.
- **US quotes** → Finnhub / Alpha Vantage / Yahoo.
- **A-share quotes** → Tencent Finance + Sina Finance (both free, no key), raced for the fastest response.
- **Fundamentals** → FMP `/stable` when the plan allows it, else **Finnhub `/stock/metric`** (free: EPS / PE / margins / ROE / growth), then Yahoo. HK falls back to Tencent/Yahoo basics. A-share fundamentals come from the first-party CNINFO filing pipeline below (FMP/Finnhub/Alpha Vantage don't cover A-shares on the free tier).
- **Company news** → Finnhub `/company-news` (free, keyed, reliable) as the primary source, with Yahoo / Bing scraping as supplement.
- Currency is inferred per market (USD / HKD / CNY).

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

### First-party filings pipelines (HK + A-share)

For HK names, an ingestion pipeline pulls HKEX results-announcement PDFs, extracts the key financial tables (revenue / profit / operating cash flow), and structures them into the same financial-snapshot shape the rest of the app reads — closing the biggest data gap on the HK side. US first-party filings route through SEC EDGAR (8-K / 10-Q / 10-K, free, no key). For A-share names, an equivalent pipeline pulls periodic reports (annual / quarterly / semi-annual) from CNINFO (巨潮资讯网, the official SSE/SZSE-designated disclosure platform), parsing the standardized statutory line items — real-world testing against a 66-company seed universe reached first-party data for 91% of names.

### Event digest

An on-demand pre-/after-market digest for the companies you research or hold. Events are pulled from the earnings calendar, major news and position discipline, then **graded** (🔴 high / 🟡 medium / ⚪ low), **grouped by company**, and de-noised: law-firm class-action wire spam is dropped, and a **relevance gate** keeps a company's feed about *that* company. Failures are surfaced honestly — you can tell "nothing happened" apart from "couldn't fetch".

### Proactive scheduler & notifications

A scheduler runs pre-/after-market digests and watch-rule checks on a cadence and writes to a local notification centre (bell + unread count), so the highest-value moments — the open, a breached stop — don't depend on you having the tab open.

### Portfolio ledger

Record holdings in plain language (`耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5`) or add/edit them manually. The portfolio panel shows **live price, market value, unrealized P&L (¥/%), and distance to your stop / take lines** per position; the event digest watches those lines and flags large drawdowns.

### Company portrait (long-term memory)

Each researched company accretes a **portrait document**: a Markdown master file (key metrics, moat, risk ledger) plus an event timeline that records *changes* — with reasons, evidence links, and a jump back to the session where the view shifted. It renders on the company page and exports.

### Local research memory

Sessions persist in SQLite (thread, company, decision panel, valuation, sources, generated content) — an iterative research notebook, not a disposable chat. Each turn's answer keeps its own meta (valuation bar, evidence cards, confidence chip), so reopening a past session **renders exactly like the live answer**. A full-text search box over the whole history (SQLite FTS5, trigram-tokenized so Chinese substrings work without word segmentation) answers "which of my past research touched liquid cooling?" directly from the sidebar — kept in sync automatically via DB triggers, no separate indexing step. The whole database is snapshotted daily with an integrity check on the backup itself, not just on write.

### Anti-hallucination guard (factGuard)

Every number the model writes in an answer is checked against a **facts registry** built from the same grounded data that fed the prompt (price, financials, valuation, comp peers, earnings calendar, position) — amounts, percentages, multiples and dates each get their own tolerance band. A mismatch is classified **pass / soft (unverified, not blocked) / hard** (wrong sign, an order of magnitude off, a date that doesn't exist, a currency mismatch after conversion); the rule is deliberately biased toward **under-reporting rather than over-reporting** false positives. Every verification run — not just the misses — is logged (`fact_guard_audit`), aggregated into a rolling hard/soft hit-rate on the settings page, and used as the real evidence gate before the guard is ever promoted from `shadow` (log-only) toward `soft` (visible caveat) or `full` (blocking).

### Earnings closed loop

The earnings calendar doesn't just tell you when the next print lands — after it lands, a scheduler task pulls the actual EPS, compares it to the pre-print consensus, and writes the beat/miss straight into the company portrait timeline and the research scorecard (see below). HK names route through their US ADR for the actual (`0700.HK` → `TCEHY`) when a mapping exists; when the data genuinely isn't available (e.g. free-tier revenue actuals) it says so instead of estimating.

### Structured falsification conditions

Beyond the price-based stop/target lines, the model is asked to output **machine-checkable fundamental falsifiers** at the end of its own reasoning (e.g. "revenue growth below X%", "gross margin below Y%") from a whitelist of six independently-verifiable metrics. These are parsed, validated, stripped from the visible answer (so the raw directive never leaks into the chat bubble), and stored alongside the price watch rules. When the next earnings print lands, the same closed-loop task checks them against real financials and fires a notification if one triggers — turning "what would prove me wrong" from a sentence that's forgotten into a condition that's actually checked.

### Research scorecard & review

Every completed research answer leaves a snapshot (ticker, verdict, valuation band, falsification lines). A scorecard aggregates these into a beat-rate and a "did the thesis hold" review per ticker and globally, with an honest sample-size floor — a scorecard with two data points says "not enough samples yet," it doesn't fake a percentage. Visible on the company portrait page and the settings page.

### Shareholder-return signals

- **US** — SEC Form 4 filings are parsed directly (not the pretty rendered view SEC also serves at a similar-looking URL — the two are easy to confuse and only one is machine-readable) for the last 180 days of real open-market insider buying/selling, excluding option exercises, tax withholding and equity grants, so a routine RSU vest is never counted as an "insider buy".
- **HK** — HKEX's daily "next-day disclosure return" buyback filings are parsed for real on-exchange repurchases (shares, price range, total consideration) plus the issued-share count reported in the same filing, giving a rough share-count trend (explicitly labelled as lagging — cancellation isn't instant, so this is a coarse trend, not a live net-buyback counter).

### Historical valuation percentile

Where the current multiple sits against the company's **own trailing history** (not just against peers) — using each fiscal year-end's trailing PE as the sample set, labelled as an approximate methodology (annual snapshots, not a daily distribution) since that distinction matters for how much weight to put on the number. Insufficient history (under five fiscal years) degrades honestly to "not enough data" rather than forcing a percentile out of two data points.

### Model safety

Structured-output validation with one repair pass and a safe local fallback. No buy/sell/hold instructions — only research judgments, monitoring conditions and risk checkpoints.

### Invite-only multi-user beta

Echo Research now includes password authentication, one-time invite codes, signed HttpOnly sessions, CSRF checks, per-user private research/portfolio/watch data, daily model quotas, usage and cost visibility, onboarding, notification preferences, and in-app feedback. Existing single-user databases migrate non-destructively to the owner account.

The public edge is deployment-ready for a single HK/SG VPS: Caddy TLS, loopback-only Node service, systemd sandboxing, verified local backups with optional off-site replication, static-file allowlisting, request-size limits, and per-IP/per-user rate limiting. Production readiness can be checked with `npm run doctor:prod`.

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
│   ├── market.js                  # HK/US/CN detection + per-provider symbol mapping
│   ├── data.js marketData.js financialData.js newsData.js filingData.js
│   ├── fmpClient.js secFilings.js documentParser.js prompts.js
│   ├── server/
│   │   ├── routes/                # chat · discover · companies · research (incl. FTS
│   │   │                          #   search) · reports · documents · events · portfolio ·
│   │   │                          #   portraits · watch · notifications · hkFinancials · status
│   │   ├── services/              # agentService · answerComposer · valuationEngine ·
│   │   │                          #   financialQuality · webEvidenceService · eventEngine ·
│   │   │                          #   companyPortrait · discovery · intentClassifier ·
│   │   │                          #   twoStageChat · scheduler · notifier · riskEngine ·
│   │   │                          #   hkFilingsPipeline · modelGateway · decisionPanel ·
│   │   │                          #   factGuard · earningsCalendar · falsifyRules ·
│   │   │                          #   insiderActivity · historicalValuation · researchReview ·
│   │   │                          #   dbBackup · …
│   │   ├── repositories/          # SQLite access (sessions, profiles, portfolio, watch,
│   │   │                          #   insiderActivity, hkBuyback, historicalValuation,
│   │   │                          #   factGuardAudit, researchSnapshots, …)
│   │   ├── schemas/               # structured-output validation
│   │   └── utils/                 # time anchoring, async, env
│   ├── data/                      # HK stock seed data
│   └── db/
│       ├── migrations/            # numbered, additive SQL migrations (see docs/DATABASE.md)
│       └── migrate.js             # `PRAGMA user_version`-based migrator, runs on boot
├── scripts/                       # seed-db, doctor, canary, hk-coverage, one-off migrations
├── tests/                         # smoke · reliability · phase3/4/6/7 · notifications ·
│                                  # phase-b/d/ea/g/r/f/p7 (one file per shipped phase)
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

**Working:** A/H/US research conversation · dual-listing routing · discovery layer (screener + macro) · market-aware quotes & first-party filings · evidence provenance · data-grounding and confidence · valuation range and odds · analyst consensus · structured streaming answers · event digest · scheduler and notification centre · earnings/falsification closed loops · factGuard shadow audit · research scorecard · portfolio and watch desk · company portraits · Markdown and branded PNG export · FTS5 history search · verified backups · responsive light/dark UI · invite-only authentication · per-user isolation, quotas and usage · onboarding, preferences and feedback · hardened single-VPS deployment assets.

**Next:** run the free invite-only beta on an actual HK/SG VPS · obtain commercial licenses for quote/news data before charging or public promotion · promote factGuard from `shadow` only after real misclassification metrics support it · prioritize P15/P16/R13–R16 and PWA from observed beta feedback. See the plan docs below.

### Commercialization boundary

The application architecture is ready for a small commercial beta, but the bundled Tencent/Sina public-market routes are **not a commercial data license**. Keep this build free, invite-only, and non-public until licensed quote/news sources are configured. Model, search, data-provider, VPS, domain, privacy-policy, and incident-response costs/obligations remain operator responsibilities.

---

## Documentation

- **[主计划（愿景 + 分阶段路线图 + 历史记录 + 接手协议）](docs/PLAN.md)** ← start here to contribute
- [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Data Pipeline](docs/DATA_PIPELINE.md)
- [Data Source Strategy](docs/DATA_SOURCE_STRATEGY.md) · [Product Requirements](docs/PRD.md)
- [AI Integration](docs/AI_INTEGRATION.md) · [GitHub Workflow](docs/GITHUB_WORKFLOW.md)

---

## License

Proprietary source code. No permission is granted to copy, redistribute, host, or sell this software without the copyright holder's written authorization. Market data and third-party content remain subject to their providers' terms.
