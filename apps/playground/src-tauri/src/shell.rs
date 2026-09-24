//! 08 §八.2 平台壳能力命令面：屏幕方向配置（壳配置，非叙事语义——引擎核心不解释）。
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
    /// 原生侧载荷字符串（Kotlin `ShellPlugin.setOrientation` 的判据）
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

/// 08 §八.2 设置屏幕方向。返回是否已由当前平台应用
/// （Android = true；桌面/其余 = false——UI 依此只记诊断，不视作错误）。
#[tauri::command]
pub fn set_orientation(app: tauri::AppHandle, mode: String) -> Result<bool, ShellError> {
    let parsed = parse_orientation(&mode)?;
    apply_orientation(&app, parsed)
}

/// Android：经自注册 Kotlin 插件写 `Activity.requestedOrientation`
/// （命令面与 AssetListPlugin 同套路：`register_android_plugin` + `run_mobile_plugin`）。
#[cfg(target_os = "android")]
mod android {
    use super::{OrientationMode, ShellError};
    use tauri::Manager;

    /// Kotlin `ShellPlugin` 句柄（setup 期注册后入 managed state）
    pub struct ShellBridge(pub tauri::plugin::PluginHandle<tauri::Wry>);

    /// 注册 Kotlin ShellPlugin 的内联 tauri 插件（Android 专用）
    pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
        tauri::plugin::Builder::<tauri::Wry>::new("lfen-shell")
            .setup(|app, api| {
                let handle = api
                    .register_android_plugin("com.langfeng.lingfanengine.shell", "ShellPlugin")?;
                app.manage(std::sync::Arc::new(ShellBridge(handle)));
                Ok(())
            })
            .build()
    }

    pub fn apply(app: &tauri::AppHandle, mode: OrientationMode) -> Result<bool, ShellError> {
        // 插件命令在主线程执行（PluginManager 经主 looper 派发）——可安全触碰 Activity
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

/// Android 插件注册入口（lib.rs 装配用）
#[cfg(target_os = "android")]
pub use android::plugin as android_plugin;

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

    pub fn apply(
        app: &tauri::AppHandle,
        mode: OrientationMode,
    ) -> Result<bool, super::ShellError> {
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

/// 方向应用分平台：Android 走原生插件；其余平台 no-op（未应用 = false）
#[cfg(target_os = "android")]
fn apply_orientation(app: &tauri::AppHandle, mode: OrientationMode) -> Result<bool, ShellError> {
    android::apply(app, mode)
}

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
        // 锚点: orientation-mode-parse——三态契约（与 TS OrientationMode 字面量一致）
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

    #[test]
    fn parse_orientation_rejects_unknown_and_case_variants() {
        // fail-closed：未知值/大小写变体/空白一律拒绝（不猜测用户意图，不带病落壳）
        for bad in ["", "Auto", "LANDSCAPE", "landscape ", "sensor", " unspecified"] {
            assert!(
                matches!(parse_orientation(bad), Err(ShellError::BadMode(_))),
                "{bad:?} 应被拒绝"
            );
        }
    }
}
