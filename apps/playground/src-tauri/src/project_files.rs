//! 07 §三 工程文件供给（Rust 命令面）：从应用资源根取工程清单与故事文件。
//! 契约 = `ProjectFilesPort`（platform.ts）：manifest() 返回已解析对象、stories() 返回逻辑路径 → 原始文本。
//! 解析与组装归引擎（组装器是唯一解析点，T4 混存识别与单列文件名不变量都在那里生效）——
//! 本层只做「取文件」与 UTF-8 校验，一切失败 fail-closed（不静默降级为空工程）。
//!
//! 资源根布局（dev 与 prod 同机制，07 §三「清单在资源根内」）：
//! tauri.conf.json 的 `bundle.resources = {"../Resources/": "Resources/"}`
//! 把工程资源复制到 `$RESOURCE/Resources/**`（dev 下由 tauri-build 复制到 target 目录，prod 由打包器复制）。

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use tauri::Manager;

const MANIFEST_FILE: &str = "project.json";
const STORIES_DIR: &str = "Stories";
/// 07 §三.2 热重载事件名：工程文件变更（防抖后）→ 前端重新供给+组装并 reloadStory
pub const STORY_CHANGED_EVENT: &str = "story-changed";
/// 防抖静默窗：编辑器保存常产生截断+写入/替换等多事件，静默窗内合并为一次通知
const WATCH_QUIET: std::time::Duration = std::time::Duration::from_millis(250);
/// 监视启动幂等锁（Once 保证线程与 watcher 只建一次）
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
    root: &Path,
    dir: &Path,
    key: Option<&[u8]>,
    into: &mut BTreeMap<String, String>,
) -> Result<(), ProjectFilesError> {
    let entries = fs::read_dir(dir).map_err(|e| ProjectFilesError::Io(e.to_string()))?;
    for entry in entries {
        let path = entry
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?
            .path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_story_files(root, &path, key, into)?;
        } else {
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel = rel.to_string_lossy().replace('\\', "/");
            let bytes = fs::read(&path).map_err(|e| ProjectFilesError::Io(e.to_string()))?;
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
    }
    Ok(())
}

/// 供给核心：清单解析为 JSON 对象、故事以原始文本供给（解析归引擎组装器）。
/// 清单恒明文（加密形态判定与组合根装配都依赖清单先可读）；加密故事供给见 `read_project_files_with_key`。
pub fn read_project_files(root: &Path) -> Result<ProjectFiles, ProjectFilesError> {
    read_project_files_inner(root, None)
}

/// 加密工程供给（05 §二，清单声明 resourceEncryption）：`.enc` 故事解密为文本后供给；
/// 与明文故事混存合法（05 §一.1「文本不防」——故事加密可选）。
pub fn read_project_files_with_key(
    root: &Path,
    key: &[u8],
) -> Result<ProjectFiles, ProjectFilesError> {
    read_project_files_inner(root, Some(key))
}

fn read_project_files_inner(
    root: &Path,
    key: Option<&[u8]>,
) -> Result<ProjectFiles, ProjectFilesError> {
    let manifest_path = root.join(MANIFEST_FILE);
    if !manifest_path.is_file() {
        return Err(ProjectFilesError::MissingManifest);
    }
    let raw =
        fs::read_to_string(&manifest_path).map_err(|e| ProjectFilesError::Io(e.to_string()))?;
    let manifest =
        serde_json::from_str(&raw).map_err(|e| ProjectFilesError::BadManifest(e.to_string()))?;

    let stories_dir = root.join(STORIES_DIR);
    if !stories_dir.is_dir() {
        return Err(ProjectFilesError::MissingStories);
    }
    let mut stories = BTreeMap::new();
    collect_story_files(root, &stories_dir, key, &mut stories)?;
    Ok(ProjectFiles { manifest, stories })
}

/// 工程文件供给命令：资源根 = `$RESOURCE/Resources`（bundle.resources 映射，dev/prod 同路径）。
/// Android/iOS 资源在安装包 asset 内（`asset://` 前缀）不能以 std::fs 读取——
/// 移动端待接 fs 插件（tauri-plugin-fs）走 asset 协议，当前 fail-closed 显式报错。
#[tauri::command]
pub fn project_files(app: tauri::AppHandle) -> Result<ProjectFiles, ProjectFilesError> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
    let root = resource.join("Resources");
    if root.to_string_lossy().starts_with("asset://") {
        return Err(ProjectFilesError::MobileAsset(
            root.to_string_lossy().into_owned(),
        ));
    }
    // 清单恒明文：先读清单判定加密形态（resourceEncryption）——加密则取 DEK 解密供给（05 §二）
    let manifest_path = root.join(MANIFEST_FILE);
    if !manifest_path.is_file() {
        return Err(ProjectFilesError::MissingManifest);
    }
    let manifest_raw =
        fs::read_to_string(&manifest_path).map_err(|e| ProjectFilesError::Io(e.to_string()))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_raw)
        .map_err(|e| ProjectFilesError::BadManifest(e.to_string()))?;
    if manifest
        .get("resourceEncryption")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| ProjectFilesError::Io(e.to_string()))?;
        let key = crate::resource_crypto::resource_dek(&app_data, &root)
            .map_err(|e| ProjectFilesError::Decrypt(e.to_string()))?;
        return read_project_files_with_key(&root, &key);
    }
    read_project_files(&root)
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
/// 前端重新供给+组装并 reloadStory。仅 debug 构建有效（release 显式 fail-closed）；
/// 重复调用幂等（Once 保证线程与 watcher 只建一次）。
#[tauri::command]
pub fn watch_project_files(app: tauri::AppHandle) -> Result<(), ProjectFilesError> {
    #[cfg(not(debug_assertions))]
    {
        let _ = &app;
        return Err(ProjectFilesError::WatchDevOnly);
    }
    #[cfg(debug_assertions)]
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
        let files = read_project_files(&root).unwrap();
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
        let files = read_project_files(&root).unwrap();
        assert!(files.stories.contains_key("Stories/a/b/c.story"));
    }

    #[test]
    fn missing_manifest_fails_closed() {
        // 锚点 manifest-required：清单缺失必须报错，不静默降级为空工程
        let root = test_root("no-manifest");
        write(&root, "Stories/start.json", "{}");
        assert!(matches!(
            read_project_files(&root),
            Err(ProjectFilesError::MissingManifest)
        ));
    }

    #[test]
    fn malformed_manifest_rejected() {
        let root = test_root("bad-manifest");
        write(&root, "project.json", "{ not json");
        assert!(matches!(
            read_project_files(&root),
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
            read_project_files(&root),
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
        let files = read_project_files(&root).unwrap();
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
            read_project_files(&root),
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
        let files = read_project_files_with_key(&root, &key).unwrap();
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
            read_project_files(&root),
            Err(ProjectFilesError::Decrypt(_))
        ));
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
}
