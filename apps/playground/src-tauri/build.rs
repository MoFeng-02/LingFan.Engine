//! 构建脚本：tauri 常规构建 + iOS 原生插件的 Swift 包编译与链接。
//!
//! **iOS 为什么需要这一段**：Rust 侧 `ios_plugin_binding!(init_plugin_shell)` 声明的是
//! **链接期符号**，而 Rust 库是在 Xcode 的 "Build Rust Code" 阶段先被链接成 dylib 的
//! （此时 app target 的 Swift 还没编译）→ 若 Swift 代码只放在 app target 里，链接必失败
//! （`ld: Undefined symbols _init_plugin_shell`）。官方做法（`tauri-plugin` 的 `ios_path()`）
//! 是让 Swift 包在 cargo 构建期由 swift-rs 编译成静态库并链接进来——这里复用同一实现
//! `tauri_utils::build::link_apple_library`，并同样先把 tauri-api 拷贝到 `../.tauri/tauri-api`
//! （`ios/Package.swift` 里的相对依赖路径）。
//!
//! Android 不需要对应处理：Kotlin 插件类是运行期反射查找（`register_android_plugin` 传类路径），
//! 不涉及链接期符号。

#[cfg(target_os = "macos")]
mod ios {
    use std::path::{Path, PathBuf};

    /// Swift 包名（须与 `ios/Package.swift` 的 package/product 名一致）
    const PACKAGE: &str = "lfen-shell";

    pub fn link_ios_plugin() {
        // 仅 iOS 目标需要（macOS 桌面构建不链接该包）
        if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "ios" {
            return;
        }
        let manifest_dir =
            PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
        let ios_dir = manifest_dir.join("ios");
        println!("cargo:rerun-if-changed=ios");

        // tauri-api：Swift 包对 Tauri 的依赖（路径由 tauri 的构建脚本提供）
        let api_src = std::env::var("DEP_TAURI_IOS_LIBRARY_PATH")
            .expect("缺少 DEP_TAURI_IOS_LIBRARY_PATH（tauri 必须作为依赖存在）");
        copy_tree(
            Path::new(&api_src),
            &manifest_dir.join(".tauri").join("tauri-api"),
        );

        // 编译 Swift 包并发出链接指令（静态库 + 搜索路径）
        tauri_utils::build::link_apple_library(PACKAGE, &ios_dir);
    }

    /// 递归复制（跳过 SwiftPM 构建产物与测试目录，语义同 tauri-plugin 的 copy_folder）
    fn copy_tree(source: &Path, target: &Path) {
        const SKIP: [&str; 3] = [".build", "Package.resolved", "Tests"];
        let _ = std::fs::remove_dir_all(target);
        let mut stack = vec![(source.to_path_buf(), target.to_path_buf())];
        while let Some((from, to)) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&from) else {
                continue;
            };
            let _ = std::fs::create_dir_all(&to);
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if SKIP.contains(&name.as_str()) {
                    continue;
                }
                let src = entry.path();
                let dst = to.join(&name);
                if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    stack.push((src, dst));
                } else {
                    let _ = std::fs::copy(&src, &dst);
                }
            }
        }
    }
}

fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    ios::link_ios_plugin();
}
