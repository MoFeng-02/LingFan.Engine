//! v2 分块明文的进程内有界缓存，以及按块解密取数。

use crate::crypto::gcm_open;
use crate::resource_crypto::error::{ResourceCryptoError, io};
use crate::resource_crypto::v2::{V2_HEADER_LEN, v2_aad, v2_nonce, v2_parse_header, v2_validate};
use crate::resource_fs::ResourceFs;
use std::collections::HashMap;
use std::collections::VecDeque;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

/// v2 块明文有界 LRU 缓存：吸收相邻 Range 的重复解密——同块二次请求零解密直取。
/// 键 = （密文路径, 逻辑路径, 块号, DEK 指纹）四元组：路径参与键防跨资源串味
/// （Windows 大小写不敏感文件系统下同名异径的 AAD 不同，绝不命中他者缓存块）；
/// DEK 指纹（FNV-1a）参与键，seed 换新后旧块自然失配。内存上限 = 环境变量
/// `LFEN_V2_CACHE_BYTES`（字节，缺省 64 MiB；0 = 禁用）；进程内生命周期，
/// 随启动自然清空、零落盘。明文存在形态注记：Range 响应片段 + 有界内存块（≤ 上限）。
#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) struct V2CacheKey {
    pub(crate) enc: PathBuf,
    pub(crate) logical: String,
    pub(crate) index: u64,
    pub(crate) key_fp: u64,
}

/// 有界 LRU 缓存：按块保存已解密明文，容量以字节计。
pub(crate) struct V2BlockCache {
    pub(crate) cap_bytes: u64,
    pub(crate) bytes: u64,
    pub(crate) entries: HashMap<V2CacheKey, Vec<u8>>,
    pub(crate) recency: VecDeque<V2CacheKey>,
    pub(crate) hits: u64,
    pub(crate) misses: u64,
}

impl V2BlockCache {
    /// 建一个容量上限为 `cap_bytes` 字节的空缓存；上限为 0 表示不缓存。
    pub(crate) fn new(cap_bytes: u64) -> Self {
        Self {
            cap_bytes,
            bytes: 0,
            entries: HashMap::new(),
            recency: VecDeque::new(),
            hits: 0,
            misses: 0,
        }
    }

    /// 取块明文；命中时刷新其最近使用次序，未命中计入 misses。
    pub(crate) fn get(&mut self, key: &V2CacheKey) -> Option<Vec<u8>> {
        if !self.entries.contains_key(key) {
            self.misses += 1;
            return None;
        }
        self.hits += 1;
        self.touch(key);
        self.entries.get(key).cloned()
    }

    /// 存入块明文，超容量时按最久未用顺序逐出，直到回到上限内。
    pub(crate) fn put(&mut self, key: V2CacheKey, plain: Vec<u8>) {
        // 禁用（cap=0）或单块超上限：不缓存，解密路径照常（仅失去加速）
        if self.cap_bytes == 0 || plain.len() as u64 > self.cap_bytes {
            return;
        }
        if !self.entries.contains_key(&key) {
            self.recency.push_front(key.clone());
            self.bytes += plain.len() as u64;
        }
        self.entries.insert(key, plain);
        while self.bytes > self.cap_bytes {
            let Some(victim) = self.recency.pop_back() else {
                break;
            };
            if let Some(v) = self.entries.remove(&victim) {
                self.bytes -= v.len() as u64;
            }
        }
    }

    /// 把该键标记为最近使用，供逐出顺序参考。
    pub(crate) fn touch(&mut self, key: &V2CacheKey) {
        if let Some(pos) = self.recency.iter().position(|k| k == key) {
            self.recency.remove(pos);
        }
        self.recency.push_front(key.clone());
    }
}

static V2_BLOCK_CACHE: OnceLock<Mutex<V2BlockCache>> = OnceLock::new();

fn v2_cache_cap_bytes() -> u64 {
    std::env::var("LFEN_V2_CACHE_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(64 * 1024 * 1024)
}

fn v2_block_cache() -> std::sync::MutexGuard<'static, V2BlockCache> {
    V2_BLOCK_CACHE
        .get_or_init(|| Mutex::new(V2BlockCache::new(v2_cache_cap_bytes())))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// DEK 指纹（FNV-1a 64）：只作缓存键消歧，不承担安全职责
pub(crate) fn v2_key_fp(key: &[u8]) -> u64 {
    let mut fp: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in key {
        fp ^= b as u64;
        fp = fp.wrapping_mul(0x100_0000_01b3);
    }
    fp
}

fn v2_cache_key(enc: &Path, logical: &str, index: u64, key: &[u8]) -> V2CacheKey {
    V2CacheKey {
        enc: enc.to_path_buf(),
        logical: logical.to_string(),
        index,
        key_fp: v2_key_fp(key),
    }
}

fn v2_cache_get(enc: &Path, logical: &str, index: u64, key: &[u8]) -> Option<Vec<u8>> {
    v2_block_cache().get(&v2_cache_key(enc, logical, index, key))
}

fn v2_cache_put(enc: &Path, logical: &str, index: u64, key: &[u8], plain: &[u8]) {
    v2_block_cache().put(v2_cache_key(enc, logical, index, key), plain.to_vec());
}

#[cfg(test)]
/// 取全局缓存的命中与未命中计数，供测试观察缓存是否真正生效。
pub(crate) fn v2_block_cache_stats() -> (u64, u64) {
    let c = v2_block_cache();
    (c.hits, c.misses)
}

/// v2 按需块级解密（lfstream 协议 Range 路径）：只解 [start, end_incl] 覆盖的块，
/// 命中走有界 LRU 块缓存（见 V2BlockCache），未命中逐块解密并回填——
/// 明文永不全量落盘；内存 = 覆盖块之和（≤ 2 块典型场景）+ 缓存上限内历史块。
/// 密文文件经资源文件系统抽象打开（Android = asset 内可 seek fd）。
pub(crate) fn decrypt_v2_block_range(
    resfs: &dyn ResourceFs,
    enc_file: &Path,
    key: &[u8],
    logical: &str,
    start: u64,
    end_incl: u64,
) -> Result<Vec<u8>, ResourceCryptoError> {
    use std::io::{Read, Seek, SeekFrom};
    crate::paths::validate_resource_path(logical)
        .map_err(|e| ResourceCryptoError::invalid_path(logical, e))?;
    if start > end_incl {
        return Err(ResourceCryptoError::BadFormat("Range 区间倒置".into()));
    }
    let mut fin = resfs.open(enc_file).map_err(io)?;
    let mut head = [0u8; V2_HEADER_LEN];
    fin.read_exact(&mut head).map_err(io)?;
    let (base, chunk_log2, total) = v2_parse_header(&head)
        .ok_or_else(|| ResourceCryptoError::BadFormat("LFEN2 v2 头不完整".into()))?;
    let (chunk, _) = v2_validate(total, chunk_log2)?;
    if total == 0 || end_incl >= total {
        return Err(ResourceCryptoError::BadFormat(
            "Range 越界（超出明文总长）".into(),
        ));
    }
    let first_block = start / chunk;
    let last_block = end_incl / chunk;
    let mut out = Vec::with_capacity((end_incl - start + 1) as usize);
    for index in first_block..=last_block {
        let plain = match v2_cache_get(enc_file, logical, index, key) {
            Some(cached) => cached,
            None => {
                let plain_len = (total - index * chunk).min(chunk) as usize;
                let off = (V2_HEADER_LEN as u64 + index * (chunk + 16)) as usize;
                fin.seek(SeekFrom::Start(off as u64)).map_err(io)?;
                let mut sealed = vec![0u8; plain_len + 16];
                fin.read_exact(&mut sealed).map_err(io)?;
                let mut with_nonce = Vec::with_capacity(12 + sealed.len());
                with_nonce.extend_from_slice(&v2_nonce(&base, index as u32));
                with_nonce.extend_from_slice(&sealed);
                let plain = gcm_open(key, &with_nonce, v2_aad(logical, index as u32).as_bytes())
                    .map_err(ResourceCryptoError::Crypto)?;
                v2_cache_put(enc_file, logical, index, key, &plain);
                plain
            }
        };
        // 段内截取（to 钳到块尾——跨块 Range 每块只取自身覆盖段）
        let block_start = index * chunk;
        let from = (start.saturating_sub(block_start)) as usize;
        let to = ((end_incl - block_start) as usize).min(plain.len() - 1);
        out.extend_from_slice(&plain[from..=to]);
    }
    Ok(out)
}
