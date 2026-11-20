//! 机器级持久数据域的 Rust 侧实现：`persistent_read` / `persistent_write` 两条命令。
//!
//! 与偏好/存档分文件：已读记录是跨存档共享的机器级游戏事实，落 `persistent.json` 明文 JSON
//! （非敏感，不加密；密钥管理留在存档域）。损坏隔离——本文件读坏按「没有持久数据」处理，
//! 不挡住启动，也不波及偏好与存档。
//!
//! 字段校验不在这里做：读回来的值原样交给前端，由 `hydratePersistent` 兜非法字段退回空基线。
//! 这样新增持久字段时不需要同步改 Rust。

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

/// 持久数据文件路径。
fn persistent_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("建应用数据目录失败: {e}"))?;
    Ok(dir.join("persistent.json"))
}

#[tauri::command]
pub fn persistent_read(app: AppHandle) -> Result<Option<Value>, String> {
    let path = persistent_path(&app)?;
    // 第一次启动没有这个文件，返回 None 让前端取空基线，不当成错误。
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读持久数据失败: {e}")),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(value) => Ok(Some(value)),
        // 文件被手工改坏时按「没有持久数据」处理：已读记录不值得为它挡住启动（损坏隔离）。
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn persistent_write(app: AppHandle, data: Value) -> Result<(), String> {
    let path = persistent_path(&app)?;
    let text = serde_json::to_string_pretty(&data).map_err(|e| format!("序列化持久数据失败: {e}"))?;
    // 与偏好同法：临时文件 + 改名，避免半截 JSON 覆盖掉还能读的旧数据。
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("写持久数据失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("替换持久数据失败: {e}"))?;
    Ok(())
}