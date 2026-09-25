pub mod crypto;
pub mod diagnostics;
pub mod host;
pub mod preferences;
pub mod project_files;
pub mod resource_crypto;
pub mod resource_fs;
pub mod save;
pub mod shell;

#[cfg(test)]
mod bridge_check;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // ⑨-5 移动端供给：fs 插件 = asset:// 读取原语（Rust 侧经 FsExt 取可 seek fd）。
        // 其 JS 命令不在 capabilities 授权面内（default.json 仅 core+opener），对 webview 默认拒绝。
        .plugin(tauri_plugin_fs::init())
        // ⑨-4c 大资源流式：lfstream 协议双路径——v2 分块按需解密（Range/206，明文不落盘）
        // + v1 token 缓存；缓存文件名信任边界（hex64.ext / v2/逻辑路径 validate）在 handler 内。
        .register_uri_scheme_protocol("lfstream", |ctx, request| {
            resource_crypto::lfstream_protocol_handler(request, ctx.app_handle())
        })
        .invoke_handler(tauri::generate_handler![
            project_files::project_files,
            project_files::watch_project_files,
            project_files::load_i18n_overlay,
            project_files::list_i18n_languages,
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

    // ⑨-5 移动端供给：Kotlin AssetListPlugin（asset 递归枚举）+ AssetFs 装配（Android 专用）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(resource_fs::asset_list_plugin());

    // 08 §八.2 屏幕方向：Kotlin ShellPlugin 注册（Android 专用；其余平台命令走 no-op）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(shell::android_plugin());

    // 08 §八.2 屏幕方向：Swift ShellPlugin 注册（iOS 专用；源在 src-tauri/ios/，随 ios init 落位）
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(shell::ios_plugin());

    builder
        .setup(|app| {
            // 临时流缓存随启动清理（同 DEK 同路径 → 内容确定性可重建）
            if let Ok(data) = app.path().app_data_dir() {
                resource_crypto::cleanup_tmp_stream(&data);
            }
            // 诊断探针（仅当 LFEN_IOS_DIAG=1；默认零行为）——CI 冒烟排「跑得起来但画面空白」用
            diagnostics::arm(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
