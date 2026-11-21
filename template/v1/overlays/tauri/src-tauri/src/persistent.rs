//! 机器级持久数据域的 Rust 侧实现：`persistent_read` / `persistent_write` 两条命令。
//!
//! 与偏好/存档分文件：已读记录是跨存档共享的机器级游戏事实，落 `persistent.json` 明文 JSON
//! （非敏感，不加密；密钥管理留在存档域）。损坏隔离——本文件读坏按「没有持久数据」处理，
//! 不挡住启动，也不波及偏好与存档。
//!
//! 字段校验不在这里做：读回来的值原样交给前端，由 `hydratePersistent` 兜非法字段退回空基线。
//! 这样新增持久字段时不需要同步改 Rust。
//!
//! 错误结构化：失败一律返回 `{code, detail}`（与存档域同口径，前端按 code 分支），
//! 不再返回裸字符串——裸字符串过边界后错误码蒸发，调用方无法区分失败类别。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// 持久数据读写的失败类型；序列化为 `{code, detail}`，前端按 `code` 分支处理。
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
            PersistentError::Io(m) => write!(f, "持久数据读写失败：{m}"),
            PersistentError::BadJson(m) => write!(f, "持久数据不是合法 JSON：{m}"),
        }
    }
}

impl std::error::Error for PersistentError {}

/// 持久数据文件路径。
fn persistent_path(app: &AppHandle) -> Result<PathBuf, PersistentError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PersistentError::Io(format!("取应用数据目录失败: {e}")))?;
    fs::create_dir_all(&dir)
        .map_err(|e| PersistentError::Io(format!("建应用数据目录失败: {e}")))?;
    Ok(dir.join("persistent.json"))
}

/// 读取持久数据（纯函数，便于单测）：缺文件 = None（首次启动取空基线）。
/// 损坏隔离——读坏按「没有持久数据」处理（已读记录非关键，不挡启动，也不波及偏好/存档）。
pub fn read_persistent_file(path: &Path) -> Result<Option<Value>, PersistentError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(PersistentError::Io(format!("读持久数据失败: {e}"))),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(value) => Ok(Some(value)),
        Err(_) => Ok(None),
    }
}

/// 写入持久数据（纯函数，便于单测）：原子写——临时文件 + 改名，避免半截 JSON 覆盖旧数据。
pub fn write_persistent_file(path: &Path, data: &Value) -> Result<(), PersistentError> {
    let text = serde_json::to_string_pretty(data)
        .map_err(|e| PersistentError::BadJson(format!("序列化持久数据失败: {e}")))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| PersistentError::Io(format!("写持久数据失败: {e}")))?;
    fs::rename(&tmp, path).map_err(|e| PersistentError::Io(format!("替换持久数据失败: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn persistent_read(app: AppHandle) -> Result<Option<Value>, PersistentError> {
    read_persistent_file(&persistent_path(&app)?)
}

#[tauri::command]
pub fn persistent_write(app: AppHandle, data: Value) -> Result<(), PersistentError> {
    write_persistent_file(&persistent_path(&app)?, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lf-tpl-persistent-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn missing_file_reads_as_none() {
        let path = temp_path("missing");
        assert_eq!(read_persistent_file(&path).unwrap(), None);
    }

    #[test]
    fn write_then_read_round_trip() {
        let path = temp_path("roundtrip");
        let data = serde_json::json!({ "v": 1, "seen": ["a", "b"] });
        write_persistent_file(&path, &data).unwrap();
        assert_eq!(read_persistent_file(&path).unwrap(), Some(data));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn corrupt_file_isolated_as_none() {
        let path = temp_path("corrupt");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(read_persistent_file(&path).unwrap(), None);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn error_serializes_as_code_detail() {
        let io = serde_json::to_value(PersistentError::Io("x".into())).unwrap();
        assert_eq!(io["code"], "io");
        assert_eq!(io["detail"], "x");
        let bad = serde_json::to_value(PersistentError::BadJson("y".into())).unwrap();
        assert_eq!(bad["code"], "bad-json");
    }
}