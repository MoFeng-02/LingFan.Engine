// swift-tools-version:5.3
//
// iOS 原生插件的 Swift 包（由 build.rs 经 tauri_utils::build::link_apple_library 编译并链接）。
// 为什么必须是 Swift 包而不是丢进 Xcode 工程的 Sources：Rust 侧 ios_plugin_binding! 声明的是
// **链接期符号**，而 Rust 是在 Xcode 的 "Build Rust Code" 阶段先被链接成 dylib 的——那时
// app target 的 Swift 尚未编译，符号无从解析（ld: Undefined symbols _init_plugin_shell）。
// 官方做法（tauri-plugin 的 ios_path()）即：Swift 包在 cargo 构建期由 swift-rs 编译成静态库并链接。
//
// `Tauri` 依赖指向 build.rs 拷贝进来的 tauri-api（../.tauri/tauri-api 相对本文件）。

import PackageDescription

let package = Package(
  name: "lfen-shell",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "lfen-shell",
      type: .static,
      targets: ["lfen-shell"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "lfen-shell",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
