//! 安装包 ZIP 直读插件的装配：setup 期建索引并常驻管理状态。

/// APK-ZIP 供给适配器：setup 期定位安装包并构建条目索引（一次性），常驻管理状态。
/// 索引构建失败 = 供给链不可用，启动即失败（错误信息可直接定位是哪一步、哪个文件）。
#[cfg(target_os = "android")]
pub fn apk_zip_fs_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri::Manager;
    tauri::plugin::Builder::<tauri::Wry>::new("lfen-apkzip")
        .setup(|app, _api| {
            let fs = super::apk_zip::ApkZipFs::create()?;
            app.manage(std::sync::Arc::new(fs));
            Ok(())
        })
        .build()
}
