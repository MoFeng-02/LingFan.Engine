//! lfstream 协议的内部实现：请求入口、Range 处理、临时缓存与平台探测。

/// 流式解密的临时缓存：目录约定、缓存文件命名、清理与全量解密落盘。
mod cache;
/// lfstream 自定义协议的请求入口：分发、令牌与 v2 路径识别、整文件 Range 响应。
mod protocol;
/// v2 资源的分块 Range 响应：请求头通道与查询参数通道，含越界与不可满足的处理。
mod range;
/// Android 调试构建下的 Range 支持探测；其他平台不编译本文件内容。
mod probe;

/// 清空流式解密的临时缓存目录。
#[allow(unused_imports)]
pub(crate) use cache::cleanup_tmp_stream;
/// 解密资源并返回前端可直接取用的地址。
pub use protocol::decrypt_resource;
/// 读取 v2 密文头部声明的明文总长。
#[allow(unused_imports)]
pub(crate) use range::decrypt_v2_total_len;
/// v2 分块资源的 Range 处理核心，与 AppHandle 解耦以便单测。
#[allow(unused_imports)]
pub(crate) use range::handle_v2_range_with;
/// 判断 v1 令牌是否合法：只接受 `{64 位十六进制}.{扩展名}` 形态。
#[allow(unused_imports)]
pub(crate) use protocol::is_v1_token;
/// lfstream 自定义协议的请求处理入口。
#[allow(unused_imports)]
pub(crate) use protocol::lfstream_protocol_handler;
/// 从查询串取出 `range` 参数并做百分号解码。
#[allow(unused_imports)]
pub(crate) use range::range_query_value;
/// 把加密资源解密到临时缓存文件，已存在则直接复用。
#[allow(unused_imports)]
pub(crate) use cache::stream_decrypt_to_cache;
/// 按 Range 请求构造 lfstream 响应，覆盖 200 / 206 / 416 / 404。
#[allow(unused_imports)]
pub(crate) use protocol::stream_range_response;
/// 流式解密的临时缓存目录路径。
#[allow(unused_imports)]
pub(crate) use cache::tmp_stream_dir;

/// 命令宏：与命令函数同路径解析，转发到本域实现。
#[allow(unused_imports)]
pub(crate) use protocol::__cmd__decrypt_resource;
/// 命令宏：与命令函数同路径解析，转发到本域实现。
#[allow(unused_imports)]
pub(crate) use protocol::__tauri_command_name_decrypt_resource;
