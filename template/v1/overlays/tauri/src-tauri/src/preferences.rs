//! 偏好域的 Rust 侧实现：`preferences_read` / `preferences_write` 两条命令。
//!
//! 与存档的差别在于**不加密**：偏好只有音量、语言、窗口尺寸这类非敏感项，
//! 密钥管理留在存档域。文件落在应用数据目录的 `preferences.json`，明文 JSON。
//!
//! 字段校验不在这里做：读回来的值原样交给前端，由引擎的 `PlayerPreferences.hydrate`
//! 兜非法字段并退回缺省值。这样新增偏好项时不需要同步改 Rust。

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

/// 偏好文件路径。
fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("建应用数据目录失败: {e}"))?;
    Ok(dir.join("preferences.json"))
}

#[tauri::command]
pub fn preferences_read(app: AppHandle) -> Result<Option<Value>, String> {
    let path = prefs_path(&app)?;
    // 第一次启动没有这个文件，返回 None 让前端取缺省值，不当成错误。
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读偏好失败: {e}")),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(value) => Ok(Some(value)),
        // 文件被手工改坏时按「没有偏好」处理：偏好不值得为它挡住启动。
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn preferences_write(app: AppHandle, prefs: Value) -> Result<(), String> {
    let path = prefs_path(&app)?;
    let text = serde_json::to_string_pretty(&prefs).map_err(|e| format!("序列化偏好失败: {e}"))?;
    // 与存档同法：临时文件 + 改名，避免半截 JSON 覆盖掉还能读的旧偏好。
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("写偏好失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("替换偏好失败: {e}"))?;
    Ok(())
}
