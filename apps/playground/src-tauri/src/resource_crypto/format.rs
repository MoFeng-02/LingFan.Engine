//! LFEN2 与 LFEN 的格式常量、密文识别，以及按格式分派的加解密原语。

use crate::crypto::gcm_open_in_place;
use crate::crypto::gcm_seal;
use crate::resource_crypto::error::{ResourceCryptoError, aad_for};
use crate::resource_crypto::v2::{FORMAT_VERSION_V2, decrypt_v2_all};

/// 新格式魔数（5 字节，与 4 字节 LFEN 无前缀歧义）
pub(crate) const MAGIC_LFEN2: &[u8; 5] = b"LFEN2";

/// LFEN v1 魔数（兼容读）
const MAGIC_LFEN: &[u8; 4] = b"LFEN";

const FORMAT_VERSION: u8 = 1;

/// 是否为加密资源（魔数检测）
pub(crate) fn is_encrypted(data: &[u8]) -> bool {
    data.starts_with(MAGIC_LFEN2) || data.starts_with(MAGIC_LFEN)
}

/// LFEN2 加密（打包工具与测试用）：一次性缓冲区，nonce/tag/密文直接落位
pub(crate) fn encrypt_lfen2(
    plaintext: &[u8],
    key: &[u8],
    path: &str,
) -> Result<Vec<u8>, ResourceCryptoError> {
    let sealed = gcm_seal(key, plaintext, &aad_for(path)).map_err(ResourceCryptoError::Crypto)?;
    let mut out = Vec::with_capacity(MAGIC_LFEN2.len() + 1 + sealed.len());
    out.extend_from_slice(MAGIC_LFEN2);
    out.push(FORMAT_VERSION);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// 解密：魔数分流 LFEN2（ver=1 整文件 / ver=2 分块全量拼接，校验版本 + AAD）/ LFEN（无 AAD 兼容读）；其他 = BadFormat（不降级明文）。
/// 入参为**持有缓冲**：v1 分支原地解密（内存峰值 = 密文 1 倍，无第二份明文分配）——
/// v1 为 GCM 单 tag 全量验证形态，密码学上不可流式（流式会先释放未认证明文），峰值收敛靠原地 + 前置尺寸护栏。
pub(crate) fn decrypt_resource_bytes(
    mut file: Vec<u8>,
    key: &[u8],
    path: &str,
) -> Result<Vec<u8>, ResourceCryptoError> {
    if file.starts_with(MAGIC_LFEN2) {
        if file.len() < MAGIC_LFEN2.len() + 1 {
            return Err(ResourceCryptoError::BadFormat("LFEN2 文件过短".into()));
        }
        let version = file[MAGIC_LFEN2.len()];
        if version == FORMAT_VERSION_V2 {
            return decrypt_v2_all(&file, key, path);
        }
        if version != FORMAT_VERSION {
            return Err(ResourceCryptoError::BadFormat(format!(
                "LFEN2 版本不支持：{version}"
            )));
        }
        if file.len() < MAGIC_LFEN2.len() + 1 + 12 + 16 {
            return Err(ResourceCryptoError::BadFormat("LFEN2 文件过短".into()));
        }
        file.drain(..MAGIC_LFEN2.len() + 1); // 剥头部（memmove，无重分配）→ 原地解封
        return gcm_open_in_place(key, file, &aad_for(path)).map_err(ResourceCryptoError::Crypto);
    }
    if file.starts_with(MAGIC_LFEN) {
        if file.len() < MAGIC_LFEN.len() + 1 + 12 + 16 {
            return Err(ResourceCryptoError::BadFormat("LFEN 文件过短".into()));
        }
        let version = file[MAGIC_LFEN.len()];
        if version != 1 {
            return Err(ResourceCryptoError::BadFormat(format!(
                "LFEN 版本不支持：{version}"
            )));
        }
        file.drain(..MAGIC_LFEN.len() + 1);
        // LFEN 无 AAD（存量资源不浪费）——原地解封
        return gcm_open_in_place(key, file, &[]).map_err(ResourceCryptoError::Crypto);
    }
    Err(ResourceCryptoError::BadFormat(
        "魔数不符（非 LFEN2/LFEN，不降级明文）".into(),
    ))
}

// —— LFEN2 v2 分块流式 ——
