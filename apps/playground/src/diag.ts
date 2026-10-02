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
  // 诊断通道自身**绝不允许上抛**：`invoke` 除了返回 rejected promise，也可能**同步抛**
  // （回调/序列化阶段），一旦同步抛就会直接抛出 `setTimeout` 回调、把后面所有采样静默吃掉。
  // 实测（iOS run #41）：只有 `probe-start` 落地，三处采样一字不见，连 catch 里的
  // `probe-error` 也没有——而 WebKit 日志里 +2s/+10s/+20s 各有一次布局催起的资源加载，
  // 证明采样确实跑到了读取几何那一步。故同步与异步两条路都要兜住。
  try {
    const tauri = (window as unknown as DiagWindow).__TAURI_INTERNALS__;
    if (tauri === undefined) return;
    const text = JSON.stringify(payload);
    const result: unknown = tauri.invoke("lfen_diag", { payload: text });
    if (typeof result === "object" && result !== null && "catch" in result) {
      void (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    /* 诊断层失败不得影响页面，也不得吞掉后续采样 */
  }
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
  report(`${phase}:enter`); // 面包屑：定时器确实进来了
  try {
    // 媒体/图片：**必须带 naturalWidth/complete**——画面空白时第一要问的就是「图到底加载成功没有」
    // （舞台层是空的还是画了透明的东西，只有图片自身状态能回答）
    const media = [...document.querySelectorAll("video,audio,img")]
      .slice(0, 3)
      .map((node) => {
        const el = node as HTMLVideoElement & HTMLImageElement;
        const isImg = el.tagName === "IMG";
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          src: (el.currentSrc || el.getAttribute("src") || "").slice(0, 90),
          ok: isImg
            ? el.complete && el.naturalWidth > 0
            : el.error === null && el.readyState >= 1,
          w: isImg ? el.naturalWidth : el.videoWidth || 0,
          h: isImg ? el.naturalHeight : el.videoHeight || 0,
          err: el.error ? el.error.code : null,
          rect: [Math.round(rect.width), Math.round(rect.height)],
        };
      });
    // 渲染层栈：全部显式 z-index 元素（白屏疑似层叠/裁切问题时的决定性数据）
    const layered = [...document.querySelectorAll("*")]
      .map((el) => ({ el, cs: getComputedStyle(el) }))
      .filter(({ cs }) => cs.zIndex !== "auto" && cs.display !== "none")
      .slice(0, 4) // 载荷必须小：os_log 对长消息截断（实测 567 字符处被切）
      .map(({ el, cs }) => {
        const rect = el.getBoundingClientRect();
        return {
          key: el.id || String(el.className).slice(0, 30) || el.tagName.toLowerCase(),
          z: cs.zIndex,
          pos: cs.position,
          // 背景色：舞台层到底「什么都没画」还是「画了透明的东西」，只能看这个
          bg: cs.backgroundColor,
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
    report(`${phase}:collected`); // 面包屑：采集走完，没被几何/样式表读取抛断
    // **先发小载荷**（结论 + 判据输入），再发大载荷（层栈 + 媒体 + 样式表明细）：
    // 大载荷若在通道上出问题，至少结论不会一起丢（这也是对「载荷过大」假设的直接检验）。
    report({
      phase,
      // 初帧（Vue 挂载前）拍到的 `#app` 必然为空，该 verdict 不代表稳态、不参与归因
      initial: phase === "t0" ? 1 : 0,
      verdict,
      win,
      visual,
      appRect,
      htmlLen: document.body.innerHTML.length,
      appChildren: app ? app.childElementCount : -1,
      styleSheets: sheets.count,
      styleSheetsLoaded: sheets.loaded,
      visibility: document.visibilityState,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      appBg: app ? getComputedStyle(app).backgroundColor : null,
    });
    // 每一份载荷**只讲一件事**：os_log 会截断长消息（实测 567 字符处被切），
    // 合在一起发时后面那些「最想知道」的字段会一起丢——分开就能各自完整落地。
    report({
      phase,
      part: "dom",
      dpr: window.devicePixelRatio,
      readyState: document.readyState,
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      styleSheetLinks: sheets.links,
    });
    report({ phase, part: "layered", layered });
    report({ phase, part: "media", media });
  } catch (error) {
    report(`${phase}:error ${String(error)}`);
  }
}

/** 启动探针：初帧采一次 + **rAF 帧计数**当钟采样（f1/f60/f300/f600）+ 挂载后前 5 次 DOM 变动采样。
 *  **不用 `setTimeout` 计时**——iOS 上它的延迟回调会被压住（实测 2s/10s/20s 一处不响）。 */
export function startDiag(): void {
  report({ phase: "probe-start", ua: navigator.userAgent.slice(0, 80) });
  snapshot("t0"); // 初帧（Vue 挂载前，`#app` 必空——该 verdict 已标 initial、不参与归因）
  // **计时器改成 rAF 帧计数**：实测 iOS 上 `setTimeout(>0)` 全被压住（2s/10s/20s 一处不响），
  // 而 rAF 正常触发（raf:1/2/3 已实证）。用帧数当钟，既绕开节流，也顺带证明页面在合成。
  // 帧步长按 60fps 估：60≈1s、300≈5s、600≈10s（覆盖 iOS CI 的 25s 存活窗口前段）。
  const at = new Map<number, string>([
    [1, "f1"],
    [60, "f60"],
    [300, "f300"],
    [600, "f600"],
  ]);
  const raf: typeof window.requestAnimationFrame | undefined =
    window.requestAnimationFrame;
  if (typeof raf === "function") {
    let frame = 0;
    const step = (): void => {
      frame += 1;
      if (frame <= 3) report(`raf:${frame}`); // 渲染存活探针：一次都不触发即「未参与合成」
      const phase = at.get(frame);
      if (phase !== undefined) snapshot(phase);
      if (frame <= 600) raf(step);
    };
    raf(step);
  }
  // 挂载即采：观察者为微任务级投递、不受定时器节流。**不 disconnect**——引擎挂载后会持续改动
  // `#app`，第 5 次变动通常已过「故事从磁盘读进来」那一刻（只采首帧会拍到空壳，实测如此）。
  const app = document.querySelector("#app");
  if (app !== null) {
    let changes = 0;
    const observer = new MutationObserver(() => {
      changes += 1;
      if (changes <= 5) snapshot(`m${changes}`);
      else observer.disconnect();
    });
    observer.observe(app, { childList: true, subtree: true });
  }
}
