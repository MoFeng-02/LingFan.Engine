//! 05-存档与安全（Rust 层）：LFS3 信封 + 每档随机 DEK + KEK 走 OS 凭据 + AAD 绑槽位 + 高水位防回档。
//! 全部安全校验在本层完成（TS 只管存档编排）；解密失败 fail-closed，绝不降级。
//!
//! 文件布局（LFS3 v1，二进制）：
//! `MAGIC(4) | version u16 | mode u8 | save_count u64 | timestamp u64 | dek_len u32 | dek_part | ciphertext`
//! ciphertext = AES-256-GCM(payload, key=DEK, AAD="LFS3:payload:{slot}")——写档即绑槽。

/// 存档读写主流程与错误类型。
mod core;
/// LFS3 信封常量与解析。
mod envelope;
/// 全局高水位：文件名、读取与写入。
mod highwater;
/// Tauri 命令层：解析应用数据目录后转发到核心逻辑。
mod commands;

/// 行为测试。
#[cfg(test)]
mod tests;

/// 存档的密钥封装方式。
pub use envelope::CryptoMode;
/// 存档层的错误类型。
pub use core::SaveError;
/// 槽位摘要：槽名、档内计数、时间戳与加密模式。
pub use core::SlotSummary;
/// 删除槽位文件（高水位不动）。
pub use core::delete_save;
/// 列出槽位摘要（仅解析头部，不解密）。
pub use core::list_saves;
/// 读档：解封 DEK、认证负载并校验高水位。
pub use core::read_save;
/// Tauri 命令：删除槽位。
pub use commands::save_delete;
/// Tauri 命令：列出槽位摘要。
pub use commands::save_list;
/// Tauri 命令：读档。
pub use commands::save_read;
/// Tauri 命令：写档。
pub use commands::save_write;
/// 写档：随机 DEK 加密负载并认领新高水位。
pub use core::write_save;

/// 命令宏：与命令函数同路径解析，转发到本域实现。
pub(crate) use commands::{__cmd__save_write, __tauri_command_name_save_write, __cmd__save_read, __tauri_command_name_save_read, __cmd__save_list, __tauri_command_name_save_list, __cmd__save_delete, __tauri_command_name_save_delete};
