//! 05 §三 共享加密原语（KEK + AES-256-GCM 信封）：存档（save.rs）与资源（resource_crypto.rs）共用。
//! 密钥分层三级：DEK（每文件/每档随机）→ KEK（每机器随机，桌面 DPAPI/Keychain/libsecret、
//! 移动端 Keychain / Android Keystore）→ OS 凭据；零明文密钥落盘（K1）。
//! GCM 信封 = nonce(12) + ciphertext + tag(16)。
//!
//! **凭据访问统一走 `keyring_core`**：keyring 4.x 的 v1 facade（`keyring::Entry`）在**编译期**就把
//! iOS/Android 判为不支持（`Entry::new` 只看 `SET_CREDENTIAL_STORE_RESULT` 的 LazyLock，与我们是否
//! 自设 store 无关），所以移动端必须绕开 facade：显式装配平台 store 后直接用 keyring-core 的 Entry。

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;

pub(crate) const KEK_SERVICE: &str = "lingfanengine";
pub(crate) const KEK_USER: &str = "kek";

/// K1 备注：高水位文件本身也被 KEK 加密（AAD 域分离），防篡改；删除重置为已知边界（攻击者持文件系统写权限时无法防，灵泛同界）。
static KEK_CACHE: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
static KEK_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 凭据 store 一次性装配（进程内只做一次，结果缓存——含失败结果，避免反复创建/重试）。
/// - 桌面：触发 keyring v1 facade 的平台装配（其内部 LazyLock 会把 DPAPI/Keychain/libsecret 设为默认 store）；
/// - iOS：`apple-native-keyring-store` 的 protected store（Keychain，需 `protected` 特性）；
/// - Android：`android-native-keyring-store`（SharedPreferences + Keystore；其 ndk-context 已由 Tauri 初始化）。
fn ensure_credential_store() -> Result<(), String> {
    static ONCE: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    ONCE.get_or_init(|| {
        #[cfg(not(any(target_os = "ios", target_os = "android")))]
        {
            keyring::Entry::store_status()
                .as_ref()
                .map(|_| ())
                .map_err(|e| format!("桌面凭据 store 装配失败：{e}"))?;
        }
        #[cfg(target_os = "ios")]
        {
            let store = apple_native_keyring_store::protected::Store::new_with_configuration(
                &std::collections::HashMap::new(),
            )
            .map_err(|e| format!("iOS 凭据 store 创建失败：{e}"))?;
            keyring_core::set_default_store(store);
        }
        #[cfg(target_os = "android")]
        {
            let store = android_native_keyring_store::Store::new()
                .map_err(|e| format!("Android 凭据 store 创建失败：{e}"))?;
            keyring_core::set_default_store(store);
        }
        #[cfg(debug_assertions)]
        eprintln!(
            "[lfen] 凭据 store 装配完成（target_os={}）",
            std::env::consts::OS
        );
        Ok(())
    })
    .clone()
}

/// 取凭据条目（先确保平台 store 已装配）
fn credential_entry(service: &str, user: &str) -> Result<keyring_core::Entry, String> {
    ensure_credential_store()?;
    keyring_core::Entry::new(service, user).map_err(|e| e.to_string())
}

/// K1：KEK 首次生成后写入 OS 凭据，零明文密钥落盘。
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
    let entry = credential_entry(service, user)?;
    let kek = match entry.get_password() {
        Ok(b64) => B64
            .decode(b64.as_bytes())
            .map_err(|e| format!("KEK 解码失败：{e}"))?,
        Err(keyring_core::Error::NoEntry) => {
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
