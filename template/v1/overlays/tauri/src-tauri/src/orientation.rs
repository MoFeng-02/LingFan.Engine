//! 屏幕方向命令面（壳配置，非叙事语义——引擎核心不解释）。
//!
//! 与前端 `packages/adapters/src/shell/orientation.ts` 的 `set_orientation` 逐字对应。
//! 本参考骨架不内置移动端原生方向通道（Android JNI / iOS UIKit 需各自的原生依赖与
//! 平台声明，属交付方按目标平台补齐的部分），故所有平台一律 no-op 返回 `false`：
//! 「尽力而为」契约——未生效不算错误，前端策略只记诊断。方向模式解析仍 fail-closed，
//! 非法字符串拒绝，不应用任何设置。

use serde::Serialize;

/// 方向模式（与 TS `OrientationMode` 同构；字符串映射是跨边界契约）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrientationMode {
    Auto,
    Portrait,
    Landscape,
}

/// 方向切换的失败类型；序列化为 `{code, detail}`，前端按 `code` 分支处理。
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum ShellError {
    #[serde(rename = "bad-mode")]
    BadMode(String),
}

impl std::fmt::Display for ShellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ShellError::BadMode(m) => write!(f, "方向模式非法：{m}"),
        }
    }
}

impl std::error::Error for ShellError {}

/// 方向模式解析（信任边界：前端可传任意字符串 → 非法一律 fail-closed，大小写敏感）
pub fn parse_orientation(mode: &str) -> Result<OrientationMode, ShellError> {
    match mode {
        "auto" => Ok(OrientationMode::Auto),
        "portrait" => Ok(OrientationMode::Portrait),
        "landscape" => Ok(OrientationMode::Landscape),
        other => Err(ShellError::BadMode(format!(
            "未知方向模式：{other}（期望 auto|portrait|landscape）"
        ))),
    }
}

/// 设置屏幕方向。返回是否已由当前平台应用。
///
/// 本骨架恒返回 `false`（未内置原生方向通道）：前端依此只记诊断，不视作错误。
/// 交付方为目标移动端平台接入原生通道后，在此按平台落地并返回 `true`。
#[tauri::command]
pub fn set_orientation(mode: String) -> Result<bool, ShellError> {
    let _parsed = parse_orientation(&mode)?;
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_orientation_accepts_three_modes() {
        assert_eq!(parse_orientation("auto").unwrap(), OrientationMode::Auto);
        assert_eq!(
            parse_orientation("portrait").unwrap(),
            OrientationMode::Portrait
        );
        assert_eq!(
            parse_orientation("landscape").unwrap(),
            OrientationMode::Landscape
        );
    }

    #[test]
    fn parse_orientation_rejects_unknown_and_case_variants() {
        // fail-closed：未知值/大小写变体/空白一律拒绝，不应用任何方向设置
        for bad in ["", "Auto", "LANDSCAPE", "landscape ", "sensor"] {
            assert!(
                matches!(parse_orientation(bad), Err(ShellError::BadMode(_))),
                "{bad:?} 应被拒绝"
            );
        }
    }

    #[test]
    fn set_orientation_is_best_effort_noop() {
        // 合法模式：未内置原生通道 → 未应用（false），不是错误
        assert_eq!(set_orientation("portrait".to_string()).unwrap(), false);
        // 非法模式：fail-closed 拒绝
        assert!(set_orientation("sensor".to_string()).is_err());
    }
}