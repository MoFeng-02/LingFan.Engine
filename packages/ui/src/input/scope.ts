/**
 * 输入域声明与游戏输入判据（框架无关纯逻辑，宿主与嵌入方共用）。
 *
 * 回答两个不同层面的「谁消费输入」：
 *
 * 1. **事件目标层面**（[`isGameInputTarget`]）：舞台铺满视口且内部挂着工具条与面板，
 *    事件会从这些控件冒泡上来。命中原生输入控件、或位于标记为 UI 容器的元素内
 *    （`[data-ui-zone]`）即非游戏输入——否则在历史面板里滚动会连带把故事回退，
 *    输入框里的空格会被推进逻辑吞掉。
 * 2. **模式层面**（[`InputScope`]）：外部玩法系统接管期间（方向键行走、战斗、QTE），
 *    推进类按键应整体让位，而不是逐事件判断。
 *
 * 两者正交，[`routesToNarrative`] 同时要求「域为对话」与「目标不是控件」。
 * 域是**宿主状态**而非引擎状态：输入路由属展示层职责，引擎只暴露等待态
 * （`__waiting`），由宿主决定把按键交给谁。
 *
 * 有意不看「容器当前是否真能滚动」：同一面板的滚轮行为不应随内容多少变脸
 * （内容不满一屏时也一律不回溯，避免滚轮在面板里时而回溯时而滚动）。
 */

/** 输入域：本帧的按键 / 滚轮 / 点击归谁消费 */
export type InputScope =
  /** 对话域（默认）：推进、回溯、前进由叙事层消费 */
  | "dialogue"
  /** 外部玩法域：叙事层整体让位，输入归外部系统（行走、战斗…） */
  | "world"
  /** 面板域：输入归界面控件，叙事层不消费 */
  | "ui";

/** 域全集（诊断 / 遍历用；顺序 = 默认在前） */
export const INPUT_SCOPES: readonly InputScope[] = ["dialogue", "world", "ui"];

/** 域值收窄：非声明值一律不成立（外部传入的字符串不做猜测） */
export function isInputScope(value: unknown): value is InputScope {
  return value === "dialogue" || value === "world" || value === "ui";
}

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

/**
 * 本次输入是否归叙事层消费：**域为对话** 且 **目标不在控件/UI 面板内**。
 *
 * 任一不成立即不消费，宿主据此短路——玩法接管期间连 `advance` 都不发，
 * 避免「让位后仍在后台推进故事」这类竞态。
 */
export function routesToNarrative(scope: InputScope, target: unknown): boolean {
  return scope === "dialogue" && isGameInputTarget(target);
}

/** 可变输入域（宿主持有；订阅用于界面提示与路由刷新） */
export interface InputScopeState {
  current(): InputScope;
  /** 切换域；非法值忽略（保持原域）——域来自宿主，畸形输入不猜 */
  set(scope: InputScope): void;
  /** 订阅域变化；返回退订函数 */
  subscribe(listener: (scope: InputScope) => void): () => void;
}

/**
 * 建输入域状态。默认 `dialogue`（叙事激活），玩法系统接管时由宿主切 `world`。
 * 同值重复设置不通知订阅者（宿主可能在每帧断言域）。
 */
export function createInputScopeState(
  initial: InputScope = "dialogue",
): InputScopeState {
  let scope: InputScope = initial;
  const listeners = new Set<(scope: InputScope) => void>();
  return {
    current: () => scope,
    set(next: InputScope): void {
      if (!isInputScope(next) || next === scope) return;
      scope = next;
      for (const listener of listeners) listener(scope);
    },
    subscribe(listener: (scope: InputScope) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
