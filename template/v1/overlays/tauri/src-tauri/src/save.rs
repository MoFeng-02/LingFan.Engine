//! 存档域的 Rust 侧实现：`save_write` / `save_read` / `save_delete` / `save_list` 四条命令。
//!
//! **安全口径**：本壳是明文参考实现——存档为明文 JSON，无加密、无防回档高水位。
//! 交付级安全（密钥管理 / 加密 / 防回档）需自带 Rust 安全层，完整参考见引擎参考宿主。
//! 明文不等于无校验：槽位名与负载形状仍然 fail-closed，非法输入拒绝且不落盘。
//!
//! 命令名、参数形状与错误形状都是**跨语言契约**：前端 `packages/adapters/src/save/tauri.ts`
//! 按这些名字 invoke，错误按 `code` 分支消费（serde tag="code" content="detail"）。
//! 改名、改参数键或改错误码都要两边同时改（跨边界互锁测试守着）。
//! 槽位摘要是 snake_case，前端自己做 camelCase 映射。
//!
//! 存档落在应用数据目录的 `saves/` 下，一槽一文件（`<slot>.json`），先写临时文件再改名，
//! 避免进程在写一半时被杀留下半个存档。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 存档命令的结构化错误：过边界后是 `{ code, detail }`，前端按 code 分支、
/// 用 detail 补充可读信息。错误码是跨语言契约的一部分，增删须与前端错误码目录同步。
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "code", content = "detail")]
pub enum SaveError {
    /// 槽位名非法（空 / 超长 / 含路径分隔符等逃逸形态）
    #[serde(rename = "invalid-slot")]
    InvalidSlot(String),
    /// 文件系统读写失败（含目录不可用、存档缺失）
    #[serde(rename = "io")]
    Io(String),
    /// 存档封套不是合法 JSON 或缺必要字段
    #[serde(rename = "bad-format")]
    BadFormat(String),
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SaveError::InvalidSlot(m) => write!(f, "槽位名非法：{m}"),
            SaveError::Io(m) => write!(f, "文件读写失败：{m}"),
            SaveError::BadFormat(m) => write!(f, "数据格式损坏：{m}"),
        }
    }
}

impl std::error::Error for SaveError {}

/// `save_list` 的返回行。字段名保持 snake_case，前端按这个形状映射成引擎的槽位摘要。
#[derive(Serialize, Deserialize)]
pub struct SlotSummary {
    pub slot: String,
    pub save_count: u32,
    pub timestamp: u64,
    pub mode: String,
}

/// 存档目录：应用数据目录下的 `saves/`，不存在时创建。
fn saves_dir(app: &AppHandle) -> Result<PathBuf, SaveError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| SaveError::Io(format!("取应用数据目录失败: {e}")))?
        .join("saves");
    fs::create_dir_all(&dir).map_err(|e| SaveError::Io(format!("建存档目录失败: {e}")))?;
    Ok(dir)
}

/// 槽位名长度上限：与引擎核心及参考宿主的校验口径一致（1..=64）。
const MAX_SLOT_LEN: usize = 64;

/// 校验槽位名。槽位名来自调用方，`..` 或路径分隔符会逃出存档目录，
/// 因此只放行 ASCII 字母数字与 `-` `_`，且长度 1..=64。
///
/// 单独拆出来是为了能直接对校验规则做单元测试：`slot_path` 需要 `AppHandle`，
/// 在测试里造不出来。
fn validate_slot(slot: &str) -> Result<(), SaveError> {
    if slot.is_empty()
        || slot.len() > MAX_SLOT_LEN
        || !slot
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(SaveError::InvalidSlot(format!("非法槽位名: {slot}")));
    }
    Ok(())
}

/// 单个槽位的文件路径。
fn slot_path(app: &AppHandle, slot: &str) -> Result<PathBuf, SaveError> {
    validate_slot(slot)?;
    Ok(saves_dir(app)?.join(format!("{slot}.json")))
}

/// 下一次写入的存档计数：旧档计数 + 1；无旧档或旧档损坏从 1 起。
///
/// 明文壳没有独立的高水位文件，计数只随本槽位旧档走——旧档被外部删除/损坏时
/// 计数会重置，这是明文参考实现的已知局限（交付级防回档需自带安全层）。
fn next_save_count(previous: Option<&str>) -> u32 {
    let Some(text) = previous else {
        return 1;
    };
    let Ok(body) = serde_json::from_str::<serde_json::Value>(text) else {
        return 1;
    };
    let count = body.get("save_count").and_then(|v| v.as_u64()).unwrap_or(0);
    count.saturating_add(1).min(u32::MAX as u64) as u32
}

#[tauri::command]
pub fn save_write(
    app: AppHandle,
    slot: String,
    payload: String,
    mode: String,
) -> Result<(), SaveError> {
    let target = slot_path(&app, &slot)?;
    let previous = fs::read_to_string(&target).ok();
    let body = serde_json::json!({
        "slot": slot,
        "mode": mode,
        "timestamp": now_secs(),
        "save_count": next_save_count(previous.as_deref()),
        "payload": payload,
    });
    let text = serde_json::to_string(&body)
        .map_err(|e| SaveError::BadFormat(format!("序列化存档失败: {e}")))?;

    // 先写临时文件再改名：改名在同一文件系统内是原子的，
    // 中途崩溃只会留下临时文件，不会让槽位文件变成半截 JSON。
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| SaveError::Io(format!("写存档失败: {e}")))?;
    fs::rename(&tmp, &target).map_err(|e| SaveError::Io(format!("替换存档失败: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn save_read(app: AppHandle, slot: String) -> Result<String, SaveError> {
    let target = slot_path(&app, &slot)?;
    let text = fs::read_to_string(&target)
        .map_err(|e| SaveError::Io(format!("读存档失败: {e}")))?;
    let body: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| SaveError::BadFormat(format!("存档不是合法 JSON: {e}")))?;
    // 只把 payload 还给前端：外面那层是本实现的封套，不属于存档内容。
    body.get("payload")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| SaveError::BadFormat(format!("存档 {slot} 缺少 payload 字段")))
}

#[tauri::command]
pub fn save_delete(app: AppHandle, slot: String) -> Result<(), SaveError> {
    let target = slot_path(&app, &slot)?;
    // 槽位本就不存在时视为成功：删档是幂等操作，重试不该报错。
    // （参考宿主对缺档报 unknown-slot；本明文壳有意保留幂等口径，两者都合法。）
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(SaveError::Io(format!("删档失败: {e}"))),
    }
}

#[tauri::command]
pub fn save_list(app: AppHandle) -> Result<Vec<SlotSummary>, SaveError> {
    let dir = saves_dir(&app)?;
    let mut out = Vec::new();
    let entries =
        fs::read_dir(&dir).map_err(|e| SaveError::Io(format!("列存档目录失败: {e}")))?;
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

#[cfg(test)]
mod tests {
    use super::{next_save_count, validate_slot, SaveError};

    #[test]
    fn accepts_regular_slot_names() {
        for slot in ["slot1", "Slot_2", "a-b_c", "9"] {
            assert!(validate_slot(slot).is_ok(), "{slot} 应当被接受");
        }
    }

    #[test]
    fn rejects_empty_slot_name() {
        assert!(validate_slot("").is_err());
    }

    #[test]
    fn rejects_names_escaping_save_dir() {
        for slot in ["..", "../etc", "a/b", "a\\b", "a.b", "slot 1"] {
            assert!(validate_slot(slot).is_err(), "{slot} 应当被拒绝");
        }
    }

    #[test]
    fn slot_length_boundary_1_to_64() {
        assert!(validate_slot(&"a".repeat(64)).is_ok(), "64 位应被接受");
        assert!(validate_slot(&"a".repeat(65)).is_err(), "65 位应被拒绝");
        assert!(validate_slot(&"a".repeat(1000)).is_err(), "超长应被拒绝");
    }

    #[test]
    fn save_count_increments_from_previous_envelope() {
        assert_eq!(next_save_count(None), 1);
        assert_eq!(next_save_count(Some(r#"{"save_count":4}"#)), 5);
        // 旧档损坏 / 缺计数 / 非数字：从 1 起（明文壳无高水位，已知局限）
        assert_eq!(next_save_count(Some("not json")), 1);
        assert_eq!(next_save_count(Some(r#"{"payload":"x"}"#)), 1);
        assert_eq!(next_save_count(Some(r#"{"save_count":"many"}"#)), 1);
        // 饱和不溢出
        assert_eq!(
            next_save_count(Some(&format!(r#"{{"save_count":{}}}"#, u32::MAX))),
            u32::MAX
        );
    }

    #[test]
    fn errors_cross_boundary_as_code_detail() {
        // 错误形状是跨语言契约：{ code, detail }，前端按 code 分支
        let value = serde_json::to_value(SaveError::InvalidSlot("x".into())).unwrap();
        assert_eq!(value["code"], "invalid-slot");
        assert_eq!(value["detail"], "x");
        let value = serde_json::to_value(SaveError::Io("y".into())).unwrap();
        assert_eq!(value["code"], "io");
        let value = serde_json::to_value(SaveError::BadFormat("z".into())).unwrap();
        assert_eq!(value["code"], "bad-format");
    }

    #[test]
    fn error_display_is_readable() {
        let err = SaveError::InvalidSlot("../etc".into());
        assert!(err.to_string().contains("../etc"));
        assert!(!err.to_string().is_empty());
    }
}