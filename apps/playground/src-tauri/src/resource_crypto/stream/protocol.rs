//! lfstream 自定义协议的请求入口：分发、令牌与 v2 路径识别、整文件 Range 响应。

use crate::http::RangeSpec;
use crate::http::mime_for;
use crate::http::parse_range;
use crate::http::utf8_percent_encode;
use crate::paths::app_data;
use crate::paths::resource_root;
use crate::resource_crypto::block_cache::{decrypt_v2_block_range};
use crate::resource_crypto::dek::{resource_dek};
use crate::resource_crypto::error::{ResourceCryptoError, io};
use crate::resource_crypto::format::{MAGIC_LFEN2};
use crate::resource_crypto::media_route::{loopback_media_url};
use crate::resource_crypto::stream::cache::{stream_decrypt_to_cache, tmp_stream_dir};
use crate::resource_crypto::stream::range::{handle_v2_range};
use crate::resource_crypto::v2::{FORMAT_VERSION_V2, V2_HEADER_LEN};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

/// 解密落盘进程内互斥：同资源并发 resolve 竞争同一缓存文件的写句柄（Windows 文件锁冲突）
static STREAM_DECRYPT_LOCK: Mutex<()> = Mutex::new(());

/// `decrypt_resource(path)`（流式 + LFEN2 v2 分形态负载）：
/// - v1 整文件：解密到临时流缓存（同资源幂等复用）→ `{"file":"<缓存名>"}` →
///   TS `convertFileSrc(file, "lfstream")`（token 缓存路径）
/// - v2 分块：**不落明文缓存**——`{"v2":"<逻辑路径>"}` →
///   TS `convertFileSrc("v2/"+encodeURIComponent(逻辑路径), "lfstream")`，
///   协议 handler 按 Range 按需解密覆盖块（明文永不全量落盘/进内存）
/// - v2 分块 **Android 音视频**：改回本机回环 HTTP（`http://127.0.0.1:<port>/...`，
///   见 `media_http` 模块头）——该形态下媒体元素能拿到真实 socket 的 Range 语义，
///   大媒体亦不受 Java 堆上限约束；其余路径（含桌面同资源）行为逐字不变
#[tauri::command]
pub fn decrypt_resource(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, ResourceCryptoError> {
    use std::io::Read;
    let root = resource_root(&app).map_err(ResourceCryptoError::AppData)?;
    let app_data = app_data(&app).map_err(ResourceCryptoError::AppData)?;
    let resfs = crate::resource_fs::resource_fs(&app);
    let key = resource_dek(&app_data, &root, &*resfs)?;
    let sealed_path = root.join(format!("{path}.enc"));
    if !resfs.is_file(&sealed_path) {
        return Err(ResourceCryptoError::Io(format!(
            "加密资源不存在：{path}.enc"
        )));
    }
    // 读头探测形态（v2 头 26B；v1 文件最小 34B ≥ 26）
    let mut head = [0u8; V2_HEADER_LEN];
    let n = resfs
        .open(&sealed_path)
        .map_err(io)?
        .read(&mut head)
        .map_err(io)?;
    if n == V2_HEADER_LEN && head.starts_with(MAGIC_LFEN2) && head[5] == FORMAT_VERSION_V2 {
        // 预检：试解首块（DEK 失配提前 fail-closed，而非等到媒体拉流）
        decrypt_v2_block_range(&*resfs, &sealed_path, &key, &path, 0, 0)?;
        // 大媒体（Android ∧ 加密 ∧ 音视频）改走本机回环 socket：lfstream 的响应体在 Android
        // 侧被整段拷进 JVM byte[]（堆上限放不下大媒体），且其拦截层对非零起点 Range 必失败。
        // 未命中或服务未起 = 回落下方既有 lfstream URL（行为零变化）。
        if let Some(url) = loopback_media_url(&app, &path) {
            return Ok(serde_json::json!({ "v2": path, "url": url }).to_string());
        }
        let url = format!("{}/v2/{}", protocol_base(), utf8_percent_encode(&path));
        return Ok(serde_json::json!({ "v2": path, "url": url }).to_string());
    }
    let _guard = STREAM_DECRYPT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let file = stream_decrypt_to_cache(&*resfs, &root, &app_data, &key, &path)?;
    let url = format!("{}/{}", protocol_base(), file);
    Ok(serde_json::json!({ "file": file, "url": url }).to_string())
}

/// 协议 URL 基座（平台差异归 Rust——wry 行为：Windows/Android 映射 http://*.localhost，
/// macOS/iOS/Linux 原生 scheme）。TS 零编码逻辑：URL 由本命令完整给出。
#[cfg(any(windows, target_os = "android"))]
fn protocol_base() -> &'static str {
    "http://lfstream.localhost"
}

#[cfg(not(any(windows, target_os = "android")))]
fn protocol_base() -> &'static str {
    "lfstream://localhost"
}

/// 构造 404 响应。
pub(crate) fn not_found() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("静态 404 响应构造不可失败")
}

/// lfstream 协议响应核心（纯函数，单测覆盖 200/206/416/404）：
/// Range → 206 Partial（Content-Range/Accept-Ranges——video seek 流式）；
/// 无 Range → 200 全量（webview 对 mp4 的初始请求恒带 `bytes=0-`，实际不触发大内存路径）。
pub(crate) fn stream_range_response(file: &Path, range: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    use tauri::http::{header, StatusCode};
    let mime = mime_for(&file.to_string_lossy());
    let Ok(meta) = fs::metadata(file) else {
        return not_found();
    };
    let total = meta.len();
    match parse_range(range, total) {
        RangeSpec::Unsatisfiable => tauri::http::Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .expect("静态 416 响应构造不可失败"),
        RangeSpec::Full => {
            let body = fs::read(file).unwrap_or_default();
            tauri::http::Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, total.to_string())
                .body(body)
                .expect("200 响应构造不可失败")
        }
        RangeSpec::Partial(start, end) => {
            let mut f = match fs::File::open(file) {
                Ok(f) => f,
                Err(_) => return not_found(),
            };
            if f.seek(SeekFrom::Start(start)).is_err() {
                return not_found();
            }
            let len = (end - start + 1) as usize;
            let mut body = vec![0u8; len];
            if f.read_exact(&mut body).is_err() {
                return not_found();
            }
            tauri::http::Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, len.to_string())
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total}"),
                )
                .body(body)
                .expect("206 响应构造不可失败")
        }
    }
}

/// lfstream 协议入口（LFEN2 v2 按需解密 + v1 token 缓存双路径）：
/// - `v2/{encodeURIComponent(逻辑路径)}`：Range → `decrypt_v2_block_range` 按需解密
///   （明文零落盘；内存 = Range 片段 + 有界 LRU 块缓存；密钥经 AppHandle 现取——KEK 进程内缓存，成本可忽略）
/// - `{hex64}.{ext}`：v1 临时流缓存 token（URL 由本命令返回的 file 名构造）
///
/// 统一加 CORS 头：页面源（localhost:1420）与协议源（lfstream.localhost）跨源，
/// webview fetch/媒体元素拉流需要显式放行（Tauri asset 协议同做法）。
pub(crate) fn lfstream_protocol_handler(
    request: tauri::http::Request<Vec<u8>>,
    app: &tauri::AppHandle,
) -> tauri::http::Response<Vec<u8>> {
    let mut resp = handle_stream_request(request, app);
    resp.headers_mut().insert(
        tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        tauri::http::HeaderValue::from_static("*"),
    );
    // fetch 可读 Range 相关头（浏览器默认只暴露 safelist；媒体元素内部不受此限）
    // `x-total-size` 属 URL-query 通道（绕过 Android WebView 二次偏移）的明文总量回传
    resp.headers_mut().insert(
        tauri::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        tauri::http::HeaderValue::from_static(
            "content-range,content-length,content-type,accept-ranges,x-total-size",
        ),
    );
    resp
}

fn handle_stream_request(
    request: tauri::http::Request<Vec<u8>>,
    app: &tauri::AppHandle,
) -> tauri::http::Response<Vec<u8>> {
    let raw = request.uri().path().trim_start_matches('/').to_string();
    // —— v2 按需解密路径：v2/{encodeURIComponent(逻辑路径)} ——
    if let Some(encoded) = raw.strip_prefix("v2/") {
        return handle_v2_range(request, encoded.to_string(), app);
    }
    // —— v1 token 缓存路径：{hex64}.{alnum ext} ——
    if !is_v1_token(&raw) {
        return bad_request();
    }
    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
    let cache_dir = match app_data(app).map_err(ResourceCryptoError::AppData) {
        Ok(d) => tmp_stream_dir(&d),
        Err(e) => {
            // 应用数据目录不可用 = v1 流缓存无从谈起：降级 404（进程存活），stderr 留诊断
            eprintln!("[lfen] 应用数据目录不可用，v1 流缓存供给降级 404：{e}");
            return not_found();
        }
    };
    stream_range_response(&cache_dir.join(raw), range)
}

/// v1 token 信任边界：只允许 `{hex64}.{alnum ext}` 形态（防穿越/防探测）
pub(crate) fn is_v1_token(raw: &str) -> bool {
    let mut parts = raw.split('.');
    let (token, ext) = (parts.next(), parts.next());
    parts.next().is_none()
        && raw.len() == 64 + 1 + ext.unwrap_or("").len()
        && token.is_some_and(|t| t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit()))
        && ext.is_some_and(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// 构造 400 响应。
pub(crate) fn bad_request() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::BAD_REQUEST)
        .body(Vec::new())
        .expect("静态 400 响应构造不可失败")
}
