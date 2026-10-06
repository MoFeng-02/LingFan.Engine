//! Android 大媒体回环 HTTP 供给：加密音视频不经 WebView 拦截层，直接由本机 socket 流式供给。
//!
//! 存在理由（两条硬约束，缺一则本模块无必要）：
//! 1. WebView 的 `shouldInterceptRequest` 拦截层对**任何非零起点 `Range`** 一律失败
//!    （Chromium 40739128）⇒ 非 faststart 的 MP4（`moov` 在文件尾）解复用必读尾部 ⇒ 必然打不开；
//! 2. Tauri 自定义协议的响应体在 Android 侧被**整段**拷进 JVM `byte[]`
//!    （wry `byte_array_from_slice` + `ByteArrayInputStream`），而设备 Java 堆上限
//!    （`dalvik.vm.heapgrowthlimit` 192MB 级、manifest 未开 `largeHeap`）放不下大媒体
//!    ⇒ 「回 200 全量 + `Accept-Ranges: none`」那条绕过路也走不通。
//!
//! 故：让 Chromium 走**真实 socket** 取字节——本机回环 HTTP 服务按需分块解密并流式写出，
//! 单次响应不整段驻留内存，且保留完整 `Range` 语义（seek 可用）。
//!
//! 信任边界（暴露面收敛）：仅绑 `127.0.0.1`；端口由内核分配；每次启动随机 token 入路径
//! （不符一律 404）；仅服务资源根下**音视频扩展名**的 v2 分块资源；无目录列举、无其它端点；
//! 进程退出即随监听套接字消失。
//!
//! 本模块为**平台无关**代码（桌面同样编译）：路由命中判定在 `resource_crypto`，桌面恒不命中
//! ⇒ 桌面不会起端口；而服务端逻辑因此可在桌面 `cargo test` 全量覆盖。

use crate::crypto::random_bytes;
use crate::resource_crypto::{
    app_data, decrypt_v2_block_range, decrypt_v2_total_len, is_media_ext, mime_for, parse_range,
    resource_dek, resource_root, utf8_percent_encode, validate_resource_path, RangeSpec,
};
use crate::resource_fs::{resource_fs, ResourceFs};
use percent_encoding::percent_decode_str;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

/// 单次 socket 写入窗口：一次 `decrypt_v2_block_range` 的产出即写一段。
/// 与 `V2_RANGE_MAX_LEN`（lfstream 单次协议响应字节上限）**语义不同**，故独立常量：
/// 这里只约束写入粒度，响应总长由 `Content-Length` 表达。
const STREAM_WINDOW: u64 = 256 * 1024;

/// token 字节数（hex 后 32 字符）：每次启动随机，进程内不变
const TOKEN_BYTES: usize = 16;

/// 服务地址（端口 + 路径 token）：启动一次，进程内复用
pub(crate) struct ServerInfo {
    pub port: u16,
    pub token: String,
}

static SERVER: OnceLock<Option<ServerInfo>> = OnceLock::new();

/// 懒启动回环服务（命中大媒体供给时首次调用）：bind 失败 = `None`，调用方回落 lfstream
pub(crate) fn ensure_server(app: &tauri::AppHandle) -> Option<&'static ServerInfo> {
    SERVER.get_or_init(|| start(app)).as_ref()
}

/// 回环 URL 形状（纯函数）：`v2/` 段与 lfstream 分块供给同形——前端「自供流式通道不物化」
/// 的判定因此无需为回环新增分支（见 `packages/adapters/src/media/blobSource.ts`）。
pub(crate) fn loopback_url(port: u16, token: &str, logical: &str) -> String {
    format!(
        "http://127.0.0.1:{port}/t/{token}/v2/{}",
        utf8_percent_encode(logical)
    )
}

fn start(app: &tauri::AppHandle) -> Option<ServerInfo> {
    let token = hex_of(&random_bytes(TOKEN_BYTES).ok()?);
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let app = app.clone();
    let serve_token = token.clone();
    std::thread::Builder::new()
        .name("lfen-media-http".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else {
                    continue;
                };
                let app = app.clone();
                let token = serve_token.clone();
                std::thread::spawn(move || {
                    // 上下文按连接解析（资源根/DEK 与协议 handler 同源，无第二份真源）
                    let Some(ctx) = MediaCtx::resolve(&app) else {
                        return;
                    };
                    let _ = serve_conn(stream, &token, &ctx);
                });
            }
        })
        .ok()?;
    eprintln!("[lfen] 大媒体回环供给已启动：127.0.0.1:{port}");
    Some(ServerInfo { port, token })
}

/// 单次请求的资源面（root/DEK/resfs）：请求内复用，避免逐块重复解封密钥
struct MediaCtx {
    root: PathBuf,
    resfs: Arc<dyn ResourceFs>,
    key: Vec<u8>,
}

impl MediaCtx {
    fn resolve(app: &tauri::AppHandle) -> Option<Self> {
        let root = resource_root(app).ok()?;
        let data_dir = app_data(app).ok()?;
        let resfs = resource_fs(app);
        let key = resource_dek(&data_dir, &root, &*resfs).ok()?;
        Some(Self { root, resfs, key })
    }
}

enum Route {
    Serve(String),
    BadRequest,
    NotFound,
}

/// 请求路由与信任边界：`GET /t/<token>/v2/<逻辑路径编码>`；token 不符/非 v2/非音视频一律 404
/// （不向外区分「存在但无权」与「不存在」），路径穿越/绝对路径 400。
fn route(method: &str, target: &str, token: &str) -> Route {
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

fn serve_conn(stream: TcpStream, token: &str, ctx: &MediaCtx) -> std::io::Result<()> {
    stream.set_nodelay(true).ok();
    let mut writer = stream.try_clone()?;
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    let mut it = request_line.split_whitespace();
    let method = it.next().unwrap_or_default();
    let target = it.next().unwrap_or_default();
    let mut range: Option<String> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }

    let logical = match route(method, target, token) {
        Route::Serve(logical) => logical,
        Route::BadRequest => return empty(&mut writer, 400),
        Route::NotFound => return empty(&mut writer, 404),
    };
    let enc = ctx.root.join(format!("{logical}.enc"));
    let Some(total) = decrypt_v2_total_len(&*ctx.resfs, &enc) else {
        return empty(&mut writer, 404);
    };
    let content_type = mime_for(&logical).to_string();
    if total == 0 {
        write_head(
            &mut writer,
            200,
            0,
            &[
                ("Content-Type", content_type),
                ("Accept-Ranges", "bytes".into()),
            ],
        )?;
        return writer.flush();
    }
    let (start, end, partial) = match parse_range(range.as_deref(), total) {
        RangeSpec::Unsatisfiable => {
            write_head(
                &mut writer,
                416,
                0,
                &[("Content-Range", format!("bytes */{total}"))],
            )?;
            return writer.flush();
        }
        RangeSpec::Partial(start, end) => (start, end, true),
        RangeSpec::Full => (0, total - 1, false),
    };
    // 首窗先解：DEK 失配/块损坏在**写响应头之前**暴露，仍能回 404 而非半截 200
    let first_end = (start + STREAM_WINDOW - 1).min(end);
    let head_window =
        match decrypt_v2_block_range(&*ctx.resfs, &enc, &ctx.key, &logical, start, first_end) {
            Ok(window) => window,
            Err(_) => return empty(&mut writer, 404),
        };
    let mut extra = vec![
        ("Content-Type", content_type),
        ("Accept-Ranges", "bytes".into()),
    ];
    if partial {
        extra.push(("Content-Range", format!("bytes {start}-{end}/{total}")));
    }
    write_head(
        &mut writer,
        if partial { 206 } else { 200 },
        end - start + 1,
        &extra,
    )?;
    writer.write_all(&head_window)?;
    let mut pos = first_end + 1;
    while pos <= end {
        let window_end = (pos + STREAM_WINDOW - 1).min(end);
        let window = decrypt_v2_block_range(&*ctx.resfs, &enc, &ctx.key, &logical, pos, window_end)
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        writer.write_all(&window)?;
        pos = window_end + 1;
    }
    writer.flush()
}

fn empty<W: Write>(writer: &mut W, status: u16) -> std::io::Result<()> {
    write_head(writer, status, 0, &[])?;
    writer.flush()
}

/// 手写响应头（最小 HTTP/1.1）：统一 `Connection: close`（本服务无长连接语义）；
/// CORS 头必需——媒体元素带 `crossOrigin="anonymous"`，跨源（页面源自 tauri.localhost）。
fn write_head<W: Write>(
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

fn hex_of(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource_crypto::encrypt_lfen2_v2_file;
    use crate::resource_fs::StdFs;
    use std::io::Read;

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

    /// 锚点 android-media-loopback：显式区间 → 206 + Content-Range + 字节与明文逐字节一致
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
}
