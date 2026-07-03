// ── Markdown 渲染 + 研究回答结构化分段 ─────────────────────
import { esc } from "./format.js";

function linkifyEscaped(text = "") {
  return String(text).replace(/(https?:\/\/[^\s<]+)/g, (match) => {
    const trailing = match.match(/[)，。；、,.!?)]+$/)?.[0] || "";
    const url = match.slice(0, match.length - trailing.length);
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });
}

// 行内格式：[文字](链接) → 链接 → 转义 → 裸链接化 → **粗体**。所有行（段落 / 列表 /
// 编号 / 标题）统一走这里，避免编号行漏掉加粗导致 ** 原样漏出。
// Markdown 链接用私有区占位符隔离，避免被后面的裸链接化二次包裹。
function inlineFormat(text = "") {
  const links = [];
  const staged = String(text).replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    links.push({ label, url });
    return `${links.length - 1}`;
  });
  let out = linkifyEscaped(esc(staged)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(\d+)/g, (_m, i) => {
    const { label, url } = links[Number(i)] || {};
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "";
  });
  return out;
}

export function markdownToHtml(markdown = "") {
  const lines = String(markdown).split(/\r?\n/);
  const html = [];
  let inList = false;
  const sectionTitle = /^(简单说|简单结论|拆开看|关键判断|主要风险|主要竞争对手|怎么理解竞争格局|接下来重点看|已抓到的外部信号|结论|事实|推断|估值\s*\/\s*风险|动作|数据缺口|证据缺口|证伪条件|我的判断|来源|深度研究)$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (line.startsWith("### ")) html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) html.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) html.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
    else if (sectionTitle.test(line)) html.push(`<h3>${esc(line)}</h3>`);
    else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (/^\d+[.、]\s+/.test(line)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p class="numbered-line">${inlineFormat(line)}</p>`);
    } else {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p>${inlineFormat(line)}</p>`);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

// 研究段落标题 → 语气 tone（用于结构化层级与重点提权）。覆盖 prompt 里所有模式
// （泛研究 / 赚钱 / 护城河 / 竞争 / 证伪）用到的段落名，之前有一半没被识别。
const SECTION_TONES = [
  [/^(结论|我的判断)$/, "verdict"],
  [/^简单(说|结论)$/, "lead"],
  [/^事实$/, "facts"],
  [/^(推断|拆开看|怎么理解竞争格局)$/, "reason"],
  [/^估值\s*\/\s*风险$/, "valuation"],
  [/^(主要风险|风险\s*\/\s*证伪|证伪条件|会推翻逻辑的关键事实)$/, "risk"],
  [/^动作$/, "action"],
  [/^(还缺什么|数据缺口|证据缺口)/, "gap"],
  [/^来源[:：]?$/, "sources"],
  [/^(靠什么赚钱|利润质量|现金流|商业模式|护城河拆解|关键判断|主要竞争对手|接下来重点看|下一步看什么|怎么提前观察|已抓到的外部信号|深度研究)$/, "neutral"]
];

const SECTION_LABEL_EN = {
  verdict: "VERDICT", lead: "TL;DR", facts: "FACTS", reason: "ANALYSIS",
  valuation: "VALUATION", risk: "RISK", action: "ACTION", gap: "GAPS", sources: "SOURCES", neutral: ""
};

function sectionToneOf(line = "") {
  for (const [re, tone] of SECTION_TONES) if (re.test(line)) return tone;
  return null;
}

// 把一条研究回答按已知段落标题切成结构块。识别不到任何段落（画像 / 事件 / 持仓 /
// 短答）时退回平铺渲染，行为完全不变。
export function renderRichAnswer(content = "") {
  const lines = String(content).split(/\r?\n/);
  const blocks = [];
  let lead = [];
  let cur = null;
  for (const raw of lines) {
    const tone = raw.trim() ? sectionToneOf(raw.trim()) : null;
    if (tone) {
      if (cur) blocks.push(cur);
      else if (lead.length) { blocks.push({ lead: lead.slice() }); lead = []; }
      cur = { title: raw.trim(), tone, body: [] };
    } else if (cur) {
      cur.body.push(raw);
    } else {
      lead.push(raw);
    }
  }
  if (cur) blocks.push(cur);
  else if (lead.length) blocks.push({ lead });

  if (!blocks.some((b) => b.tone)) return markdownToHtml(content);

  return blocks
    .map((b, i) => {
      // --i 驱动分段渐显的错峰延迟（仅最新一条回答会动，见 src/styles/04-components.css）。
      if (b.lead) {
        const html = markdownToHtml(b.lead.join("\n"));
        return html ? `<div class="ans-lead" style="--i:${i}">${html}</div>` : "";
      }
      const en = SECTION_LABEL_EN[b.tone] || "";
      const body = markdownToHtml(b.body.join("\n"));
      return `<section class="ans-sec tone-${b.tone}" style="--i:${i}">
        <div class="ans-sec-head"><span class="ans-dot"></span><span class="ans-sec-zh">${esc(b.title)}</span>${en ? `<span class="ans-sec-en">${en}</span>` : ""}</div>
        <div class="ans-sec-body">${body}</div>
      </section>`;
    })
    .join("");
}
