//! 按差量写回工程文件：先写列文件、后写清单，最后删除陈旧文件。

use crate::project_writer::whitelist::{MANIFEST_FILE, ProjectWriterError, STORIES_DIR, validate_delete_path, validate_write_path};
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

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

/// 把逻辑路径（`/` 分隔，相对资源根）解析为宿主文件系统路径。
pub(crate) fn resolve_under_root(root: &Path, logical: &str) -> PathBuf {
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
