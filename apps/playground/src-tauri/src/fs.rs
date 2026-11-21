//! 文件读取原语（通用底座）：可 seek 的读取抽象与「文件内区间」包装。
//!
//! 本模块只描述**字节来源的形状**，不含任何资源/加密语义——桌面整文件、Android APK 内
//! 区间、加密资源分块链都建立在这一层之上。原子写（tmp+rename）亦属通用文件卫生，
//! 无加密语义，故落此层供存档/高水位/偏好/持久化共用（单一声明）。

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

/// 同目录唯一临时文件路径（隐藏前缀 + 进程 id + 进程内序号，避免并发碰撞）。
fn unique_tmp_path(path: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    path.with_file_name(format!(".{name}.tmp-{}-{n}", std::process::id()))
}

/// 原子写（单一声明）：同目录唯一临时文件写入后 `rename` 覆盖目标——
/// 崩溃/断电不留半档（rename 是原子操作，目标要么旧内容要么新内容）。
/// 供存档/高水位/偏好/持久化共用，禁各写一份。失败清理临时文件，目标保持原样（fail-closed）。
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = unique_tmp_path(path);
    let result = (|| {
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
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
    /// 以 `[base, base + len)` 定位底层文件的区间段（构造即定位到区间起点）。
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
        // 上界同样收紧：seek 到 len（EOF）合法（read 返 0），越过 len 拒绝——
        // 区间坐标不外溢到底层文件的其它段（卫生护栏）。
        if target > self.len as i64 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "区间文件 seek 超出区间长度",
            ));
        }
        let target = target as u64;
        self.inner.seek(SeekFrom::Start(self.base + target))?;
        self.pos = target;
        Ok(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// 区间 [4, 12)（base=4, len=8）建立在 16 字节底层文件上。
    fn ranged() -> RangedFile<Cursor<Vec<u8>>> {
        RangedFile::new(Cursor::new(vec![7u8; 16]), 4, 8).expect("区间构造")
    }

    #[test]
    fn ranged_file_seek_rejects_past_len() {
        let mut f = ranged();
        // Start 越过 len、End 正偏移越界、Current 越界——一律拒绝（坐标不外溢）。
        assert!(f.seek(SeekFrom::Start(9)).is_err());
        assert!(f.seek(SeekFrom::End(1)).is_err());
        f.seek(SeekFrom::Start(8)).unwrap();
        assert!(f.seek(SeekFrom::Current(1)).is_err());
    }

    #[test]
    fn ranged_file_seek_to_len_is_eof_and_read_returns_zero() {
        let mut f = ranged();
        // seek 到 len（EOF）合法：返回 len，再 read 返 0。
        assert_eq!(f.seek(SeekFrom::Start(8)).unwrap(), 8);
        assert_eq!(f.seek(SeekFrom::End(0)).unwrap(), 8);
        let mut buf = [0u8; 4];
        assert_eq!(f.read(&mut buf).unwrap(), 0);
    }

    #[test]
    fn ranged_file_seek_negative_rejected() {
        let mut f = ranged();
        assert!(f.seek(SeekFrom::End(-9)).is_err());
        assert!(f.seek(SeekFrom::Start(0)).is_ok());
        assert!(f.seek(SeekFrom::Current(-1)).is_err());
    }

    #[test]
    fn ranged_file_read_is_bounded_to_segment() {
        let mut f = ranged();
        let mut buf = [0u8; 32];
        // 底层有 16 字节，但区间只有 8 字节——read 至多吐 8 字节即 EOF。
        assert_eq!(f.read(&mut buf).unwrap(), 8);
        assert_eq!(f.read(&mut buf).unwrap(), 0);
    }
}
