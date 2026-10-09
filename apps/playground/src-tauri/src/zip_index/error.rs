//! ZIP 索引错误：错误类型、展示文本与 io 错误映射。

use std::fmt;

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
