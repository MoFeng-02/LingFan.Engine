//! 媒体资源是否走本机回环流式通道的判定与地址构造。

use std::path::Path;

/// 音视频扩展名判定：回环通道只服务这两类（图/字体/JS/故事不经此路径——它们的消费者
/// 不发非零起点 `Range`，走既有 lfstream 供给即可）。
pub(crate) fn is_media_ext(logical: &str) -> bool {
    let ext = Path::new(logical)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "mp4"
            | "webm"
            | "mov"
            | "mkv"
            | "avi"
            | "mp3"
            | "ogg"
            | "wav"
            | "m4a"
            | "aac"
            | "flac"
            | "opus"
    )
}

/// 回环供给命中判定（Android ∧ 加密 ∧ 音视频）：纯函数，`is_android` 由调用方以 `cfg!` 传入
/// ——使两条分支都能在桌面单测覆盖，不依赖目标平台（`cfg` 掉的分支桌面门禁验不到）。
pub(crate) fn loopback_eligible(is_android: bool, logical: &str) -> bool {
    is_android && is_media_ext(logical)
}

/// 大媒体回环 URL（命中判定 + 服务懒启动）：未命中或服务未起 = `None`——调用方回落 lfstream
/// 既有 URL（fail-soft，绝不改坏非命中路径）。
///
/// 为什么大媒体必须离开 lfstream：Android 侧自定义协议响应体被整段拷进 JVM `byte[]`
/// （见 `media_http` 模块头），设备 Java 堆放不下大媒体；且该拦截层对非零起点 `Range` 必失败。
pub(crate) fn loopback_media_url(app: &tauri::AppHandle, logical: &str) -> Option<String> {
    if !loopback_eligible(cfg!(target_os = "android"), logical) {
        return None;
    }
    let server = crate::media_http::ensure_server(app)?;
    Some(crate::media_http::loopback_url(
        server.port,
        &server.token,
        logical,
    ))
}
