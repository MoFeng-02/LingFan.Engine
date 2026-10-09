//! 资源文件系统契约：只读取 + 枚举的接口与遍历条目。

use crate::resource_fs::SeekRead;
use std::path::Path;
use std::path::PathBuf;

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
