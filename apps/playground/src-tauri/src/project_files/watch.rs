//! 源工程热重载监视：仅桌面调试构建可用，事件防抖后通知前端。

use crate::project_files::supply::{ProjectFilesError};
use std::path::Path;

/// 热重载事件名：工程文件变更（防抖后）→ 前端重新供给+组装并 reloadStory
pub(crate) const STORY_CHANGED_EVENT: &str = "story-changed";

/// 防抖静默窗：编辑器保存常产生截断+写入/替换等多事件，静默窗内合并为一次通知
#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
const WATCH_QUIET: std::time::Duration = std::time::Duration::from_millis(250);

/// 监视启动幂等标记（spawn 成功才置位；失败保持未置位，重试可再建）
#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
static WATCH_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 防抖循环：事件突发 → 静默窗（quiet）内无新事件 → 回调一次；
/// 通道断开 → 尾事件结算后退出（线程收尾，watcher 随之销毁）。
/// 编辑器保存常产生截断+写入/替换等多事件——合并为一次通知（热重载触发）。
pub(crate) fn run_event_debouncer<F: Fn() + Send + 'static>(
    rx: std::sync::mpsc::Receiver<notify::Result<notify::Event>>,
    quiet: std::time::Duration,
    on_quiet: F,
) {
    let mut pending = false;
    loop {
        match rx.recv_timeout(quiet) {
            Ok(_) => pending = true,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if pending {
                    pending = false;
                    on_quiet();
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if pending {
                    on_quiet();
                }
                return;
            }
        }
    }
}

/// 热重载监视（dev 工具）：递归监视**源**工程根——编译期定位
/// `CARGO_MANIFEST_DIR/../Resources`（dev 下即创作者编辑的目录；target 副本只在
/// cargo 重编时更新，监视副本取不到保存事件）。防抖后发 `story-changed` 事件，
/// 前端重新供给+组装并 reloadStory。仅桌面 debug 构建有效（release 与移动端
/// 显式 fail-closed——移动端资源在安装包内只读，且宿主路径在设备上不存在）；
/// 重复调用幂等（成功置位标记保证线程与 watcher 只建一次）。
#[tauri::command]
pub fn watch_project_files(app: tauri::AppHandle) -> Result<(), ProjectFilesError> {
    #[cfg(any(not(debug_assertions), target_os = "android", target_os = "ios"))]
    {
        let _ = &app;
        return Err(ProjectFilesError::WatchDevOnly);
    }
    #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
    {
        use notify::Watcher;
        use std::sync::mpsc;
        use tauri::Emitter;
        if WATCH_STARTED.load(std::sync::atomic::Ordering::Acquire) {
            return Ok(());
        }
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../Resources");
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher =
            notify::recommended_watcher(tx).map_err(|e| ProjectFilesError::Watch(e.to_string()))?;
        watcher
            .watch(&source, notify::RecursiveMode::Recursive)
            .map_err(|e| ProjectFilesError::Watch(e.to_string()))?;
        let app = app.clone();
        // spawn 失败：watcher 随未启动的闭包丢弃 = 监视自动解除；降级为「无热重载」，
        // 错误经命令面回传可操作文案（命令路径禁 panic），标记保持未置位以便重试
        match std::thread::Builder::new()
            .name("story-watch".into())
            .spawn(move || {
                // watcher 拥有权留在本线程 = 监视存活至进程退出（或线程收尾）
                let _keep = watcher;
                run_event_debouncer(rx, WATCH_QUIET, move || {
                    let _ = app.emit(STORY_CHANGED_EVENT, ());
                });
            }) {
            Ok(_) => {
                WATCH_STARTED.store(true, std::sync::atomic::Ordering::Release);
                Ok(())
            }
            Err(e) => {
                eprintln!("[lfen] story-watch 线程启动失败，热重载已禁用：{e}");
                Err(ProjectFilesError::Watch(format!(
                    "story-watch 线程启动失败，热重载已禁用：{e}"
                )))
            }
        }
    }
}
