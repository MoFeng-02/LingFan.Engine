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

/// 中央目录索引与条目读取。
mod index;
/// 条目结构与本地文件头校验。
mod entry;
/// 错误类型与 io 错误映射。
mod error;

/// 行为测试。
#[cfg(test)]
mod tests;

/// 压缩方法：Deflate。
pub use index::METHOD_DEFLATED;
/// 压缩方法：未压缩（原始字节直读）。
pub use index::METHOD_STORED;
/// 单个条目（中央目录记录的投影）。
pub use entry::ZipEntry;
/// 全量条目索引。
pub use index::ZipIndex;
/// ZIP 索引与条目读取的错误类型。
pub use error::ZipIndexError;

