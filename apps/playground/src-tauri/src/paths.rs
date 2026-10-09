//! 逻辑路径与宿主目录的通用底座：信任边界判定、段规则、遍历配套判据、应用数据目录定位。
//!
//! 各业务模块的路径规则差异全部表达为**调用点传入的规则**（字符集 + 长度上限 + 首段白名单
//! 留在调用点），判定实现只有一份——新增调用点只增规则常量，不复制校验逻辑。

use std::path::{Path, PathBuf};
use tauri::Manager;

/// 通用相对路径判定拒绝的具体形态。
///
/// 只记「哪种形态被拒」而不记路径本身：路径由调用方连同自己的领域错误一起回传，
/// 因此判定实现不依赖任何业务错误类型，各调用点按自己的文案向外表达。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PathRuleError {
    /// 空路径
    Empty,
    /// 绝对路径或含 `\`（反斜杠形态）
    Absolute,
    /// 含控制字符
    ControlChar,
    /// 含 `.` / `..` / 空段
    RelativeSegment,
    /// 某段超出该调用点的字符集或长度规则
    Segment,
}

/// 单段字符集与长度规则：描述「什么样的路径段可被本调用点接受」。
pub(crate) struct SegmentRule {
    allow_hyphen: bool,
    max_len: Option<usize>,
}

impl SegmentRule {
    /// 字母数字 + 下划线 + 连字符，段长 1..=max_len。
    pub(crate) const fn alnum_ext(max_len: Option<usize>) -> Self {
        Self {
            allow_hyphen: true,
            max_len,
        }
    }

    /// 字母数字 + 下划线，段长 1..=max_len。
    ///
    /// 规则面保留：与 `alnum_ext` 成对，供新增调用点按需取用。
    #[allow(dead_code)]
    pub(crate) const fn alnum(max_len: Option<usize>) -> Self {
        Self {
            allow_hyphen: false,
            max_len,
        }
    }

    /// 单段是否被本规则接受（空段恒不接受）。
    pub(crate) fn allows(&self, seg: &str) -> bool {
        if seg.is_empty() {
            return false;
        }
        if let Some(max) = self.max_len {
            if seg.len() > max {
                return false;
            }
        }
        seg.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || (self.allow_hyphen && c == '-'))
    }
}

/// 两族调用点共有的骨架：空路径、首字符 `/`、含 `\`、含空段或 `.`/`..` 段。
///
/// 各调用点在骨架之外**各自增减**两条判据——资源逻辑路径允许控制字符（最终由段字符集拒），
/// 写回路径额外拒控制字符、但允许 `.` 出现在段内。骨架只有一份，故两族规则不会各自漂移。
fn trusted_relative_path(path: &str) -> Result<(), PathRuleError> {
    if path.is_empty() {
        return Err(PathRuleError::Empty);
    }
    if path.starts_with('/') || path.contains('\\') {
        return Err(PathRuleError::Absolute);
    }
    if path
        .split('/')
        .any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        return Err(PathRuleError::RelativeSegment);
    }
    Ok(())
}

/// 写回路径（清单 / `Stories/**`）信任边界：骨架之上额外拒控制字符，段内允许 `.`。
pub(crate) fn validate_write_like_path(path: &str) -> Result<(), PathRuleError> {
    trusted_relative_path(path)?;
    if path.chars().any(char::is_control) {
        return Err(PathRuleError::ControlChar);
    }
    Ok(())
}

/// 资源逻辑路径信任边界（与静态 ResourcePort 同判）：拒空、拒首字符 `/`、拒 `\`、
/// 拒空段与 `.`/`..` 段——与写回路径的差别只有「是否额外拒控制字符」，其余共用骨架。
pub(crate) fn validate_resource_path(path: &str) -> Result<(), PathRuleError> {
    trusted_relative_path(path)
}

/// 逻辑路径**整段**字符集与长度规则（槽位名 / 语言段共用一条实现，边界由调用点传入）。
pub(crate) fn validate_plain_segment(
    seg: &str,
    rule: &SegmentRule,
) -> Result<(), PathRuleError> {
    if rule.allows(seg) {
        Ok(())
    } else {
        Err(PathRuleError::Segment)
    }
}

/// 文件名的点前缀（隐藏 / 系统文件）判定：各遍历点共用的排除判据。
pub(crate) fn hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

/// 遍历出的绝对路径 → 根相对逻辑路径（`\` 归一为 `/`）：各遍历点共用的收集判据。
pub(crate) fn relative_slash_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// 应用数据目录：取不到 = 结构化错误（调用方按各自语义回传可操作文案，绝不 panic）。
pub(crate) fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// 资源根定位：桌面 dev 走编译期源工程根（`LFEN_DEV_RESOURCE_ROOT` 可覆盖，便于指向加密包做本地验证），
/// release 与移动端走安装包内资源目录。定位规则由 `project_files` 持有——故事供给与媒体供给必须同根，
/// 否则一侧读源根、另一侧读安装包拷贝，两条供给链会分裂。
///
/// 定位本身不失败，返回 `Result` 只为与 `app_data` 保持同一调用形态。
pub(crate) fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::project_files::locate_resource_root(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_write_like_path_rejects_traversal_forms() {
        assert!(validate_write_like_path("Stories/a.json").is_ok());
        assert!(validate_write_like_path("Lang/en.v2/main.json").is_ok()); // 段内 `.` 合法
        for bad in ["", "/abs", "a\\b", "a//b", "./a", "../a", "a/../b", "a\u{7}b"] {
            assert!(
                validate_write_like_path(bad).is_err(),
                "{bad:?} 应被写回路径规则拒绝"
            );
        }
    }

    #[test]
    fn resource_path_keeps_legacy_boundary() {
        assert!(validate_resource_path("Video/m2.mp4").is_ok());
        assert!(validate_resource_path("Lang/en/main.json").is_ok());
        for bad in ["", "/abs", "a\\b", "../project.json", "./a", "a//b"] {
            assert!(
                validate_resource_path(bad).is_err(),
                "{bad:?} 应被资源逻辑路径边界拒绝"
            );
        }
    }

    #[test]
    fn segment_rules_bind_length_and_charset_at_call_site() {
        let slot = SegmentRule::alnum_ext(Some(64));
        assert!(slot.allows("slot-1_a"));
        assert!(!slot.allows("slot.1"));
        assert!(!slot.allows(&"a".repeat(65)));
        let lang = SegmentRule::alnum_ext(Some(32));
        assert!(lang.allows("zh-CN"));
        assert!(!lang.allows(&"a".repeat(33)));
        assert!(validate_plain_segment("slot-1", &slot).is_ok());
        assert!(validate_plain_segment("slot.1", &slot).is_err());
        assert_eq!(
            validate_plain_segment("", &slot),
            Err(PathRuleError::Segment)
        );
    }

    #[test]
    fn traversal_collection_helpers() {
        assert!(hidden_name(".env"));
        assert!(!hidden_name("main.json"));
        assert_eq!(
            relative_slash_path(Path::new("/root"), Path::new("/root/Audio/x.mp3")),
            "Audio/x.mp3"
        );
    }
}
