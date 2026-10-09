//! 条目结构：中央目录记录的投影，以及本地文件头的校验与偏移计算。

use crate::fs::SeekRead;
use crate::zip_index::error::ZipIndexError;
use std::io::SeekFrom;

/// 本地文件头签名（`PK\x03\x04`）：读条目数据前先验它，防目录记录与本地头错位。
pub(crate) const LOCAL_MAGIC: u32 = 0x0403_4b50; // "PK\x03\x04"

const LOCAL_HEADER_LEN: usize = 30;

/// 单个条目（中央目录记录的投影）。
#[derive(Debug, Clone)]
pub struct ZipEntry {
    /// 条目全名（目录条目以 `/` 结尾；UTF-8 标志缺失时按有损解码，命名源为本应用自身）。
    pub name: String,
    /// 压缩方法（[`METHOD_STORED`] / [`METHOD_DEFLATED`]，其余值读取时拒绝）。
    pub method: u16,
    /// 压缩后字节数（Stored = 未压缩字节数）。
    pub compressed_size: u64,
    /// 解压后字节数。
    pub uncompressed_size: u64,
    /// 本地文件头在文件中的偏移（读取前再校验一次头部与名称）。
    pub(crate) local_header_offset: u64,
    /// 目录条目（名称以 `/` 结尾）。
    pub is_dir: bool,
}

/// 校验本地文件头并给出数据区起始偏移。
/// 中央目录声明的名称在此处与本地头逐一比对——两处不一致说明文件被动过，拒绝读取。
pub(crate) fn entry_data_offset(r: &mut dyn SeekRead, entry: &ZipEntry) -> Result<u64, ZipIndexError> {
    r.seek(SeekFrom::Start(entry.local_header_offset))?;
    let mut header = [0u8; LOCAL_HEADER_LEN];
    r.read_exact(&mut header)?;
    if le32(&header) != LOCAL_MAGIC {
        return Err(ZipIndexError::BadSignature {
            at: entry.local_header_offset,
            kind: "本地文件头",
        });
    }
    let name_len = le16(&header[26..]) as usize;
    let extra_len = le16(&header[28..]) as usize;
    let mut name = vec![0u8; name_len];
    r.read_exact(&mut name)?;
    if name != entry.name.as_bytes() {
        return Err(ZipIndexError::LocalHeaderMismatch {
            entry: entry.name.clone(),
        });
    }
    Ok(entry.local_header_offset + LOCAL_HEADER_LEN as u64 + name_len as u64 + extra_len as u64)
}

/// 小端读 4 字节。
pub(crate) fn le32(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

/// 小端读 2 字节。
pub(crate) fn le16(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}
