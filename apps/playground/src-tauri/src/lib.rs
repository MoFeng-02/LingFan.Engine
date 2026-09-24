pub mod crypto;
pub mod preferences;
pub mod project_files;
pub mod resource_crypto;
pub mod save;

#[cfg(test)]
mod bridge_check;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            save::save_delete
        ])
        .setup(|app| {
            // 临时流缓存随启动清理（同 DEK 同路径 → 内容确定性可重建）
            if let Ok(data) = app.path().app_data_dir() {
                resource_crypto::cleanup_tmp_stream(&data);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
