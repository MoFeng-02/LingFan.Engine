//! 请求路由与信任边界判定：token 与路径校验的纯函数部分。

use crate::paths::validate_resource_path;
use crate::resource_crypto::is_media_ext;
use percent_encoding::percent_decode_str;

/// 路由判定结果：可服务（含解码后的逻辑路径）、请求非法、或一律按不存在处理。
pub(crate) enum Route {
    Serve(String),
    BadRequest,
    NotFound,
}

/// 请求路由与信任边界：`GET /t/<token>/v2/<逻辑路径编码>`；token 不符/非 v2/非音视频一律 404
/// （不向外区分「存在但无权」与「不存在」），路径穿越/绝对路径 400。
pub(crate) fn route(method: &str, target: &str, token: &str) -> Route {
    if !method.eq_ignore_ascii_case("GET") {
        return Route::NotFound;
    }
    let path = target.split('?').next().unwrap_or("");
    let segs: Vec<&str> = path.trim_start_matches('/').splitn(3, '/').collect();
    if segs.len() != 3 || segs[0] != "t" || !ct_eq(segs[1], token) {
        return Route::NotFound;
    }
    let Some(encoded) = segs[2].strip_prefix("v2/") else {
        return Route::NotFound;
    };
    let logical = percent_decode_str(encoded).decode_utf8_lossy().to_string();
    if validate_resource_path(&logical).is_err() {
        return Route::BadRequest;
    }
    if !is_media_ext(&logical) {
        return Route::NotFound;
    }
    Route::Serve(logical)
}

/// 定长比较（token 校验）：长度不同即否；逐字节累积差异，不提前返回
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// 字节序列转小写十六进制串（token 生成用）。
pub(crate) fn hex_of(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
