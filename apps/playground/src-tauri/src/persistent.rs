//! 机器级持久数据（Rust 命令面）：app_data/persistent.json 明文 JSON。
//! 已读记录非敏感资产（无密钥），明文落盘；与偏好/存档分文件（损坏隔离，删档不清本层）。
//! 数据校验降级归 TS 侧 hydratePersistent（畸形值回落空基线），本层只管存取。

use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::Manager;

/// 持久数据读写的失败类型；序列化为 `{code, detail}`，前端按 `code` 分支处理。
/// 复用偏好/存档同款 io / bad-json 码（前端已有消费点，不新增错误码）。
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum PersistentError {
    #[serde(rename = "io")]
    Io(String),
    #[serde(rename = "bad-json")]
    BadJson(String),
}

impl std::fmt::Display for PersistentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PersistentError::Io(m) => write!(f, "持久数据文件读写失败：{m}"),
            PersistentError::BadJson(m) => write!(f, "持久数据文件不是合法 JSON：{m}"),
        }
    }
}

impl std::error::Error for PersistentError {}

const PERSISTENT_FILE: &str = "persistent.json";

/// 读取持久数据；文件不存在 = None（首次启动，TS 侧用空基线起航）
pub fn read_persistent_file(path: &Path) -> Result<Option<serde_json::Value>, PersistentError> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| PersistentError::Io(e.to_string()))?;
    let value = serde_json::from_str(&raw).map_err(|e| PersistentError::BadJson(e.to_string()))?;
    Ok(Some(value))
}

/// 写入持久数据（覆盖式；目录不存在则建）
pub fn write_persistent_file(path: &Path, data: &serde_json::Value) -> Result<(), PersistentError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| PersistentError::Io(e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(data)
        .map_err(|e| PersistentError::BadJson(e.to_string()))?;
    fs::write(path, text).map_err(|e| PersistentError::Io(e.to_string()))
}

fn persistent_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, PersistentError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PersistentError::Io(e.to_string()))?;
    Ok(dir.join(PERSISTENT_FILE))
}

/// 机器级持久数据读取命令
#[tauri::command]
pub fn persistent_read(
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, PersistentError> {
    read_persistent_file(&persistent_path(&app)?)
}

/// 机器级持久数据写入命令
#[tauri::command]
pub fn persistent_write(
    app: tauri::AppHandle,
    data: serde_json::Value,
) -> Result<(), PersistentError> {
    write_persistent_file(&persistent_path(&app)?, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "lf3-persistent-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn missing_file_reads_as_none() {
        // 首次启动：无持久数据文件 = None（空基线起航），不报错
        let path = temp_path("missing");
        assert_eq!(read_persistent_file(&path).unwrap(), None);
    }

    #[test]
    fn write_then_read_round_trip() {
        // 持久化往返：写后读同值（pretty JSON 落盘）
        let path = temp_path("roundtrip");
        let data = serde_json::json!({
            "v": 1,
            "seen": { "chapter1": [0, 1, 2] }
        });
        write_persistent_file(&path, &data).unwrap();
        assert_eq!(read_persistent_file(&path).unwrap(), Some(data));
    }

    #[test]
    fn corrupt_file_fails_closed() {
        // 坏 JSON 显式报错（不静默返回 None——诊断归 TS 侧降级）
        let path = temp_path("corrupt");
        fs::write(&path, "{ not json").unwrap();
        assert!(matches!(
            read_persistent_file(&path),
            Err(PersistentError::BadJson(_))
        ));
    }
}