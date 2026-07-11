# Echo Research Database Guide

Echo Research uses **SQLite** (via `better-sqlite3`) as its local database for company data,
market snapshots, and research sessions. The DB file is `luvio.db` at the project root.

## Why SQLite

- **Zero config** — no server, no daemon, no connection pool.
- **File-based** — `luvio.db` is created on first seed; can be copied, backed up, or reset trivially.
- **Synchronous API** — `better-sqlite3` provides simple `db.prepare(sql).run()` semantics.
- **Adequate for ~500–2000 companies** — SQLite handles this scale easily.
- **No external dependency** — the DB file travels with the repo (excluded from git via `.gitignore`).

## Schema

### `companies`

| Column | Type | Notes |
|--------|------|-------|
| `ticker` | TEXT PK | Normalized HK ticker, e.g. `0700.HK` |
| `name_zh` | TEXT NOT NULL | Chinese name, e.g. `腾讯控股` |
| `name_en` | TEXT | English name |
| `sector` | TEXT | Sector classification in Chinese |
| `industry` | TEXT | Sub-industry |
| `listing_status` | TEXT | `active`, `delisted`, `suspended` |
| `exchange` | TEXT | Default `HKEX` |
| `currency` | TEXT | Default `HKD` |
| `is_hsi` | INTEGER | `1` = Hang Seng Index constituent |
| `market_cap_category` | TEXT | `large`, `mid-large`, `mid`, `small` |
| `created_at` | TEXT | Auto-set on insert |
| `updated_at` | TEXT | Auto-set on insert |

### `company_details`

One-to-one with `companies` via `ticker` FK. Stores the rich research profiles
that were previously hardcoded in `src/data.js`.

| Column | Type | Notes |
|--------|------|-------|
| `ticker` | TEXT PK + FK → companies | |
| `aliases` | TEXT | JSON array of alternative names |
| `price` | REAL | Reference price (not live) |
| `market_cap` | TEXT | Human-readable cap string |
| `week_52_range` | TEXT | e.g. `"260 - 430"` |
| `dividend_yield` | TEXT | |
| `pe` / `pb` / `ps` | TEXT | Valuation multiples |
| `latest_report` | TEXT | Latest financial report period |
| `status` | TEXT | Research status label |
| `status_tone` | TEXT | `good`, `steady`, `watch`, `warn` |
| `summary` | TEXT | JSON array of summary paragraphs |
| `business_model` | TEXT | JSON array |
| `metrics` | TEXT | JSON array of [label, analysis, focus] tuples |
| `moat` | TEXT | JSON array of competitive advantage points |
| `management` | TEXT | JSON array |
| `risks` | TEXT | JSON array of risk factors |
| `bull_case` / `bear_case` | TEXT | JSON arrays |
| `monitors` | TEXT | JSON array of monitor items |
| `official_sources` | TEXT | JSON array of `{label, url}` |

### `market_snapshots`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `ticker` | TEXT FK → companies | |
| `price` / `previous_close` / `change` / `change_percent` | REAL | |
| `open` / `high` / `low` | REAL | |
| `volume` | INTEGER | |
| `market_cap` | REAL | Numeric market cap |
| `pe` / `dividend_yield` | REAL | |
| `week_52_high` / `week_52_low` | REAL | |
| `source` | TEXT | Data provider name |
| `as_of` | TEXT | ISO timestamp of the data point |
| `created_at` | TEXT | When stored |

Indexed on `(ticker, as_of)`.

### `research_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID-style session ID |
| `ticker` | TEXT FK → companies | |
| `title` | TEXT | Sidebar/history title, usually the first user question |
| `question` | TEXT | Latest research question in the session |
| `status` | TEXT | `draft`, `in_progress`, `completed` |
| `report_markdown` | TEXT | Full research report |
| `rating` | TEXT | Investment rating |
| `confidence` | TEXT | High / Medium / Low |
| `decision_panel` | TEXT | Serialized structured research panel |
| `full_research` | TEXT | Latest assistant answer / long-form research |
| `data_sources` | TEXT | Serialized source health snapshot |
| `thread_json` | TEXT | Serialized conversation messages for restore |
| `turn_count` | INTEGER | Number of user turns in the session |
| `created_at` / `updated_at` | TEXT | |

Indexed on `(ticker)`.

## Usage

### Query companies

```js
import { getCompanyByTicker, findCompanies, getCompaniesBySector } from "./src/db/index.js";

// Get a single company with its rich profile
const company = getCompanyByTicker("0700.HK");
console.log(company.nameZh);  // "腾讯控股"
console.log(company.summary); // Array of paragraphs

// Fuzzy search
const results = findCompanies("腾讯");

// Group by sector (for watchlist, portfolio page)
const bySector = getCompaniesBySector();
```

### Market data

```js
import { getLatestMarketSnapshot, saveMarketSnapshot } from "./src/db/index.js";

// Read
const snap = getLatestMarketSnapshot("0700.HK");

// Write (after fetching from API)
saveMarketSnapshot({
  ticker: "0700.HK",
  price: 380.0,
  change: 2.5,
  changePercent: 0.66,
  source: "tencent",
  asOf: new Date().toISOString()
});
```

### Research sessions

```js
import { saveResearchSession, listResearchSessions, getResearchSession } from "./src/server/repositories/researchSessions.js";

// Save or update after an agent run. Passing the same id updates the same conversation.
saveResearchSession({
  id: "session_abc123",
  ticker: "0700.HK",
  title: "腾讯最近怎么样？",
  question: "腾讯的护城河是什么？",
  status: "completed",
  reportMarkdown: "# 研究结论\n...",
  researchStatus: "watch",
  confidence: "中",
  thread: [
    { role: "user", content: "腾讯最近怎么样？" },
    { role: "assistant", content: "北京时间..." },
    { role: "user", content: "护城河怎么样？" },
    { role: "assistant", content: "结论..." }
  ]
});

// Get recent 10 sessions
const recent = listResearchSessions({ limit: 10 });

// Restore one conversation
const session = getResearchSession("session_abc123");
console.log(session.thread);
```

## Managing the company universe

### Adding new companies

Edit `src/data/hkStocks.js` and add entries in this format:

```js
["NEW.HK", "公司中文名", "Company English Name", "行业分类", "子行业", 0],
```

Then re-seed:

```bash
npm run seed
```

The seed script is **idempotent** — re-running it updates existing records and
inserts new ones. Detail overrides from `src/data.js` are merged automatically
for companies that have a rich profile defined there.

### Future: External data source

When the company universe becomes too large to maintain in `hkStocks.js`,
the seed script can be extended to fetch from an API:

1. Add a `fetchCompanyList()` function in `scripts/seed-db.js`
2. It should return the same `[ticker, nameZh, nameEn, sector, industry, isHsi]` format
3. The data is upserted into the `companies` table

## Data directory layout

```
src/
  db/
    index.js          ← Database connection, schema init, query functions
  data/
    hkStocks.js       ← 650+ HK company records (the stock universe)
    data.js           ← Legacy: 35 companies + rich detail overrides
scripts/
  seed-db.js          ← CLI seed script
luvio.db              ← SQLite database (gitignored)
```

## Performance notes

- Querying by `ticker` (PK lookup) is sub-millisecond.
- Fuzzy search via `LIKE` on 650 rows is under 5ms.
- The `market_snapshots` table grows linearly with API calls; consider
  a retention policy (keep last 30 days) if this becomes large.
- WAL mode is enabled for better concurrent read performance.
