//! 05 §二 资源加密：LFEN2 格式 + 灵泛 LFEN 兼容读（K8）+ 资源 DEK 的 KEK 信封（§三）。
//!
//! 格式（自描述，K6 解密失败 fail-closed 不降级明文）：
//! - LFEN2 v1：`"LFEN2"(5B) | version u8 | nonce(12) | tag(16) | ciphertext`
//!   AAD = `LFEN2:resource:{逻辑路径}`——K3 精神：资源与路径绑定，跨路径搬移必拒。
//! - 灵泛 LFEN v1（兼容读）：`"LFEN"(4B) | version u8 | nonce(12) | tag(16) | ciphertext`（无 AAD）。
//!
//! 密钥（§三：迁移文档编译期密钥是降级，此处修正）：
//! 资源 DEK 构建时随机生成；运行时以 KEK 信封存放在 app data（`resources.dek.lfk2`），
//! 首次运行从包内 `__key__.seed`（32B 原始 DEK，构建产物）导入并立即封装——运行态零明文密钥落盘（K1）。
//! 加密包内文件名 = 原逻辑路径 + `.enc`（灵泛 ResourceEncryptor 语义照搬）。

use crate::crypto::{gcm_open, gcm_seal, kek_from_keyring, random_bytes, KEK_SERVICE, KEK_USER};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

/// 新格式魔数（5 字节，与灵泛 4 字节 LFEN 无前缀歧义）
const MAGIC_LFEN2: &[u8; 5] = b"LFEN2";
/// 灵泛 v1 魔数（兼容读，K8）
const MAGIC_LFEN: &[u8; 4] = b"LFEN";
const FORMAT_VERSION: u8 = 1;
const DEK_LEN: usize = 32;
/// 资源密钥信封文件（app data 内，KEK 封装）
const DEK_ENVELOPE: &str = "resources.dek.lfk2";
/// 构建产物：包内原始 DEK（首次运行导入后转信封；只读资源根不删——分发窗口边界见 agent.md 设计注记）
const DEK_SEED: &str = "__key__.seed";
const AAD_RESOURCE_PREFIX: &str = "LFEN2:resource:";
const AAD_RESOURCE_DEK: &[u8] = b"LFK2:resource-dek";
/// IPC 单次回传上限：仅限**文本供给路径**（故事/overlay——故事文件受组装器约束天然小于此）。
/// 媒体资源不走 IPC（⑨-4c：decrypt_resource 统一流式到临时缓存，此护栏对其不再适用）。
const IPC_SIZE_LIMIT: u64 = 32 * 1024 * 1024;
/// ⑨-4c 临时流缓存目录（app data 内）：进程生命周期 = 缓存生命周期，启动清理
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
            ResourceCryptoError::TooLarge { size, limit } => write!(
                f,
                "资源过大（{size} > {limit}）：大资源走临时文件 + 自定义协议流式路径（待实施）"
            ),
        }
    }
}

impl std::error::Error for ResourceCryptoError {}

/// 逻辑路径信任边界（与静态 ResourcePort 同判）：拒绝 `..`、空段与绝对路径
fn validate_resource_path(path: &str) -> Result<(), ResourceCryptoError> {
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

/// 是否为加密资源（魔数检测，灵泛 IsEncrypted 语义）
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

/// 解密：魔数分流 LFEN2（校验版本 + AAD 绑路径）/ 灵泛 LFEN（无 AAD，K8）；其他 = BadFormat（K6）
pub fn decrypt_resource_bytes(
    file: &[u8],
    key: &[u8],
    path: &str,
) -> Result<Vec<u8>, ResourceCryptoError> {
    if file.starts_with(MAGIC_LFEN2) {
        if file.len() < MAGIC_LFEN2.len() + 1 + 12 + 16 {
            return Err(ResourceCryptoError::BadFormat("LFEN2 文件过短".into()));
        }
        let version = file[MAGIC_LFEN2.len()];
        if version != FORMAT_VERSION {
            return Err(ResourceCryptoError::BadFormat(format!(
                "LFEN2 版本不支持：{version}"
            )));
        }
        let sealed = &file[MAGIC_LFEN2.len() + 1..];
        return gcm_open(key, sealed, &aad_for(path)).map_err(ResourceCryptoError::Crypto);
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
        let sealed = &file[MAGIC_LFEN.len() + 1..];
        // 灵泛 LFEN 无 AAD（存量资源不浪费，K8）
        return gcm_open(key, sealed, &[]).map_err(ResourceCryptoError::Crypto);
    }
    Err(ResourceCryptoError::BadFormat(
        "魔数不符（非 LFEN2/LFEN，K6 不降级明文）".into(),
    ))
}

/// 生成构建产物：随机资源 DEK（打包工具写入 `__key__.seed`）
pub fn generate_resource_seed() -> Result<Vec<u8>, ResourceCryptoError> {
    random_bytes(DEK_LEN).map_err(ResourceCryptoError::Crypto)
}

/// 运行时资源 DEK：信封优先（app data）；无信封则从包内 seed 导入并立即 KEK 封装。
pub fn resource_dek(app_data: &Path, resource_root: &Path) -> Result<Vec<u8>, ResourceCryptoError> {
    let envelope = app_data.join(DEK_ENVELOPE);
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
    let seed = resource_root.join(DEK_SEED);
    if !seed.is_file() {
        return Err(ResourceCryptoError::MissingKey);
    }
    let dek = fs::read(&seed).map_err(io)?;
    if dek.len() != DEK_LEN {
        return Err(ResourceCryptoError::Crypto(
            "seed 长度不符（须 32 字节）".into(),
        ));
    }
    let kek = kek_from_keyring(KEK_SERVICE, KEK_USER).map_err(ResourceCryptoError::Crypto)?;
    let sealed = gcm_seal(&kek, &dek, AAD_RESOURCE_DEK).map_err(ResourceCryptoError::Crypto)?;
    fs::write(&envelope, &sealed).map_err(io)?; // 导入即封装：运行态零明文密钥落盘（K1）
    Ok(dek)
}

/// 读取并解密单个加密资源（`逻辑路径` → `逻辑路径.enc`；明文文件不落回——K6 fail-closed）
fn read_encrypted(
    resource_root: &Path,
    key: &[u8],
    path: &str,
) -> Result<Vec<u8>, ResourceCryptoError> {
    validate_resource_path(path)?;
    let file = resource_root.join(format!("{path}.enc"));
    if !file.is_file() {
        return Err(ResourceCryptoError::Io(format!(
            "加密资源不存在：{path}.enc"
        )));
    }
    let size = file.metadata().map_err(io)?.len();
    if size > IPC_SIZE_LIMIT {
        return Err(ResourceCryptoError::TooLarge {
            size,
            limit: IPC_SIZE_LIMIT,
        });
    }
    let data = fs::read(&file).map_err(io)?;
    decrypt_resource_bytes(&data, key, path)
}

/// 05 §二.2 `decrypt_resource(path)`（⑨-4c 流式改造）：解密到临时流缓存（app data 内，
/// 同资源幂等复用）→ 返回 JSON `{"file":"<缓存文件名>"}`；前端 `convertFileSrc(file,
/// "lfstream")` 构造自定义协议 URL 带 Range 流式拉取（video/audio seek 友好）。
/// 旧「IPC 全量字节 + Blob revoke」路径废弃——32MB IPC 护栏随之消失，4K 500MB 级素材可播；
/// 内存 = 单倍密文（in-place 解密）。缓存随应用启动清理（进程内 DEK 不变 → 同路径同内容）。
#[tauri::command]
pub fn decrypt_resource(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, ResourceCryptoError> {
    let root = resource_root(&app)?;
    let app_data = app_data(&app);
    let key = resource_dek(&app_data, &root)?;
    let _guard = STREAM_DECRYPT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let file = stream_decrypt_to_cache(&root, &app_data, &key, &path)?;
    Ok(serde_json::json!({ "file": file }).to_string())
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
pub fn stream_decrypt_to_cache(
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
    if !sealed_path.is_file() {
        return Err(ResourceCryptoError::Io(format!(
            "加密资源不存在：{path}.enc"
        )));
    }
    let size = sealed_path.metadata().map_err(io)?.len();
    if size > STREAM_SIZE_LIMIT {
        return Err(ResourceCryptoError::TooLarge {
            size,
            limit: STREAM_SIZE_LIMIT,
        });
    }
    let buf = fs::read(&sealed_path).map_err(io)?;
    // 复用通用解密器（LFEN2 版本校验/LFEN 兼容 K8/AAD 绑路径全在内部）；
    // 内存峰值 = 密文 + 明文双倍——分块流式解密（格式 v2）待后续批次
    let plain = decrypt_resource_bytes(&buf, key, path)?;
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

/// lfstream 协议入口：URL path → 缓存文件 → 流式响应。
/// token 文件名信任边界：只允许 `{hex64}.{alnum ext}` 形态（URL 由 convertFileSrc
/// 从本命令返回的 file 名构造，非本协议产物的路径一律拒绝——防穿越/防探测）。
/// 统一加 CORS 头：页面源（localhost:1420）与协议源（lfstream.localhost）跨源，
/// webview fetch/媒体元素拉流需要显式放行（Tauri asset 协议同做法）。
pub fn lfstream_protocol_handler(
    request: tauri::http::Request<Vec<u8>>,
    cache_dir: &Path,
) -> tauri::http::Response<Vec<u8>> {
    let mut resp = handle_stream_request(request, cache_dir);
    resp.headers_mut().insert(
        tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        tauri::http::HeaderValue::from_static("*"),
    );
    // fetch 可读 Range 相关头（浏览器默认只暴露 safelist；媒体元素内部不受此限）
    resp.headers_mut().insert(
        tauri::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        tauri::http::HeaderValue::from_static(
            "content-range,content-length,content-type,accept-ranges",
        ),
    );
    resp
}

fn handle_stream_request(
    request: tauri::http::Request<Vec<u8>>,
    cache_dir: &Path,
) -> tauri::http::Response<Vec<u8>> {
    let raw = request.uri().path().trim_start_matches('/');
    let valid = {
        let mut parts = raw.split('.');
        let (token, ext) = (parts.next(), parts.next());
        parts.next().is_none()
            && raw.len() == 64 + 1 + ext.unwrap_or("").len()
            && token.is_some_and(|t| t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit()))
            && ext.is_some_and(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric()))
    };
    if !valid {
        return tauri::http::Response::builder()
            .status(tauri::http::StatusCode::BAD_REQUEST)
            .body(Vec::new())
            .expect("静态 400 响应构造不可失败");
    }
    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
    stream_range_response(&cache_dir.join(raw), range)
}

/// 05 §五 `decrypt_story(path) -> String`：加密故事文本解密（UTF-8 校验 fail-closed）
#[tauri::command]
pub fn decrypt_story(app: tauri::AppHandle, path: String) -> Result<String, ResourceCryptoError> {
    let root = resource_root(&app)?;
    let app_data = app_data(&app);
    let key = resource_dek(&app_data, &root)?;
    let plain = read_encrypted(&root, &key, &path)?;
    String::from_utf8(plain).map_err(|_| ResourceCryptoError::BadFormat("故事资源非 UTF-8".into()))
}

/// 打包工具：目录批量加密（灵泛 EncryptDirectoryAsync 语义照搬）——按扩展名过滤、
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
    let mut written = Vec::new();
    encrypt_directory_inner(
        input,
        input,
        output,
        key,
        extensions,
        exclusions,
        &mut written,
    )?;
    Ok(written)
}

/// 排除判定：排除项精确匹配文件，或以 `目录/` 前缀匹配整棵子树
fn is_excluded(rel_str: &str, exclusions: &[&str]) -> bool {
    exclusions
        .iter()
        .any(|x| rel_str == *x || (x.ends_with('/') && rel_str.starts_with(*x)))
}

fn encrypt_directory_inner(
    root: &Path,
    dir: &Path,
    output: &Path,
    key: &[u8],
    extensions: &[&str],
    exclusions: &[&str],
    written: &mut Vec<PathBuf>,
) -> Result<(), ResourceCryptoError> {
    let entries = fs::read_dir(dir).map_err(io)?;
    for entry in entries {
        let path = entry.map_err(io)?.path();
        if path.is_dir() {
            encrypt_directory_inner(root, &path, output, key, extensions, exclusions, written)?;
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(&path);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if is_excluded(&rel_str, exclusions) || rel_str.starts_with('.') || rel_str.contains("/.") {
            continue; // 排除项与点文件（隐藏/系统）不进包
        }
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !extensions.iter().any(|e| *e == ext) {
            continue;
        }
        let out = output.join(format!("{rel_str}.enc"));
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let data = fs::read(&path).map_err(io)?;
        if is_encrypted(&data) {
            fs::write(&out, &data).map_err(io)?; // 已加密：原样复制（幂等重打包）
        } else {
            fs::write(&out, encrypt_lfen2(&data, key, &rel_str)?).map_err(io)?;
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

/// 打包输出排除集：清单（明文转换）+ 运行时生成的存档目录 + 包内密钥种子（输出侧专属）
const PACK_EXCLUSIONS: &[&str] = &["project.json", "Saves/", "__key__.seed"];

/// 打包结果报告
#[derive(Debug, Serialize)]
pub struct PackReport {
    pub files: usize,
}

/// ⑨-4b 打包编排：明文工程根 → 加密发布根（lfenpack CLI 的可测核心）。
/// - 输出根 fail-closed：已存在且非空 = 拒绝（不覆盖创作者成果；`--force` 由 CLI 显式清空后重入）
/// - 清单恒明文转换：`resourceEncryption` 置 true（运行时形态判定依赖清单先可读，05 §二）
/// - DEK 新生成 → 写输出根 `__key__.seed`（运行时首次导入即 KEK 封装，K1）
/// - 内容文件全量 LFEN2（白名单扩展 + 排除集），`原路径 + .enc`，结构保留
/// - 完整性自检：输出逐文件解密回读 == 源明文（round-trip，打包完整性 fail-closed）
pub fn pack_project(input: &Path, output: &Path) -> Result<PackReport, ResourceCryptoError> {
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

    // 内容文件批量加密 + 完整性自检
    let written = encrypt_directory(input, output, &seed, PACK_EXTENSIONS, PACK_EXCLUSIONS)?;
    for out_path in &written {
        let sealed = fs::read(out_path).map_err(io)?;
        let rel_str = out_path
            .strip_prefix(output)
            .map_err(|e| ResourceCryptoError::Io(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let logical = rel_str
            .strip_suffix(".enc")
            .ok_or_else(|| ResourceCryptoError::Io(format!("加密输出缺 .enc 后缀：{rel_str}")))?;
        let plain = decrypt_resource_bytes(&sealed, &seed, logical)?;
        let source = input.join(logical);
        if fs::read(&source).map_err(io)? != plain {
            return Err(ResourceCryptoError::Io(format!(
                "打包自检失败（回读 ≠ 源明文）：{logical}"
            )));
        }
    }
    Ok(PackReport {
        files: written.len(),
    })
}

fn app_data(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data 目录不可用")
}

fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, ResourceCryptoError> {
    // 单一定位事实源（project_files::locate_resource_root）——dev 走源根/env 覆盖，
    // 与故事供给同根；否则媒体链读 target 拷贝而故事读源根，两链分裂（实测踩坑）
    Ok(crate::project_files::locate_resource_root(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &[u8; 32] = b"0123456789abcdef0123456789abcdef";

    #[test]
    fn lfen2_round_trip() {
        // 锚点 resource-encryption-roundtrip
        let plain = b"audio-bytes".to_vec();
        let sealed = encrypt_lfen2(&plain, KEY, "Audio/x.mp3").unwrap();
        assert!(sealed.starts_with(MAGIC_LFEN2));
        assert_eq!(
            decrypt_resource_bytes(&sealed, KEY, "Audio/x.mp3").unwrap(),
            plain
        );
    }

    #[test]
    fn lfen_legacy_read() {
        // K8 锚点 lfen-legacy-read：灵泛 LFEN（magic4|version1|nonce12|tag16|ct，无 AAD）兼容解密
        let legacy = [
            b"LFEN".as_slice(),
            &[1u8],
            &[7u8; 12], // nonce
            b"legacy-plain".as_slice(),
            &[0u8; 16], // tag 占位（实际由 gcm 生成，这里构造非法 tag 走失败路径；成功路径见下）
        ]
        .concat();
        // 真实灵泛样本：用 gcm_seal（无 AAD）手工构造
        let sealed = crate::crypto::gcm_seal(KEY, b"legacy-plain", &[]).unwrap();
        let real = [b"LFEN".as_slice(), &[1u8], sealed.as_slice()].concat();
        assert_eq!(
            decrypt_resource_bytes(&real, KEY, "whatever").unwrap(),
            b"legacy-plain".to_vec()
        );
        // 坏 tag 的样本必须 fail-closed
        assert!(matches!(
            decrypt_resource_bytes(&legacy, KEY, "whatever"),
            Err(ResourceCryptoError::Crypto(_))
        ));
    }

    #[test]
    fn aad_binds_resource_path() {
        // K3 精神锚点 resource-aad-path-binding：加密时路径 A，按路径 B 解密必拒
        let sealed = encrypt_lfen2(b"data", KEY, "Audio/a.mp3").unwrap();
        assert!(matches!(
            decrypt_resource_bytes(&sealed, KEY, "Audio/b.mp3"),
            Err(ResourceCryptoError::Crypto(_))
        ));
    }

    #[test]
    fn tamper_and_bad_magic_fail_closed() {
        // K6 锚点 decrypt-fail-closed：篡改必拒、非密文不降级明文
        let mut sealed = encrypt_lfen2(b"secret", KEY, "Video/v.mp4").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xFF;
        assert!(matches!(
            decrypt_resource_bytes(&sealed, KEY, "Video/v.mp4"),
            Err(ResourceCryptoError::Crypto(_))
        ));
        assert!(matches!(
            decrypt_resource_bytes(b"plain-bytes", KEY, "x"),
            Err(ResourceCryptoError::BadFormat(_))
        ));
    }

    #[test]
    fn path_traversal_rejected() {
        // 锚点 resource-path-traversal：`..`/空段/绝对路径拒绝
        for bad in ["../x", "a//b", "/abs", "a/./b", "a\\b", ""] {
            assert!(matches!(
                validate_resource_path(bad),
                Err(ResourceCryptoError::InvalidPath(_))
            ));
        }
    }

    #[test]
    fn encrypt_directory_filters_and_preserves_structure() {
        // 灵泛语义锚点 pack-tool-encrypt-directory：扩展名过滤 + 结构保留 + .enc 命名 + 已加密幂等复制
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
            decrypt_resource_bytes(&sealed, KEY, "Audio/x.mp3").unwrap(),
            b"mp3-data".to_vec()
        );
        // 幂等：已加密输入原样复制
        let again = encrypt_directory(&input, &output, KEY, &["mp3", "json"], &[]).unwrap();
        assert_eq!(again.len(), 2);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn pack_project_round_trip_and_layout() {
        // ⑨-4b：拟态打包——清单明文转换 + 内容全加密 + 排除集 + seed + round-trip 自检
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
            decrypt_resource_bytes(&sealed, &seed, "Stories/a.json").unwrap(),
            b"{\"commands\":[]}".to_vec()
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
    fn lfstream_protocol_handler_rejects_non_token_paths() {
        // 信任边界：非 {hex64.ext} 形态一律 400（防穿越/防探测）
        let base = temp_base("lf3-protocol");
        fs::create_dir_all(&base).unwrap();
        let req_for = |p: &str| {
            tauri::http::Request::builder()
                .uri(format!("http://lfstream.localhost/{p}"))
                .body(Vec::new())
                .unwrap()
        };
        let token = "a".repeat(64);
        assert_eq!(
            lfstream_protocol_handler(req_for("../project.json"), &base).status(),
            tauri::http::StatusCode::BAD_REQUEST
        );
        assert_eq!(
            lfstream_protocol_handler(req_for("short.mp4"), &base).status(),
            tauri::http::StatusCode::BAD_REQUEST
        );
        assert_eq!(
            lfstream_protocol_handler(req_for("x/y.mp4"), &base).status(),
            tauri::http::StatusCode::BAD_REQUEST
        );
        // 合法 token 但文件不存在 → 404
        assert_eq!(
            lfstream_protocol_handler(req_for(&format!("{token}.mp4")), &base).status(),
            tauri::http::StatusCode::NOT_FOUND
        );
        fs::remove_dir_all(&base).ok();
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

        let name = stream_decrypt_to_cache(&root, &app_data, KEY, "Video/m2.mp4").unwrap();
        assert!(name.ends_with(".mp4"));
        let cached = tmp_stream_dir(&app_data).join(&name);
        assert_eq!(fs::read(&cached).unwrap(), plain);

        // 幂等：第二次调用直接命中缓存（改坏源包不影响已缓存——进程内 DEK 不变）
        let name2 = stream_decrypt_to_cache(&root, &app_data, KEY, "Video/m2.mp4").unwrap();
        assert_eq!(name, name2);

        // 启动清理后可重建
        cleanup_tmp_stream(&app_data);
        assert!(!cached.exists());
        let name3 = stream_decrypt_to_cache(&root, &app_data, KEY, "Video/m2.mp4").unwrap();
        assert_eq!(
            fs::read(tmp_stream_dir(&app_data).join(&name3)).unwrap(),
            plain
        );
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn seed_import_writes_envelope() {
        // 锚点 resource-dek-import：seed 存在 → 导入并写 KEK 信封；信封优先
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
        let dek = resource_dek(&base, &resource_root).unwrap();
        assert_eq!(dek, seed);
        assert!(base.join(DEK_ENVELOPE).is_file());
        // 信封已存在 → seed 删除后仍可取（信封优先）
        fs::remove_file(resource_root.join(DEK_SEED)).unwrap();
        let dek2 = resource_dek(&base, &resource_root).unwrap();
        assert_eq!(dek2, seed);
        // 无信封无 seed → MissingKey
        fs::remove_file(base.join(DEK_ENVELOPE)).unwrap();
        assert!(matches!(
            resource_dek(&base, &resource_root),
            Err(ResourceCryptoError::MissingKey)
        ));
        fs::remove_dir_all(&base).ok();
    }
}
