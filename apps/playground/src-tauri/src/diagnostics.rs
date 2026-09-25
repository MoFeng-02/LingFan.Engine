//! 诊断层（仅排错用，非产品行为）：在**显式开启**时把渲染端的关键状态回传到日志。
//!
//! 用途：无 macOS 环境下定位「应用跑得起来但画面空白」类问题（CI 模拟器冒烟）。
//! 开启条件：应用环境变量 `LFEN_IOS_DIAG=1`（模拟器经 `SIMCTL_CHILD_LFEN_IOS_DIAG=1` 注入）。
//! 关闭时**零行为**：不注册定时器、不 eval、不产生任何日志。
//!
//! 设计取舍：探针 JS 由 Rust 侧 `eval` 注入（不放进前端产物），因此前端零改动、
//! release 构建零影响；回传走 `lfen_diag` 命令 → stderr（iOS/Android 均可见于系统日志）。

/// 渲染端上报的键值对（原样打印，不做解析——诊断层不解释业务）
#[tauri::command]
pub fn lfen_diag(payload: String) {
    eprintln!("[lfen-diag] {payload}");
}

/// 探针脚本：报告 DOM 规模、可见性、媒体元素状态与矩形（白屏类问题的决定性数据）
const PROBE_JS: &str = r#"(function(){
  const snapshot = (phase) => {
    try {
      const media = [...document.querySelectorAll('video,audio')].map((el) => {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(),
          src: (el.currentSrc || el.getAttribute('src') || '').slice(-70),
          rs: el.readyState, ns: el.networkState, err: el.error ? el.error.code : null,
          vw: el.videoWidth || 0, vh: el.videoHeight || 0,
          paused: el.paused, t: Math.round(el.currentTime * 100) / 100,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          disp: cs.display, vis: cs.visibility, op: cs.opacity };
      });
      const app = document.querySelector('#app');
      const payload = { phase: phase, win: [innerWidth, innerHeight],
        htmlLen: document.body.innerHTML.length,
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
        appChildren: app ? app.childElementCount : -1,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        appBg: app ? getComputedStyle(app).backgroundColor : null,
        appRect: app ? [Math.round(app.getBoundingClientRect().width), Math.round(app.getBoundingClientRect().height)] : null,
        media: media };
      window.__TAURI_INTERNALS__.invoke('lfen_diag', { payload: JSON.stringify(payload) });
    } catch (e) {
      window.__TAURI_INTERNALS__.invoke('lfen_diag', { payload: 'probe-error: ' + e });
    }
  };
  snapshot('t6');
  setTimeout(() => snapshot('t14'), 8000);
  setTimeout(() => snapshot('t24'), 18000);
})()"#;

/// 启动探针（仅当 `LFEN_IOS_DIAG=1`；延迟到页面首帧之后再采样）
pub fn arm(app: &tauri::AppHandle) {
    if std::env::var("LFEN_IOS_DIAG").is_err() {
        return;
    }
    eprintln!("[lfen-diag] 探针已启动（LFEN_IOS_DIAG=1）");
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(6));
        use tauri::Manager;
        match handle.get_webview_window("main") {
            Some(webview) => {
                if let Err(error) = webview.eval(PROBE_JS) {
                    eprintln!("[lfen-diag] eval 失败：{error}");
                }
            }
            None => eprintln!("[lfen-diag] 未找到窗口 'main'"),
        }
    });
}
