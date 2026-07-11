/**
 * CN (A股) Stock Universe — staged coverage: 主板 + 创业板核心公司 only
 * (科创板/STAR Market 688xxx intentionally excluded from this seed — detectMarket()
 * still classifies it as CN for future-proofing, it's just not in the curated universe yet).
 *
 * Format: [ticker, nameZh, nameEn, sector, industry, isCsi300]
 *   ticker: 6-digit code + .SS (上交所/Shanghai) or .SZ (深交所/Shenzhen)
 *   isCsi300: 1 = CSI 300 (沪深300) constituent or comparable large-cap core name, 0 = smaller core name
 *
 * This is a curated starting set (主板+创业板龙头), not full A股 coverage (5000+ names).
 * Expand by appending rows in the same format — sector taxonomy is free-text like hkStocks.js,
 * not limited to the legacy sectorDefaults keys in data.js.
 */
const stocks = [
  // ═══════════════════════════════════════════════════════════════
  // 1. 消费 · 白酒/食品饮料/家电 (Consumer — Baijiu/F&B/Appliances)
  // ═══════════════════════════════════════════════════════════════
  ["600519.SS", "贵州茅台", "Kweichow Moutai Co Ltd", "消费", "白酒", 1],
  ["000858.SZ", "五粮液", "Wuliangye Yibin Co Ltd", "消费", "白酒", 1],
  ["600809.SS", "山西汾酒", "Shanxi Xinghuacun Fen Wine Factory Co Ltd", "消费", "白酒", 1],
  ["000568.SZ", "泸州老窖", "Luzhou Laojiao Co Ltd", "消费", "白酒", 1],
  ["002304.SZ", "洋河股份", "Jiangsu Yanghe Brewery Joint-Stock Co Ltd", "消费", "白酒", 1],
  ["600887.SS", "伊利股份", "Inner Mongolia Yili Industrial Group Co Ltd", "消费", "乳制品", 1],
  ["603288.SS", "海天味业", "Foshan Haitian Flavouring and Food Co Ltd", "消费", "调味品", 1],
  ["000333.SZ", "美的集团", "Midea Group Co Ltd", "消费", "家电", 1],
  ["000651.SZ", "格力电器", "Gree Electric Appliances Inc of Zhuhai", "消费", "家电", 1],
  ["600690.SS", "海尔智家", "Haier Smart Home Co Ltd", "消费", "家电", 1],
  ["002714.SZ", "牧原股份", "Muyuan Foods Co Ltd", "消费", "生猪养殖", 1],
  ["000895.SZ", "双汇发展", "Henan Shuanghui Investment & Development Co Ltd", "消费", "肉制品", 1],
  ["000876.SZ", "新希望", "New Hope Liuhe Co Ltd", "消费", "农牧饲料", 0],
  ["601888.SS", "中国中免", "China Tourism Group Duty Free Corp Ltd", "消费", "免税零售", 1],

  // ═══════════════════════════════════════════════════════════════
  // 2. 金融与保险 (Financials & Insurance)
  // ═══════════════════════════════════════════════════════════════
  ["601318.SS", "中国平安", "Ping An Insurance Group Co of China Ltd", "金融与保险", "综合金融", 1],
  ["600036.SS", "招商银行", "China Merchants Bank Co Ltd", "金融与保险", "商业银行", 1],
  ["601166.SS", "兴业银行", "Industrial Bank Co Ltd", "金融与保险", "商业银行", 1],
  ["601398.SS", "工商银行", "Industrial and Commercial Bank of China Ltd", "金融与保险", "商业银行", 1],
  ["601288.SS", "农业银行", "Agricultural Bank of China Ltd", "金融与保险", "商业银行", 1],
  ["601988.SS", "中国银行", "Bank of China Ltd", "金融与保险", "商业银行", 1],
  ["601939.SS", "建设银行", "China Construction Bank Corp", "金融与保险", "商业银行", 1],
  ["000001.SZ", "平安银行", "Ping An Bank Co Ltd", "金融与保险", "商业银行", 1],
  ["002142.SZ", "宁波银行", "Bank of Ningbo Co Ltd", "金融与保险", "商业银行", 1],
  ["601601.SS", "中国太保", "China Pacific Insurance Group Co Ltd", "金融与保险", "综合保险", 1],
  ["601628.SS", "中国人寿", "China Life Insurance Co Ltd", "金融与保险", "寿险", 1],
  ["600030.SS", "中信证券", "CITIC Securities Co Ltd", "金融与保险", "证券", 1],
  ["300059.SZ", "东方财富", "East Money Information Co Ltd", "金融与保险", "互联网券商", 1],
  ["300033.SZ", "同花顺", "Hithink RoyalFlush Information Network Co Ltd", "金融与保险", "金融软件", 0],

  // ═══════════════════════════════════════════════════════════════
  // 3. 新能源 (New Energy — Battery/Solar/Power Equipment)
  // ═══════════════════════════════════════════════════════════════
  ["300750.SZ", "宁德时代", "Contemporary Amperex Technology Co Ltd (CATL)", "新能源", "动力电池", 1],
  ["601012.SS", "隆基绿能", "LONGi Green Energy Technology Co Ltd", "新能源", "光伏", 1],
  ["600438.SS", "通威股份", "Tongwei Co Ltd", "新能源", "光伏硅料", 1],
  ["300274.SZ", "阳光电源", "Sungrow Power Supply Co Ltd", "新能源", "光伏逆变器", 1],

  // ═══════════════════════════════════════════════════════════════
  // 4. 汽车与智能制造 (Auto & Smart Manufacturing)
  // ═══════════════════════════════════════════════════════════════
  ["002594.SZ", "比亚迪", "BYD Co Ltd", "汽车与智能制造", "新能源汽车", 1],
  ["600031.SS", "三一重工", "Sany Heavy Industry Co Ltd", "工业制造", "工程机械", 1],
  ["300124.SZ", "汇川技术", "Shenzhen Inovance Technology Co Ltd", "工业制造", "工业自动化", 1],

  // ═══════════════════════════════════════════════════════════════
  // 5. 科技互联网 / 半导体 / 硬件 (Tech, Semiconductors, Hardware)
  // ═══════════════════════════════════════════════════════════════
  ["000725.SZ", "京东方A", "BOE Technology Group Co Ltd", "科技互联网", "半导体显示", 1],
  ["000063.SZ", "中兴通讯", "ZTE Corp", "科技互联网", "通信设备", 1],
  ["002415.SZ", "海康威视", "Hangzhou Hikvision Digital Technology Co Ltd", "科技互联网", "安防监控", 1],
  ["002475.SZ", "立讯精密", "Luxshare Precision Industry Co Ltd", "科技互联网", "电子制造服务", 1],
  ["002236.SZ", "大华股份", "Zhejiang Dahua Technology Co Ltd", "科技互联网", "安防监控", 0],
  ["002230.SZ", "科大讯飞", "iFlytek Co Ltd", "科技互联网", "人工智能语音", 1],
  ["600745.SS", "闻泰科技", "Wingtech Technology Co Ltd", "科技互联网", "半导体制造", 1],
  ["600570.SS", "恒生电子", "Hundsun Technologies Inc", "科技互联网", "金融软件", 0],
  ["601360.SS", "三六零", "Qihoo 360 Technology Co Ltd", "科技互联网", "网络安全", 0],
  ["300454.SZ", "深信服", "Sangfor Technologies Inc", "科技互联网", "网络安全", 0],

  // ═══════════════════════════════════════════════════════════════
  // 6. 医药 (Pharma & Healthcare)
  // ═══════════════════════════════════════════════════════════════
  ["600276.SS", "恒瑞医药", "Jiangsu Hengrui Pharmaceuticals Co Ltd", "医药", "创新药", 1],
  ["603259.SS", "药明康德", "WuXi AppTec Co Ltd", "医药", "医药外包CRO", 1],
  ["300760.SZ", "迈瑞医疗", "Shenzhen Mindray Bio-Medical Electronics Co Ltd", "医药", "医疗器械", 1],
  ["300015.SZ", "爱尔眼科", "Aier Eye Hospital Group Co Ltd", "医药", "医疗服务", 1],
  ["000538.SZ", "云南白药", "Yunnan Baiyao Group Co Ltd", "医药", "中药", 1],
  ["300142.SZ", "沃森生物", "Yunnan Walvax Biotechnology Co Ltd", "医药", "疫苗", 0],

  // ═══════════════════════════════════════════════════════════════
  // 7. 能源与原材料 (Energy & Materials)
  // ═══════════════════════════════════════════════════════════════
  ["600028.SS", "中国石化", "China Petroleum & Chemical Corp (Sinopec)", "能源与原材料", "石油化工", 1],
  ["601857.SS", "中国石油", "PetroChina Co Ltd", "能源与原材料", "石油天然气", 1],
  ["601088.SS", "中国神华", "China Shenhua Energy Co Ltd", "能源与原材料", "煤炭", 1],
  ["601899.SS", "紫金矿业", "Zijin Mining Group Co Ltd", "能源与原材料", "有色金属", 1],
  ["002493.SZ", "荣盛石化", "Rongsheng Petro Chemical Co Ltd", "能源与原材料", "炼化", 0],

  // ═══════════════════════════════════════════════════════════════
  // 8. 电信与公用事业 (Telecom & Utilities)
  // ═══════════════════════════════════════════════════════════════
  ["600900.SS", "长江电力", "China Yangtze Power Co Ltd", "电信与公用事业", "水力发电", 1],
  ["601728.SS", "中国电信", "China Telecom Corp Ltd", "电信与公用事业", "电信运营", 1],
  ["600050.SS", "中国联通", "China United Network Communications Ltd", "电信与公用事业", "电信运营", 1],

  // ═══════════════════════════════════════════════════════════════
  // 9. 地产建筑 / 工业制造 (Property & Construction / Industrials)
  // ═══════════════════════════════════════════════════════════════
  ["000002.SZ", "万科A", "China Vanke Co Ltd", "地产建筑", "地产发展", 1],
  ["601668.SS", "中国建筑", "China State Construction Engineering Corp Ltd", "地产建筑", "建筑工程", 1],
  ["601390.SS", "中国中铁", "China Railway Group Ltd", "地产建筑", "基建工程", 1],
  ["600585.SS", "海螺水泥", "Anhui Conch Cement Co Ltd", "工业制造", "水泥建材", 1],
  ["002271.SZ", "东方雨虹", "Beijing Oriental Yuhong Waterproof Technology Co Ltd", "工业制造", "建筑材料", 0],

  // ═══════════════════════════════════════════════════════════════
  // 10. 运输物流 / 媒体与娱乐 (Logistics / Media)
  // ═══════════════════════════════════════════════════════════════
  ["002352.SZ", "顺丰控股", "SF Holding Co Ltd", "运输物流", "快递物流", 1],
  ["002027.SZ", "分众传媒", "Focus Media Information Technology Co Ltd", "媒体与娱乐", "广告传媒", 0]
];

export default stocks;
