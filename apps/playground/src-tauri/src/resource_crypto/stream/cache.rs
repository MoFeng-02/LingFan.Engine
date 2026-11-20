//! 流式解密的临时缓存：目录约定、缓存文件命名、清理与全量解密落盘。
//!
//! 明文落盘口径（v1 全量解密形态）：v1 为 GCM 单 tag 全量验证，密码学上不可流式，
//! 解密结果须整体落盘供 lfstream Range 供给（webview 媒体元素经 URL 拉流，消费侧
//! `stream_range_response` 按磁盘文件 seek/read）。**内存 LRU 优先方案评估后取 0600 折中**：
//! 改内存 LRU 须重构 Range 供给路径（磁盘 seek → 内存切片）并改写既有流式测试，
//! 非平凡纠缠既有语义；而本路径只服务小资源（大媒体 >8MiB 打包已分流 v2 内存块缓存，
//! 明文零落盘），落盘文件位于 app_data 用户目录。故取设计允许的 0600 折中——
//! 目录 0700 / 文件 0600（仅属主可读写，闭合 Linux 世界可读缺口），明文缓冲用后清零。
//! 这是「抬高提取成本」而非「绝对不可提取」（根本限制诚实口径）。

use crate::fs::seek_len;
use crate::resource_crypto::error::{ResourceCryptoError, io};
use crate::resource_crypto::format::{decrypt_resource_bytes};
use crate::resource_fs::ResourceFs;
use sha2::Digest;
use sha2::Sha256;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use zeroize::Zeroizing;

/// 临时流缓存目录（app data 内）：进程生命周期 = 缓存生命周期，启动清理
pub(crate) const TMP_STREAM_DIR: &str = "tmp-stream";

/// 临时流缓存单文件护栏（异常保护，非功能限制——PC 本地盘；4K 素材 500MB 级在内）
pub(crate) const STREAM_SIZE_LIMIT: u64 = 4 * 1024 * 1024 * 1024;

/// 临时流缓存目录
pub(crate) fn tmp_stream_dir(app_data: &Path) -> PathBuf {
    app_data.join(TMP_STREAM_DIR)
}

/// 收紧属主权限：Unix 目录 0700 / 文件 0600（仅属主可读写，闭合世界可读缺口）。
/// 非 Unix（Windows/macOS 之外）app_data 本就走用户级 ACL，尽力而为不阻断供给。
fn restrict_owner_only(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
    }
}

/// 应用启动清理：上次会话的临时流缓存（同 DEK 同路径 → 内容确定性可重建，无脏读风险）
pub(crate) fn cleanup_tmp_stream(app_data: &Path) {
    let dir = tmp_stream_dir(app_data);
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    let _ = fs::create_dir_all(&dir);
    restrict_owner_only(&dir, 0o700);
}

/// 缓存文件名 = sha256(逻辑路径) hex + 扩展名（扩展名白名单校验防路径注入）
fn stream_cache_name(path: &str) -> Result<String, ResourceCryptoError> {
    crate::paths::validate_resource_path(path)
        .map_err(|e| ResourceCryptoError::invalid_path(path, e))?;
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_else(|| "bin".to_string());
    if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(ResourceCryptoError::InvalidPath(path.to_string()));
    }
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let mut name = String::with_capacity(64 + ext.len() + 1);
    for b in hasher.finalize() {
        name.push_str(&format!("{b:02x}"));
    }
    name.push('.');
    name.push_str(&ext);
    Ok(name)
}

/// 解密单个加密资源到临时流缓存（存在即复用；进程内 DEK 不变 → 同路径内容确定性一致）
/// 源密文经资源文件系统抽象读取（Android = asset）；缓存目录 app_data 真实路径走 std::fs。
pub(crate) fn stream_decrypt_to_cache(
    resfs: &dyn ResourceFs,
    root: &Path,
    app_data: &Path,
    key: &[u8],
    path: &str,
) -> Result<String, ResourceCryptoError> {
    let name = stream_cache_name(path)?;
    let dir = tmp_stream_dir(app_data);
    fs::create_dir_all(&dir).map_err(io)?;
    restrict_owner_only(&dir, 0o700);
    let cache = dir.join(&name);
    if cache.is_file() {
        return Ok(name);
    }
    let sealed_path = root.join(format!("{path}.enc"));
    if !resfs.is_file(&sealed_path) {
        return Err(ResourceCryptoError::Io(format!(
            "加密资源不存在：{path}.enc"
        )));
    }
    let mut fin = resfs.open(&sealed_path).map_err(io)?;
    let size = seek_len(&mut *fin).map_err(io)?;
    if size > STREAM_SIZE_LIMIT {
        return Err(ResourceCryptoError::TooLarge {
            size,
            limit: STREAM_SIZE_LIMIT,
        });
    }
    use std::io::Read;
    let mut buf = Vec::new();
    fin.read_to_end(&mut buf).map_err(io)?;
    // 复用通用解密器（LFEN2 版本校验/LFEN 兼容/AAD 绑路径全在内部）；
    // 内存峰值 = 密文 1 倍（原地解密）——v1 为 GCM 单 tag 全量验证形态，密码学上不可流式
    // （流式会先释放未认证明文）；媒体大文件由打包 v1→v2 自动分流（>8MiB）规避本路径。
    // 明文缓冲以 Zeroizing 持有：落盘后 drop 即清零（内存卫生）。
    let plain = Zeroizing::new(decrypt_resource_bytes(buf, key, path)?);
    fs::write(&cache, &plain).map_err(io)?;
    restrict_owner_only(&cache, 0o600);
    Ok(name)
}
