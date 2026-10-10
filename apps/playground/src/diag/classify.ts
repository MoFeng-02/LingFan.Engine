/**
 * 白屏归因（纯函数，可单测）。
 *
 * 判据的前置：媒体在播 / JS 在跑**都不能**证明画面出来了（音频不依赖可见画布，
 * 历史上据此误判过「已修复」）。所以归因只看**渲染面本身的证据**：DOM 规模、视口尺寸、
 * 样式表是否真生效、页面是否可见。
 */

/**
 * 白屏只有三类根因（已排除「资源供给失败」——那类会让 JS 都跑不起来，
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

/** 一次采样的白屏归因证据：全部取自现场只读探针（见 probe.ts），逐字段标注口径。 */
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
 * 口径：判 `01-page-hidden` 排在尺寸之前——隐藏页的尺寸读数会失真，先排除它才不会被带偏。
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
