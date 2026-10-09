//! 资源文件系统抽象（契约 + 双适配器，「适配器只负责取」的 Rust 侧对应物）：
//! - [`StdFs`]：桌面 / dev——真实文件系统（std::fs）。
//! - [`ApkZipFs`]：Android——安装包 ZIP 直读（自建条目索引，不经 AssetManager；
//!   asset 不可写、无独立 metadata，故只读）。
//!
//! 供给侧语义约束：资源根在安装包内不可变（Android），枚举结果即运行期真值；
//! 点文件过滤、扩展名判定、解密等语义全部归调用方（与既有供给链一致，此处只做「取」）。

/// 资源文件系统契约与遍历条目。
mod contract;
/// 桌面 / dev 适配器：真实文件系统。
mod std_fs;
/// Android 适配器：安装包 ZIP 直读。
#[cfg(target_os = "android")]
mod apk_zip;
/// 安装包 ZIP 直读插件的装配。
mod plugin;

/// 行为测试。
#[cfg(test)]
mod tests;

/// 资源适配器与加密链共用的读取原语（`SeekRead` / `RangedFile`）：实现在通用底座 `crate::fs`，
/// 此处再导出，使本模块的调用点不必跨模块拼底座路径。
pub(crate) use crate::fs::{RangedFile, SeekRead};

#[cfg(target_os = "android")]
pub use apk_zip::ApkZipFs;

/// 按平台取资源文件系统适配器（组合根语义：命令面只依赖契约，不关心实现）。
/// Android = [`ApkZipFs`]（安装包 ZIP 直读，唯一通道）；其余平台 = [`StdFs`]。
pub fn resource_fs(app: &tauri::AppHandle) -> std::sync::Arc<dyn ResourceFs> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<std::sync::Arc<apk_zip::ApkZipFs>>()
            .inner()
            .clone()
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        std::sync::Arc::new(StdFs)
    }
}

/// 资源文件系统契约：只读取 + 枚举，零写入。
pub use contract::ResourceFs;
/// 桌面 / dev 适配器：真实文件系统。
pub use std_fs::StdFs;
/// 递归遍历条目：路径与是否目录。
pub use contract::WalkEntry;

#[allow(unused_imports)]
/// 安装包 ZIP 直读插件（Android 专用，其它平台不注册）。
pub use plugin::*;
