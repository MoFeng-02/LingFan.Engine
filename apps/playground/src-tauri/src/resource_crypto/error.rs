//! 资源加密的错误类型，以及资源路径校验失败的统一映射。

use crate::paths::PathRuleError;
use serde::Serialize;

/// 资源密文附加数据的路径前缀，解密时与逻辑路径拼接以绑定资源身份。
pub(crate) const AAD_RESOURCE_PREFIX: &str = "LFEN2:resource:";

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
/// 资源加解密可能失败的各种原因。
pub enum ResourceCryptoError {
    #[serde(rename = "io")]
    Io(String),
    #[serde(rename = "crypto")]
    Crypto(String),
    #[serde(rename = "bad-format")]
    BadFormat(String),
    #[serde(rename = "invalid-path")]
    InvalidPath(String),
    #[serde(rename = "missing-key")]
    MissingKey,
    #[serde(rename = "app-data")]
    AppData(String),
    #[serde(rename = "too-large")]
    TooLarge { size: u64, limit: u64 },
}

impl std::fmt::Display for ResourceCryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResourceCryptoError::Io(m) => write!(f, "文件读写失败：{m}"),
            ResourceCryptoError::Crypto(m) => write!(f, "解密失败：{m}"),
            ResourceCryptoError::BadFormat(m) => write!(f, "资源格式不符：{m}"),
            ResourceCryptoError::InvalidPath(p) => write!(f, "资源路径非法：{p}"),
            ResourceCryptoError::MissingKey => {
                write!(f, "资源密钥缺失（信封与 seed 均不存在）")
            }
            ResourceCryptoError::AppData(m) => write!(
                f,
                "应用数据目录不可用（存档与密钥存储位置）：{m}"
            ),
            ResourceCryptoError::TooLarge { size, limit } => write!(
                f,
                "资源过大（{size} > {limit}）：该护栏仅覆盖文本类供给路径；媒体类大资源走自定义协议流式（lfstream Range 按需解密），请勿经文本路径读取"
            ),
        }
    }
}

impl std::error::Error for ResourceCryptoError {}

/// 路径规则判定结果 → 本模块错误的映射入口。
impl ResourceCryptoError {
    /// 拒绝形态不进文案：`InvalidPath` 只携带路径本身，调用方按自己的语义展示或上抛。
    pub(crate) fn invalid_path(path: &str, _reason: PathRuleError) -> Self {
        ResourceCryptoError::InvalidPath(path.to_string())
    }
}

/// 由逻辑路径派生 LFEN2 v1 的附加数据。
pub(crate) fn aad_for(path: &str) -> Vec<u8> {
    format!("{AAD_RESOURCE_PREFIX}{path}").into_bytes()
}

/// 把标准库 IO 错误收敛进本模块的错误类型。
pub(crate) fn io(e: std::io::Error) -> ResourceCryptoError {
    ResourceCryptoError::Io(e.to_string())
}
