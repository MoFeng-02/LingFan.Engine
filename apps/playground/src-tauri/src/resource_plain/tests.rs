//! 明文资源段的行为测试：路由信任边界与协议响应（全量 / Range / 不存在）。

use crate::resource_fs::StdFs;
use crate::resource_plain::route::{handles, is_plain_ext, route, Route};
use crate::resource_plain::serve::serve_with;
use crate::resource_plain::url::url_for;
use std::path::PathBuf;

/// 临时资源根：每次取唯一目录，避免并发测试互相覆盖。
fn temp_root(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "lf-plain-{tag}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

/// 构造协议请求（uri 用 http 形态，与 Windows/Android 的 `*.localhost` 映射一致）。
fn request(uri: &str, range: Option<&str>) -> tauri::http::Request<Vec<u8>> {
    let mut builder = tauri::http::Request::builder().uri(uri);
    if let Some(value) = range {
        builder = builder.header("range", value);
    }
    builder.body(Vec::new()).unwrap()
}

#[test]
fn route_accepts_encoded_media_path() {
    // 整段编码把 `/` 变 %2F：解码一次即得资源根相对路径
    assert_eq!(
        route("GET", "/raw/Audio%2Fcrickets_night01.mp3"),
        Route::Serve("Audio/crickets_night01.mp3".to_string())
    );
}

#[test]
fn route_accepts_plain_ext_beyond_media() {
    // 图 / 字体 / 文本同属明文供给面
    for logical in ["Image/bg.png", "Fonts/ui.woff2", "Stories/index.json"] {
        let encoded = crate::http::utf8_percent_encode(logical);
        assert_eq!(
            route("GET", &format!("/raw/{encoded}")),
            Route::Serve(logical.to_string()),
            "应放行 {logical}"
        );
    }
}

#[test]
fn route_rejects_traversal_as_bad_request() {
    // 解码后越出资源根 = 明确越权请求，不按「不存在」含糊处理
    assert_eq!(route("GET", "/raw/..%2F..%2Fsecret.mp3"), Route::BadRequest);
    assert_eq!(
        route("GET", "/raw/Audio%2F..%2F..%2Fx.mp3"),
        Route::BadRequest
    );
}

#[test]
fn route_rejects_absolute_path_as_bad_request() {
    assert_eq!(route("GET", "/raw/%2Fetc%2Fpasswd"), Route::BadRequest);
    assert_eq!(
        route("GET", "/raw/C%3A%5CWindows%5Cx.mp3"),
        Route::BadRequest
    );
}

#[test]
fn route_rejects_non_whitelisted_ext_as_not_found() {
    // 资源根里另有清单/存档等结构化文件，不经协议面暴露
    assert_eq!(route("GET", "/raw/Stories%2Fstate.lfen2"), Route::NotFound);
    assert_eq!(route("GET", "/raw/Secrets%2Fkey.bin"), Route::NotFound);
    assert_eq!(route("GET", "/raw/noext"), Route::NotFound);
}

#[test]
fn route_rejects_non_get_and_foreign_prefix() {
    assert_eq!(route("HEAD", "/raw/Audio%2Fa.mp3"), Route::NotFound);
    assert_eq!(route("POST", "/raw/Audio%2Fa.mp3"), Route::NotFound);
    // 非本段前缀：路由不认领，交由加密段
    assert_eq!(route("GET", "/v2/Video%2Fm.mp4"), Route::NotFound);
    assert_eq!(route("GET", "/0123abcd.mp3"), Route::NotFound);
}

#[test]
fn handles_claims_only_raw_prefix() {
    assert!(handles("/raw/Audio%2Fa.mp3"));
    assert!(handles("/raw/Audio%2Fa.mp3?t=1"));
    assert!(!handles("/v2/Video%2Fm.mp4"));
    assert!(!handles("/raw"));
}

#[test]
fn plain_ext_covers_media_and_assets() {
    for name in ["a.mp3", "a.mp4", "a.png", "a.woff2", "a.json", "a.txt"] {
        assert!(is_plain_ext(name), "{name} 应在白名单内");
    }
    for name in ["a.lfen2", "a.bin", "a", "a.mp3.enc"] {
        assert!(!is_plain_ext(name), "{name} 不应在白名单内");
    }
}

#[test]
fn url_for_encodes_logical_path_as_single_segment() {
    let url = url_for("Audio/crickets_night01.mp3");
    assert!(url.ends_with("/raw/Audio%2Fcrickets_night01.mp3"), "{url}");
    assert!(
        url.starts_with("http") || url.starts_with("lfstream"),
        "{url}"
    );
}

#[test]
fn serve_returns_full_body_without_range() {
    let root = temp_root("full");
    std::fs::create_dir_all(root.join("Audio")).unwrap();
    std::fs::write(root.join("Audio/a.mp3"), b"0123456789").unwrap();

    let response = serve_with(
        &StdFs,
        &root,
        request("http://lfstream.localhost/raw/Audio%2Fa.mp3", None),
    );
    assert_eq!(response.status(), tauri::http::StatusCode::OK);
    assert_eq!(response.body().as_slice(), b"0123456789");
    assert_eq!(response.headers()["content-type"], "audio/mpeg");
    assert_eq!(response.headers()["accept-ranges"], "bytes");
    // 页面源与协议源不同源，媒体元素与 fetch 都要能读
    assert_eq!(response.headers()["access-control-allow-origin"], "*");

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn serve_returns_partial_content_for_range() {
    let root = temp_root("range");
    std::fs::create_dir_all(root.join("Video")).unwrap();
    std::fs::write(root.join("Video/b.mp4"), b"0123456789").unwrap();

    let response = serve_with(
        &StdFs,
        &root,
        request(
            "http://lfstream.localhost/raw/Video%2Fb.mp4",
            Some("bytes=2-5"),
        ),
    );
    assert_eq!(response.status(), tauri::http::StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.body().as_slice(), b"2345");
    assert_eq!(
        response.headers()["content-range"],
        "bytes 2-5/10".as_bytes() as &[u8]
    );

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn serve_reports_missing_file_as_not_found() {
    let root = temp_root("missing");
    std::fs::create_dir_all(&root).unwrap();

    let response = serve_with(
        &StdFs,
        &root,
        request("http://lfstream.localhost/raw/Audio%2Fabsent.mp3", None),
    );
    assert_eq!(response.status(), tauri::http::StatusCode::NOT_FOUND);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn serve_reports_traversal_as_bad_request() {
    let root = temp_root("traversal");
    std::fs::create_dir_all(&root).unwrap();

    let response = serve_with(
        &StdFs,
        &root,
        request("http://lfstream.localhost/raw/..%2F..%2Fsecret.mp3", None),
    );
    assert_eq!(response.status(), tauri::http::StatusCode::BAD_REQUEST);

    std::fs::remove_dir_all(&root).ok();
}
