//! 资源文件系统抽象（契约 + 双适配器，07 §三「适配器只负责取」的 Rust 侧对应物）：
//! - [`StdFs`]：桌面 / dev——真实文件系统（std::fs）。
//! - [`AssetFs`]：Android——安装包 asset（tauri-plugin-fs 打开可 seek fd +
//!   Kotlin `AssetListPlugin` 递归枚举；asset 不可写、无独立 metadata，故只读）。
//!
//! 供给侧语义约束：资源根在安装包内不可变（Android），枚举结果即运行期真值；
//! 点文件过滤、扩展名判定、解密等语义全部归调用方（与既有供给链一致，此处只做「取」）。

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Read + Seek 组合别名：资源读取的统一文件原语（v2 分块按需解密依赖 seek）。
pub trait SeekRead: Read + Seek {}
impl<T: Read + Seek> SeekRead for T {}

/// `Box<dyn SeekRead>` 的长度探测（seek 到尾部取值后还原位置）。
pub fn seek_len(f: &mut dyn SeekRead) -> std::io::Result<u64> {
    let restored = f.stream_position()?;
    let len = f.seek(SeekFrom::End(0))?;
    f.seek(SeekFrom::Start(restored))?;
    Ok(len)
}

/// 递归遍历条目：路径与「是否目录」标记。
pub struct WalkEntry {
    pub path: PathBuf,
    pub is_dir: bool,
}

/// 资源文件系统契约：只读取 + 枚举，零写入（写入类操作一律走真实路径，如 app_data）。
pub trait ResourceFs: Send + Sync {
    fn is_file(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn read(&self, path: &Path) -> std::io::Result<Vec<u8>>;
    fn open(&self, path: &Path) -> std::io::Result<Box<dyn SeekRead>>;
    /// 递归列出 `dir` 下全部条目（含目录本身作条目）；目录不存在 = Err（调用方按各自语义降级/报错）。
    fn walk(&self, dir: &Path) -> std::io::Result<Vec<WalkEntry>>;
}

// —— 桌面 / dev：真实文件系统 ——

pub struct StdFs;

impl ResourceFs for StdFs {
    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn read(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        std::fs::read(path)
    }

    fn open(&self, path: &Path) -> std::io::Result<Box<dyn SeekRead>> {
        Ok(Box::new(std::fs::File::open(path)?))
    }

    fn walk(&self, dir: &Path) -> std::io::Result<Vec<WalkEntry>> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            for entry in std::fs::read_dir(&current)? {
                let path = entry?.path();
                let is_dir = path.is_dir();
                if is_dir {
                    stack.push(path.clone());
                }
                out.push(WalkEntry { path, is_dir });
            }
        }
        Ok(out)
    }
}

// —— Android：安装包 asset ——

#[cfg(target_os = "android")]
mod asset {
    use super::{ResourceFs, SeekRead, WalkEntry};
    use std::io;
    use std::path::{Path, PathBuf};

    /// asset 协议前缀（tauri-utils::platform::ANDROID_ASSET_PROTOCOL_URI_PREFIX 同值；
    /// 不直接引用该常量是因为它仅 android cfg 可见，此处同源维护）。
    const ASSET_URI_PREFIX: &str = "asset://localhost/";

    /// Kotlin `AssetListPlugin.list` 单条目：asset 根相对路径（`/` 分隔）+ 是否目录。
    #[derive(serde::Deserialize)]
    pub struct AssetListEntry {
        pub path: String,
        #[serde(default)]
        pub dir: bool,
    }

    #[derive(serde::Deserialize)]
    pub struct AssetListResponse {
        pub entries: Vec<AssetListEntry>,
    }

    /// asset 路径 → 协议内相对段（`asset://localhost/Resources/x` → `Resources/x`）。
    fn asset_rel(path: &Path) -> io::Result<String> {
        let s = path.to_string_lossy();
        if let Some(rel) = s.strip_prefix(ASSET_URI_PREFIX) {
            Ok(rel.to_string())
        } else if s.as_ref() == ASSET_URI_PREFIX.trim_end_matches('/') {
            Ok(String::new())
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("非 asset 协议路径：{s}"),
            ))
        }
    }

    /// 存在性查找的共同前置：枚举父目录后按完整相对路径匹配。
    /// （asset 无 metadata API——枚举即唯一判定来源，kotlin 侧一次递归调用代价可忽略）
    fn parent_rel(rel: &str) -> &str {
        match rel.rsplit_once('/') {
            Some((parent, _)) => parent,
            None => "",
        }
    }

    pub struct AssetFs {
        /// 打开 asset 文件（tauri-plugin-fs：asset:// 前缀 → content uri → 可 seek fd）
        open_file: Box<dyn Fn(&Path) -> io::Result<std::fs::File> + Send + Sync>,
        /// 递归枚举（Kotlin AssetListPlugin；入参 = asset 根相对路径）
        list: Box<dyn Fn(&str) -> io::Result<Vec<AssetListEntry>> + Send + Sync>,
    }

    impl AssetFs {
        pub(crate) fn new(
            open_file: Box<dyn Fn(&Path) -> io::Result<std::fs::File> + Send + Sync>,
            list: Box<dyn Fn(&str) -> io::Result<Vec<AssetListEntry>> + Send + Sync>,
        ) -> Self {
            Self { open_file, list }
        }

        fn lookup(&self, path: &Path) -> Option<bool> {
            let rel = asset_rel(path).ok()?;
            let parent = parent_rel(&rel).to_string();
            (self.list)(&parent)
                .ok()?
                .into_iter()
                .find(|e| e.path == rel)
                .map(|e| e.dir)
        }
    }

    impl ResourceFs for AssetFs {
        fn is_file(&self, path: &Path) -> bool {
            self.lookup(path).is_some_and(|dir| !dir)
        }

        fn is_dir(&self, path: &Path) -> bool {
            self.lookup(path).is_some_and(|dir| dir)
        }

        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            let mut f = self.open(path)?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            Ok(buf)
        }

        fn open(&self, path: &Path) -> io::Result<Box<dyn SeekRead>> {
            Ok(Box::new((self.open_file)(path)?))
        }

        fn walk(&self, dir: &Path) -> io::Result<Vec<WalkEntry>> {
            let rel = asset_rel(dir)?;
            Ok((self.list)(&rel)?
                .into_iter()
                .map(|e| WalkEntry {
                    path: PathBuf::from(format!("{ASSET_URI_PREFIX}{}", e.path)),
                    is_dir: e.dir,
                })
                .collect())
        }
    }
}

#[cfg(target_os = "android")]
pub use asset::AssetFs;

/// 按平台取资源文件系统适配器（组合根语义：命令面只依赖契约，不关心实现）。
pub fn resource_fs(app: &tauri::AppHandle) -> std::sync::Arc<dyn ResourceFs> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<std::sync::Arc<AssetFs>>().inner().clone()
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        std::sync::Arc::new(StdFs)
    }
}

/// 注册 Kotlin `AssetListPlugin` 并装配 [`AssetFs`]（Android 专用 tauri 插件）。
/// 桌面构建无此插件——命令面经 [`resource_fs`] 拿到的是 `StdFs`，同一契约。
#[cfg(target_os = "android")]
pub fn asset_list_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri::Manager;
    tauri::plugin::Builder::<tauri::Wry>::new("lfen-assets")
        .setup(|app, api| {
            let handle = api
                .register_android_plugin("com.langfeng.lingfanengine.assets", "AssetListPlugin")?;
            let fs_app = app.clone();
            let asset_fs = asset::AssetFs::new(
                Box::new(move |path| {
                    use tauri_plugin_fs::{FsExt, OpenOptions};
                    fs_app.fs().open(path, OpenOptions::default())
                }),
                Box::new(move |rel| {
                    handle
                        .run_mobile_plugin::<asset::AssetListResponse>(
                            "list",
                            serde_json::json!({ "path": rel }),
                        )
                        .map(|r| r.entries)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
                }),
            );
            app.manage(std::sync::Arc::new(asset_fs));
            Ok(())
        })
        .build()
}
