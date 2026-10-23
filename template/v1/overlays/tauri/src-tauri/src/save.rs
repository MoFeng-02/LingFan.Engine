//! 存档域的 Rust 侧实现：`save_write` / `save_read` / `save_delete` / `save_list` 四条命令。
//!
//! 命令名与参数形状是**跨语言契约**：前端 `packages/adapters/src/save/tauri.ts` 按这些名字
//! invoke，改名或改参数键就要两边同时改。槽位摘要是 snake_case，前端自己做 camelCase 映射。
//!
//! 存档落在应用数据目录的 `saves/` 下，一槽一文件（`<slot>.json`），先写临时文件再改名，
//! 避免进程在写一半时被杀留下半个存档。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// `save_list` 的返回行。字段名保持 snake_case，前端按这个形状映射成引擎的槽位摘要。
#[derive(Serialize, Deserialize)]
pub struct SlotSummary {
    pub slot: String,
    pub save_count: u32,
    pub timestamp: u64,
    pub mode: String,
}

/// 存档目录：应用数据目录下的 `saves/`，不存在时创建。
fn saves_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败: {e}"))?
        .join("saves");
    fs::create_dir_all(&dir).map_err(|e| format!("建存档目录失败: {e}"))?;
    Ok(dir)
}

/// 单个槽位的文件路径。槽位名来自调用方，`..` 之类会逃出目录，
/// 这里只放行字母数字与 `-` `_`，其余一律拒绝。
fn slot_path(app: &AppHandle, slot: &str) -> Result<PathBuf, String> {
    if slot.is_empty()
        || !slot
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("非法槽位名: {slot}"));
    }
    Ok(saves_dir(app)?.join(format!("{slot}.json")))
}

#[tauri::command]
pub fn save_write(
    app: AppHandle,
    slot: String,
    payload: String,
    mode: String,
) -> Result<(), String> {
    let target = slot_path(&app, &slot)?;
    let body = serde_json::json!({
        "slot": slot,
        "mode": mode,
        "timestamp": now_secs(),
        "payload": payload,
    });
    let text = serde_json::to_string(&body).map_err(|e| format!("序列化存档失败: {e}"))?;

    // 先写临时文件再改名：改名在同一文件系统内是原子的，
    // 中途崩溃只会留下临时文件，不会让槽位文件变成半截 JSON。
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("写存档失败: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("替换存档失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn save_read(app: AppHandle, slot: String) -> Result<String, String> {
    let target = slot_path(&app, &slot)?;
    let text = fs::read_to_string(&target).map_err(|e| format!("读存档失败: {e}"))?;
    let body: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("存档不是合法 JSON: {e}"))?;
    // 只把 payload 还给前端：外面那层是本实现的封套，不属于存档内容。
    body.get("payload")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("存档 {slot} 缺少 payload 字段"))
}

#[tauri::command]
pub fn save_delete(app: AppHandle, slot: String) -> Result<(), String> {
    let target = slot_path(&app, &slot)?;
    // 槽位本就不存在时视为成功：删档是幂等操作，重试不该报错。
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删档失败: {e}")),
    }
}

#[tauri::command]
pub fn save_list(app: AppHandle) -> Result<Vec<SlotSummary>, String> {
    let dir = saves_dir(&app)?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("列存档目录失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        // 只认 `.json`：临时文件与别的东西不参与列表。
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(body) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let slot = body
            .get("slot")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_string()
            });
        out.push(SlotSummary {
            slot,
            save_count: body.get("save_count").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
            timestamp: body.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0),
            mode: body
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("normal")
                .to_string(),
        });
    }
    // 新的排前面：前端列表直接取这个顺序当「最近存档」。
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(out)
}

/// 当前时间（秒）。只用于列表排序与展示，不参与任何校验。
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
