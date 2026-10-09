//! 回环 HTTP 服务：懒启动监听、按连接解析上下文、按窗口解密并流式写出响应。

use crate::crypto::random_bytes;
use crate::http::RangeSpec;
use crate::http::mime_for;
use crate::http::parse_range;
use crate::http::utf8_percent_encode;
use crate::media_http::response::{empty, write_head};
use crate::media_http::route::{Route, hex_of, route};
use crate::paths::app_data;
use crate::paths::resource_root;
use crate::resource_crypto::decrypt_v2_block_range;
use crate::resource_crypto::decrypt_v2_total_len;
use crate::resource_crypto::resource_dek;
use crate::resource_fs::resource_fs;
use crate::resource_fs::ResourceFs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

/// 单次 socket 写入窗口：一次 `decrypt_v2_block_range` 的产出即写一段。
/// 与 `V2_RANGE_MAX_LEN`（lfstream 单次协议响应字节上限）**语义不同**，故独立常量：
/// 这里只约束写入粒度，响应总长由 `Content-Length` 表达。
pub(crate) const STREAM_WINDOW: u64 = 256 * 1024;

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
pub(crate) struct MediaCtx {
    pub(crate) root: PathBuf,
    pub(crate) resfs: Arc<dyn ResourceFs>,
    pub(crate) key: Vec<u8>,
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

/// 处理单条连接：读请求行与 `Range` 头，路由命中后按窗口解密并流式写出响应。
pub(crate) fn serve_conn(stream: TcpStream, token: &str, ctx: &MediaCtx) -> std::io::Result<()> {
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
