# Echo Research Data Pipeline

How real-time and reference data flows through the system.

## Data tiers

市场（HK/US）由 `src/market.js → detectMarket` 判定，决定每个 tier 用哪个 provider 及 symbol 拼法。

| Tier | Data | Source | Frequency | Storage |
|------|------|--------|-----------|---------|
| **Tier 0** | Company universe (ticker, name, sector) | `src/data/hkStocks.js` + seed（港股）；美股按 ticker 即时建档 | One-time / on-demand | `luvio.db → companies` |
| **Tier 1** | Detail profiles (summary, risks, moat) | `src/data.js`（港股精选档案） | Per-profile | `luvio.db → company_details` |
| **Tier 2** | Market data (price, PE, currency) | 港股 Tencent；美股 Finnhub/Alpha Vantage/Yahoo | On-demand, cached | `luvio.db → market_snapshots` |
| **Tier 3** | Financial statements | **美股 FMP `/stable`（真三表）**；港股回退腾讯/Yahoo 基础 | On-demand | In-memory (`src/financialData.js`) |
| **Tier 4** | Web evidence | Tavily / SerpAPI →（无 key）DuckDuckGo/Yahoo/Bing；URL 校验+正文抽取+可信度 | On-demand, cached | `luvio.db → web_evidence` |
| **Tier 5** | News & filings | External APIs / HKEX | On-demand | In-memory |
| **Tier 6** | Research sessions | Single-pass chat output | Per conversation | `luvio.db → research_sessions` + localStorage |

## Current data flow

```
User enters query in homepage
        │
        ▼
  POST /api/agent  (sends question, company, history, memory)
        │
        ├──▶ getCompanyByTicker(ticker)    ← DB query (src/db/index.js)
        ├──▶ getMarketSnapshot(ticker)     ← API call (src/marketData.js)
        ├──▶ getNewsSnapshot(ticker)       ← API call (src/newsData.js)
        ├──▶ getFinancials(ticker)         ← API call (src/financialData.js)
        └──▶ Agent processes → LLM call → JSON response
                │
                ▼
        saveSession() to DB
        render() research workspace
```

## Real-time data

### Current real-time sources

| Endpoint | Source | Status | Coverage |
|----------|--------|--------|----------|
| `GET /api/market` | Tencent Finance (free) / FMP / Alpha Vantage / Twelve Data | Free tier available | All listed HK stocks |
| `GET /api/financials` | Financial Modeling Prep | Requires FMP_API_KEY | ~80% of HK exchange |
| `GET /api/news` | News API / Finnhub | Requires API key | Major stocks only |
| `GET /api/filings` | Local parsing / HKEXnews | Manual upload | User-dependent |

### How to add a new data provider

1. Create a new file in `src/` (e.g., `src/eodhdData.js`)
2. Export a function that takes a ticker and returns normalized data
3. Add the API endpoint in `server.js` or integrate into the agent tool

The normalised format for market data:

```js
{
  source: "provider_name",
  ticker: "0700.HK",
  currency: "HKD",
  price: 380.0,
  previousClose: 377.5,
  change: 2.5,
  changePercent: 0.66,
  open: 378.0,
  high: 382.0,
  low: 376.5,
  volume: 15000000,
  marketCap: 3600000000000,
  pe: 18.5,
  dividendYield: 1.1,
  week52High: 430.0,
  week52Low: 260.0,
  asOf: "2026-06-17T00:00:00Z",
  providerStatus: "ok"
}
```

## Target architecture (full coverage)

When the project moves to full real-time data coverage:

```
┌─────────────────────────────────────────────────────────┐
│                     Data Pipeline                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Scheduled Jobs (cron / GitHub Actions)                   │
│  ┌─────────────────────────────────────┐                 │
│  │ Daily: fetch_all_market_data()      │                 │
│  │ Daily: fetch_all_financials()       │  →  luvio.db    │
│  │ Weekly: fetch_all_news()            │                 │
│  │ Monthly: rebalance_universe()       │                 │
│  └─────────────────────────────────────┘                 │
│                                                          │
│  On-demand (API calls from server.js)                    │
│  ┌─────────────────────────────────────┐                 │
│  │ GET /api/market → DB cache check    │                 │
│  │   → if stale (>15 min) → fetch API  │  →  luvio.db    │
│  │   → return cached                   │                 │
│  └─────────────────────────────────────┘                 │
│                                                          │
│  Company Universe Management                             │
│  ┌─────────────────────────────────────┐                 │
│  │ hkStocks.js (editable source of      │                 │
│  │ truth for universe composition)      │  → seed-db.js   │
│  │ npm run seed → luvio.db             │  →  luvio.db    │
│  └─────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

### Adding new companies

**Short-term (current):**
1. Edit `src/data/hkStocks.js` — add an entry for the new company
2. Run `npm run seed`
3. The company is now searchable and available for research

**Medium-term (with comprehensive detail profiles):**
1. Same as above, plus add a `detailOverrides` entry in `src/data.js`
   with aliases, summary, risks, business model, etc.
2. Re-seed to merge the rich profile into `company_details`

**Long-term (API-sourced universe):**
1. The seed script fetches from a HK stock universe API
2. Detail profiles are gradually built from research output
3. Community contributions via pull request to `hkStocks.js`

### Caching strategy

- **Market data**: Cache in `market_snapshots` table per ticker. Invalidated
  after 15 minutes (trading hours) or 4 hours (closed market).
- **Company profiles**: Stored in `company_details`. Updated when new research
  is done on that company. No automatic expiry.
- **Financial data**: Currently fetched on-demand from FMP. In the future,
  cache quarterly snapshots in a `financial_data` table.

## Integration with agent tools

The agent calls tools that are backed by both the local DB and external APIs:

| Agent tool | Data source | DB-backed? |
|------------|-------------|------------|
| `get_company_profile` | DB (`companies` + `company_details`) + FMP | ✅ Yes |
| `get_market_data` | `market_snapshots` cache + external API | ✅ Reads cache |
| `get_financial_data` | FMP API | ❌ Currently live |
| `get_news_and_filings` | News API + HKEXnews | ❌ Currently live |

The DB module at `src/db/index.js` exposes all query functions. As more data
sources are added, the DB should become the primary data layer with APIs as
the fallback/update mechanism.

## Future roadmap

1. ✅ Company universe of 500+ HK stocks
2. ✅ SQLite database for persistent storage
3. ⬜ Scheduled data refresh (cron / GitHub Actions)
4. ⬜ Financial data caching in DB
5. ⬜ News aggregation and caching
6. ⬜ Real-time price feed via WebSocket
7. ⬜ HKEX filings auto-fetch
8. ⬜ Full HK exchange coverage
9. ⬜ A-share / US stock cross-reference
