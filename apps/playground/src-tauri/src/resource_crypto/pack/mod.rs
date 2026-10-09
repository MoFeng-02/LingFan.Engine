//! 资源打包的内部实现：扫描加密、结果报告与打包入口。

/// 打包扫描：按扩展名与排除规则加密目录，并保留相对结构。
mod scan;
/// 打包结果的数据结构与异常判定。
mod report;
/// 打包入口：输入输出路径互斥校验，以及不带 dist 与带 dist 两种打包流程。
mod run;

/// 打包报告中的单个文件条目。
pub use report::PackEntry;
/// 一次打包的结果汇总。
pub use report::PackReport;
/// 按扩展名批量加密目录，并保留相对结构。
#[allow(unused_imports)]
pub(crate) use scan::encrypt_directory;
/// 校验打包输入与输出路径互不包含。
pub use run::ensure_pack_paths_distinct;
/// 打包工程目录，不含前端产物。
#[allow(unused_imports)]
pub(crate) use run::pack_project;
/// 打包工程目录，可附带前端产物。
pub use run::pack_project_with_dist;
