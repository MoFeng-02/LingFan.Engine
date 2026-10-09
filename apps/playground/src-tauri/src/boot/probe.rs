//! 启动期窗口状态心跳：应用起来后每隔固定间隔打印一条读数，用于判断卡顿发生在页面一侧
//! 还是整个进程。

/// 启动期窗口状态心跳（仅 debug 构建）：每 2 秒一条心跳，共 20 条（40s）。
///
/// 为什么必须由 Rust 打：前端探针一旦页面被节流或进程被挂起就一起冻结。Rust 线程的心跳
/// **若继续往下打**，说明进程活着、被冻的是页面/WebView 一侧；**若同时停在同一点**，
/// 则是整个进程被挂起（例如应用始终没拿到前台）。窗口的可见/聚焦读数同批给出。
///
/// 20 条（而非 6 条）：iOS 冷启动下前端 JS 比 Rust 侧晚数秒才起来——心跳条数太少
/// 会整段落在「页面还没起来」的时段里，覆盖不到冻结点。
#[cfg(debug_assertions)]
pub(crate) fn spawn_boot_probe(app: &tauri::AppHandle) {
    use tauri::Manager;
    let handle = app.clone();
    std::thread::spawn(move || {
        for i in 1..=20 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            // **必须先打这一条**：下面的窗口读数要走 Tauri、最终落到主线程；若主线程被卡，
            // 那次调用会把这个线程一起挂住。先打印就能区分两种成因——
            //   只出现「心跳 #n」而无窗口读数 ⇒ 主线程卡住（Tauri 调用阻塞在此）
            //   连「心跳 #n」都没有        ⇒ 整个进程被挂起/线程调度停止
            eprintln!("[lfen] 心跳 #{i}");
            let state = match handle.get_webview_window("main") {
                Some(window) => format!(
                    "可见={:?} 聚焦={:?} 最小化={:?}",
                    window.is_visible(),
                    window.is_focused(),
                    window.is_minimized()
                ),
                None => "无 main 窗口".to_string(),
            };
            eprintln!("[lfen] 启动心跳 #{i}：{state}");
        }
    });
}
