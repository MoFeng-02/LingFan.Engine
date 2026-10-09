//! 工程供给：资源根定位、清单解析、故事文件收集与 UTF-8 校验。

use crate::resource_fs::ResourceFs;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;
use tauri::Manager;

/// 工程清单文件名（资源根内的提交点）。
const MANIFEST_FILE: &str = "project.json";

/// 故事文件目录名（资源根内的列文件根）。
const STORIES_DIR: &str = "Stories";

/// 工程供给失败的原因：资源根不可用、清单缺失或损坏、故事目录缺失、
/// 加密故事缺少密钥、读取失败、监视不可用。
/// 序列化为 `{code, detail}`，前端按 `code` 分支处理。
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum ProjectFilesError {
    #[serde(rename = "resource-dir")]
    ResourceDir(String),
    #[serde(rename = "mobile-asset")]
    MobileAsset(String),
    #[serde(rename = "io")]
    Io(String),
    #[serde(rename = "missing-manifest")]
    MissingManifest,
    #[serde(rename = "bad-manifest")]
    BadManifest(String),
    #[serde(rename = "missing-stories")]
    MissingStories,
    #[serde(rename = "decrypt")]
    Decrypt(String),
    #[serde(rename = "watch")]
    Watch(String),
    #[serde(rename = "watch-dev-only")]
    WatchDevOnly,
}

impl std::fmt::Display for ProjectFilesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectFilesError::ResourceDir(m) => write!(f, "资源目录不可用：{m}"),
            ProjectFilesError::MobileAsset(m) => {
                write!(f, "移动端资源经 asset 协议供给（{m}），待接 fs 插件读取")
            }
            ProjectFilesError::Io(m) => write!(f, "文件读写失败：{m}"),
            ProjectFilesError::MissingManifest => {
                write!(f, "工程清单缺失：资源根内必须有 {MANIFEST_FILE}")
            }
            ProjectFilesError::BadManifest(m) => write!(f, "工程清单不是合法 JSON：{m}"),
            ProjectFilesError::MissingStories => {
                write!(f, "故事目录缺失：资源根内必须有 {STORIES_DIR}/")
            }
            ProjectFilesError::Decrypt(m) => write!(f, "故事解密失败：{m}"),
            ProjectFilesError::Watch(m) => write!(f, "热重载监视启动失败：{m}"),
            ProjectFilesError::WatchDevOnly => {
                write!(f, "热重载监视仅开发构建可用（release 资源只读）")
            }
        }
    }
}

impl std::error::Error for ProjectFilesError {}

/// 命令负载：清单对象 + 逻辑路径（相对资源根，`/` 分隔）→ 故事原始文本。
/// stories 用 BTreeMap 保证序列化顺序确定；逻辑路径语义与 fetch 供给一致（如 `Stories/title/main.story`）。
#[derive(Debug, Serialize, Clone)]
pub struct ProjectFiles {
    pub manifest: serde_json::Value,
    pub stories: BTreeMap<String, String>,
}

/// 递归收集故事文件：`Stories/` 子目录 = 章节分组（目录语义）。
/// 逻辑路径相对资源根（`root`）剥离、`/` 分隔；点开头的文件（`.DS_Store` 等系统杂项）不入工程。
/// key 存在时（清单声明 resourceEncryption）：`.enc` 加密故事解密后以**去 .enc 的逻辑路径**供给；
/// 无 key 时遇 `.enc` = fail-closed（不给组装器喂密文垃圾）。非 UTF-8 fail-closed。
fn collect_story_files(
    resfs: &dyn ResourceFs,
    root: &Path,
    dir: &Path,
    key: Option<&[u8]>,
    into: &mut BTreeMap<String, String>,
) -> Result<(), ProjectFilesError> {
    for entry in resfs
        .walk(dir)
        .map_err(|e| ProjectFilesError::Io(e.to_string()))?
    {
        if entry.is_dir {
            continue; // walk 已递归下钻，目录本身不再是遍历单位
        }
        let path = &entry.path;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if crate::paths::hidden_name(&name) {
            continue;
        }
        // 根相对逻辑路径（`\` 归一 `/`）——收集判据与其它遍历点共用
        let rel = crate::paths::relative_slash_path(root, path);
        let bytes = resfs
            .read(path)
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
        let (logical, text) = if let Some(stripped) = rel.strip_suffix(".enc") {
            let k = key.ok_or_else(|| {
                ProjectFilesError::Decrypt(format!(
                    "存在加密故事 {rel}，但清单未声明 resourceEncryption（fail-closed）"
                ))
            })?;
            let plain = crate::resource_crypto::decrypt_resource_bytes(bytes, k, stripped)
                .map_err(|e| ProjectFilesError::Decrypt(format!("{rel}：{e}")))?;
            (
                stripped.to_string(),
                String::from_utf8(plain)
                    .map_err(|_| ProjectFilesError::Decrypt(format!("{rel} 解密后非 UTF-8")))?,
            )
        } else {
            (
                rel.clone(),
                String::from_utf8(bytes)
                    .map_err(|_| ProjectFilesError::Io(format!("非 UTF-8 故事文件：{rel}")))?,
            )
        };
        into.insert(logical, text);
    }
    Ok(())
}

/// 供给核心：清单解析为 JSON 对象、故事以原始文本供给（解析归引擎组装器）。
/// 清单恒明文（加密形态判定与组合根装配都依赖清单先可读）；加密故事供给见 `read_project_files_with_key`。
pub(crate) fn read_project_files(
    resfs: &dyn ResourceFs,
    root: &Path,
) -> Result<ProjectFiles, ProjectFilesError> {
    read_project_files_inner(resfs, root, None)
}

/// 加密工程供给（清单声明 resourceEncryption）：`.enc` 故事解密为文本后供给；
/// 与明文故事混存合法（故事加密可选）。
pub(crate) fn read_project_files_with_key(
    resfs: &dyn ResourceFs,
    root: &Path,
    key: &[u8],
) -> Result<ProjectFiles, ProjectFilesError> {
    read_project_files_inner(resfs, root, Some(key))
}

fn read_project_files_inner(
    resfs: &dyn ResourceFs,
    root: &Path,
    key: Option<&[u8]>,
) -> Result<ProjectFiles, ProjectFilesError> {
    let manifest_path = root.join(MANIFEST_FILE);
    if !resfs.is_file(&manifest_path) {
        return Err(ProjectFilesError::MissingManifest);
    }
    let raw = read_utf8(resfs, &manifest_path)?;
    let manifest =
        serde_json::from_str(&raw).map_err(|e| ProjectFilesError::BadManifest(e.to_string()))?;

    let stories_dir = root.join(STORIES_DIR);
    if !resfs.is_dir(&stories_dir) {
        return Err(ProjectFilesError::MissingStories);
    }
    let mut stories = BTreeMap::new();
    collect_story_files(resfs, root, &stories_dir, key, &mut stories)?;
    Ok(ProjectFiles { manifest, stories })
}

/// 经资源文件系统整读 UTF-8 文本（非 UTF-8 fail-closed，语义同旧 `fs::read_to_string`）。
fn read_utf8(resfs: &dyn ResourceFs, path: &Path) -> Result<String, ProjectFilesError> {
    let bytes = resfs
        .read(path)
        .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
    String::from_utf8(bytes)
        .map_err(|_| ProjectFilesError::Io(format!("非 UTF-8 文件：{}", path.display())))
}

/// 命令面公共前置：资源根定位 + 清单加密形态判定 → (资源根, 可选 DEK)。
/// **资源根定位（单一定位事实源，project_files 与 resource_crypto 共用）**：
/// 桌面 dev（debug 构建）= `LFEN_DEV_RESOURCE_ROOT` env 覆盖（可指向加密包做本地验证）→
/// 编译期源工程根（resource_dir() 在 dev 是 target 拷贝，cargo 增量编译不重拷资源，
/// 且与 watcher「监视源根」不一致）；release（桌面安装形态）走 resource_dir()。
/// 移动端一律走安装包内资源：Android = `asset://localhost/`（asset 协议，经 Kotlin 枚举 +
/// fs 插件读取）；iOS = app bundle 内真实路径（std::fs 直读，无需插件）。
/// **两条移动端都不得命中宿主 `CARGO_MANIFEST_DIR` 分支**（那是构建机路径，设备上不存在）。
pub(crate) fn locate_resource_root(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
    {
        let _ = app;
        if let Ok(env_root) = std::env::var("LFEN_DEV_RESOURCE_ROOT") {
            return PathBuf::from(env_root);
        }
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Resources")
    }
    #[cfg(any(not(debug_assertions), target_os = "android", target_os = "ios"))]
    {
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::new())
            .join("Resources")
    }
}

/// 命令面公共前置：解析应用数据目录，并定位资源根。
/// Android 的 `asset://` 资源根是合法形态（经 Kotlin 枚举与 fs 插件读取），
/// 其余平台出现该前缀属意外，显式失败。
/// 清单声明加密时一并返回资源密钥，调用方据此决定读取形态。
pub(crate) fn resource_root_with_key(
    app: &tauri::AppHandle,
) -> Result<(std::path::PathBuf, Option<Vec<u8>>), ProjectFilesError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
    let root = locate_resource_root(app);
    // Android：asset://localhost/Resources = 合法资源根（Kotlin 枚举 + fs 插件可 seek 读取）。
    // 其余平台出现该前缀 = 意外形态，维持 fail-closed 显式报错（iOS 供给接入前同界）。
    #[cfg(not(target_os = "android"))]
    {
        if root.to_string_lossy().starts_with("asset://") {
            return Err(ProjectFilesError::MobileAsset(
                root.to_string_lossy().into_owned(),
            ));
        }
    }
    let resfs = crate::resource_fs::resource_fs(app);
    root_state_with_key(&*resfs, &root, &app_data)
}

/// 资源根已定位后的公共段：清单加密形态判定 → DEK。
/// 清单恒明文（形态判定与组合根装配依赖清单先可读）：缺失 = 明文形态（显式报错归主流程）；
/// 坏清单 fail-closed；resourceEncryption = 取 DEK 解密供给。
fn root_state_with_key(
    resfs: &dyn ResourceFs,
    root: &std::path::Path,
    app_data: &std::path::Path,
) -> Result<(std::path::PathBuf, Option<Vec<u8>>), ProjectFilesError> {
    let manifest_path = root.join(MANIFEST_FILE);
    if !resfs.is_file(&manifest_path) {
        return Ok((root.to_path_buf(), None));
    }
    let manifest_raw = read_utf8(resfs, &manifest_path)?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_raw)
        .map_err(|e| ProjectFilesError::BadManifest(e.to_string()))?;
    if manifest
        .get("resourceEncryption")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        let key = crate::resource_crypto::resource_dek(app_data, root, resfs)
            .map_err(|e| ProjectFilesError::Decrypt(e.to_string()))?;
        return Ok((root.to_path_buf(), Some(key)));
    }
    Ok((root.to_path_buf(), None))
}

/// 工程文件供给命令：资源根 = `$RESOURCE/Resources`（bundle.resources 映射，dev/prod 同路径）。
#[tauri::command]
pub fn project_files(app: tauri::AppHandle) -> Result<ProjectFiles, ProjectFilesError> {
    let (root, key) = resource_root_with_key(&app)?;
    // 移动端白屏类问题的决定性判据：前端 boot 必调本命令，日志里有这行 = JS 真跑起来了
    // （debug 期诊断，release 不带；stderr 在 iOS/Android 均可见于系统日志）
    #[cfg(debug_assertions)]
    {
        static FIRST_CALL: std::sync::Once = std::sync::Once::new();
        FIRST_CALL.call_once(|| {
            eprintln!(
                "[lfen] project_files 首次调用：资源根={} 加密形态={}",
                root.display(),
                key.is_some()
            );
        });
    }
    let resfs = crate::resource_fs::resource_fs(&app);
    match key {
        Some(k) => read_project_files_with_key(&*resfs, &root, &k),
        None => read_project_files(&*resfs, &root),
    }
}
