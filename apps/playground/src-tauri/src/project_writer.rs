//! Tauri 桌面写回端口（Rust 侧）：`apply_project_files` 命令实现浏览器
//! `createHandleProjectWriter`（directorySource.ts）**完全同序**的写回——
//! 「校验 → 建 `Stories/` → 写列文件 → 写 `project.json`（提交点）→ 删陈旧」，
//! 永不先删后写：失败时磁盘最坏只是「多出文件」，工程仍可加载。
//!
//! 与浏览器侧的分工差异：FSA 句柄自带根目录与权限，这里根路径由前端显式传入
//! （Tauri dialog 选目录所得）；因此**纵深防御**在 Rust 侧独立成立——逻辑路径
//! 白名单（写入 = `Stories/**` 或 `project.json`；删除 = 仅 `Stories/**`）、
//! 拒绝 `..` / 反斜杠 / 空段，不信任前端。任一路径非法 → **整批拒绝、零写入**。
//! 差量计算归 TS（`diffProjectFiles`，格式知识单点）；本命令只按差量落盘。
//!
//!
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const MANIFEST_FILE: &str = "project.json";
pub const STORIES_DIR: &str = "Stories";

/// 单个待写文件：逻辑路径（相对资源根，`/` 分隔）+ 全文
#[derive(Debug, Deserialize)]
pub struct ProjectFileChange {
    pub path: String,
    pub text: String,
}

/// 写回结果（逻辑路径；与 TS `ProjectWriteReport` 键一致）
#[derive(Debug, Serialize, Clone)]
pub struct ProjectWriteReport {
    pub written: Vec<String>,
    pub deleted: Vec<String>,
}

/// 单个文件的并发检测指纹：`last_modified` 为 **Unix 毫秒**（对齐 JS
/// `File.lastModified`）；serde camelCase → TS 直接以 `{path, lastModified, size}` 消费。
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileStamp {
    pub path: String,
    pub last_modified: u64,
    pub size: u64,
}

/// 指纹批量结果：**缺失的路径不出现在 stamps 里**（TS 比对时 undefined = 被外部删除 → 冲突）
#[derive(Debug, Serialize, Clone)]
pub struct ProjectStamps {
    pub stamps: Vec<ProjectFileStamp>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum ProjectWriterError {
    #[serde(rename = "root")]
    Root(String),
    #[serde(rename = "bad-path")]
    BadPath(String),
    #[serde(rename = "bad-delete")]
    BadDelete(String),
    #[serde(rename = "io")]
    Io(String),
}

impl std::fmt::Display for ProjectWriterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectWriterError::Root(m) => write!(f, "工程目录不可用：{m}"),
            ProjectWriterError::BadPath(p) => {
                write!(f, "写入路径非法（越出资源根或非白名单）：{p}")
            }
            ProjectWriterError::BadDelete(p) => {
                write!(f, "删除路径非法（只允许删除 {STORIES_DIR}/ 内的陈旧文件）：{p}")
            }
            ProjectWriterError::Io(m) => write!(f, "文件写回失败：{m}"),
        }
    }
}

impl std::error::Error for ProjectWriterError {}

/// 写入面白名单：`project.json`（清单提交点）或 `Stories/**`（列文件）。
/// 拒空路径、`\`、`.`/`..` 段、控制字符——路径穿越在 Rust 侧独立拒绝（纵深防御）。
fn validate_write_path(path: &str) -> Result<(), ProjectWriterError> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return Err(ProjectWriterError::BadPath(path.into()));
    }
    if path.chars().any(|c| c.is_control()) {
        return Err(ProjectWriterError::BadPath(path.into()));
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments.iter().any(|s| s.is_empty() || *s == "." || *s == "..") {
        return Err(ProjectWriterError::BadPath(path.into()));
    }
    if path == MANIFEST_FILE {
        return Ok(());
    }
    if segments.first() == Some(&STORIES_DIR) {
        return Ok(());
    }
    Err(ProjectWriterError::BadPath(path.into()))
}

/// 删除面白名单：**仅 `Stories/**`**（清单与资源根结构永不删）。
fn validate_delete_path(path: &str) -> Result<(), ProjectWriterError> {
    validate_write_path(path)?;
    if path == MANIFEST_FILE {
        return Err(ProjectWriterError::BadDelete(path.into()));
    }
    Ok(())
}

fn resolve_under_root(root: &Path, logical: &str) -> PathBuf {
    root.join(logical.replace('/', std::path::MAIN_SEPARATOR_STR))
}

/// Tauri 命令：按差量写回工程。任一路径非法 → 整批拒绝、零写入（fail-closed）。
#[tauri::command]
pub fn apply_project_files(
    root: String,
    changes: Vec<ProjectFileChange>,
    deletes: Vec<String>,
) -> Result<ProjectWriteReport, ProjectWriterError> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(ProjectWriterError::Root(root));
    }
    // 校验先行：任一非法 → 整批拒绝（零写入 / 零删除）
    for change in &changes {
        validate_write_path(&change.path)?;
    }
    for path in &deletes {
        validate_delete_path(path)?;
    }

    // `Stories/` 可能不存在（首次写回）→ 建之
    let stories_dir = root_path.join(STORIES_DIR);
    fs::create_dir_all(&stories_dir).map_err(|e| ProjectWriterError::Io(e.to_string()))?;

    // 列文件先写，`project.json` 最后写（= 提交点）；TS 已按码元序给 changes，
    // 这里再保序一次（防御：清单提交点语义不依赖调用方排序）
    let mut ordered: Vec<&ProjectFileChange> = changes.iter().collect();
    ordered.sort_by_key(|change| change.path == MANIFEST_FILE); // false < true → manifest 沉底
    let mut written = Vec::new();
    for change in &ordered {
        let path = resolve_under_root(root_path, &change.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| ProjectWriterError::Io(e.to_string()))?;
        }
        fs::write(&path, &change.text).map_err(|e| ProjectWriterError::Io(e.to_string()))?;
        written.push(change.path.clone());
    }

    // 删除陈旧文件（缺失 = 已删，幂等）
    let mut deleted = Vec::new();
    for logical in &deletes {
        let path = resolve_under_root(root_path, logical);
        match fs::remove_file(&path) {
            Ok(()) => deleted.push(logical.clone()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => deleted.push(logical.clone()),
            Err(e) => return Err(ProjectWriterError::Io(e.to_string())),
        }
    }

    Ok(ProjectWriteReport { written, deleted })
}

/// 并发修改检测的**只读命令**：对基线路径批量取指纹（存在性 + mtime 毫秒 + size）。
/// 缺失路径不返回（TS 比对时 = 冲突「被外部删除」）。路径白名单与写回同面（基线只来自
/// `serializeProject` 的文件集）；mtime 转换失败的文件按 0 处理（仍参与 size 比对）。
#[tauri::command]
pub fn stamp_project_files(
    root: String,
    paths: Vec<String>,
) -> Result<ProjectStamps, ProjectWriterError> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(ProjectWriterError::Root(root));
    }
    let mut stamps = Vec::new();
    for path in &paths {
        validate_write_path(path)?;
        let file_path = resolve_under_root(root_path, path);
        let Ok(metadata) = fs::metadata(&file_path) else {
            continue; // 缺失 = 不入表（调用方判为冲突）
        };
        if !metadata.is_file() {
            continue;
        }
        let last_modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        stamps.push(ProjectFileStamp {
            path: path.clone(),
            last_modified,
            size: metadata.len(),
        });
    }
    Ok(ProjectStamps { stamps })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lf3-writer-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join(STORIES_DIR)).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn change(path: &str, text: &str) -> ProjectFileChange {
        ProjectFileChange {
            path: path.into(),
            text: text.into(),
        }
    }

    #[test]
    fn writes_columns_then_manifest_and_deletes_stale() {
        // 写回不变量：先写后删、manifest 是提交点
        let root = test_root("happy");
        write(&root, "Stories/old.json", "{旧列}");
        let report = apply_project_files(
            root.to_string_lossy().into_owned(),
            vec![
                change("project.json", "{清单v2}"),
                change("Stories/a.json", "{列a}"),
                change("Stories/sub/b.json", "{列b}"),
            ],
            vec!["Stories/old.json".into()],
        )
        .unwrap();
        assert_eq!(report.written, ["Stories/a.json", "Stories/sub/b.json", "project.json"]);
        assert_eq!(report.deleted, ["Stories/old.json"]);
        assert_eq!(
            fs::read_to_string(root.join("Stories/a.json")).unwrap(),
            "{列a}"
        );
        assert_eq!(
            fs::read_to_string(root.join("Stories/sub/b.json")).unwrap(),
            "{列b}"
        );
        assert_eq!(fs::read_to_string(root.join("project.json")).unwrap(), "{清单v2}");
        assert!(!root.join("Stories/old.json").exists());
    }

    #[test]
    fn invalid_path_rejects_whole_batch_with_zero_writes() {
        let root = test_root("escape");
        write(&root, "Stories/keep.json", "{保持}");
        for evil in ["Stories/../evil.json", "src/main.rs", "Stories/a\\b.json", ""] {
            let result = apply_project_files(
                root.to_string_lossy().into_owned(),
                vec![change("Stories/keep.json", "改"), change(evil, "x")],
                vec![],
            );
            assert!(matches!(result, Err(ProjectWriterError::BadPath(_))), "{evil}");
        }
        // 零写入：原有文件未被改动，非法目标也不存在
        assert_eq!(fs::read_to_string(root.join("Stories/keep.json")).unwrap(), "{保持}");
        assert!(!root.join("evil.json").exists());
        assert!(!root.join("src").exists());
    }

    #[test]
    fn manifest_cannot_be_deleted() {
        let root = test_root("delmanifest");
        write(&root, "project.json", "{清单}");
        let result = apply_project_files(
            root.to_string_lossy().into_owned(),
            vec![],
            vec![MANIFEST_FILE.into()],
        );
        assert!(matches!(result, Err(ProjectWriterError::BadDelete(_))));
        assert_eq!(fs::read_to_string(root.join("project.json")).unwrap(), "{清单}");
    }

    #[test]
    fn delete_missing_file_is_idempotent() {
        let root = test_root("idempotent");
        let report = apply_project_files(
            root.to_string_lossy().into_owned(),
            vec![],
            vec!["Stories/gone.json".into()],
        )
        .unwrap();
        assert_eq!(report.deleted, ["Stories/gone.json"]);
    }

    #[test]
    fn write_failure_happens_before_any_delete() {
        // 先写后删不变量：写入阶段失败（目标路径是目录）→ 删除阶段绝不执行
        let root = test_root("failbeforedelete");
        write(&root, "Stories/stale.json", "{陈旧}");
        fs::create_dir_all(root.join("Stories/dir-as-file")).unwrap();
        let result = apply_project_files(
            root.to_string_lossy().into_owned(),
            vec![change("Stories/dir-as-file", "写目录必失败")],
            vec!["Stories/stale.json".into()],
        );
        assert!(matches!(result, Err(ProjectWriterError::Io(_))));
        assert!(root.join("Stories/stale.json").exists()); // 陈旧文件未删
    }

    #[test]
    fn missing_root_fails_closed() {
        let result = apply_project_files(
            std::env::temp_dir()
                .join(format!("lf3-missing-{}", std::process::id()))
                .to_string_lossy()
                .into_owned(),
            vec![],
            vec![],
        );
        assert!(matches!(result, Err(ProjectWriterError::Root(_))));
    }

    #[test]
    fn stamps_report_mtime_and_size_and_skip_missing() {
        // 指纹 = mtime 毫秒 + size；缺失路径不出现在结果里（调用方判冲突）
        let root = test_root("stamp");
        write(&root, "Stories/a.json", "{列a}");
        write(&root, "project.json", "{清单}");
        let stamps = stamp_project_files(
            root.to_string_lossy().into_owned(),
            vec![
                "Stories/a.json".into(),
                "project.json".into(),
                "Stories/gone.json".into(),
            ],
        )
        .unwrap()
        .stamps;
        assert_eq!(stamps.len(), 2);
        let a = stamps.iter().find(|s| s.path == "Stories/a.json").unwrap();
        assert_eq!(a.size, "{列a}".len() as u64);
        assert!(a.last_modified > 0);
        assert!(stamps.iter().all(|s| s.path != "Stories/gone.json"));
    }

    #[test]
    fn stamp_rejects_paths_outside_write_whitelist() {
        let root = test_root("stampwhitelist");
        let result = stamp_project_files(
            root.to_string_lossy().into_owned(),
            vec!["src/main.rs".into()],
        );
        assert!(matches!(result, Err(ProjectWriterError::BadPath(_))));
    }
}