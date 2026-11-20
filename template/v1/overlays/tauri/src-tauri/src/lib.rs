//! 库入口：装配 Tauri 应用并注册命令表。
//!
//! 拆出 `lib.rs` 是为了让移动端也能复用同一份 `run()`（移动端由外部运行器链接
//! `app_lib`，没有自己的 `main`）。桌面端 `main.rs` 只做一次转发。
//!
//! 命令分三个域注册：存档（`save/`）、偏好（`preferences/`）与壳配置（`orientation`）。
//! 新增命令时在对应域的模块里实现，再到 `invoke_handler` 里点名——Tauri 不做按模块自动收集。

mod orientation;
mod persistent;
mod preferences;
mod save;

/// 启动应用。命令名必须与前端 `packages/adapters/src/save/tauri.ts`、
/// `src/preferences/tauriPreferences.ts`、`src/shell/orientation.ts` 里的
/// `invoke(...)` 逐字一致。
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save::save_write,
            save::save_read,
            save::save_delete,
            save::save_list,
            preferences::preferences_read,
            preferences::preferences_write,
            persistent::persistent_read,
            persistent::persistent_write,
            orientation::set_orientation,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
