//! 启动编排：把 `run()` 装配完成之后、事件循环接管之前的启动序列收在一处——启动路径留痕、
//! 临时流缓存清理、窗口显示、调试构建下的窗口状态心跳。
//!
//! 顺序本身就是诊断信息：每条日志都夹在具体一步之前或之后，卡在哪一步看最后一条即知。

use tauri::Manager;

/// 启动期窗口状态心跳（仅 debug 构建编译）。
mod probe;
/// 启动画面与主窗口的显示顺序。
mod splash;

/// 启动序列：留痕、清理临时流缓存、显示窗口、按构建类型挂上调试心跳。
pub(crate) fn setup(app: &tauri::AppHandle) {
    // 启动路径面包屑：应用可能在页面起来约 1 秒后整体卡住（心跳条数起消失、WebKit 合成
    // 停摆、录屏全白）。以下每条都在卡点之前/之后留痕，用于把卡点夹到具体一步。
    eprintln!("[lfen] setup: 进入");
    // 临时流缓存随启动清理（同 DEK 同路径 → 内容确定性可重建）
    if let Ok(data) = app.path().app_data_dir() {
        crate::resource_crypto::cleanup_tmp_stream(&data);
    }
    eprintln!("[lfen] setup: tmp 清理完成");
    // 诊断探针已改前端 build-flag（VITE_LFEN_DIAG=1，src/diag.ts）；lfen_diag 命令保留为回传通道
    splash::splash_then_show(app);
    eprintln!("[lfen] setup: 窗口显示流程返回");
    // 启动期窗口状态心跳：前端探针会随页面节流一起冻结（日志往往只到启动后不到一秒），
    // 只有 Rust 侧心跳能区分「页面被节流」与「整个进程被挂起」——白屏归因的分水岭
    #[cfg(debug_assertions)]
    probe::spawn_boot_probe(app);
}
