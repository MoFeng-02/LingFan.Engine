//! 全局高水位：防回档基准的文件名、读取与写入。

use crate::crypto::gcm_open;
use crate::crypto::gcm_seal;
use crate::save::core::{SaveError, high_water_path, saves_dir};
use std::fs;
use std::path::Path;

const AAD_HIGH_WATER: &[u8] = b"LFS3:highwater";

/// 高水位文件名，落在存档目录内（与槽位文件同目录，靠 `__` 前缀与玩家槽名区分）。
pub(crate) const HIGH_WATER_FILE: &str = "__highwater__.lfs3";

/// 读取全局高水位；文件不存在视为 0（首次运行）。
pub(crate) fn read_high_water(base: &Path, kek: &[u8]) -> Result<u64, SaveError> {
    let path = high_water_path(base);
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

/// 写入全局高水位（KEK 加密后落盘）。
pub(crate) fn write_high_water(base: &Path, kek: &[u8], count: u64) -> Result<(), SaveError> {
    let sealed = gcm_seal(kek, &count.to_be_bytes(), AAD_HIGH_WATER).map_err(SaveError::Crypto)?;
    fs::create_dir_all(saves_dir(base)).map_err(|e| SaveError::Io(e.to_string()))?;
    fs::write(high_water_path(base), &sealed).map_err(|e| SaveError::Io(e.to_string()))
}
