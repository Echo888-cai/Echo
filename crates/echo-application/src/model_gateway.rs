//! 模型网关——绞杀 `packages/application/src/modelGateway.ts`。
//!
//! OpenAI 兼容协议（DeepSeek 主 → OpenAI 备 → 通用），`POST /chat/completions`。
//! 本轮先把**非流式核心**接通并强类型化：provider 选择、请求体构造、作答提取、JSON 解析
//! 都做到与 TS 逐字对齐并有纯函数单测。刻意留下的显式 seam（不静默假装接了）：
//!   * 流式 SSE 增量下发——随 `echo-api` 的 SSE 管道接上（`readStreamedCompletion` 对应物）；
//!   * `llm_audit` 落库——随 `echo-db` 的 llm_audit 仓储接上（TS 里的 `insertLlmAudit`）。
//!
//! 失败一律返回 `None`（对齐 TS「失败返回 null 而不是抛错」），由编排层落到「未核到」。

use std::time::Duration;

/// 选中的模型 provider——id 决定 DeepSeek 专属的 `thinking` 开关是否附带。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderConfig {
    pub id: String,
    pub key: String,
    pub base: String,
    pub model: String,
}

/// 纯选择逻辑：按 DeepSeek → OpenAI → 通用的次序，从注入的取值器读环境。
/// 抽成纯函数是为了单测不去污染进程级 `std::env`（Rust 测试并行跑，改全局 env 会串味）。
fn provider_config_from(get: impl Fn(&str) -> Option<String>) -> Option<ProviderConfig> {
    let non_empty = |k: &str| get(k).filter(|v| !v.is_empty());

    if let Some(key) = non_empty("DEEPSEEK_API_KEY") {
        return Some(ProviderConfig {
            id: "deepseek".into(),
            key,
            base: non_empty("DEEPSEEK_BASE_URL")
                .unwrap_or_else(|| "https://api.deepseek.com".into()),
            model: non_empty("DEEPSEEK_MODEL").unwrap_or_else(|| "deepseek-v4-flash".into()),
        });
    }
    if let Some(key) = non_empty("OPENAI_API_KEY") {
        return Some(ProviderConfig {
            id: "openai".into(),
            key,
            base: "https://api.openai.com/v1".into(),
            model: non_empty("OPENAI_MODEL").unwrap_or_else(|| "gpt-5-mini".into()),
        });
    }
    if let (Some(key), Some(base)) = (non_empty("MODEL_API_KEY"), non_empty("MODEL_BASE_URL")) {
        return Some(ProviderConfig {
            id: "generic".into(),
            key,
            base,
            model: non_empty("MODEL_NAME").unwrap_or_else(|| "default".into()),
        });
    }
    None
}

/// 从进程环境选 provider。没配任何 key 时返回 `None`——编排层据此走「未核到」，绝不假装有模型。
#[must_use]
pub fn provider_config() -> Option<ProviderConfig> {
    provider_config_from(|k| std::env::var(k).ok())
}

/// 调用类别——只影响超时（report 给 120s，其余 60s），与 TS 一致。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AnswerKind {
    #[default]
    Chat,
    Router,
    Report,
    Resolver,
}

impl AnswerKind {
    fn as_str(self) -> &'static str {
        match self {
            AnswerKind::Chat => "chat",
            AnswerKind::Router => "router",
            AnswerKind::Report => "report",
            AnswerKind::Resolver => "resolver",
        }
    }

    fn timeout(self) -> Duration {
        match self {
            AnswerKind::Report => Duration::from_secs(120),
            _ => Duration::from_secs(60),
        }
    }
}

/// 作答选项——对齐 TS 的 `ModelAnswerOptions`（流式的 `visibleText` 随 SSE seam 一起接）。
#[derive(Clone, Copy, Debug, Default)]
pub struct ModelAnswerOptions {
    pub kind: AnswerKind,
    /// DeepSeek 专属 `thinking` 开关：`Some` 才附带（`None` 表示不干预 provider 默认）。
    pub thinking: Option<bool>,
    pub max_tokens: Option<u32>,
    pub json: bool,
}

/// 一次成功作答的结果——附回实际 provider/model，便于审计与前端标注。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelAnswer {
    pub content: String,
    pub provider: String,
    pub model: String,
}

/// 构造 `/chat/completions` 请求体（非流式）。纯函数，逐字对齐 TS：`temperature: 0.2`、
/// system+user 两条消息、DeepSeek 才带 `thinking`、可选 `max_tokens`、JSON 模式的
/// `response_format`。抽出来单测请求形状，不必真打网络。
fn build_request_body(
    provider: &ProviderConfig,
    system: &str,
    user: &str,
    options: &ModelAnswerOptions,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": provider.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });
    let map = body.as_object_mut().expect("json object");

    if provider.id == "deepseek" {
        if let Some(thinking) = options.thinking {
            map.insert(
                "thinking".into(),
                serde_json::json!({ "type": if thinking { "enabled" } else { "disabled" } }),
            );
        }
    }
    if let Some(max_tokens) = options.max_tokens {
        map.insert("max_tokens".into(), serde_json::json!(max_tokens));
    }
    if options.json {
        map.insert(
            "response_format".into(),
            serde_json::json!({ "type": "json_object" }),
        );
    }
    body
}

/// 从非流式响应体里抠出 `choices[0].message.content` 并 trim。空串归一为 `None`。
fn content_from_response(body: &serde_json::Value) -> Option<String> {
    let content = body
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    (!content.is_empty()).then_some(content)
}

/// 统一作答入口（非流式）。选到 provider 就打 OpenAI 兼容端点，取回正文；任何失败（无 provider、
/// 网络错、非 2xx、空正文）都归一到 `None`，对齐 TS「失败返回 null」。审计落库是显式 seam，暂缺。
pub async fn model_answer(
    system: &str,
    user: &str,
    options: ModelAnswerOptions,
) -> Option<ModelAnswer> {
    let provider = provider_config()?;
    let url = format!("{}/chat/completions", provider.base.trim_end_matches('/'));
    let body = build_request_body(&provider, system, user, &options);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .bearer_auth(&provider.key)
        .json(&body)
        .timeout(options.kind.timeout())
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload: serde_json::Value = response.json().await.ok()?;
    let content = content_from_response(&payload)?;
    let _ = options.kind.as_str(); // 审计 seam 接上后作为 kind 落库
    Some(ModelAnswer {
        content,
        provider: provider.id,
        model: provider.model,
    })
}

/// 去掉 ```json 围栏后解析成 JSON 对象；任何解析失败返回 `None`。对齐 TS 的 `parseJsonObject`。
#[must_use]
pub fn parse_json_object(content: &str) -> Option<serde_json::Value> {
    let text = content.trim();
    // 去掉起始的 ```json / ``` 围栏与结尾的 ```。
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```JSON"))
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text)
        .trim_start();
    let text = text.strip_suffix("```").unwrap_or(text).trim();
    serde_json::from_str(text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    #[test]
    fn deepseek_wins_over_openai_and_takes_defaults() {
        let cfg = provider_config_from(env(&[
            ("DEEPSEEK_API_KEY", "ds-key"),
            ("OPENAI_API_KEY", "oa-key"),
        ]))
        .expect("provider");
        assert_eq!(cfg.id, "deepseek");
        assert_eq!(cfg.base, "https://api.deepseek.com");
        assert_eq!(cfg.model, "deepseek-v4-flash");
        assert_eq!(cfg.key, "ds-key");
    }

    #[test]
    fn openai_selected_when_no_deepseek_and_honors_model_override() {
        let cfg = provider_config_from(env(&[
            ("OPENAI_API_KEY", "oa-key"),
            ("OPENAI_MODEL", "gpt-5"),
        ]))
        .expect("provider");
        assert_eq!(cfg.id, "openai");
        assert_eq!(cfg.base, "https://api.openai.com/v1");
        assert_eq!(cfg.model, "gpt-5");
    }

    #[test]
    fn generic_needs_both_key_and_base() {
        assert!(provider_config_from(env(&[("MODEL_API_KEY", "k")])).is_none());
        let cfg = provider_config_from(env(&[
            ("MODEL_API_KEY", "k"),
            ("MODEL_BASE_URL", "https://llm.internal/v1"),
        ]))
        .expect("provider");
        assert_eq!(cfg.id, "generic");
        assert_eq!(cfg.model, "default");
    }

    #[test]
    fn empty_string_key_is_not_a_provider() {
        assert!(provider_config_from(env(&[("DEEPSEEK_API_KEY", "")])).is_none());
    }

    #[test]
    fn no_keys_means_no_provider() {
        assert!(provider_config_from(env(&[])).is_none());
    }

    #[test]
    fn deepseek_body_carries_thinking_and_options() {
        let provider = ProviderConfig {
            id: "deepseek".into(),
            key: "k".into(),
            base: "https://api.deepseek.com".into(),
            model: "deepseek-v4-flash".into(),
        };
        let body = build_request_body(
            &provider,
            "sys",
            "usr",
            &ModelAnswerOptions {
                thinking: Some(true),
                max_tokens: Some(1024),
                json: true,
                ..Default::default()
            },
        );
        assert_eq!(body["temperature"], serde_json::json!(0.2));
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "usr");
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["max_tokens"], serde_json::json!(1024));
        assert_eq!(body["response_format"]["type"], "json_object");
    }

    #[test]
    fn non_deepseek_body_omits_thinking() {
        let provider = ProviderConfig {
            id: "openai".into(),
            key: "k".into(),
            base: "https://api.openai.com/v1".into(),
            model: "gpt-5-mini".into(),
        };
        let body = build_request_body(
            &provider,
            "sys",
            "usr",
            &ModelAnswerOptions {
                thinking: Some(true),
                ..Default::default()
            },
        );
        assert!(body.get("thinking").is_none());
        assert!(body.get("max_tokens").is_none());
        assert!(body.get("response_format").is_none());
    }

    #[test]
    fn content_extracted_and_trimmed() {
        let body = serde_json::json!({
            "choices": [{ "message": { "content": "  hello  " } }]
        });
        assert_eq!(content_from_response(&body).as_deref(), Some("hello"));
    }

    #[test]
    fn empty_content_is_none() {
        let body = serde_json::json!({ "choices": [{ "message": { "content": "   " } }] });
        assert!(content_from_response(&body).is_none());
        assert!(content_from_response(&serde_json::json!({})).is_none());
    }

    #[test]
    fn parse_json_object_strips_fence() {
        let parsed = parse_json_object("```json\n{\"a\": 1}\n```").expect("json");
        assert_eq!(parsed["a"], serde_json::json!(1));
        let bare = parse_json_object("{\"b\": 2}").expect("json");
        assert_eq!(bare["b"], serde_json::json!(2));
    }

    #[test]
    fn parse_json_object_bad_input_is_none() {
        assert!(parse_json_object("not json").is_none());
        assert!(parse_json_object("").is_none());
    }
}
