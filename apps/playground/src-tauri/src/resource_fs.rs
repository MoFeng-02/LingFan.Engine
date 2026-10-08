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

/// asset 协议前缀（tauri-utils::platform::ANDROID_ASSET_PROTOCOL_URI_PREFIX 同值；
/// 不直接引用该常量是因为它仅 android cfg 可见，此处同源维护）。
#[cfg(target_os = "android")]
const ASSET_URI_PREFIX: &str = "asset://localhost/";

/// asset 路径 → 协议内相对段（`asset://localhost/Resources/x` → `Resources/x`）。
#[cfg(target_os = "android")]
fn asset_rel(path: &Path) -> std::io::Result<String> {
    let s = path.to_string_lossy();
    if let Some(rel) = s.strip_prefix(ASSET_URI_PREFIX) {
        Ok(rel.to_string())
    } else if s.as_ref() == ASSET_URI_PREFIX.trim_end_matches('/') {
        Ok(String::new())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("非 asset 协议路径：{s}"),
        ))
    }
}

// —— Android：安装包 ZIP 直读（不经 AssetManager）——

#[cfg(target_os = "android")]
mod apkzip {
    use super::{asset_rel, RangedFile, ResourceFs, SeekRead, WalkEntry, ASSET_URI_PREFIX};
    use crate::zip_index::{ZipIndex, METHOD_DEFLATED, METHOD_STORED};
    use std::io;
    use std::path::{Path, PathBuf};

    /// APK 内 asset 条目的公共前缀（tauri 把 `bundle.resources` 拷入打包产物的 assets/ 之下）。
    const APK_ENTRY_PREFIX: &str = "assets/";
    /// Deflated 条目解压进内存的长度上限：媒体经 `noCompress` 恒为未压缩条目，
    /// Deflated 只应出现在明文小文本上；超限说明打包形态异常，拒绝读取。
    const DEFLATED_LIMIT: u64 = 32 * 1024 * 1024;

    /// 安装包（ZIP）直读的 Android 资源文件系统：
    /// 启动期解析一次中央目录建索引，读取为「安装包内区间」（未压缩条目）或
    /// 「解压缓存」（压缩条目，有长度上限）。条目缺失一律报错——资源随安装包不可变，
    /// 静默降级只会把「文件缺失」放大成「内容错误」。
    pub struct ApkZipFs {
        apk_path: PathBuf,
        index: ZipIndex,
    }

    impl ApkZipFs {
        /// 定位安装包并构建条目索引（setup 期一次性调用）。
        pub fn create() -> Result<Self, String> {
            let apk_path = apk_path_via_jni()?;
            let mut file = std::fs::File::open(&apk_path)
                .map_err(|e| format!("安装包打开失败（{}）：{e}", apk_path.display()))?;
            let index =
                ZipIndex::read_from(&mut file).map_err(|e| format!("安装包条目索引构建失败：{e}"))?;
            Ok(Self { apk_path, index })
        }

        fn apk_file(&self) -> io::Result<std::fs::File> {
            std::fs::File::open(&self.apk_path)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("安装包打开失败：{e}")))
        }

        /// 资源根内相对路径（`Resources/…`）→ ZIP 条目名（`assets/…`）。
        fn entry_name(rel: &str) -> String {
            format!("{APK_ENTRY_PREFIX}{rel}")
        }

        /// 条目存在性（`Some(is_dir)`）；显式目录条目与「有子条目」都判目录。
        fn lookup(&self, rel: &str) -> Option<bool> {
            self.index.kind_of(&Self::entry_name(rel))
        }

        /// 打开为可 seek 读取流（v2 分块按需解密依赖 seek）。
        /// 未压缩条目 = 安装包内区间；压缩条目 = 解压入内存（超上限 fail-closed）。
        fn open_entry(&self, rel: &str) -> io::Result<Box<dyn SeekRead>> {
            let entry_name = Self::entry_name(rel);
            let entry = self
                .index
                .get(&entry_name)
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("资源不存在：{rel}")))?;
            match entry.method {
                METHOD_STORED => {
                    let mut apk = self.apk_file()?;
                    let offset = self
                        .index
                        .data_offset(&mut apk, &entry_name)
                        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
                    Ok(Box::new(RangedFile::new(apk, offset, entry.uncompressed_size)?))
                }
                METHOD_DEFLATED => {
                    if entry.uncompressed_size > DEFLATED_LIMIT {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            format!(
                                "压缩条目超出解压上限（{rel}，{} 字节）",
                                entry.uncompressed_size
                            ),
                        ));
                    }
                    let mut apk = self.apk_file()?;
                    let data = self
                        .index
                        .read_entry(&mut apk, &entry_name)
                        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
                    Ok(Box::new(std::io::Cursor::new(data)))
                }
                other => Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("条目压缩方法不支持（{rel}，method={other}）"),
                )),
            }
        }
    }

    impl ResourceFs for ApkZipFs {
        fn is_file(&self, path: &Path) -> bool {
            asset_rel(path).ok().is_some_and(|rel| self.lookup(&rel) == Some(false))
        }

        fn is_dir(&self, path: &Path) -> bool {
            asset_rel(path).ok().is_some_and(|rel| self.lookup(&rel) == Some(true))
        }

        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            let rel = asset_rel(path)?;
            let mut apk = self.apk_file()?;
            self.index
                .read_entry(&mut apk, &Self::entry_name(&rel))
                .map_err(|e| io::Error::new(e.io_kind(), e.to_string()))
        }

        fn open(&self, path: &Path) -> io::Result<Box<dyn SeekRead>> {
            let rel = asset_rel(path)?;
            self.open_entry(&rel)
        }

        fn walk(&self, dir: &Path) -> io::Result<Vec<WalkEntry>> {
            let rel = asset_rel(dir)?;
            let zip_prefix = Self::entry_name(&format!("{rel}/"));
            Ok(self
                .index
                .walk_synthesizing_dirs(&zip_prefix)
                .into_iter()
                .map(|(name, is_dir)| {
                    // 条目名 `assets/<P>` → 协议路径 `asset://localhost/<P>`
                    let logical = name.strip_prefix(APK_ENTRY_PREFIX).unwrap_or(&name);
                    WalkEntry {
                        path: PathBuf::from(format!("{ASSET_URI_PREFIX}{logical}")),
                        is_dir,
                    }
                })
                .collect())
        }
    }

    /// 从 Android 上下文读取安装包路径（`ApplicationInfo.sourceDir`，即 base.apk）。
    /// 运行时（tao）在 activity 建立时已把「application context + JavaVM」存入
    /// `ndk_context`，任意 Rust 线程都能附着取用——不经主线程、不依赖 WebView。
    fn apk_path_via_jni() -> Result<PathBuf, String> {
        // SAFETY：指针由 tauri 运行时在 activity 建立期写入（tao ndk_glue），
        // 指向全局引用的 application context，进程存活期内有效。
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("JavaVM 获取失败：{e}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("JNI 线程附着失败：{e}"))?;
        // SAFETY：同上，context 为 tao 持有的全局引用。
        let context = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
        let app_info = env
            .call_method(
                &context,
                "getApplicationInfo",
                "()Landroid/content/pm/ApplicationInfo;",
                &[],
            )
            .and_then(|v| v.l())
            .map_err(|e| format!("getApplicationInfo 失败：{e}"))?;
        let source = env
            .get_field(&app_info, "sourceDir", "Ljava/lang/String;")
            .and_then(|v| v.l())
            .map_err(|e| format!("sourceDir 读取失败：{e}"))?;
        let source_dir: String = env
            .get_string(&source.into())
            .map_err(|e| format!("sourceDir 转换失败：{e}"))?
            .into();
        Ok(PathBuf::from(source_dir))
    }
}

#[cfg(target_os = "android")]
pub use apkzip::ApkZipFs;

/// 按平台取资源文件系统适配器（组合根语义：命令面只依赖契约，不关心实现）。
/// Android = [`ApkZipFs`]（安装包 ZIP 直读，唯一通道）；其余平台 = [`StdFs`]。
pub fn resource_fs(app: &tauri::AppHandle) -> std::sync::Arc<dyn ResourceFs> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<std::sync::Arc<apkzip::ApkZipFs>>()
            .inner()
            .clone()
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        std::sync::Arc::new(StdFs)
    }
}

/// 注册 Kotlin `AssetListPlugin` 并装配 [`AssetFs`]（Android 专用 tauri 插件）。
/// 桌面构建无此插件——命令面经 [`resource_fs`] 拿到的是 `StdFs`，同一契约。
/// APK-ZIP 供给适配器：setup 期定位安装包并构建条目索引（一次性），常驻管理状态。
/// 索引构建失败 = 供给链不可用，启动即失败（错误信息可直接定位是哪一步、哪个文件）。
#[cfg(target_os = "android")]
pub fn apk_zip_fs_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri::Manager;
    tauri::plugin::Builder::<tauri::Wry>::new("lfen-apkzip")
        .setup(|app, _api| {
            let fs = apkzip::ApkZipFs::create()?;
            app.manage(std::sync::Arc::new(fs));
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

    /// 防回归（`no-self-maintained-kotlin-plugin`）：`gen/android` 下不得再出现自维护 Kotlin
    /// 插件。历史形态是「Rust 契约 + Kotlin 实现」成对演进——两侧字符串契约靠 `bridge_check`
    /// 互锁，一旦有人只改一侧就静默失配。现供给与方向都收进 Rust（APK-ZIP 直读 + JNI 直调），
    /// 该形态不应回流：这条守卫在有人重新引入时立刻变红。
    #[test]
    fn no_self_maintained_kotlin_plugin_in_gen() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/gen/android/app/src/main/java");
        // 自维护插件的历史包路径：assets/（枚举+打开）与 shell/（方向）
        for legacy in ["com/langfeng/lingfanengine/assets", "com/langfeng/lingfanengine/shell"] {
            let dir = format!("{root}/{legacy}");
            assert!(
                !std::path::Path::new(&dir).exists(),
                "自维护 Kotlin 插件目录不应存在：{dir}（供给与方向已收进 Rust）"
            );
        }
        // Rust 侧也不得再出现「注册 Android 插件」的调用面
        let rs = include_str!("resource_fs.rs");
        assert!(
            !rs.contains(concat!("register_", "android_plugin")),
            "Rust 侧不应再注册自维护 Android 插件"
        );
    }
}
