pub mod crypto;
pub mod diagnostics;
pub mod host;
pub mod preferences;
pub mod project_files;
pub mod project_writer;
pub mod resource_crypto;
pub mod resource_fs;
pub mod save;
pub mod shell;
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
            resource_crypto::lfstream_protocol_handler(request, ctx.app_handle())
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

    // 移动端供给：Kotlin AssetListPlugin（asset 递归枚举）+ AssetFs 装配（Android 专用）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(resource_fs::asset_list_plugin());

    // 屏幕方向：Kotlin ShellPlugin 注册（Android 专用；其余平台命令走 no-op）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(shell::android_plugin());

    // 屏幕方向：Swift ShellPlugin 注册（iOS 专用；源在 src-tauri/ios/，随 ios init 落位）
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(shell::ios_plugin());

    builder
        .setup(|app| {
            // 临时流缓存随启动清理（同 DEK 同路径 → 内容确定性可重建）
            if let Ok(data) = app.path().app_data_dir() {
                resource_crypto::cleanup_tmp_stream(&data);
            }
            // 诊断探针已改前端 build-flag（VITE_LFEN_DIAG=1，src/diag.ts）；lfen_diag 命令保留为回传通道
            splash_then_show(app.handle());
            // 开发期 WS 通道：debug 构建启动 127.0.0.1 监听（浏览器页面复用宿主能力）；
            // release 编译期排除（锚点 ws-dev-only-release-hardoff）
            #[cfg(debug_assertions)]
            ws_dev::setup(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    resource_crypto::preheat_resource_key(app);

    if let Some(main) = app.get_webview_window("main") {
        if let Err(e) = main.show() {
            eprintln!("[lfen] 主窗口显示失败：{e}");
        }
    }
    #[cfg(desktop)]
    if let Some(splash) = splash {
        let _ = splash.close();
    }
}
