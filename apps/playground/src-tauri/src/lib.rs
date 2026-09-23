pub mod crypto;
pub mod project_files;
pub mod resource_crypto;
pub mod save;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            project_files::project_files,
            project_files::watch_project_files,
            resource_crypto::decrypt_resource,
            resource_crypto::decrypt_story,
            save::save_write,
            save::save_read,
            save::save_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
