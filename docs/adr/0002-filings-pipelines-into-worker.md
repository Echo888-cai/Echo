# ADR 0002 — 一手 filing 管道物理迁入 apps/worker（R-4 收尾片）

**日期**：2026-07-13
**状态**：已实施
**背景**：docs/REFACTOR_PROPOSAL.md §5 R-4 行；docs/adr/0001-data-plane-adapter-matrix.md「未决」第二条

## 背景

ADR-0001 收尾时留了一条明确待办：`cnFilingsPipeline.js` / `hkFilingsPipeline.js`（合计 1300+ 行）**运行时**已经在 R-2 完成的 worker 分离里跑在 `apps/worker` 进程中（`processor.ts` 的 `processJob()` 执行 `scheduler.js` `JOBS[].run()`，间接调用这两个管道），但**代码物理位置**还留在 legacy 的 `src/server/services/` 下。ADR-0001 当时判断这是纯代码组织问题、没有运行时收益，但引用面广，留给有完整时间预算的会话专门做。本片就是那次专门的会话。

## 决定

**把两个文件原样搬进 `apps/worker/src/pipelines/`，只改相对 import 路径，不改一行逻辑。**

具体动作：

1. `git mv src/server/services/{cn,hk}FilingsPipeline.js apps/worker/src/pipelines/`——保留 git 历史（`git log --follow` 可追溯到搬迁前）。
2. 两个文件内部的相对 import 深度从 `src/server/services/`（距仓库根 3 层）变成 `apps/worker/src/pipelines/`（距仓库根 4 层），因此：
   - `PROJECT_ROOT = join(here, "..", "..", "..")` → 加一层 `"..",` ，否则 `EXTRACT_SCRIPT`/`CACHE_DIR` 会指向 `apps/` 而不是仓库根，`scripts/extract_pdf_text.py` 和 `.cache/filings/` 全部找不到。
   - 对 `market.js`/`data.js`（数据平面仍是纯函数，未迁移）以及 `src/server/repositories/*Repository.js`（DB 访问层，走 `src/db/index.js` 的 better-sqlite3，R-1 的 Postgres 化还没发生）的 import，一律改成从新位置出发的相对路径（`../../../../src/...`）。**这两个文件的真正依赖——数据库、repositories、PDF 抽取脚本——都没有搬**，只是搬迁文件本身去够它们，这是本片唯一的架构妥协（见下「影响」）。
3. 更新全部 12 处调用方的 import 路径（逐个验证过，不是猜的）：
   - `src/filingData.js`（统一公告出口）
   - `src/server/services/dataSources.js`（`mergeHkFinancialGaps`/`mergeCnFinancialGaps`）
   - `src/server/routes/hkFinancials.js`（同步摄取路由）
   - `scripts/canary.js` / `scripts/hk-coverage.js` / `scripts/cn-coverage.js`
   - `tests/phase-b5.mjs` / `phase-b6.mjs` / `phase-f4b.mjs` / `phase-cn2.mjs` / `phase-cn3.mjs` / `phase-g1.mjs` / `phase7.mjs`——这 7 个测试文件直接 import 管道的纯函数做回归测试，ADR-0001 调研时没有列出（只列了 4 类"运行时调用方"），本片按依赖图逐个 grep 出来才发现测试也是一类调用方。

## 为什么不连 repositories/db 一起搬

一手管道自身没有独立的数据库连接逻辑——它们调用的 `upsertHkFinancials`/`hasCnFinancialsForUrl` 等函数活在 `src/server/repositories/`，那一层背后是 `src/db/index.js` 的 SQLite 连接（`better-sqlite3` + `runMigrations`），而 `src/db` 同时也被几十个 legacy `src/server/services/*` 和路由使用。把 repositories 一并搬进 `apps/worker` 意味着要么复制一份数据库层（两份连接、两套 migration 风险），要么让 legacy `src/` 反过来 import `apps/worker` 的 repositories——同样是跨包耦合，只是换了个方向。R-1（数据底盘 Postgres 化）才是 repositories 层真正该动的时机；本片的范围严格限定为"两个管道文件本身搬家"，不上纲上线去动它们背后的存储层。

## 影响

- **产生了一个方向性别扭的依赖**：`src/filingData.js`、`src/server/routes/hkFinancials.js` 这些 legacy 产品面代码，现在要 reach into `apps/worker/src/pipelines/` 才能拿到管道函数——直觉上"data plane 独立"应该是反过来（worker 依赖一个共享包，产品面通过队列或 API 间接触达 worker），而不是产品面直接 import worker 内部实现细节。这是**已知的、暂时接受的妥协**，不是设计目标：
  - 之所以接受，是因为在 R-2（worker 分离）完成后、R-1（Postgres 化）之前，`src/filingData.js` 等调用方本来就需要**同步**拿到管道的返回值（例如 `hkFinancials.js` 路由的 POST /ingest 是用户触发的同步摄取，不是走队列的异步任务），不是"扔进 worker 队列、等结果"的形状——把这些调用方也一起改造成走队列是一次单独的、更大的产品行为变更（会改变响应时延语义），不属于本片"零行为变更"的范围。
  - 真正的解法在未来某片：要么给这类同步一手数据请求专开一个不经过 BullMQ 的直接调用点（当前就是——文件物理搬家不影响这一点），要么等 R-1/R-2 后续阶段把 `filingData.js` 这类 legacy 出口也迁入 NestJS 应用层、通过契约层调用 worker 暴露的接口。本片不越权做这个决定。
- **不改变任何运行时行为**：`npm test`（43 个 phase 测试文件，含直接测管道纯函数的 7 个）全绿；`npm run canary` 真实探测 6 个 ticker，`hk_filing`/`cn_filing` 两项均返回"已有一手数据"，`filings` 计数与迁移前同源；`apps/worker` 独立 `tsc --noEmit` 零错误、`npm test`（4 个用例，含 `processJob` 端到端跑通完整 `scheduler.js JOBS` 链路）全绿。
- **git 历史保留**：用 `git mv` 而非删除重建，两个文件的完整历史可用 `git log --follow apps/worker/src/pipelines/hkFilingsPipeline.js` 追溯回搬迁前。

## 未决 / 明确排除的范围

- **repositories/db 层随迁**：留给 R-1 数据底盘阶段一并处理（Postgres + Drizzle 重写时，data plane 的存储访问自然会有新的归属决定）。
- **产品面（filingData.js/hkFinancials.js 路由）改走队列而非直接 import**：是 R-2/R-3 后续或专门的产品决策，本片不做，属于上面「影响」里点名的已知妥协。
- **News 端口**：与本片无关，ADR-0001 已排除。
