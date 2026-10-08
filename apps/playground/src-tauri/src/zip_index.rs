//! ZIP（APK）条目索引：枚举与读取的最小解析器。
//!
//! Android 安装包是 ZIP 容器，资源以 `assets/` 前缀条目存放。相比经 AssetManager
//! 的读取通道，直接解析 ZIP 中央目录可以一次拿到全量条目表，并且对未压缩条目
//! 的读取退化为「文件内区间读」——与桌面整文件读取共用同一 `RangedFile` 原语。
//!
//! 支持范围（显式边界，越界一律报错而非猜测）：
//! - 压缩方法仅 Stored（0）与 Deflated（8）；其余方法可在索引中列出，读取时拒绝；
//! - 不支持 ZIP64（4GB 边界字段出现即报错）——本应用的安装包体量远小于该边界；
//! - 不支持多卷（multi-disk）归档；
//! - 不校验 CRC32：媒体完整性由加密认证（AES-GCM tag）兜底，文本由下游格式校验兜底；
//! - 同名条目保留先出现者（APK 内不应出现，防御性口径）。
//!
//! 全部输入来自 [`std::io::Read + std::io::Seek`]，与具体文件载体无关（桌面测试
//! 用内存游标，运行期传入安装包文件句柄）。

use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Seek, SeekFrom};

/// 压缩方法：未压缩（原始字节直读）。
pub const METHOD_STORED: u16 = 0;
/// 压缩方法：DEFLATE（RFC 1951）。
pub const METHOD_DEFLATED: u16 = 8;

const EOCD_MAGIC: u32 = 0x0605_4b50; // "PK\x05\x06"
const CENTRAL_MAGIC: u32 = 0x0201_4b50; // "PK\x01\x02"
const LOCAL_MAGIC: u32 = 0x0403_4b50; // "PK\x03\x04"
const EOCD_LEN: usize = 22;
const LOCAL_HEADER_LEN: usize = 30;
const CENTRAL_HEADER_LEN: usize = 46;
/// EOCD 定位扫描的尾部窗口：注释上限 65535 字节 + EOCD 本体 22 字节。
const EOCD_TAIL_WINDOW: usize = 65_557;
const U32_MAX: u32 = 0xFFFF_FFFF;

/// 索引与读取过程中的失败（全部 fail-closed，错误信息带定位）。
#[derive(Debug)]
pub enum ZipIndexError {
    Io(std::io::Error),
    /// 尾部窗口内找不到结构合法的 EOCD（文件被截断或不是 ZIP）。
    EocdNotFound,
    /// 出现 ZIP64 边界字段（4GB 级字段超出本解析器支持范围）。
    Zip64Unsupported { entry: String },
    /// 中央目录位置或长度超出文件范围。
    CentralDirectoryOutOfBounds { offset: u64, size: u64 },
    /// 声明的条目数在中央目录内放不下（目录被截断）。
    CentralDirectoryTruncated,
    /// 签名不符（`at` = 文件偏移，`kind` = 期望的记录类型）。
    BadSignature { at: u64, kind: &'static str },
    /// 本地文件头与中央目录记录不一致（名称或布局漂移）。
    LocalHeaderMismatch { entry: String },
    /// 条目不存在。
    EntryNotFound { name: String },
    /// 条目压缩方法不在支持范围。
    UnsupportedMethod { entry: String, method: u16 },
    /// 归档形态不支持（多卷等）。
    UnsupportedArchive { reason: String },
}

impl fmt::Display for ZipIndexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "ZIP 读取失败：{e}"),
            Self::EocdNotFound => {
                write!(f, "ZIP 目录结尾（EOCD）未找到：文件被截断或不是 ZIP 格式")
            }
            Self::Zip64Unsupported { entry } => write!(
                f,
                "ZIP64 条目超出支持范围（{entry}）：安装包体量超出本实现的 4GB 边界"
            ),
            Self::CentralDirectoryOutOfBounds { offset, size } => {
                write!(f, "ZIP 中央目录位置越界：offset={offset} size={size}")
            }
            Self::CentralDirectoryTruncated => {
                write!(f, "ZIP 中央目录被截断：声明的条目数超出目录实际长度")
            }
            Self::BadSignature { at, kind } => {
                write!(f, "ZIP 签名不符（{kind}，偏移 {at}）：数据损坏或非 ZIP 格式")
            }
            Self::LocalHeaderMismatch { entry } => {
                write!(f, "ZIP 本地文件头与中央目录不一致：{entry}")
            }
            Self::EntryNotFound { name } => write!(f, "ZIP 条目不存在：{name}"),
            Self::UnsupportedMethod { entry, method } => {
                write!(f, "ZIP 条目压缩方法不支持（{entry}，method={method}）")
            }
            Self::UnsupportedArchive { reason } => write!(f, "ZIP 归档形态不支持：{reason}"),
        }
    }
}

impl std::error::Error for ZipIndexError {}

impl ZipIndexError {
    /// 映射到 `io::ErrorKind`（调用方转 `io::Error` 时保留语义：缺失 = NotFound）。
    pub fn io_kind(&self) -> std::io::ErrorKind {
        match self {
            Self::EntryNotFound { .. } => std::io::ErrorKind::NotFound,
            _ => std::io::ErrorKind::Other,
        }
    }
}

impl From<std::io::Error> for ZipIndexError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

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
    local_header_offset: u64,
    /// 目录条目（名称以 `/` 结尾）。
    pub is_dir: bool,
}

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

    pub fn len(&self) -> usize {
        self.entries.len()
    }

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

/// 校验本地文件头并给出数据区起始偏移。
/// 中央目录声明的名称在此处与本地头逐一比对——两处不一致说明文件被动过，拒绝读取。
fn entry_data_offset(r: &mut dyn SeekRead, entry: &ZipEntry) -> Result<u64, ZipIndexError> {
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

/// 本模块内消费的 Read + Seek 组合别名（与 resource_fs 的 SeekRead 同形状，避免跨模块依赖）。
pub trait SeekRead: Read + Seek {}
impl<T: Read + Seek> SeekRead for T {}

fn le32(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

fn le16(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    // —— fixture 构造（测试内自建 ZIP 写入端，覆盖 Stored 与 Deflated）——

    fn deflate(data: &[u8]) -> Vec<u8> {
        use std::io::Write;
        let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    struct FixtureEntry {
        name: String,
        method: u16,
        data: Vec<u8>,
    }

    fn entry(name: &str, data: &[u8]) -> FixtureEntry {
        FixtureEntry {
            name: name.to_string(),
            method: METHOD_STORED,
            data: data.to_vec(),
        }
    }

    fn deflated(name: &str, data: &[u8]) -> FixtureEntry {
        FixtureEntry {
            name: name.to_string(),
            method: METHOD_DEFLATED,
            data: data.to_vec(),
        }
    }

    fn build_zip(entries: &[FixtureEntry], trailing_comment: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = Vec::new();
        let mut central: Vec<u8> = Vec::new();
        let count = entries.len() as u16;
        for e in entries {
            let local_offset = out.len() as u32;
            let payload = match e.method {
                METHOD_DEFLATED => deflate(&e.data),
                _ => e.data.clone(),
            };
            out.extend_from_slice(&LOCAL_MAGIC.to_le_bytes());
            out.extend_from_slice(&20u16.to_le_bytes()); // version needed
            out.extend_from_slice(&0x0800u16.to_le_bytes()); // flags: UTF-8 名称
            out.extend_from_slice(&e.method.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // time
            out.extend_from_slice(&0u16.to_le_bytes()); // date
            out.extend_from_slice(&0u32.to_le_bytes()); // crc（本解析器不校验）
            out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            out.extend_from_slice(&(e.data.len() as u32).to_le_bytes());
            out.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // extra
            out.extend_from_slice(e.name.as_bytes());
            out.extend_from_slice(&payload);

            central.extend_from_slice(&CENTRAL_MAGIC.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes()); // version made
            central.extend_from_slice(&20u16.to_le_bytes()); // version needed
            central.extend_from_slice(&0x0800u16.to_le_bytes()); // flags
            central.extend_from_slice(&e.method.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes()); // time
            central.extend_from_slice(&0u16.to_le_bytes()); // date
            central.extend_from_slice(&0u32.to_le_bytes()); // crc
            central.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            central.extend_from_slice(&(e.data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes()); // extra
            central.extend_from_slice(&0u16.to_le_bytes()); // comment
            central.extend_from_slice(&0u16.to_le_bytes()); // disk start
            central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
            central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
            central.extend_from_slice(&local_offset.to_le_bytes());
            central.extend_from_slice(e.name.as_bytes());
        }
        let central_offset = out.len() as u32;
        let central_size = central.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(&EOCD_MAGIC.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // disk
        out.extend_from_slice(&0u16.to_le_bytes()); // central dir disk
        out.extend_from_slice(&count.to_le_bytes()); // 本卷条目数
        out.extend_from_slice(&count.to_le_bytes()); // 总条目数
        out.extend_from_slice(&central_size.to_le_bytes());
        out.extend_from_slice(&central_offset.to_le_bytes());
        out.extend_from_slice(&(trailing_comment.len() as u16).to_le_bytes());
        out.extend_from_slice(trailing_comment);
        out
    }

    fn index_of(bytes: Vec<u8>) -> ZipIndex {
        let mut cursor = Cursor::new(bytes);
        ZipIndex::read_from(&mut cursor).unwrap_or_else(|e| panic!("索引构建失败：{e}"))
    }

    // —— 拟态旅程：混合条目的全量枚举与逐字节读取 ——

    #[test]
    fn zip_index_fixture_journey_byte_exact() {
        let media: Vec<u8> = (0..64 * 1024u32).map(|i| (i % 251) as u8).collect();
        let source = vec![
            entry("assets/Resources/Stories/start.json", br#"{"formatVersion":1}"#),
            deflated(
                "assets/Resources/Lang/en/main.json",
                "{\"key\":\"值 {var}\"}".as_bytes(),
            ),
            entry("assets/Resources/Audio/bgm.mp3", &media),
            entry("assets/Resources/dir/", b""),
            FixtureEntry {
                name: "assets/Resources/Lang/ja/日本語.json".into(),
                method: METHOD_STORED,
                data: b"{}".to_vec(),
            },
        ];
        let bytes = build_zip(&source, b"builder comment");
        let index = index_of(bytes.clone());
        assert_eq!(index.len(), source.len());

        // 枚举顺序 = 条目名字典序；walk_prefix 空前缀 = 全量
        let all = index.walk_prefix("");
        assert_eq!(all.len(), source.len());
        assert!(all.windows(2).all(|w| w[0].name < w[1].name));

        // 逐条目读取与源数据逐字节一致（含 64KB Stored 媒体与 Deflated 文本）；
        // 目录条目按契约拒绝读取（EntryNotFound），不进本循环
        for e in source.iter().filter(|e| !e.name.ends_with('/')) {
            let mut cursor = Cursor::new(bytes.clone());
            let got = index.read_entry(&mut cursor, &e.name).unwrap();
            assert_eq!(got, e.data, "条目内容不一致：{}", e.name);
        }

        // 目录条目判定 + 子树前缀查询（en 与 ja 两文件 + 目录条目 dir/ 不在前缀内）
        assert!(index.get("assets/Resources/dir/").unwrap().is_dir);
        let lang = index.walk_prefix("assets/Resources/Lang/");
        assert_eq!(lang.len(), 2);
    }

    // —— 边界：空归档 / 注释 / 前缀 ——

    #[test]
    fn zip_index_empty_archive_is_empty() {
        let index = index_of(build_zip(&[], b""));
        assert!(index.is_empty());
        assert!(index.walk_prefix("").is_empty());
    }

    #[test]
    fn zip_index_trailing_comment_parses() {
        let index = index_of(build_zip(&[entry("a.txt", b"x")], vec![0u8; 4096].as_slice()));
        assert_eq!(index.len(), 1);
    }

    #[test]
    fn zip_index_decoy_signature_in_comment_is_skipped() {
        // 注释里塞一段「伪 EOCD」：签名相符但注释长度字段不自洽（声明 5 字节注释、
        // 实际位置剩余 27 字节）——扫描器必须跳过它，取文件末尾长度自洽的真 EOCD。
        let mut fake = Vec::new();
        fake.extend_from_slice(&EOCD_MAGIC.to_le_bytes());
        fake.extend_from_slice(&[0u8; 16]);
        fake.extend_from_slice(&5u16.to_le_bytes());
        let mut comment = fake;
        comment.extend_from_slice(&[0xABu8; 10]);
        let index = index_of(build_zip(&[entry("a.txt", b"x")], &comment));
        assert_eq!(index.len(), 1);
    }

    // —— 故意错误：每条都必须 fail-closed ——

    #[test]
    fn zip_index_truncated_file_reports_eocd_missing() {
        let mut bytes = build_zip(&[entry("a.txt", b"x")], b"");
        bytes.truncate(bytes.len() - 10);
        let mut cursor = Cursor::new(bytes);
        assert!(matches!(
            ZipIndex::read_from(&mut cursor),
            Err(ZipIndexError::EocdNotFound)
        ));
    }

    #[test]
    fn zip_index_not_a_zip_reports_eocd_missing() {
        let mut cursor = Cursor::new(vec![0u8; 4096]);
        assert!(matches!(
            ZipIndex::read_from(&mut cursor),
            Err(ZipIndexError::EocdNotFound)
        ));
    }

    #[test]
    fn zip_index_central_directory_out_of_bounds_rejected() {
        let mut bytes = build_zip(&[entry("a.txt", b"x")], b"");
        // EOCD 的中央目录偏移字段（e+16，空注释时 = 文件末尾回推 6 字节）改写到文件之外
        let len = bytes.len();
        bytes[len - 6..len - 2].copy_from_slice(&(len as u32 + 4096).to_le_bytes());
        let mut cursor = Cursor::new(bytes);
        assert!(matches!(
            ZipIndex::read_from(&mut cursor),
            Err(ZipIndexError::CentralDirectoryOutOfBounds { .. })
        ));
    }

    #[test]
    fn zip_index_truncated_central_directory_rejected() {
        let mut bytes = build_zip(&[entry("a.txt", b"x"), entry("b.txt", b"y")], b"");
        // EOCD 的总条目数字段（e+10，空注释时 = 回推 12 字节）翻倍 → 目录放不下
        let len = bytes.len();
        let declared = u16::from_le_bytes([bytes[len - 12], bytes[len - 11]]);
        bytes[len - 12..len - 10].copy_from_slice(&(declared * 2).to_le_bytes());
        let mut cursor = Cursor::new(bytes);
        assert!(matches!(
            ZipIndex::read_from(&mut cursor),
            Err(ZipIndexError::CentralDirectoryTruncated)
        ));
    }

    #[test]
    fn zip_index_zip64_markers_rejected() {
        let mut bytes = build_zip(&[entry("a.txt", b"x")], b"");
        // 中央目录记录的未压缩长度字段（记录头内偏移 24）改写为 ZIP64 标记值
        let cd_start = u32::from_le_bytes(bytes[bytes.len() - 6..bytes.len() - 2].try_into().unwrap())
            as usize;
        bytes[cd_start + 24..cd_start + 28].copy_from_slice(&U32_MAX.to_le_bytes());
        let mut cursor = Cursor::new(bytes);
        assert!(matches!(
            ZipIndex::read_from(&mut cursor),
            Err(ZipIndexError::Zip64Unsupported { .. })
        ));
    }

    #[test]
    fn zip_index_corrupted_local_header_rejected() {
        // 索引构建只依赖中央目录 → 本地文件头改坏后索引仍可构建；
        // 读取阶段（本地头校验）必须 fail-closed。
        let mut broken = build_zip(&[entry("a.txt", b"x")], b"");
        broken[0..4].copy_from_slice(&0u32.to_le_bytes());
        let index = index_of(broken.clone());
        let mut cursor = Cursor::new(broken);
        assert!(matches!(
            index.read_entry(&mut cursor, "a.txt"),
            Err(ZipIndexError::BadSignature { .. })
        ));
    }

    #[test]
    fn zip_index_unsupported_method_rejected_on_read() {
        let mut source = vec![entry("a.bin", b"x")];
        source[0].method = 12; // bzip2 —— 不在支持范围
        let bytes = build_zip(&source, b"");
        let index = index_of(bytes.clone());
        let mut cursor = Cursor::new(bytes);
        assert!(matches!(
            index.read_entry(&mut cursor, "a.bin"),
            Err(ZipIndexError::UnsupportedMethod { method: 12, .. })
        ));
    }

    #[test]
    fn zip_index_missing_entry_reports_name() {
        let index = index_of(build_zip(&[entry("a.txt", b"x")], b""));
        let mut cursor = Cursor::new(Vec::new());
        assert!(matches!(
            index.read_entry(&mut cursor, "nope.txt"),
            Err(ZipIndexError::EntryNotFound { name }) if name == "nope.txt"
        ));
    }

    #[test]
    fn zip_index_directory_entry_read_rejected() {
        let index = index_of(build_zip(&[entry("dir/", b"")], b""));
        let mut cursor = Cursor::new(Vec::new());
        assert!(matches!(
            index.read_entry(&mut cursor, "dir/"),
            Err(ZipIndexError::EntryNotFound { .. })
        ));
    }

    // —— 边界：同名条目 / 前缀 ——

    #[test]
    fn zip_index_duplicate_name_keeps_first() {
        let bytes = build_zip(
            &[entry("dup.txt", b"first"), entry("dup.txt", b"second")],
            b"",
        );
        let index = index_of(bytes.clone());
        let mut cursor = Cursor::new(bytes);
        assert_eq!(index.len(), 1);
        assert_eq!(index.read_entry(&mut cursor, "dup.txt").unwrap(), b"first");
    }

    #[test]
    fn zip_index_walk_prefix_is_strict_scope() {
        let index = index_of(build_zip(
            &[
                entry("assets/x.json", b"1"),
                entry("assets/sub/y.json", b"2"),
                entry("other/z.json", b"3"),
            ],
            b"",
        ));
        let names: Vec<&str> = index
            .walk_prefix("assets/")
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, vec!["assets/sub/y.json", "assets/x.json"]);
    }

    // —— 目录判定与子树枚举（供给适配器的两个原语）——

    #[test]
    fn zip_index_kind_covers_implicit_directories() {
        // 打包工具常不为目录生成独立条目：无显式条目但有子条目 ⇒ 判目录
        let index = index_of(build_zip(
            &[
                entry("assets/Resources/a.json", b"1"),
                entry("assets/Resources/sub/b.json", b"2"),
            ],
            b"",
        ));
        assert_eq!(index.kind_of("assets/Resources/a.json"), Some(false));
        assert_eq!(
            index.kind_of("assets/Resources/sub/"),
            Some(true),
            "显式目录条目"
        );
        assert_eq!(
            index.kind_of("assets/Resources/sub"),
            Some(true),
            "无显式条目但有子条目 ⇒ 隐式目录"
        );
        assert_eq!(index.kind_of("assets/Resources/none.json"), None);
    }

    #[test]
    fn zip_index_walk_synthesizes_missing_directories() {
        // 无显式目录条目：子树枚举必须补合成中间目录（树连通），且不含前缀目录本身
        let index = index_of(build_zip(
            &[
                entry("assets/Resources/Stories/x.json", b"1"),
                entry("assets/Resources/Audio/a.mp3", b"2"),
            ],
            b"",
        ));
        let got = index.walk_synthesizing_dirs("assets/Resources/");
        assert_eq!(
            got,
            vec![
                ("assets/Resources/Audio/".to_string(), true),
                ("assets/Resources/Audio/a.mp3".to_string(), false),
                ("assets/Resources/Stories/".to_string(), true),
                ("assets/Resources/Stories/x.json".to_string(), false),
            ]
        );
    }

    #[test]
    fn zip_index_walk_deduplicates_explicit_directory_entries() {
        // 显式目录条目与合成结果同名 ⇒ 只出现一次
        let index = index_of(build_zip(
            &[
                entry("assets/Resources/dir/", b""),
                entry("assets/Resources/dir/f.json", b"1"),
            ],
            b"",
        ));
        let got = index.walk_synthesizing_dirs("assets/Resources/");
        assert_eq!(
            got,
            vec![
                ("assets/Resources/dir/".to_string(), true),
                ("assets/Resources/dir/f.json".to_string(), false),
            ]
        );
    }

    #[test]
    fn zip_index_data_offset_skips_local_name_and_extra() {
        // extra 字段在中央目录与本地头可不同长：数据偏移必须按本地头的两个长度字段
        // 计算（30 + name_len + extra_len），不能用中央目录的 extra 推断。
        let mut bytes = build_zip(&[entry("a.txt", b"payload")], b"");
        // 定位本地头的 extra 长度字段（偏移 28..30），改为 4 并插入 4 字节 extra + 数据不变
        // （fixture 写入端不做这事，这里手工重排：local 头(30)+name(5)+extra(4)+payload）
        let name_len = 5usize;
        let local_header = &mut bytes[0..30 + name_len];
        local_header[28..30].copy_from_slice(&4u16.to_le_bytes());
        let mut rebuilt: Vec<u8> = Vec::new();
        rebuilt.extend_from_slice(local_header);
        rebuilt.extend_from_slice(b"0000"); // 插入 extra
        rebuilt.extend_from_slice(b"payload");
        let payload_len = b"payload".len();
        // 之后是中央目录 + EOCD（跳过原 payload，重建段里已含）：local_offset 不变，
        // 但中央目录物理位置整体后移 4 字节，EOCD 里的 cd_offset 必须同步改写
        rebuilt.extend_from_slice(&bytes[30 + name_len + payload_len..]);
        let central_offset = (30 + name_len + 4 + payload_len) as u32;
        let len = rebuilt.len();
        rebuilt[len - 6..len - 2].copy_from_slice(&central_offset.to_le_bytes());
        let index = index_of(rebuilt.clone());
        let mut cursor = Cursor::new(rebuilt);
        assert_eq!(index.data_offset(&mut cursor, "a.txt").unwrap(), 39);
        assert_eq!(index.read_entry(&mut cursor, "a.txt").unwrap(), b"payload");
    }
}
