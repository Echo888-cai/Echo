// B-6 测试：港股 filings 覆盖——三表解析从"只认腾讯/阿里这类标准两栏格式"扩到能处理
// 更多真实版式差异。用真实港股公告里发现的具体格式坑作为回归夹具（浏览器实测 4 个
// 不同行业/格式的真实 PDF 抽出的文本片段）：
//   - 小鵬（新能源车）：PDF 生成工具逐字符分词 + 4 栏（去年同季/上季/本季/美元换算）
//     + 半角/全角括号混用 + 无"截至…止…日"从句的标题 + 摘要表数字量级/列序和正式三表相反
//   - 汇丰（银行）：字体子集把常见汉字编码成外观相同但码位不同的康熙部首变体（NFKC 可折回）
//     + "单位在前"的币种单位表述（百萬美元）+ 分部拆分表和合并总表共用词汇
//   - 阿里：币种表头行有额外非币种说明列（"人民幣 人民幣 美元 %同比變動"）
//   - AIA（寿险）：附注分项表也以"收入"开头，解析出负数收入——护栏应拒绝而不是吐脏数字
import "./setupTestDb.mjs";
import {
  collapseCharSpacing, normalizeCjkVariants, parseResultsText, parsePeriodFromTitle, detectColumnOrder
} from "../src/server/services/hkFilingsPipeline.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] collapseCharSpacing：逐字符分词坍缩，不动列间距（≥2 空格）");
{
  check(
    "逐字坍缩：中文+数字混排",
    collapseCharSpacing("小 鵬 汽 車 發 佈 2 0 2 5 年 第 四 季 度") === "小鵬汽車發佈2025年第四季度"
  );
  check(
    "不动分栏空格（≥2 个）",
    collapseCharSpacing("總收入  16,105,096  20,380,950") === "總收入  16,105,096  20,380,950"
  );
  check("空字符串不报错", collapseCharSpacing("") === "");
}

console.log("[2] normalizeCjkVariants：康熙部首变体折回标准汉字（NFKC）");
{
  check(
    "汇丰式变体折回",
    normalizeCjkVariants("截⾄2025年12⽉31⽇⽌年度") === "截至2025年12月31日止年度"
  );
  check("正常文本不受影响", normalizeCjkVariants("截至2025年12月31日止年度") === "截至2025年12月31日止年度");
}

console.log("[3] parsePeriodFromTitle：无「截至…止…日」从句的标题");
{
  const dual = parsePeriodFromTitle("小鵬汽車發佈2025年第四季度及2025財政年度的未經審計財務業績");
  check("Q4+FY 合刊标题按季度处理（不被「财政年度」误判成 FY）", dual.periodType === "Q4", JSON.stringify(dual));
  check("季末日推导正确", dual.periodEnd === "2025-12-31");

  const q1 = parsePeriodFromTitle("小鵬集團發佈2026年第一季度的未經審計財務業績");
  check("单季标题", q1.periodType === "Q1" && q1.periodEnd === "2026-03-31");

  const bare = parsePeriodFromTitle("2025年業績");
  check("裸年度标题（汇丰式）按 FY 处理", bare.periodType === "FY" && bare.periodEnd === "2025-12-31", JSON.stringify(bare));
}

console.log("[4] parseResultsText：小鵬式 4 栏（去年同季/上季/本季/美元换算）+ 半角括号");
const XPENG_STYLE = [
  "主要財務業績",
  "（以人民幣十億元計，百分比除外）",
  "總收入  22.25  20.38  16.11  38.2%  9.2%", // 摘要表（列序相反、精度粗糙）——应被跳过
  "管理層評語",
  "未經審計簡明綜合全面收益╱（虧損）表",
  "（除美國存託股／普通股及每股美國存託股／普通股數據外，所有金額均以千計）",
  "截至以下日期止三個月",
  "2024年  2025年  2025年  2025年",
  "12月31日  9月30日  12月31日  12月31日",
  "人民幣  人民幣  人民幣  美元",
  "總收入  16,105,096  20,380,950  22,253,759  3,182,246",
  "毛利  2,324,777  4,104,253  4,741,806  678,070",
  "經營虧損  (1,556,013)  (751,048)  (44,258)  (6,328)",
  "淨(虧損)收益  (1,329,973)  (380,868)  383,208  54,800",
  "XPeng Inc.普通股股東",
  "應佔淨(虧損)收益  (1,329,973)  (380,868)  383,208  54,800",
  "普通股股東應佔每股普通股",
  "淨（虧損）收益",
  "基本  (0.70)  (0.20)  0.20  0.03"
].join("\n");
{
  const p = parseResultsText(XPENG_STYLE, { periodType: "Q4" });
  check("跳过摘要表，取正式三表的收入（本期在数字列最后一栏）", p.fields.revenue?.current === 22253759000, `got ${p.fields.revenue?.current}`);
  check("收入去年同期正确（数字列第一栏）", p.fields.revenue?.prior === 16105096000);
  check("经营亏损（半角括号负数）", p.fields.operatingIncome?.current === -44258000);
  check("净收益（半角括号+全角括号任一种都认）", p.fields.netIncome?.current === 383208000);
  check("归属股东净收益（两行拆分标签也认）", p.fields.netIncomeAttributable?.current === 383208000);
  check("EPS 两行头 + 无破折号「基本」行（量级护栏排除加权股数行）", p.fields.eps?.current === 0.2, `got ${p.fields.eps?.current}`);
  check("EPS 不取美元换算列（0.03）", p.fields.eps?.current !== 0.03);
}

console.log("[5] parseResultsText：阿里式币种表头带额外说明列（非纯币种也要识别前缀）");
const ALI_STYLE = [
  "3 月份季度財務業績概要",
  "截至 3 月 31 日止三個月",
  "2025  2026",
  "人民幣  人民幣  美元  %同比變動",
  "（以百萬計，百分比及每股數據除外）",
  "收入  236,454  243,380  35,283  3%",
  "淨利潤  11,973  23,502  3,407  96%"
].join("\n");
{
  const p = parseResultsText(ALI_STYLE, { periodType: "Q1" });
  check("丢弃尾栏美元换算，取本期人民币值（不是最后一栏的美元数）", p.fields.revenue?.current === 243380e6, `got ${p.fields.revenue?.current}`);
  check("去年同期正确", p.fields.revenue?.prior === 236454e6);
  check("净利润同理", p.fields.netIncome?.current === 23502e6);
}

console.log("[6] parseResultsText：汇丰式银行业词汇 + 单位在前的币种表述");
const HSBC_STYLE = [
  "主要財務衡量指標",
  "截至下列年份止年度",
  "列賬基準業績  2025年  2024年  2023年",
  "每股基本盈利（美元）  1.21  1.25  1.15", // 摘要表——应被跳过
  "綜合收益表",
  "截至2025年12月31日止年度",
  "2025年  2024年",
  "百萬美元  百萬美元",
  "營業收益淨額  64,424  62,440",
  "營業利潤  27,996  29,397",
  "本年度利潤  23,131  24,999",
  "應佔：",
  "－母公司普通股股東  21,102  22,917",
  "每股普通股基本盈利  1.21  1.25"
].join("\n");
{
  const p = parseResultsText(HSBC_STYLE, { periodType: "FY" });
  check("跳过摘要表，取正式合并收益表的营收（单位在前「百萬美元」也能识别）", p.fields.revenue?.current === 64424e6, `got ${p.fields.revenue?.current}`);
  check("营业利润（银行业词汇）", p.fields.operatingIncome?.current === 27996e6);
  check("本年度利润（银行业词汇，非「期內盈利」）", p.fields.netIncome?.current === 23131e6);
  check("归属母公司股东（「母公司普通股股東」标签，非「本公司...應佔」）", p.fields.netIncomeAttributable?.current === 21102e6);
  check("EPS（「每股普通股基本盈利」顺序变体）", p.fields.eps?.current === 1.21);
}

console.log("[7] detectColumnOrder：回归（不影响既有腾讯/阿里两栏判断）");
{
  check("阿里式 prior-first", detectColumnOrder("2024  2025") === "prior-first");
  check("腾讯式 current-first", detectColumnOrder("二零二六年 二零二五年") === "current-first");
  check("同年重复不是表头", detectColumnOrder("2025年 2025年 2024年") === null);
}

console.log("[8] parseResultsText：AIA 式附注分项表（营收为负是不可信信号，ingestHkFinancials 会拒收）");
const AIA_NOTE_STYLE = [
  "其他收入及開支附註",
  "收入/(開支)  –  –  –  –  759  (111)  (723)  –  –  –  (75)"
].join("\n");
{
  const p = parseResultsText(AIA_NOTE_STYLE, { periodType: "FY" });
  check(
    "附注分项表确实会解析出负收入（验证 ingestHkFinancials 里的负值护栏有必要且能命中）",
    p.fields.revenue?.current < 0,
    JSON.stringify(p.fields.revenue)
  );
}

console.log(`\nB-6: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
