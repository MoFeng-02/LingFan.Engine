//! LFEN2 v2 分块格式：头部读写、nonce 与 AAD 派生、整文件加解密与完整性校验。

use aes_gcm::Aes256Gcm;
use aes_gcm::KeyInit;
use aes_gcm::Nonce;
use aes_gcm::aead::Aead;
use aes_gcm::aead::Payload;
use crate::crypto::gcm_open;
use crate::crypto::random_bytes;
use crate::resource_crypto::block_cache::{decrypt_v2_block_range};
use crate::resource_crypto::error::{AAD_RESOURCE_PREFIX, ResourceCryptoError, io};
use crate::resource_crypto::format::{MAGIC_LFEN2};
use std::fs;
use std::path::Path;

/// LFEN2 v2 的版本号，写在头部第二个字节。
pub(crate) const FORMAT_VERSION_V2: u8 = 2;

/// v2 头部：LFEN2(5)|ver(1)|base_nonce(8)|chunk_log2 u32 LE(4)|total_len u64 LE(8)
pub(crate) const V2_HEADER_LEN: usize = 26;

/// 单块上限（64MiB——防御性拒绝畸形头）
const V2_MAX_CHUNK_LOG2: u32 = 26;

/// v1→v2 自动分流阈值：源文件 > 8MiB 走 v2 分块
pub(crate) const V2_AUTO_THRESHOLD: u64 = 8 * 1024 * 1024;

/// 默认块明文大小 = 4MiB
pub(crate) const V2_DEFAULT_CHUNK_LOG2: u32 = 22;

/// 头部参数守卫：chunk_log2 不得超过单块上限，块数 = ceil(total / chunk) 不得超过 u32::MAX（nonce 空间）
pub(crate) fn v2_validate(total: u64, chunk_log2: u32) -> Result<(u64, u64), ResourceCryptoError> {
    if chunk_log2 > V2_MAX_CHUNK_LOG2 {
        return Err(ResourceCryptoError::BadFormat(format!(
            "chunk_log2 超限：{chunk_log2}"
        )));
    }
    let chunk = 1u64 << chunk_log2;
    let blocks = total.div_ceil(chunk);
    if blocks > u32::MAX as u64 {
        return Err(ResourceCryptoError::BadFormat(format!(
            "块数超界（超出 nonce 空间）：{blocks} > u32::MAX"
        )));
    }
    Ok((chunk, blocks))
}

/// 由基 nonce 与块号派生该块的 nonce。
pub(crate) fn v2_nonce(base: &[u8], index: u32) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(&base[..8]);
    nonce[8..].copy_from_slice(&index.to_be_bytes());
    nonce
}

/// 派生该块的附加数据，把逻辑路径与块号一并绑定进认证范围。
pub(crate) fn v2_aad(path: &str, index: u32) -> String {
    format!("{AAD_RESOURCE_PREFIX}{path}:block:{index}")
}

/// v2 流式加密（lfenpack 大文件路径）：逐块读源 → 逐块 GCM → 顺序写输出，内存 = 单块
pub(crate) fn encrypt_lfen2_v2_file(
    src: &Path,
    out_path: &Path,
    key: &[u8],
    logical: &str,
    chunk_log2: u32,
) -> Result<(), ResourceCryptoError> {
    use std::io::{Read, Write};
    let total = fs::metadata(src).map_err(io)?.len();
    let (chunk, blocks) = v2_validate(total, chunk_log2)?;
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(io)?;
    }
    let base = random_bytes(8).map_err(ResourceCryptoError::Crypto)?;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| ResourceCryptoError::Crypto(format!("密钥长度错误：{e}")))?;
    let mut fin = fs::File::open(src).map_err(io)?;
    let mut fout = fs::File::create(out_path).map_err(io)?;
    let mut head = Vec::with_capacity(V2_HEADER_LEN);
    head.extend_from_slice(MAGIC_LFEN2);
    head.push(FORMAT_VERSION_V2);
    head.extend_from_slice(&base);
    head.extend_from_slice(&chunk_log2.to_le_bytes());
    head.extend_from_slice(&total.to_le_bytes());
    fout.write_all(&head).map_err(io)?;
    let mut buf = vec![0u8; chunk as usize];
    for index in 0..blocks {
        let plain_len = (total - index * chunk).min(chunk) as usize; // 尾块可以短于 chunk
        fin.read_exact(&mut buf[..plain_len]).map_err(io)?;
        let nonce_arr = v2_nonce(&base, index as u32);
        // v2_nonce 恒返 12B（GCM nonce 定长）——TryFrom 失败为不变量破坏，才可 expect
        let nonce = Nonce::try_from(&nonce_arr[..]).expect("nonce 长度恒 12");
        let sealed = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &buf[..plain_len],
                    aad: v2_aad(logical, index as u32).as_bytes(),
                },
            )
            .map_err(|_| ResourceCryptoError::Crypto("GCM 加密失败".into()))?; // sealed = ct||tag
        fout.write_all(&sealed).map_err(io)?;
    }
    fout.flush().map_err(io)?;
    Ok(())
}

/// v2 头解析（不校验长度一致性——调用方按需）：输入至少 26B 且魔数/版本匹配
pub(crate) fn v2_parse_header(head: &[u8]) -> Option<([u8; 8], u32, u64)> {
    if head.len() < V2_HEADER_LEN || !head.starts_with(MAGIC_LFEN2) || head[5] != FORMAT_VERSION_V2
    {
        return None;
    }
    let mut base = [0u8; 8];
    base.copy_from_slice(&head[6..14]);
    let chunk_log2 = u32::from_le_bytes(head[14..18].try_into().ok()?);
    let total = u64::from_le_bytes(head[18..26].try_into().ok()?);
    Some((base, chunk_log2, total))
}

/// v2 全量解密（小文件/防御路径；大文件的媒体消费走 decrypt_v2_block_range 按需）
pub(crate) fn decrypt_v2_all(file: &[u8], key: &[u8], path: &str) -> Result<Vec<u8>, ResourceCryptoError> {
    let (base, chunk_log2, total) = v2_parse_header(file)
        .ok_or_else(|| ResourceCryptoError::BadFormat("LFEN2 v2 头不完整".into()))?;
    let (chunk, blocks) = v2_validate(total, chunk_log2)?;
    let mut out = Vec::with_capacity(total as usize);
    for index in 0..blocks {
        let plain_len = (total - index * chunk).min(chunk) as usize;
        let off = (V2_HEADER_LEN as u64 + index * (chunk + 16)) as usize;
        let end = off + plain_len + 16;
        let sealed = file.get(off..end).ok_or_else(|| {
            ResourceCryptoError::BadFormat("LFEN2 v2 密文长度与 total 不符".into())
        })?;
        let mut with_nonce = Vec::with_capacity(12 + sealed.len());
        with_nonce.extend_from_slice(&v2_nonce(&base, index as u32));
        with_nonce.extend_from_slice(sealed);
        let plain = gcm_open(key, &with_nonce, v2_aad(path, index as u32).as_bytes())
            .map_err(ResourceCryptoError::Crypto)?;
        if plain.len() != plain_len {
            return Err(ResourceCryptoError::BadFormat(
                "LFEN2 v2 块明文长度不符".into(),
            ));
        }
        out.extend_from_slice(&plain);
    }
    Ok(out)
}

/// v2 打包自检：逐块解密回读 == 源文件对应偏移字节（内存 = 单块 × 2）
pub(crate) fn verify_v2_file(
    out_enc: &Path,
    key: &[u8],
    logical: &str,
    src: &Path,
) -> Result<(), ResourceCryptoError> {
    use std::io::Read;
    let total = fs::metadata(src).map_err(io)?.len();
    if total == 0 {
        return Ok(());
    }
    let mut fin = fs::File::open(out_enc).map_err(io)?;
    let mut head = [0u8; V2_HEADER_LEN];
    fin.read_exact(&mut head).map_err(io)?;
    let (_, chunk_log2, total_in_head) = v2_parse_header(&head)
        .ok_or_else(|| ResourceCryptoError::BadFormat("LFEN2 v2 头不完整".into()))?;
    if total_in_head != total {
        return Err(ResourceCryptoError::Io("自检：total_len ≠ 源大小".into()));
    }
    let (chunk, blocks) = v2_validate(total, chunk_log2)?;
    let mut fsrc = fs::File::open(src).map_err(io)?;
    for index in 0..blocks {
        let plain_len = (total - index * chunk).min(chunk) as usize;
        let mut expect = vec![0u8; plain_len];
        fsrc.read_exact(&mut expect).map_err(io)?;
        // 复用按需解密（块对齐区间）
        let start = index * chunk;
        let end = start + plain_len as u64 - 1;
        let actual = decrypt_v2_block_range(
            &crate::resource_fs::StdFs,
            out_enc,
            key,
            logical,
            start,
            end,
        )?;
        if actual != expect {
            return Err(ResourceCryptoError::Io(format!(
                "打包自检失败（v2 块 {index} 回读 ≠ 源明文）：{logical}"
            )));
        }
    }
    Ok(())
}
