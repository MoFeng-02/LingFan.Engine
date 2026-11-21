//! 偏好域的 Rust 侧实现：`preferences_read` / `preferences_write` 两条命令。
//!
//! 与存档的差别在于**不加密**：偏好只有音量、语言、窗口尺寸这类非敏感项，
//! 密钥管理留在存档域。文件落在应用数据目录的 `preferences.json`，明文 JSON。
//!
//! 字段校验不在这里做：读回来的值原样交给前端，由引擎的 `PlayerPreferences.hydrate`
//! 兜非法字段并退回缺省值。这样新增偏好项时不需要同步改 Rust。
//!
//! 错误结构化：失败一律返回 `{code, detail}`（与存档域同口径，前端按 code 分支），
//! 不再返回裸字符串——裸字符串过边界后错误码蒸发，调用方无法区分失败类别。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// 偏好读写的失败类型；序列化为 `{code, detail}`，前端按 `code` 分支处理。
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
            PreferencesError::BadJson(m) => write!(f, "偏好数据不是合法 JSON：{m}"),
        }
    }
}

impl std::error::Error for PreferencesError {}

/// 偏好文件路径。
fn prefs_path(app: &AppHandle) -> Result<PathBuf, PreferencesError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PreferencesError::Io(format!("取应用数据目录失败: {e}")))?;
    fs::create_dir_all(&dir)
        .map_err(|e| PreferencesError::Io(format!("建应用数据目录失败: {e}")))?;
    Ok(dir.join("preferences.json"))
}

/// 读取偏好（纯函数，便于单测）：缺文件 = None（首次启动取缺省值）。
/// 损坏隔离——文件被手工改坏按「没有偏好」处理（偏好非关键资产，不值得为它挡住启动；
/// 字段级降级另由前端 hydrate 兜底），与存档域的 fail-closed 刻意不同。
pub fn read_prefs_file(path: &Path) -> Result<Option<Value>, PreferencesError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(PreferencesError::Io(format!("读偏好失败: {e}"))),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(value) => Ok(Some(value)),
        Err(_) => Ok(None),
    }
}

/// 写入偏好（纯函数，便于单测）：原子写——临时文件 + 改名，避免半截 JSON 覆盖旧偏好。
pub fn write_prefs_file(path: &Path, prefs: &Value) -> Result<(), PreferencesError> {
    let text = serde_json::to_string_pretty(prefs)
        .map_err(|e| PreferencesError::BadJson(format!("序列化偏好失败: {e}")))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| PreferencesError::Io(format!("写偏好失败: {e}")))?;
    fs::rename(&tmp, path).map_err(|e| PreferencesError::Io(format!("替换偏好失败: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn preferences_read(app: AppHandle) -> Result<Option<Value>, PreferencesError> {
    read_prefs_file(&prefs_path(&app)?)
}

#[tauri::command]
pub fn preferences_write(app: AppHandle, prefs: Value) -> Result<(), PreferencesError> {
    write_prefs_file(&prefs_path(&app)?, &prefs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lf-tpl-prefs-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn missing_file_reads_as_none() {
        let path = temp_path("missing");
        assert_eq!(read_prefs_file(&path).unwrap(), None);
    }

    #[test]
    fn write_then_read_round_trip() {
        let path = temp_path("roundtrip");
        let prefs = serde_json::json!({ "v": 1, "textSpeed": 45 });
        write_prefs_file(&path, &prefs).unwrap();
        assert_eq!(read_prefs_file(&path).unwrap(), Some(prefs));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn corrupt_file_isolated_as_none() {
        // 损坏隔离：坏 JSON 读回 None（不挡启动），但错误类型仍是结构化的（写路径可返 bad-json）。
        let path = temp_path("corrupt");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(read_prefs_file(&path).unwrap(), None);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn error_serializes_as_code_detail() {
        // 结构化错误过边界形态：{code, detail}（前端按 code 分支，不蒸发成裸字符串）。
        let io = serde_json::to_value(PreferencesError::Io("x".into())).unwrap();
        assert_eq!(io["code"], "io");
        assert_eq!(io["detail"], "x");
        let bad = serde_json::to_value(PreferencesError::BadJson("y".into())).unwrap();
        assert_eq!(bad["code"], "bad-json");
    }
}