//! 回环 HTTP 服务的行为测试。

use crate::media_http::server::{MediaCtx, STREAM_WINDOW, serve_conn};
use std::net::TcpListener;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Arc;

use super::*;
use crate::resource_crypto::encrypt_lfen2_v2_file;
use crate::resource_fs::StdFs;
use std::io::{Read, Write};

const KEY: &[u8; 32] = b"fedcba9876543210fedcba9876543210";
const TOKEN: &str = "0123456789abcdef0123456789abcdef";

fn temp_base(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "{tag}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

/// 夹具：资源根下 V2 分块密文（`chunk_log2 = 10` → 1KiB 块，尾块短）+ 非媒体资源
fn fixture(tag: &str) -> (MediaCtx, Vec<u8>) {
    let base = temp_base(tag);
    let root = base.join("res");
    std::fs::create_dir_all(&root).unwrap();
    let mut plain = (0u32..1024)
        .flat_map(|i| i.to_le_bytes())
        .collect::<Vec<u8>>();
    plain.extend_from_slice(b"4K-TAIL"); // total = 4103，跨 5 块
    let src = base.join("src.bin");
    std::fs::write(&src, &plain).unwrap();
    encrypt_lfen2_v2_file(
        &src,
        &root.join("Video/m2.mp4.enc"),
        KEY,
        "Video/m2.mp4",
        10,
    )
    .unwrap();
    encrypt_lfen2_v2_file(
        &src,
        &root.join("Stories/notes.json.enc"),
        KEY,
        "Stories/notes.json",
        10,
    )
    .unwrap();
    let ctx = MediaCtx {
        root,
        resfs: Arc::new(StdFs),
        key: KEY.to_vec(),
    };
    (ctx, plain)
}

fn spawn_server(ctx: MediaCtx) -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                break;
            };
            let _ = serve_conn(stream, TOKEN, &ctx);
        }
    });
    port
}

fn request(
    port: u16,
    target: &str,
    range: Option<&str>,
) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let mut sock = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let mut req = format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n");
    if let Some(r) = range {
        req.push_str(&format!("Range: {r}\r\n"));
    }
    req.push_str("\r\n");
    sock.write_all(req.as_bytes()).unwrap();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        let n = sock.read(&mut chunk).unwrap();
        assert!(n > 0, "连接在响应头完成前关闭");
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
    };
    let head = String::from_utf8(buf[..head_end].to_vec()).unwrap();
    let mut lines = head.split("\r\n");
    let status: u16 = lines
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let mut headers = Vec::new();
    let mut content_length = 0usize;
    for line in lines {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let (k, v) = (k.trim().to_ascii_lowercase(), v.trim().to_string());
        if k == "content-length" {
            content_length = v.parse().unwrap();
        }
        headers.push((k, v));
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < content_length {
        let n = sock.read(&mut chunk).unwrap();
        assert!(n > 0, "响应体不足 Content-Length");
        body.extend_from_slice(&chunk[..n]);
    }
    (status, headers, body)
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

/// 显式区间 → 206 + Content-Range + 字节与明文逐字节一致
#[test]
fn loopback_serves_exact_range_bytes() {
    let (ctx, plain) = fixture("lf3-loop-range");
    let port = spawn_server(ctx);
    let (status, headers, body) = request(
        port,
        &format!("/t/{TOKEN}/v2/Video%2Fm2.mp4"),
        Some("bytes=100-2059"),
    );
    assert_eq!(status, 206);
    assert_eq!(body, plain[100..=2059]);
    assert_eq!(
        header(&headers, "content-range"),
        Some("bytes 100-2059/4103")
    );
    assert_eq!(header(&headers, "content-type"), Some("video/mp4"));
    assert_eq!(header(&headers, "accept-ranges"), Some("bytes"));
    assert_eq!(header(&headers, "content-length"), Some("1960"));
    // CORS 头齐备（媒体元素 crossOrigin=anonymous）
    assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
    assert!(header(&headers, "access-control-expose-headers")
        .unwrap()
        .contains("content-range"));
}

/// 开放尾区间（Chromium 首请求形态）→ 顺序流式交付全量；跨窗（> STREAM_WINDOW 需多轮）
#[test]
fn loopback_streams_open_ended_range() {
    let (ctx, plain) = fixture("lf3-loop-stream");
    let port = spawn_server(ctx);
    let (status, headers, body) = request(
        port,
        &format!("/t/{TOKEN}/v2/Video%2Fm2.mp4"),
        Some("bytes=0-"),
    );
    assert_eq!(status, 206);
    assert_eq!(header(&headers, "content-range"), Some("bytes 0-4102/4103"));
    assert_eq!(body, plain);
}

/// 无 Range → 200 全量；后缀形态（`bytes=-n`）同源复用
#[test]
fn loopback_serves_full_and_suffix() {
    let (ctx, plain) = fixture("lf3-loop-full");
    let port = spawn_server(ctx);
    let target = format!("/t/{TOKEN}/v2/Video%2Fm2.mp4");
    let (status, headers, body) = request(port, &target, None);
    assert_eq!(status, 200);
    assert!(header(&headers, "content-range").is_none());
    assert_eq!(body, plain);
    let (status, _, body) = request(port, &target, Some("bytes=-8"));
    assert_eq!(status, 206);
    assert_eq!(body, &plain[4095..]);
}

/// 信任边界：token 不符 / 非 v2 段 / 非音视频扩展名 / 非 GET 一律 404；路径穿越 400；
/// 越界区间 416（fail-closed，不回落全量）
#[test]
fn loopback_trust_boundary_and_416() {
    let (ctx, _) = fixture("lf3-loop-boundary");
    let port = spawn_server(ctx);
    for target in [
        format!("/t/{}/v2/Video%2Fm2.mp4", "f".repeat(32)),
        format!("/t/{}/Video%2Fm2.mp4", TOKEN),
        format!("/t/{TOKEN}/v2/Stories%2Fnotes.json"),
        format!("/t/{TOKEN}/v2/Video%2Fm2.mp4.exe"),
        format!("/t/{TOKEN}"),
        "/".to_string(),
    ] {
        let (status, _, body) = request(port, &target, None);
        assert_eq!(status, 404, "target {target} 应 404");
        assert!(body.is_empty());
    }
    // 路径穿越（合法 token 也无法越出资源根）
    let (status, _, _) = request(port, &format!("/t/{TOKEN}/v2/..%2F..%2Fproject.json"), None);
    assert_eq!(status, 400);
    // 越界 / 畸形区间
    for bad in ["bytes=999999-", "bytes=50-10"] {
        let (status, _, body) =
            request(port, &format!("/t/{TOKEN}/v2/Video%2Fm2.mp4"), Some(bad));
        assert_eq!(status, 416, "区间 {bad} 应 416");
        assert!(body.is_empty());
    }
}

/// URL 形状：端口/token/编码（`/` → %2F）——与前端「含 `v2/` 即不物化」的判定对齐
#[test]
fn loopback_url_shape() {
    assert_eq!(
        loopback_url(4711, TOKEN, "Video/m2.mp4"),
        format!("http://127.0.0.1:4711/t/{TOKEN}/v2/Video%2Fm2.mp4")
    );
    // 尾块资源与非媒体资源同形（判定不在此处，由 route 收敛）
    assert!(loopback_url(1, "ab", "Audio/x.mp3").contains("/v2/Audio%2Fx.mp3"));
}

/// 资源缺失 / 非 v2 形态（v1 密文）→ 404（本通道只服务 v2 分块资源）
#[test]
fn loopback_missing_and_v1_are_404() {
    let (ctx, _) = fixture("lf3-loop-v1");
    let base = ctx.root.parent().unwrap().to_path_buf();
    let v1 = crate::resource_crypto::encrypt_lfen2(b"plain", KEY, "Video/old.mp4").unwrap();
    std::fs::write(ctx.root.join("Video/old.mp4.enc"), v1).unwrap();
    let port = spawn_server(ctx);
    let (status, _, _) = request(port, &format!("/t/{TOKEN}/v2/Video%2Fghost.mp4"), None);
    assert_eq!(status, 404);
    let (status, _, _) = request(port, &format!("/t/{TOKEN}/v2/Video%2Fold.mp4"), None);
    assert_eq!(status, 404, "v1 密文无 v2 头，必须 404 而非误判");
    std::fs::remove_dir_all(&base).ok();
}

/// 明文资源根（非加密形态）经本通道不可读：无 `.enc` 即 404
#[test]
fn loopback_plaintext_root_not_served() {
    let base = temp_base("lf3-loop-plain");
    let root = base.join("res");
    std::fs::create_dir_all(root.join("Video")).unwrap();
    std::fs::write(root.join("Video/m2.mp4"), b"plain-video").unwrap();
    let ctx = MediaCtx {
        root,
        resfs: Arc::new(StdFs),
        key: KEY.to_vec(),
    };
    let port = spawn_server(ctx);
    let (status, _, _) = request(port, &format!("/t/{TOKEN}/v2/Video%2Fm2.mp4"), None);
    assert_eq!(status, 404);
    std::fs::remove_dir_all(&base).ok();
}

/// 跨窗流式：区间长度 > 单窗（`STREAM_WINDOW`）时必须逐窗交付——不得整段驻留，且字节完整
#[test]
fn loopback_streams_across_windows() {
    let base = temp_base("lf3-loop-window");
    let root = base.join("res");
    std::fs::create_dir_all(&root).unwrap();
    let total = (STREAM_WINDOW * 2 + 777) as usize;
    let plain: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
    let src = base.join("src.bin");
    std::fs::write(&src, &plain).unwrap();
    encrypt_lfen2_v2_file(
        &src,
        &root.join("Video/big.mp4.enc"),
        KEY,
        "Video/big.mp4",
        10,
    )
    .unwrap();
    let ctx = MediaCtx {
        root,
        resfs: Arc::new(StdFs),
        key: KEY.to_vec(),
    };
    let port = spawn_server(ctx);
    let (status, headers, body) = request(
        port,
        &format!("/t/{TOKEN}/v2/Video%2Fbig.mp4"),
        Some("bytes=0-"),
    );
    assert_eq!(status, 206);
    let expected_len = total.to_string();
    assert_eq!(
        header(&headers, "content-length"),
        Some(expected_len.as_str())
    );
    assert_eq!(body, plain);
    std::fs::remove_dir_all(&base).ok();
}
