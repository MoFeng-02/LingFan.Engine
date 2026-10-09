//! Android 调试构建下的 Range 支持探测；其他平台不编译本文件内容。

/// 区间探测日志（仅 debug 构建，release 完全移除）：记录 range 来源与取值、响应码、
/// 交付字节首尾——出问题时据此核对「服务端交付的窗口」与实际取字节/播放是否一致。
#[cfg(all(target_os = "android", debug_assertions))]
pub(crate) fn probe_android_range(
    path: &str,
    source: &str,
    req: &str,
    resp: &tauri::http::Response<Vec<u8>>,
    total: u64,
) {
    let body = resp.body();
    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() };
    let head = hex(&body[..body.len().min(4)]);
    let tail = hex(&body[body.len().saturating_sub(4)..]);
    eprintln!(
        "[lfen] range-probe path={path} src={source} req={req} status={} sent={} first={head} last={tail} total={total}",
        resp.status().as_u16(),
        body.len()
    );
}
