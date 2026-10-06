//! 资源文件系统抽象（契约 + 双适配器，「适配器只负责取」的 Rust 侧对应物）：
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

/// 区间文件包装：把 `Read`/`Seek` 的坐标原点与 EOF 一并限制在底层文件的 `[base, base + len)` 段。
///
/// 存在理由（Android 未压缩 asset）：`AssetManager.openFd` 返回的 fd 指向**整个 APK**，
/// 资产只是其中一段，区间另由 `AssetFileDescriptor.startOffset` / `length` 给出。只拿 fd
/// 会从 APK 起点读起：资源内容随即被误判为非法格式，且单次读取会把整个 APK 读入内存。
/// 桌面 std::fs 与「压缩 asset 拷贝到 cacheDir」形态均为整文件，用 `base = 0` 即可。
pub struct RangedFile<R> {
    inner: R,
    base: u64,
    len: u64,
    pos: u64,
}

impl<R: Read + Seek> RangedFile<R> {
    pub fn new(mut inner: R, base: u64, len: u64) -> std::io::Result<Self> {
        inner.seek(SeekFrom::Start(base))?;
        Ok(Self {
            inner,
            base,
            len,
            pos: 0,
        })
    }
}

impl<R: Read + Seek> Read for RangedFile<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let remaining = self.len.saturating_sub(self.pos);
        if remaining == 0 || buf.is_empty() {
            return Ok(0);
        }
        let cap = buf.len().min(remaining as usize);
        let n = self.inner.read(&mut buf[..cap])?;
        self.pos += n as u64;
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for RangedFile<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let target = match pos {
            SeekFrom::Start(n) => n as i64,
            SeekFrom::End(n) => self.len as i64 + n,
            SeekFrom::Current(n) => self.pos as i64 + n,
        };
        if target < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "区间文件 seek 到负偏移",
            ));
        }
        let target = target as u64;
        self.inner.seek(SeekFrom::Start(self.base + target))?;
        self.pos = target;
        Ok(target)
    }
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
        // 整文件 = 区间 [0, len)：走同一资源读取原语，与 Android 侧语义对齐
        let file = std::fs::File::open(path)?;
        let len = file.metadata()?.len();
        Ok(Box::new(RangedFile::new(file, 0, len)?))
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
    use super::{RangedFile, ResourceFs, SeekRead, WalkEntry};
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

    /// Kotlin `AssetListPlugin.open` 响应：fd + 资产在 fd 中的区间。
    /// `start`/`length` 缺省 = 长度未知（`AssetFileDescriptor.UNKNOWN_LENGTH`）。
    #[derive(serde::Deserialize)]
    pub struct AssetOpenResponse {
        pub fd: i32,
        #[serde(default)]
        pub start: Option<u64>,
        #[serde(default)]
        pub length: Option<u64>,
    }

    /// 经 Kotlin 插件打开 asset，包成「区间文件」（见 [`RangedFile`]）。
    ///
    /// 为什么不经 tauri-plugin-fs 打开 asset：其 Android 侧 `FsPlugin.getFileDescriptor`
    /// 只回传 `detachFd()`、丢弃 `startOffset`——未压缩 asset 的 fd 指向整个 APK，于是
    /// 读取从 APK 起点开始（资源内容因此被误判为非法格式，并会把整个 APK 读入内存）。
    pub(crate) fn open_via_plugin(
        handle: &tauri::plugin::PluginHandle<tauri::Wry>,
        path: &Path,
    ) -> io::Result<Box<dyn SeekRead>> {
        use std::os::fd::FromRawFd;
        let rel = asset_rel(path)?;
        let res = handle
            .run_mobile_plugin::<AssetOpenResponse>("open", serde_json::json!({ "path": rel }))
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("asset open 失败：{e}")))?;
        // SAFETY: fd 由 Kotlin 侧 `detachFd()` 显式移交所有权（该对象随即标记关闭），
        // 此处接管为唯一持有者；区间由插件同批回传，不再依赖裸 fd 的隐式位置。
        let file = unsafe { std::fs::File::from_raw_fd(res.fd) };
        let base = res.start.unwrap_or(0);
        let len = match res.length {
            Some(len) => len,
            // 长度未知的回退：fd 文件总长 − 起点（只可能放大到文件尾，不会越界到相邻数据）
            None => file.metadata()?.len().saturating_sub(base),
        };
        Ok(Box::new(RangedFile::new(file, base, len)?))
    }

    pub struct AssetFs {
        /// 打开 asset（自注册 Kotlin `open`：fd 与其资产区间一并回传——未压缩 asset 的 fd
        /// 指向整个 APK，只取 fd 会在 APK 起点读起，见 [`open_via_plugin`]）
        open_file: Box<dyn Fn(&Path) -> io::Result<Box<dyn SeekRead>> + Send + Sync>,
        /// 递归枚举（Kotlin AssetListPlugin；入参 = asset 根相对路径）
        list: Box<dyn Fn(&str) -> io::Result<Vec<AssetListEntry>> + Send + Sync>,
    }

    impl AssetFs {
        pub(crate) fn new(
            open_file: Box<dyn Fn(&Path) -> io::Result<Box<dyn SeekRead>> + Send + Sync>,
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
            (self.open_file)(path)
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
            let handle =
                std::sync::Arc::new(api.register_android_plugin(
                    "com.langfeng.lingfanengine.assets",
                    "AssetListPlugin",
                )?);
            let open_handle = handle.clone();
            let asset_fs = asset::AssetFs::new(
                Box::new(move |path| asset::open_via_plugin(&open_handle, path)),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// 底层「大文件」：区间只是其中一段（Android 未压缩 asset 的 fd 指向整个 APK 同形）。
    /// 区间 = [16, 32)，内容 10..26；区间外全为 0xAA，越界读取必然暴露。
    fn backing() -> Cursor<Vec<u8>> {
        let mut v = vec![0xAAu8; 64];
        for (i, b) in v[16..32].iter_mut().enumerate() {
            *b = 10 + i as u8;
        }
        Cursor::new(v)
    }

    #[test]
    fn ranged_file_read_stops_at_window_end() {
        let mut f = RangedFile::new(backing(), 16, 16).unwrap();
        let mut out = Vec::new();
        f.read_to_end(&mut out).unwrap();
        assert_eq!(
            out,
            (10u8..26).collect::<Vec<u8>>(),
            "必须只读到区间内，不得越界"
        );
    }

    #[test]
    fn ranged_file_len_is_window_len() {
        let mut f = RangedFile::new(backing(), 16, 16).unwrap();
        assert_eq!(
            seek_len(&mut f).unwrap(),
            16,
            "长度 = 区间长，而非底层文件长"
        );
        assert_eq!(f.stream_position().unwrap(), 0, "seek_len 必须还原位置");
    }

    #[test]
    fn ranged_file_seek_is_window_relative() {
        let mut f = RangedFile::new(backing(), 16, 16).unwrap();
        assert_eq!(f.seek(SeekFrom::Start(4)).unwrap(), 4);
        let mut b = [0u8; 2];
        f.read_exact(&mut b).unwrap();
        assert_eq!(b, [14, 15]);
        assert_eq!(f.seek(SeekFrom::End(-1)).unwrap(), 15);
        f.read_exact(&mut b[..1]).unwrap();
        assert_eq!(b[0], 25);
        assert_eq!(f.stream_position().unwrap(), 16);
        assert_eq!(
            f.seek(SeekFrom::Current(-1)).unwrap(),
            15,
            "Current 相对区间原点"
        );
        f.read_exact(&mut b[..1]).unwrap();
        assert_eq!(b[0], 25);
        assert_eq!(f.read(&mut b).unwrap(), 0, "区间末尾即 EOF");
        assert_eq!(f.seek(SeekFrom::Start(16)).unwrap(), 16);
        assert_eq!(f.read(&mut b).unwrap(), 0);
        assert!(f.seek(SeekFrom::Current(-17)).is_err(), "负偏移必须拒绝");
    }

    #[test]
    fn ranged_file_zero_len_asset_is_empty() {
        let mut f = RangedFile::new(backing(), 0, 0).unwrap();
        let mut out = Vec::new();
        f.read_to_end(&mut out).unwrap();
        assert!(out.is_empty());
        assert_eq!(seek_len(&mut f).unwrap(), 0);
    }

    /// 防回归锚点（`android-asset-range`）：Android asset 打开必须把「资产区间」一并取回，
    /// 且不得回退到官方 fs 插件的 asset 打开——它丢弃 `startOffset`，会让读取从 APK 起点开始。
    #[test]
    fn android_asset_open_keeps_range_handoff() {
        let kt = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/gen/android/app/src/main/java/com/langfeng/lingfanengine/assets/AssetListPlugin.kt"
        ));
        assert!(
            kt.contains("afd.startOffset"),
            "Kotlin 必须回传 AssetFileDescriptor.startOffset"
        );
        assert!(kt.contains("res.put(\"start\""), "Kotlin 必须回传区间起点");
        assert!(kt.contains("res.put(\"length\""), "Kotlin 必须回传区间长度");
        let rs = include_str!("resource_fs.rs");
        // 断言串拆开拼接：否则会匹配到本测试自身的字面量
        assert_eq!(
            rs.matches(concat!("from_", "raw_fd")).count(),
            1,
            "asset fd 接管应是唯一一处（open_via_plugin）"
        );
        assert!(
            !rs.contains(concat!("fs()", ".open(")),
            "asset 打开不得回退到官方 fs 插件（其丢弃 startOffset）"
        );
    }
}
