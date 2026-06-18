/**
 * JSON Schemas for the /api/agent decision panel.
 *
 * The model must output a JSON object that validates against `agentDecisionPanelSchema`.
 * - evidence 数组：每个结论必须带 source/asOf/quote-or-status/confidence/missingReason。
 * - researchStatus 取代旧的"买入/持有"评级，固定枚举。
 * - keyDrivers 固定 5 张卡，价格信号/基本面/估值/股东回报/风险信号。
 *
 * Validation is hand-rolled (no extra deps) and returns either:
 *   { valid: true, value }
 *   { valid: false, errors: [{ path, message }] }
 */

export const RESEARCH_STATUS_VALUES = [
  "watch",            // 持续观察
  "research_more",    // 需要补充材料才能继续研究
  "data_missing",     // 关键证据缺失，本次暂不评分
  "risk_alert",       // 触发反方/风险信号
  "out_of_scope"      // 不在研究范围（例如：要求做交易指令）
];

export const RESEARCH_STATUS_LABELS = {
  watch: "持续观察",
  research_more: "需要补充材料",
  data_missing: "数据缺失暂不评分",
  risk_alert: "风险提示",
  out_of_scope: "不在研究范围"
};

export const KEY_DRIVER_NAMES = ["价格信号", "基本面", "估值", "股东回报", "风险信号"];

const STATUS_VALUES = ["实时/盘中", "延迟/当日", "收盘/历史", "缺失", "未知", "新闻源不可用"];

/** Strip every key whose value is undefined (JSON Schema validation treats absent === undefined). */
function dropUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(dropUndefined);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = dropUndefined(v);
    }
    return out;
  }
  return obj;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Lightweight JSON Schema validator.
 * Supports: type, enum, required, properties, items, additionalProperties (false),
 *           minLength, maxLength, minimum, maximum, pattern, nullable, type as array.
 */
export function validateSchema(schema, value, path = "$", errors = []) {
  if (value === undefined) {
    if (schema.required) errors.push({ path, message: "缺少必填字段" });
    return errors;
  }

  if (schema.nullable && value === null) return errors;

  const expected = schema.type;
  if (expected) {
    const actual = typeOf(value);
    const ok = Array.isArray(expected)
      ? expected.includes(actual)
      : actual === expected;
    if (!ok) {
      errors.push({ path, message: `类型应为 ${Array.isArray(expected) ? expected.join("/") : expected}，实际 ${actual}` });
      return errors;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `必须是以下之一: ${schema.enum.join(", ")}` });
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `长度应 >= ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `长度应 <= ${schema.maxLength}` });
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `不匹配模式 ${schema.pattern}` });
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `应 >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `应 <= ${schema.maximum}` });
    }
  }

  if (expected === "object" && value && typeof value === "object") {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) errors.push({ path: `${path}.${key}`, message: "缺少必填字段" });
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in value) validateSchema(subSchema, value[key], `${path}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) errors.push({ path: `${path}.${key}`, message: `不允许的额外字段 ${key}` });
      }
    }
  }

  if (expected === "array" && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, message: `至少 ${schema.minItems} 项` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, message: `最多 ${schema.maxItems} 项` });
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`, errors));
    }
  }

  return errors;
}

/** A single evidence entry — proves where a fact came from. */
export const evidenceItemSchema = {
  type: "object",
  required: ["source", "confidence", "missingReason"],
  properties: {
    source: { type: "string", minLength: 1, maxLength: 120 },
    asOf: { type: "string", nullable: true, maxLength: 40 },
    quote: { type: "string", nullable: true, maxLength: 400 },
    status: { type: "string", enum: STATUS_VALUES, nullable: true },
    confidence: { type: "string", enum: ["高", "中", "低"] },
    missingReason: { type: "string", maxLength: 200 }
  },
  additionalProperties: false
};

export const userContextSchema = {
  type: "object",
  nullable: true,
  required: ["cost", "shares", "horizon", "note"],
  properties: {
    cost: { type: ["string", "number"], nullable: true, maxLength: 20 },
    shares: { type: ["string", "number"], nullable: true, maxLength: 20 },
    horizon: { type: "string", nullable: true, maxLength: 40 },
    note: { type: "string", nullable: true, maxLength: 200 }
  },
  additionalProperties: false
};

export const keyDriverSchema = {
  type: "object",
  required: ["name", "status", "summary", "evidence"],
  properties: {
    name: { type: "string", enum: KEY_DRIVER_NAMES },
    status: { type: "string", maxLength: 20 },
    summary: { type: "string", maxLength: 60 },
    evidence: { type: "array", minItems: 1, items: evidenceItemSchema }
  },
  additionalProperties: false
};

/** The full agent decision panel contract. */
export const agentDecisionPanelSchema = {
  type: "object",
  required: [
    "ticker",
    "companyName",
    "researchStatus",
    "confidence",
    "dataCompleteness",
    "oneLineView",
    "action",
    "userContext",
    "keyDrivers",
    "missingData",
    "connectedData",
    "riskTriggers",
    "sources",
    "evidence"
  ],
  properties: {
    ticker: { type: "string", minLength: 1, maxLength: 16 },
    companyName: { type: "string", minLength: 1, maxLength: 80 },
    researchStatus: { type: "string", enum: RESEARCH_STATUS_VALUES },
    confidence: { type: "string", enum: ["高", "中", "低"] },
    dataCompleteness: { type: "number", minimum: 0, maximum: 100 },
    oneLineView: { type: "string", maxLength: 120 },
    action: { type: "string", maxLength: 60 },
    userContext: userContextSchema,
    price: {
      type: "object",
      nullable: true,
      required: ["value", "change", "source", "timestamp"],
      properties: {
        value: { type: "string", maxLength: 60 },
        change: { type: "string", maxLength: 40 },
        source: { type: "string", maxLength: 80 },
        timestamp: { type: "string", maxLength: 40 },
        evidence: { type: "array", items: evidenceItemSchema, maxItems: 4 }
      },
      additionalProperties: false
    },
    metrics: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        required: ["name", "value", "note"],
        properties: {
          name: { type: "string", maxLength: 40 },
          value: { type: "string", maxLength: 60 },
          note: { type: "string", maxLength: 80 },
          evidence: { type: "array", items: evidenceItemSchema, maxItems: 4 }
        },
        additionalProperties: false
      }
    },
    keyDrivers: { type: "array", minItems: 1, maxItems: 5, items: keyDriverSchema },
    connectedData: { type: "array", items: { type: "string", maxLength: 60 } },
    missingData: { type: "array", items: { type: "string", maxLength: 60 } },
    riskTriggers: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        required: ["label", "evidence"],
        properties: {
          label: { type: "string", maxLength: 100 },
          evidence: { type: "array", minItems: 1, items: evidenceItemSchema }
        },
        additionalProperties: false
      }
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "type"],
        properties: {
          label: { type: "string", maxLength: 200 },
          url: { type: "string", maxLength: 400, nullable: true },
          type: { type: "string", maxLength: 30 },
          timestamp: { type: "string", maxLength: 40, nullable: true }
        },
        additionalProperties: false
      }
    },
    evidence: { type: "array", minItems: 1, items: evidenceItemSchema },
    details: {
      type: "object",
      nullable: true,
      required: ["overview", "financials", "valuation", "risks", "sources"],
      properties: {
        overview: { type: "array", items: { type: "string", maxLength: 200 } },
        financials: { type: "array", items: { type: "string", maxLength: 200 } },
        valuation: { type: "array", items: { type: "string", maxLength: 200 } },
        risks: { type: "array", items: { type: "string", maxLength: 200 } },
        sources: { type: "array", items: { type: "string", maxLength: 200 } }
      },
      additionalProperties: false
    },
    fullResearch: { type: "string", maxLength: 6000 }
  },
  additionalProperties: false
};

export function validateAgentPanel(candidate) {
  const value = dropUndefined(candidate || {});
  const errors = validateSchema(agentDecisionPanelSchema, value);
  return { valid: errors.length === 0, value, errors };
}

/**
 * The minimal repair hint given back to the model on a validation failure.
 * Keeps the second pass focused and small.
 */
export function buildRepairPrompt(errors, raw) {
  const list = errors
    .slice(0, 12)
    .map((e) => `- ${e.path}: ${e.message}`)
    .join("\n");
  return `上一次输出没有通过 Luvio 决策面板校验，请立刻修复并重新输出一个合法 JSON 对象。

校验失败项：
${list}

硬性规则：
- researchStatus 必须是以下之一：watch / research_more / data_missing / risk_alert / out_of_scope。
- keyDrivers 必须是 5 项，分别命名"价格信号"/"基本面"/"估值"/"股东回报"/"风险信号"，每项必须带 evidence 数组，evidence 每项必须含 source/confidence/missingReason。
- 全部 evidence 项的 missingReason 必填；当有数据时写"无"，没数据时写具体原因。
- 全程不要 Markdown 表格、代码块、说明文字、注释、键名拼写错误。直接输出 JSON。
- ticker 必须与请求一致，companyName 用中文全称。
- 不要写"我会先…"等开场白。

上一次原始输出（节选）：
${String(raw || "").slice(0, 1500)}`;
}

export const REPAIR_SYSTEM_PROMPT = `你是 Luvio 决策面板的"修复器"。你的唯一任务是把非法输出改成一个严格匹配 JSON Schema 的对象。
规则：
- 只输出合法 JSON，不要 Markdown，不要代码块，不要解释。
- 任何缺字段一律补最小可用的占位（null、空数组、空字符串）。
- researchStatus 只允许 watch / research_more / data_missing / risk_alert / out_of_scope。
- evidence.missingReason 必填，没数据时写具体原因，不要写"无"。
- 严禁重新生成研究内容，只做结构修复。`;
