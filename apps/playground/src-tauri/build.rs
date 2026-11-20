//! 构建脚本：tauri 构建 + app 自定义命令权限清单生成。
//!
//! 移动端不需要额外的原生构建步骤——Android 的供给与方向都在 Rust 侧直调
//! （APK-ZIP 直读 / JNI），iOS 的方向也在 Rust 侧直调 UIKit（objc2），仓库内
//! 没有随平台分发的原生源码包。
//!
//! app 自定义命令经 `AppManifest` 自动生成 `allow-<命令>`/`deny-<命令>` 权限
//! （命令名 slug 化：下划线转连字符），落 `permissions/`；`capabilities/default.json`
//! 显式列出放行命令——**未列命令默认拒绝**，使「Capabilities 默认拒绝、仅开放
//! 声明命令」的安全口径在 ACL 层真正成立（而非仅文档承诺）。

/// app 自定义命令清单：须与 `lib.rs` `generate_handler!` 注册集逐一对应
/// （`bridge_check` 交叉核对二者一致，防漂移）。
const COMMANDS: &[&str] = &[
    "project_files",
    "watch_project_files",
    "load_i18n_overlay",
    "list_i18n_languages",
    "apply_project_files",
    "stamp_project_files",
    "preferences_read",
    "preferences_write",
    "persistent_read",
    "persistent_write",
    "decrypt_resource",
    "decrypt_story",
    "resource_url",
    "save_write",
    "save_read",
    "save_list",
    "save_delete",
    "set_orientation",
    "lfen_diag",
    "host_platform",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri 构建失败");
}