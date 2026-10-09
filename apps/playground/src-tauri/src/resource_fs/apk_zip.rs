//! Android 适配器：安装包 ZIP 直读，条目索引在启动期构建一次。

use crate::resource_fs::contract::{ResourceFs, WalkEntry};
use crate::resource_fs::{RangedFile, SeekRead};

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
