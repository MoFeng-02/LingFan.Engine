/**
 * 渲染诊断探针（build-flag 开关：`VITE_LFEN_DIAG=1` 构建时进产物并自启；
 * 默认构建 tree-shake 零字节）。替代原 Rust `eval` 注入（diagnostics.rs arm 已删）：
 * 探针由前端自身在页面生命周期内定时采样，不依赖注入时机；回传仍走 `lfen_diag`
 * 命令 → stderr（iOS CI 经 --console-pty 收进 launch 日志，Android 进 logcat）。
 *
 * 用途：定位「应用跑得起来但画面空白」类问题（白屏取证）——采集渲染层栈
 * （z-index/矩形/可见性）、#app 规模与背景、媒体元素状态（readyState/error/矩形）。
 * 浏览器形态（无 Tauri IPC）静默跳过上报，采样逻辑照常执行。
 */

interface DiagWindow {
  __TAURI_INTERNALS__?: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
}

function report(payload: unknown): void {
  const tauri = (window as unknown as DiagWindow).__TAURI_INTERNALS__;
  tauri?.invoke("lfen_diag", { payload: JSON.stringify(payload) }).catch(() => {});
}

function snapshot(phase: string): void {
  try {
    const media = [...document.querySelectorAll("video,audio")].map((node) => {
      const el = node as HTMLVideoElement;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        src: (el.currentSrc || el.getAttribute("src") || "").slice(-70),
        rs: el.readyState,
        ns: el.networkState,
        err: el.error ? el.error.code : null,
        vw: el.videoWidth || 0,
        vh: el.videoHeight || 0,
        paused: el.paused,
        t: Math.round(el.currentTime * 100) / 100,
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        disp: cs.display,
        vis: cs.visibility,
        op: cs.opacity,
      };
    });
    // 渲染层栈：全部显式 z-index 元素（白屏疑似层叠/裁切问题时的决定性数据）
    const layered = [...document.querySelectorAll("*")]
      .map((el) => ({ el, cs: getComputedStyle(el) }))
      .filter(({ cs }) => cs.zIndex !== "auto" && cs.display !== "none")
      .slice(0, 12)
      .map(({ el, cs }) => {
        const rect = el.getBoundingClientRect();
        return {
          key: el.id || String(el.className).slice(0, 30) || el.tagName.toLowerCase(),
          z: cs.zIndex,
          pos: cs.position,
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
          vis: cs.visibility,
          op: cs.opacity,
        };
      });
    const app = document.querySelector("#app");
    report({
      phase,
      win: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      htmlLen: document.body.innerHTML.length,
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      appChildren: app ? app.childElementCount : -1,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      appBg: app ? getComputedStyle(app).backgroundColor : null,
      appRect: app
        ? [Math.round(app.getBoundingClientRect().width), Math.round(app.getBoundingClientRect().height)]
        : null,
      layered,
      media,
    });
  } catch (error) {
    report(`probe-error: ${String(error)}`);
  }
}

/** 启动探针：按给定延时序列采样（默认 2s/10s/20s，覆盖 iOS CI 的 25s 存活窗口） */
export function startDiag(delays: readonly number[] = [2000, 10000, 20000]): void {
  report({ phase: "probe-start", ua: navigator.userAgent.slice(0, 80) });
  for (const delay of delays) {
    window.setTimeout(() => snapshot(`t${Math.round(delay / 1000)}`), delay);
  }
}
