//! 工程文件供给（Rust 命令面）：从应用资源根取工程清单与故事文件。
//! 契约 = `ProjectFilesPort`（platform.ts）：manifest() 返回已解析对象、stories() 返回逻辑路径 → 原始文本。
//! 解析与组装归引擎（组装器是唯一解析点，混存识别与单列文件名不变量都在那里生效）——
//! 本层只做「取文件」与 UTF-8 校验，一切失败 fail-closed（不静默降级为空工程）。
//!
//! 资源根布局（dev 与 prod 同机制，清单在资源根内）：
//! tauri.conf.json 的 `bundle.resources = {"../Resources/": "Resources/"}`
//! 把工程资源复制到 `$RESOURCE/Resources/**`（dev 下由 tauri-build 复制到 target 目录，prod 由打包器复制）。

/// 工程供给：资源根定位、清单解析与故事文件收集。
mod supply;
/// i18n overlay 的读取。
mod overlay;
/// 可用语言枚举。
mod languages;
/// 源工程热重载监视。
mod watch;

/// 行为测试。
#[cfg(test)]
mod tests;

/// 单个 overlay 文件的逻辑路径与键值对。
pub use overlay::OverlayFile;
/// 工程清单与故事文本的命令负载。
pub use supply::ProjectFiles;
/// 工程文件供给的错误类型。
pub use supply::ProjectFilesError;
/// Tauri 命令：枚举可用语言。
pub use languages::list_i18n_languages;
/// Tauri 命令：读取指定语言的 i18n overlay。
pub use overlay::load_i18n_overlay;
/// 定位应用资源根目录。
#[allow(unused_imports)]
pub(crate) use supply::locate_resource_root;
/// Tauri 命令：读取工程清单与故事文本。
pub use supply::project_files;
/// Tauri 命令：启动源工程热重载监视。
pub use watch::watch_project_files;

/// 命令宏：与命令函数同路径解析，转发到本域实现。
pub(crate) use languages::{__cmd__list_i18n_languages, __tauri_command_name_list_i18n_languages};
/// 命令宏：与命令函数同路径解析，转发到本域实现。
pub(crate) use overlay::{__cmd__load_i18n_overlay, __tauri_command_name_load_i18n_overlay};
/// 命令宏：与命令函数同路径解析，转发到本域实现。
pub(crate) use supply::{__cmd__project_files, __tauri_command_name_project_files};
/// 命令宏：与命令函数同路径解析，转发到本域实现。
pub(crate) use watch::{__cmd__watch_project_files, __tauri_command_name_watch_project_files};
