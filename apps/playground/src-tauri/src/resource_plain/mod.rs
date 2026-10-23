//! 明文资源供给段：`lfstream` 协议的 `raw/{encodeURIComponent(逻辑路径)}` 分支。
//!
//! 存在理由：壳形态（桌面与移动端）下页面从打包产物加载，而资源落在 `paths::resource_root`
//! 指向的目录——打包后即应用包内的 `Resources/`（由 `bundle.resources` 落地）。两者不是同一
//! 命名空间：页面源根相对路径 `/Audio/x.mp3` 在 WebView 里解析到打包产物根，请求必然落空，
//! 媒体元素只会得到一次「取不到字节」的失败。故明文资源统一由本协议段按逻辑路径供给，前端
//! 不拼 URL，改由 `resource_url` 命令给出完整地址（平台形态差异留在 Rust）。
//!
//! 与 `resource_crypto` 的 `v2/` 段互不重叠：那一段供加密资源按需分块解密，本段只供构建期
//! 未加密的文件（音视频、图、字体、文本）。两段共用 Range 响应与 MIME 实现，各段只负责
//! 自己的路由与信任边界。

/// 明文资源段的请求路由与扩展名白名单。
mod route;
/// 明文资源段的响应：资源根定位、存在性判定与 Range 响应。
mod serve;
/// 明文资源 URL 的构造。
mod url;

/// 行为测试。
#[cfg(test)]
mod tests;

/// 本段是否认领该请求路径（`raw/` 前缀即本段，其余留给加密段）。
pub(crate) use route::handles;
/// 明文资源段的协议响应。
pub(crate) use serve::serve;
/// `resource_url` 命令：前端取明文资源地址的唯一入口。
pub use url::resource_url;
/// 命令宏生成的注册面辅助项（`generate_handler!` 展开需要，随命令一并转发）。
pub(crate) use url::{__cmd__resource_url, __tauri_command_name_resource_url};
