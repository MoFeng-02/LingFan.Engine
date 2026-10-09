//! 文件指纹读取：存在性、修改时间与大小，用于并发修改检测。

use crate::project_writer::apply::{resolve_under_root};
use crate::project_writer::whitelist::{ProjectWriterError, validate_write_path};
use serde::Serialize;
use std::fs;
use std::path::Path;

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
