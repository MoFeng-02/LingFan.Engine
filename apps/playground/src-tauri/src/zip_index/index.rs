//! ZIP 中央目录索引：构建、定位、枚举与条目读取。

use crate::fs::SeekRead;
use crate::zip_index::entry::{ZipEntry, entry_data_offset, le16, le32};
use crate::zip_index::error::{ZipIndexError};
use std::collections::BTreeMap;
use std::io::Read;
use std::io::SeekFrom;

/// 压缩方法：未压缩（原始字节直读）。
pub const METHOD_STORED: u16 = 0;

/// 压缩方法：DEFLATE（RFC 1951）。
pub const METHOD_DEFLATED: u16 = 8;

/// EOCD 记录签名（中央目录结尾，`PK\x05\x06`）：从文件尾向前扫到它才能定位目录。
pub(crate) const EOCD_MAGIC: u32 = 0x0605_4b50; // "PK\x05\x06"

/// 中央目录文件头签名（`PK\x01\x02`）：逐条解析目录时的格式校验点。
pub(crate) const CENTRAL_MAGIC: u32 = 0x0201_4b50; // "PK\x01\x02"

const EOCD_LEN: usize = 22;

const CENTRAL_HEADER_LEN: usize = 46;

/// EOCD 定位扫描的尾部窗口：注释上限 65535 字节 + EOCD 本体 22 字节。
const EOCD_TAIL_WINDOW: usize = 65_557;

/// 32 位字段的哨兵值：EOCD 里出现它即表示真实值在 ZIP64 扩展记录中，本实现不支持。
pub(crate) const U32_MAX: u32 = 0xFFFF_FFFF;

/// 全量条目索引。键 = 条目名，排序确定性（BTreeMap）。
#[derive(Debug)]
pub struct ZipIndex {
    entries: BTreeMap<String, ZipEntry>,
}

impl ZipIndex {
    /// 从任意 `Read + Seek` 载体（内存游标 / 安装包文件）构建索引。
    pub fn read_from(r: &mut dyn SeekRead) -> Result<Self, ZipIndexError> {
        let (total_entries, cd_offset, cd_size) = Self::locate_eocd(r)?;
        let file_len = r.seek(SeekFrom::End(0))?;
        if cd_offset
            .checked_add(cd_size)
            .is_none_or(|end| end > file_len)
        {
            return Err(ZipIndexError::CentralDirectoryOutOfBounds {
                offset: cd_offset,
                size: cd_size,
            });
        }
        r.seek(SeekFrom::Start(cd_offset))?;
        let mut directory = vec![0u8; cd_size as usize];
        r.read_exact(&mut directory)?;

        let mut entries = BTreeMap::new();
        let mut pos = 0usize;
        for _ in 0..total_entries {
            if pos + CENTRAL_HEADER_LEN > directory.len() {
                return Err(ZipIndexError::CentralDirectoryTruncated);
            }
            let record = &directory[pos..];
            if le32(record) != CENTRAL_MAGIC {
                return Err(ZipIndexError::BadSignature {
                    at: cd_offset + pos as u64,
                    kind: "中央目录记录",
                });
            }
            let method = le16(&record[10..]);
            let compressed_size = le32(&record[20..]);
            let uncompressed_size = le32(&record[24..]);
            let name_len = le16(&record[28..]) as usize;
            let extra_len = le16(&record[30..]) as usize;
            let comment_len = le16(&record[32..]) as usize;
            let local_header_offset = le32(&record[42..]);
            let name_end = pos + CENTRAL_HEADER_LEN + name_len;
            if name_end > directory.len() {
                return Err(ZipIndexError::CentralDirectoryTruncated);
            }
            let name = String::from_utf8_lossy(&directory[pos + CENTRAL_HEADER_LEN..name_end])
                .into_owned();
            if compressed_size == U32_MAX
                || uncompressed_size == U32_MAX
                || local_header_offset == U32_MAX
            {
                return Err(ZipIndexError::Zip64Unsupported {
                    entry: name,
                });
            }
            // 同名条目保留先出现者（见模块注释的防御性口径）。
            entries.entry(name.clone()).or_insert_with(|| ZipEntry {
                is_dir: name.ends_with('/'),
                name,
                method,
                compressed_size: compressed_size as u64,
                uncompressed_size: uncompressed_size as u64,
                local_header_offset: local_header_offset as u64,
            });
            pos = name_end + extra_len + comment_len;
        }
        Ok(Self { entries })
    }

    /// 在文件尾部窗口内定位 EOCD：从末尾向前扫描，取第一条
    /// 「签名相符且注释长度与剩余字节数自洽」的记录（注释内的伪造签名会因
    /// 长度不自洽被跳过）。
    fn locate_eocd(r: &mut dyn SeekRead) -> Result<(u64, u64, u64), ZipIndexError> {
        let file_len = r.seek(SeekFrom::End(0))?;
        if file_len < EOCD_LEN as u64 {
            return Err(ZipIndexError::EocdNotFound);
        }
        let window = EOCD_TAIL_WINDOW.min(file_len as usize);
        r.seek(SeekFrom::End(-(window as i64)))?;
        let mut tail = vec![0u8; window];
        r.read_exact(&mut tail)?;

        for start in (0..=tail.len() - EOCD_LEN).rev() {
            if le32(&tail[start..]) != EOCD_MAGIC {
                continue;
            }
            let comment_len = le16(&tail[start + 20..]) as usize;
            if start + EOCD_LEN + comment_len != tail.len() {
                continue;
            }
            let disk_number = le16(&tail[start + 4..]);
            let directory_disk = le16(&tail[start + 6..]);
            if disk_number != 0 || directory_disk != 0 {
                return Err(ZipIndexError::UnsupportedArchive {
                    reason: "多卷归档".into(),
                });
            }
            let total_entries = le16(&tail[start + 10..]) as u64;
            let directory_size = le32(&tail[start + 12..]) as u64;
            let directory_offset = le32(&tail[start + 16..]) as u64;
            if total_entries == 0xFFFF
                || directory_size == U32_MAX as u64
                || directory_offset == U32_MAX as u64
            {
                return Err(ZipIndexError::Zip64Unsupported {
                    entry: "(归档级 EOCD)".into(),
                });
            }
            return Ok((total_entries, directory_offset, directory_size));
        }
        Err(ZipIndexError::EocdNotFound)
    }

    /// 条目总数（含目录条目）。
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// 索引是否为空；`len` 的配套方法（clippy 要求成对提供）。
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// 按名称取条目。
    pub fn get(&self, name: &str) -> Option<&ZipEntry> {
        self.entries.get(name)
    }

    /// 前缀范围内的全部条目（含目录条目；排序 = 条目名字典序）。
    /// `prefix` 以 `/` 结尾时取其子树；空前缀 = 全部条目。
    pub fn walk_prefix(&self, prefix: &str) -> Vec<&ZipEntry> {
        self.entries
            .iter()
            .skip_while(|(name, _)| !name.starts_with(prefix))
            .take_while(|(name, _)| name.starts_with(prefix))
            .map(|(_, entry)| entry)
            .collect()
    }

    /// 条目种类（`Some(is_dir)`）；不存在 = `None`。
    /// 显式目录条目与「存在以该名为前缀的子条目」都判为目录——后者覆盖
    /// 打包工具不为目录生成独立条目的常见形态。
    pub fn kind_of(&self, name: &str) -> Option<bool> {
        if let Some(entry) = self.entries.get(name) {
            return Some(entry.is_dir);
        }
        let mut with_slash = name.to_string();
        if !with_slash.ends_with('/') {
            with_slash.push('/');
        }
        let first = self.entries.range(with_slash.clone()..).next()?;
        if first.0.starts_with(&with_slash) {
            Some(true)
        } else {
            None
        }
    }

    /// 前缀子树枚举：返回 `(条目名, 是否目录)`。与「只列直接子项再递归下钻」的
    /// 目录遍历语义对齐——不含前缀目录本身；缺失的中间目录补合成（树保持连通）；
    /// 显式目录条目与合成结果按名去重。顺序 = 条目名字典序。
    pub fn walk_synthesizing_dirs(&self, prefix: &str) -> Vec<(String, bool)> {
        let mut out: Vec<(String, bool)> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (name, entry) in self.entries.range(prefix.to_string()..) {
            if !name.starts_with(prefix) {
                break;
            }
            let rest = &name[prefix.len()..];
            for (i, b) in rest.bytes().enumerate() {
                if b == b'/' {
                    let dir = format!("{prefix}{}", &rest[..=i]);
                    if seen.insert(dir.clone()) {
                        out.push((dir, true));
                    }
                }
            }
            if seen.insert(name.clone()) {
                out.push((name.clone(), entry.is_dir));
            }
        }
        out
    }

    /// 条目数据区在载体中的绝对偏移（读取前校验本地文件头签名与名称）。
    pub fn data_offset(
        &self,
        r: &mut dyn SeekRead,
        name: &str,
    ) -> Result<u64, ZipIndexError> {
        let entry = self
            .entries
            .get(name)
            .ok_or_else(|| ZipIndexError::EntryNotFound {
                name: name.to_string(),
            })?;
        entry_data_offset(r, entry)
    }

    /// 读取并解出条目内容（Stored 原样区间读；Deflated 解压到声明长度）。
    pub fn read_entry(&self, r: &mut dyn SeekRead, name: &str) -> Result<Vec<u8>, ZipIndexError> {
        let entry = self
            .entries
            .get(name)
            .ok_or_else(|| ZipIndexError::EntryNotFound {
                name: name.to_string(),
            })?;
        if entry.is_dir {
            return Err(ZipIndexError::EntryNotFound {
                name: name.to_string(),
            });
        }
        let data_offset = entry_data_offset(r, entry)?;
        r.seek(SeekFrom::Start(data_offset))?;
        match entry.method {
            METHOD_STORED => {
                let mut buf = vec![0u8; entry.uncompressed_size as usize];
                r.read_exact(&mut buf)?;
                Ok(buf)
            }
            METHOD_DEFLATED => {
                let mut compressed = vec![0u8; entry.compressed_size as usize];
                r.read_exact(&mut compressed)?;
                let mut out = vec![0u8; entry.uncompressed_size as usize];
                flate2::read::DeflateDecoder::new(&compressed[..]).read_exact(&mut out)?;
                Ok(out)
            }
            other => Err(ZipIndexError::UnsupportedMethod {
                entry: entry.name.clone(),
                method: other,
            }),
        }
    }
}
