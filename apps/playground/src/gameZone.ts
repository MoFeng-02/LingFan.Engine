/**
 * 游戏输入域判定：滚轮回溯与键盘推进**只在游戏域生效**。
 *
 * 为什么需要：舞台是铺满视口的容器，内部还挂着工具条与历史/设置/槽位面板，
 * 事件会从这些控件冒泡上来。若不判来源，在历史面板里滚动查看就会连带把游戏回退。
 *
 * 判据（与成熟叙事引擎的「控件消费优先」一致）：事件目标命中原生输入控件、
 * 或位于标记为 UI 容器的元素内 ⇒ 非游戏输入，游戏输入不触发。
 *
 * 有意不看「容器当前是否真能滚动」：同一面板的滚轮行为不应随内容多少变脸
 * （内容不满一屏时也一律不回溯，避免滚轮在面板里时而回溯时而滚动）。
 */

/** 原生输入控件 + UI 容器标记；命中即非游戏输入 */
export const GAME_INPUT_BLOCKED_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-ui-zone]';

/** 判定所需的最小事件目标接口（显式入参便于单测；真实值 = DOM Element） */
export interface ClosestLike {
  closest(selector: string): unknown | null;
}

/**
 * 事件目标是否属于游戏域（`true` = 应触发游戏输入）。
 * 不具备 `closest` 能力的目标（视口/文档/非元素）保守视为游戏域——它们不可能是控件内部。
 */
export function isGameInputTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") return true;
  const el = target as Partial<ClosestLike>;
  if (typeof el.closest !== "function") return true;
  return el.closest(GAME_INPUT_BLOCKED_SELECTOR) === null;
}