//! 存档读写主流程：槽位校验、路径辅助、错误类型与四个核心操作。

use crate::crypto::KEK_SERVICE;
use crate::crypto::KEK_USER;
use crate::crypto::gcm_open;
use crate::crypto::gcm_seal;
use crate::crypto::kek_from_keyring;
use crate::crypto::random_bytes;
use crate::save::envelope::{AAD_DEK_MACHINE_BOUND, AAD_PAYLOAD_PREFIX, CryptoMode, FORMAT_VERSION, MAGIC, parse_envelope};
use crate::save::highwater::{HIGH_WATER_FILE, read_high_water, write_high_water};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

/// 安全备注：高水位文件本身也被 KEK 加密（AAD 域分离），防篡改；删除重置为已知边界（攻击者持文件系统写权限时无法防，属已知边界）。

/// 存档读写与安全校验的错误类型；序列化后按 `code` 区分，供前端分支处理。
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

/// 槽位摘要（不解密即可得）：槽名、档内计数、时间戳与加密模式。
#[derive(Debug, Serialize, Clone)]
pub struct SlotSummary {
    pub slot: String,
    pub save_count: u64,
    pub timestamp: u64,
    pub mode: String,
}

/// 槽位名单段规则：字母数字 / `_` / `-`，长度 1..=64（字符集与长度由通用底座的段规则承载，
/// 本函数只剩错误类型映射——槽位会进文件名，穿越形态与非法字符一律 fail-closed）。
fn validate_slot(slot: &str) -> Result<(), SaveError> {
    const SLOT_RULE: crate::paths::SegmentRule = crate::paths::SegmentRule::alnum_ext(Some(64));
    crate::paths::validate_plain_segment(slot, &SLOT_RULE)
        .map_err(|_| SaveError::InvalidSlot(slot.to_string()))
}

/// 存档目录（`<app_data>/saves`）。
pub(crate) fn saves_dir(base: &Path) -> PathBuf {
    base.join("saves")
}

/// 槽位对应的存档文件路径（`<app_data>/saves/<slot>.lfs3`）。
pub(crate) fn save_path(base: &Path, slot: &str) -> PathBuf {
    saves_dir(base).join(format!("{slot}.lfs3"))
}

/// 高水位文件路径。
pub(crate) fn high_water_path(base: &Path) -> PathBuf {
    saves_dir(base).join(HIGH_WATER_FILE)
}

/// 写档 = 随机 DEK → payload 加密（AAD 绑槽）→ DEK 封装（KEK 或明文）→ 认领新高水位
pub fn write_save(
    base: &Path,
    slot: &str,
    payload: &str,
    mode: CryptoMode,
) -> Result<SlotSummary, SaveError> {
    validate_slot(slot)?;
    let kek = kek_from_keyring(KEK_SERVICE, KEK_USER).map_err(SaveError::Keyring)?;
    let high_water = read_high_water(base, &kek)?;
    let save_count = high_water + 1;

    let dek = random_bytes(32).map_err(SaveError::Crypto)?; // 每档独立随机 DEK
    let aad = format!("{AAD_PAYLOAD_PREFIX}{slot}");
    let ciphertext =
        gcm_seal(&dek, payload.as_bytes(), aad.as_bytes()).map_err(SaveError::Crypto)?;
    let dek_part = match mode {
        // MachineBound = KEK 封装（跨机不可解）；Portable = DEK 明文进档（仅存档可分享）
        CryptoMode::MachineBound => {
            gcm_seal(&kek, &dek, AAD_DEK_MACHINE_BOUND).map_err(SaveError::Crypto)?
        }
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
    write_high_water(base, &kek, save_count)?; // 写档即认领新高水位
    Ok(SlotSummary {
        slot: slot.to_string(),
        save_count,
        timestamp,
        mode: mode.as_str().to_string(),
    })
}

/// 读档 = 解封 DEK → GCM 认证（AAD 绑槽，跨槽必拒）→ 高水位防回档 → 认领
pub fn read_save(base: &Path, slot: &str) -> Result<String, SaveError> {
    validate_slot(slot)?;
    let path = save_path(base, slot);
    if !path.exists() {
        return Err(SaveError::UnknownSlot(slot.to_string()));
    }
    let file = fs::read(&path).map_err(|e| SaveError::Io(e.to_string()))?;
    let (mode, save_count, _timestamp, dek_part, ciphertext) = parse_envelope(&file)?;
    let kek = kek_from_keyring(KEK_SERVICE, KEK_USER).map_err(SaveError::Keyring)?;
    let dek = match mode {
        CryptoMode::MachineBound => gcm_open(&kek, &dek_part, AAD_DEK_MACHINE_BOUND)
            .map_err(|e| SaveError::Crypto(format!("DEK 解封：{e}")))?,
        CryptoMode::Portable => dek_part,
    };
    let aad = format!("{AAD_PAYLOAD_PREFIX}{slot}");
    let plaintext = gcm_open(&dek, &ciphertext, aad.as_bytes())
        .map_err(|e| SaveError::Crypto(format!("存档负载：{e}")))?;
    let high_water = read_high_water(base, &kek)?;
    if save_count < high_water {
        return Err(SaveError::RollbackDetected {
            save_count,
            high_water,
        });
    }
    if save_count > high_water {
        write_high_water(base, &kek, save_count)?; // 读档成功后认领新高水位
    }
    String::from_utf8(plaintext).map_err(|_| SaveError::BadFormat("payload 非 UTF-8".into()))
}

/// 删档——槽位文件删除，高水位不动（防回档基准不随删档回退）
pub fn delete_save(base: &Path, slot: &str) -> Result<(), SaveError> {
    validate_slot(slot)?;
    let path = save_path(base, slot);
    if !path.exists() {
        return Err(SaveError::UnknownSlot(slot.to_string()));
    }
    fs::remove_file(&path).map_err(|e| SaveError::Io(e.to_string()))
}

/// save_list：仅解析头部（不解密），供槽位列表展示
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
    out.sort_by_key(|s| std::cmp::Reverse(s.timestamp));
    Ok(out)
}
