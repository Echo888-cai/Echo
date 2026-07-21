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
