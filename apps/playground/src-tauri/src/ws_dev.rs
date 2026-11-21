//! 开发期 WS 通道（**仅 debug 构建**——本模块整体 `#[cfg(debug_assertions)]`
//! 编译期排除，release 无监听代码；自动化断言见本模块 tests）。
//!
//! 目标：外部浏览器（Vite 页面）复用宿主能力——**读工程 / 存档 / 平台信息**
//! 三类最小暴露面（白名单 = Tauri 命令面的子集，同一命令函数、同一负载形状；
//! 白名单属于 `generate_handler!` 注册面的子集，这一结构关系由本模块测试断言）。
//!
//! 协议（JSON 文本帧）：请求 `{"id":1,"cmd":"project_files","args":{}}` →
//! 响应 `{"id":1,"ok":true,"data":...}` / `{"id":1,"ok":false,"error":"..."}`。
//!
//! 安全边界：仅绑定 `127.0.0.1`
//! （不对局域网开放）；端口 = `LFEN_WS_PORT`（缺省 1421，紧邻 Vite 1420）；
//! 白名单外命令一律拒绝（未入白名单的 Tauri 命令同样拒绝——最小暴露面）。

use serde_json::Value;

/// WS 白名单（最小暴露面：读工程 / 存档 / 平台三类）
pub const WS_WHITELIST: &[&str] = &[
    "project_files",
    "save_list",
    "save_read",
    "save_write",
    "save_delete",
    "host_platform",
];

/// WS 监听端口缺省值（紧邻 Vite 1420）
pub const WS_DEFAULT_PORT: u16 = 1421;

/// 开发期 WS 通道的允许来源：本机 Vite dev server 的两种写法。
/// 浏览器发起的 WebSocket 握手必带 `Origin`，drive-by 网页的来源不在其中即被拒。
pub const WS_ALLOWED_ORIGINS: &[&str] = &["http://localhost:1420", "http://127.0.0.1:1420"];

/// 握手准入判定（信任边界，纯函数可测）：
/// - `Origin` 命中本机 dev server 白名单 → 放行（正常 Vite 页面）；
/// - 配置了 `LFEN_WS_TOKEN` 且请求 query 的 token 与之相等 → 放行（无 Origin 的脚本/工具）；
/// - 其余一律拒绝（drive-by 网页既无合法 Origin 也无从得知 token）。
fn check_ws_access(
    origin: Option<&str>,
    token: Option<&str>,
    expected_token: Option<&str>,
) -> Result<(), String> {
    if let Some(o) = origin {
        if WS_ALLOWED_ORIGINS.contains(&o) {
            return Ok(());
        }
    }
    if let (Some(t), Some(expected)) = (token, expected_token) {
        if !expected.is_empty() && t == expected {
            return Ok(());
        }
    }
    Err("来源未授权：需要本机 dev server 的 Origin 或有效 token".to_string())
}

/// 从握手请求的 query 串提取 `token` 参数（`?token=...`，容忍多参数与顺序）。
fn query_token(query: Option<&str>) -> Option<&str> {
    query?.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        if key == "token" {
            Some(value)
        } else {
            None
        }
    })
}

/// 组合根（lib.rs setup）调用：debug 构建启动服务器；失败仅打诊断（浏览器回退 web 端口）
pub fn setup(app: tauri::AppHandle) {
    let port: u16 = std::env::var("LFEN_WS_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(WS_DEFAULT_PORT);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_server(app, port).await {
            eprintln!("[lfen-ws] dev 通道启动失败（浏览器维持 web 端口）：{e}");
        }
    });
}

async fn run_server(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("绑定 {addr} 失败：{e}"))?;
    // 可选 token：供无 Origin 的脚本/工具准入（未配置时仅本机 dev server Origin 可连）。
    let expected_token = std::env::var("LFEN_WS_TOKEN").ok();
    eprintln!("[lfen-ws] dev 通道就绪：ws://{addr}（仅 127.0.0.1，debug 构建，Origin/token 准入）");
    loop {
        let (stream, _peer) = listener
            .accept()
            .await
            .map_err(|e| format!("accept 失败：{e}"))?;
        let app = app.clone();
        let expected_token = expected_token.clone();
        tauri::async_runtime::spawn(async move {
            let ws = match accept_checked(stream, expected_token).await {
                Ok(ws) => ws,
                Err(e) => {
                    eprintln!("[lfen-ws] 握手失败：{e}");
                    return;
                }
            };
            serve_with(app, ws).await;
        });
    }
}

/// 带准入校验的握手：Origin 白名单或 token 通过才升级为 WS，否则回 403 拒绝。
/// 校验在握手期完成——未授权的连接拿不到 WS 通道，自然读不到存档/工程。
async fn accept_checked(
    stream: tokio::net::TcpStream,
    expected_token: Option<String>,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    tokio_tungstenite::tungstenite::Error,
> {
    tokio_tungstenite::accept_hdr_async(
        stream,
        move |req: &tungstenite::handshake::server::Request,
              resp: tungstenite::handshake::server::Response| {
            let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
            let token = query_token(req.uri().query());
            match check_ws_access(origin, token, expected_token.as_deref()) {
                Ok(()) => Ok(resp),
                Err(reason) => {
                    let mut rejection =
                        tungstenite::handshake::server::ErrorResponse::new(Some(reason));
                    *rejection.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
                    Err(rejection)
                }
            }
        },
    )
    .await
}

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite;

/// 单连接服务循环：文本帧 → 分发 → 回帧；Close/断开退出
async fn serve_with(
    app: tauri::AppHandle,
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
) {
    serve_handler(ws, |text| handle_text(&app, text)).await;
}

/// 连接循环（handler 注入版——集成测试以合成 handler 驱动，无需 AppHandle）
async fn serve_handler<F>(ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>, handler: F)
where
    F: Fn(&str) -> String,
{
    let (mut sink, mut source) = ws.split();
    while let Some(msg) = source.next().await {
        match msg {
            Ok(tungstenite::Message::Text(txt)) => {
                let reply = handler(txt.as_str());
                if sink.send(tungstenite::Message::text(reply)).await.is_err() {
                    break;
                }
            }
            Ok(tungstenite::Message::Close(_)) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
}

/// 帧处理：解析 → 分发 → 响应帧（解析失败 id 以 null 回执）
fn handle_text(app: &tauri::AppHandle, text: &str) -> String {
    let reply = match parse_request(text) {
        Ok((id, cmd, args)) => match dispatch(app, &cmd, &args) {
            Ok(data) => serde_json::json!({ "id": id, "ok": true, "data": data }),
            Err(e) => serde_json::json!({ "id": id, "ok": false, "error": e }),
        },
        Err(e) => serde_json::json!({ "id": Value::Null, "ok": false, "error": e }),
    };
    reply.to_string()
}

/// 请求解析（信任边界）：id 任意 JSON 值透传；cmd 必须字符串；args 缺省空对象
fn parse_request(text: &str) -> Result<(Value, String, Value), String> {
    let raw: Value = serde_json::from_str(text).map_err(|e| format!("请求不是合法 JSON：{e}"))?;
    let obj = raw.as_object().ok_or("请求必须是 JSON 对象")?;
    let id = obj.get("id").cloned().ok_or("请求缺 id")?;
    let cmd = obj
        .get("cmd")
        .and_then(|v| v.as_str())
        .ok_or("请求缺 cmd 或非字符串")?
        .to_string();
    let args = obj
        .get("args")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    Ok((id, cmd, args))
}

/// 白名单校验（最小暴露面）：未入白名单的命令一律拒绝——
/// 即使它已在 Tauri 注册面（如 decrypt_resource/preferences_read 也不暴露）。
fn check_whitelist(cmd: &str) -> Result<(), String> {
    if WS_WHITELIST.contains(&cmd) {
        Ok(())
    } else {
        Err(format!("命令不在 WS 白名单：{cmd}"))
    }
}

/// 参数提取：字符串（缺/非字符串报错）
fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("参数 {key} 缺失或非字符串"))
}

/// 参数提取：可选字符串
fn arg_opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

/// 结果统一封帧：Serialize 载荷 → Value；错误 → 可读字符串
fn seal<T: serde::Serialize, E: std::fmt::Display>(result: Result<T, E>) -> Result<Value, String> {
    result
        .map_err(|e| e.to_string())
        .and_then(|v| serde_json::to_value(v).map_err(|e| format!("序列化失败：{e}")))
}

/// 白名单分发（与 Tauri 命令**同一函数、同一负载形状**——契约一致的根保障）
fn dispatch(app: &tauri::AppHandle, cmd: &str, args: &Value) -> Result<Value, String> {
    check_whitelist(cmd)?;
    match cmd {
        "project_files" => seal(crate::project_files::project_files(app.clone())),
        "save_list" => seal(crate::save::save_list(app.clone())),
        "save_read" => seal(crate::save::save_read(
            app.clone(),
            arg_str(args, "slot")?.to_string(),
        )),
        "save_write" => seal(crate::save::save_write(
            app.clone(),
            arg_str(args, "slot")?.to_string(),
            arg_str(args, "payload")?.to_string(),
            arg_opt_str(args, "mode"),
        )),
        "save_delete" => seal(crate::save::save_delete(
            app.clone(),
            arg_str(args, "slot")?.to_string(),
        )),
        "host_platform" => seal(Ok::<&'static str, String>(crate::host::host_platform())),
        _ => Err(format!("命令不在 WS 白名单：{cmd}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // —— 请求解析（信任边界）——

    #[test]
    fn parse_request_round_trip_and_defaults() {
        let (id, cmd, args) = parse_request(r#"{"id":7,"cmd":"project_files"}"#).unwrap();
        assert_eq!(id, serde_json::json!(7));
        assert_eq!(cmd, "project_files");
        assert_eq!(args, serde_json::json!({})); // args 缺省空对象

        let (id, cmd, args) =
            parse_request(r#"{"id":"abc","cmd":"save_read","args":{"slot":"slot_1"}}"#).unwrap();
        assert_eq!(id, serde_json::json!("abc")); // id 任意 JSON 值透传
        assert_eq!(cmd, "save_read");
        assert_eq!(args, serde_json::json!({ "slot": "slot_1" }));
    }

    #[test]
    fn parse_request_rejects_malformed() {
        assert!(parse_request("not-json").is_err());
        assert!(parse_request("[]").is_err()); // 非对象
        assert!(parse_request(r#"{"cmd":"x"}"#).is_err()); // 缺 id
        assert!(parse_request(r#"{"id":1}"#).is_err()); // 缺 cmd
        assert!(parse_request(r#"{"id":1,"cmd":42}"#).is_err()); // cmd 非字符串
    }

    // —— 白名单（最小暴露面）——

    #[test]
    fn whitelist_accepts_three_categories_only() {
        for cmd in WS_WHITELIST {
            assert!(check_whitelist(cmd).is_ok());
        }
        // 未入白名单：即使 Tauri 注册面存在也拒绝（最小暴露面——枚举攻击面收敛）
        for cmd in [
            "decrypt_resource",
            "decrypt_story",
            "preferences_read",
            "preferences_write",
            "lfen_diag",
            "watch_project_files",
            "apply_project_files",
            "stamp_project_files",
            "set_orientation",
            "load_i18n_overlay",
            "list_i18n_languages",
        ] {
            assert!(check_whitelist(cmd).is_err(), "{cmd} 不应在白名单");
        }
    }

    // —— WS 白名单属于 Tauri 注册面的子集（同一契约的结构证明）——

    #[test]
    fn ws_whitelist_subset_of_tauri_registry() {
        let lib = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
        )
        .unwrap();
        let start = lib
            .find("generate_handler!")
            .expect("lib.rs 缺 generate_handler");
        let body = &lib[start..];
        let end = body.find(']').expect("generate_handler 列表未闭合");
        let mut registered = std::collections::BTreeSet::new();
        for token in body[..end].split_whitespace() {
            let name = token
                .trim_matches(|c| c == ',' || c == '"')
                .rsplit("::")
                .next()
                .unwrap_or("");
            if !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            {
                registered.insert(name.to_string());
            }
        }
        for cmd in WS_WHITELIST {
            assert!(
                registered.contains(*cmd),
                "WS 白名单命令 {cmd} 未注册为 Tauri 命令（契约漂移——白名单必须与命令面同步）"
            );
        }
    }

    // —— release 编译期排除的源级断言 ——

    #[test]
    fn ws_module_and_setup_are_debug_gated() {
        let lib = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
        )
        .unwrap();
        // mod 声明与 setup 调用都必须紧贴 cfg(debug_assertions) 门控（逐行相邻断言）
        assert!(
            lib.contains("#[cfg(debug_assertions)]\npub mod ws_dev;"),
            "ws_dev 模块声明必须整体 cfg(debug_assertions) 门控"
        );
        let gated_setup = lib
            .lines()
            .collect::<Vec<&str>>()
            .windows(2)
            .any(|w| w[1].contains("ws_dev::setup") && w[0].contains("cfg(debug_assertions)"));
        assert!(
            gated_setup,
            "ws_dev::setup 调用必须 cfg(debug_assertions) 门控"
        );
    }

    #[test]
    fn tungstenite_referenced_only_inside_ws_dev_module() {
        // src 下除本模块外不得引用 WS 栈（release 排除的补充断言：无旁路调用点）。
        // 递归下钻：WS 栈引用若出现在 src 的子目录里，同样必须被判出。
        fn assert_no_ws_stack(dir: &std::path::Path) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                panic!("读 src 目录失败：{}", dir.display());
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    assert_no_ws_stack(&path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                if path.file_name().and_then(|e| e.to_str()) == Some("ws_dev.rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap();
                assert!(
                    !text.contains("tungstenite"),
                    "{} 引用了 WS 栈（WS 代码应全部收敛在 ws_dev.rs）",
                    path.display()
                );
            }
        }
        assert_no_ws_stack(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"));
    }

    // —— WS 层集成：真实 TCP + 握手 + 帧往返（合成 handler，无需 AppHandle）——

    #[test]
    fn ws_layer_round_trip_with_synthetic_handler() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                serve_handler(ws, |text| {
                    let (id, cmd, _) = parse_request(text).unwrap();
                    serde_json::json!({ "id": id, "ok": true, "data": cmd }).to_string()
                })
                .await;
            });
            let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
                .await
                .unwrap();
            let (mut sink, mut source) = futures_util::StreamExt::split(ws);
            futures_util::SinkExt::send(
                &mut sink,
                tungstenite::Message::text(r#"{"id":1,"cmd":"host_platform"}"#),
            )
            .await
            .unwrap();
            let reply = futures_util::StreamExt::next(&mut source)
                .await
                .unwrap()
                .unwrap();
            // 语义断言（serde_json Value 比较忽略键序——Map 为 BTreeMap 恒序但不必依赖）
            assert_eq!(
                serde_json::from_str::<Value>(reply.to_text().unwrap()).unwrap(),
                serde_json::json!({ "id": 1, "ok": true, "data": "host_platform" })
            );
        });
    }

    // —— 握手准入（Origin 白名单 / token，drive-by 拒绝）——

    #[test]
    fn ws_access_origin_whitelist_and_drive_by_rejection() {
        // 本机 dev server 的两种 Origin 放行
        assert!(check_ws_access(Some("http://localhost:1420"), None, None).is_ok());
        assert!(check_ws_access(Some("http://127.0.0.1:1420"), None, None).is_ok());
        // drive-by：恶意网页 Origin / file:// 的 null / 无 Origin 且无 token 一律拒
        assert!(check_ws_access(Some("http://evil.example"), None, None).is_err());
        assert!(check_ws_access(Some("null"), None, None).is_err());
        assert!(check_ws_access(None, None, None).is_err());
        // 配置 token 不影响合法 Origin 放行
        assert!(check_ws_access(Some("http://localhost:1420"), None, Some("secret")).is_ok());
        // token 通道：相等放行；错值/未配置/空值拒绝
        assert!(check_ws_access(None, Some("secret"), Some("secret")).is_ok());
        assert!(check_ws_access(None, Some("wrong"), Some("secret")).is_err());
        assert!(check_ws_access(None, Some("secret"), None).is_err());
        assert!(check_ws_access(None, Some(""), Some("")).is_err());
        // 持有有效 token 的工具即使带陌生 Origin 也放行（token 是显式凭据）
        assert!(
            check_ws_access(Some("http://evil.example"), Some("secret"), Some("secret")).is_ok()
        );
    }

    #[test]
    fn ws_query_token_extraction() {
        assert_eq!(query_token(Some("token=abc")), Some("abc"));
        assert_eq!(query_token(Some("a=1&token=abc&b=2")), Some("abc"));
        assert_eq!(query_token(Some("a=1")), None);
        assert_eq!(query_token(None), None);
        assert_eq!(query_token(Some("token=")), Some(""));
    }

    #[test]
    fn ws_handshake_access_check_is_wired() {
        // 源级断言（只取生产前缀，测试自身的断言串不计入）：
        // 握手必须经带准入校验的路径，删掉校验接线即红。
        let src = include_str!("ws_dev.rs");
        let prod = src.split("mod tests").next().unwrap_or(src);
        assert!(
            prod.contains("accept_hdr_async"),
            "握手必须走 accept_hdr_async 才能检查 Origin/token"
        );
        assert!(
            prod.contains("check_ws_access(origin, token, expected_token.as_deref())"),
            "握手回调必须调用准入判定"
        );
        assert!(
            prod.contains("StatusCode::FORBIDDEN"),
            "未授权握手必须回 403"
        );
        assert!(prod.contains("LFEN_WS_TOKEN"), "token 通道必须读 LFEN_WS_TOKEN");
    }

    #[test]
    fn drive_by_origin_rejected_at_handshake() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                accept_checked(stream, None).await
            });
            // 模拟 drive-by 网页：带恶意 Origin 的 WS 升级请求（原始 HTTP 帧）
            let mut client = tokio::net::TcpStream::connect(addr).await.unwrap();
            let request = format!(
                "GET / HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: http://evil.example\r\n\r\n"
            );
            tokio::io::AsyncWriteExt::write_all(&mut client, request.as_bytes())
                .await
                .unwrap();
            let mut buf = vec![0u8; 512];
            let n = tokio::io::AsyncReadExt::read(&mut client, &mut buf)
                .await
                .unwrap();
            let head = String::from_utf8_lossy(&buf[..n]);
            assert!(head.contains("403"), "drive-by 握手必须收到 403：{head}");
            assert!(
                server.await.unwrap().is_err(),
                "未授权连接不得升级为 WS（读不到存档/工程）"
            );
        });
    }

    #[test]
    fn dev_server_origin_passes_handshake() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                accept_checked(stream, None).await
            });
            use tokio_tungstenite::tungstenite::client::IntoClientRequest;
            let mut req = format!("ws://{addr}").into_client_request().unwrap();
            req.headers_mut()
                .insert("origin", "http://localhost:1420".parse().unwrap());
            let (_ws, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();
            assert!(server.await.unwrap().is_ok(), "本机 dev server Origin 必须放行");
        });
    }

    #[test]
    fn token_query_passes_handshake_without_origin() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                accept_checked(stream, Some("secret".to_string())).await
            });
            // 无 Origin 的脚本/工具：query token 相等即放行
            let (_ws, _resp) = tokio_tungstenite::connect_async(format!("ws://{addr}/?token=secret"))
                .await
                .unwrap();
            assert!(server.await.unwrap().is_ok(), "有效 token 必须放行");
        });
    }

    #[test]
    fn wrong_token_rejected_at_handshake() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                accept_checked(stream, Some("secret".to_string())).await
            });
            let result =
                tokio_tungstenite::connect_async(format!("ws://{addr}/?token=wrong")).await;
            assert!(result.is_err(), "错误 token 必须被拒");
            assert!(server.await.unwrap().is_err());
        });
    }
}
