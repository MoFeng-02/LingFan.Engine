//! 默认资源密钥适配器：包内 seed 优先（casual 级）。
//!
//! seed 导入 / 信封回退逻辑由原 `resource_dek` 原样迁入（默认行为不变）；新增信封短路：
//! 信封已存在且 seed 指纹一致即跳过重复封装与写盘（幂等，省去每请求重 seal）。
//! seed 即明文 DEK 随包，KEK 信封只是运行期缓存——诚实口径见安全规约「三-1」。

use super::AAD_RESOURCE_DEK;
use super::DEK_ENVELOPE;
use super::DEK_LEN;
use super::DEK_SEED;
use super::KeyAcquireContext;
use super::ResourceKeySource;
use crate::crypto::KEK_SERVICE;
use crate::crypto::KEK_USER;
use crate::crypto::gcm_open;
use crate::crypto::gcm_seal;
use crate::crypto::kek_from_keyring;
use crate::resource_crypto::error::ResourceCryptoError;
use crate::resource_crypto::error::io;
use sha2::Digest;
use sha2::Sha256;
use std::fs;

/// seed 指纹旁车文件（app data 内，sha256(seed) hex）——是变更检测指纹，不是密钥材料，
/// 不可逆推 DEK；与信封同轮维护，丢失只会触发一次重封（无害）。
const DEK_FINGERPRINT: &str = "resources.dek.lfk2.fp";

/// 包内 seed 来源（默认适配器）：seed 优先 → 信封回退 → MissingKey。
pub(crate) struct PackSeedSource;

impl ResourceKeySource for PackSeedSource {
    fn acquire(&self, ctx: &KeyAcquireContext<'_>) -> Result<Vec<u8>, ResourceCryptoError> {
        let envelope = ctx.app_data.join(DEK_ENVELOPE);
        let seed_path = ctx.resource_root.join(DEK_SEED);
        if ctx.resfs.is_file(&seed_path) {
            let dek = ctx.resfs.read(&seed_path).map_err(io)?;
            if dek.len() != DEK_LEN {
                return Err(ResourceCryptoError::Crypto(
                    "seed 长度不符（须 32 字节）".into(),
                ));
            }
            // 信封短路：信封已在且 seed 指纹一致 → 跳过重复 seal + 写盘（幂等）。
            let fp = seed_fingerprint(&dek);
            let fp_path = ctx.app_data.join(DEK_FINGERPRINT);
            let fresh = envelope.is_file()
                && fs::read_to_string(&fp_path).map(|s| s == fp).unwrap_or(false);
            if fresh {
                return Ok(dek);
            }
            let kek =
                kek_from_keyring(KEK_SERVICE, KEK_USER).map_err(ResourceCryptoError::Crypto)?;
            let sealed =
                gcm_seal(&kek, &dek, AAD_RESOURCE_DEK).map_err(ResourceCryptoError::Crypto)?;
            fs::write(&envelope, &sealed).map_err(io)?;
            let _ = fs::write(&fp_path, fp);
            return Ok(dek);
        }
        if envelope.is_file() {
            let sealed = fs::read(&envelope).map_err(io)?;
            let kek =
                kek_from_keyring(KEK_SERVICE, KEK_USER).map_err(ResourceCryptoError::Crypto)?;
            let plain = gcm_open(&kek, &sealed, AAD_RESOURCE_DEK)
                .map_err(|e| ResourceCryptoError::Crypto(format!("资源 DEK 信封解封：{e}")))?;
            if plain.len() != DEK_LEN {
                return Err(ResourceCryptoError::Crypto("资源 DEK 长度不符".into()));
            }
            return Ok(plain);
        }
        Err(ResourceCryptoError::MissingKey)
    }
}

/// seed 指纹 = sha256(seed) hex（变更检测用，非密钥材料）。
fn seed_fingerprint(dek: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(dek);
    let mut out = String::with_capacity(64);
    for b in hasher.finalize() {
        out.push_str(&format!("{b:02x}"));
    }
    out
}