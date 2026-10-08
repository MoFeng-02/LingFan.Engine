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

use crate::crypto::{
    gcm_open, gcm_open_in_place, gcm_seal, kek_from_keyring, random_bytes, KEK_SERVICE, KEK_USER,
};
use crate::resource_fs::{seek_len, ResourceFs};
use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

/// 新格式魔数（5 字节，与 4 字节 LFEN 无前缀歧义）
const MAGIC_LFEN2: &[u8; 5] = b"LFEN2";
/// LFEN v1 魔数（兼容读）
const MAGIC_LFEN: &[u8; 4] = b"LFEN";
const FORMAT_VERSION: u8 = 1;
const DEK_LEN: usize = 32;
/// 资源密钥信封文件（app data 内，KEK 封装）
const DEK_ENVELOPE: &str = "resources.dek.lfk2";
/// 构建产物：包内原始 DEK（首次运行导入后转信封；只读资源根不删——分发窗口边界已知）
const DEK_SEED: &str = "__key__.seed";
const AAD_RESOURCE_PREFIX: &str = "LFEN2:resource:";
const AAD_RESOURCE_DEK: &[u8] = b"LFK2:resource-dek";
/// IPC 单次回传上限：仅限**文本供给路径**（故事/overlay——故事文件受组装器约束天然小于此）。
/// 媒体资源不走 IPC（流式解密统一到临时缓存，此护栏对其不再适用）。
const IPC_SIZE_LIMIT: u64 = 32 * 1024 * 1024;
/// 临时流缓存目录（app data 内）：进程生命周期 = 缓存生命周期，启动清理
pub(crate) const TMP_STREAM_DIR: &str = "tmp-stream";
/// 临时流缓存单文件护栏（异常保护，非功能限制——PC 本地盘；4K 素材 500MB 级在内）
pub const STREAM_SIZE_LIMIT: u64 = 4 * 1024 * 1024 * 1024;
/// 解密落盘进程内互斥：同资源并发 resolve 竞争同一缓存文件的写句柄（Windows 文件锁冲突）
static STREAM_DECRYPT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum ResourceCryptoError {
    #[serde(rename = "io")]
    Io(String),
    #[serde(rename = "crypto")]
    Crypto(String),
    #[serde(rename = "bad-format")]
    BadFormat(String),
    #[serde(rename = "invalid-path")]
    InvalidPath(String),
    #[serde(rename = "missing-key")]
    MissingKey,
    #[serde(rename = "app-data")]
    AppData(String),
    #[serde(rename = "too-large")]
    TooLarge { size: u64, limit: u64 },
}

impl std::fmt::Display for ResourceCryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResourceCryptoError::Io(m) => write!(f, "文件读写失败：{m}"),
            ResourceCryptoError::Crypto(m) => write!(f, "解密失败：{m}"),
            ResourceCryptoError::BadFormat(m) => write!(f, "资源格式不符：{m}"),
            ResourceCryptoError::InvalidPath(p) => write!(f, "资源路径非法：{p}"),
            ResourceCryptoError::MissingKey => {
                write!(f, "资源密钥缺失（信封与 seed 均不存在）")
            }
            ResourceCryptoError::AppData(m) => write!(
                f,
                "应用数据目录不可用（存档与密钥存储位置）：{m}"
            ),
            ResourceCryptoError::TooLarge { size, limit } => write!(
                f,
                "资源过大（{size} > {limit}）：该护栏仅覆盖文本类供给路径；媒体类大资源走自定义协议流式（lfstream Range 按需解密），请勿经文本路径读取"
            ),
        }
    }
}

impl std::error::Error for ResourceCryptoError {}

/// 逻辑路径信任边界（与静态 ResourcePort 同判）：拒绝 `..`、空段与绝对路径
pub(crate) fn validate_resource_path(path: &str) -> Result<(), ResourceCryptoError> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path
            .split('/')
            .any(|seg| seg.is_empty() || seg == ".." || seg == ".")
    {
        return Err(ResourceCryptoError::InvalidPath(path.to_string()));
    }
    Ok(())
}

fn aad_for(path: &str) -> Vec<u8> {
    format!("{AAD_RESOURCE_PREFIX}{path}").into_bytes()
}

fn io(e: std::io::Error) -> ResourceCryptoError {
    ResourceCryptoError::Io(e.to_string())
}

/// 是否为加密资源（魔数检测）
pub fn is_encrypted(data: &[u8]) -> bool {
    data.starts_with(MAGIC_LFEN2) || data.starts_with(MAGIC_LFEN)
}

/// LFEN2 加密（打包工具与测试用）：一次性缓冲区，nonce/tag/密文直接落位
pub fn encrypt_lfen2(
    plaintext: &[u8],
    key: &[u8],
    path: &str,
) -> Result<Vec<u8>, ResourceCryptoError> {
    let sealed = gcm_seal(key, plaintext, &aad_for(path)).map_err(ResourceCryptoError::Crypto)?;
    let mut out = Vec::with_capacity(MAGIC_LFEN2.len() + 1 + sealed.len());
    out.extend_from_slice(MAGIC_LFEN2);
    out.push(FORMAT_VERSION);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// 解密：魔数分流 LFEN2（ver=1 整文件 / ver=2 分块全量拼接，校验版本 + AAD）/ LFEN（无 AAD 兼容读）；其他 = BadFormat（不降级明文）。
/// 入参为**持有缓冲**：v1 分支原地解密（内存峰值 = 密文 1 倍，无第二份明文分配）——
/// v1 为 GCM 单 tag 全量验证形态，密码学上不可流式（流式会先释放未认证明文），峰值收敛靠原地 + 前置尺寸护栏。
pub fn decrypt_resource_bytes(
    mut file: Vec<u8>,
    key: &[u8],
    path: &str,
) -> Result<Vec<u8>, ResourceCryptoError> {
    if file.starts_with(MAGIC_LFEN2) {
        if file.len() < MAGIC_LFEN2.len() + 1 {
            return Err(ResourceCryptoError::BadFormat("LFEN2 文件过短".into()));
        }
        let version = file[MAGIC_LFEN2.len()];
        if version == FORMAT_VERSION_V2 {
            return decrypt_v2_all(&file, key, path);
        }
        if version != FORMAT_VERSION {
            return Err(ResourceCryptoError::BadFormat(format!(
                "LFEN2 版本不支持：{version}"
            )));
        }
        if file.len() < MAGIC_LFEN2.len() + 1 + 12 + 16 {
            return Err(ResourceCryptoError::BadFormat("LFEN2 文件过短".into()));
        }
        file.drain(..MAGIC_LFEN2.len() + 1); // 剥头部（memmove，无重分配）→ 原地解封
        return gcm_open_in_place(key, file, &aad_for(path)).map_err(ResourceCryptoError::Crypto);
    }
    if file.starts_with(MAGIC_LFEN) {
        if file.len() < MAGIC_LFEN.len() + 1 + 12 + 16 {
            return Err(ResourceCryptoError::BadFormat("LFEN 文件过短".into()));
        }
        let version = file[MAGIC_LFEN.len()];
        if version != 1 {
            return Err(ResourceCryptoError::BadFormat(format!(
                "LFEN 版本不支持：{version}"
            )));
        }
        file.drain(..MAGIC_LFEN.len() + 1);
        // LFEN 无 AAD（存量资源不浪费）——原地解封
        return gcm_open_in_place(key, file, &[]).map_err(ResourceCryptoError::Crypto);
    }
    Err(ResourceCryptoError::BadFormat(
        "魔数不符（非 LFEN2/LFEN，不降级明文）".into(),
    ))
}

// —— LFEN2 v2 分块流式 ——

pub const FORMAT_VERSION_V2: u8 = 2;
/// v2 头部：LFEN2(5)|ver(1)|base_nonce(8)|chunk_log2 u32 LE(4)|total_len u64 LE(8)
pub const V2_HEADER_LEN: usize = 26;
/// 单块上限（64MiB——防御性拒绝畸形头）
const V2_MAX_CHUNK_LOG2: u32 = 26;
/// v1→v2 自动分流阈值：源文件 > 8MiB 走 v2 分块
pub const V2_AUTO_THRESHOLD: u64 = 8 * 1024 * 1024;
/// 默认块明文大小 = 4MiB
pub const V2_DEFAULT_CHUNK_LOG2: u32 = 22;

/// 头部参数守卫：chunk_log2 不得超过单块上限，块数 = ceil(total / chunk) 不得超过 u32::MAX（nonce 空间）
fn v2_validate(total: u64, chunk_log2: u32) -> Result<(u64, u64), ResourceCryptoError> {
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

fn v2_nonce(base: &[u8], index: u32) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(&base[..8]);
    nonce[8..].copy_from_slice(&index.to_be_bytes());
    nonce
}

fn v2_aad(path: &str, index: u32) -> String {
    format!("{AAD_RESOURCE_PREFIX}{path}:block:{index}")
}

/// v2 流式加密（lfenpack 大文件路径）：逐块读源 → 逐块 GCM → 顺序写输出，内存 = 单块
pub fn encrypt_lfen2_v2_file(
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
fn v2_parse_header(head: &[u8]) -> Option<([u8; 8], u32, u64)> {
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
fn decrypt_v2_all(file: &[u8], key: &[u8], path: &str) -> Result<Vec<u8>, ResourceCryptoError> {
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

/// v2 块明文有界 LRU 缓存：吸收相邻 Range 的重复解密——同块二次请求零解密直取。
/// 键 = （密文路径, 逻辑路径, 块号, DEK 指纹）四元组：路径参与键防跨资源串味
/// （Windows 大小写不敏感文件系统下同名异径的 AAD 不同，绝不命中他者缓存块）；
/// DEK 指纹（FNV-1a）参与键，seed 换新后旧块自然失配。内存上限 = 环境变量
/// `LFEN_V2_CACHE_BYTES`（字节，缺省 64 MiB；0 = 禁用）；进程内生命周期，
/// 随启动自然清空、零落盘。明文存在形态注记：Range 响应片段 + 有界内存块（≤ 上限）。
#[derive(Clone, PartialEq, Eq, Hash)]
struct V2CacheKey {
    enc: PathBuf,
    logical: String,
    index: u64,
    key_fp: u64,
}

struct V2BlockCache {
    cap_bytes: u64,
    bytes: u64,
    entries: HashMap<V2CacheKey, Vec<u8>>,
    recency: VecDeque<V2CacheKey>,
    hits: u64,
    misses: u64,
}

impl V2BlockCache {
    fn new(cap_bytes: u64) -> Self {
        Self {
            cap_bytes,
            bytes: 0,
            entries: HashMap::new(),
            recency: VecDeque::new(),
            hits: 0,
            misses: 0,
        }
    }

    fn get(&mut self, key: &V2CacheKey) -> Option<Vec<u8>> {
        if !self.entries.contains_key(key) {
            self.misses += 1;
            return None;
        }
        self.hits += 1;
        self.touch(key);
        self.entries.get(key).cloned()
    }

    fn put(&mut self, key: V2CacheKey, plain: Vec<u8>) {
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

    fn touch(&mut self, key: &V2CacheKey) {
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
fn v2_key_fp(key: &[u8]) -> u64 {
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
fn v2_block_cache_stats() -> (u64, u64) {
    let c = v2_block_cache();
    (c.hits, c.misses)
}

/// v2 按需块级解密（lfstream 协议 Range 路径）：只解 [start, end_incl] 覆盖的块，
/// 命中走有界 LRU 块缓存（见 V2BlockCache），未命中逐块解密并回填——
/// 明文永不全量落盘；内存 = 覆盖块之和（≤ 2 块典型场景）+ 缓存上限内历史块。
/// 密文文件经资源文件系统抽象打开（Android = asset 内可 seek fd）。
pub fn decrypt_v2_block_range(
    resfs: &dyn ResourceFs,
    enc_file: &Path,
    key: &[u8],
    logical: &str,
    start: u64,
    end_incl: u64,
) -> Result<Vec<u8>, ResourceCryptoError> {
    use std::io::{Read, Seek, SeekFrom};
    validate_resource_path(logical)?;
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

/// v2 打包自检：逐块解密回读 == 源文件对应偏移字节（内存 = 单块 × 2）
fn verify_v2_file(
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

/// 生成构建产物：随机资源 DEK（打包工具写入 `__key__.seed`）
pub fn generate_resource_seed() -> Result<Vec<u8>, ResourceCryptoError> {
    random_bytes(DEK_LEN).map_err(ResourceCryptoError::Crypto)
}

/// 运行时资源 DEK（**seed 优先**——包根 seed 为权威 DEK 源）：
/// 每次启动若包内有 seed，幂等重导入（重加密写信封）——**包更新 = 新 seed 自动跟随**
/// （否则旧信封 DEK 永远解不开新包，升级即坏）；无 seed（运行时产出形态）
/// 回退信封；两者皆无 = MissingKey。运行态信封 KEK 封装，零明文密钥落盘。
/// seed 读取经资源文件系统抽象（Android = asset 内）；信封在 app_data 真实路径走 std::fs。
pub fn resource_dek(
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
    validate_resource_path(path)?;
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

/// 音视频扩展名判定：回环通道只服务这两类（图/字体/JS/故事不经此路径——它们的消费者
/// 不发非零起点 `Range`，走既有 lfstream 供给即可）。
pub(crate) fn is_media_ext(logical: &str) -> bool {
    let ext = Path::new(logical)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "mp4"
            | "webm"
            | "mov"
            | "mkv"
            | "avi"
            | "mp3"
            | "ogg"
            | "wav"
            | "m4a"
            | "aac"
            | "flac"
            | "opus"
    )
}

/// 回环供给命中判定（Android ∧ 加密 ∧ 音视频）：纯函数，`is_android` 由调用方以 `cfg!` 传入
/// ——使两条分支都能在桌面单测覆盖，不依赖目标平台（`cfg` 掉的分支桌面门禁验不到）。
pub(crate) fn loopback_eligible(is_android: bool, logical: &str) -> bool {
    is_android && is_media_ext(logical)
}

/// 大媒体回环 URL（命中判定 + 服务懒启动）：未命中或服务未起 = `None`——调用方回落 lfstream
/// 既有 URL（fail-soft，绝不改坏非命中路径）。
///
/// 为什么大媒体必须离开 lfstream：Android 侧自定义协议响应体被整段拷进 JVM `byte[]`
/// （见 `media_http` 模块头），设备 Java 堆放不下大媒体；且该拦截层对非零起点 `Range` 必失败。
pub(crate) fn loopback_media_url(app: &tauri::AppHandle, logical: &str) -> Option<String> {
    if !loopback_eligible(cfg!(target_os = "android"), logical) {
        return None;
    }
    let server = crate::media_http::ensure_server(app)?;
    Some(crate::media_http::loopback_url(
        server.port,
        &server.token,
        logical,
    ))
}

/// `decrypt_resource(path)`（流式 + LFEN2 v2 分形态负载）：
/// - v1 整文件：解密到临时流缓存（同资源幂等复用）→ `{"file":"<缓存名>"}` →
///   TS `convertFileSrc(file, "lfstream")`（token 缓存路径）
/// - v2 分块：**不落明文缓存**——`{"v2":"<逻辑路径>"}` →
///   TS `convertFileSrc("v2/"+encodeURIComponent(逻辑路径), "lfstream")`，
///   协议 handler 按 Range 按需解密覆盖块（明文永不全量落盘/进内存）
/// - v2 分块 **Android 音视频**：改回本机回环 HTTP（`http://127.0.0.1:<port>/...`，
///   见 `media_http` 模块头）——该形态下媒体元素能拿到真实 socket 的 Range 语义，
///   大媒体亦不受 Java 堆上限约束；其余路径（含桌面同资源）行为逐字不变
#[tauri::command]
pub fn decrypt_resource(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, ResourceCryptoError> {
    use std::io::Read;
    let root = resource_root(&app)?;
    let app_data = app_data(&app)?;
    let resfs = crate::resource_fs::resource_fs(&app);
    let key = resource_dek(&app_data, &root, &*resfs)?;
    let sealed_path = root.join(format!("{path}.enc"));
    if !resfs.is_file(&sealed_path) {
        return Err(ResourceCryptoError::Io(format!(
            "加密资源不存在：{path}.enc"
        )));
    }
    // 读头探测形态（v2 头 26B；v1 文件最小 34B ≥ 26）
    let mut head = [0u8; V2_HEADER_LEN];
    let n = resfs
        .open(&sealed_path)
        .map_err(io)?
        .read(&mut head)
        .map_err(io)?;
    if n == V2_HEADER_LEN && head.starts_with(MAGIC_LFEN2) && head[5] == FORMAT_VERSION_V2 {
        // 预检：试解首块（DEK 失配提前 fail-closed，而非等到媒体拉流）
        decrypt_v2_block_range(&*resfs, &sealed_path, &key, &path, 0, 0)?;
        // 大媒体（Android ∧ 加密 ∧ 音视频）改走本机回环 socket：lfstream 的响应体在 Android
        // 侧被整段拷进 JVM byte[]（堆上限放不下大媒体），且其拦截层对非零起点 Range 必失败。
        // 未命中或服务未起 = 回落下方既有 lfstream URL（行为零变化）。
        if let Some(url) = loopback_media_url(&app, &path) {
            return Ok(serde_json::json!({ "v2": path, "url": url }).to_string());
        }
        let url = format!("{}/v2/{}", protocol_base(), utf8_percent_encode(&path));
        return Ok(serde_json::json!({ "v2": path, "url": url }).to_string());
    }
    let _guard = STREAM_DECRYPT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let file = stream_decrypt_to_cache(&*resfs, &root, &app_data, &key, &path)?;
    let url = format!("{}/{}", protocol_base(), file);
    Ok(serde_json::json!({ "file": file, "url": url }).to_string())
}

/// 协议 URL 基座（平台差异归 Rust——wry 行为：Windows/Android 映射 http://*.localhost，
/// macOS/iOS/Linux 原生 scheme）。TS 零编码逻辑：URL 由本命令完整给出。
#[cfg(any(windows, target_os = "android"))]
fn protocol_base() -> &'static str {
    "http://lfstream.localhost"
}
#[cfg(not(any(windows, target_os = "android")))]
fn protocol_base() -> &'static str {
    "lfstream://localhost"
}

/// URL 段编码（逻辑路径整段编码：`/` → %2F 使其成为协议 path 的单一段）
pub(crate) fn utf8_percent_encode(path: &str) -> String {
    const SEGMENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'.')
        .remove(b'_');
    percent_encoding::utf8_percent_encode(path, SEGMENT).to_string()
}

/// 临时流缓存目录
pub(crate) fn tmp_stream_dir(app_data: &Path) -> PathBuf {
    app_data.join(TMP_STREAM_DIR)
}

/// 应用启动清理：上次会话的临时流缓存（同 DEK 同路径 → 内容确定性可重建，无脏读风险）
pub fn cleanup_tmp_stream(app_data: &Path) {
    let dir = tmp_stream_dir(app_data);
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    let _ = fs::create_dir_all(&dir);
}

/// 缓存文件名 = sha256(逻辑路径) hex + 扩展名（扩展名白名单校验防路径注入）
fn stream_cache_name(path: &str) -> Result<String, ResourceCryptoError> {
    validate_resource_path(path)?;
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
pub fn stream_decrypt_to_cache(
    resfs: &dyn ResourceFs,
    root: &Path,
    app_data: &Path,
    key: &[u8],
    path: &str,
) -> Result<String, ResourceCryptoError> {
    let name = stream_cache_name(path)?;
    let dir = tmp_stream_dir(app_data);
    fs::create_dir_all(&dir).map_err(io)?;
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
    // （流式会先释放未认证明文）；媒体大文件由打包 v1→v2 自动分流（>8MiB）规避本路径
    let plain = decrypt_resource_bytes(buf, key, path)?;
    fs::write(&cache, &plain).map_err(io)?;
    Ok(name)
}

/// Range 请求解析（RFC 7233 单区间：`bytes=a-b` / `bytes=a-` / `bytes=-n`）；
/// 缺失或畸形 = Full（宽容回全量）；start 越界 = Unsatisfiable（416）。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RangeSpec {
    Full,
    Partial(u64, u64),
    Unsatisfiable,
}

pub(crate) fn parse_range(header: Option<&str>, total: u64) -> RangeSpec {
    let Some(h) = header else {
        return RangeSpec::Full;
    };
    let Some(spec) = h.strip_prefix("bytes=") else {
        return RangeSpec::Full;
    };
    let Some((a, b)) = spec.split_once('-') else {
        return RangeSpec::Full;
    };
    let parse = |s: &str| s.trim().parse::<u64>().ok();
    if a.is_empty() {
        let Some(n) = parse(b) else {
            return RangeSpec::Full;
        };
        if n == 0 || total == 0 {
            return RangeSpec::Unsatisfiable;
        }
        return RangeSpec::Partial(total.saturating_sub(n), total - 1);
    }
    let Some(start) = parse(a) else {
        return RangeSpec::Full;
    };
    if start >= total {
        return RangeSpec::Unsatisfiable;
    }
    let end = parse(b).map_or(total - 1, |e| e.min(total - 1));
    if end < start {
        return RangeSpec::Unsatisfiable;
    }
    RangeSpec::Partial(start, end)
}

/// MIME（协议响应头——webview 媒体元素按 Content-Type 处理，替代旧 Blob type 参数）
pub(crate) fn mime_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "opus" => "audio/opus",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        // 前端产物经 v2 路径供给：module script/样式表的 MIME 必须精确，否则 WebView 拒执行
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "html" => "text/html",
        _ => "application/octet-stream",
    }
}

fn not_found() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("静态 404 响应构造不可失败")
}

/// lfstream 协议响应核心（纯函数，单测覆盖 200/206/416/404）：
/// Range → 206 Partial（Content-Range/Accept-Ranges——video seek 流式）；
/// 无 Range → 200 全量（webview 对 mp4 的初始请求恒带 `bytes=0-`，实际不触发大内存路径）。
pub fn stream_range_response(file: &Path, range: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    use tauri::http::{header, StatusCode};
    let mime = mime_for(&file.to_string_lossy());
    let Ok(meta) = fs::metadata(file) else {
        return not_found();
    };
    let total = meta.len();
    match parse_range(range, total) {
        RangeSpec::Unsatisfiable => tauri::http::Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .expect("静态 416 响应构造不可失败"),
        RangeSpec::Full => {
            let body = fs::read(file).unwrap_or_default();
            tauri::http::Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, total.to_string())
                .body(body)
                .expect("200 响应构造不可失败")
        }
        RangeSpec::Partial(start, end) => {
            let mut f = match fs::File::open(file) {
                Ok(f) => f,
                Err(_) => return not_found(),
            };
            if f.seek(SeekFrom::Start(start)).is_err() {
                return not_found();
            }
            let len = (end - start + 1) as usize;
            let mut body = vec![0u8; len];
            if f.read_exact(&mut body).is_err() {
                return not_found();
            }
            tauri::http::Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, len.to_string())
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total}"),
                )
                .body(body)
                .expect("206 响应构造不可失败")
        }
    }
}

/// lfstream 协议入口（LFEN2 v2 按需解密 + v1 token 缓存双路径）：
/// - `v2/{encodeURIComponent(逻辑路径)}`：Range → `decrypt_v2_block_range` 按需解密
///   （明文零落盘；内存 = Range 片段 + 有界 LRU 块缓存；密钥经 AppHandle 现取——KEK 进程内缓存，成本可忽略）
/// - `{hex64}.{ext}`：v1 临时流缓存 token（URL 由本命令返回的 file 名构造）
///
/// 统一加 CORS 头：页面源（localhost:1420）与协议源（lfstream.localhost）跨源，
/// webview fetch/媒体元素拉流需要显式放行（Tauri asset 协议同做法）。
pub fn lfstream_protocol_handler(
    request: tauri::http::Request<Vec<u8>>,
    app: &tauri::AppHandle,
) -> tauri::http::Response<Vec<u8>> {
    let mut resp = handle_stream_request(request, app);
    resp.headers_mut().insert(
        tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        tauri::http::HeaderValue::from_static("*"),
    );
    // fetch 可读 Range 相关头（浏览器默认只暴露 safelist；媒体元素内部不受此限）
    // `x-total-size` 属 URL-query 通道（绕过 Android WebView 二次偏移）的明文总量回传
    resp.headers_mut().insert(
        tauri::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        tauri::http::HeaderValue::from_static(
            "content-range,content-length,content-type,accept-ranges,x-total-size",
        ),
    );
    resp
}

fn handle_stream_request(
    request: tauri::http::Request<Vec<u8>>,
    app: &tauri::AppHandle,
) -> tauri::http::Response<Vec<u8>> {
    let raw = request.uri().path().trim_start_matches('/').to_string();
    // —— v2 按需解密路径：v2/{encodeURIComponent(逻辑路径)} ——
    if let Some(encoded) = raw.strip_prefix("v2/") {
        return handle_v2_range(request, encoded.to_string(), app);
    }
    // —— v1 token 缓存路径：{hex64}.{alnum ext} ——
    if !is_v1_token(&raw) {
        return bad_request();
    }
    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
    let cache_dir = match app_data(app) {
        Ok(d) => tmp_stream_dir(&d),
        Err(e) => {
            // 应用数据目录不可用 = v1 流缓存无从谈起：降级 404（进程存活），stderr 留诊断
            eprintln!("[lfen] 应用数据目录不可用，v1 流缓存供给降级 404：{e}");
            return not_found();
        }
    };
    stream_range_response(&cache_dir.join(raw), range)
}

/// v2 按需解密：Range → 覆盖块解密 → 206/200；逻辑路径走 validate_resource_path 信任边界
fn handle_v2_range(
    request: tauri::http::Request<Vec<u8>>,
    encoded: String,
    app: &tauri::AppHandle,
) -> tauri::http::Response<Vec<u8>> {
    let logical = percent_decode_str(&encoded).decode_utf8_lossy().to_string();
    if validate_resource_path(&logical).is_err() {
        return bad_request();
    }
    let root = match resource_root(app) {
        Ok(r) => r,
        Err(_) => return not_found(),
    };
    let resfs = crate::resource_fs::resource_fs(app);
    let data_dir = match app_data(app) {
        Ok(d) => d,
        Err(e) => {
            // 应用数据目录不可用 = DEK 解封不可能：降级 404（进程存活），stderr 留诊断
            eprintln!("[lfen] 应用数据目录不可用，媒体供给降级 404：{e}");
            return not_found();
        }
    };
    let key = match resource_dek(&data_dir, &root, &*resfs) {
        Ok(k) => k,
        Err(_) => return not_found(),
    };
    handle_v2_range_with(&*resfs, request, &encoded, &root, &key)
}

/// v2 单次响应字节上限（官方 asset protocol 同款）：开放尾区间（`bytes=0-`）若不截断，
/// v2 按需解密会退化为全文件解密——媒体引擎按 `Content-Range`（头通道）或已交付长度
/// （query 通道）自动发后续请求，单次实际远小于此。
const V2_RANGE_MAX_LEN: u64 = 1000 * 1024;

/// URL-query 通道取值：`?range=bytes%3D0-1023` → `bytes=0-1023`（值需 percent 解码）。
/// 仅认第一个 `range` 键；无该键 = `None`——此时行为与既有（只读 `Range` 头）逐字一致。
///
/// 存在的理由（Android WebView 缺陷 Chromium 40739128）：带 `Range` 头经
/// `shouldInterceptRequest` 供给时，WebView 会对**已切片的响应体再跳过 start 字节**
/// （偏移被重复施加），非零起点区间必错位；把区间编进 URL query 后请求**不带 `Range` 头**，
/// WebView 不再二次偏移，响应按 200 原样交付。桌面与明文路径不受影响（那里 `Range` 头正常）。
fn range_query_value(query: Option<&str>) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some("range") {
            let raw = it.next().unwrap_or("");
            return Some(percent_decode_str(raw).decode_utf8_lossy().to_string());
        }
    }
    None
}

/// query 通道**严格**解析（头通道的「畸形宽容回全量」不适用）：值须形如
/// `bytes=a-b` / `bytes=a-` / `bytes=-n`，其余一律拒绝。为何不宽容——显式通道上静默退化
/// 等于一次全文件解密，代价反被放大；此处 fail-closed。返回明文闭区间 `[start, end]`，
/// `None` = 拒绝（调用方回 416）。
fn parse_range_strict(value: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = value.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() {
        let n = b.parse::<u64>().ok()?;
        if n == 0 {
            return None;
        }
        return Some((total.saturating_sub(n), total - 1));
    }
    let start = a.parse::<u64>().ok()?;
    if start >= total {
        return None;
    }
    let end = if b.is_empty() {
        total - 1
    } else {
        b.parse::<u64>().ok()?.min(total - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// 区间探测日志（仅 debug 构建，release 完全移除）：记录 range 来源与取值、响应码、
/// 交付字节首尾——出问题时据此核对「服务端交付的窗口」与实际取字节/播放是否一致。
#[cfg(all(target_os = "android", debug_assertions))]
fn probe_android_range(
    path: &str,
    source: &str,
    req: &str,
    resp: &tauri::http::Response<Vec<u8>>,
    total: u64,
) {
    let body = resp.body();
    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() };
    let head = hex(&body[..body.len().min(4)]);
    let tail = hex(&body[body.len().saturating_sub(4)..]);
    eprintln!(
        "[lfen] range-probe path={path} src={source} req={req} status={} sent={} first={head} last={tail} total={total}",
        resp.status().as_u16(),
        body.len()
    );
}

/// v2 range 核心（与 AppHandle 解耦，可单测）：root/.enc + DEK 由调用方解析。
/// 区间来源二选一——URL query（绕过通道）**优先**于 `Range` 头；两者皆无 = 200 全量。
fn handle_v2_range_with(
    resfs: &dyn ResourceFs,
    request: tauri::http::Request<Vec<u8>>,
    encoded: &str,
    root: &Path,
    key: &[u8],
) -> tauri::http::Response<Vec<u8>> {
    let logical = percent_decode_str(encoded).decode_utf8_lossy().to_string();
    if validate_resource_path(&logical).is_err() {
        return bad_request();
    }
    let enc = root.join(format!("{logical}.enc"));
    let total = match decrypt_v2_total_len(resfs, &enc) {
        Some(t) => t,
        None => return not_found(),
    };
    let header_range = request.headers().get("range").and_then(|v| v.to_str().ok());
    let query_range = range_query_value(request.uri().query());
    // query 通道 = 显式意图，优先于头；无该参数时走原有头路径（行为零变化）
    let (source, req_value, resp) = match query_range {
        Some(value) => (
            "query",
            value.clone(),
            v2_query_range_response(resfs, &enc, key, &logical, total, &value),
        ),
        None => (
            "header",
            header_range.unwrap_or("-").to_string(),
            v2_header_range_response(resfs, &enc, key, &logical, total, header_range),
        ),
    };
    #[cfg(all(target_os = "android", debug_assertions))]
    probe_android_range(&logical, source, &req_value, &resp, total);
    #[cfg(not(all(target_os = "android", debug_assertions)))]
    let _ = (source, req_value); // 这两个量只在 Android debug 构建下被区间探测日志消费
    resp
}

/// `Range` 头通道（桌面/明文既有语义，逐字保留）：206 Partial / 416 / 200 全量。
fn v2_header_range_response(
    resfs: &dyn ResourceFs,
    enc: &Path,
    key: &[u8],
    logical: &str,
    total: u64,
    range: Option<&str>,
) -> tauri::http::Response<Vec<u8>> {
    match parse_range(range, total) {
        RangeSpec::Unsatisfiable => range_unsatisfiable(total),
        RangeSpec::Full => {
            // 全量兜底（webview 对 mp4 初始请求恒带 bytes=0-，实际不触发）——流式拼装到总量护栏内
            match decrypt_v2_block_range(resfs, enc, key, logical, 0, total.saturating_sub(1)) {
                Ok(body) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::OK)
                    .header(tauri::http::header::CONTENT_TYPE, mime_for(logical))
                    .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                    .header(tauri::http::header::CONTENT_LENGTH, body.len().to_string())
                    .body(body)
                    .expect("200 响应构造不可失败"),
                Err(_) => not_found(),
            }
        }
        RangeSpec::Partial(start, end) => {
            let end = start + (end - start).min(V2_RANGE_MAX_LEN - 1);
            match decrypt_v2_block_range(resfs, enc, key, logical, start, end) {
                Ok(body) => {
                    let len = body.len();
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::PARTIAL_CONTENT)
                        .header(tauri::http::header::CONTENT_TYPE, mime_for(logical))
                        .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                        .header(tauri::http::header::CONTENT_LENGTH, len.to_string())
                        .header(
                            tauri::http::header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total}"),
                        )
                        .body(body)
                        .expect("206 响应构造不可失败")
                }
                Err(_) => not_found(),
            }
        }
    }
}

/// URL-query 通道响应：**200**，且**不带** `Content-Range`/`Accept-Ranges`——请求本无
/// `Range` 头，不得再以 range 语义回响应（否则又落进 WebView 的二次偏移）。
/// `X-Total-Size` 供调用方推算窗口与明文总量；畸形/越界 = 416（fail-closed，不回落全量）。
fn v2_query_range_response(
    resfs: &dyn ResourceFs,
    enc: &Path,
    key: &[u8],
    logical: &str,
    total: u64,
    value: &str,
) -> tauri::http::Response<Vec<u8>> {
    let Some((start, end)) = parse_range_strict(value, total) else {
        return range_unsatisfiable(total);
    };
    let end = start + (end - start).min(V2_RANGE_MAX_LEN - 1);
    match decrypt_v2_block_range(resfs, enc, key, logical, start, end) {
        Ok(body) => {
            let len = body.len();
            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::OK)
                .header(tauri::http::header::CONTENT_TYPE, mime_for(logical))
                .header(tauri::http::header::CONTENT_LENGTH, len.to_string())
                .header("x-total-size", total.to_string())
                .header(tauri::http::header::CACHE_CONTROL, "no-store")
                .body(body)
                .expect("200 响应构造不可失败")
        }
        Err(_) => not_found(),
    }
}

fn range_unsatisfiable(total: u64) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::RANGE_NOT_SATISFIABLE)
        .header(
            tauri::http::header::CONTENT_RANGE,
            format!("bytes */{total}"),
        )
        .body(Vec::new())
        .expect("静态 416 响应构造不可失败")
}

/// v1 token 信任边界：只允许 `{hex64}.{alnum ext}` 形态（防穿越/防探测）
fn is_v1_token(raw: &str) -> bool {
    let mut parts = raw.split('.');
    let (token, ext) = (parts.next(), parts.next());
    parts.next().is_none()
        && raw.len() == 64 + 1 + ext.unwrap_or("").len()
        && token.is_some_and(|t| t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit()))
        && ext.is_some_and(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric()))
}

fn bad_request() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::BAD_REQUEST)
        .body(Vec::new())
        .expect("静态 400 响应构造不可失败")
}

/// 读 v2 头取明文总长（非 v2 或读失败 = None）
pub(crate) fn decrypt_v2_total_len(resfs: &dyn ResourceFs, enc_file: &Path) -> Option<u64> {
    use std::io::Read;
    let mut head = [0u8; V2_HEADER_LEN];
    let mut f = resfs.open(enc_file).ok()?;
    f.read_exact(&mut head).ok()?;
    v2_parse_header(&head).map(|(_, _, total)| total)
}

/// `decrypt_story(path) -> String`：加密故事文本解密（UTF-8 校验 fail-closed）
#[tauri::command]
pub fn decrypt_story(app: tauri::AppHandle, path: String) -> Result<String, ResourceCryptoError> {
    let root = resource_root(&app)?;
    let app_data = app_data(&app)?;
    let resfs = crate::resource_fs::resource_fs(&app);
    let key = resource_dek(&app_data, &root, &*resfs)?;
    let plain = read_encrypted(&*resfs, &root, &key, &path)?;
    String::from_utf8(plain).map_err(|_| ResourceCryptoError::BadFormat("故事资源非 UTF-8".into()))
}

/// splash 预热：首启触发 seed→KEK 信封化解封，把解封时延盖在 splash 窗口后面，
/// 主窗口显示后 v2 供给立即可用。明文形态（无 seed）失败无害——预热只求副作用，结果不消费。
pub fn preheat_resource_key(app: &tauri::AppHandle) {
    let _ = resource_root(app).and_then(|root| {
        app_data(app).and_then(|data_dir| {
            resource_dek(&data_dir, &root, &*crate::resource_fs::resource_fs(app))
        })
    });
}

/// 打包工具：目录批量加密——按扩展名过滤、
/// 已加密（魔数检测）直接复制、结构保留、输出 = 原路径 + `.enc`。
/// `exclusions` = 相对路径排除集（精确匹配 `project.json` 或目录前缀 `Saves/`——
/// 运行时生成的目录与明文清单不进加密流）。
pub fn encrypt_directory(
    input: &Path,
    output: &Path,
    key: &[u8],
    extensions: &[&str],
    exclusions: &[&str],
) -> Result<Vec<PathBuf>, ResourceCryptoError> {
    // 同路径防护：output = input 会把 .enc 写回源目录旁（明文/密文同目录共存形态）
    ensure_pack_paths_distinct(input, output)?;
    let mut written = Vec::new();
    let mut scan = PackScan::default();
    encrypt_directory_inner(
        input,
        input,
        output,
        key,
        extensions,
        exclusions,
        "",
        false,
        &mut written,
        &mut scan,
    )?;
    Ok(written)
}

/// 排除判定：排除项精确匹配文件，或以 `目录/` 前缀匹配整棵子树
fn is_excluded(rel_str: &str, exclusions: &[&str]) -> bool {
    exclusions
        .iter()
        .any(|x| rel_str == *x || (x.ends_with('/') && rel_str.starts_with(*x)))
}

// 目录递归遍历的装配参数面（定位/输出/密钥/过滤/前缀/收集器）——收进结构体只挪参数不降复杂度
#[allow(clippy::too_many_arguments)]
fn encrypt_directory_inner(
    root: &Path,
    dir: &Path,
    output: &Path,
    key: &[u8],
    extensions: &[&str],
    exclusions: &[&str],
    prefix: &str,
    force_v2: bool,
    written: &mut Vec<PathBuf>,
    scan: &mut PackScan,
) -> Result<(), ResourceCryptoError> {
    let entries = fs::read_dir(dir).map_err(io)?;
    for entry in entries {
        let path = entry.map_err(io)?.path();
        if path.is_dir() {
            encrypt_directory_inner(
                root, &path, output, key, extensions, exclusions, prefix, force_v2, written, scan,
            )?;
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(&path);
        let rel_str = format!("{prefix}{}", rel.to_string_lossy().replace('\\', "/"));
        if is_excluded(&rel_str, exclusions) {
            scan.excluded.push(PackEntry {
                path: rel_str,
                reason: "排除集（运行期产物 / 密钥引导 / 清单）",
            });
            continue;
        }
        if rel_str.starts_with('.') || rel_str.contains("/.") {
            scan.excluded.push(PackEntry {
                path: rel_str,
                reason: "点文件（隐藏 / 系统）",
            });
            continue; // 排除项与点文件（隐藏/系统）不进包
        }
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !extensions.iter().any(|e| *e == ext) {
            scan.skipped.push(PackEntry {
                path: rel_str,
                reason: "扩展名白名单外（不静默明文；如属资源请扩充白名单）",
            });
            continue;
        }
        scan.encrypted.push(rel_str.clone());
        let out = output.join(format!("{rel_str}.enc"));
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let data_len = path.metadata().map_err(io)?.len();
        // 强制 v2（前端产物 dist 收录）：这些文件按协议 v2 路径按需供给——小文件也必须存成 v2
        // 分块形态（单块特例），否则读取端按 v2 读头会失败并返回 404
        if force_v2 || data_len > V2_AUTO_THRESHOLD {
            // 大文件走 v2 分块流式加密（内存 = 单块；lfstream 按需解密不落明文缓存）
            encrypt_lfen2_v2_file(&path, &out, key, &rel_str, V2_DEFAULT_CHUNK_LOG2)?;
        } else {
            let data = fs::read(&path).map_err(io)?;
            if is_encrypted(&data) {
                fs::write(&out, &data).map_err(io)?; // 已加密：原样复制（幂等重打包）
            } else {
                fs::write(&out, encrypt_lfen2(&data, key, &rel_str)?).map_err(io)?;
            }
        }
        written.push(out);
    }
    Ok(())
}

/// 打包内容文件扩展白名单：故事/文本（json/story）+ 图/音/视频/字体——
/// 白名单外文件不进包（缺类型时运行期资源缺失 fail-closed 暴露，不静默明文）。
const PACK_EXTENSIONS: &[&str] = &[
    "json", "story", // 故事与译文件（清单除外，由排除规则处理）
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", // 图
    "ogg", "wav", "mp3", "m4a", "aac", "flac", "opus", // 音
    "mp4", "webm", "mov", "mkv", "avi", // 视频
    "ttf", "otf", "woff", "woff2", // 字体
];

/// 前端构建产物（dist）收录白名单：js/css + 字体/图——
/// **html 除外**（入口 html 是壳嵌入的明文例外，绝不能混进加密输入；
/// html 出现在 dist 输入 = 上游流程错，落报告 skipped 由打包者决断）。
const PACK_DIST_EXTENSIONS: &[&str] = &[
    "js", "css", // 业务产物（含编译后的 js/ts）
    "png", "jpg", "jpeg", "gif", "webp", "svg", // 产物内静态图
    "woff", "woff2", "ttf", "otf", // 字体
];

/// 打包输出排除集：清单（明文转换）+ 运行时生成的存档目录 + 包内密钥种子（输出侧专属）
const PACK_EXCLUSIONS: &[&str] = &["project.json", "Saves/", "__key__.seed"];

/// 报告条目：路径 + 分类原因（措辞与加密要求例外清单一致）
#[derive(Debug, Serialize)]
pub struct PackEntry {
    pub path: String,
    pub reason: &'static str,
}

/// 打包结果报告（已加密 / 明文 / 排除 / 未入包 分类明细，口径与加密要求一致）
#[derive(Debug, Serialize)]
pub struct PackReport {
    pub files: usize,
    /// 加密入包的逻辑路径（原路径，包内为 `路径 + .enc`）
    pub encrypted: Vec<String>,
    /// 包内明文（有因）：project.json = 工程元数据（运行期形态判定先决读取）、__key__.seed = 密钥引导
    pub plaintext: Vec<PackEntry>,
    /// 排除不入包（有因）：Saves/（玩家数据）、点文件（隐藏/系统）
    pub excluded: Vec<PackEntry>,
    /// 未入包（打包者须决断）：扩展名白名单外——运行期资源缺失 fail-closed 暴露，不静默明文
    pub skipped: Vec<PackEntry>,
}

impl PackReport {
    /// `--strict` 判定：报告含任何「未入包 / 明文例外」⇒ 有例外（非零退出）。
    /// 明文例外 = 资源侧必须明文的文件（入口 html/splash，届时在此并入判定）；
    /// project.json（工程元数据）与 Saves/seed（运行期产物/密钥引导）是有因归类，不算例外。
    pub fn has_exceptions(&self) -> bool {
        !self.skipped.is_empty()
    }
}

/// 扫描分类收集器：encrypt_directory_inner 逐文件判定时填充
#[derive(Default)]
struct PackScan {
    encrypted: Vec<String>,
    excluded: Vec<PackEntry>,
    skipped: Vec<PackEntry>,
}

/// 打包路径关系防护（**数据安全红线**）：输出根与工程根**相同或存在嵌套关系**一律拒绝。
/// - output == input：`lfenpack --force` 清空输出 = 删光源工程（自毁）；
/// - output 在 input 内：打包产物嵌进源工程（源污染 + 二次打包吸收风险）；
/// - input 在 output 内：清空 output 会连带毁掉源工程。
///
/// canonicalize 统一真实大小写与 verbatim 前缀后再做组件级前缀比较；
/// output 不存在时向上归一其最近存在祖先再拼回剩余段。
pub fn ensure_pack_paths_distinct(input: &Path, output: &Path) -> Result<(), ResourceCryptoError> {
    let normalize = |path: &Path| -> Result<PathBuf, ResourceCryptoError> {
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        let mut cur = path.to_path_buf();
        loop {
            match fs::canonicalize(&cur) {
                Ok(real) => {
                    let mut out = real;
                    for seg in tail.iter().rev() {
                        out.push(seg);
                    }
                    return Ok(out);
                }
                Err(_) => match (cur.file_name(), cur.parent()) {
                    (Some(name), Some(parent)) => {
                        tail.push(name.to_os_string());
                        cur = parent.to_path_buf();
                    }
                    _ => {
                        return Err(ResourceCryptoError::Io(format!(
                            "路径无法归一：{}",
                            path.display()
                        )))
                    }
                },
            }
        }
    };
    let input_n = normalize(input)?;
    let output_n = normalize(output)?;
    if input_n == output_n || output_n.starts_with(&input_n) || input_n.starts_with(&output_n) {
        return Err(ResourceCryptoError::Io(format!(
            "输出根与工程根相同或存在嵌套关系（工程根 {}，输出根 {}）——拒绝打包：防自毁与源工程污染，请把输出根放到工程根之外",
            input.display(),
            output.display()
        )));
    }
    Ok(())
}

/// 打包编排：明文工程根 → 加密发布根（lfenpack CLI 的可测核心）。
/// - 输出根 fail-closed：已存在且非空 = 拒绝（不覆盖创作者成果；`--force` 由 CLI 显式清空后重入）
/// - 清单恒明文转换：`resourceEncryption` 置 true（运行时形态判定依赖清单先可读）
/// - DEK 新生成 → 写输出根 `__key__.seed`（运行时首次导入即 KEK 封装）
/// - 内容文件全量 LFEN2（白名单扩展 + 排除集），`原路径 + .enc`，结构保留
/// - `dist`：前端构建产物目录，以 `dist/` 逻辑路径前缀收录（html 落报告 skipped）；
///   收录非空时输出清单补 `frontend.assets` 映射段（清单恒明文，只多一组路径）
/// - 完整性自检：输出逐文件解密回读 == 源明文（round-trip，打包完整性 fail-closed）
pub fn pack_project(input: &Path, output: &Path) -> Result<PackReport, ResourceCryptoError> {
    pack_project_with_dist(input, output, None)
}

/// `dist` 提供时以前端产物白名单收录（`dist/` 逻辑路径前缀，html 落报告 skipped）
pub fn pack_project_with_dist(
    input: &Path,
    output: &Path,
    dist: Option<&Path>,
) -> Result<PackReport, ResourceCryptoError> {
    // 路径关系防护最前置（先于非空检查——语义优先级：自毁/污染红线 > 覆盖确认）
    ensure_pack_paths_distinct(input, output)?;
    if output.exists() {
        let non_empty = fs::read_dir(output)
            .map(|mut it| it.next().is_some())
            .unwrap_or(true);
        if non_empty {
            return Err(ResourceCryptoError::Io(format!(
                "输出目录已存在且非空：{}（清空或换目录后再打包）",
                output.display()
            )));
        }
    }

    // 清单明文转换（先校验后落盘：坏清单零副作用——输出目录都不建）
    let manifest_raw = fs::read_to_string(input.join("project.json")).map_err(io)?;
    let mut manifest: serde_json::Value = serde_json::from_str(&manifest_raw)
        .map_err(|e| ResourceCryptoError::Io(format!("清单不是合法 JSON：{e}")))?;
    manifest["resourceEncryption"] = serde_json::Value::Bool(true);

    fs::create_dir_all(output).map_err(io)?;
    // DEK：新随机 → 包内 seed（运行时 resource_dek 信封缺失时从此导入）
    let seed = generate_resource_seed()?;
    fs::write(output.join(DEK_SEED), &seed).map_err(io)?;
    fs::write(
        output.join("project.json"),
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| ResourceCryptoError::Io(format!("清单序列化失败：{e}")))?,
    )
    .map_err(io)?;

    // 内容文件批量加密 + 完整性自检（v2 逐块回读 / v1 全量回读）
    use std::io::Read;
    let mut written = Vec::new();
    let mut scan = PackScan::default();
    encrypt_directory_inner(
        input,
        input,
        output,
        &seed,
        PACK_EXTENSIONS,
        PACK_EXCLUSIONS,
        "",
        false,
        &mut written,
        &mut scan,
    )?;
    // 前端产物收录：dist/ 逻辑路径前缀；html 落报告 skipped（见 PACK_DIST_EXTENSIONS）；
    // 强制 v2 存储（协议 v2 路径供给的前置形态，见 encrypt_directory_inner 的 force_v2 注释）
    if let Some(dist_root) = dist {
        encrypt_directory_inner(
            dist_root,
            dist_root,
            output,
            &seed,
            PACK_DIST_EXTENSIONS,
            &[],
            "dist/",
            true,
            &mut written,
            &mut scan,
        )?;
    }
    for out_path in &written {
        let rel_str = out_path
            .strip_prefix(output)
            .map_err(|e| ResourceCryptoError::Io(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let logical = rel_str
            .strip_suffix(".enc")
            .ok_or_else(|| ResourceCryptoError::Io(format!("加密输出缺 .enc 后缀：{rel_str}")))?;
        // dist 收录文件的源在前端产物根，不在工程资源根
        let src = match logical.strip_prefix("dist/") {
            Some(rest) => dist
                .ok_or_else(|| {
                    ResourceCryptoError::Io(format!(
                        "包内出现 dist 文件但未提供 dist 输入：{logical}"
                    ))
                })?
                .join(rest),
            None => input.join(logical),
        };
        let mut head = [0u8; V2_HEADER_LEN];
        let n = fs::File::open(out_path)
            .map_err(io)?
            .read(&mut head)
            .map_err(io)?;
        if n == V2_HEADER_LEN && head.starts_with(MAGIC_LFEN2) && head[5] == FORMAT_VERSION_V2 {
            verify_v2_file(out_path, &seed, logical, &src)?;
        } else {
            let sealed = fs::read(out_path).map_err(io)?;
            let plain = decrypt_resource_bytes(sealed, &seed, logical)?;
            if fs::read(&src).map_err(io)? != plain {
                return Err(ResourceCryptoError::Io(format!(
                    "打包自检失败（回读 ≠ 源明文）：{logical}"
                )));
            }
        }
    }
    // dist 收录非空 → 输出清单补 frontend 映射段（清单恒明文，只多一组路径；
    // dist 产物名与 assets 路径一一对应：`assets/x.js` ↔ `dist/assets/x.js.enc`）
    let dist_assets: Vec<String> = scan
        .encrypted
        .iter()
        .filter(|p| p.starts_with("dist/"))
        .cloned()
        .collect();
    if !dist_assets.is_empty() {
        manifest["frontend"] = serde_json::json!({ "assets": dist_assets });
        fs::write(
            output.join("project.json"),
            serde_json::to_string_pretty(&manifest)
                .map_err(|e| ResourceCryptoError::Io(format!("清单序列化失败：{e}")))?,
        )
        .map_err(io)?;
    }

    Ok(PackReport {
        files: written.len(),
        encrypted: scan.encrypted,
        plaintext: vec![
            PackEntry {
                path: "project.json".into(),
                reason: "工程元数据（非资源，运行期形态判定先决读取）",
            },
            PackEntry {
                path: DEK_SEED.into(),
                reason: "DEK 密钥引导（首启信封化输入）",
            },
        ],
        excluded: scan
            .excluded
            .into_iter()
            // project.json 的实际处置 = 明文转换（见 plaintext），排除集条目只是防重复加密，不进报告
            .filter(|e| e.path != "project.json")
            .collect(),
        skipped: scan.skipped,
    })
}

pub(crate) fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, ResourceCryptoError> {
    // 生产路径禁 panic：取不到应用数据目录 = 结构化错误（存档/密钥类命令回传可操作文案，
    // 协议 handler 降级 404），进程照常存活
    app.path()
        .app_data_dir()
        .map_err(|e| ResourceCryptoError::AppData(e.to_string()))
}

pub(crate) fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, ResourceCryptoError> {
    // 单一定位事实源（project_files::locate_resource_root）——dev 走源根/env 覆盖，
    // 与故事供给同根；否则媒体链读 target 拷贝而故事读源根，两链分裂
    Ok(crate::project_files::locate_resource_root(app))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource_fs::StdFs;

    const KEY: &[u8; 32] = b"0123456789abcdef0123456789abcdef";

    #[test]
    fn lfen2_round_trip() {
        // 加密往返：解密回读 == 源明文
        let plain = b"audio-bytes".to_vec();
        let sealed = encrypt_lfen2(&plain, KEY, "Audio/x.mp3").unwrap();
        assert!(sealed.starts_with(MAGIC_LFEN2));
        assert_eq!(
            decrypt_resource_bytes(sealed, KEY, "Audio/x.mp3").unwrap(),
            plain
        );
    }

    #[test]
    fn lfen_legacy_read() {
        // LFEN（magic4|version1|nonce12|tag16|ct，无 AAD）兼容解密
        let legacy = [
            b"LFEN".as_slice(),
            &[1u8],
            &[7u8; 12], // nonce
            b"legacy-plain".as_slice(),
            &[0u8; 16], // tag 占位（实际由 gcm 生成，这里构造非法 tag 走失败路径；成功路径见下）
        ]
        .concat();
        // 存量样本：用 gcm_seal（无 AAD）手工构造
        let sealed = crate::crypto::gcm_seal(KEY, b"legacy-plain", &[]).unwrap();
        let real = [b"LFEN".as_slice(), &[1u8], sealed.as_slice()].concat();
        assert_eq!(
            decrypt_resource_bytes(real, KEY, "whatever").unwrap(),
            b"legacy-plain".to_vec()
        );
        // 坏 tag 的样本必须 fail-closed
        assert!(matches!(
            decrypt_resource_bytes(legacy, KEY, "whatever"),
            Err(ResourceCryptoError::Crypto(_))
        ));
    }

    #[test]
    fn aad_binds_resource_path() {
        // AAD 绑路径：加密时路径 A，按路径 B 解密必拒
        let sealed = encrypt_lfen2(b"data", KEY, "Audio/a.mp3").unwrap();
        assert!(matches!(
            decrypt_resource_bytes(sealed, KEY, "Audio/b.mp3"),
            Err(ResourceCryptoError::Crypto(_))
        ));
    }

    #[test]
    fn tamper_and_bad_magic_fail_closed() {
        // 篡改必拒、非密文不降级明文
        let mut sealed = encrypt_lfen2(b"secret", KEY, "Video/v.mp4").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xFF;
        assert!(matches!(
            decrypt_resource_bytes(sealed, KEY, "Video/v.mp4"),
            Err(ResourceCryptoError::Crypto(_))
        ));
        assert!(matches!(
            decrypt_resource_bytes(b"plain-bytes".to_vec(), KEY, "x"),
            Err(ResourceCryptoError::BadFormat(_))
        ));
    }

    #[test]
    fn path_traversal_rejected() {
        // `..`/空段/绝对路径拒绝
        for bad in ["../x", "a//b", "/abs", "a/./b", "a\\b", ""] {
            assert!(matches!(
                validate_resource_path(bad),
                Err(ResourceCryptoError::InvalidPath(_))
            ));
        }
    }

    #[test]
    fn encrypt_directory_filters_and_preserves_structure() {
        // 加密目录：扩展名过滤 + 结构保留 + .enc 命名 + 已加密幂等复制
        let base = std::env::temp_dir().join(format!(
            "lf3-res-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let input = base.join("in");
        let output = base.join("out");
        fs::create_dir_all(input.join("Audio")).unwrap();
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::write(input.join("Audio/x.mp3"), b"mp3-data").unwrap();
        fs::write(input.join("Stories/start.json"), b"{}").unwrap();
        fs::write(input.join("README.md"), b"skip-me").unwrap();

        let written = encrypt_directory(&input, &output, KEY, &["mp3", "json"], &[]).unwrap();
        assert_eq!(written.len(), 2);
        assert!(output.join("Audio/x.mp3.enc").is_file());
        assert!(output.join("Stories/start.json.enc").is_file());
        assert!(!output.join("README.md.enc").exists());

        // 解密回读（打包路径 AAD = 相对路径）
        let sealed = fs::read(output.join("Audio/x.mp3.enc")).unwrap();
        assert_eq!(
            decrypt_resource_bytes(sealed, KEY, "Audio/x.mp3").unwrap(),
            b"mp3-data".to_vec()
        );
        // 幂等：已加密输入原样复制
        let again = encrypt_directory(&input, &output, KEY, &["mp3", "json"], &[]).unwrap();
        assert_eq!(again.len(), 2);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_project_round_trip_and_layout() {
        // 拟态打包——清单明文转换 + 内容全加密 + 排除集 + seed + round-trip 自检
        let base = temp_base("lf3-pack");
        let input = base.join("in");
        let output = base.join("out");
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::create_dir_all(input.join("Audio")).unwrap();
        fs::create_dir_all(input.join("Lang/en")).unwrap();
        fs::create_dir_all(input.join("Saves")).unwrap();
        fs::write(
            input.join("project.json"),
            r#"{"formatVersion":1,"id":"demo","entry":"a"}"#,
        )
        .unwrap();
        fs::write(input.join("Stories/a.json"), b"{\"commands\":[]}").unwrap();
        fs::write(input.join("Audio/x.mp3"), b"mp3-bytes").unwrap();
        fs::write(input.join("Lang/en/main.json"), "{\"你好\":\"Hello\"}").unwrap();
        fs::write(input.join("Saves/slot_1.lfs3"), b"runtime-save").unwrap();
        fs::write(input.join(".hidden"), b"secret").unwrap();
        fs::write(input.join("README.md"), b"not-content").unwrap();

        let report = pack_project(&input, &output).unwrap();
        assert_eq!(report.files, 3); // Stories/a.json + Audio/x.mp3 + Lang/en/main.json

        // 清单明文可读且形态已翻转（运行时形态判定依赖清单先可读）
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(output.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(
            manifest["resourceEncryption"],
            serde_json::Value::Bool(true)
        );
        assert_eq!(manifest["id"], "demo");

        // seed 随包（32B）；密文齐全；明文内容零泄漏（用户命题：包内只有密文形态的内容）
        assert_eq!(fs::read(output.join("__key__.seed")).unwrap().len(), 32);
        assert!(output.join("Stories/a.json.enc").is_file());
        assert!(output.join("Audio/x.mp3.enc").is_file());
        assert!(output.join("Lang/en/main.json.enc").is_file());
        assert!(!output.join("Stories/a.json").exists());
        assert!(!output.join("Audio/x.mp3").exists());
        assert!(!output.join("Saves/slot_1.lfs3").exists());
        assert!(!output.join(".hidden").exists());
        assert!(!output.join("README.md.enc").exists());

        // 解密回读 == 源明文（AAD 绑逻辑路径）
        let seed = fs::read(output.join("__key__.seed")).unwrap();
        let sealed = fs::read(output.join("Stories/a.json.enc")).unwrap();
        assert_eq!(
            decrypt_resource_bytes(sealed, &seed, "Stories/a.json").unwrap(),
            b"{\"commands\":[]}".to_vec()
        );
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_report_classifies_dispositions() {
        // 报告四分类各有代表（加密 / 明文有因 / 排除 / 未入包）+ strict 例外判定
        let base = temp_base("lf3-pack-report");
        let input = base.join("in");
        let output = base.join("out");
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::create_dir_all(input.join("Saves")).unwrap();
        fs::create_dir_all(input.join("docs")).unwrap();
        fs::write(
            input.join("project.json"),
            r#"{"formatVersion":1,"id":"demo"}"#,
        )
        .unwrap();
        fs::write(input.join("Stories/a.json"), b"{}").unwrap();
        fs::write(input.join("Saves/slot_1.lfs3"), b"save").unwrap();
        fs::write(input.join(".hidden"), b"h").unwrap();
        fs::write(input.join("docs/notes.txt"), b"n").unwrap();

        let report = pack_project(&input, &output).unwrap();
        assert_eq!(report.encrypted, vec!["Stories/a.json".to_string()]);
        assert_eq!(report.files, 1);
        // 明文（有因）恒两条：清单（工程元数据）+ seed（密钥引导），措辞与加密要求一致
        assert_eq!(report.plaintext.len(), 2);
        assert_eq!(report.plaintext[0].path, "project.json");
        assert_eq!(report.plaintext[1].path, DEK_SEED);
        // 排除：Saves 子树 + 点文件（read_dir 顺序不定，按集合断言）
        let excluded: Vec<&str> = report.excluded.iter().map(|e| e.path.as_str()).collect();
        assert!(excluded.contains(&"Saves/slot_1.lfs3"));
        assert!(excluded.contains(&".hidden"));
        // 未入包：白名单外 = 打包者须决断的例外
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.skipped[0].path, "docs/notes.txt");
        assert!(report.has_exceptions());
        // 未入包文件确实没进包（不静默明文）
        assert!(!output.join("docs").exists());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_report_clean_project_has_no_exceptions() {
        // 边界：纯净工程（全部白名单内）→ strict 零例外
        let base = temp_base("lf3-pack-report-clean");
        let input = base.join("in");
        let output = base.join("out");
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::write(
            input.join("project.json"),
            r#"{"formatVersion":1,"id":"demo"}"#,
        )
        .unwrap();
        fs::write(input.join("Stories/a.json"), b"{}").unwrap();
        let report = pack_project(&input, &output).unwrap();
        assert_eq!(report.files, 1);
        assert!(report.skipped.is_empty());
        assert!(!report.has_exceptions());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_project_with_dist_collects_frontend() {
        // dist 收录（dist/ 逻辑路径前缀）+ html 落报告 skipped + 清单 frontend 段
        // + dist 逻辑路径走运行时解密面（与故事资源同管线，形态透明）
        let base = temp_base("lf3-pack-dist");
        let input = base.join("in");
        let output = base.join("out");
        let dist = base.join("distenc"); // 模拟 prepare-dist 移出位 dist-enc/
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::create_dir_all(dist.join("assets")).unwrap();
        fs::write(
            input.join("project.json"),
            r#"{"formatVersion":1,"id":"demo","entry":"a"}"#,
        )
        .unwrap();
        fs::write(input.join("Stories/a.json"), b"{}").unwrap();
        // vite 产物名字符集（[A-Za-z0-9_.-]）：encodeURIComponent 与 Rust 编码输出一致
        fs::write(dist.join("assets/index-Cx1Ab.js"), b"console.log(1)").unwrap();
        fs::write(dist.join("assets/index-Cx1Ab.css"), b"body{}").unwrap();
        // html = 明文例外（壳嵌入），不进 dist 白名单 → skipped
        fs::write(dist.join("splashscreen.html"), b"<html></html>").unwrap();

        let report = pack_project_with_dist(&input, &output, Some(&dist)).unwrap();
        let has = |p: &str| report.encrypted.iter().any(|s| s == p);
        assert!(has("Stories/a.json"));
        assert!(has("dist/assets/index-Cx1Ab.js"));
        assert!(has("dist/assets/index-Cx1Ab.css"));
        assert_eq!(report.files, 3);
        let skipped: Vec<&str> = report.skipped.iter().map(|e| e.path.as_str()).collect();
        assert!(skipped.contains(&"dist/splashscreen.html"));
        assert!(report.has_exceptions());
        // 输出清单补 frontend 映射段（包自描述：加密前端面有哪些资产）
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(output.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["frontend"]["assets"].as_array().unwrap().len(), 2);

        // dist 逻辑路径经同一解密契约可读（AAD 绑 dist/ 前缀逻辑路径）
        let seed = fs::read(output.join("__key__.seed")).unwrap();
        let sealed = fs::read(output.join("dist/assets/index-Cx1Ab.js.enc")).unwrap();
        // dist 资产强制 v2 存储（协议 v2 路径供给的前置形态——小文件也是 v2 单块特例）
        assert!(sealed.starts_with(MAGIC_LFEN2) && sealed[5] == FORMAT_VERSION_V2);
        assert_eq!(
            decrypt_resource_bytes(sealed, &seed, "dist/assets/index-Cx1Ab.js").unwrap(),
            b"console.log(1)".to_vec()
        );
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_project_rejects_nonempty_output() {
        // 故意错误：输出已存在且非空 = 拒绝（不覆盖创作者成果）
        let base = temp_base("lf3-pack-nonempty");
        let input = base.join("in");
        let output = base.join("out");
        fs::create_dir_all(&input).unwrap();
        fs::create_dir_all(&output).unwrap();
        fs::write(
            input.join("project.json"),
            r#"{"formatVersion":1,"id":"demo"}"#,
        )
        .unwrap();
        fs::write(output.join("stale.txt"), b"keep-me").unwrap();
        assert!(pack_project(&input, &output).is_err());
        assert_eq!(fs::read(output.join("stale.txt")).unwrap(), b"keep-me");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_project_bad_or_missing_manifest_fails_closed() {
        // 故意错误：无清单 / 坏 JSON 清单——打包期即拦，输出零副作用（连目录都不建）
        let base = temp_base("lf3-pack-badmanifest");
        let input = base.join("in");
        let output = base.join("out");
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::write(input.join("Stories/a.json"), b"{}").unwrap();
        assert!(pack_project(&input, &output).is_err()); // 无清单
        assert!(!output.exists());
        fs::write(input.join("project.json"), "{not-json").unwrap();
        assert!(pack_project(&input, &output).is_err()); // 坏清单
        assert!(!output.exists());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_rejects_output_equal_or_nested_to_input() {
        // 路径关系防护（同路径 / 子目录 / 父目录全拒）——
        // 若无防护，`--force` 下output == input 时 remove_dir_all 会删光源工程
        let base = temp_base("lfen-guard");
        let input = base.join("Res");
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::write(
            input.join("project.json"),
            r#"{"formatVersion":1,"id":"g","entry":"start"}"#,
        )
        .unwrap();
        fs::write(
            input.join("Stories/a.json"),
            r#"{"formatVersion":1,"id":"a","kind":"flow","commands":[]}"#,
        )
        .unwrap();

        // 相同路径
        assert!(ensure_pack_paths_distinct(&input, &input).is_err());
        assert!(pack_project(&input, &input).is_err());
        // output 不存在但位于 input 内（子目录打包 = 源污染）
        assert!(ensure_pack_paths_distinct(&input, &input.join("packed")).is_err());
        assert!(pack_project(&input, &input.join("packed")).is_err());
        // input 位于 output 内（父目录清空 = 连带毁源）
        assert!(ensure_pack_paths_distinct(&input, &base).is_err());
        // 兄弟目录（不存在）⇒ 通过；打包正例不回归
        assert!(ensure_pack_paths_distinct(&input, &base.join("out")).is_ok());
        let report = pack_project(&input, &base.join("out")).unwrap();
        assert_eq!(report.files, 1);
        assert!(base.join("out").join("Stories/a.json.enc").is_file());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn encrypt_directory_rejects_same_path() {
        // in-place 加密（output = input）= 明文/密文同目录共存的根源形态，防护拒绝
        let base = temp_base("lfen-guard-enc");
        let input = base.join("Res");
        fs::create_dir_all(&input).unwrap();
        fs::write(input.join("a.mp3"), b"audio").unwrap();
        assert!(encrypt_directory(&input, &input, KEY, &["mp3"], &[]).is_err());
        assert!(!input.join("a.mp3.enc").exists()); // 零副作用
        fs::remove_dir_all(&base).ok();
    }

    fn temp_base(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn parse_range_specifications() {
        // RFC 7233 单区间解析：显式区间/开放尾/后缀/越界 416/畸形宽容回全量
        assert_eq!(parse_range(None, 100), RangeSpec::Full);
        assert_eq!(
            parse_range(Some("bytes=0-"), 100),
            RangeSpec::Partial(0, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=10-19"), 100),
            RangeSpec::Partial(10, 19)
        );
        // end 超界钳到文件尾
        assert_eq!(
            parse_range(Some("bytes=90-999"), 100),
            RangeSpec::Partial(90, 99)
        );
        // suffix：最后 n 字节
        assert_eq!(
            parse_range(Some("bytes=-10"), 100),
            RangeSpec::Partial(90, 99)
        );
        // start 越界 = 416
        assert_eq!(
            parse_range(Some("bytes=100-"), 100),
            RangeSpec::Unsatisfiable
        );
        // 畸形 = 宽容回全量
        assert_eq!(parse_range(Some("garbage"), 100), RangeSpec::Full);
        assert_eq!(parse_range(Some("bytes=xx-yy"), 100), RangeSpec::Full);
    }

    #[test]
    fn stream_range_response_codes_and_headers() {
        // 200/206/416/404 全码 + Content-Range 精确字节
        let base = temp_base("lf3-stream");
        fs::create_dir_all(&base).unwrap();
        let file = base.join("abc.mp4");
        fs::write(&file, b"0123456789").unwrap(); // 10 字节

        // 206：显式区间字节精确
        let resp = stream_range_response(&file, Some("bytes=2-5"));
        assert_eq!(resp.status(), tauri::http::StatusCode::PARTIAL_CONTENT);
        assert_eq!(resp.body().as_slice(), b"2345");
        assert_eq!(
            resp.headers()["content-range"],
            "bytes 2-5/10".as_bytes() as &[u8]
        );
        assert_eq!(resp.headers()["content-type"], "video/mp4");
        assert_eq!(resp.headers()["accept-ranges"], "bytes");

        // 200：无 Range 回全量 + Accept-Ranges
        let full = stream_range_response(&file, None);
        assert_eq!(full.status(), tauri::http::StatusCode::OK);
        assert_eq!(full.body().as_slice(), b"0123456789");
        assert_eq!(full.headers()["accept-ranges"], "bytes");

        // 416：start 越界
        let bad = stream_range_response(&file, Some("bytes=100-"));
        assert_eq!(bad.status(), tauri::http::StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            bad.headers()["content-range"],
            "bytes */10".as_bytes() as &[u8]
        );

        // 404：文件不存在
        let missing = stream_range_response(&base.join("ghost.mp4"), None);
        assert_eq!(missing.status(), tauri::http::StatusCode::NOT_FOUND);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn lfstream_token_and_v2_path_trust_boundaries() {
        // v1 token：{hex64.ext} 形态判定（防穿越/防探测）
        let token = "a".repeat(64);
        assert!(is_v1_token(&format!("{token}.mp4")));
        assert!(!is_v1_token("short.mp4"));
        assert!(!is_v1_token("x/y.mp4"));
        assert!(!is_v1_token("../project.json"));
        assert!(!is_v1_token(&format!("{token}.ex/tra")));
        // v2 逻辑路径：validate_resource_path 信任边界（穿越/绝对路径拒绝）
        assert!(validate_resource_path("Video/m2.mp4").is_ok());
        assert!(validate_resource_path("../project.json").is_err());
        assert!(validate_resource_path("").is_err());
    }

    /// 命中面 = Android ∧ 音视频扩展名（大小写不敏感）；
    /// 桌面恒不命中（同资源在桌面继续走 lfstream，行为零变化，也不起端口）
    #[test]
    fn media_loopback_routing_is_pure_and_narrow() {
        for media in [
            "Video/m2.mp4",
            "Video/x.MP4",
            "Audio/bgm.mp3",
            "SFX/x.ogg",
            "Video/a.webm",
            "Audio/x.m4a",
        ] {
            assert!(is_media_ext(media), "{media} 应判为媒体");
            assert!(loopback_eligible(true, media));
            assert!(!loopback_eligible(false, media), "桌面不得命中（不起端口）");
        }
        for other in [
            "Images/bg.png",
            "Fonts/x.ttf",
            "Stories/start.json",
            "dist/assets/index-a1b2.js",
            "Video/noext",
            "Video/trailing.",
        ] {
            assert!(!is_media_ext(other), "{other} 不应判为媒体");
            assert!(!loopback_eligible(true, other));
        }
    }

    #[test]
    fn stream_decrypt_to_cache_round_trip_and_idempotent() {
        // 流式解密：LFEN2 封装 → in-place 解密落盘 → 内容 == 源明文；二次调用幂等复用
        let base = temp_base("lf3-stream-decrypt");
        let root = base.join("res");
        let app_data = base.join("data");
        fs::create_dir_all(root.join("Video")).unwrap();
        let plain = b"4k-video-bytes-500mb-class".to_vec();
        fs::write(
            root.join("Video/m2.mp4.enc"),
            encrypt_lfen2(&plain, KEY, "Video/m2.mp4").unwrap(),
        )
        .unwrap();

        let name = stream_decrypt_to_cache(&StdFs, &root, &app_data, KEY, "Video/m2.mp4").unwrap();
        assert!(name.ends_with(".mp4"));
        let cached = tmp_stream_dir(&app_data).join(&name);
        assert_eq!(fs::read(&cached).unwrap(), plain);

        // 幂等：第二次调用直接命中缓存（改坏源包不影响已缓存——进程内 DEK 不变）
        let name2 = stream_decrypt_to_cache(&StdFs, &root, &app_data, KEY, "Video/m2.mp4").unwrap();
        assert_eq!(name, name2);

        // 启动清理后可重建
        cleanup_tmp_stream(&app_data);
        assert!(!cached.exists());
        let name3 = stream_decrypt_to_cache(&StdFs, &root, &app_data, KEY, "Video/m2.mp4").unwrap();
        assert_eq!(
            fs::read(tmp_stream_dir(&app_data).join(&name3)).unwrap(),
            plain
        );
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn lfen2_v2_round_trip_and_tail_chunk() {
        // 尾块短块合法；块对齐/跨块/后缀 Range 全形态回读 == 源明文；全量解密等价
        let base = temp_base("lf3-v2-rt");
        fs::create_dir_all(&base).unwrap();
        let src = base.join("m.bin");
        let out = base.join("m.mp4.enc");
        let mut plain = Vec::new();
        for i in 0..(3 * 1024 + 777u32) {
            plain.extend_from_slice(&i.to_le_bytes());
        } // 12244 + 777*4 = 非对齐尾块
        fs::write(&src, &plain).unwrap();
        encrypt_lfen2_v2_file(&src, &out, KEY, "Video/m.mp4", 10).unwrap(); // 1KiB 块
        let sealed = fs::read(&out).unwrap();
        assert!(sealed.starts_with(MAGIC_LFEN2) && sealed[5] == FORMAT_VERSION_V2);

        // 全量解密（与逐块 Range 路径同一份密文：v2 走 decrypt_resource_bytes 透明分流）
        assert_eq!(
            decrypt_resource_bytes(sealed, KEY, "Video/m.mp4").unwrap(),
            plain
        );

        // 块对齐区间 / 跨块区间 / 后缀区间
        assert_eq!(
            decrypt_v2_block_range(&StdFs, &out, KEY, "Video/m.mp4", 1024, 2047).unwrap(),
            plain[1024..2048]
        );
        assert_eq!(
            decrypt_v2_block_range(&StdFs, &out, KEY, "Video/m.mp4", 1000, 3000).unwrap(),
            plain[1000..3001]
        );
        let total = plain.len() as u64;
        assert_eq!(
            decrypt_v2_block_range(&StdFs, &out, KEY, "Video/m.mp4", total - 5, total - 1).unwrap(),
            plain[plain.len() - 5..]
        );
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn lfen2_v2_guards() {
        // chunk_log2 超限 / 块数超 u32::MAX（nonce 空间）拒绝——纯算术不占内存
        assert!(v2_validate(100, 27).is_err());
        // chunk_log2 = 0 → 块长 1B：total = 2^32 字节 = 2^32 块，超 nonce 空间必拒
        assert!(v2_validate(u64::from(u32::MAX) + 1, 0).is_err());
        assert!(v2_validate(100, 22).is_ok());
    }

    #[test]
    fn lfen2_v2_block_swap_rejected() {
        // 块 AAD 绑 index——交换块 0/块 1 密文段后解密必拒（防跨块重排）
        let base = temp_base("lf3-v2-swap");
        fs::create_dir_all(&base).unwrap();
        let src = base.join("m.bin");
        let out = base.join("m.mp4.enc");
        let mut plain = (0u32..2048)
            .flat_map(|i| i.to_le_bytes())
            .collect::<Vec<u8>>();
        plain.extend_from_slice(b"tail");
        fs::write(&src, &plain).unwrap();
        encrypt_lfen2_v2_file(&src, &out, KEY, "Video/m.mp4", 10).unwrap(); // 1KiB 块
        let mut sealed = fs::read(&out).unwrap();
        let header = V2_HEADER_LEN;
        let block_len = 1024 + 16;
        let (a, b) = (header, header + block_len);
        let mut block0 = sealed[a..b].to_vec();
        let mut block1 = sealed[b..b + block_len].to_vec();
        std::mem::swap(&mut block0, &mut block1);
        sealed[a..b].copy_from_slice(&block0);
        sealed[b..b + block_len].copy_from_slice(&block1);
        assert!(decrypt_resource_bytes(sealed, KEY, "Video/m.mp4").is_err());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn lfen2_v2_truncation_rejected() {
        // 截断密文（total_len 与实际不符）→ 解密必拒
        let base = temp_base("lf3-v2-trunc");
        fs::create_dir_all(&base).unwrap();
        let src = base.join("m.bin");
        let out = base.join("m.mp4.enc");
        let plain = vec![7u8; 3000];
        fs::write(&src, &plain).unwrap();
        encrypt_lfen2_v2_file(&src, &out, KEY, "Video/m.mp4", 10).unwrap();
        let mut sealed = fs::read(&out).unwrap();
        sealed.truncate(sealed.len() - 40); // 截掉部分密文
        assert!(decrypt_resource_bytes(sealed, KEY, "Video/m.mp4").is_err());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn lfen2_v2_protocol_range_serves_plain_bytes() {
        // 协议 v2 路径：Range → 206 字节 == 源明文对应段（与 AppHandle 解耦的可测核心）
        let base = temp_base("lf3-v2-proto");
        let root = base.join("res");
        fs::create_dir_all(&root).unwrap();
        let mut plain = (0u32..1024)
            .flat_map(|i| i.to_le_bytes())
            .collect::<Vec<u8>>();
        plain.extend_from_slice(b"4K-TAIL"); // total = 4103，chunk = 1KiB
        let src = root.join("src.bin");
        fs::write(&src, &plain).unwrap();
        encrypt_lfen2_v2_file(
            &src,
            &root.join("Video/m2.mp4.enc"),
            KEY,
            "Video/m2.mp4",
            10,
        )
        .unwrap();

        let req_for = |range: Option<String>| {
            let mut b =
                tauri::http::Request::builder().uri("http://lfstream.localhost/v2/Video%2Fm2.mp4");
            if let Some(r) = range {
                b = b.header("range", r);
            }
            b.body(Vec::new()).unwrap()
        };

        // 206：跨块区间字节精确
        let resp = handle_v2_range_with(
            &StdFs,
            req_for(Some("bytes=100-2059".into())),
            "Video%2Fm2.mp4",
            &root,
            KEY,
        );
        assert_eq!(resp.status(), tauri::http::StatusCode::PARTIAL_CONTENT);
        assert_eq!(resp.body().as_slice(), &plain[100..=2059]);
        assert_eq!(resp.headers()["content-type"], "video/mp4");
        assert_eq!(
            resp.headers()["content-range"],
            "bytes 100-2059/4103".as_bytes() as &[u8]
        );

        // 越界 Range → 416
        let bad = handle_v2_range_with(
            &StdFs,
            req_for(Some("bytes=999999-".into())),
            "Video%2Fm2.mp4",
            &root,
            KEY,
        );
        assert_eq!(bad.status(), tauri::http::StatusCode::RANGE_NOT_SATISFIABLE);

        // 无 Range → 200 全量
        let full = handle_v2_range_with(&StdFs, req_for(None), "Video%2Fm2.mp4", &root, KEY);
        assert_eq!(full.status(), tauri::http::StatusCode::OK);
        assert_eq!(full.body().as_slice(), plain.as_slice());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn range_query_channel_parsing() {
        // URL-query 通道取值：percent 解码 + 只认第一个 range 键 + 其余键忽略
        assert_eq!(range_query_value(None), None);
        assert_eq!(range_query_value(Some("")), None);
        assert_eq!(
            range_query_value(Some("range=bytes%3D0-1023")),
            Some("bytes=0-1023".to_string())
        );
        assert_eq!(
            range_query_value(Some("a=1&range=bytes%3D10-19&b=2")),
            Some("bytes=10-19".to_string())
        );
        assert_eq!(range_query_value(Some("start=0&end=9")), None);

        // 严格解析：三形态成立（显式/开放尾/后缀），畸形与越界一律 None（fail-closed）
        assert_eq!(parse_range_strict("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range_strict("bytes=90-999", 100), Some((90, 99))); // end 超界钳尾
        assert_eq!(parse_range_strict("bytes=90-", 100), Some((90, 99)));
        assert_eq!(parse_range_strict("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range_strict("bytes=100-", 100), None); // start 越界
        assert_eq!(parse_range_strict("bytes=50-10", 100), None); // 区间倒置
        assert_eq!(parse_range_strict("garbage", 100), None);
        assert_eq!(parse_range_strict("bytes=xx-yy", 100), None);
        assert_eq!(parse_range_strict("bytes=-0", 100), None);
        assert_eq!(parse_range_strict("bytes=0-", 0), None); // 空文件无区间可取
    }

    #[test]
    fn android_range_query_channel_serves_exact_200() {
        // URL-query 区间通道（请求不带 `Range` 头）→
        // 200 精确切片 + `X-Total-Size`，且**不带** `Content-Range`/`Accept-Ranges`
        // （请求本无 Range 头，若仍以 range 语义回响应会再次落进 WebView 的二次偏移）。
        let base = temp_base("lf3-range-query");
        let root = base.join("res");
        fs::create_dir_all(&root).unwrap();
        let mut plain = (0u32..1024)
            .flat_map(|i| i.to_le_bytes())
            .collect::<Vec<u8>>();
        plain.extend_from_slice(b"4K-TAIL"); // total = 4103，chunk = 1KiB
        let src = root.join("src.bin");
        fs::write(&src, &plain).unwrap();
        encrypt_lfen2_v2_file(
            &src,
            &root.join("Video/m2.mp4.enc"),
            KEY,
            "Video/m2.mp4",
            10,
        )
        .unwrap();

        let call = |uri: &str, range: Option<&str>| {
            let mut b = tauri::http::Request::builder().uri(uri);
            if let Some(r) = range {
                b = b.header("range", r);
            }
            let req = b.body(Vec::new()).unwrap();
            handle_v2_range_with(&StdFs, req, "Video%2Fm2.mp4", &root, KEY)
        };

        // 200 + 字节精确 + 头集合收敛（无 Content-Range/Accept-Ranges）
        let resp = call(
            "http://lfstream.localhost/v2/Video%2Fm2.mp4?range=bytes%3D100-2059",
            None,
        );
        assert_eq!(resp.status(), tauri::http::StatusCode::OK);
        assert_eq!(resp.body().as_slice(), &plain[100..=2059]);
        assert_eq!(resp.headers()["x-total-size"], "4103".as_bytes() as &[u8]);
        assert_eq!(resp.headers()["content-type"], "video/mp4");
        assert!(resp.headers().get("content-range").is_none());
        assert!(resp.headers().get("accept-ranges").is_none());

        // query 优先于头：并存的冲突 `Range` 头不参与（仍是 query 的窗口）
        let resp = call(
            "http://lfstream.localhost/v2/Video%2Fm2.mp4?range=bytes%3D100-2059",
            Some("bytes=0-9"),
        );
        assert_eq!(resp.body().as_slice(), &plain[100..=2059]);

        // 后缀形态同源复用
        let resp = call(
            "http://lfstream.localhost/v2/Video%2Fm2.mp4?range=bytes%3D-8",
            None,
        );
        assert_eq!(resp.status(), tauri::http::StatusCode::OK);
        assert_eq!(resp.body().as_slice(), &plain[4095..4103]);

        // 畸形/越界 = 416（fail-closed：显式通道静默退化会放大成一次全文件解密）
        for bad in [
            "bytes%3Dxx-yy",
            "bytes%3D999999-",
            "garbage",
            "bytes%3D50-10",
        ] {
            let resp = call(
                &format!("http://lfstream.localhost/v2/Video%2Fm2.mp4?range={bad}"),
                None,
            );
            assert_eq!(
                resp.status(),
                tauri::http::StatusCode::RANGE_NOT_SATISFIABLE,
                "query 值 {bad} 应 fail-closed"
            );
            assert!(resp.body().is_empty());
        }

        // 头通道语义未受影响（同一资源、同一函数）：206 + Content-Range 字节精确
        let resp = call(
            "http://lfstream.localhost/v2/Video%2Fm2.mp4",
            Some("bytes=100-2059"),
        );
        assert_eq!(resp.status(), tauri::http::StatusCode::PARTIAL_CONTENT);
        assert_eq!(resp.body().as_slice(), &plain[100..=2059]);
        assert_eq!(
            resp.headers()["content-range"],
            "bytes 100-2059/4103".as_bytes() as &[u8]
        );
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn v2_block_lru_cache_bounds_and_isolation() {
        // 有界 LRU（容量/淘汰序/刷新保真）+ 路径参与键不串味 + 计数
        let mut cache = V2BlockCache::new(2_400); // 恰容 2 块（1000B 块）
        let fp = v2_key_fp(KEY);
        let k = |name: &str, index: u64| V2CacheKey {
            enc: PathBuf::from(format!("/{name}.enc")),
            logical: name.to_string(),
            index,
            key_fp: fp,
        };
        cache.put(k("a", 0), vec![7u8; 1000]);
        cache.put(k("a", 1), vec![8u8; 1000]);
        assert!(cache.get(&k("a", 0)).is_some()); // 刷新 a0 → a1 变最旧
        cache.put(k("a", 2), vec![9u8; 1000]); // 超容 → 淘汰 a1
        assert!(cache.get(&k("a", 1)).is_none()); // 被淘 = miss
        assert_eq!(cache.get(&k("a", 2)).unwrap(), vec![9u8; 1000]); // 新入未被误淘
        assert_eq!(cache.get(&k("a", 0)).unwrap(), vec![7u8; 1000]); // LRU 刷新保真
        cache.put(k("b", 0), vec![1u8; 1000]); // 淘汰 a2（此时最旧）
        assert_eq!(cache.get(&k("a", 0)).unwrap()[0], 7); // 同块号不同路径不串味
        assert_eq!(cache.get(&k("b", 0)).unwrap()[0], 1);
        assert_eq!((cache.hits, cache.misses), (5, 1));
        assert_eq!(cache.bytes, 2000);
        assert_eq!(cache.entries.len(), 2);
        cache.put(k("c", 0), vec![0u8; 5_000]); // 单块超上限 → 跳过缓存
        assert!(cache.get(&k("c", 0)).is_none());
        let mut disabled = V2BlockCache::new(0); // cap=0 = 禁用
        disabled.put(k("d", 0), vec![1u8; 10]);
        assert!(disabled.get(&k("d", 0)).is_none());
    }

    #[test]
    fn v2_block_lru_cache_wired_through_block_range() {
        // 全局缓存经 decrypt_v2_block_range 生效：同块二次 Range 命中（计数上升）且逐字节一致；
        // 同块号不同资源（路径参与键）互不串味
        let base = temp_base("lf3-v2-lru");
        fs::create_dir_all(&base).unwrap();
        let mk = |name: &str, fill: u8| -> (PathBuf, Vec<u8>) {
            let src = base.join(format!("{name}.bin"));
            let plain = vec![fill; 3 * 1024]; // 3 块（1KiB 块）
            fs::write(&src, &plain).unwrap();
            let out = base.join(format!("{name}.mp4.enc"));
            encrypt_lfen2_v2_file(&src, &out, KEY, &format!("Video/{name}.mp4"), 10).unwrap();
            (out, plain)
        };
        let (enc_a, plain_a) = mk("lru-a", 0xAA);
        let (enc_b, plain_b) = mk("lru-b", 0xBB);
        let (h0, _) = v2_block_cache_stats();
        let r1 = decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 0, 1023).unwrap();
        let r2 = decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 0, 1023).unwrap();
        assert_eq!(r1, r2);
        assert_eq!(r1, &plain_a[..1024]);
        let (h1, _) = v2_block_cache_stats();
        assert!(h1 > h0, "缓存命中计数应上升：{h0} → {h1}");
        let rb = decrypt_v2_block_range(&StdFs, &enc_b, KEY, "Video/lru-b.mp4", 0, 1023).unwrap();
        assert_eq!(rb, &plain_b[..1024]);
        assert_ne!(rb, r1);
        // 跨块 Range（块 1 miss 后回填）→ 复取命中
        let s1 =
            decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 1024, 2047).unwrap();
        let s2 =
            decrypt_v2_block_range(&StdFs, &enc_a, KEY, "Video/lru-a.mp4", 1024, 2047).unwrap();
        assert_eq!(s1, s2);
        assert_eq!(s1, &plain_a[1024..2048]);
        let (h2, m2) = v2_block_cache_stats();
        assert!(h2 > h1);
        assert!(m2 > 0);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn seed_import_writes_envelope() {
        // seed 存在 → 导入并写 KEK 信封；信封优先
        let base = std::env::temp_dir().join(format!(
            "lf3-dek-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&base).unwrap();
        let resource_root = base.join("res");
        fs::create_dir_all(&resource_root).unwrap();
        // 生成 seed（不打 keyring：直接写 32B）
        let seed = generate_resource_seed().unwrap();
        fs::write(resource_root.join(DEK_SEED), &seed).unwrap();
        // resource_dek 走 keyring（本机 KEK）——信封写入后 seed 仍在，但信封优先路径生效
        let dek = resource_dek(&base, &resource_root, &StdFs).unwrap();
        assert_eq!(dek, seed);
        assert!(base.join(DEK_ENVELOPE).is_file());
        // 信封已存在 → seed 删除后仍可取（运行时产出形态回退信封）
        fs::remove_file(resource_root.join(DEK_SEED)).unwrap();
        let dek2 = resource_dek(&base, &resource_root, &StdFs).unwrap();
        assert_eq!(dek2, seed);
        // 包更新语义：seed 换新 → DEK 跟随新 seed（信封幂等重导入，覆盖旧 DEK）
        fs::remove_file(base.join(DEK_ENVELOPE)).unwrap();
        let new_seed = generate_resource_seed().unwrap();
        fs::write(resource_root.join(DEK_SEED), &new_seed).unwrap();
        let dek3 = resource_dek(&base, &resource_root, &StdFs).unwrap();
        assert_eq!(dek3, new_seed);
        // 无信封无 seed → MissingKey
        fs::remove_file(base.join(DEK_ENVELOPE)).unwrap();
        fs::remove_file(resource_root.join(DEK_SEED)).unwrap();
        assert!(matches!(
            resource_dek(&base, &resource_root, &StdFs),
            Err(ResourceCryptoError::MissingKey)
        ));
        fs::remove_dir_all(&base).ok();
    }
}
