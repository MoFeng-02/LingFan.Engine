//! 路径白名单与错误类型：写回面与删除面各自的可写范围判定，以及写回根绑定。

use serde::Serialize;
use std::path::{Path, PathBuf};

/// 工程清单文件名（写回面的提交点，也是唯一可写的非 Stories 路径）。
pub(crate) const MANIFEST_FILE: &str = "project.json";

/// 故事文件目录名（写回面与删除面共同的可写范围）。
pub(crate) const STORIES_DIR: &str = "Stories";

/// 工程写回失败的原因：根目录不可用、路径不在白名单、删除面越界、写入失败。
/// 序列化为 `{code, detail}`，前端按 `code` 分支处理。
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
                write!(
                    f,
                    "删除路径非法（只允许删除 {STORIES_DIR}/ 内的陈旧文件）：{p}"
                )
            }
            ProjectWriterError::Io(m) => write!(f, "文件写回失败：{m}"),
        }
    }
}

impl std::error::Error for ProjectWriterError {}

/// 写入面白名单：`project.json`（清单提交点）或 `Stories/**`（列文件）。
/// 相对路径的公共形态（空/绝对/`\`/控制字符/`.`/`..`/空段）由通用底座判定，
/// 本函数只加「首段白名单」这条业务语义——路径穿越在 Rust 侧独立拒绝（纵深防御）。
pub(crate) fn validate_write_path(path: &str) -> Result<(), ProjectWriterError> {
    if crate::paths::validate_write_like_path(path).is_err() {
        return Err(ProjectWriterError::BadPath(path.into()));
    }
    if path == MANIFEST_FILE {
        return Ok(());
    }
    // 首段落位由通用规则的「无空段」保证：`Stories/a.json` 的首段即 STORIES_DIR
    if path.split('/').next() == Some(STORIES_DIR) {
        return Ok(());
    }
    Err(ProjectWriterError::BadPath(path.into()))
}

/// 删除面白名单：**仅 `Stories/**`**（清单与资源根结构永不删）。
pub(crate) fn validate_delete_path(path: &str) -> Result<(), ProjectWriterError> {
    validate_write_path(path)?;
    if path == MANIFEST_FILE {
        return Err(ProjectWriterError::BadDelete(path.into()));
    }
    Ok(())
}

/// 两根是否同一物理目录（canonicalize 后相等）。纯函数：解析符号链接/相对段后比对，
/// 任一根无法规范化（不存在/无权限）即判不同——fail-closed，不放行未确证的根。
pub(crate) fn same_canonical_root(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// 写回根绑定（纵深防御，不信任前端传入的根）：
/// - 根必须是真实目录，否则 fail-closed（`Root`）。
/// - **release 形态**进一步绑定到本宿主资源根（`locate_resource_root`，canonicalize 相等）：
///   桌面安装形态的写回只落在打包资源根，杜绝 WebView 传任意根写删全用户文件系统。
/// - **debug 形态**保留编辑器「dialog 选任意工程目录」工作流（任意真实目录），不绑定资源根。
///
/// 非法根一律 `Root` 拒绝、状态原样（调用方在绑定通过前不做任何写删）。
pub(crate) fn bound_root(
    app: &tauri::AppHandle,
    root: &str,
) -> Result<PathBuf, ProjectWriterError> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(ProjectWriterError::Root(root.into()));
    }
    #[cfg(not(debug_assertions))]
    {
        let resource_root = crate::project_files::locate_resource_root(app);
        if !same_canonical_root(root_path, &resource_root) {
            return Err(ProjectWriterError::Root(root.into()));
        }
    }
    #[cfg(debug_assertions)]
    {
        // 编辑器开发工作流：dialog 选定的工程目录可不同于资源根，仅校验真实目录。
        let _ = app;
    }
    Ok(root_path.to_path_buf())
}
