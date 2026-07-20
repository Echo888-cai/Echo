import assert from "node:assert/strict";
import {
  HK_COMPANY_ALIASES,
  US_COMPANY_ALIASES,
  HK_US_LINKS,
  dualListings,
  dualListingByTicker,
  dualListingByName,
  adrForHk
} from "../src/companyAliases.js";

// ── 表完整性：底账里的每条记录必须自洽 ─────────────────────────────────
for (const link of HK_US_LINKS) {
  assert.match(link.hk, /^\d{4}\.HK$/, `hk 代码格式错误: ${link.nameZh}`);
  assert.ok(link.adr, `adr 缺失: ${link.nameZh}`);
  if (link.kind === "dual_primary") {
    assert.ok(link.us, `dual_primary 必须有可交易美股腿: ${link.nameZh}`);
    assert.equal(link.us, link.adr, `dual_primary 的 adr 应与 us 同符号: ${link.nameZh}`);
    assert.ok(link.pattern instanceof RegExp, `dual_primary 必须带点名匹配 pattern: ${link.nameZh}`);
  } else {
    assert.equal(link.kind, "adr_otc", `未知 kind: ${link.nameZh}`);
    assert.equal(link.us, null, `adr_otc 不得声称有可交易美股腿: ${link.nameZh}`);
  }
}
// 同一腿代码不得出现在两条记录里（BABA/9618 曾在两张表重复登记——合并的动机之一）。
const legs = HK_US_LINKS.flatMap((link) => [link.hk, link.us].filter(Boolean));
assert.equal(new Set(legs).size, legs.length, "同一代码出现在多条 HK_US_LINKS 记录里");

// ── 双重上市查询语义 ─────────────────────────────────────────────────
assert.equal(dualListingByTicker("9988.HK")?.us, "BABA");
assert.equal(dualListingByTicker("BABA")?.hk, "9988.HK");
assert.equal(dualListingByTicker("0700.HK"), null, "TCEHY 是 OTC 替身，不构成双重上市");
assert.equal(dualListingByName("alibaba最近怎么样")?.hk, "9988.HK");
assert.equal(dualListingByName("bilibili还在亏吗")?.us, "BILI");
assert.equal(dualListingByName("腾讯怎么样"), null);
assert.ok(dualListings().every((link) => link.kind === "dual_primary"));

// ── ADR 数据替身（Finnhub 免费档用）─────────────────────────────────────
assert.equal(adrForHk("0700.HK"), "TCEHY");
assert.equal(adrForHk("700"), "TCEHY");
assert.equal(adrForHk("9988.HK"), "BABA");
assert.equal(adrForHk("1024.HK"), null, "无人工核实条目必须诚实返回 null");

// ── 别名表：英文名是一等公民（2026-07-20 "alibaba 没反应"缺陷的回归线）──
const hkAliasHits = [
  ["tencent", "0700.HK"],
  ["meituan", "3690.HK"],
  ["xiaomi", "1810.HK"],
  ["kuaishou", "1024.HK"],
  ["netease", "9999.HK"],
  ["阿里巴巴", "9988.HK"],
  ["alibaba", "9988.HK"]
];
for (const [text, ticker] of hkAliasHits) {
  const hit = HK_COMPANY_ALIASES.find((item) => item.pattern.test(text));
  assert.equal(hit?.ticker, ticker, `HK 别名未命中: ${text}`);
}
const usAliasHits = [
  ["nvidia", "NVDA"],
  ["英伟达", "NVDA"],
  ["BABA", "BABA"]
];
for (const [text, ticker] of usAliasHits) {
  const hit = US_COMPANY_ALIASES.find((item) => item.pattern.test(text));
  assert.equal(hit?.ticker, ticker, `US 别名未命中: ${text}`);
}
// 反向：别名不得误伤（"阿里健康" 不能落到 9988）。
assert.equal(HK_COMPANY_ALIASES.find((item) => item.pattern.test("阿里健康怎么样"))?.ticker, "0241.HK");

console.log("Company aliases & dual-listing ledger ✓");
