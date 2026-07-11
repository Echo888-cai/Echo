// P-CN-1 测试：market.js 三路市场识别（US/HK/CN）。纯函数，不发网络请求。
import {
  detectMarket, isUS, isCN, bareSymbol, hkCode, cnCode, cnExchange, cnTicker,
  marketCurrency, marketLabel, tencentSymbol, sinaSymbol, eastmoneySymbol
} from "../src/market.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] detectMarket：三路识别，6 位裸数字优先于港股 1-5 位规则");
{
  check("美股 .US 后缀", detectMarket("AAPL.US") === "US");
  check("美股裸代码", detectMarket("AAPL") === "US");
  check("港股 .HK 后缀", detectMarket("0700.HK") === "HK");
  check("港股裸数字（≤5 位）", detectMarket("700") === "HK");
  check("A 股 .SS 后缀", detectMarket("600519.SS") === "CN");
  check("A 股 .SZ 后缀", detectMarket("000001.SZ") === "CN");
  check("A 股裸 6 位数字（此前会被误判成 HK，见 format.js 历史 bug）", detectMarket("600519") === "CN");
  check("A 股裸 6 位数字（深交所）", detectMarket("000001") === "CN");
  check("isUS/isCN 互斥", isUS("AAPL") && !isCN("AAPL") && isCN("600519.SS") && !isUS("600519.SS"));
}

console.log("[2] cnCode / cnExchange / cnTicker：6 位代码不做零填充（区别于 hkCode 的 4 位零填充）");
{
  check("cnCode 保留完整 6 位，不截断不填充", cnCode("600519.SS") === "600519");
  check("cnCode 对裸数字同样有效", cnCode("000001") === "000001");
  check("hkCode 零填充到 4 位（回归，确认没被 CN 改动影响）", hkCode("700") === "0700");
  check("cnExchange：60/68 开头 → SS（上交所）", cnExchange("600519") === "SS" && cnExchange("688981") === "SS");
  check("cnExchange：0/00/300 开头 → SZ（深交所）", cnExchange("000001") === "SZ" && cnExchange("300750") === "SZ");
  check("cnTicker 补全正确后缀", cnTicker("600519") === "600519.SS" && cnTicker("000001") === "000001.SZ");
}

console.log("[3] marketCurrency / marketLabel：三路分支（此前只有 US/HK 两路）");
{
  check("美股 USD / 美股标签", marketCurrency("AAPL") === "USD" && marketLabel("AAPL") === "美股");
  check("港股 HKD / 港股标签", marketCurrency("0700.HK") === "HKD" && marketLabel("0700.HK") === "港股");
  check("A 股 CNY / A股标签", marketCurrency("600519.SS") === "CNY" && marketLabel("600519.SS") === "A股");
}

console.log("[4] Per-provider symbol spelling：新增的 CN 分支 + 已有分支不受影响");
{
  check("bareSymbol 也能剥离 .SS/.SZ 后缀", bareSymbol("600519.SS") === "600519" && bareSymbol("000001.SZ") === "000001");
  check("tencentSymbol：CN 用 sh/sz 前缀（腾讯真实接口格式，见 P-CN-1 实测）", tencentSymbol("600519.SS") === "sh600519" && tencentSymbol("000001.SZ") === "sz000001");
  check("tencentSymbol：HK 回归不受影响", tencentSymbol("700") === "hk00700");
  check("tencentSymbol：US 回归不受影响", tencentSymbol("AAPL") === "usAAPL");
  check("sinaSymbol：CN-only，同 sh/sz 前缀约定", sinaSymbol("600519.SS") === "sh600519" && sinaSymbol("000001.SZ") === "sz000001");
  check("eastmoneySymbol：secid 格式 SSE=1/SZSE=0", eastmoneySymbol("600519.SS") === "1.600519" && eastmoneySymbol("000001.SZ") === "0.000001");
}

console.log(`\nP-CN-1: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
