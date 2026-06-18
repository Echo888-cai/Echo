export const DISCLAIMER =
  "Luvio 不提供投资顾问服务。本报告仅用于研究和学习，请用公司原始公告核验全部数据，并独立做出投资决定。";

const seedCompanies = [
  ["0700.HK", "腾讯控股", "Tencent Holdings Limited", "科技互联网", "互联网平台与游戏"],
  ["9988.HK", "阿里巴巴-W", "Alibaba Group Holding Limited", "科技互联网", "电商与云计算"],
  ["3690.HK", "美团-W", "Meituan", "科技互联网", "本地生活服务"],
  ["9618.HK", "京东集团-SW", "JD.com, Inc.", "科技互联网", "电商与供应链"],
  ["9888.HK", "百度集团-SW", "Baidu, Inc.", "科技互联网", "搜索、云与 AI"],
  ["1024.HK", "快手-W", "Kuaishou Technology", "科技互联网", "短视频与直播"],
  ["9999.HK", "网易-S", "NetEase, Inc.", "科技互联网", "游戏与内容"],
  ["0992.HK", "联想集团", "Lenovo Group Limited", "科技互联网", "个人电脑、服务器与 AI 终端"],
  ["1211.HK", "比亚迪股份", "BYD Company Limited", "汽车与智能制造", "新能源车与电池"],
  ["2015.HK", "理想汽车-W", "Li Auto Inc.", "汽车与智能制造", "新能源车"],
  ["9868.HK", "小鹏汽车-W", "XPeng Inc.", "汽车与智能制造", "智能电动车"],
  ["9866.HK", "蔚来-SW", "NIO Inc.", "汽车与智能制造", "智能电动车"],
  ["1316.HK", "耐世特", "Nexteer Automotive Group Limited", "汽车与智能制造", "汽车转向与线控底盘"],
  ["9660.HK", "地平线机器人-W", "Horizon Robotics", "汽车与智能制造", "智能驾驶芯片与软件"],
  ["2020.HK", "安踏体育", "ANTA Sports Products Limited", "消费", "运动服饰"],
  ["2331.HK", "李宁", "Li Ning Company Limited", "消费", "运动服饰"],
  ["6862.HK", "海底捞", "Haidilao International Holding Ltd.", "消费", "餐饮"],
  ["9633.HK", "农夫山泉", "Nongfu Spring Co., Ltd.", "消费", "包装饮用水与饮料"],
  ["1299.HK", "友邦保险", "AIA Group Limited", "金融与保险", "寿险与保障"],
  ["2318.HK", "中国平安", "Ping An Insurance (Group) Company of China, Ltd.", "金融与保险", "综合金融"],
  ["0388.HK", "香港交易所", "Hong Kong Exchanges and Clearing Limited", "金融与保险", "交易所与清算"],
  ["0941.HK", "中国移动", "China Mobile Limited", "电信与公用事业", "电信运营"],
  ["0728.HK", "中国电信", "China Telecom Corporation Limited", "电信与公用事业", "电信运营"],
  ["0762.HK", "中国联通", "China Unicom (Hong Kong) Limited", "电信与公用事业", "电信运营"],
  ["1093.HK", "石药集团", "CSPC Pharmaceutical Group Limited", "医药", "创新药与制剂"],
  ["1177.HK", "中国生物制药", "Sino Biopharmaceutical Limited", "医药", "创新药与仿制药"],
  ["2269.HK", "药明生物", "WuXi Biologics (Cayman) Inc.", "医药", "生物药外包服务"],
  ["2359.HK", "药明康德", "WuXi AppTec Co., Ltd.", "医药", "医药研发服务"],
  ["0939.HK", "建设银行", "China Construction Bank Corporation", "金融与保险", "商业银行"],
  ["1398.HK", "工商银行", "Industrial and Commercial Bank of China Limited", "金融与保险", "商业银行"],
  ["0002.HK", "中电控股", "CLP Holdings Limited", "电信与公用事业", "电力公用事业"]
];

const detailOverrides = {
  "1316.HK": {
    aliases: ["耐世特", "Nexteer"],
    price: 4.9,
    marketCap: "约 120 亿 HKD",
    week52: "3.10 - 6.25",
    dividendYield: "约 1.4%",
    pe: "约 12.8x",
    pb: "约 1.1x",
    ps: "约 0.5x",
    latestReport: "FY2024 / 2025 中期待更新",
    status: "值得深入研究",
    statusTone: "good",
    summary: [
      "耐世特是一家汽车转向与线控底盘供应商，收入与全球整车厂平台周期、北美订单、智能底盘渗透率高度相关。",
      "当前研究重点不是短期股价，而是电动化与线控转向能否带来更高单车价值和更稳的利润率。",
      "核心争议在于：传统转向业务的周期压力，能否被智能底盘新项目与成本改善抵消。"
    ],
    businessModel: [
      "向整车厂供应电动助力转向、传动系统、线控转向等零部件。",
      "项目制收入明显，订单生命周期长，但客户集中度和车型放量节奏会影响利润。",
      "成本端受原材料、人工、产能利用率和研发投入影响。"
    ],
    metrics: [
      ["收入质量", "跟随整车厂项目周期", "重点看新项目量产和客户结构"],
      ["利润率", "需要验证改善趋势", "关注毛利率、研发费用率和工厂利用率"],
      ["现金流", "周期性较强", "看应收账款、库存与资本开支"],
      ["资产负债", "中等杠杆", "关注净债务与利息费用"]
    ],
    moat: [
      "长期整车厂认证",
      "安全件交付经验",
      "转向系统工程能力",
      "全球制造网络",
      "线控转向期权"
    ],
    management: [
      "资本配置需观察研发投入是否能转化为高质量订单。",
      "治理折价和行业周期折价需要单独计入安全边际。",
      "复盘重点是管理层对订单、利润率和现金流承诺的兑现。"
    ],
    risks: [
      "客户车型销量低于预期",
      "线控转向商业化慢于预期",
      "毛利率修复不及预期",
      "北美与中国汽车供应链波动",
      "汇率与利率压力",
      "港股流动性折价"
    ],
    bull: [
      "智能底盘提升单车价值，传统转向供应商有升级空间。",
      "估值可能已经反映较多周期悲观预期。",
      "若毛利率和自由现金流修复，市场会重新评估质量。"
    ],
    bear: [
      "汽车零部件议价能力弱，利润率改善可能被整车厂压价抵消。",
      "线控转向叙事如果兑现慢，估值难以重估。",
      "客户和项目节奏不透明，投资者容易低估周期下行。"
    ],
    monitors: [
      "新订单和量产节奏",
      "毛利率连续两个报告期变化",
      "自由现金流与库存周转",
      "客户集中度",
      "线控转向披露"
    ],
    officialSources: [
      { label: "Nexteer Annual / Interim Reports", url: "https://www.nexteer.com/annual-interim-reports/" },
      { label: "Nexteer Investor Relations", url: "https://www.nexteer.com/investor-relations/" },
      { label: "HKEXnews 披露易", url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh" }
    ]
  },
  "0700.HK": {
    aliases: ["腾讯", "Tencent"],
    price: 386,
    marketCap: "约 3.6 万亿 HKD",
    week52: "260 - 430",
    dividendYield: "约 1.1%",
    pe: "约 18x",
    pb: "约 3.4x",
    ps: "约 5.8x",
    latestReport: "2025 Q1 / 待核对",
    status: "基本面稳定",
    statusTone: "steady",
    summary: [
      "腾讯是中国互联网生态核心公司，游戏、社交广告、金融科技与企业服务构成主要利润池。",
      "价值投资重点在于现金流质量、资本回报、视频号与游戏产品周期，以及股东回报持续性。",
      "核心争议是增长放缓后，利润率与回购能否继续支撑长期复利。"
    ],
    businessModel: [
      "社交网络提供流量入口，游戏和广告贡献高质量利润。",
      "金融科技与企业服务提供规模，但利润率和监管环境需要跟踪。",
      "投资资产和回购政策影响每股价值。"
    ],
    metrics: [
      ["收入质量", "多利润池", "关注广告和游戏恢复"],
      ["利润率", "较强", "高毛利业务占比关键"],
      ["现金流", "强", "自由现金流与回购节奏"],
      ["资产负债", "稳健", "净现金与投资资产价值"]
    ],
    moat: ["社交网络效应", "内容与游戏发行能力", "支付生态", "云和企业客户", "资本配置弹性"],
    management: ["长期资本回报记录较好。", "需要跟踪回购、分红和投资退出纪律。"],
    risks: ["游戏监管变化", "广告周期波动", "金融科技监管", "投资资产折价", "港股估值折价"],
    bull: ["核心现金流稳健，回购提高每股价值。", "视频号和广告仍有结构性空间。"],
    bear: ["超级平台增长率下降，估值上限受压。", "监管和宏观周期会压低风险偏好。"],
    monitors: ["游戏流水", "广告增速", "回购金额", "利润率", "监管政策"],
    officialSources: [
      { label: "Tencent Investor Relations", url: "https://www.tencent.com/en-us/investors.html" },
      { label: "Tencent Financial Reports", url: "https://www.tencent.com/en-us/investors/financial-reports.html" },
      { label: "HKEXnews 披露易", url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh" }
    ]
  },
  "9988.HK": {
    aliases: ["阿里", "阿里巴巴", "Alibaba"],
    price: 78,
    marketCap: "约 1.5 万亿 HKD",
    week52: "62 - 98",
    dividendYield: "约 1.2%",
    pe: "约 13x",
    pb: "约 1.5x",
    ps: "约 1.7x",
    latestReport: "FY2025 / 待核对",
    status: "高不确定性",
    statusTone: "watch",
    summary: [
      "阿里巴巴是中国电商和云基础设施核心公司，价值重估取决于电商竞争、云增长和资本回报。",
      "市场关注低估值与业务重组，但也担心核心电商份额和利润率。"
    ],
    businessModel: [
      "国内电商平台收取广告、佣金和服务收入。",
      "云计算、国际电商、本地生活构成第二增长曲线。",
      "回购和分红影响每股价值。"
    ],
    metrics: [
      ["收入质量", "分化", "核心电商稳，云和国际业务需验证"],
      ["利润率", "承压后修复", "看淘天、云和亏损业务收窄"],
      ["现金流", "强", "自由现金流支持回购"],
      ["资产负债", "稳健", "净现金提供安全垫"]
    ],
    moat: ["商家生态", "支付与物流协同", "云基础设施", "数据规模", "品牌心智"],
    management: ["组织调整后执行力是关键变量。", "需要持续复盘资本回报纪律。"],
    risks: ["电商竞争加剧", "云增长不及预期", "监管变化", "国际业务亏损", "估值长期折价"],
    bull: ["估值低，回购强，现金流提供安全边际。", "云和国际业务若改善，可能重新定价。"],
    bear: ["核心电商护城河弱化，利润率可能继续被竞争侵蚀。", "组织变革需要时间验证。"],
    monitors: ["淘天 GMV 与 take rate", "云收入增速", "回购规模", "亏损业务收窄", "管理层指引"],
    officialSources: [
      { label: "Alibaba Investor Relations", url: "https://www.alibabagroup.com/en-US/ir-financial-reports" },
      { label: "HKEXnews 披露易", url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh" }
    ]
  },
  "0992.HK": {
    aliases: ["联想", "联想集团", "Lenovo"],
    price: 10.2,
    marketCap: "约 1300 亿 HKD",
    week52: "7.20 - 13.50",
    dividendYield: "约 3.5%",
    pe: "约 12x",
    pb: "约 2.8x",
    ps: "约 0.4x",
    latestReport: "FY2025 / 待核对",
    status: "值得继续研究",
    statusTone: "steady",
    summary: [
      "联想集团是全球 PC、服务器、基础设施和智能设备公司，投资判断取决于 PC 周期修复、AI PC 渗透、服务器利润率和现金分红能力。",
      "市场核心分歧是：AI 终端和基础设施能否带来新的增长曲线，还是只是在成熟硬件周期里改善估值。"
    ],
    businessModel: [
      "智能设备业务以 PC、平板和手机为主，受换机周期、渠道库存和价格竞争影响。",
      "基础设施方案业务覆盖服务器、存储和 AI 基础设施，但利润率和订单质量需要持续验证。",
      "方案服务业务提供运维、设备即服务和企业服务，是提升估值质量的关键。"
    ],
    metrics: [
      ["收入质量", "周期修复中", "重点看 PC 出货、AI PC 占比和服务收入"],
      ["利润率", "结构改善待验证", "看基础设施业务亏损收窄和服务业务占比"],
      ["现金流", "相对稳健", "关注库存、应收和股息覆盖"],
      ["资本回报", "分红是重要锚点", "需要看盈利恢复是否支撑派息"]
    ],
    moat: ["全球供应链", "PC 渠道份额", "企业客户基础", "ThinkPad 品牌", "服务网络"],
    management: ["需要验证 AI PC 与基础设施投入能否转化为利润。", "资本回报和分红稳定性是估值底部的重要变量。"],
    risks: ["PC 需求复苏不及预期", "AI PC 换机慢于预期", "服务器业务利润率承压", "汇率和供应链波动", "硬件估值中枢偏低"],
    bull: ["PC 周期恢复叠加 AI PC 换机，可能改善收入和利润预期。", "服务业务占比提升能让市场重新评估估值质量。"],
    bear: ["如果 AI PC 只是营销概念、不能带来 ASP 或换机周期改善，估值提升空间有限。", "服务器和基础设施若继续低利润扩张，会拖累整体质量。"],
    monitors: ["PC 出货与渠道库存", "AI PC 占比", "基础设施业务利润率", "方案服务收入占比", "股息覆盖率"],
    officialSources: [
      { label: "Lenovo Investor Relations", url: "https://investor.lenovo.com/" },
      { label: "Lenovo Financial Reports", url: "https://investor.lenovo.com/en/financial/results.php" },
      { label: "HKEXnews 披露易", url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh" }
    ]
  }
};

const aliasOverrides = {
  "3690.HK": ["美团"],
  "9618.HK": ["京东"],
  "9888.HK": ["百度"],
  "1024.HK": ["快手"],
  "9999.HK": ["网易"],
  "0992.HK": ["联想", "联想集团", "Lenovo"],
  "1211.HK": ["比亚迪", "BYD"],
  "2015.HK": ["理想汽车", "理想"],
  "9868.HK": ["小鹏汽车", "小鹏"],
  "9866.HK": ["蔚来", "NIO"],
  "9660.HK": ["地平线", "Horizon"],
  "2020.HK": ["安踏"],
  "2331.HK": ["李宁"],
  "6862.HK": ["海底捞"],
  "9633.HK": ["农夫山泉"],
  "1299.HK": ["友邦", "友邦保险", "AIA"],
  "2318.HK": ["中国平安", "平安"],
  "0388.HK": ["港交所", "香港交易所", "HKEX"],
  "0941.HK": ["中国移动", "移动"],
  "0728.HK": ["中国电信", "电信"],
  "0762.HK": ["中国联通", "联通"],
  "1093.HK": ["石药", "石药集团"],
  "1177.HK": ["中国生物制药", "中生制药"],
  "2269.HK": ["药明生物"],
  "2359.HK": ["药明康德"],
  "0939.HK": ["建设银行", "建行"],
  "1398.HK": ["工商银行", "工行"],
  "0002.HK": ["中电控股", "中电"]
};

const sectorDefaults = {
  "科技互联网": {
    status: "高不确定性",
    statusTone: "watch",
    moat: ["用户规模", "数据与算法", "生态协同", "产品迭代", "品牌心智"],
    risks: ["监管变化", "竞争加剧", "利润率波动", "增长放缓", "估值折价"]
  },
  "汽车与智能制造": {
    status: "值得深入研究",
    statusTone: "good",
    moat: ["制造能力", "供应链管理", "工程经验", "客户认证", "规模效应"],
    risks: ["价格战", "项目周期", "原材料波动", "技术路线变化", "客户集中"]
  },
  "消费": {
    status: "基本面稳定",
    statusTone: "steady",
    moat: ["品牌", "渠道", "供应链", "复购", "定价权"],
    risks: ["消费疲弱", "渠道库存", "品牌老化", "原材料成本", "竞争促销"]
  },
  "金融与保险": {
    status: "估值偏贵，等待",
    statusTone: "wait",
    moat: ["牌照", "客户基础", "资本实力", "风控能力", "规模优势"],
    risks: ["利率变化", "资产质量", "监管资本", "投资收益波动", "宏观周期"]
  },
  "电信与公用事业": {
    status: "基本面稳定",
    statusTone: "steady",
    moat: ["牌照", "网络资产", "稳定现金流", "客户规模", "分红纪律"],
    risks: ["资本开支", "监管价格", "利率上行", "增长有限", "政策目标"]
  },
  "医药": {
    status: "高不确定性",
    statusTone: "watch",
    moat: ["研发管线", "注册能力", "生产质量", "客户关系", "规模化交付"],
    risks: ["集采降价", "研发失败", "海外监管", "融资环境", "订单波动"]
  }
};

function makeDefaultCompany([ticker, nameZh, nameEn, sector, industry], index) {
  const defaults = sectorDefaults[sector];
  const price = Number((8 + index * 3.7).toFixed(2));

  return {
    ticker,
    nameZh,
    nameEn,
    sector,
    industry,
    exchange: "HKEX",
    currency: "HKD",
    aliases: aliasOverrides[ticker] || [nameZh.replace(/[-－].*$/, "")],
    price,
    marketCap: "待接入实时数据",
    week52: "待接入实时数据",
    dividendYield: "待核对",
    pe: "待核对",
    pb: "待核对",
    ps: "待核对",
    latestReport: "待导入公告",
    status: defaults.status,
    statusTone: defaults.statusTone,
    summary: [
      `${nameZh} 属于${sector}板块，第一版研究页使用本地 seed 数据建立研究框架。`,
      "需要导入年报、中报或业绩公告后，才能形成可追溯的事实判断。",
      "当前页面优先帮助用户拆解商业模式、财务质量、估值和风险。"
    ],
    businessModel: [
      `主营业务集中在${industry}。`,
      "收入质量、利润率和现金流需要用公告材料验证。",
      "第一版不接实时行情，不输出交易指令。"
    ],
    metrics: [
      ["收入质量", "待解析公告", "导入年报后更新"],
      ["利润率", "待解析公告", "关注毛利率和经营利润率"],
      ["现金流", "待解析公告", "关注自由现金流"],
      ["资产负债", "待解析公告", "关注净现金或净债务"]
    ],
    moat: defaults.moat,
    management: [
      "管理层历史和资本配置能力需要结合公告、业绩会和回购分红记录分析。",
      "第一版先保留复盘框架，等待真实资料填充。"
    ],
    valuation: null,
    risks: defaults.risks,
    bull: [
      "如果基本面稳定且估值已反映悲观预期，可能值得继续研究。",
      "导入公告后应验证利润率、现金流和资本回报是否改善。"
    ],
    bear: [
      "如果核心假设无法从公告中验证，当前只能保持不确定。",
      "港股估值折价可能长期存在，不能只看低 PE。"
    ],
    monitors: ["最新公告", "收入增速", "利润率", "自由现金流", "管理层指引"]
  };
}

export const companies = seedCompanies.map((company, index) => ({
  ...makeDefaultCompany(company, index),
  ...(detailOverrides[company[0]] || {})
}));

export function normalizeTicker(input) {
  const value = String(input || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!value) return "";
  // Strip any ".HK" / "HK" suffix (with or without leading dot) so the numeric pad works.
  const numeric = value.replace(/\.?HK$/, "");
  if (/^\d{1,5}$/.test(numeric)) {
    return `${numeric.padStart(4, "0")}.HK`;
  }
  // If the value already contains a dot, preserve it.
  return value;
}

export function findCompany(input) {
  const raw = String(input || "").trim();
  const normalized = normalizeTicker(raw);
  const lower = raw.toLowerCase();
  const tickerInSentence = raw.match(/\b\d{1,5}(?:\.HK)?\b/i)?.[0];
  const normalizedTickerInSentence = tickerInSentence ? normalizeTicker(tickerInSentence) : "";

  return (
    companies.find((company) => company.ticker === normalized) ||
    companies.find((company) => company.ticker === normalizedTickerInSentence) ||
    companies.find((company) => company.ticker.replace(/^0+/, "") === normalized.replace(/^0+/, "")) ||
    companies.find((company) => company.ticker.replace(/^0+/, "") === normalizedTickerInSentence.replace(/^0+/, "")) ||
    companies.find((company) => raw.includes(company.nameZh) || company.nameZh.includes(raw)) ||
    companies.find((company) => company.aliases?.some((alias) => raw.includes(alias) || lower.includes(String(alias).toLowerCase()))) ||
    companies.find((company) => company.nameEn.toLowerCase().includes(lower) || lower.includes(company.nameEn.toLowerCase())) ||
    null
  );
}

export function companyByTicker(ticker) {
  return companies.find((company) => company.ticker === normalizeTicker(ticker));
}

export function groupBySector() {
  return companies.reduce((groups, company) => {
    groups[company.sector] ||= [];
    groups[company.sector].push(company);
    return groups;
  }, {});
}

export function generateResearchReport(company, filings = [], userQuestion = "") {
  const parsedFilings = filings.filter((filing) => filing.rawText || filing.parsedStatus === "parsed");
  const today = new Date().toISOString();
  const officialSourceLines = (company.officialSources || [{ label: "HKEXnews 披露易", url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh" }]).map(
    (source) => `- ${source.label} ${source.url}`
  );
  const sourceLines = parsedFilings.length
    ? parsedFilings.map((filing) => `- ${filing.title} (${filing.publishedAt || "日期未知"}) ${filing.sourceUrl || ""}`)
    : ["- 未在当前材料中找到已解析公告。以下为 seed profile 草稿，需导入原始公告验证。"];

  const filingSignal = parsedFilings
    .map((filing) => filing.rawText || "")
    .join("\n")
    .slice(0, 360);

  return `【结论卡片】
- 标的：${company.nameZh} ${company.ticker}
- 评级：观察
- 信心：低（本地报告模式）
- 判断：价格进入可研究区，缺估值带、利润预测和回购验证。下跌不一定是机会，取决于 FCF 和利润率趋势。
- 动作：等财报

【核心理由】
${parsedFilings.length
  ? `- 已有 ${parsedFilings.length} 份材料 → 需核验是否改变收入、利润率和 FCF 判断\n- 缺少行情源 → 无法判断当前市场价格是否合理\n- 缺少新闻源 → 无法评估市场舆论和事件风险`
  : `- 财报未导入 → 无法评估利润质量和现金流\n- 行情源未接入 → 无法判断市场价格\n- 新闻源不可用 → 无法评估舆论和风险事件`
}

【关键变量】
- ${company.monitors[0] || "收入增速"}：${parsedFilings.length ? "● 待验证" : "○ 无数据"}
- ${company.monitors[1] || "利润率"}：${parsedFilings.length ? "● 待验证" : "○ 无数据"}
- ${company.monitors[2] || "自由现金流"}：${parsedFilings.length ? "● 待验证" : "○ 无数据"}
- ${company.monitors[3] || "回购"}：${parsedFilings.length ? "● 待验证" : "○ 无数据"}

【下一步动作】
${parsedFilings.length ? "等财报验证" : "观察，补齐数据"}
数据完整度：${parsedFilings.length ? "60" : "40"}%。已接入：公司档案${parsedFilings.length ? " / 财报" : ""}。未接入：行情 / 新闻 / 持仓。
未录入持仓。添加成本价和仓位后，可生成分批和止错计划。

---

## 事实数据表
| 指标 | 当前值 | 来源 |
|---|---:|---|
| 最新价格 | ${company.price || "缺失"} | seed profile / 待行情核验 |
| 涨跌幅 | 缺失 | 行情源缺失 |
| 市值 | 缺失 —— 行情源未接入 | 无 |
| PE | ${company.pe || "缺失"} | seed profile / 待公告核验 |
| Forward PE | 缺失 —— 一致预期未接入 | 无 |
| FCF | 缺失 —— 财报未导入 | 无 |
| 净现金 | 缺失 —— 财报未导入 | 无 |
| 回购金额 | 缺失 —— 公告未导入 | 无 |
| 收入增速 | 缺失 —— 财报未导入 | 无 |
| 利润增速 | 缺失 —— 财报未导入 | 无 |
| 毛利率 | 缺失 —— 财报未导入 | 无 |
| 经营利润率 | 缺失 —— 财报未导入 | 无 |

## 投资逻辑评分
${[
  { name: "核心业务增长", score: parsedFilings.length ? 5 : null, reason: parsedFilings.length ? "需核验收入增速" : "暂不评分 —— 财报未导入" },
  { name: "利润质量", score: parsedFilings.length ? 4 : null, reason: parsedFilings.length ? "需核验毛利率和利润率" : "暂不评分 —— 财报未导入" },
  { name: "自由现金流", score: null, reason: "暂不评分 —— 财报未导入" },
  { name: "股东回报", score: null, reason: "暂不评分 —— 公告未导入" },
  { name: "估值吸引力", score: null, reason: "暂不评分 —— 行情未接入" },
  { name: "监管风险", score: 5, reason: "需持续跟踪" },
  { name: "市场预期差", score: null, reason: "暂不评分 —— 数据不足" }
].map(d => d.score !== null ? `- ${d.name}：${d.score}/10。${d.reason}` : `- ${d.name}：暂不评分 —— ${d.reason}`).join("\n")}

## 估值与赔率
- Bear（概率 25%）：${company.risks[0] || "核心假设被证伪"}，估值倍数和 EPS 同时下修。缺 EPS 和 PE，暂不能给目标价。
- Base（概率 50%）：核心业务稳定，当前估值维持。缺 Forward PE 和 FCF，暂不能定量。
- Bull（概率 25%）：增长和回购兑现。缺收入增速和回购数据。
- 核心数据缺口：Forward EPS、FCF、净现金、回购金额、收入/利润率趋势、可比估值。

## 证伪条件
${company.risks.slice(0, 4).map(r => `- 证伪条件：${r}。触发阈值：需导入公告后量化。当前状态：缺失。触发意味着：重新评估投资假设。`).join("\n")}

## 来源审计
- 行情：缺失 —— 优先尝试 Tencent Finance（免费）→ Finnhub → Alpha Vantage → Yahoo Finance
${officialSourceLines.join("\n")}
${sourceLines.join("\n")}
${filingSignal ? `\n材料摘录：${filingSignal}` : ""}
${userQuestion ? `\n用户问题：${userQuestion}` : ""}
- 模式：本地模板。不编造未验证事实。

${DISCLAIMER}`;
}

export function generateMemoTemplate(company, reportMarkdown = "") {
  const today = new Date().toISOString().slice(0, 10);
  const statusLine = reportMarkdown.match(/当前状态：(.+?)。/)?.[1] || company.status;

  return `# 投资备忘录

## 公司
${company.nameZh} (${company.ticker})

## 日期
${today}

## 价格
${company.price ? `${company.price} ${company.currency}` : "待输入"}

## 我的投资假设
我正在研究这家公司是否具备长期价值，当前状态为：${statusLine}。

## AI 摘要
${company.summary[0]}

## 乐观论点
${company.bull.map((item) => `- ${item}`).join("\n")}

## 悲观论点
${company.bear.map((item) => `- ${item}`).join("\n")}

## 估值
需要补充每股收益、自由现金流、股息、总股本和净现金假设。

## 安全边际
待估值模型输出悲观 / 基准 / 乐观后判断。

## 关键风险
${company.risks.map((item) => `- ${item}`).join("\n")}

## 我需要监控什么
${company.monitors.map((item) => `- ${item}`).join("\n")}

## 什么会改变我的判断
如果关键假设被公告证伪，或现金流/利润率持续恶化，我需要重新评估。

## 复盘日期
${today}`;
}

export function computeValuation(input) {
  const price = Number(input.price || 0);
  const eps = Number(input.eps || 0);
  const fcf = Number(input.fcf || 0);
  const dividend = Number(input.dividend || 0);
  const peBear = Number(input.peBear || 8);
  const peBase = Number(input.peBase || 12);
  const peBull = Number(input.peBull || 16);
  const fcfYield = Number(input.fcfYield || 0.08);

  const peValues = eps
    ? {
        bear: eps * peBear,
        base: eps * peBase,
        bull: eps * peBull
      }
    : null;

  const fcfValue = fcf && fcfYield ? fcf / fcfYield : null;
  const dividendYield = price && dividend ? dividend / price : null;
  const baseValue = peValues?.base || fcfValue || 0;

  return {
    price,
    assumptions: {
      eps,
      fcf,
      dividend,
      peBear,
      peBase,
      peBull,
      fcfYield
    },
    peValues,
    fcfValue,
    dividendYield,
    marginOfSafety: price && baseValue ? (baseValue - price) / price : null,
    sensitivity: [
      "EPS 每变化 10%，PE 估值区间同步变化。",
      "FCF Yield 假设越高，估值越保守。",
      "如果现金流不可持续，PE 和 FCF Yield 都需要下修。"
    ]
  };
}
