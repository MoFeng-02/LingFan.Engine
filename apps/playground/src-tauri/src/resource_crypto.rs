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
use std::fs;
use std::path::{Path, PathBuf};
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
/// IPC 单次回传上限：超限 fail-closed（05 §二.2 大资源应走临时文件 + 自定义协议流式，待实施）
const IPC_SIZE_LIMIT: u64 = 32 * 1024 * 1024;

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

/// 05 §五 `decrypt_resource(path)`：小资源经 IPC 回字节流（`tauri::ipc::Response`
/// 原始字节优化通道）→ 前端 Blob + createObjectURL → 用后 revoke（§二.1）。
#[tauri::command]
pub fn decrypt_resource(
    app: tauri::AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, ResourceCryptoError> {
    let root = resource_root(&app)?;
    let app_data = app_data(&app);
    let key = resource_dek(&app_data, &root)?;
    let plain = read_encrypted(&root, &key, &path)?;
    Ok(tauri::ipc::Response::new(plain))
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
pub fn encrypt_directory(
    input: &Path,
    output: &Path,
    key: &[u8],
    extensions: &[&str],
) -> Result<Vec<PathBuf>, ResourceCryptoError> {
    let mut written = Vec::new();
    encrypt_directory_inner(input, input, output, key, extensions, &mut written)?;
    Ok(written)
}

fn encrypt_directory_inner(
    root: &Path,
    dir: &Path,
    output: &Path,
    key: &[u8],
    extensions: &[&str],
    written: &mut Vec<PathBuf>,
) -> Result<(), ResourceCryptoError> {
    let entries = fs::read_dir(dir).map_err(io)?;
    for entry in entries {
        let path = entry.map_err(io)?.path();
        if path.is_dir() {
            encrypt_directory_inner(root, &path, output, key, extensions, written)?;
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(&path);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
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

fn app_data(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data 目录不可用")
}

fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, ResourceCryptoError> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| ResourceCryptoError::Io(e.to_string()))?;
    Ok(resource.join("Resources"))
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

        let written = encrypt_directory(&input, &output, KEY, &["mp3", "json"]).unwrap();
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
        let again = encrypt_directory(&input, &output, KEY, &["mp3", "json"]).unwrap();
        assert_eq!(again.len(), 2);
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
