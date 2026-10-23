//! 明文资源 URL 的构造：逻辑路径 → 本协议段的完整地址。

use crate::http::protocol_base;
use crate::http::utf8_percent_encode;

/// 逻辑路径 → `{协议基座}/raw/{encodeURIComponent(逻辑路径)}`。
///
/// 整段编码把 `/` 变成 `%2F`，使逻辑路径在协议 path 里成为单一段：WebView 不会在中间
/// 再插一层解析，路由侧解码一次即得原路径。前端只持有返回的字符串，不做任何拼装。
pub(crate) fn url_for(path: &str) -> String {
    format!("{}/raw/{}", protocol_base(), utf8_percent_encode(path))
}

/// `resource_url(path)`：前端取明文资源的唯一入口，返回 `{"url": "<协议地址>"}`。
///
/// 路径先过资源信任边界（空、首字符 `/`、`\`、空段与 `..` 段一律拒绝）——URL 由本命令
/// 构造，非法路径在这里就断，不把可疑地址交给 WebView。返回 JSON 字符串与既有
/// `decrypt_resource` 保持同一形态（前端统一 `JSON.parse` 取字段）。
#[tauri::command]
pub fn resource_url(path: String) -> Result<String, String> {
    if crate::paths::validate_resource_path(&path).is_err() {
        return Err(format!("资源路径非法（越出资源根）：{path}"));
    }
    Ok(serde_json::json!({ "url": url_for(&path) }).to_string())
}
