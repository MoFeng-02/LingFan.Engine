pub mod crypto;
pub mod diagnostics;
pub mod host;
pub mod media_http;
pub mod preferences;
pub mod project_files;
pub mod project_writer;
pub mod resource_crypto;
pub mod resource_fs;
pub mod save;
pub mod shell;
pub mod zip_index;
// 开发期 WS 通道：仅 debug 构建编译——release 编译期排除（无监听代码）
#[cfg(debug_assertions)]
pub mod ws_dev;

#[cfg(test)]
mod bridge_check;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 移动端供给：fs 插件 = asset:// 读取原语（Rust 侧经 FsExt 取可 seek fd）。
        // 其 JS 命令不在 capabilities 授权面内（default.json 仅 core+opener），对 webview 默认拒绝。
        .plugin(tauri_plugin_fs::init())
        // 大资源流式：lfstream 协议双路径——v2 分块按需解密（Range/206，明文不落盘）
        // + v1 token 缓存；缓存文件名信任边界（hex64.ext / v2/逻辑路径 validate）在 handler 内。
        .register_uri_scheme_protocol("lfstream", |ctx, request| {
            // 面包屑：主线程可能在启动后一段时间（心跳某一拍）卡住，而该时点正是前端开始拉资源。
            // 这两条把「卡在协议处理器里」直接夹出来——**只要出现「进入」而无「返回」即为卡点**。
            let uri = request.uri().to_string();
            eprintln!("[lfen] lfstream 进入：{uri}");
            let response = resource_crypto::lfstream_protocol_handler(request, ctx.app_handle());
            eprintln!("[lfen] lfstream 返回：{uri}");
            response
        })
        .invoke_handler(tauri::generate_handler![
            project_files::project_files,
            project_files::watch_project_files,
            project_files::load_i18n_overlay,
            project_files::list_i18n_languages,
            project_writer::apply_project_files,
            project_writer::stamp_project_files,
            preferences::preferences_read,
            preferences::preferences_write,
            resource_crypto::decrypt_resource,
            resource_crypto::decrypt_story,
            save::save_write,
            save::save_read,
            save::save_list,
            save::save_delete,
            shell::set_orientation,
            diagnostics::lfen_diag,
            host::host_platform
        ]);

    // 移动端供给：APK-ZIP 直读适配器（唯一通道，setup 期建条目索引）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(resource_fs::apk_zip_fs_plugin());

    // 屏幕方向：Android 走 JNI 直调（无需插件注册）；iOS 走 Swift 插件注册
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(shell::ios_plugin());

    builder
        .setup(|app| {
            // 启动路径面包屑：应用可能在页面起来约 1 秒后整体卡住（心跳条数起消失、WebKit 合成
            // 停摆、录屏全白）。以下每条都在卡点之前/之后留痕，用于把卡点夹到具体一步。
            eprintln!("[lfen] setup: 进入");
            // 临时流缓存随启动清理（同 DEK 同路径 → 内容确定性可重建）
            if let Ok(data) = app.path().app_data_dir() {
                resource_crypto::cleanup_tmp_stream(&data);
            }
            eprintln!("[lfen] setup: tmp 清理完成");
            // 诊断探针已改前端 build-flag（VITE_LFEN_DIAG=1，src/diag.ts）；lfen_diag 命令保留为回传通道
            splash_then_show(app.handle());
            eprintln!("[lfen] setup: 窗口显示流程返回");
            // 启动期窗口状态取证：前端探针会随页面节流一起冻结（日志往往只到启动后不到一秒），
            // 只有 Rust 侧心跳能区分「页面被节流」与「整个进程被挂起」——白屏归因的分水岭
            #[cfg(debug_assertions)]
            spawn_boot_probe(app.handle());
            // 开发期 WS 通道：debug 构建启动 127.0.0.1 监听（浏览器页面复用宿主能力）；
            // release 编译期排除（锚点 ws-dev-only-release-hardoff）
            #[cfg(debug_assertions)]
            ws_dev::setup(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 启动期窗口状态取证（仅 debug）：每 2 秒一条心跳，共 20 条（40s）。
///
/// 为什么必须由 Rust 打：前端探针一旦页面被节流或进程被挂起就一起冻结。Rust 线程的心跳
/// **若继续往下打**，说明进程活着、被冻的是页面/WebView 一侧；**若同时停在同一点**，
/// 则是整个进程被挂起（例如应用始终没拿到前台）。窗口的可见/聚焦读数同批给出。
///
/// 20 条（而非 6 条）：iOS 冷启动下前端 JS 比 Rust 侧晚数秒才起来——心跳条数太少
/// 会整段落在「页面还没起来」的时段里，覆盖不到冻结点。
#[cfg(debug_assertions)]
fn spawn_boot_probe(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        for i in 1..=20 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            // **必须先打这一条**：下面的窗口读数要走 Tauri、最终落到主线程；若主线程被卡，
            // 那次调用会把这个线程一起挂住。先打印就能区分两种成因——
            //   只出现「心跳 #n」而无窗口读数 ⇒ 主线程卡住（Tauri 调用阻塞在此）
            //   连「心跳 #n」都没有        ⇒ 整个进程被挂起/线程调度停止
            eprintln!("[lfen] 心跳 #{i}");
            let state = match handle.get_webview_window("main") {
                Some(window) => format!(
                    "可见={:?} 聚焦={:?} 最小化={:?}",
                    window.is_visible(),
                    window.is_focused(),
                    window.is_minimized()
                ),
                None => "无 main 窗口".to_string(),
            };
            eprintln!("[lfen] 启动心跳 #{i}：{state}");
        }
    });
}

/// 双窗启动画面（桌面）：splash 先行显示，盖住资源根定位 / DEK 首启信封化解封
/// 的时延；预热完成后显示主窗口并关闭 splash。移动端无第二窗口——直接显示主窗口
/// （防御 conf `visible: false` 在移动端生效导致的白屏）。
/// splash 创建失败不阻塞启动（fail 尽力）；主窗口显示失败打印可见错误（fail-closed 不静默）。
fn splash_then_show(app: &tauri::AppHandle) {
    #[cfg(desktop)]
    let splash = tauri::WebviewWindowBuilder::new(
        app,
        "splashscreen",
        tauri::WebviewUrl::App("splashscreen.html".into()),
    )
    .title("lingfanengine")
    .inner_size(420.0, 240.0)
    .center()
    .resizable(false)
    .decorations(false)
    .build()
    .map_err(|e| eprintln!("[lfen] splash 窗口创建失败（继续启动）：{e}"))
    .ok();

    // 首启 seed→KEK 信封化解封在此完成（明文形态失败无害）——show 之后 v2 供给立即可用
    eprintln!("[lfen] 预热资源密钥：开始");
    resource_crypto::preheat_resource_key(app);
    eprintln!("[lfen] 预热资源密钥：完成");

    if let Some(main) = app.get_webview_window("main") {
        eprintln!("[lfen] 主窗口 show：调用");
        if let Err(e) = main.show() {
            eprintln!("[lfen] 主窗口显示失败：{e}");
        }
        eprintln!("[lfen] 主窗口 show：返回");
    }
    #[cfg(desktop)]
    if let Some(splash) = splash {
        let _ = splash.close();
    }
}
