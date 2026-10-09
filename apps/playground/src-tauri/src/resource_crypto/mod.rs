//! 资源加密：LFEN2 格式 + LFEN 兼容读 + 资源 DEK 的 KEK 信封。
//!
//! 格式（自描述，解密失败 fail-closed 不降级明文）：
//! - LFEN2 v1：`"LFEN2"(5B) | version u8 | nonce(12) | tag(16) | ciphertext`
//!   AAD = `LFEN2:resource:{逻辑路径}`——资源与路径绑定，跨路径搬移必拒。
//! - LFEN v1（兼容读）：`"LFEN"(4B) | version u8 | nonce(12) | tag(16) | ciphertext`（无 AAD）。
//!
//! 密钥（编译期密钥是降级，此处修正）：
//! 资源 DEK 构建时随机生成；运行时以 KEK 信封存放在 app data（`resources.dek.lfk2`），
//! 首次运行从包内 `__key__.seed`（32B 原始 DEK，构建产物）导入并立即封装——运行态零明文密钥落盘。
//! 加密包内文件名 = 原逻辑路径 + `.enc`（沿用既有命名约定）。

/// 格式常量与按格式分派的加解密原语。
mod format;
/// 资源 DEK 信封、密钥读取与故事文本解密。
mod dek;
/// 错误类型与路径校验失败的映射。
mod error;
/// LFEN2 v2 分块格式。
mod v2;
/// v2 块明文的内存缓存。
mod block_cache;
/// 媒体回环路由判定。
mod media_route;
/// lfstream 协议实现。
mod stream;
/// 资源打包实现。
mod pack;

/// 行为测试。
#[cfg(test)]
mod tests;

/// 资源密钥信封的文件名，位于应用数据目录，内容由 KEK 封装。
#[allow(unused_imports)]
pub(crate) use dek::DEK_ENVELOPE;
/// 包内原始资源密钥的文件名，首次运行导入后转为信封。
#[allow(unused_imports)]
pub(crate) use dek::DEK_SEED;
/// LFEN2 v2 格式的版本号。
#[allow(unused_imports)]
pub(crate) use v2::FORMAT_VERSION_V2;
/// 新格式魔数（5 字节，与 4 字节的 LFEN 无前缀歧义）。
#[allow(unused_imports)]
pub(crate) use format::MAGIC_LFEN2;
/// 打包报告中的单个文件条目。
pub use pack::PackEntry;
/// 一次打包的结果汇总。
pub use pack::PackReport;
/// 资源加密与解密过程中的错误类型。
pub use error::ResourceCryptoError;
/// v2 块明文的有界 LRU 缓存。
#[allow(unused_imports)]
pub(crate) use block_cache::V2BlockCache;
/// v2 块缓存的键：密文路径、逻辑路径、块号与 DEK 指纹四元组。
#[allow(unused_imports)]
pub(crate) use block_cache::V2CacheKey;
/// v2 头部长度：魔数 5 + 版本 1 + 基 nonce 8 + 分块指数 4 + 明文总长 8。
#[allow(unused_imports)]
pub(crate) use v2::V2_HEADER_LEN;
/// 清空流式解密的临时缓存目录。
#[allow(unused_imports)]
pub(crate) use stream::cleanup_tmp_stream;
/// 解密资源并返回前端可直接取用的地址。
pub use stream::decrypt_resource;
/// 解密内存中的密文，按魔数分派 LFEN2 与 LFEN。
#[allow(unused_imports)]
pub(crate) use format::decrypt_resource_bytes;
/// 读取并解密故事文本。
pub use dek::decrypt_story;
/// 解密 v2 密文的指定块区间。
#[allow(unused_imports)]
pub(crate) use block_cache::decrypt_v2_block_range;
/// 读取 v2 密文头部声明的明文总长。
#[allow(unused_imports)]
pub(crate) use stream::decrypt_v2_total_len;
/// 按扩展名批量加密目录，并保留相对结构。
#[allow(unused_imports)]
pub(crate) use pack::encrypt_directory;
/// 加密为 LFEN2 v1 单块格式。
#[allow(unused_imports)]
pub(crate) use format::encrypt_lfen2;
/// 加密为 LFEN2 v2 分块文件。
#[allow(unused_imports)]
pub(crate) use v2::encrypt_lfen2_v2_file;
/// 校验打包输入与输出路径互不包含。
pub use pack::ensure_pack_paths_distinct;
/// 生成随机的资源 DEK，供打包工具写入包内种子文件。
#[allow(unused_imports)]
pub(crate) use dek::generate_resource_seed;
/// v2 分块资源的 Range 处理核心，与 AppHandle 解耦以便单测。
#[allow(unused_imports)]
pub(crate) use stream::handle_v2_range_with;
/// 判断逻辑路径是否带媒体扩展名。
#[allow(unused_imports)]
pub(crate) use media_route::is_media_ext;
/// 判断 v1 令牌是否合法：只接受 `{64 位十六进制}.{扩展名}` 形态。
#[allow(unused_imports)]
pub(crate) use stream::is_v1_token;
/// lfstream 自定义协议的请求处理入口。
#[allow(unused_imports)]
pub(crate) use stream::lfstream_protocol_handler;
/// 判断该资源是否走本机回环流式通道：Android、加密、音视频三者同时满足。
#[allow(unused_imports)]
pub(crate) use media_route::loopback_eligible;
/// 打包工程目录，不含前端产物。
#[allow(unused_imports)]
pub(crate) use pack::pack_project;
/// 打包工程目录，可附带前端产物。
pub use pack::pack_project_with_dist;
/// 预热资源密钥，避免首次取用时同步解封。
#[allow(unused_imports)]
pub(crate) use dek::preheat_resource_key;
/// 从查询串取出 `range` 参数并做百分号解码。
#[allow(unused_imports)]
pub(crate) use stream::range_query_value;
/// 取得资源 DEK，必要时从包内种子导入并封装。
#[allow(unused_imports)]
pub(crate) use dek::resource_dek;
/// 把加密资源解密到临时缓存文件，已存在则直接复用。
#[allow(unused_imports)]
pub(crate) use stream::stream_decrypt_to_cache;
/// 按 Range 请求构造 lfstream 响应，覆盖 200 / 206 / 416 / 404。
#[allow(unused_imports)]
pub(crate) use stream::stream_range_response;
/// 流式解密的临时缓存目录路径。
#[allow(unused_imports)]
pub(crate) use stream::tmp_stream_dir;
/// DEK 指纹（FNV-1a 64 位），只用于缓存键消歧。
#[allow(unused_imports)]
pub(crate) use block_cache::v2_key_fp;
/// 校验 v2 头部参数：分块指数与块数都不得超过各自上限。
#[allow(unused_imports)]
pub(crate) use v2::v2_validate;

/// 命令宏：与命令函数同路径解析，转发到本域实现。
#[allow(unused_imports)]
pub(crate) use dek::{__cmd__decrypt_story, __tauri_command_name_decrypt_story};
/// 命令宏：与命令函数同路径解析，转发到本域实现。
#[allow(unused_imports)]
pub(crate) use stream::{__cmd__decrypt_resource, __tauri_command_name_decrypt_resource};
