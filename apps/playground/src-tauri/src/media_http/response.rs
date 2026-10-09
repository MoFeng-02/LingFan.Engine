//! 最小 HTTP/1.1 响应构造：状态行、CORS 头与空响应。

use std::io::Write;

/// 回一个无响应体的状态码（错误路径与零长资源共用）。
pub(crate) fn empty<W: Write>(writer: &mut W, status: u16) -> std::io::Result<()> {
    write_head(writer, status, 0, &[])?;
    writer.flush()
}

/// 手写响应头（最小 HTTP/1.1）：统一 `Connection: close`（本服务无长连接语义）；
/// CORS 头必需——媒体元素带 `crossOrigin="anonymous"`，跨源（页面源自 tauri.localhost）。
pub(crate) fn write_head<W: Write>(
    writer: &mut W,
    status: u16,
    content_length: u64,
    extra: &[(&str, String)],
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        400 => "Bad Request",
        404 => "Not Found",
        416 => "Range Not Satisfiable",
        _ => "OK",
    };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    head.push_str("Cache-Control: no-store\r\n");
    head.push_str("Access-Control-Allow-Origin: *\r\n");
    head.push_str(
        "Access-Control-Expose-Headers: content-range,content-length,content-type,accept-ranges\r\n",
    );
    for (name, value) in extra {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("Content-Length: {content_length}\r\n"));
    head.push_str("Connection: close\r\n\r\n");
    writer.write_all(head.as_bytes())
}
