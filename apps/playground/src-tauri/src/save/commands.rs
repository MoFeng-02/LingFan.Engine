//! Tauri 命令层：解析应用数据目录后转发到核心逻辑。

use crate::save::core::{SaveError, SlotSummary, delete_save, list_saves, read_save, write_save};
use crate::save::envelope::{CryptoMode};
use tauri::Manager;

/// Tauri 命令：写档（加密模式缺省为机器绑定）。
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

/// Tauri 命令：读档（校验槽位、AAD 与高水位）。
#[tauri::command]
pub fn save_read(app: tauri::AppHandle, slot: String) -> Result<String, SaveError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| SaveError::Io(e.to_string()))?;
    read_save(&base, &slot)
}

/// Tauri 命令：列出全部槽位摘要。
#[tauri::command]
pub fn save_list(app: tauri::AppHandle) -> Result<Vec<SlotSummary>, SaveError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| SaveError::Io(e.to_string()))?;
    list_saves(&base)
}

/// Tauri 命令：删除指定槽位（高水位不回退）。
#[tauri::command]
pub fn save_delete(app: tauri::AppHandle, slot: String) -> Result<(), SaveError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| SaveError::Io(e.to_string()))?;
    delete_save(&base, &slot)
}
