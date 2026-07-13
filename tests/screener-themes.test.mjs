// EA-3 测试：深化选股——细分赛道词典解析（parseScreenerQuery 的 curatedTickers）。
// 只测纯函数部分（无网络）；rankByQuality/runScreener 依赖财务数据网络请求，
// 留给非沙箱端到端验证（见 npm run doctor / 浏览器实测）。
import { parseScreenerQuery } from "../src/server/services/discovery.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] 细分赛道命中 curatedTickers（FMP industry 枚举装不下的主题）");
{
  const f = parseScreenerQuery("做光互联的美股哪些值得买");
  check("命中赛道标签：光模块/光通信", f.sectorLabel === "光模块/光通信");
  check("带 curatedTickers 名单", Array.isArray(f.curatedTickers) && f.curatedTickers.length >= 2);
  check("龙头名单含 Coherent(COHR)", f.curatedTickers.some((t) => t.ticker === "COHR"));
}
{
  const f = parseScreenerQuery("美股存储芯片有什么好标的");
  check("命中赛道标签：存储芯片/HBM", f.sectorLabel === "存储芯片/HBM");
  check("龙头名单含美光(MU)", f.curatedTickers.some((t) => t.ticker === "MU"));
}
{
  const f = parseScreenerQuery("液冷概念的美股龙头");
  check("命中赛道标签：液冷/数据中心热管理", f.sectorLabel === "液冷/数据中心热管理");
  check("龙头名单含 Vertiv(VRT)", f.curatedTickers.some((t) => t.ticker === "VRT"));
}
{
  const f = parseScreenerQuery("美股EDA龙头有哪些");
  check("命中赛道标签：EDA", f.sectorLabel === "EDA");
  check("龙头名单含 Synopsys(SNPS)", f.curatedTickers.some((t) => t.ticker === "SNPS"));
}
{
  const f = parseScreenerQuery("半导体设备龙头股");
  check("命中赛道标签：半导体设备", f.sectorLabel === "半导体设备");
  check("龙头名单含 ASML", f.curatedTickers.some((t) => t.ticker === "ASML"));
}

console.log("[2] 细分赛道优先于通用大类（不被“半导体”这个更泛的词抢走）");
{
  const f = parseScreenerQuery("美股半导体设备龙头");
  check("半导体设备命中细分条目而非通用半导体（有 curatedTickers）", Array.isArray(f.curatedTickers));
  check("industry 字段为空（走的是 curated 分支不是 FMP industry 枚举）", f.industry === null);
}

console.log("[3] 通用大类查询不受影响（零回归）");
{
  const f = parseScreenerQuery("帮我筛美股半导体 PE小于20");
  check("普通半导体查询仍走 industry=Semiconductors", f.industry === "Semiconductors");
  check("普通半导体查询没有 curatedTickers", f.curatedTickers === null);
}
{
  const f = parseScreenerQuery("港股医药里挑几只市值大于1千亿的");
  check("非细分赛道查询 curatedTickers 为 null", f.curatedTickers === null);
}

console.log(`\nEA-3: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
