//! 启动画面与主窗口的显示顺序：桌面先起 splash 盖住首启时延，预热完成后显示主窗口并收起
//! splash；移动端没有第二窗口，直接显示主窗口。

use tauri::Manager;

/// 双窗启动画面（桌面）：splash 先行显示，盖住资源根定位 / DEK 首启信封化解封
/// 的时延；预热完成后显示主窗口并关闭 splash。移动端无第二窗口——直接显示主窗口
/// （防御 conf `visible: false` 在移动端生效导致的白屏）。
/// splash 创建失败不阻塞启动（fail 尽力）；主窗口显示失败打印可见错误（fail-closed 不静默）。
pub(crate) fn splash_then_show(app: &tauri::AppHandle) {
    #[cfg(desktop)]
    let splash = tauri::WebviewWindowBuilder::new(
        app,
        "splashscreen",
        tauri::WebviewUrl::App("splashscreen.html".into()),
    )
    .title("lingfanengine")
    .inner_size(420.0, 240.0)
    .center()
    .resizable(false)
    .decorations(false)
    .build()
    .map_err(|e| eprintln!("[lfen] splash 窗口创建失败（继续启动）：{e}"))
    .ok();

    // 首启 seed→KEK 信封化解封在此完成（明文形态失败无害）——show 之后 v2 供给立即可用
    eprintln!("[lfen] 预热资源密钥：开始");
    crate::resource_crypto::preheat_resource_key(app);
    eprintln!("[lfen] 预热资源密钥：完成");

    if let Some(main) = app.get_webview_window("main") {
        eprintln!("[lfen] 主窗口 show：调用");
        if let Err(e) = main.show() {
            eprintln!("[lfen] 主窗口显示失败：{e}");
        }
        eprintln!("[lfen] 主窗口 show：返回");
    }
    #[cfg(desktop)]
    if let Some(splash) = splash {
        let _ = splash.close();
    }
}
