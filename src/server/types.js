/**
 * D1：跨模块传递的核心数据结构的类型声明（只声明形状，不含运行时代码）。
 *
 * 这些对象在服务端到处流动（agentService → chatOrchestrator → 前端 JSON），
 * 字段是逐次功能迭代里长出来的，从没有一个地方能一眼看全形状。这个文件不是新增行为，
 * 只是把已经存在的隐式契约写成 @typedef，供其他文件 `@param {import("../types.js").X}`
 * 引用，换取编辑器补全 + `checkJs` 静态检查（jsconfig.json）。
 *
 * 范围收窄到 D 阶段明确点名的六类跨模块对象：dataSources / valuation / research session /
 * watchlist / portfolio / chat orchestration。其余模块的类型化留给后续增量批次。
 */

/**
 * @typedef {Object} MarketSnapshot
 * @property {string} source
 * @property {string} ticker
 * @property {string} [currency]
 * @property {number|null} price
 * @property {number|null} [previousClose]
 * @property {number|null} [change]
 * @property {number|null} [changePercent]
 * @property {number|null} [pe]
 * @property {number|null} [marketCap]
 * @property {number|null} [open]
 * @property {number|null} [high]
 * @property {number|null} [low]
 * @property {number|null} [volume]
 * @property {number|null} [dividendYield]
 * @property {number|null} [week52High]
 * @property {number|null} [week52Low]
 * @property {string} asOf
 * @property {"ok"|"missing"} providerStatus
 * @property {{oneMonthPct?: number, ytdPct?: number, providerStatus?: string}} [ranges]
 * @property {string[]} [errors]
 */

/**
 * @typedef {Object} FinancialsData
 * @property {"ok"|"missing"} providerStatus
 * @property {number} [eps]
 * @property {number} [pe]
 * @property {number} [revenue]
 * @property {number} [revenueGrowth]
 * @property {number} [netMargin]
 * @property {number} [operatingMargin]
 * @property {number} [grossMargin]
 * @property {number} [netIncome]
 * @property {number} [sharesOutstanding]
 * @property {number} [cashAndEquivalents]
 * @property {number} [totalDebt]
 * @property {number} [netCash]
 * @property {boolean} [firstPartySupplement] 是否被港股一手 HKEX 抽取数据补过缺口字段（dataSources.js）
 * @property {Array<Object>} [hkFilings]
 * @property {Object} [segments]
 * @property {string[]} [errors]
 */

/**
 * @typedef {Object} EstimatesData
 * @property {"ok"|"missing"} providerStatus
 * @property {number} [strongBuy]
 * @property {number} [buy]
 * @property {number} [hold]
 * @property {number} [sell]
 * @property {number} [strongSell]
 * @property {string} [consensus]
 * @property {number} [consensusTargetPrice]
 * @property {number} [targetMedian]
 * @property {number} [targetLow]
 * @property {number} [targetHigh]
 * @property {number} [numberOfAnalysts]
 * @property {string} [source]
 */

/**
 * @typedef {Object} NewsSnapshot
 * @property {string} source
 * @property {string} ticker
 * @property {"ok"|"missing"} providerStatus
 * @property {string} asOf
 * @property {Array<Object>} articles
 * @property {{label: string, score: number, positiveCount?: number, negativeCount?: number, neutralCount?: number}} [sentiment]
 * @property {Object} [scopeSummary]
 * @property {string[]} [coverageGaps]
 * @property {string[]} [errors]
 */

/**
 * @typedef {Object} FilingsData
 * @property {"ok"|"missing"} providerStatus
 * @property {Array<Object>} filings
 * @property {Object} [eightK]
 * @property {string[]} [errors]
 */

/**
 * dataSources.js collectDataSources() 的返回形状；也是 agentService.js runAgent() 结果里
 * result.marketSnapshot / financialsData / newsSnapshot / filingsData / estimatesData 的来源。
 * @typedef {Object} DataSources
 * @property {MarketSnapshot} marketSnapshot
 * @property {NewsSnapshot} newsSnapshot
 * @property {FinancialsData} financialsData
 * @property {FilingsData} filingsData
 * @property {EstimatesData} estimatesData
 * @property {Object|null} [companyProfile]
 * @property {string[]} [errors]
 */

/**
 * valuationEngine.js displayValuation() 的返回形状。cannotValueReason 非空时，其余估值字段
 * 应视为不可信（调用方约定：cannotValueReason 存在就把 valuation 整体当 null 处理，
 * 见 chatOrchestrator.js 里反复出现的 `valuation.cannotValueReason ? null : valuation`）。
 * @typedef {Object} Valuation
 * @property {string} method
 * @property {string|number|null} bear
 * @property {string|number|null} base
 * @property {string|number|null} bull
 * @property {number} [currentPrice] 早期"数据不足直接返回"分支可能没有现价
 * @property {string[]} [methods]
 * @property {Array<{name: string, bear: number, base: number, bull: number}>} [methodDetail]
 * @property {string[]} keyAssumptions
 * @property {Array<Object>} sensitivity
 * @property {string|null} cannotValueReason
 * @property {boolean} [dataSuspect] 数据存疑时的降级信号（估值被护栏抑制，见 finalizeChat 的置信度封顶逻辑）
 * @property {boolean} [stageAware] 是否走了资产阶段分类（亏损/亏损高成长）的 EV/Sales 情景估值分支
 * @property {string} [stage] classifyAssetStage() 的结果："loss_growth"|"loss"|"profitable"|"unknown"
 * @property {string} [upside] 情景估值分支自带的 base 相对现价涨幅（百分比字符串，如 "12.3%"）
 * @property {string} [downside] 情景估值分支自带的 bear 相对现价跌幅
 * @property {{target: number, low: number|null, high: number|null, upside: string|null, source: string}|null} [analyst]
 */

/**
 * researchSessions.js saveResearchSession() 的入参 / getResearchSession() 的返回形状。
 * @typedef {Object} ResearchSession
 * @property {string} [id]
 * @property {string} ticker
 * @property {string} [conversationId]
 * @property {string} [companyName]
 * @property {string} [title]
 * @property {string} question
 * @property {"draft"|"completed"|"error"} [status]
 * @property {Object|null} [decisionPanel]
 * @property {string} [fullResearch]
 * @property {string} [reportMarkdown]
 * @property {DataSources & {webEvidence?: Object|null}} [dataSources]
 * @property {string} [researchStatus]
 * @property {string} [confidence]
 * @property {Array<{role: "user"|"assistant", content: string, meta?: Object, createdAt: string}>} [thread]
 */

/**
 * watchlist_prefs 表一行（watchlist.js repository）。
 * @typedef {Object} WatchlistEntry
 * @property {string} ticker
 * @property {string} nameZh
 */

/**
 * portfolio_positions 表一行（portfolio.js repository，hydrate() 的返回形状）。
 * @typedef {Object} PortfolioPosition
 * @property {string} ticker
 * @property {string} companyName
 * @property {number|null} shares
 * @property {number|null} avgCost
 * @property {number|null} stopLoss
 * @property {number|null} takeProfit
 * @property {string} note
 * @property {string} updatedAt
 */

/**
 * chatOrchestrator.js runChat()/finalizeChat() 内部往 answerComposer / 前端流转的上下文对象。
 * @typedef {Object} ChatContext
 * @property {NewsSnapshot} [newsSnapshot]
 * @property {Object} [webEvidence]
 * @property {FinancialsData} [financialsData]
 * @property {MarketSnapshot} [marketSnapshot]
 * @property {Valuation|null} [valuation]
 * @property {string} [portraitContext]
 * @property {Array<Object>} [history]
 * @property {Object|null} [dualListing]
 * @property {Object|null} [dualQuote]
 * @property {Object|null} [compare] buildCompareSummary() 的返回值（对比对象的轻量快照）
 * @property {Array<Object>} [otherHoldings]
 */

/**
 * finalizeChat() 返回给前端的完整响应对象（/api/chat、/api/ask 公司分支共用）。
 * @typedef {Object} ChatFinalResponse
 * @property {string} mode
 * @property {string} stages
 * @property {string} intent
 * @property {string} [provider]
 * @property {string} [model]
 * @property {string|null} sessionId
 * @property {string} content
 * @property {Object|null} decisionPanel
 * @property {Object} [userContext]
 * @property {DataSources} [dataSources]
 * @property {MarketSnapshot} [marketSnapshot]
 * @property {NewsSnapshot} [newsSnapshot]
 * @property {Valuation|null} valuation
 * @property {string|null} valuationNote
 * @property {string|null} valuationName
 * @property {Object|null} analyst
 * @property {Object|null} comparison
 * @property {Array<Object>|null} plan
 * @property {Object} [webEvidence]
 * @property {{ticker: string, created: boolean, changed: boolean, turnCount: number}|null} portrait
 * @property {Array<Object>} otherHoldings
 * @property {Object|null} dualQuote
 * @property {boolean} positionSaved
 * @property {boolean} watchRestored
 * @property {Array<{ticker: string, name: string}>} newlyWatched
 */

export {};
