//! 05 §三 共享加密原语（KEK + AES-256-GCM 信封）：存档（save.rs）与资源（resource_crypto.rs）共用。
//! 密钥分层三级：DEK（每文件/每档随机）→ KEK（每机器随机，keyring 统一 DPAPI/Keychain/libsecret）
//! → OS 凭据；零明文密钥落盘（K1）。GCM 信封 = nonce(12) + ciphertext + tag(16)。

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;

pub(crate) const KEK_SERVICE: &str = "lingfanengine";
pub(crate) const KEK_USER: &str = "kek";

/// K1 备注：高水位文件本身也被 KEK 加密（AAD 域分离），防篡改；删除重置为已知边界（攻击者持文件系统写权限时无法防，灵泛同界）。
static KEK_CACHE: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
static KEK_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// K1：KEK 首次生成后写入 OS 凭据（keyring 统一 DPAPI/Keychain/libsecret），零明文密钥落盘。
/// 进程内互斥 + 缓存：消除首次运行多线程并发创建 KEK 的覆盖竞争（实测暴露过）。
pub(crate) fn kek_from_keyring(service: &str, user: &str) -> Result<Vec<u8>, String> {
    if let Some(cached) = KEK_CACHE.get() {
        return Ok(cached.clone());
    }
    let _guard = KEK_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(cached) = KEK_CACHE.get() {
        return Ok(cached.clone());
    }
    let entry = keyring::Entry::new(service, user).map_err(|e| e.to_string())?;
    let kek = match entry.get_password() {
        Ok(b64) => B64
            .decode(b64.as_bytes())
            .map_err(|e| format!("KEK 解码失败：{e}"))?,
        Err(keyring::Error::NoEntry) => {
            let generated = random_bytes(32)?;
            entry
                .set_password(&B64.encode(&generated))
                .map_err(|e| e.to_string())?;
            generated
        }
        Err(e) => return Err(e.to_string()),
    };
    KEK_CACHE
        .set(kek.clone())
        .map_err(|_| "KEK 缓存冲突".to_string())?;
    Ok(kek)
}

pub(crate) fn random_bytes(n: usize) -> Result<Vec<u8>, String> {
    let mut buf = vec![0u8; n];
    getrandom::fill(&mut buf).map_err(|e| format!("随机源失败：{e}"))?;
    Ok(buf)
}

/// GCM 信封封装：返回 nonce(12) + ciphertext + tag(16)（调用方自行拼接头部与 AAD 域）
pub(crate) fn gcm_seal(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("密钥长度错误：{e}"))?;
    let nonce_bytes = random_bytes(12)?;
    let nonce =
        Nonce::try_from(nonce_bytes.as_slice()).map_err(|_| "nonce 长度错误".to_string())?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| "GCM 加密失败".to_string())?;
    let mut out = nonce_bytes;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// GCM 信封解封：入参 = nonce(12) + ciphertext + tag(16)；认证失败即错（fail-closed）
pub(crate) fn gcm_open(key: &[u8], sealed: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    if sealed.len() < 12 {
        return Err("密文过短".to_string());
    }
    let (nonce, ciphertext) = sealed.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("密钥长度错误：{e}"))?;
    let nonce = Nonce::try_from(nonce).map_err(|_| "nonce 长度错误".to_string())?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| "GCM 认证失败（密钥不匹配或数据被篡改）".to_string())
}
