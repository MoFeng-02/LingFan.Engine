//! Tauri 宿主 crate 的装配入口：模块声明 + `run()` 里的插件装配与命令注册。
//!
//! 各模块自己实现能力，这里只做三件事——把模块挂上、把命令注册进 `invoke_handler!`、
//! 在启动序列里按平台装配插件与后台任务。命令名与前端 `invoke` 的对应关系由源级测试守护。

pub mod boot;
pub mod crypto;
pub mod diagnostics;
pub mod fs;
pub mod host;
pub mod http;
pub mod media_http;
pub mod paths;
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

/// 应用入口：装配插件与命令注册，随后进入 Tauri 事件循环（不返回）。
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
            boot::setup(app.handle());
            // 开发期 WS 通道：debug 构建启动 127.0.0.1 监听（浏览器页面复用宿主能力）；
            // release 构建整段不参与编译（由 ws_dev 内的源级断言守护）
            #[cfg(debug_assertions)]
            ws_dev::setup(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
