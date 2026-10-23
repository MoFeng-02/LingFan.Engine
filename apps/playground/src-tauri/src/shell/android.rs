//! Android 方向落地：JNI 直调 `Activity.setRequestedOrientation(int)`。
//!
//! 通道 = `Webview::with_webview(|平台句柄| …)` 内的 `jni_handle().exec(...)`：闭包拿到
//! `PlatformWebview`，其 `exec` 直接给出 `JNIEnv` 与当前 Activity——不必走
//! `Manager::get_webview`（那条要求 tauri `unstable` feature）。
//!
//! 同步语义：`exec` 是派发不等待，本函数在闭包内以通道回传结果，命令侧短超时收取
//! （Tauri 命令运行在独立线程池、不在主线程，等待不会死锁）。

use super::OrientationMode;

/// 派发 JNI 调用并把执行结果写入 `tx`。
///
/// 调用方已保证运行在 `with_webview` 闭包内（平台句柄可用）。接收端可能已超时离开，
/// 发送失败不影响原生侧已执行的结果。
pub fn apply(
    platform: &tauri::webview::PlatformWebview,
    mode: OrientationMode,
    tx: std::sync::mpsc::Sender<Result<(), String>>,
) {
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
        let _ = tx.send(result);
    });
}
