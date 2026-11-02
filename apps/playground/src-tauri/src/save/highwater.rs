//! 高水位：防回档基准的路径、读取与写入。
//!
//! 高水位**按槽位各记一份**，落在 `saves/__highwater__/<slot>.lfs3`。它防的是
//! 「同一槽位被一份更旧的记录覆盖回来」，与别的槽位无关；记成单份全局计数会把
//! 不同槽位的写入顺序当成版本关系——后写的槽位一写，先写的槽位计数就落后于全局
//! 高水位，读它会被判回档，槽位列表里的标题与缩略图也随之消失。

use crate::crypto::gcm_open;
use crate::crypto::gcm_seal;
use crate::save::core::{SaveError, high_water_path};
use std::fs;
use std::path::Path;

const AAD_HIGH_WATER: &[u8] = b"LFS3:highwater";

/// 高水位目录名：与玩家槽位文件分开放，避免「槽位名恰好以它开头」时被扫成存档。
pub(crate) const HIGH_WATER_DIR: &str = "__highwater__";

/// 读取该槽位的高水位；文件不存在视为 0（该槽位首次写入）。
pub(crate) fn read_high_water(base: &Path, slot: &str, kek: &[u8]) -> Result<u64, SaveError> {
    let path = high_water_path(base, slot);
    if !path.exists() {
        return Ok(0);
    }
    let sealed = fs::read(&path).map_err(|e| SaveError::Io(e.to_string()))?;
    let plain = gcm_open(kek, &sealed, AAD_HIGH_WATER)
        .map_err(|e| SaveError::Crypto(format!("高水位：{e}")))?;
    let bytes: [u8; 8] = plain
        .try_into()
        .map_err(|_| SaveError::BadFormat("高水位长度不符".into()))?;
    Ok(u64::from_be_bytes(bytes))
}

/// 写入该槽位的高水位（KEK 加密后落盘）。
pub(crate) fn write_high_water(
    base: &Path,
    slot: &str,
    kek: &[u8],
    count: u64,
) -> Result<(), SaveError> {
    let sealed = gcm_seal(kek, &count.to_be_bytes(), AAD_HIGH_WATER).map_err(SaveError::Crypto)?;
    let path = high_water_path(base, slot);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| SaveError::Io(e.to_string()))?;
    }
    fs::write(path, &sealed).map_err(|e| SaveError::Io(e.to_string()))
}
