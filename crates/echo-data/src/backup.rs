//! pg_dump 产物的 S3 镜像通道——唯一外部对象存储供应商入口。
//!
//! 调用方（`echo-worker`）必须先把 dump 落到本地 `backup_dir`（本地文件是备份的唯一真源），
//! 再决定是否把它镜像到 S3；本模块只管"怎么传"，不做传不传的策略判断。构造本身即代表
//! "已配置"——是否构造由调用方按 `Option<BackupConfig>` 决定。
//!
//! 直连 S3 REST API 手签 SigV4（而非官方 aws-sdk-s3）：aws-sdk 系列传递依赖
//! （`aws-sdk-sts` 1.9x）要求 rustc 1.88，高于本仓库 `rust-toolchain.toml`/CI 钉的 1.85，
//! 升级工具链是跨切片的基础设施决定，不在本次范围内顺带做。SigV4 用工作区已有的
//! `hmac`/`sha2`/`hex`（RustCrypto 同源）手工实现，单一 PUT Object 请求，算法边界小。

use std::path::Path;

use echo_config::BackupConfig;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, thiserror::Error)]
pub enum BackupStorageError {
    #[error("读取备份文件失败：{0}")]
    ReadFile(#[from] std::io::Error),
    #[error("S3 请求构造失败：{0}")]
    Request(#[from] reqwest::Error),
    #[error("S3 上传失败：HTTP {status}：{body}")]
    Upload { status: u16, body: String },
}

#[derive(Clone)]
pub struct BackupStorageService {
    client: reqwest::Client,
    config: BackupConfig,
}

impl BackupStorageService {
    #[must_use]
    pub fn new(config: BackupConfig) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
        }
    }

    /// 上传本地 dump 文件，返回落地的 `s3://bucket/key`。文件名沿用本地文件名，
    /// 前缀取自配置（默认 `postgres/`），不重新生成时间戳——本地文件名已含时间戳，
    /// 避免两处时间戳来源不一致造成的对账困惑。
    pub async fn upload(&self, local_path: &Path) -> Result<String, BackupStorageError> {
        let file_name = local_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| BackupStorageError::Upload {
                status: 0,
                body: "备份文件名不是合法 UTF-8".into(),
            })?;
        let key = format!("{}/{file_name}", self.config.prefix.trim_matches('/'));
        let body = tokio::fs::read(local_path).await?;
        let now = chrono::Utc::now();

        let signed = SignedPutRequest::build(&self.config, &key, &body, now);

        let mut request = self
            .client
            .put(&signed.url)
            .header("host", signed.host)
            .header("x-amz-content-sha256", signed.payload_hash)
            .header("x-amz-date", signed.amz_date)
            .header("Authorization", signed.authorization)
            .body(body);
        if let Some(token) = &self.config.session_token {
            request = request.header("x-amz-security-token", token.clone());
        }

        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(BackupStorageError::Upload {
                status: status.as_u16(),
                body: body.chars().take(500).collect(),
            });
        }
        Ok(format!("s3://{}/{key}", self.config.bucket))
    }
}

/// 一次 S3 PUT Object 请求的签名结果——从 [`BackupStorageService::upload`] 拆出来，
/// 好在不发真实网络请求的前提下用固定时间戳单测验证 SigV4 计算是否正确。
struct SignedPutRequest {
    url: String,
    host: String,
    payload_hash: String,
    amz_date: String,
    authorization: String,
}

impl SignedPutRequest {
    fn build(
        config: &BackupConfig,
        key: &str,
        body: &[u8],
        now: chrono::DateTime<chrono::Utc>,
    ) -> Self {
        let host = format!("{}.s3.{}.amazonaws.com", config.bucket, config.region);
        let url = format!("https://{host}/{}", uri_encode_path(key));
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = now.format("%Y%m%d").to_string();
        let payload_hash = hex::encode(Sha256::digest(body));

        let mut signed_header_names = vec!["host", "x-amz-content-sha256", "x-amz-date"];
        if config.session_token.is_some() {
            signed_header_names.push("x-amz-security-token");
        }
        signed_header_names.sort_unstable();

        let mut canonical_headers = String::new();
        for name in &signed_header_names {
            let value = match *name {
                "host" => host.as_str(),
                "x-amz-content-sha256" => payload_hash.as_str(),
                "x-amz-date" => amz_date.as_str(),
                "x-amz-security-token" => config.session_token.as_deref().unwrap_or_default(),
                _ => unreachable!(),
            };
            canonical_headers.push_str(name);
            canonical_headers.push(':');
            canonical_headers.push_str(value);
            canonical_headers.push('\n');
        }
        let signed_headers = signed_header_names.join(";");

        let canonical_request = format!(
            "PUT\n/{path}\n\n{headers}\n{signed}\n{payload_hash}",
            path = uri_encode_path(key),
            headers = canonical_headers,
            signed = signed_headers,
        );

        let credential_scope = format!("{date_stamp}/{}/s3/aws4_request", config.region);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );

        let signing_key =
            derive_signing_key(&config.secret_access_key, &date_stamp, &config.region, "s3");
        let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));

        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
            config.access_key_id,
        );

        Self {
            url,
            host,
            payload_hash,
            amz_date,
            authorization,
        }
    }
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts key of any length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn derive_signing_key(secret: &str, date_stamp: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}

/// AWS SigV4 规范的路径百分号编码：保留 `A-Za-z0-9-_.~` 与路径分隔符 `/`，其余一律
/// `%XX`（大写十六进制）。S3 对象 key 只由本地文件名/固定前缀拼成，实际不会触发多数分支，
/// 但签名算法要求逐字节按规范编码，不能只做"够用"的简化。
fn uri_encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_reserved_characters_but_keeps_path_separators() {
        assert_eq!(
            uri_encode_path("postgres/dump 1.tar"),
            "postgres/dump%201.tar"
        );
        assert_eq!(uri_encode_path("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn signing_key_derivation_is_deterministic_and_length_32() {
        let key = derive_signing_key("secret", "20260722", "us-east-1", "s3");
        assert_eq!(key.len(), 32);
        assert_eq!(
            key,
            derive_signing_key("secret", "20260722", "us-east-1", "s3")
        );
    }

    /// 用独立的 Python `hmac`/`hashlib` 实现同一组 SigV4 示例凭据（AKIDEXAMPLE 系列，
    /// 常见于 AWS 文档示例）跑四级 HMAC 链（kDate→kRegion→kService→kSigning），核对
    /// 两套互不共享代码的实现算出同一个签名密钥——不能只靠自洽测试证明链式调用顺序对。
    #[test]
    fn signing_key_matches_independent_python_hmac_implementation() {
        let key = derive_signing_key(
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE",
            "20150830",
            "us-east-1",
            "iam",
        );
        assert_eq!(
            hex::encode(&key),
            "93c91b7c5da17c72120bd321a9833353b5dd75355fe396cc91abc149ad9755b5"
        );
    }

    /// 端到端核对整条签名流水线（canonical request → string-to-sign → 四级 HMAC →
    /// Authorization 头），不只是签名密钥这一步：用固定时间戳/body 跑一次 `SignedPutRequest::
    /// build`，比对独立 Python `hmac`/`hashlib` 脚本算出的同一份 Authorization 字符串逐字节
    /// 相等——两套互不共享代码的实现对同一输入产出同一签名，是本地没有真实 S3 桶时能做到的
    /// 最强验证。
    #[test]
    fn authorization_header_matches_independent_python_sigv4_implementation() {
        let config = BackupConfig {
            bucket: "echo-test-bucket".into(),
            region: "us-east-1".into(),
            prefix: "postgres".into(),
            access_key_id: "AKIDEXAMPLE".into(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE".into(),
            session_token: None,
        };
        let fixed_now = chrono::DateTime::parse_from_rfc3339("2015-08-30T12:36:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let signed = SignedPutRequest::build(
            &config,
            "postgres/echo-scheduled-20260722T133509Z.dump",
            b"hello-world",
            fixed_now,
        );
        assert_eq!(
            signed.url,
            "https://echo-test-bucket.s3.us-east-1.amazonaws.com/postgres/echo-scheduled-20260722T133509Z.dump"
        );
        assert_eq!(
            signed.payload_hash,
            "afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d"
        );
        assert_eq!(
            signed.authorization,
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/s3/aws4_request, \
             SignedHeaders=host;x-amz-content-sha256;x-amz-date, \
             Signature=93a1b50cc603da08155558dfd20a3e34a5033543166c81491a0981c0f5bb5af0"
        );
    }
}
