//! 构建脚本：tauri 常规构建。
//!
//! 移动端不需要额外的原生构建步骤——Android 的供给与方向都在 Rust 侧直调
//! （APK-ZIP 直读 / JNI），iOS 的方向也在 Rust 侧直调 UIKit（objc2），仓库内
//! 没有随平台分发的原生源码包，故本脚本只调用 `tauri_build::build()`。

fn main() {
    tauri_build::build();
}
