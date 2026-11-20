//! 资源 DEK 取用入口（薄委托）+ 故事文本解密。
//!
//! 密钥获取策略经可插拔接缝（`key_source`）由组合根选择，本文件只委托、不写死策略；
//! crypto 核心只消费 DEK 字节。默认适配器 = 包内 seed（casual 级，见安全规约「三-1」）。

use crate::crypto::random_bytes;
use crate::fs::seek_len;
use crate::paths::app_data;
use crate::paths::resource_root;
use crate::resource_crypto::error::{ResourceCryptoError, io};
use crate::resource_crypto::format::decrypt_resource_bytes;
use crate::resource_crypto::key_source;
use crate::resource_crypto::key_source::DEK_LEN;
use crate::resource_fs::ResourceFs;
use std::path::Path;

// 常量单一声明在 key_source；此处转发保持既有导入路径（pack/run.rs 经 dek::DEK_SEED 引用）。
pub(crate) use crate::resource_crypto::key_source::DEK_ENVELOPE;
pub(crate) use crate::resource_crypto::key_source::DEK_SEED;

/// IPC 单次回传上限：仅限**文本供给路径**（故事/overlay——故事文件受组装器约束天然小于此）。
/// 媒体资源不走 IPC（流式解密统一到临时缓存，此护栏对其不再适用）。
const IPC_SIZE_LIMIT: u64 = 32 * 1024 * 1024;

/// 生成构建产物：随机资源 DEK（打包工具写入 `__key__.seed`）
pub(crate) fn generate_resource_seed() -> Result<Vec<u8>, ResourceCryptoError> {
    random_bytes(DEK_LEN).map_err(ResourceCryptoError::Crypto)
}

/// 运行时资源 DEK：委托组合根选定的密钥来源（默认 `PackSeedSource`，seed 优先 → 信封回退）。
/// 签名保持不变兼容调用方；策略可插拔，核心不关心来源。seed 读取经资源文件系统抽象
/// （Android = asset 内）；信封在 app_data 真实路径走 std::fs。
pub(crate) fn resource_dek(
    app_data: &Path,
    resource_root: &Path,
    resfs: &dyn ResourceFs,
) -> Result<Vec<u8>, ResourceCryptoError> {
    key_source::resource_dek_with(
        key_source::current_key_source(),
        app_data,
        resource_root,
        resfs,
    )
}

/// 读取并解密单个加密资源（`逻辑路径` → `逻辑路径.enc`；明文文件不落回——fail-closed）
fn read_encrypted(
    resfs: &dyn ResourceFs,
    resource_root: &Path,
    key: &[u8],
    path: &str,
) -> Result<Vec<u8>, ResourceCryptoError> {
    crate::paths::validate_resource_path(path)
        .map_err(|e| ResourceCryptoError::invalid_path(path, e))?;
    let file = resource_root.join(format!("{path}.enc"));
    if !resfs.is_file(&file) {
        return Err(ResourceCryptoError::Io(format!(
            "加密资源不存在：{path}.enc"
        )));
    }
    let mut fin = resfs.open(&file).map_err(io)?;
    let size = seek_len(&mut *fin).map_err(io)?;
    if size > IPC_SIZE_LIMIT {
        return Err(ResourceCryptoError::TooLarge {
            size,
            limit: IPC_SIZE_LIMIT,
        });
    }
    let mut data = Vec::new();
    use std::io::Read;
    fin.read_to_end(&mut data).map_err(io)?;
    decrypt_resource_bytes(data, key, path)
}

/// `decrypt_story(path) -> String`：加密故事文本解密（UTF-8 校验 fail-closed）
#[tauri::command]
pub fn decrypt_story(app: tauri::AppHandle, path: String) -> Result<String, ResourceCryptoError> {
    let root = resource_root(&app).map_err(ResourceCryptoError::AppData)?;
    let app_data = app_data(&app).map_err(ResourceCryptoError::AppData)?;
    let resfs = crate::resource_fs::resource_fs(&app);
    let key = resource_dek(&app_data, &root, &*resfs)?;
    let plain = read_encrypted(&*resfs, &root, &key, &path)?;
    String::from_utf8(plain).map_err(|_| ResourceCryptoError::BadFormat("故事资源非 UTF-8".into()))
}

/// splash 预热：首启触发 seed→KEK 信封化解封，把解封时延盖在 splash 窗口后面，
/// 主窗口显示后 v2 供给立即可用。明文形态（无 seed）失败无害——预热只求副作用，结果不消费。
pub(crate) fn preheat_resource_key(app: &tauri::AppHandle) {
    let _ = resource_root(app).map_err(ResourceCryptoError::AppData).and_then(|root| {
        app_data(app)
            .map_err(ResourceCryptoError::AppData)
            .and_then(|data_dir| {
                resource_dek(&data_dir, &root, &*crate::resource_fs::resource_fs(app))
            })
    });
}
