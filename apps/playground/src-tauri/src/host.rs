//! ③ 平台区分（宿主事实源）：把编译目标平台暴露给渲染端。
//!
//! 为什么是 Rust 命令而不是编译期环境变量（`TAURI_ENV_PLATFORM`）：实测 Tauri CLI 的
//! `beforeBuildCommand` 子进程**没有**注入该变量（Android 构建下前端拿到 undefined →
//! 宿主误判为 desktop，iOS 构建同理）→ 编译期路线不可靠；`std::env::consts::OS` 在
//! 对应 target 下恒正确（android/ios/windows/macos/linux），且零依赖、零权限面。
//!
//! 取值与契约 `HostOs` 对齐（见 packages/engine/src/contracts/host.ts）。

/// 当前编译目标平台（`std::env::consts::OS`：windows/macos/linux/android/ios）
#[tauri::command]
pub fn host_platform() -> &'static str {
    std::env::consts::OS
}
