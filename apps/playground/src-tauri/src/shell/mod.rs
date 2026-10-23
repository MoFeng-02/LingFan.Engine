//! 平台壳能力命令面：屏幕方向配置（壳配置，非叙事语义——引擎核心不解释）。
//!
//! 移动端经原生通道落地方向：Android = JNI 直调 `Activity.requestedOrientation`；
//! iOS = objc2 直调 UIKit（运行时子类覆写方向方法 + 几何更新请求，见 [`ios`]）。
//! 桌面与浏览器宿主无此概念 → no-op 返回 `false`（「尽力而为」契约：未生效不算错误）。
//!
//! 平台边界：静态声明决定「允许集合」上限——Android 16 起 sw≥600dp 大屏忽略方向限制，
//! 工程以 `android:appCategory="game"` 取游戏豁免；iOS 须在 plist 内声明过该方向。

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "ios")]
mod ios;

use serde::Serialize;

/// 原生侧回传等待上限：超过即按「未生效」返回 `false`（契约允许，留诊断）。
#[cfg(any(target_os = "android", target_os = "ios"))]
const APPLY_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1000);

/// 方向模式（与 TS `OrientationMode` 同构；字符串映射是跨边界契约，互锁见 bridge_check）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrientationMode {
    Auto,
    Portrait,
    Landscape,
}

impl OrientationMode {
    /// Android `ActivityInfo.SCREEN_ORIENTATION_*` 常量（JNI 直调用）：
    /// auto = UNSPECIFIED(-1) 交给系统；portrait = 1；landscape = 0。
    ///
    /// 刻意不做平台 cfg 门控：映射是纯数据，桌面测试才能覆盖它——该面是 JNI 直调
    /// 唯一的字面量契约，由下方的常量映射测试守护。
    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    fn android_constant(self) -> i32 {
        match self {
            OrientationMode::Auto => -1,
            OrientationMode::Portrait => 1,
            OrientationMode::Landscape => 0,
        }
    }
}

/// 屏幕方向切换的失败类型；序列化为 `{code, detail}`，前端按 `code` 分支处理。
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "code", content = "detail")]
pub enum ShellError {
    #[serde(rename = "bad-mode")]
    BadMode(String),
    #[serde(rename = "native")]
    Native(String),
}

impl std::fmt::Display for ShellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ShellError::BadMode(m) => write!(f, "方向模式非法：{m}"),
            ShellError::Native(m) => write!(f, "原生方向应用失败：{m}"),
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

/// 设置屏幕方向。返回是否已由当前平台应用
/// （Android = true；桌面/其余 = false——UI 依此只记诊断，不视作错误）。
#[tauri::command]
pub fn set_orientation(app: tauri::AppHandle, mode: String) -> Result<bool, ShellError> {
    let parsed = parse_orientation(&mode)?;
    apply_orientation(&app, parsed)
}

/// 方向应用分平台：Android 走 JNI 直调、iOS 走 objc2 直调；其余 no-op（未应用 = false）
#[cfg(any(target_os = "android", target_os = "ios"))]
fn apply_orientation(app: &tauri::AppHandle, mode: OrientationMode) -> Result<bool, ShellError> {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return Err(ShellError::Native("主窗口不存在".to_string()));
    };
    // 两条平台通道都在主线程执行（JNI 的 exec 派发 / objc2 的 UIKit 调用），命令本身跑在
    // Tauri 的线程池里，等待不会死锁；回传失败只说明接收端已超时离开，不影响原生结果。
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    window
        .with_webview(move |platform| {
            #[cfg(target_os = "android")]
            android::apply(&platform, mode, tx);
            #[cfg(target_os = "ios")]
            if let Err(message) = ios::apply(platform.view_controller(), mode, tx) {
                eprintln!("[lfen] 方向下发失败（{mode:?}）：{message}");
            }
        })
        .map_err(|e| ShellError::Native(format!("平台 webview 句柄获取失败：{e}")))?;
    match rx.recv_timeout(APPLY_TIMEOUT) {
        Ok(Ok(())) => Ok(true),
        Ok(Err(message)) => Err(ShellError::Native(message)),
        Err(_) => {
            eprintln!("[lfen] 方向应用超时（{mode:?}）：主线程未在时限内回传");
            Ok(false)
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn apply_orientation(_app: &tauri::AppHandle, _mode: OrientationMode) -> Result<bool, ShellError> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_orientation_accepts_three_modes() {
        // 三态契约（与 TS OrientationMode 字面量一致）
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

    /// 三态 → Android `SCREEN_ORIENTATION_*` 常量映射。
    /// 这是 JNI 直调唯一的字面量面（方法名 `setRequestedOrientation` 与签名 `(I)V`
    /// 由 bridge_check 的源断言守护）。
    #[test]
    fn orientation_android_constants_match_platform_values() {
        assert_eq!(OrientationMode::Auto.android_constant(), -1); // UNSPECIFIED
        assert_eq!(OrientationMode::Portrait.android_constant(), 1); // PORTRAIT
        assert_eq!(OrientationMode::Landscape.android_constant(), 0); // LANDSCAPE
    }

    #[test]
    fn parse_orientation_rejects_unknown_and_case_variants() {
        // fail-closed：未知值/大小写变体/空白一律拒绝，不应用任何方向设置
        for bad in [
            "",
            "Auto",
            "LANDSCAPE",
            "landscape ",
            "sensor",
            " unspecified",
        ] {
            assert!(
                matches!(parse_orientation(bad), Err(ShellError::BadMode(_))),
                "{bad:?} 应被拒绝"
            );
        }
    }
}
