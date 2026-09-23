//! 08 §八.2 / U10 玩家偏好持久化（Rust 命令面）：app_data/preferences.json 明文 JSON。
//! 偏好非敏感资产（无密钥），明文落盘（与游戏存档 LFS3 加密完全分离——U10 与存档分离）；
//! 数据校验降级归 TS 侧 PlayerPreferences.hydrate（畸形值回落默认），本层只管存取。

use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::Manager;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum PreferencesError {
    #[serde(rename = "io")]
    Io(String),
    #[serde(rename = "bad-json")]
    BadJson(String),
}

impl std::fmt::Display for PreferencesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PreferencesError::Io(m) => write!(f, "偏好文件读写失败：{m}"),
            PreferencesError::BadJson(m) => write!(f, "偏好文件不是合法 JSON：{m}"),
        }
    }
}

impl std::error::Error for PreferencesError {}

const PREFS_FILE: &str = "preferences.json";

/// 读取偏好；文件不存在 = None（首次启动，TS 侧用默认值起航）
pub fn read_prefs_file(path: &Path) -> Result<Option<serde_json::Value>, PreferencesError> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| PreferencesError::Io(e.to_string()))?;
    let value = serde_json::from_str(&raw).map_err(|e| PreferencesError::BadJson(e.to_string()))?;
    Ok(Some(value))
}

/// 写入偏好（覆盖式；目录不存在则建）
pub fn write_prefs_file(path: &Path, prefs: &serde_json::Value) -> Result<(), PreferencesError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| PreferencesError::Io(e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(prefs)
        .map_err(|e| PreferencesError::BadJson(e.to_string()))?;
    fs::write(path, text).map_err(|e| PreferencesError::Io(e.to_string()))
}

fn prefs_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, PreferencesError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PreferencesError::Io(e.to_string()))?;
    Ok(dir.join(PREFS_FILE))
}

/// 08 §八.2 玩家偏好读取命令
#[tauri::command]
pub fn preferences_read(
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, PreferencesError> {
    read_prefs_file(&prefs_path(&app)?)
}

/// 08 §八.2 玩家偏好写入命令
#[tauri::command]
pub fn preferences_write(
    app: tauri::AppHandle,
    prefs: serde_json::Value,
) -> Result<(), PreferencesError> {
    write_prefs_file(&prefs_path(&app)?, &prefs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "lf3-prefs-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn missing_file_reads_as_none() {
        // 首次启动：无偏好文件 = None（默认值起航），不报错
        let path = temp_path("missing");
        assert_eq!(read_prefs_file(&path).unwrap(), None);
    }

    #[test]
    fn write_then_read_round_trip() {
        // 08 §八.2 持久化往返：写后读同值（pretty JSON 落盘）
        let path = temp_path("roundtrip");
        let prefs = serde_json::json!({
            "v": 1,
            "volumes": { "bgm": 0.5, "se": 0.6, "ambient": 0.8, "voice": 1.0 },
            "muted": false,
            "textSpeed": 45
        });
        write_prefs_file(&path, &prefs).unwrap();
        assert_eq!(read_prefs_file(&path).unwrap(), Some(prefs));
    }

    #[test]
    fn corrupt_file_fails_closed() {
        // 坏 JSON 显式报错（不静默返回 None——诊断归 TS 侧降级）
        let path = temp_path("corrupt");
        fs::write(&path, "{ not json").unwrap();
        assert!(matches!(
            read_prefs_file(&path),
            Err(PreferencesError::BadJson(_))
        ));
    }
}
