//! 路径白名单与错误类型：写回面与删除面各自的可写范围判定。

use serde::Serialize;

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
