// Tauri 的构建期钩子：在编译 Rust 侧代码之前生成权限清单与上下文资源。
// `tauri_build::build()` 会读取 `tauri.conf.json` 与 `capabilities/`，
// 缺了这一步 `generate_context!()` 在编译期拿不到配置。
fn main() {
    tauri_build::build()
}
