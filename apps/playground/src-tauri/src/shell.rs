//! 平台壳能力命令面：屏幕方向配置（壳配置，非叙事语义——引擎核心不解释）。
//!
//! 移动端经原生插件落地方向（Android = `Activity.requestedOrientation`；iOS 待接：
//! 需 `UIWindowScene.requestGeometryUpdate` + Info.plist 声明集合）；桌面与浏览器宿主
//! 无此概念 → no-op 返回 `false`（「尽力而为」契约：未生效不算错误）。
//!
//! 平台边界：静态声明决定「允许集合」上限——Android 16 起 sw≥600dp 大屏忽略方向限制，
//! 工程以 `android:appCategory="game"` 取游戏豁免；iOS 须在 plist 内声明过该方向。

use serde::Serialize;

/// 方向模式（与 TS `OrientationMode` 同构；字符串映射与 Kotlin ShellPlugin 一致，互锁见 bridge_check）
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
    /// 刻意不做平台 cfg 门控：映射是纯数据，桌面测试才能锚定它——该面是 JNI 直调
    /// 唯一的字面量契约，锚点测试（`orientation-jni-constants`）即它的自动化防线。
    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    fn android_constant(self) -> i32 {
        match self {
            OrientationMode::Auto => -1,
            OrientationMode::Portrait => 1,
            OrientationMode::Landscape => 0,
        }
    }

    /// 原生侧载荷字符串（iOS Swift 插件判据；Android 走 JNI 常量映射不经此）
    #[cfg_attr(not(any(target_os = "ios", test)), allow(dead_code))]
    fn as_str(self) -> &'static str {
        match self {
            OrientationMode::Auto => "auto",
            OrientationMode::Portrait => "portrait",
            OrientationMode::Landscape => "landscape",
        }
    }
}

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

/// Android：JNI 直调 `Activity.setRequestedOrientation(int)`（不经自维护 Kotlin 插件）。
///
/// 通道 = `Webview::with_webview(|平台句柄| …)` 内的 `jni_handle().exec(...)`：`with_webview`
/// 只按 `wry` feature 门控（默认开），闭包拿到 `PlatformWebview`，其 `exec` 直接给出
/// JNIEnv 与当前 Activity——不必走 `Manager::get_webview`（那条要求 tauri `unstable` feature）。
///
/// 同步语义保留：`exec` 是派发不等待，闭包内以通道回传结果，命令侧短超时收取
/// （Tauri 命令运行在独立线程池、不在主线程，等待不会死锁）；超时按「未生效」
/// 返回 `false`——契约允许，并留诊断。
#[cfg(target_os = "android")]
const ANDROID_APPLY_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1000);

#[cfg(target_os = "android")]
fn apply_orientation(app: &tauri::AppHandle, mode: OrientationMode) -> Result<bool, ShellError> {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return Err(ShellError::Native("主窗口不存在".to_string()));
    };
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let webview: tauri::Webview<_> = window.as_ref().clone();
    webview
        .with_webview(move |platform| {
            platform.jni_handle().exec(move |env, activity, _webview| {
                let result = env
                    .call_method(
                        activity,
                        "setRequestedOrientation",
                        "(I)V",
                        &[jni::objects::JValue::Int(mode.android_constant())],
                    )
                    .map(|_| ())
                    .map_err(|e| format!("setRequestedOrientation 调用失败：{e}"));
                // 接收端可能已超时离开——发送失败不影响原生侧已执行的结果
                let _ = tx.send(result);
            });
        })
        .map_err(|e| ShellError::Native(format!("平台 webview 句柄获取失败：{e}")))?;
    match rx.recv_timeout(ANDROID_APPLY_TIMEOUT) {
        Ok(Ok(())) => Ok(true),
        Ok(Err(message)) => Err(ShellError::Native(message)),
        Err(_) => {
            eprintln!("[lfen] 方向应用超时（{mode:?}）：webview 线程未在时限内回传");
            Ok(false)
        }
    }
}

/// iOS：Swift 插件 C 入口声明（`ios/ShellPlugin.swift` 的 `@_cdecl("init_plugin_shell")`）
/// 与自注册插件（lib.rs 装配用）。
#[cfg(target_os = "ios")]
mod ios {
    use super::OrientationMode;
    use tauri::Manager;

    tauri::ios_plugin_binding!(init_plugin_shell);

    /// Kotlin 侧的 Swift 对应物：ShellPlugin 句柄（setup 期注册后入 managed state）
    pub struct ShellBridge(pub tauri::plugin::PluginHandle<tauri::Wry>);

    /// 注册 Swift ShellPlugin 的内联 tauri 插件（iOS 专用）
    pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
        tauri::plugin::Builder::<tauri::Wry>::new("lfen-shell")
            .setup(|app, api| {
                let handle = api.register_ios_plugin(init_plugin_shell)?;
                app.manage(std::sync::Arc::new(ShellBridge(handle)));
                Ok(())
            })
            .build()
    }

    pub fn apply(app: &tauri::AppHandle, mode: OrientationMode) -> Result<bool, super::ShellError> {
        use super::ShellError;
        let bridge = app.state::<std::sync::Arc<ShellBridge>>();
        bridge
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "setOrientation",
                serde_json::json!({ "mode": mode.as_str() }),
            )
            .map(|_| true)
            .map_err(|e| ShellError::Native(e.to_string()))
    }
}

#[cfg(target_os = "ios")]
pub use ios::plugin as ios_plugin;

/// 方向应用分平台：Android 走 JNI 直调（见上）；iOS 走 Swift 插件；其余 no-op（未应用 = false）
#[cfg(target_os = "ios")]
fn apply_orientation(app: &tauri::AppHandle, mode: OrientationMode) -> Result<bool, ShellError> {
    ios::apply(app, mode)
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
        assert_eq!(OrientationMode::Auto.as_str(), "auto");
        assert_eq!(OrientationMode::Portrait.as_str(), "portrait");
        assert_eq!(OrientationMode::Landscape.as_str(), "landscape");
    }

    /// 锚点 `orientation-jni-constants`：三态 → Android `SCREEN_ORIENTATION_*` 常量映射。
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
