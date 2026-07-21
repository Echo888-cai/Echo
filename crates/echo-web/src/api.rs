use serde::Serialize;
use serde::de::DeserializeOwned;

#[cfg(target_arch = "wasm32")]
async fn decode<T: DeserializeOwned>(response: gloo_net::http::Response) -> Result<T, String> {
    let status = response.status();
    if response.ok() {
        return response
            .json::<T>()
            .await
            .map_err(|error| format!("响应解析失败：{error}"));
    }
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<echo_contracts::ErrorResponse>(&body)
        .map(|error| error.message)
        .unwrap_or_else(|_| format!("服务返回 {status}"));
    Err(message)
}

#[cfg(target_arch = "wasm32")]
pub async fn get<T: DeserializeOwned>(path: &str) -> Result<T, String> {
    let response = gloo_net::http::Request::get(path)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    decode(response).await
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn get<T: DeserializeOwned>(_path: &str) -> Result<T, String> {
    Err("网络请求只在 WASM 浏览器目标执行".into())
}

#[cfg(target_arch = "wasm32")]
pub async fn post<I: Serialize + ?Sized, O: DeserializeOwned>(
    path: &str,
    input: &I,
) -> Result<O, String> {
    let response = gloo_net::http::Request::post(path)
        .json(input)
        .map_err(|error| format!("请求编码失败：{error}"))?
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    decode(response).await
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn post<I: Serialize + ?Sized, O: DeserializeOwned>(
    _path: &str,
    _input: &I,
) -> Result<O, String> {
    Err("网络请求只在 WASM 浏览器目标执行".into())
}

#[cfg(target_arch = "wasm32")]
pub async fn patch<I: Serialize + ?Sized, O: DeserializeOwned>(
    path: &str,
    input: &I,
) -> Result<O, String> {
    let response = gloo_net::http::Request::patch(path)
        .json(input)
        .map_err(|error| format!("请求编码失败：{error}"))?
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    decode(response).await
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn patch<I: Serialize + ?Sized, O: DeserializeOwned>(
    _path: &str,
    _input: &I,
) -> Result<O, String> {
    Err("网络请求只在 WASM 浏览器目标执行".into())
}

#[cfg(target_arch = "wasm32")]
pub async fn delete<O: DeserializeOwned>(path: &str) -> Result<O, String> {
    let response = gloo_net::http::Request::delete(path)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    decode(response).await
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn delete<O: DeserializeOwned>(_path: &str) -> Result<O, String> {
    Err("网络请求只在 WASM 浏览器目标执行".into())
}

/// 一次类型化 SSE 流的取消句柄——持有 `AbortController` 让上层随时中止底层 fetch。
#[cfg(target_arch = "wasm32")]
#[derive(Clone)]
pub struct StreamHandle {
    controller: std::rc::Rc<web_sys::AbortController>,
}

#[cfg(target_arch = "wasm32")]
impl StreamHandle {
    pub fn cancel(&self) {
        self.controller.abort();
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone)]
pub struct StreamHandle;

#[cfg(not(target_arch = "wasm32"))]
impl StreamHandle {
    pub fn cancel(&self) {}
}

/// 发起一次类型化研究 SSE 流：逐帧解析 `data:` 行为 `echo_contracts::ResearchStreamEvent`
/// 并回调 `on_event`；连接失败或流异常终止时回调 `on_error` 一次。返回的 [`StreamHandle`]
/// 可用于用户主动取消（底层走 `AbortController`，服务端因 SSE 接收端断开而停止生成）。
#[cfg(target_arch = "wasm32")]
pub fn post_stream<I: Serialize + ?Sized>(
    path: &str,
    input: &I,
    mut on_event: impl FnMut(echo_contracts::ResearchStreamEvent) + 'static,
    on_error: impl FnOnce(String) + 'static,
) -> StreamHandle {
    use wasm_bindgen::JsCast;

    let controller = web_sys::AbortController::new().expect("AbortController::new 不应失败");
    let signal = controller.signal();
    let request = gloo_net::http::Request::post(path)
        .abort_signal(Some(&signal))
        .json(input);

    wasm_bindgen_futures::spawn_local(async move {
        let outcome: Result<(), String> = async {
            let request = request.map_err(|error| format!("请求编码失败：{error}"))?;
            let response = request
                .send()
                .await
                .map_err(|error| format!("请求失败：{error}"))?;
            if !response.ok() {
                return Err(format!("服务返回 {}", response.status()));
            }
            let stream = response.body().ok_or_else(|| "响应无正文流".to_string())?;
            let reader = stream
                .get_reader()
                .unchecked_into::<web_sys::ReadableStreamDefaultReader>();
            let mut buf: Vec<u8> = Vec::new();
            loop {
                let chunk = wasm_bindgen_futures::JsFuture::from(reader.read())
                    .await
                    .map_err(|error| format!("{error:?}"))?;
                let done = js_sys::Reflect::get(&chunk, &"done".into())
                    .ok()
                    .and_then(|value| value.as_bool())
                    .unwrap_or(true);
                if done {
                    break;
                }
                let Some(value) = js_sys::Reflect::get(&chunk, &"value".into()).ok() else {
                    continue;
                };
                let Ok(bytes) = value.dyn_into::<js_sys::Uint8Array>() else {
                    continue;
                };
                buf.extend(bytes.to_vec());
                while let Some(end) = find_frame_end(&buf) {
                    let frame: Vec<u8> = buf.drain(..end).collect();
                    if let Some(event) = parse_sse_frame(&frame) {
                        on_event(event);
                    }
                }
            }
            Ok(())
        }
        .await;
        if let Err(message) = outcome {
            on_error(message);
        }
    });

    StreamHandle {
        controller: std::rc::Rc::new(controller),
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn post_stream<I: Serialize + ?Sized>(
    _path: &str,
    _input: &I,
    _on_event: impl FnMut(echo_contracts::ResearchStreamEvent) + 'static,
    on_error: impl FnOnce(String) + 'static,
) -> StreamHandle {
    on_error("网络请求只在 WASM 浏览器目标执行".into());
    StreamHandle
}

/// 找到下一帧结尾（`\n\n`），返回其后一个字节的偏移，供 `drain` 一次取走整帧（含分隔符）。
#[cfg(target_arch = "wasm32")]
fn find_frame_end(buf: &[u8]) -> Option<usize> {
    buf.windows(2)
        .position(|window| window == b"\n\n")
        .map(|pos| pos + 2)
}

/// 从一帧原始 SSE 文本里取出 `data:` 行并反序列化。忽略 keep-alive 注释帧（无 `data:` 行）。
#[cfg(target_arch = "wasm32")]
fn parse_sse_frame(frame: &[u8]) -> Option<echo_contracts::ResearchStreamEvent> {
    let text = String::from_utf8_lossy(frame);
    let data_line = text.lines().find_map(|line| line.strip_prefix("data:"))?;
    serde_json::from_str(data_line.trim()).ok()
}
