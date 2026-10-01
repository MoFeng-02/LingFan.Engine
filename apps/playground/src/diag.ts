/**
 * 渲染诊断探针（build-flag 开关：`VITE_LFEN_DIAG=1` 构建时进产物并自启；
 * 默认构建 tree-shake 零字节）。替代原 Rust `eval` 注入（diagnostics.rs arm 已删）：
 * 探针由前端自身在页面生命周期内定时采样，不依赖注入时机；回传仍走 `lfen_diag`
 * 命令 → stderr（iOS CI 经 --console-pty 收进 launch 日志，Android 进 logcat）。
 *
 * 用途：定位「应用跑得起来但画面空白」类问题（白屏取证）——采集渲染层栈
 * （z-index/矩形/可见性）、#app 规模与背景、媒体元素状态（readyState/error/矩形），
 * 并在每次采样时给出**白屏归因结论**（见 `classifyWhiteScreen`）。
 * 浏览器形态（无 Tauri IPC）静默跳过上报，采样逻辑照常执行。
 *
 * ⚠️ 判据的前置：媒体在播 / JS 在跑**都不能**证明画面出来了（音频不依赖可见画布，
 * 历史上据此误判过「已修复」）。所以归因只看**渲染面本身的证据**：DOM 规模、视口尺寸、
 * 样式表是否真生效、页面是否可见。
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

// —— 白屏归因：三类判据 ——

/**
 * 白屏只有三类根因（本仓已排除「资源供给失败」——那类会让 JS 都跑不起来，
 * 现场特征是有可见的「工程加载失败」文案/日志，而非纯白）：
 *
 * - `01-dom-missing`：DOM 根本没建起来（JS 未执行 / 框架未挂载）
 * - `01-page-hidden`：页面处于 hidden（后台/未激活）⇒ WebView 不合成，截图为白（**非缺陷**）
 * - `01-viewport-zero`：视口或渲染面尺寸为 0（WebView 拿到 0 尺寸 / 合成面没尺寸）
 * - `02-style-missing`：DOM 在、但样式表未生效（自定义 scheme 子资源被拒等）
 * - `03-content-invisible`：DOM 在、尺寸与样式表都正常 ⇒ 层级/颜色/合成问题（须像素比对）
 * - `unknown`：证据不足以定类
 */
export type WhiteScreenClass =
  | "01-dom-missing"
  | "01-page-hidden"
  | "01-viewport-zero"
  | "02-style-missing"
  | "03-content-invisible"
  | "unknown";

export interface WhiteScreenEvidence {
  /** `document.body.innerHTML.length` */
  readonly bodyHtmlLen: number;
  /** `#app` 子元素数（-1 = 页面里没有 `#app`） */
  readonly appChildren: number;
  /** `[innerWidth, innerHeight]` */
  readonly win: readonly [number, number];
  /** `[visualViewport.width, height]`（不可用 = null）——iOS 上比 window 更准 */
  readonly visual: readonly [number, number] | null;
  /** `#app` 渲染尺寸（null = 无 `#app`） */
  readonly appRect: readonly [number, number] | null;
  /** `document.styleSheets.length` */
  readonly styleSheets: number;
  /** `<link rel="stylesheet">` 里 `sheet !== null`（= 真的生效）的数量 */
  readonly styleSheetsLoaded: number;
  /** `document.visibilityState` */
  readonly visibilityState: string;
}

/**
 * 纯函数归因（可单测）：按「最省事的解释优先」排序，先命中先返回。
 * 实测口径：判 `01-page-hidden` 排在尺寸之前——隐藏页的尺寸读数会失真，先排除它才不会被带偏。
 */
export function classifyWhiteScreen(ev: WhiteScreenEvidence): {
  cls: WhiteScreenClass;
  why: string;
} {
  if (ev.bodyHtmlLen < 64 && ev.appChildren <= 0) {
    return {
      cls: "01-dom-missing",
      why: `body 极短(${ev.bodyHtmlLen}) 且 #app 空(${ev.appChildren}) ⇒ JS 未执行/框架未挂载`,
    };
  }
  if (ev.visibilityState === "hidden") {
    return {
      cls: "01-page-hidden",
      why: "页面 hidden ⇒ WebView 不合成、截图为白（非缺陷，先排除）",
    };
  }
  const zero = (pair: readonly [number, number] | null): boolean =>
    pair !== null && (pair[0] === 0 || pair[1] === 0);
  if (zero(ev.win) || zero(ev.visual) || zero(ev.appRect)) {
    return {
      cls: "01-viewport-zero",
      why: `视口/渲染面尺寸为 0（win=${ev.win} visual=${ev.visual} app=${ev.appRect}）`,
    };
  }
  if (ev.styleSheets === 0 || ev.styleSheetsLoaded === 0) {
    return {
      cls: "02-style-missing",
      why: `样式表未生效（styleSheets=${ev.styleSheets} 已加载=${ev.styleSheetsLoaded}）`,
    };
  }
  if (ev.bodyHtmlLen >= 64 && ev.appChildren > 0) {
    return {
      cls: "03-content-invisible",
      why: "DOM 有规模、尺寸与样式表均正常 ⇒ 层级/颜色/合成问题（须像素比对）",
    };
  }
  return { cls: "unknown", why: "证据不足以定类" };
}

function collectStyleSheets(): {
  count: number;
  loaded: number;
  links: { href: string; loaded: boolean }[];
} {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => {
    const link = node as HTMLLinkElement;
    return { href: link.href.slice(-70), loaded: link.sheet !== null };
  });
  return {
    count: document.styleSheets.length,
    loaded: links.filter((l) => l.loaded).length,
    links,
  };
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
    const appBox = app ? app.getBoundingClientRect() : null;
    const sheets = collectStyleSheets();
    const win: [number, number] = [window.innerWidth, window.innerHeight];
    const visual: [number, number] | null = window.visualViewport
      ? [Math.round(window.visualViewport.width), Math.round(window.visualViewport.height)]
      : null;
    const appRect: [number, number] | null = appBox
      ? [Math.round(appBox.width), Math.round(appBox.height)]
      : null;
    const verdict = classifyWhiteScreen({
      bodyHtmlLen: document.body.innerHTML.length,
      appChildren: app ? app.childElementCount : -1,
      win,
      visual,
      appRect,
      styleSheets: sheets.count,
      styleSheetsLoaded: sheets.loaded,
      visibilityState: document.visibilityState,
    });
    report({
      phase,
      verdict,
      win,
      visual,
      dpr: window.devicePixelRatio,
      visibility: document.visibilityState,
      readyState: document.readyState,
      htmlLen: document.body.innerHTML.length,
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      appChildren: app ? app.childElementCount : -1,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      appBg: app ? getComputedStyle(app).backgroundColor : null,
      appRect,
      styleSheets: sheets.count,
      styleSheetsLoaded: sheets.loaded,
      styleSheetLinks: sheets.links,
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
