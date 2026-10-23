//! 明文资源段的请求路由与扩展名白名单：信任边界与「可明文供给」判定。

use crate::paths::validate_resource_path;
use crate::resource_crypto::is_media_ext;
use percent_encoding::percent_decode_str;

/// 明文资源段的 URL 前缀：`raw/{encodeURIComponent(逻辑路径)}`。
pub(crate) const RAW_PREFIX: &str = "raw/";

/// 路由判定结果：可服务（含解码后的逻辑路径）、请求非法、或一律按不存在处理。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Route {
    /// 可服务：解码并校验通过的逻辑路径（相对资源根）
    Serve(String),
    /// 请求非法：路径越出资源根（绝对路径、`..` 段、空段）
    BadRequest,
    /// 一律按不存在处理：非 GET、非本段、扩展名不在白名单
    NotFound,
}

/// 本段是否认领该请求路径：只有 `raw/` 前缀归明文供给，其余交给加密段。
///
/// 协议处理器据此单点分流——两段各自的前缀判定只写在各自模块里，不出现第二处。
pub(crate) fn handles(target: &str) -> bool {
    target
        .split('?')
        .next()
        .unwrap_or("")
        .trim_start_matches('/')
        .starts_with(RAW_PREFIX)
}

/// 请求路由与信任边界：只认 `GET raw/{encodeURIComponent(逻辑路径)}`。
///
/// 非 GET、前缀不是 `raw/`、扩展名不在白名单都回 404——不向外区分「存在但无权」与
/// 「不存在」，避免把资源根的文件名变成可探测面；解码后越出资源根的路径回 400，
/// 因为那是明确的越权请求而非寻址失误。
pub(crate) fn route(method: &str, target: &str) -> Route {
    if !method.eq_ignore_ascii_case("GET") {
        return Route::NotFound;
    }
    let path = target.split('?').next().unwrap_or("");
    let Some(encoded) = path.trim_start_matches('/').strip_prefix(RAW_PREFIX) else {
        return Route::NotFound;
    };
    let logical = percent_decode_str(encoded).decode_utf8_lossy().to_string();
    if validate_resource_path(&logical).is_err() {
        return Route::BadRequest;
    }
    if !is_plain_ext(&logical) {
        return Route::NotFound;
    }
    Route::Serve(logical)
}

/// 明文供给白名单：音视频全集（与回环/加密供给同一判定）+ 图 / 字体 / 文本。
///
/// 只放行前端渲染会直接消费的类型：资源根里另有清单、存档等结构化文件，
/// 它们各有加密读取通道，不经协议面暴露。
pub(crate) fn is_plain_ext(logical: &str) -> bool {
    if is_media_ext(logical) {
        return true;
    }
    let ext = std::path::Path::new(logical)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "bmp"
            | "svg"
            | "ttf"
            | "otf"
            | "woff"
            | "woff2"
            | "json"
            | "txt"
    )
}
