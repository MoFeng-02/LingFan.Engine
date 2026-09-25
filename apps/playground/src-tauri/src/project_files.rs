//! 07 §三 工程文件供给（Rust 命令面）：从应用资源根取工程清单与故事文件。
//! 契约 = `ProjectFilesPort`（platform.ts）：manifest() 返回已解析对象、stories() 返回逻辑路径 → 原始文本。
//! 解析与组装归引擎（组装器是唯一解析点，T4 混存识别与单列文件名不变量都在那里生效）——
//! 本层只做「取文件」与 UTF-8 校验，一切失败 fail-closed（不静默降级为空工程）。
//!
//! 资源根布局（dev 与 prod 同机制，07 §三「清单在资源根内」）：
//! tauri.conf.json 的 `bundle.resources = {"../Resources/": "Resources/"}`
//! 把工程资源复制到 `$RESOURCE/Resources/**`（dev 下由 tauri-build 复制到 target 目录，prod 由打包器复制）。

use crate::resource_fs::ResourceFs;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MANIFEST_FILE: &str = "project.json";
const STORIES_DIR: &str = "Stories";
/// 07 §三.2 热重载事件名：工程文件变更（防抖后）→ 前端重新供给+组装并 reloadStory
pub const STORY_CHANGED_EVENT: &str = "story-changed";
/// 防抖静默窗：编辑器保存常产生截断+写入/替换等多事件，静默窗内合并为一次通知
#[cfg(all(
    debug_assertions,
    not(any(target_os = "android", target_os = "ios"))
))]
const WATCH_QUIET: std::time::Duration = std::time::Duration::from_millis(250);
/// 监视启动幂等锁（Once 保证线程与 watcher 只建一次）
#[cfg(all(
    debug_assertions,
    not(any(target_os = "android", target_os = "ios"))
))]
static WATCH_STARTED: std::sync::Once = std::sync::Once::new();

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

/// 递归收集故事文件：`Stories/` 子目录 = 章节分组（07 §三，灵泛目录语义）。
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
        if name.starts_with('.') {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(path);
        let rel = rel.to_string_lossy().replace('\\', "/");
        let bytes = resfs
            .read(path)
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
        let (logical, text) = if let Some(stripped) = rel.strip_suffix(".enc") {
            let k = key.ok_or_else(|| {
                ProjectFilesError::Decrypt(format!(
                    "存在加密故事 {rel}，但清单未声明 resourceEncryption（K6 fail-closed）"
                ))
            })?;
            let plain = crate::resource_crypto::decrypt_resource_bytes(&bytes, k, stripped)
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
pub fn read_project_files(
    resfs: &dyn ResourceFs,
    root: &Path,
) -> Result<ProjectFiles, ProjectFilesError> {
    read_project_files_inner(resfs, root, None)
}

/// 加密工程供给（05 §二，清单声明 resourceEncryption）：`.enc` 故事解密为文本后供给；
/// 与明文故事混存合法（05 §一.1「文本不防」——故事加密可选）。
pub fn read_project_files_with_key(
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
/// 桌面 dev（debug 构建）= `LFEN_DEV_RESOURCE_ROOT` env 覆盖（加密包真窗冒烟入口）→
/// 编译期源工程根（resource_dir() 在 dev 是 target 拷贝，cargo 增量编译不重拷资源，
/// 且与 07 §三.2 watcher「监视源根」不一致）；release（桌面安装形态）走 resource_dir()。
/// 移动端一律走安装包内资源：Android = `asset://localhost/`（asset 协议，经 Kotlin 枚举 +
/// fs 插件读取）；iOS = app bundle 内真实路径（std::fs 直读，无需插件）。
/// **两条移动端都不得命中宿主 `CARGO_MANIFEST_DIR` 分支**（那是构建机路径，设备上不存在）。
pub(crate) fn locate_resource_root(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(all(
        debug_assertions,
        not(any(target_os = "android", target_os = "ios"))
    ))]
    {
        let _ = app;
        if let Ok(env_root) = std::env::var("LFEN_DEV_RESOURCE_ROOT") {
            return PathBuf::from(env_root);
        }
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Resources")
    }
    #[cfg(any(
        not(debug_assertions),
        target_os = "android",
        target_os = "ios"
    ))]
    {
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::new())
            .join("Resources")
    }
}

fn resource_root_with_key(
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
/// 坏清单 fail-closed；resourceEncryption = 取 DEK 解密供给（05 §二）。
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

const LANG_ROOT: &str = "Lang";

/// 01 §四.3 单个 overlay 译文文件：overlay 根内相对路径（`/` 分隔；`main.json` = 全局兜底）
/// → 原文→译文映射。BTreeMap<String, String> 反序列化（老引擎 DictionaryStringString 同构）：
/// 含非字符串值/坏 JSON 的文件整体无效 → 跳过（宽松，老引擎 LoadFile 同语义）。
#[derive(Debug, Serialize, Clone)]
pub struct OverlayFile {
    pub path: String,
    pub entries: BTreeMap<String, String>,
}

/// lang 路径段校验（E3 fail-closed：字母数字/_/-，1..32，防路径穿越）
fn valid_lang(lang: &str) -> bool {
    !lang.is_empty()
        && lang.len() <= 32
        && lang
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 01 §四.3 读取某语言 overlay 文件（老引擎 I18nService 加载策略）：
/// 目录形式 `Lang/{lang}/` 递归收集 .json（含 `.json.enc` 加密译文），按路径排序输出确定性；
/// 目录缺失 → 降级单文件 `Lang/{lang}.json`（以 `main.json` 供给 = 全局兜底语义）。
/// 合并序（main.json 最先、其余按序覆盖）归引擎 TS 侧（mergeOverlayFiles——叙事语义引擎可测）；
/// key = 清单声明 resourceEncryption 时的 DEK（`.enc` 译文解密，AAD 与故事同规则 = 资源根相对路径去 .enc）。
pub fn load_overlay_files(
    resfs: &dyn ResourceFs,
    root: &Path,
    lang: &str,
    key: Option<&[u8]>,
) -> Result<Vec<OverlayFile>, ProjectFilesError> {
    if !valid_lang(lang) {
        return Err(ProjectFilesError::Io(format!("非法语言段：{lang}")));
    }
    let lang_dir = root.join(LANG_ROOT).join(lang);
    let single = root.join(LANG_ROOT).join(format!("{lang}.json"));
    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    if resfs.is_dir(&lang_dir) {
        for entry in resfs
            .walk(&lang_dir)
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?
        {
            if entry.is_dir {
                continue; // walk 已递归下钻
            }
            let name = entry
                .path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
            if name.ends_with(".json") || name.ends_with(".json.enc") {
                paths.push(entry.path);
            }
        }
    } else if resfs.is_file(&single) {
        paths.push(single);
    }
    paths.sort();
    let lang_prefix = format!("{LANG_ROOT}/{lang}/");
    let mut out = Vec::new();
    for path in paths {
        let root_rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = resfs
            .read(&path)
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
        let (logical, text) = if let Some(stripped) = root_rel.strip_suffix(".enc") {
            let k = key.ok_or_else(|| {
                ProjectFilesError::Decrypt(format!(
                    "加密译文 {root_rel} 但清单未声明 resourceEncryption（K6 fail-closed）"
                ))
            })?;
            let plain = crate::resource_crypto::decrypt_resource_bytes(&bytes, k, stripped)
                .map_err(|e| ProjectFilesError::Decrypt(format!("{root_rel}：{e}")))?;
            (
                stripped.to_string(),
                String::from_utf8(plain).map_err(|_| {
                    ProjectFilesError::Decrypt(format!("{root_rel} 解密后非 UTF-8"))
                })?,
            )
        } else {
            (
                root_rel.clone(),
                String::from_utf8(bytes)
                    .map_err(|_| ProjectFilesError::Io(format!("非 UTF-8 译文文件：{root_rel}")))?,
            )
        };
        // overlay 内相对路径：`Lang/{lang}/` 前缀剥离；单文件降级（Lang/{lang}.json）→ "main.json"
        let overlay_rel = logical
            .strip_prefix(&lang_prefix)
            .map_or_else(|| "main.json".to_string(), str::to_string);
        let Ok(entries) = serde_json::from_str::<BTreeMap<String, String>>(&text) else {
            continue; // 单文件宽松：坏 JSON / 含非字符串值 → 跳过（老引擎 LoadFile 同语义）
        };
        out.push(OverlayFile {
            path: overlay_rel,
            entries,
        });
    }
    Ok(out)
}

/// 01 §四.3 I18N overlay 供给命令（按需：setLanguage 时调用，启动零成本——老引擎同思想）
#[tauri::command]
pub fn load_i18n_overlay(
    app: tauri::AppHandle,
    lang: String,
) -> Result<Vec<OverlayFile>, ProjectFilesError> {
    let (root, key) = resource_root_with_key(&app)?;
    let resfs = crate::resource_fs::resource_fs(&app);
    load_overlay_files(&*resfs, &root, &lang, key.as_deref())
}

/// 01 §四.3 可用语言列表（老引擎 I18nService.GetAvailableLanguages 对应物）：
/// 扫描资源根 `Lang/` 的子目录名与单文件名（.json 与 .json.enc 均识别——
/// 老引擎通配 *.json 在加密形态会漏 .json.enc 单文件语言，此处修正）；
/// 恒含默认语言 "zh-CN"（OrdinalIgnoreCase 去重）；其余按字典序输出确定性。
/// `Lang/` 缺失 = 仅默认语言（老引擎 Directory.Exists 同语义，不报错）。
pub fn scan_i18n_languages(resfs: &dyn ResourceFs, root: &Path) -> Vec<String> {
    const DEFAULT_LANG: &str = "zh-CN";
    let mut langs: Vec<String> = vec![DEFAULT_LANG.to_string()];
    let lang_root = root.join(LANG_ROOT);
    let entries = match resfs.walk(&lang_root) {
        Ok(entries) => entries,
        Err(_) => return langs,
    };
    for entry in entries {
        // 仅直接子项（单层扫描语义不变；walk 是递归的，深层条目在此剔除）
        let Ok(rel) = entry.path.strip_prefix(&lang_root) else {
            continue;
        };
        if rel.components().count() != 1 {
            continue;
        }
        let Some(name) = entry
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
        else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let lang = if entry.is_dir {
            Some(name)
        } else {
            name.strip_suffix(".json.enc")
                .or_else(|| name.strip_suffix(".json"))
                .map(|s| s.to_string())
        };
        if let Some(lang) = lang {
            if !lang.is_empty() && !langs.iter().any(|l| l.eq_ignore_ascii_case(&lang)) {
                langs.push(lang);
            }
        }
    }
    langs[1..].sort();
    langs
}

/// 可用语言列表命令：资源根定位失败（含移动端 asset 形态）宽容降级 = 仅默认语言
/// （语言选择器恒可用；供给能力归 load_i18n_overlay 自己 fail-closed）。
#[tauri::command]
pub fn list_i18n_languages(app: tauri::AppHandle) -> Vec<String> {
    let resfs = crate::resource_fs::resource_fs(&app);
    match resource_root_with_key(&app) {
        Ok((root, _)) => scan_i18n_languages(&*resfs, &root),
        Err(_) => vec!["zh-CN".to_string()],
    }
}

/// 防抖循环：事件突发 → 静默窗（quiet）内无新事件 → 回调一次；
/// 通道断开 → 尾事件结算后退出（线程收尾，watcher 随之销毁）。
/// 编辑器保存常产生截断+写入/替换等多事件——合并为一次通知（07 §三.2 热重载触发）。
pub fn run_event_debouncer<F: Fn() + Send + 'static>(
    rx: std::sync::mpsc::Receiver<notify::Result<notify::Event>>,
    quiet: std::time::Duration,
    on_quiet: F,
) {
    let mut pending = false;
    loop {
        match rx.recv_timeout(quiet) {
            Ok(_) => pending = true,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if pending {
                    pending = false;
                    on_quiet();
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if pending {
                    on_quiet();
                }
                return;
            }
        }
    }
}

/// 07 §三.2 热重载监视（dev 工具）：递归监视**源**工程根——编译期定位
/// `CARGO_MANIFEST_DIR/../Resources`（dev 下即创作者编辑的目录；target 副本只在
/// cargo 重编时更新，监视副本取不到保存事件）。防抖后发 `story-changed` 事件，
/// 前端重新供给+组装并 reloadStory。仅桌面 debug 构建有效（release 与移动端
/// 显式 fail-closed——移动端资源在安装包内只读，且宿主路径在设备上不存在）；
/// 重复调用幂等（Once 保证线程与 watcher 只建一次）。
#[tauri::command]
pub fn watch_project_files(app: tauri::AppHandle) -> Result<(), ProjectFilesError> {
    #[cfg(any(
        not(debug_assertions),
        target_os = "android",
        target_os = "ios"
    ))]
    {
        let _ = &app;
        return Err(ProjectFilesError::WatchDevOnly);
    }
    #[cfg(all(
        debug_assertions,
        not(any(target_os = "android", target_os = "ios"))
    ))]
    {
        use notify::Watcher;
        use std::sync::mpsc;
        use tauri::Emitter;
        if WATCH_STARTED.is_completed() {
            return Ok(());
        }
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../Resources");
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher =
            notify::recommended_watcher(tx).map_err(|e| ProjectFilesError::Watch(e.to_string()))?;
        watcher
            .watch(&source, notify::RecursiveMode::Recursive)
            .map_err(|e| ProjectFilesError::Watch(e.to_string()))?;
        WATCH_STARTED.call_once(|| {
            let app = app.clone();
            std::thread::Builder::new()
                .name("story-watch".into())
                .spawn(move || {
                    // watcher 拥有权留在本线程 = 监视存活至进程退出（或线程收尾）
                    let _keep = watcher;
                    run_event_debouncer(rx, WATCH_QUIET, move || {
                        let _ = app.emit(STORY_CHANGED_EVENT, ());
                    });
                })
                .expect("story-watch 线程启动失败");
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource_fs::StdFs;
    use std::fs;
    use std::path::PathBuf;

    fn test_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lf3-project-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("Stories")).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn supplies_manifest_and_raw_story_texts() {
        // 07 §三 锚点 stories-raw-text-supply：故事以原始文本供给，解析归引擎组装器
        let root = test_root("happy");
        write(
            &root,
            "project.json",
            r#"{"formatVersion":1,"id":"demo","entry":"start"}"#,
        );
        write(
            &root,
            "Stories/start.json",
            r#"{"formatVersion":1,"id":"start"}"#,
        );
        write(
            &root,
            "Stories/chapter1/tail.story",
            "label tail:\n  say \"text\"\n",
        );
        let files = read_project_files(&StdFs, &root).unwrap();
        assert_eq!(files.manifest["entry"], "start");
        assert_eq!(files.stories.len(), 2);
        assert_eq!(
            files.stories["Stories/chapter1/tail.story"],
            "label tail:\n  say \"text\"\n"
        );
    }

    #[test]
    fn logical_paths_use_forward_separators_and_relative_to_root() {
        // 锚点 resource-root-resolution：逻辑路径相对资源根、`/` 分隔（与 fetch 供给一致）
        let root = test_root("paths");
        write(&root, "project.json", "{}");
        write(&root, "Stories/a/b/c.story", "x");
        let files = read_project_files(&StdFs, &root).unwrap();
        assert!(files.stories.contains_key("Stories/a/b/c.story"));
    }

    #[test]
    fn missing_manifest_fails_closed() {
        // 锚点 manifest-required：清单缺失必须报错，不静默降级为空工程
        let root = test_root("no-manifest");
        write(&root, "Stories/start.json", "{}");
        assert!(matches!(
            read_project_files(&StdFs, &root),
            Err(ProjectFilesError::MissingManifest)
        ));
    }

    #[test]
    fn malformed_manifest_rejected() {
        let root = test_root("bad-manifest");
        write(&root, "project.json", "{ not json");
        assert!(matches!(
            read_project_files(&StdFs, &root),
            Err(ProjectFilesError::BadManifest(_))
        ));
    }

    #[test]
    fn missing_stories_dir_fails_closed() {
        let root = std::env::temp_dir().join(format!(
            "lf3-project-no-stories-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        write(&root, "project.json", "{}");
        assert!(matches!(
            read_project_files(&StdFs, &root),
            Err(ProjectFilesError::MissingStories)
        ));
    }

    #[test]
    fn dotfiles_excluded() {
        // 锚点 dotfile-excluded：系统杂项（.DS_Store 等）不入工程
        let root = test_root("dot");
        write(&root, "project.json", "{}");
        write(&root, "Stories/.DS_Store", "junk");
        write(&root, "Stories/real.story", "x");
        let files = read_project_files(&StdFs, &root).unwrap();
        assert_eq!(files.stories.len(), 1);
        assert!(files.stories.contains_key("Stories/real.story"));
    }

    #[test]
    fn non_utf8_story_fails_closed() {
        // 锚点 fail-closed-non-utf8：非 UTF-8 文件必须报错，不静默丢弃或替换
        let root = test_root("utf8");
        write(&root, "project.json", "{}");
        let path = root.join("Stories/binary.story");
        fs::write(&path, [0xFFu8, 0xFE, 0x00, 0xD8]).unwrap();
        assert!(matches!(
            read_project_files(&StdFs, &root),
            Err(ProjectFilesError::Io(_))
        ));
    }

    #[test]
    fn encrypted_stories_decrypt_and_strip_enc_suffix() {
        // 05 §二 锚点 encrypted-story-supply：`.enc` 故事解密供给（去后缀逻辑路径），明文混存合法
        let root = test_root("enc");
        write(&root, "project.json", r#"{"resourceEncryption":true}"#);
        let key = [7u8; 32];
        let plain_story = r#"{"formatVersion":1,"id":"start","kind":"flow","commands":[]}"#;
        let sealed = crate::resource_crypto::encrypt_lfen2(
            plain_story.as_bytes(),
            &key,
            "Stories/start.json",
        )
        .unwrap();
        fs::write(root.join("Stories/start.json.enc"), &sealed).unwrap();
        write(&root, "Stories/plain.story", "label plain:\n  say \"x\"\n");
        let files = read_project_files_with_key(&StdFs, &root, &key).unwrap();
        assert_eq!(files.stories.len(), 2);
        assert_eq!(files.stories["Stories/start.json"], plain_story); // 去后缀逻辑路径
        assert!(files.stories.contains_key("Stories/plain.story")); // 明文混存（T4 扩展）
    }

    #[test]
    fn encrypted_story_without_key_fails_closed() {
        // K6 锚点 encrypted-story-needs-key：无钥遇 `.enc` fail-closed，不喂组装器密文
        let root = test_root("nokey");
        write(&root, "project.json", "{}");
        fs::write(root.join("Stories/x.json.enc"), b"LFEN2garbage").unwrap();
        assert!(matches!(
            read_project_files(&StdFs, &root),
            Err(ProjectFilesError::Decrypt(_))
        ));
    }

    #[test]
    fn packed_output_feeds_runtime_supply() {
        // ⑨-4b 互锁：打包产物（清单 resourceEncryption=true + 内容 .enc + seed）
        // → 运行时供给链零改动可读（故事/多语言 overlay/媒体解密同规则）
        let base = std::env::temp_dir().join(format!(
            "lf3-pack-runtime-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let input = base.join("in");
        let output = base.join("out");
        fs::create_dir_all(input.join("Stories")).unwrap();
        fs::create_dir_all(input.join("Lang/en")).unwrap();
        fs::write(
            input.join("project.json"),
            r#"{"formatVersion":1,"id":"demo","entry":"start"}"#,
        )
        .unwrap();
        fs::write(
            input.join("Stories/start.json"),
            r#"{"formatVersion":1,"id":"start","kind":"flow","commands":[]}"#,
        )
        .unwrap();
        fs::write(input.join("Lang/en/main.json"), "{\"你好\":\"Hello\"}").unwrap();

        let report = crate::resource_crypto::pack_project(&input, &output).unwrap();
        assert_eq!(report.files, 2);
        let seed = fs::read(output.join("__key__.seed")).unwrap();

        // 故事供给：清单形态判定 → .enc 解密 → 逻辑路径（去 .enc）
        let files = read_project_files_with_key(&StdFs, &output, &seed).unwrap();
        assert_eq!(
            files.manifest["resourceEncryption"],
            serde_json::Value::Bool(true)
        );
        assert_eq!(files.stories.len(), 1);
        assert_eq!(
            files.stories["Stories/start.json"],
            r#"{"formatVersion":1,"id":"start","kind":"flow","commands":[]}"#
        );

        // 多语言 overlay 供给：main.json 兜底优先（明文源 → .enc 包 → 解密）
        let overlays = load_overlay_files(&StdFs, &output, "en", Some(&seed)).unwrap();
        assert_eq!(overlays.len(), 1);
        assert_eq!(overlays[0].path, "main.json");
        assert_eq!(overlays[0].entries["你好"], "Hello");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn list_languages_without_lang_root_is_default_only() {
        // 老引擎 Directory.Exists 同语义：无 Lang/ 目录 = 仅默认语言，不报错
        let root = test_root("langs-none");
        write(&root, "project.json", "{}");
        assert_eq!(
            scan_i18n_languages(&StdFs, &root),
            vec!["zh-CN".to_string()]
        );
    }

    #[test]
    fn list_languages_scans_dirs_and_files_deterministically() {
        // 老引擎 GetAvailableLanguages：子目录名 + 单文件名（去扩展名）；恒含 zh-CN 居首；
        // .json.enc 单文件也识别（对老引擎通配 *.json 漏加密形态的修正）；其余字典序
        let root = test_root("langs-scan");
        write(&root, "project.json", "{}");
        fs::create_dir_all(root.join("Lang/en-US")).unwrap();
        fs::create_dir_all(root.join("Lang/ja")).unwrap();
        write(&root, "Lang/fr.json.enc", "x");
        write(&root, "Lang/zh-TW.json", "x");
        write(&root, "Lang/notes.txt", "x"); // 非 json 文件不算语言
        fs::create_dir_all(root.join("Lang/.hidden")).unwrap(); // 点目录不算
        let langs = scan_i18n_languages(&StdFs, &root);
        assert_eq!(
            langs,
            vec![
                "zh-CN".to_string(),
                "en-US".to_string(),
                "fr".to_string(),
                "ja".to_string(),
                "zh-TW".to_string(),
            ]
        );
    }

    #[test]
    fn list_languages_ignores_case_duplicates() {
        // OrdinalIgnoreCase 去重（老引擎 HashSet(StringComparer.OrdinalIgnoreCase) 同语义）
        let root = test_root("langs-case");
        write(&root, "project.json", "{}");
        fs::create_dir_all(root.join("Lang/ZH-cn")).unwrap();
        assert_eq!(
            scan_i18n_languages(&StdFs, &root),
            vec!["zh-CN".to_string()]
        );
    }

    fn dummy_event() -> notify::Result<notify::Event> {
        Ok(notify::Event::new(notify::EventKind::Any))
    }

    #[test]
    fn debouncer_merges_burst_into_one_callback() {
        // 锚点 hot-reload-debounced：编辑器保存的突发多事件（截断+写入/替换）合并为一次通知
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let fired = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&fired);
        std::thread::spawn(move || {
            run_event_debouncer(rx, std::time::Duration::from_millis(80), move || {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            })
        });
        for _ in 0..5 {
            tx.send(dummy_event()).unwrap(); // 突发
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert_eq!(fired.load(std::sync::atomic::Ordering::SeqCst), 1);
        tx.send(dummy_event()).unwrap(); // 第二轮突发
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert_eq!(fired.load(std::sync::atomic::Ordering::SeqCst), 2);
        drop(tx); // 断开：防抖线程尾结算后退出
        std::thread::sleep(std::time::Duration::from_millis(80));
    }

    #[test]
    fn debouncer_flushes_pending_on_disconnect() {
        // 锚点 hot-reload-tail-flush：断开时有未结算事件 → 补发一次后退出（不丢尾事件）
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let fired = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&fired);
        std::thread::spawn(move || {
            run_event_debouncer(rx, std::time::Duration::from_millis(80), move || {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            })
        });
        tx.send(dummy_event()).unwrap();
        drop(tx);
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert_eq!(fired.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    // —— 01 §四.3 I18N overlay 供给 ——

    #[test]
    fn overlay_dir_files_recursed_and_sorted() {
        // 目录形式递归收集（子文件夹分类合法），仅 .json，路径排序输出确定性
        let root = test_root("i18n-dir");
        write(&root, "Lang/en/main.json", r#"{"你好":"Hello"}"#);
        write(&root, "Lang/en/ui/battle.json", r#"{"攻击":"Attack"}"#);
        write(&root, "Lang/en/notes.txt", "not json");
        let files = load_overlay_files(&StdFs, &root, "en", None).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "main.json");
        assert_eq!(files[1].path, "ui/battle.json");
        assert_eq!(files[0].entries["你好"], "Hello");
    }

    #[test]
    fn overlay_single_file_fallback_supplies_main_json() {
        // 降级：无 Lang/{lang}/ 目录 → 单文件 Lang/{lang}.json，以 "main.json" 供给（全局兜底语义）
        let root = test_root("i18n-single");
        write(&root, "Lang/ja.json", r#"{"早上好":"おはよう"}"#);
        let files = load_overlay_files(&StdFs, &root, "ja", None).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "main.json");
        assert_eq!(files[0].entries["早上好"], "おはよう");
    }

    #[test]
    fn overlay_invalid_lang_fails_closed() {
        // E3：lang 路径段校验（防路径穿越），fail-closed 显式报错
        let root = test_root("i18n-bad-lang");
        assert!(load_overlay_files(&StdFs, &root, "../etc", None).is_err());
        assert!(load_overlay_files(&StdFs, &root, "", None).is_err());
        assert!(load_overlay_files(&StdFs, &root, "a/b", None).is_err());
    }

    #[test]
    fn overlay_bad_or_nonstring_json_skipped() {
        // 老引擎 LoadFile 宽松语义：损坏 / 含非字符串值的文件跳过，其余照常供给
        let root = test_root("i18n-lenient");
        write(&root, "Lang/en/main.json", r#"{"ok":"Yes"}"#);
        write(&root, "Lang/en/broken.json", "{ not json");
        write(&root, "Lang/en/nonstring.json", r#"{"num":42}"#);
        let files = load_overlay_files(&StdFs, &root, "en", None).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "main.json");
    }

    #[test]
    fn overlay_encrypted_translations_decrypt() {
        // 加密译文与故事同机制：LFEN2 + AAD = 资源根相对路径（去 .enc）
        let root = test_root("i18n-enc");
        write(&root, "project.json", r#"{"resourceEncryption":true}"#);
        let key = [9u8; 32];
        let plain = r#"{"你好":"Hi"}"#;
        let sealed =
            crate::resource_crypto::encrypt_lfen2(plain.as_bytes(), &key, "Lang/en/main.json")
                .unwrap();
        fs::create_dir_all(root.join("Lang/en")).unwrap();
        fs::write(root.join("Lang/en/main.json.enc"), &sealed).unwrap();
        let files = load_overlay_files(&StdFs, &root, "en", Some(&key)).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "main.json");
        assert_eq!(files[0].entries["你好"], "Hi");
    }

    #[test]
    fn overlay_encrypted_without_key_fails_closed() {
        // K6：无钥遇加密译文 fail-closed，不喂引擎密文
        let root = test_root("i18n-enc-nokey");
        write(&root, "Lang/en/main.json.enc", "LFEN2garbage");
        assert!(matches!(
            load_overlay_files(&StdFs, &root, "en", None),
            Err(ProjectFilesError::Decrypt(_))
        ));
    }
}
