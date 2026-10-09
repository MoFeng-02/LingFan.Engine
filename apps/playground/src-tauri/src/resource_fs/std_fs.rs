//! 桌面 / dev 适配器：真实文件系统（std::fs）。

use crate::resource_fs::contract::{ResourceFs, WalkEntry};
use crate::resource_fs::{RangedFile, SeekRead};
use std::path::Path;

/// 桌面 / dev 适配器：直接读真实文件系统。
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
