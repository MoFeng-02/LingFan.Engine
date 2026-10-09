//! 资源 DEK 的 KEK 信封管理：seed 导入、密钥读取与预取，以及故事文本解密。

use crate::crypto::KEK_SERVICE;
use crate::crypto::KEK_USER;
use crate::crypto::gcm_open;
use crate::crypto::gcm_seal;
use crate::crypto::kek_from_keyring;
use crate::crypto::random_bytes;
use crate::fs::seek_len;
use crate::paths::app_data;
use crate::paths::resource_root;
use crate::resource_crypto::error::{ResourceCryptoError, io};
use crate::resource_crypto::format::{decrypt_resource_bytes};
use crate::resource_fs::ResourceFs;
use std::fs;
use std::path::Path;

const DEK_LEN: usize = 32;

/// 资源密钥信封文件（app data 内，KEK 封装）
pub(crate) const DEK_ENVELOPE: &str = "resources.dek.lfk2";

/// 构建产物：包内原始 DEK（首次运行导入后转信封；只读资源根不删——分发窗口边界已知）
pub(crate) const DEK_SEED: &str = "__key__.seed";

const AAD_RESOURCE_DEK: &[u8] = b"LFK2:resource-dek";

/// IPC 单次回传上限：仅限**文本供给路径**（故事/overlay——故事文件受组装器约束天然小于此）。
/// 媒体资源不走 IPC（流式解密统一到临时缓存，此护栏对其不再适用）。
const IPC_SIZE_LIMIT: u64 = 32 * 1024 * 1024;

/// 生成构建产物：随机资源 DEK（打包工具写入 `__key__.seed`）
pub(crate) fn generate_resource_seed() -> Result<Vec<u8>, ResourceCryptoError> {
    random_bytes(DEK_LEN).map_err(ResourceCryptoError::Crypto)
}

/// 运行时资源 DEK（**seed 优先**——包根 seed 为权威 DEK 源）：
/// 每次启动若包内有 seed，幂等重导入（重加密写信封）——**包更新 = 新 seed 自动跟随**
/// （否则旧信封 DEK 永远解不开新包，升级即坏）；无 seed（运行时产出形态）
/// 回退信封；两者皆无 = MissingKey。运行态信封 KEK 封装，零明文密钥落盘。
/// seed 读取经资源文件系统抽象（Android = asset 内）；信封在 app_data 真实路径走 std::fs。
pub(crate) fn resource_dek(
    app_data: &Path,
    resource_root: &Path,
    resfs: &dyn ResourceFs,
) -> Result<Vec<u8>, ResourceCryptoError> {
    let envelope = app_data.join(DEK_ENVELOPE);
    let seed_path = resource_root.join(DEK_SEED);
    if resfs.is_file(&seed_path) {
        let dek = resfs.read(&seed_path).map_err(io)?;
        if dek.len() != DEK_LEN {
            return Err(ResourceCryptoError::Crypto(
                "seed 长度不符（须 32 字节）".into(),
            ));
        }
        let kek = kek_from_keyring(KEK_SERVICE, KEK_USER).map_err(ResourceCryptoError::Crypto)?;
        let sealed = gcm_seal(&kek, &dek, AAD_RESOURCE_DEK).map_err(ResourceCryptoError::Crypto)?;
        // 信封幂等维护：内容一致则不重写（减少磁盘写）
        let need_write = match fs::read(&envelope) {
            Ok(old) => old != sealed,
            Err(_) => true,
        };
        if need_write {
            fs::write(&envelope, &sealed).map_err(io)?;
        }
        return Ok(dek);
    }
    if envelope.is_file() {
        let sealed = fs::read(&envelope).map_err(io)?;
        let kek = kek_from_keyring(KEK_SERVICE, KEK_USER).map_err(ResourceCryptoError::Crypto)?;
        let plain = gcm_open(&kek, &sealed, AAD_RESOURCE_DEK)
            .map_err(|e| ResourceCryptoError::Crypto(format!("资源 DEK 信封解封：{e}")))?;
        if plain.len() != DEK_LEN {
            return Err(ResourceCryptoError::Crypto("资源 DEK 长度不符".into()));
        }
        return Ok(plain);
    }
    Err(ResourceCryptoError::MissingKey)
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
