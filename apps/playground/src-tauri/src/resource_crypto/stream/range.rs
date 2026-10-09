//! v2 资源的分块 Range 响应：请求头通道与查询参数通道，含越界与不可满足的处理。

use crate::http::RangeSpec;
use crate::http::mime_for;
use crate::http::parse_range;
use crate::http::parse_range_strict;
use crate::paths::app_data;
use crate::paths::resource_root;
use crate::resource_crypto::block_cache::{decrypt_v2_block_range};
use crate::resource_crypto::dek::{resource_dek};
use crate::resource_crypto::stream::protocol::{bad_request, not_found};
use crate::resource_crypto::v2::{V2_HEADER_LEN, v2_parse_header};
use crate::resource_fs::ResourceFs;
use percent_encoding::percent_decode_str;
use std::path::Path;

/// v2 按需解密：Range → 覆盖块解密 → 206/200；逻辑路径走 validate_resource_path 信任边界
pub(crate) fn handle_v2_range(
    request: tauri::http::Request<Vec<u8>>,
    encoded: String,
    app: &tauri::AppHandle,
) -> tauri::http::Response<Vec<u8>> {
    let logical = percent_decode_str(&encoded).decode_utf8_lossy().to_string();
    if crate::paths::validate_resource_path(&logical).is_err() {
        return bad_request();
    }
    let root = match resource_root(app) {
        Ok(r) => r,
        Err(_) => return not_found(),
    };
    let resfs = crate::resource_fs::resource_fs(app);
    let data_dir = match app_data(app) {
        Ok(d) => d,
        Err(e) => {
            // 应用数据目录不可用 = DEK 解封不可能：降级 404（进程存活），stderr 留诊断
            eprintln!("[lfen] 应用数据目录不可用，媒体供给降级 404：{e}");
            return not_found();
        }
    };
    let key = match resource_dek(&data_dir, &root, &*resfs) {
        Ok(k) => k,
        Err(_) => return not_found(),
    };
    handle_v2_range_with(&*resfs, request, &encoded, &root, &key)
}

/// v2 单次响应字节上限（官方 asset protocol 同款）：开放尾区间（`bytes=0-`）若不截断，
/// v2 按需解密会退化为全文件解密——媒体引擎按 `Content-Range`（头通道）或已交付长度
/// （query 通道）自动发后续请求，单次实际远小于此。
const V2_RANGE_MAX_LEN: u64 = 1000 * 1024;

/// URL-query 通道取值：`?range=bytes%3D0-1023` → `bytes=0-1023`（值需 percent 解码）。
/// 仅认第一个 `range` 键；无该键 = `None`——此时行为与既有（只读 `Range` 头）逐字一致。
///
/// 存在的理由（Android WebView 缺陷 Chromium 40739128）：带 `Range` 头经
/// `shouldInterceptRequest` 供给时，WebView 会对**已切片的响应体再跳过 start 字节**
/// （偏移被重复施加），非零起点区间必错位；把区间编进 URL query 后请求**不带 `Range` 头**，
/// WebView 不再二次偏移，响应按 200 原样交付。桌面与明文路径不受影响（那里 `Range` 头正常）。
pub(crate) fn range_query_value(query: Option<&str>) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some("range") {
            let raw = it.next().unwrap_or("");
            return Some(percent_decode_str(raw).decode_utf8_lossy().to_string());
        }
    }
    None
}

/// v2 range 核心（与 AppHandle 解耦，可单测）：root/.enc + DEK 由调用方解析。
/// 区间来源二选一——URL query（绕过通道）**优先**于 `Range` 头；两者皆无 = 200 全量。
pub(crate) fn handle_v2_range_with(
    resfs: &dyn ResourceFs,
    request: tauri::http::Request<Vec<u8>>,
    encoded: &str,
    root: &Path,
    key: &[u8],
) -> tauri::http::Response<Vec<u8>> {
    let logical = percent_decode_str(encoded).decode_utf8_lossy().to_string();
    if crate::paths::validate_resource_path(&logical).is_err() {
        return bad_request();
    }
    let enc = root.join(format!("{logical}.enc"));
    let total = match decrypt_v2_total_len(resfs, &enc) {
        Some(t) => t,
        None => return not_found(),
    };
    let header_range = request.headers().get("range").and_then(|v| v.to_str().ok());
    let query_range = range_query_value(request.uri().query());
    // query 通道 = 显式意图，优先于头；无该参数时走原有头路径（行为零变化）
    let (source, req_value, resp) = match query_range {
        Some(value) => (
            "query",
            value.clone(),
            v2_query_range_response(resfs, &enc, key, &logical, total, &value),
        ),
        None => (
            "header",
            header_range.unwrap_or("-").to_string(),
            v2_header_range_response(resfs, &enc, key, &logical, total, header_range),
        ),
    };
    #[cfg(all(target_os = "android", debug_assertions))]
    super::probe::probe_android_range(&logical, source, &req_value, &resp, total);
    #[cfg(not(all(target_os = "android", debug_assertions)))]
    let _ = (source, req_value); // 这两个量只在 Android debug 构建下被区间探测日志消费
    resp
}

/// `Range` 头通道（桌面/明文既有语义，逐字保留）：206 Partial / 416 / 200 全量。
fn v2_header_range_response(
    resfs: &dyn ResourceFs,
    enc: &Path,
    key: &[u8],
    logical: &str,
    total: u64,
    range: Option<&str>,
) -> tauri::http::Response<Vec<u8>> {
    match parse_range(range, total) {
        RangeSpec::Unsatisfiable => range_unsatisfiable(total),
        RangeSpec::Full => {
            // 全量兜底（webview 对 mp4 初始请求恒带 bytes=0-，实际不触发）——流式拼装到总量护栏内
            match decrypt_v2_block_range(resfs, enc, key, logical, 0, total.saturating_sub(1)) {
                Ok(body) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::OK)
                    .header(tauri::http::header::CONTENT_TYPE, mime_for(logical))
                    .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                    .header(tauri::http::header::CONTENT_LENGTH, body.len().to_string())
                    .body(body)
                    .expect("200 响应构造不可失败"),
                Err(_) => not_found(),
            }
        }
        RangeSpec::Partial(start, end) => {
            let end = start + (end - start).min(V2_RANGE_MAX_LEN - 1);
            match decrypt_v2_block_range(resfs, enc, key, logical, start, end) {
                Ok(body) => {
                    let len = body.len();
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::PARTIAL_CONTENT)
                        .header(tauri::http::header::CONTENT_TYPE, mime_for(logical))
                        .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                        .header(tauri::http::header::CONTENT_LENGTH, len.to_string())
                        .header(
                            tauri::http::header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total}"),
                        )
                        .body(body)
                        .expect("206 响应构造不可失败")
                }
                Err(_) => not_found(),
            }
        }
    }
}

/// URL-query 通道响应：**200**，且**不带** `Content-Range`/`Accept-Ranges`——请求本无
/// `Range` 头，不得再以 range 语义回响应（否则又落进 WebView 的二次偏移）。
/// `X-Total-Size` 供调用方推算窗口与明文总量；畸形/越界 = 416（fail-closed，不回落全量）。
fn v2_query_range_response(
    resfs: &dyn ResourceFs,
    enc: &Path,
    key: &[u8],
    logical: &str,
    total: u64,
    value: &str,
) -> tauri::http::Response<Vec<u8>> {
    let Some((start, end)) = parse_range_strict(value, total) else {
        return range_unsatisfiable(total);
    };
    let end = start + (end - start).min(V2_RANGE_MAX_LEN - 1);
    match decrypt_v2_block_range(resfs, enc, key, logical, start, end) {
        Ok(body) => {
            let len = body.len();
            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::OK)
                .header(tauri::http::header::CONTENT_TYPE, mime_for(logical))
                .header(tauri::http::header::CONTENT_LENGTH, len.to_string())
                .header("x-total-size", total.to_string())
                .header(tauri::http::header::CACHE_CONTROL, "no-store")
                .body(body)
                .expect("200 响应构造不可失败")
        }
        Err(_) => not_found(),
    }
}

fn range_unsatisfiable(total: u64) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::RANGE_NOT_SATISFIABLE)
        .header(
            tauri::http::header::CONTENT_RANGE,
            format!("bytes */{total}"),
        )
        .body(Vec::new())
        .expect("静态 416 响应构造不可失败")
}

/// 读 v2 头取明文总长（非 v2 或读失败 = None）
pub(crate) fn decrypt_v2_total_len(resfs: &dyn ResourceFs, enc_file: &Path) -> Option<u64> {
    use std::io::Read;
    let mut head = [0u8; V2_HEADER_LEN];
    let mut f = resfs.open(enc_file).ok()?;
    f.read_exact(&mut head).ok()?;
    v2_parse_header(&head).map(|(_, _, total)| total)
}
