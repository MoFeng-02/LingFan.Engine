//! Tauri 桌面写回端口（Rust 侧）：`apply_project_files` 命令实现浏览器
//! `createHandleProjectWriter`（directorySource.ts）**完全同序**的写回——
//! 「校验 → 建 `Stories/` → 写列文件 → 写 `project.json`（提交点）→ 删陈旧」，
//! 永不先删后写：失败时磁盘最坏只是「多出文件」，工程仍可加载。
//!
//! 与浏览器侧的分工差异：FSA 句柄自带根目录与权限，这里根路径由前端显式传入
//! （Tauri dialog 选目录所得）；因此**纵深防御**在 Rust 侧独立成立——逻辑路径
//! 白名单（写入 = `Stories/**` 或 `project.json`；删除 = 仅 `Stories/**`）、
//! 拒绝 `..` / 反斜杠 / 空段，不信任前端。任一路径非法 → **整批拒绝、零写入**。
//! 差量计算归 TS（`diffProjectFiles`，格式知识单点）；本命令只按差量落盘。
//!
//!

/// 路径白名单与错误类型。
mod whitelist;
/// 按差量写回工程文件。
mod apply;
/// 文件指纹读取。
mod stamp;

/// 行为测试。
#[cfg(test)]
mod tests;

/// 单个待写文件：逻辑路径与全文。
pub use apply::ProjectFileChange;
/// 单个文件的并发检测指纹。
pub use stamp::ProjectFileStamp;
/// 指纹批量结果。
pub use stamp::ProjectStamps;
/// 写回结果。
pub use apply::ProjectWriteReport;
/// 工程写回的错误类型。
pub use whitelist::ProjectWriterError;
/// Tauri 命令：按差量写回工程文件。
pub use apply::apply_project_files;
/// Tauri 命令：批量读取文件基线指纹。
pub use stamp::stamp_project_files;

/// 命令宏：与命令函数同路径解析，转发到本域实现。
pub(crate) use apply::{__cmd__apply_project_files, __tauri_command_name_apply_project_files};
/// 命令宏：与命令函数同路径解析，转发到本域实现。
pub(crate) use stamp::{__cmd__stamp_project_files, __tauri_command_name_stamp_project_files};
