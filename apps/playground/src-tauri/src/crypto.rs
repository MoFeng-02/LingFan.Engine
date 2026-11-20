//! 共享加密原语（KEK + AES-256-GCM 信封）：存档（save/）与资源（resource_crypto/）共用。
//! 密钥分层三级：DEK（每文件/每档随机）→ KEK（每机器随机，桌面 DPAPI/Keychain/libsecret、
//! 移动端 Keychain / Android Keystore）→ OS 凭据；零明文密钥落盘。
//! GCM 信封 = nonce(12) + ciphertext + tag(16)。
//!
//! **凭据访问统一走 `keyring_core`**：keyring 4.x 的 v1 facade（`keyring::Entry`）在**编译期**就把
//! iOS/Android 判为不支持（`Entry::new` 只看 `SET_CREDENTIAL_STORE_RESULT` 的 LazyLock，与是否
//! 自设 store 无关），所以移动端必须绕开 facade：显式装配平台 store 后直接用 keyring-core 的 Entry。

use aes_gcm::aead::{Aead, AeadInOut, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

/// OS 凭据条目的服务名（与 [`KEK_USER`] 一起定位本机唯一的那条 KEK 凭据）。
pub(crate) const KEK_SERVICE: &str = "lingfanengine";
/// OS 凭据条目内的用户名；服务名相同而用户名不同即为另一条凭据。
pub(crate) const KEK_USER: &str = "kek";

/// iOS Keychain 访问策略：`WhenUnlockedThisDeviceOnly`——解锁后可用、**仅限本设备**。
/// 关键取舍：ThisDeviceOnly 的项不随 iOS 加密备份迁移到新设备，切断「备份密码已知即离线
/// 解密 KEK/存档」的备份链（存档本就机器绑定，换机不携 KEK 是合理一致取舍；换机需重新激活）。
/// 经 keyring-core 的 entry modifier 下发（apple protected store 的 `access-policy` 修饰键），
/// 而非 store 配置——store 配置只接受 access-group/cloud-sync。
#[cfg(target_os = "ios")]
const IOS_ACCESS_POLICY: &str = "when-unlocked-this-device-only";

/// KEK 缓存 TTL：折中系统凭据库 IPC 频率与明文 KEK 常驻窗口——到期按需重取，
/// 缩短明文密钥在进程内存的停留时间（内存卫生抬高提取成本，非绝对防护）。
const KEK_CACHE_TTL: Duration = Duration::from_secs(60);

/// KEK 缓存条目：主副本（[`Zeroizing`] 逐出即清零）+ 取用时刻（短 TTL 判定）。
struct KekCacheEntry {
    kek: Zeroizing<Vec<u8>>,
    fetched: Instant,
}

/// 进程内 KEK 短 TTL 缓存：命中且未到期直接返回副本；到期重取并替换（旧主副本 drop 清零）。
static KEK_CACHE: std::sync::Mutex<Option<KekCacheEntry>> = std::sync::Mutex::new(None);
/// 首次取 KEK 的进程内互斥：缓存未命中时只放一个线程去生成并写入凭据，其余线程等它完成后读缓存。
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
            // 诚实限制：上游 android-native-keyring-store 1.0 的配置面只暴露 name/filename/divider，
            // 密钥生成恒 setUserAuthenticationRequired(false) 且无 StrongBox 绑定（entry modifier 亦被拒）。
            // 故 KEK 落**软件 Keystore**（非硬件 StrongBox 隔离）：防同用户 casual 读取，但 root/同用户
            // 边界内仍可提取——不虚假承诺硬件级隔离。StrongBox/认证绑定 opt-in 需自管 Keystore
            // （Android-only JNI KeyGenParameterSpec），另行排期、真机验证；默认保持软件 Keystore 现状。
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

/// 取凭据条目（先确保平台 store 已装配）。
/// iOS 经 entry modifier 下发 ThisDeviceOnly 访问策略（见 [`IOS_ACCESS_POLICY`]）；
/// 其余平台用默认条目（桌面 DPAPI/Keychain/libsecret、Android 软件 Keystore）。
fn credential_entry(service: &str, user: &str) -> Result<keyring_core::Entry, String> {
    ensure_credential_store()?;
    #[cfg(target_os = "ios")]
    {
        let mut modifiers = std::collections::HashMap::new();
        modifiers.insert("access-policy", IOS_ACCESS_POLICY);
        keyring_core::Entry::new_with_modifiers(service, user, &modifiers)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        keyring_core::Entry::new(service, user).map_err(|e| e.to_string())
    }
}

/// KEK 首次生成后写入 OS 凭据，零明文密钥落盘。
/// 进程内互斥 + 短 TTL 缓存：消除首次运行多线程并发创建 KEK 的覆盖竞争；缓存到期按需重取，
/// 缩短明文 KEK 常驻窗口。返回 [`Zeroizing`] 副本——调用方用毕 drop 即清零（内存卫生）。
pub(crate) fn kek_from_keyring(
    service: &str,
    user: &str,
) -> Result<Zeroizing<Vec<u8>>, String> {
    // 短 TTL 命中：未到期直接返回副本（副本 Zeroizing，用后清零）。
    if let Some(entry) = KEK_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
    {
        if entry.fetched.elapsed() < KEK_CACHE_TTL {
            return Ok(Zeroizing::new(entry.kek.to_vec()));
        }
    }
    let _guard = KEK_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // 双检：等锁期间可能已被其他线程刷新缓存。
    if let Some(entry) = KEK_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
    {
        if entry.fetched.elapsed() < KEK_CACHE_TTL {
            return Ok(Zeroizing::new(entry.kek.to_vec()));
        }
    }
    let entry = credential_entry(service, user)?;
    let kek: Zeroizing<Vec<u8>> = match entry.get_password() {
        Ok(b64) => Zeroizing::new(
            B64.decode(b64.as_bytes())
                .map_err(|e| format!("KEK 解码失败：{e}"))?,
        ),
        Err(keyring_core::Error::NoEntry) => {
            let generated = Zeroizing::new(random_bytes(32)?);
            entry
                .set_password(&B64.encode(generated.as_slice()))
                .map_err(|e| e.to_string())?;
            generated
        }
        Err(e) => return Err(e.to_string()),
    };
    // 替换缓存：旧条目 drop → 旧主副本 Zeroizing 清零；新主副本独立持有。
    *KEK_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(KekCacheEntry {
        kek: Zeroizing::new(kek.to_vec()),
        fetched: Instant::now(),
    });
    Ok(kek)
}

/// 取 `n` 字节密码学随机数；随机源不可用时返回错误，不退回弱随机。
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

/// GCM 信封解封·原地版：入参 = nonce(12) + ciphertext + tag(16) 的**持有缓冲**，
/// 解密在缓冲内进行（内存峰值 = 密文 1 倍，无第二份明文分配）；认证失败即错、
/// 缓冲随即丢弃（fail-closed，不返回部分明文）。大负载走本版，借用小负载用 gcm_open。
pub(crate) fn gcm_open_in_place(
    key: &[u8],
    mut sealed: Vec<u8>,
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    if sealed.len() < 12 + 16 {
        return Err("密文过短".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("密钥长度错误：{e}"))?;
    let nonce_arr: [u8; 12] = sealed[..12].try_into().expect("nonce 段恒 12B");
    let nonce = Nonce::try_from(&nonce_arr[..]).map_err(|_| "nonce 长度错误".to_string())?;
    sealed.drain(..12); // ct||tag 就位（memmove，无重分配）
    let ct_len = sealed.len() - 16;
    cipher
        .decrypt_in_place(&nonce, aad, &mut sealed)
        .map_err(|_| "GCM 认证失败（密钥不匹配或数据被篡改）".to_string())?;
    if sealed.len() > ct_len {
        // 钳定：不同 aead 版本对成功后 tag 剥离行为有差异，以明文长度为准
        sealed.truncate(ct_len);
    }
    Ok(sealed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gcm_open_in_place_round_trip_exact_length() {
        // 原地解密：内容与长度双双精确（锚定「成功后缓冲 = 明文、tag 已剥离」语义）
        let key = [7u8; 32];
        let plain = b"hello-in-place-1234567890".to_vec();
        let sealed = gcm_seal(&key, &plain, b"aad").unwrap();
        let opened = gcm_open_in_place(&key, sealed, b"aad").unwrap();
        assert_eq!(opened, plain);
    }

    #[test]
    fn gcm_open_in_place_tamper_fails_closed() {
        let key = [7u8; 32];
        let mut sealed = gcm_seal(&key, b"secret", b"aad").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xFF; // 篡改 tag 末字节
        assert!(gcm_open_in_place(&key, sealed, b"aad").is_err());
        let mut sealed2 = gcm_seal(&key, b"secret", b"aad").unwrap();
        sealed2[20] ^= 0xFF; // 篡改密文体
        assert!(gcm_open_in_place(&key, sealed2, b"aad").is_err());
    }

    #[test]
    fn ios_keychain_this_device_only() {
        // iOS Keychain 访问策略 = WhenUnlockedThisDeviceOnly（断备份迁移）：配置经 entry modifier
        // 下发（apple protected store 的 access-policy 修饰键），源面守卫钉死策略值与下发路径。
        // 只取生产段（mod tests 之前）：测试自身的断言串不计入，守卫才可被「改回默认策略」证伪。
        let src = include_str!("crypto.rs");
        let prod = src.split("mod tests").next().unwrap_or(src);
        assert!(
            prod.contains("when-unlocked-this-device-only"),
            "iOS 访问策略须为 ThisDeviceOnly（断备份链）"
        );
        assert!(
            prod.contains("new_with_modifiers") && prod.contains("\"access-policy\""),
            "iOS 策略须经 keyring-core entry modifier 下发"
        );
    }

    #[test]
    fn kek_zeroize_on_drop_and_cache_short_ttl() {
        // KEK 取用副本是 Zeroizing（drop 即清零）；短 TTL 内两次取同 KEK（缓存命中，非随机重生）。
        let a: Zeroizing<Vec<u8>> = kek_from_keyring(KEK_SERVICE, KEK_USER).unwrap();
        let b: Zeroizing<Vec<u8>> = kek_from_keyring(KEK_SERVICE, KEK_USER).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
        // TTL 是有限短窗口（非永久常驻）：源面守卫钉死短 TTL 常量与到期重取逻辑（只取生产段）。
        let src = include_str!("crypto.rs");
        let prod = src.split("mod tests").next().unwrap_or(src);
        assert!(prod.contains("KEK_CACHE_TTL"), "KEK 缓存须有短 TTL");
        assert!(
            prod.contains("entry.fetched.elapsed() < KEK_CACHE_TTL"),
            "KEK 缓存须按 TTL 到期重取"
        );
        assert!(KEK_CACHE_TTL.as_secs() > 0 && KEK_CACHE_TTL.as_secs() <= 300);
    }

    #[test]
    fn android_keystore_strongbox_opt_in_limitation_registered() {
        // Android StrongBox/认证绑定 opt-in 的限制登记守卫：上游 crate 配置面不暴露 StrongBox/
        // 认证绑定，诚实声明软件 Keystore 现状 + 自管 Keystore 另行排期（不虚假承诺硬件隔离）。
        // 只取生产段（mod tests 之前）：测试自身的断言串不计入，守卫才可被「删诚实声明」证伪。
        let src = include_str!("crypto.rs");
        let prod = src.split("mod tests").next().unwrap_or(src);
        assert!(
            prod.contains("软件 Keystore") && prod.contains("StrongBox") && prod.contains("另行排期"),
            "crypto.rs android 分支须诚实登记软件 Keystore 限制与自管 Keystore 另行排期"
        );
        assert!(
            prod.contains("android_native_keyring_store::Store::new()"),
            "Android 默认保持软件 Keystore 现状（fallback）"
        );
    }
}
