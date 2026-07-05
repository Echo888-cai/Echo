/**
 * Luvio 环境自检（npm run doctor）。
 *
 * 逐能力检查 API key 配置，回答三个问题：
 *   1. 哪些能力现在可用 / 降级 / 不可用？
 *   2. 缺哪个 key 会影响什么？
 *   3. （--live）key 真的能连通吗？
 *
 * 默认只做"存在性"检查，不发任何网络请求（不烧配额）。
 * 加 --live 才对已配置的 key 做最便宜的连通性探活。
 * 退出码恒为 0：doctor 是体检报告，不是门禁。
 */
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFile } from "../src/server/utils/env.js";

const execFileAsync = promisify(execFile);

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const LIVE = process.argv.includes("--live");
const has = (k) => Boolean(process.env[k] && process.env[k].trim());
const firstFmpKey = () =>
  (process.env.FMP_API_KEYS || process.env.FMP_API_KEY || "").split(",")[0]?.trim() || "";

const OK = "✓";
const DEGRADED = "△";
const MISSING = "✗";

/** 每项能力：name、检查函数 → { mark, detail }，可选 liveProbe。 */
const CHECKS = [
  {
    name: "模型（研究大脑）",
    check() {
      const keys = ["GLM_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "MODEL_API_KEY"].filter(has);
      if (keys.length) return { mark: OK, detail: `已配置：${keys.join(", ")}（按 GLM→DeepSeek→OpenAI→Generic 顺序 failover）` };
      return { mark: MISSING, detail: "无任何模型 key → 回答走本地兜底（演示模式），研究质量大幅受限" };
    },
    async liveProbe() {
      const provider = has("DEEPSEEK_API_KEY")
        ? { url: "https://api.deepseek.com/chat/completions", key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro", label: "DeepSeek" }
        : has("GLM_API_KEY")
          ? { url: (process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4") + "/chat/completions", key: process.env.GLM_API_KEY, model: process.env.GLM_MODEL || "glm-4-plus", label: "GLM" }
          : has("OPENAI_API_KEY")
            ? { url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || "gpt-4.1-mini", label: "OpenAI" }
            : null;
      if (!provider) return null;
      const res = await fetch(provider.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${provider.key}` },
        body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 })
      });
      return `${provider.label} ${res.ok ? "连通 ✓" : `HTTP ${res.status} ✗`}`;
    }
  },
  {
    name: "美股行情",
    check() {
      const keys = ["FINNHUB_API_KEY", "ALPHAVANTAGE_API_KEY", "TWELVEDATA_API_KEY"].filter(has);
      if (keys.length) return { mark: OK, detail: `已配置：${keys.join(", ")}（Yahoo 免 key 兜底仍在）` };
      return { mark: DEGRADED, detail: "无 key，仅靠 Yahoo 免费兜底，稳定性差" };
    },
    async liveProbe() {
      if (!has("FINNHUB_API_KEY")) return null;
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_API_KEY}`);
      const j = res.ok ? await res.json() : null;
      return `Finnhub ${j && Number(j.c) > 0 ? "连通 ✓（AAPL 有价）" : `异常 ✗ (HTTP ${res.status})`}`;
    }
  },
  {
    name: "港股行情",
    check() {
      return { mark: OK, detail: "腾讯财经免费源，无需 key（注意：商用前必须替换为授权源，见 docs/PLAN.md §4 商业化合规阻断项）" };
    }
  },
  {
    name: "美股基本面/评级",
    check() {
      if (has("FINNHUB_API_KEY")) return { mark: OK, detail: "Finnhub /stock/metric（免费档真 EPS/PE/ROE）" };
      return { mark: DEGRADED, detail: "缺 FINNHUB_API_KEY → 只剩 Yahoo 零散字段，利润质量分不可靠" };
    }
  },
  {
    name: "公司搜索/代码解析",
    check() {
      if (firstFmpKey()) return { mark: OK, detail: `FMP key ×${(process.env.FMP_API_KEYS || process.env.FMP_API_KEY || "").split(",").filter(Boolean).length}（多 key 自动轮换冷却）` };
      return { mark: DEGRADED, detail: "缺 FMP_API_KEY → 英文名/拼音搜代码不可用，中文别名表仍可用" };
    },
    async liveProbe() {
      const key = firstFmpKey();
      if (!key) return null;
      const res = await fetch(`https://financialmodelingprep.com/stable/search-name?query=apple&limit=1&apikey=${key}`);
      return `FMP ${res.ok ? "连通 ✓" : `HTTP ${res.status} ✗（402=免费档被墙的端点，正常）`}`;
    }
  },
  {
    name: "价格曲线（公司页）",
    check() {
      const keys = ["TWELVEDATA_API_KEY"].filter(has);
      if (keys.length || firstFmpKey()) return { mark: OK, detail: "美股 TwelveData/FMP，港股腾讯免费" };
      return { mark: DEGRADED, detail: "缺 TWELVEDATA/FMP → 美股曲线可能缺失，港股不受影响" };
    },
    async liveProbe() {
      if (!has("TWELVEDATA_API_KEY")) return null;
      const res = await fetch(`https://api.twelvedata.com/price?symbol=AAPL&apikey=${process.env.TWELVEDATA_API_KEY}`);
      const j = res.ok ? await res.json() : null;
      return `TwelveData ${j && j.price ? "连通 ✓" : `异常 ✗（${j?.message || res.status}）`}`;
    }
  },
  {
    name: "网页证据检索",
    check() {
      if (has("TAVILY_API_KEY")) return { mark: OK, detail: "Tavily（免费 1000 次/月）" };
      if (has("SERPAPI_API_KEY")) return { mark: OK, detail: "SerpAPI" };
      return { mark: DEGRADED, detail: "无 key → 走 DuckDuckGo/Bing 抓取，覆盖率与稳定性差；强烈建议配 TAVILY_API_KEY" };
    }
  },
  {
    name: "港股一手 PDF 抽取（python3/pdfminer）",
    // 本地子进程检查，不是网络探活，所以放进 check() 常跑（不需要 --live）：
    // refreshHkFinancialsInBackground 是 fire-and-forget，机器没装 python3/pdfminer 时
    // 港股一手数据会永久静默缺失，doctor 之前完全没有这一项检查（E2）。
    async check() {
      try {
        await execFileAsync("python3", ["--version"]);
      } catch {
        return { mark: MISSING, detail: "未找到 python3 → scripts/extract_pdf_text.py 无法执行，港股一手财报（HKEX PDF）会静默永远缺失，估值退化成机械 PE 带" };
      }
      try {
        await execFileAsync("python3", ["-c", "import pdfminer"]);
      } catch {
        return { mark: MISSING, detail: "python3 已装但缺 pdfminer.six（pip install pdfminer.six）→ 港股一手财报静默永远缺失" };
      }
      return { mark: OK, detail: "python3 + pdfminer.six 就绪，HKEX 一手财报抽取管道可用" };
    }
  },
  {
    name: "SEC 一手文件",
    check() {
      if (has("SEC_USER_AGENT")) return { mark: OK, detail: `UA 已配置（SEC 要求带联系方式的 UA）` };
      return { mark: DEGRADED, detail: "缺 SEC_USER_AGENT → EDGAR 请求可能被限流（格式：'名字 邮箱'）" };
    }
  },
  {
    name: "通知推送（Telegram）",
    check() {
      if (has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_CHAT_ID")) return { mark: OK, detail: "已配置，盘前摘要/触线提醒可推送" };
      if (has("TELEGRAM_BOT_TOKEN")) return { mark: DEGRADED, detail: "有 token 缺 TELEGRAM_CHAT_ID（给 bot 发条消息后访问 getUpdates 拿 chat id）" };
      return { mark: DEGRADED, detail: "未配置 → Web 内通知中心照常，仅无法推到手机。配法见 docs/PLAN.md" };
    },
    async liveProbe() {
      if (!has("TELEGRAM_BOT_TOKEN")) return null;
      const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
      const j = res.ok ? await res.json() : null;
      return `Telegram ${j?.ok ? `连通 ✓（@${j.result?.username}）` : "token 无效 ✗"}`;
    }
  }
];

const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve("探活超时 ✗"), ms));

console.log(`\nLuvio doctor — 环境自检${LIVE ? "（含连通性探活）" : "（仅配置检查，加 --live 做连通性探活）"}\n`);

let degraded = 0;
for (const item of CHECKS) {
  const { mark, detail } = await item.check();
  if (mark !== OK) degraded += 1;
  console.log(`  ${mark} ${item.name}`);
  console.log(`     ${detail}`);
  if (LIVE && item.liveProbe) {
    try {
      const live = await Promise.race([item.liveProbe(), timeout(8000)]);
      if (live) console.log(`     ↳ ${live}`);
    } catch (err) {
      console.log(`     ↳ 探活失败 ✗（${err?.message || err}）`);
    }
  }
}

console.log(`\n结论：${degraded === 0 ? "全部能力就绪。" : `${degraded} 项降级/缺失（见上）。核心研究至少需要：一个模型 key + FINNHUB_API_KEY。`}`);
console.log("提示：key 写进项目根目录 .env（参考 .env.example）；改完重启 node 进程生效。\n");
