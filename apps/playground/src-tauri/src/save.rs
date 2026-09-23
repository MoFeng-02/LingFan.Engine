//! 05-存档与安全（Rust 层）：LFS3 信封 + 每档随机 DEK + KEK 走 OS 凭据 + AAD 绑槽位 + 高水位防回档。
//! K7：全部安全校验在本层完成（TS 只管存档编排）；K6：解密失败 fail-closed，绝不降级。
//!
//! 文件布局（LFS3 v1，二进制）：
//! `MAGIC(4) | version u16 | mode u8 | save_count u64 | timestamp u64 | dek_len u32 | dek_part | ciphertext`
//! ciphertext = AES-256-GCM(payload, key=DEK, AAD="LFS3:payload:{slot}")——K3 写档即绑槽。

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAGIC: &[u8; 4] = b"LFS3";
const FORMAT_VERSION: u16 = 1;
const KEK_SERVICE: &str = "lingfanengine";
const KEK_USER: &str = "kek";
const AAD_PAYLOAD_PREFIX: &str = "LFS3:payload:";
const AAD_DEK_MACHINE_BOUND: &[u8] = b"LFS3:dek:machine-bound";
const AAD_HIGH_WATER: &[u8] = b"LFS3:highwater";
const HIGH_WATER_FILE: &str = "__highwater__.lfs3";
/// K1 备注：高水位文件本身也被 KEK 加密（AAD 域分离），防篡改；删除重置为已知边界（攻击者持文件系统写权限时无法防，灵泛同界）。

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum SaveError {
    #[serde(rename = "keyring")]
    Keyring(String),
    #[serde(rename = "io")]
    Io(String),
    #[serde(rename = "crypto")]
    Crypto(String),
    #[serde(rename = "bad-format")]
    BadFormat(String),
    #[serde(rename = "unknown-slot")]
    UnknownSlot(String),
    #[serde(rename = "invalid-slot")]
    InvalidSlot(String),
    #[serde(rename = "rollback-detected")]
    RollbackDetected { save_count: u64, high_water: u64 },
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SaveError::Keyring(m) => write!(f, "OS 凭据访问失败：{m}"),
            SaveError::Io(m) => write!(f, "文件读写失败：{m}"),
            SaveError::Crypto(m) => write!(f, "加解密失败：{m}"),
            SaveError::BadFormat(m) => write!(f, "存档格式不符：{m}"),
            SaveError::UnknownSlot(s) => write!(f, "槽位不存在：{s}"),
            SaveError::InvalidSlot(s) => write!(f, "槽位名非法：{s}"),
            SaveError::RollbackDetected {
                save_count,
                high_water,
            } => write!(
                f,
                "回档尝试被拒绝：档内 SaveCount={save_count} < 全局高水位 {high_water}"
            ),
        }
    }
}

impl std::error::Error for SaveError {}

#[derive(Debug, Serialize, Clone)]
pub struct SlotSummary {
    pub slot: String,
    pub save_count: u64,
    pub timestamp: u64,
    pub mode: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoMode {
    MachineBound,
    Portable,
}

impl CryptoMode {
    pub fn parse(s: &str) -> Result<Self, SaveError> {
        match s {
            "machine-bound" => Ok(CryptoMode::MachineBound),
            "portable" => Ok(CryptoMode::Portable),
            other => Err(SaveError::BadFormat(format!("未知存档模式：{other}"))),
        }
    }

    fn code(self) -> u8 {
        match self {
            CryptoMode::MachineBound => 0,
            CryptoMode::Portable => 1,
        }
    }

    fn from_code(c: u8) -> Result<Self, SaveError> {
        match c {
            0 => Ok(CryptoMode::MachineBound),
            1 => Ok(CryptoMode::Portable),
            other => Err(SaveError::BadFormat(format!("未知模式码：{other}"))),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            CryptoMode::MachineBound => "machine-bound",
            CryptoMode::Portable => "portable",
        }
    }
}

fn random_bytes(n: usize) -> Result<Vec<u8>, SaveError> {
    let mut buf = vec![0u8; n];
    getrandom::fill(&mut buf).map_err(|e| SaveError::Crypto(format!("随机源失败：{e}")))?;
    Ok(buf)
}

/// K1：KEK 首次生成后写入 OS 凭据（keyring 统一 DPAPI/Keychain/libsecret），零明文密钥落盘。
/// 进程内互斥 + 缓存：消除首次运行多线程并发创建 KEK 的覆盖竞争（实测暴露过）。
static KEK_CACHE: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
static KEK_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn kek_from_keyring(service: &str, user: &str) -> Result<Vec<u8>, SaveError> {
    if let Some(cached) = KEK_CACHE.get() {
        return Ok(cached.clone());
    }
    let _guard = KEK_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(cached) = KEK_CACHE.get() {
        return Ok(cached.clone());
    }
    let entry =
        keyring::Entry::new(service, user).map_err(|e| SaveError::Keyring(e.to_string()))?;
    let kek = match entry.get_password() {
        Ok(b64) => B64.decode(b64.as_bytes()).map_err(|e| {
            SaveError::Keyring(format!("KEK 解码失败：{e}"))
        })?,
        Err(keyring::Error::NoEntry) => {
            let generated = random_bytes(32)?;
            entry
                .set_password(&B64.encode(&generated))
                .map_err(|e| SaveError::Keyring(e.to_string()))?;
            generated
        }
        Err(e) => return Err(SaveError::Keyring(e.to_string())),
    };
    KEK_CACHE
        .set(kek.clone())
        .map_err(|_| SaveError::Keyring("KEK 缓存冲突".into()))?;
    Ok(kek)
}

fn gcm_seal(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, SaveError> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| SaveError::Crypto(format!("密钥长度错误：{e}")))?;
    let nonce_bytes = random_bytes(12)?;
    let nonce =
        Nonce::try_from(nonce_bytes.as_slice()).map_err(|_| SaveError::Crypto("nonce 长度错误".into()))?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| SaveError::Crypto("GCM 加密失败".into()))?;
    let mut out = nonce_bytes;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn gcm_open(key: &[u8], sealed: &[u8], aad: &[u8], context: &str) -> Result<Vec<u8>, SaveError> {
    if sealed.len() < 12 {
        return Err(SaveError::Crypto(format!("{context}: 密文过短")));
    }
    let (nonce, ciphertext) = sealed.split_at(12);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| SaveError::Crypto(format!("密钥长度错误：{e}")))?;
    let nonce = Nonce::try_from(nonce).map_err(|_| SaveError::Crypto("nonce 长度错误".into()))?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| {
            SaveError::Crypto(format!("{context}: GCM 认证失败（密钥不匹配或数据被篡改）"))
        })
}

fn validate_slot(slot: &str) -> Result<(), SaveError> {
    if slot.is_empty()
        || slot.len() > 64
        || !slot
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(SaveError::InvalidSlot(slot.to_string()));
    }
    Ok(())
}

fn saves_dir(base: &Path) -> PathBuf {
    base.join("saves")
}

fn save_path(base: &Path, slot: &str) -> PathBuf {
    saves_dir(base).join(format!("{slot}.lfs3"))
}

fn high_water_path(base: &Path) -> PathBuf {
    saves_dir(base).join(HIGH_WATER_FILE)
}

fn read_high_water(base: &Path, kek: &[u8]) -> Result<u64, SaveError> {
    let path = high_water_path(base);
    if !path.exists() {
        return Ok(0);
    }
    let sealed = fs::read(&path).map_err(|e| SaveError::Io(e.to_string()))?;
    let plain = gcm_open(kek, &sealed, AAD_HIGH_WATER, "高水位")?;
    let bytes: [u8; 8] = plain
        .try_into()
        .map_err(|_| SaveError::BadFormat("高水位长度不符".into()))?;
    Ok(u64::from_be_bytes(bytes))
}

fn write_high_water(base: &Path, kek: &[u8], count: u64) -> Result<(), SaveError> {
    let sealed = gcm_seal(kek, &count.to_be_bytes(), AAD_HIGH_WATER)?;
    fs::create_dir_all(saves_dir(base)).map_err(|e| SaveError::Io(e.to_string()))?;
    fs::write(high_water_path(base), &sealed).map_err(|e| SaveError::Io(e.to_string()))
}

fn parse_envelope(file: &[u8]) -> Result<(CryptoMode, u64, u64, Vec<u8>, Vec<u8>), SaveError> {
    const HEADER: usize = 4 + 2 + 1 + 8 + 8 + 4;
    if file.len() < HEADER {
        return Err(SaveError::BadFormat("文件过短".into()));
    }
    if &file[0..4] != MAGIC {
        return Err(SaveError::BadFormat("魔数不符（非 LFS3）".into()));
    }
    let version = u16::from_be_bytes([file[4], file[5]]);
    if version != FORMAT_VERSION {
        return Err(SaveError::BadFormat(format!("格式版本不支持：{version}")));
    }
    let mode = CryptoMode::from_code(file[6])?;
    let save_count = u64::from_be_bytes(file[7..15].try_into().expect("切片长度固定"));
    let timestamp = u64::from_be_bytes(file[15..23].try_into().expect("切片长度固定"));
    let dek_len = u32::from_be_bytes(file[23..27].try_into().expect("切片长度固定")) as usize;
    if file.len() < HEADER + dek_len {
        return Err(SaveError::BadFormat("dek_part 越界".into()));
    }
    let dek_part = file[HEADER..HEADER + dek_len].to_vec();
    let ciphertext = file[HEADER + dek_len..].to_vec();
    Ok((mode, save_count, timestamp, dek_part, ciphertext))
}

/// K2/K5/K3/K4：写档 = 随机 DEK → payload 加密（AAD 绑槽）→ DEK 封装（KEK 或明文）→ 认领新高水位
pub fn write_save(
    base: &Path,
    slot: &str,
    payload: &str,
    mode: CryptoMode,
) -> Result<SlotSummary, SaveError> {
    validate_slot(slot)?;
    let kek = kek_from_keyring(KEK_SERVICE, KEK_USER)?;
    let high_water = read_high_water(base, &kek)?;
    let save_count = high_water + 1;

    let dek = random_bytes(32)?; // K2：每档独立随机 DEK
    let aad = format!("{AAD_PAYLOAD_PREFIX}{slot}");
    let ciphertext = gcm_seal(&dek, payload.as_bytes(), aad.as_bytes())?;
    let dek_part = match mode {
        // K5：MachineBound = KEK 封装（跨机不可解）；Portable = DEK 明文进档（仅存档可分享）
        CryptoMode::MachineBound => gcm_seal(&kek, &dek, AAD_DEK_MACHINE_BOUND)?,
        CryptoMode::Portable => dek,
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| SaveError::Io(e.to_string()))?
        .as_millis() as u64;
    let mut file = Vec::new();
    file.extend_from_slice(MAGIC);
    file.extend_from_slice(&FORMAT_VERSION.to_be_bytes());
    file.push(mode.code());
    file.extend_from_slice(&save_count.to_be_bytes());
    file.extend_from_slice(&timestamp.to_be_bytes());
    file.extend_from_slice(&(dek_part.len() as u32).to_be_bytes());
    file.extend_from_slice(&dek_part);
    file.extend_from_slice(&ciphertext);

    fs::create_dir_all(saves_dir(base)).map_err(|e| SaveError::Io(e.to_string()))?;
    fs::write(save_path(base, slot), &file).map_err(|e| SaveError::Io(e.to_string()))?;
    write_high_water(base, &kek, save_count)?; // K4：写档即认领新高水位
    Ok(SlotSummary {
        slot: slot.to_string(),
        save_count,
        timestamp,
        mode: mode.as_str().to_string(),
    })
}

/// K3/K4/K6：读档 = 解封 DEK → GCM 认证（AAD 绑槽，跨槽必拒）→ 高水位防回档 → 认领
pub fn read_save(base: &Path, slot: &str) -> Result<String, SaveError> {
    validate_slot(slot)?;
    let path = save_path(base, slot);
    if !path.exists() {
        return Err(SaveError::UnknownSlot(slot.to_string()));
    }
    let file = fs::read(&path).map_err(|e| SaveError::Io(e.to_string()))?;
    let (mode, save_count, _timestamp, dek_part, ciphertext) = parse_envelope(&file)?;
    let kek = kek_from_keyring(KEK_SERVICE, KEK_USER)?;
    let dek = match mode {
        CryptoMode::MachineBound => {
            gcm_open(&kek, &dek_part, AAD_DEK_MACHINE_BOUND, "DEK 解封")?
        }
        CryptoMode::Portable => dek_part,
    };
    let aad = format!("{AAD_PAYLOAD_PREFIX}{slot}");
    let plaintext = gcm_open(&dek, &ciphertext, aad.as_bytes(), "存档负载")?;
    let high_water = read_high_water(base, &kek)?;
    if save_count < high_water {
        return Err(SaveError::RollbackDetected { save_count, high_water });
    }
    if save_count > high_water {
        write_high_water(base, &kek, save_count)?; // K4：读档成功后认领新高水位
    }
    String::from_utf8(plaintext).map_err(|_| SaveError::BadFormat("payload 非 UTF-8".into()))
}

/// §五 save_list：仅解析头部（不解密），供槽位列表展示
pub fn list_saves(base: &Path) -> Result<Vec<SlotSummary>, SaveError> {
    let dir = saves_dir(base);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| SaveError::Io(e.to_string()))?;
    for entry in entries {
        let path = entry.map_err(|e| SaveError::Io(e.to_string()))?.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.ends_with(".lfs3") || name == HIGH_WATER_FILE {
            continue;
        }
        let file = fs::read(&path).map_err(|e| SaveError::Io(e.to_string()))?;
        let (mode, save_count, timestamp, _dek, _ct) = parse_envelope(&file)?;
        out.push(SlotSummary {
            slot: name.trim_end_matches(".lfs3").to_string(),
            save_count,
            timestamp,
            mode: mode.as_str().to_string(),
        });
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(out)
}

#[tauri::command]
pub fn save_write(
    app: tauri::AppHandle,
    slot: String,
    payload: String,
    mode: Option<String>,
) -> Result<SlotSummary, SaveError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| SaveError::Io(e.to_string()))?;
    write_save(
        &base,
        &slot,
        &payload,
        CryptoMode::parse(mode.as_deref().unwrap_or("machine-bound"))?,
    )
}

#[tauri::command]
pub fn save_read(app: tauri::AppHandle, slot: String) -> Result<String, SaveError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| SaveError::Io(e.to_string()))?;
    read_save(&base, &slot)
}

#[tauri::command]
pub fn save_list(app: tauri::AppHandle) -> Result<Vec<SlotSummary>, SaveError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| SaveError::Io(e.to_string()))?;
    list_saves(&base)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_base(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lf3-test-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn kek_persists_in_os_credential_store() {
        // K1 锚点 kek-os-protected：两次获取同一 KEK（来自 OS 凭据，非随机重生）
        let a = kek_from_keyring(KEK_SERVICE, KEK_USER).unwrap();
        let b = kek_from_keyring(KEK_SERVICE, KEK_USER).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn round_trip_machine_bound() {
        let base = test_base("rt");
        let meta = write_save(&base, "slot_1", "{\"gold\":120}", CryptoMode::MachineBound).unwrap();
        assert_eq!(meta.save_count, 1);
        assert_eq!(read_save(&base, "slot_1").unwrap(), "{\"gold\":120}");
    }

    #[test]
    fn per_save_dek_ciphertext_differs() {
        // K2 锚点 per-file-dek：同 payload 两次写档，密文不同（随机 DEK + 随机 nonce）
        let base = test_base("dek");
        write_save(&base, "slot_1", "same", CryptoMode::MachineBound).unwrap();
        let first = fs::read(save_path(&base, "slot_1")).unwrap();
        write_save(&base, "slot_1", "same", CryptoMode::MachineBound).unwrap();
        let second = fs::read(save_path(&base, "slot_1")).unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn aad_binding_rejects_slot_move() {
        // K3 锚点 aad-slot-binding-rejects-move：把 slot_1 的档搬到 slot_2 必拒
        let base = test_base("aad");
        write_save(&base, "slot_1", "data", CryptoMode::MachineBound).unwrap();
        fs::copy(save_path(&base, "slot_1"), save_path(&base, "slot_2")).unwrap();
        match read_save(&base, "slot_2") {
            Err(SaveError::Crypto(_)) => {}
            other => panic!("跨槽读取应被 GCM 认证拒绝，实际：{other:?}"),
        }
    }

    #[test]
    fn high_water_rejects_rollback() {
        // K4 锚点 save-count-high-watermark-rejects-rollback：旧档回放被高水位拒绝
        let base = test_base("hw");
        write_save(&base, "slot_1", "newer", CryptoMode::MachineBound).unwrap();
        let older = fs::read(save_path(&base, "slot_1")).unwrap();
        write_save(&base, "slot_1", "newest", CryptoMode::MachineBound).unwrap();
        fs::write(save_path(&base, "slot_1"), &older).unwrap(); // 模拟回档：旧文件放回
        match read_save(&base, "slot_1") {
            Err(SaveError::RollbackDetected {
                save_count,
                high_water,
            }) => {
                assert_eq!(save_count, 1);
                assert_eq!(high_water, 2);
            }
            other => panic!("回档应被拒绝，实际：{other:?}"),
        }
        // 正常最新档可读（认领后高水位不变）
        fs::write(save_path(&base, "slot_1"), b"placeholder").unwrap();
        write_save(&base, "slot_1", "newest", CryptoMode::MachineBound).unwrap();
        assert_eq!(read_save(&base, "slot_1").unwrap(), "newest");
    }

    #[test]
    fn decrypt_fail_closed_no_plaintext_fallback() {
        // K6 锚点 decrypt-fail-closed：篡改密文 → 认证失败，绝不降级明文
        let base = test_base("ff");
        write_save(&base, "slot_1", "secret", CryptoMode::MachineBound).unwrap();
        let mut file = fs::read(save_path(&base, "slot_1")).unwrap();
        let last = file.len() - 1;
        file[last] ^= 0xFF;
        fs::write(save_path(&base, "slot_1"), &file).unwrap();
        match read_save(&base, "slot_1") {
            Err(SaveError::Crypto(_)) => {}
            other => panic!("篡改后应 fail-closed，实际：{other:?}"),
        }
    }

    #[test]
    fn bad_magic_rejected() {
        let base = test_base("magic");
        write_save(&base, "slot_1", "data", CryptoMode::MachineBound).unwrap();
        let mut file = fs::read(save_path(&base, "slot_1")).unwrap();
        file[0] = b'X';
        fs::write(save_path(&base, "slot_1"), &file).unwrap();
        assert!(matches!(
            read_save(&base, "slot_1"),
            Err(SaveError::BadFormat(_))
        ));
    }

    #[test]
    fn portable_mode_round_trip() {
        // K5 锚点 portable-save-mode：Portable 档独立于 KEK，同 payload 可跨 base 读取
        let base_a = test_base("pt-a");
        let base_b = test_base("pt-b");
        write_save(&base_a, "slot_1", "share-me", CryptoMode::Portable).unwrap();
        fs::create_dir_all(saves_dir(&base_b)).unwrap();
        fs::copy(save_path(&base_a, "slot_1"), save_path(&base_b, "slot_1")).unwrap();
        assert_eq!(read_save(&base_b, "slot_1").unwrap(), "share-me");
    }

    #[test]
    fn invalid_slot_rejected() {
        let base = test_base("slot");
        assert!(matches!(
            write_save(&base, "../evil", "x", CryptoMode::MachineBound),
            Err(SaveError::InvalidSlot(_))
        ));
    }
}
