# ADR 0003 — 技术审美复核：NestJS → Hono + tRPC，BullMQ → Temporal，Rust/WASM 领域核心列为远期选项

**日期**：2026-07-13
**状态**：已批准，未实施（本 ADR 只定方向，代码迁移见下方路线表，尚未动工）
**背景**：docs/REFACTOR_PROPOSAL.md §4.2（后端选型）；用户明确要求"不考虑成本，只考虑未来商用 + 技术审美"重新评估现有技术栈是否是最优解

## 背景

R-0～R-4 已经把 `apps/api`（NestJS，17 个业务模块）+ `apps/worker`（BullMQ）当作新底盘的应用层骨架搭完，功能对旧底盘做到了模块级对应，测试全绿。但这是"搬家不重写"纪律下的选型，当初的决策标准是"和现有 routes/services/repositories 结构一比一对应，抄近路"，不是"如果预算和时间都不是约束，什么是最好的架构"。

本轮复核用后一个标准重新审视，发现两处选型是"为了省事而 boring"，不是"经过验证后依然是最优解而 boring"：

1. **NestJS 的装饰器/DI 仪式感和领域核心的既定设计目标互相矛盾**。REFACTOR_PROPOSAL §1.2 明确要求"领域核心是纯函数库，不 import 框架"；但 NestJS 本身是一整套框架（Module/Controller/Provider/Guard/Interceptor/Pipe），套在一层本该只做"路由 + 校验 + 转发"的应用层上，引入了大量仪式感换不来实际收益——现有 `auth.guard.ts`/`csrf.middleware.ts`/`rate-limit.middleware.ts` 这类横切逻辑本质就是"请求进来，检查一下，放行或拒绝"的普通函数，NestJS 用三套不同的装饰器概念（Guard/Interceptor/Middleware）表达同一件事，是 Java/Angular 生态移植过来的重量级方案，不是这个规模的单体真正需要的复杂度。
2. **BullMQ 只解决"定时任务重试"，解决不了"多步可能中途失败的研究流程"**。REFACTOR_PROPOSAL §1.3 把"研究判断与证伪记录"列为要 append-only 事件日志化的资产，且深度研究本身就是一条会变长的多步管线（意图分类 → 并行采集 → 网页证据 → 估值 → 模型调用 → factGuard 校验 → 落库，未来还会更长）。BullMQ 的能力边界是"这个任务失败了，按退避策略重试整个任务"，给不了"这条 6 步管线跑到第 4 步失败了，从第 4 步重放而不是从头来"这种语义，也没有内建的长流程可观测性。继续往上叠只会变成在 BullMQ 之上手搓一个简化版工作流引擎。

## 决定

1. **HTTP/RPC 层：Hono 替代 NestJS + Express**。Hono 是 fetch-standard、无装饰器、组合式中间件的轻量框架，横切逻辑（鉴权/限速/CSRF）就是普通中间件函数，不需要三套装饰器概念表达同一件事；原生支持多种运行时（Node/Cloudflare Workers/Deno/Bun），为未来多区域边缘部署留口子而不锁定单一运行时。
2. **RPC 契约：tRPC 替代手写 controller + 独立 OpenAPI 生成步骤**。`packages/contracts` 里已经存在的 zod schema 直接作为 tRPC procedure 的 input parser 复用；`apps/web` 消费 API 从"手动跑 codegen 拿类型"变成"import 类型，端到端类型推导"，减少一层需要手动保持同步的胶水代码。对外部消费者（REFACTOR §1.3 提到的未来 B 端数据服务）仍需要标准 REST/OpenAPI 面，`packages/contracts` 的 `generate-openapi.ts` 保留，用 tRPC 的 OpenAPI 适配层导出——tRPC 是内部消费的最短路径，不是唯一对外接口。
3. **编排层：Temporal 替代 BullMQ**。多步、中途可能失败、需要可重放和可观测的研究流程（深度研究报告生成、一手 filing 抓取+解析+入库、业绩后闭环核对）迁移成 Temporal workflow；纯周期任务（每日备份、盘前速报）用 Temporal 的 Cron Workflow 表达，统一到一套编排系统，不长期维护"BullMQ 管周期任务 + 另一套东西管多步流程"两条腿。云托管（Temporal Cloud）还是自托管 server 是部署决策，不在本 ADR 范围内，届时按 R-4/R-5 的部署上下文再定。
4. **领域核心的 Rust/WASM 化列为远期选项，明确不进入近期路线**。只有当量化回测成为真实路线图项（不是猜测的"以后可能要做"）时才启动，届时以"新增一个 WASM 编译目标，TS 端保留同接口调用"的方式渐进引入，不是推倒重写现有 TS 领域核心。当下 TS + decimal 语义纪律（REFACTOR §4.1）已经覆盖研究场景要求的精度，Rust 的收益（编译期数值安全、无 GC 停顿、同一份核心可编译进浏览器做本地即时重算）只有在真正跑批量历史回测/蒙特卡洛模拟时才会显性，现在做是在为一个还不存在的需求预付复杂度。

## 明确排除 / 不是本 ADR 的含义

- **不是"NestJS 写错了"的返工判决**。`apps/api`（17 模块）和 `apps/worker`（BullMQ）在"和旧底盘功能对等、新旧并存可切流"这个目标上完全达成，测试全绿——这些代码此刻的角色从"新底盘的终态"变成"验证过的技术债务，按下方路线表有序替换"，不是本 ADR 生效当天就要拆的指令。旧底盘（`server.js` + `src/`）仍然是唯一在跑生产流量的一侧，这条不变式不因为新底盘内部技术栈变了而改变。
- **不重新讨论已经拍定的选型**：TypeScript 全栈、PostgreSQL + Drizzle、React 19 + Vite，这三项在本轮复核里依然是"即使无成本约束也是最优解"的结论（理由见 REFACTOR_PROPOSAL §4.1/4.3/4.4），本 ADR 不改动它们。
- **Temporal 的具体部署形态**（Temporal Cloud / 自托管）、**tRPC 迁移是否需要先起一个新目录做并行验证还是原地替换 `apps/api`**，都是路线表执行时的实施细节，不在本 ADR 锁定。

## 路线表：现有 vs 下一步

**现有（已验证，均未切生产流量）**

- `apps/api`：NestJS，17 个业务模块，controller 用 `packages/contracts` 的 zod schema 校验，14 个契约测试全绿。
- `apps/worker`：BullMQ 消费者，复用 `scheduler.js` 的 `JOBS`/`isDue` 定义；一手 filing 管道（CNINFO/HKEX）已物理迁入 `apps/worker/src/pipelines/`（ADR-0002）。
- `apps/web`：React 19 + Vite，5 片落地（外壳/持仓/看盘/研究对话/设置）。
- `packages/contracts`：zod schema 单一源 + OpenAPI 生成 + 契约测试雏形。
- `packages/db`：Drizzle + Postgres schema（含双时态财务表）+ SQLite→Postgres ETL 脚本。
- `packages/data-plane`：供应商适配器矩阵（Quote/Fundamentals/Filings/Calendar）+ 质量守卫（ADR-0001）。
- `packages/ui`：design tokens，从旧底盘 CSS 机械提取，新旧前端共享同一套视觉身份。

**下一步（按顺序推进，每步验证后再走下一步，延续"搬家不重写、小步骤"纪律）**

1. 起一个 Hono + tRPC 的最小切片（例如 `/api/status` 一个端点），和现有 NestJS 版本并行跑，验证端到端类型链路和 `packages/contracts` 复用方式，不动其余 16 个模块。
2. 验证通过后，逐模块把 `apps/api` 的业务模块迁到 tRPC procedure——只搬运，不重写业务逻辑，每迁一个模块跑一次契约测试确认行为等价。
3. 起 Temporal（自托管或 Cloud，届时定），先迁"深度研究报告生成"这一条最长的多步管线——选它是因为它最能体现 durable workflow 相对 BullMQ 的实际收益（可重放、可观测），跑通后再迁 filing 抓取管道和业绩闭环核对任务。
4. 纯周期任务（备份、盘前速报）视第 3 步验证结果决定：是折进 Temporal Cron Workflow 统一编排系统，还是维持原样——不是预设结论，用实测收益决定。
5. `apps/api`（NestJS 部分）和 BullMQ 只在 tRPC/Temporal 版本功能对等验证通过后才退役拆除；退役前两套并存不冲突（新底盘本来就还没切流）。
6. Rust/WASM 领域核心：不排入以上任何一步，只在量化/回测变成真实产品优先级时单独立项。

文件夹命名不变：`apps/api` 依然是"HTTP/RPC 应用层"这个角色的名字，`apps/worker` 依然是"后台任务执行"这个角色的名字——技术栈换了，角色没换，不需要跟着重命名目录，这本身就是"按角色命名、不按实现库命名"的品味体现。
