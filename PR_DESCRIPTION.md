# Pristine refactor + HK/US global research platform

`cleanup/pristine-refactor` → `main` · 9 commits · 39 files (+2.9k / −2.7k)

Rebuilds Luvio from a HK-only prototype into a clean, **HK + US** AI research platform: trustworthy evidence, real US fundamentals and valuation/odds — on an Apple-grade UI, with smooth per-company sessions.

## Highlights

- **Global (HK + US).** New `src/market.js` detects market per ticker and spells the symbol for every provider (+ currency). US quotes route to Finnhub/Alpha Vantage/Yahoo; **US fundamentals use bare FMP `/stable` symbols → free tier returns real EPS/FCF/margins**, so US names get a real profit-quality score (e.g. AAPL 83/100) and a valuation range. HK keeps the free Tencent path and degrades gracefully (FMP free is premium-gated for HK).
- **Pristine codebase.** Deleted the dead `src/agent/` engine and unused routes (`agent`, `watchlist`, `web-research`, `market-data`, legacy `/api/report`); `server.js` now mounts only the 6 endpoint groups the UI uses. Split the 747-line `chat.js` into a thin route + `services/answerComposer.js` (117 lines).
- **Single-pass chat.** One parallel data+evidence collection, **one model call**, one DB write (was two model calls racing tight timeouts → always fell back to local). Fixed intent routing (colloquial “赚钱吗” → `financial_quality`, new `falsify`) and wired the previously-dead `financialQuality` engine.
- **Trustworthy evidence.** `webEvidenceService` now: Tavily/SerpAPI (or keyless DuckDuckGo/Yahoo/Bing) → **URL validation (drops only confirmed 404/410)** → junk/homepage filter → Readability-lite body extraction → credibility scoring → cache → merged into the decision panel. No more dead links or `qq.com` homepages.
- **Trust & insight UI.** Clickable evidence provenance cards (source-type badge + credibility dot), confidence chips, a **valuation range bar + reward:risk odds** (with a self-consistent guard so it never misleads), Markdown export, and **smooth company switching** — naming a new company mid-chat opens a fresh, isolated session for it.
- **Honest UX.** Gap/backend language removed from answers (judgment first, “还缺什么” folded at the end); the fake 4-step waiting card replaced with a calm indicator; settings/status copy states real coverage limits.

## Validated

- `npm test` green (smoke + reliability + phase3).
- US end-to-end: AAPL → Finnhub quote (USD) + FMP real financials (`ok`) + valuation + 8 Tavily evidence items.
- HK end-to-end: 0700.HK → Tencent (HKD) + 8 evidence items, no regression.

## Notes for reviewers / ops

- FMP **free tier covers US only**; HK full statements need a paid plan or HKEX PDF parsing. FMP v3 endpoints were deprecated (2025-08-31) and migrated to `/stable`.
- Optional keys (`.env`, gitignored): `DEEPSEEK_API_KEY` (model), `FMP_API_KEY` (US fundamentals), `TAVILY_API_KEY` (web evidence). The app runs without any key via local fallback.

## Commits

```
275fa58 Refactor to pristine build: cleanup, single-pass chat, Apple-grade UI
697eff7 Research quality: trustworthy sources, model reports, honest waiting
034d361 P2/P3: web research agent + evidence provenance, confidence, export
b7b4931 Always-on provenance + stronger content extraction
32887d9 Valuation range + reward/risk odds visualization
15347da Multi-company compare + coherent valuation guard
d25652b Compare covers all companies + odds feed the model + FMP-ready
eb63b2f FMP: migrate dead v3 endpoints to the stable API; honest HK coverage note
6122388 Go global: HK + US equities platform
```
