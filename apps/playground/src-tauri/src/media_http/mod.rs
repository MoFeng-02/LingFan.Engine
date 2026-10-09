//! Android 大媒体回环 HTTP 供给：加密音视频不经 WebView 拦截层，直接由本机 socket 流式供给。
//!
//! 存在理由（两条硬约束，缺一则本模块无必要）：
//! 1. WebView 的 `shouldInterceptRequest` 拦截层对**任何非零起点 `Range`** 一律失败
//!    （Chromium 40739128）⇒ 非 faststart 的 MP4（`moov` 在文件尾）解复用必读尾部 ⇒ 必然打不开；
//! 2. Tauri 自定义协议的响应体在 Android 侧被**整段**拷进 JVM `byte[]`
//!    （wry `byte_array_from_slice` + `ByteArrayInputStream`），而设备 Java 堆上限
//!    （`dalvik.vm.heapgrowthlimit` 192MB 级、manifest 未开 `largeHeap`）放不下大媒体
//!    ⇒ 「回 200 全量 + `Accept-Ranges: none`」那条绕过路也走不通。
//!
//! 故：让 Chromium 走**真实 socket** 取字节——本机回环 HTTP 服务按需分块解密并流式写出，
//! 单次响应不整段驻留内存，且保留完整 `Range` 语义（seek 可用）。
//!
//! 信任边界（暴露面收敛）：仅绑 `127.0.0.1`；端口由内核分配；每次启动随机 token 入路径
//! （不符一律 404）；仅服务资源根下**音视频扩展名**的 v2 分块资源；无目录列举、无其它端点；
//! 进程退出即随监听套接字消失。
//!
//! 本模块为**平台无关**代码（桌面同样编译）：路由命中判定在 `resource_crypto`，桌面恒不命中
//! ⇒ 桌面不会起端口；而服务端逻辑因此可在桌面 `cargo test` 全量覆盖。

/// 回环 HTTP 服务：懒启动、连接处理与请求上下文。
mod server;
/// 请求路由与信任边界判定。
mod route;
/// 最小 HTTP/1.1 响应头与空响应。
mod response;

/// 行为测试。
#[cfg(test)]
mod tests;

#[allow(unused_imports)]
/// 回环服务地址：端口与路径 token。
pub(crate) use server::ServerInfo;
#[allow(unused_imports)]
/// 懒启动回环服务，返回服务地址（bind 失败为 `None`）。
pub(crate) use server::ensure_server;
#[allow(unused_imports)]
/// 回环 URL 形状（纯函数）。
pub(crate) use server::loopback_url;

