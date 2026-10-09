/**
 * 键位绑定面板的宿主侧装配：按键匹配与「按键捕获」交互。
 *
 * 两件事在这里成面：
 * - **按键匹配**：绑定可被玩家改写，故判定必须逐次读当前绑定（`override ?? fallback`），
 *   不能在构造期把默认表抄成闭包常量——那样改绑后不生效。
 * - **捕获**：等玩家按下一个键来改写绑定。捕获期间该监听必须走捕获阶段并吞掉事件，
 *   否则同一个按键会同时被叙事推进逻辑消费。
 *
 * 键名显示（`displayKeys`）与匹配同一处，避免「显示的是这个、匹配的是那个」。
 */
import { ref, type Ref } from "vue";
import type { KeymapAction, PlayerKeymap, PlayerPreferences } from "@lingfan/engine";

/** 键位面板的输入 */
export interface KeybindingPanelOptions {
  /** 偏好端口：改绑与清除都写它 */
  preferences: PlayerPreferences;
  /** 读当前绑定表（响应式读取，改绑后判定立即跟着变） */
  readKeymap(): PlayerKeymap | undefined;
}

/** 键位面板出口 */
export interface KeybindingPanel {
  /** 正在等待按键的动作（null = 未在捕获） */
  readonly captureAction: Ref<KeymapAction | null>;
  /** 按键是否命中该动作的绑定（未改绑时用默认表） */
  matches(
    action: KeymapAction,
    fallback: readonly string[],
    event: KeyboardEvent,
  ): boolean;
  /** 进入捕获态 */
  startCapture(action: KeymapAction): void;
  /** 恢复该动作的默认绑定 */
  resetKeybinding(action: KeymapAction): void;
  /** 捕获阶段的按键处理（须挂在同一引用上，卸载时才能对称摘除） */
  handleCaptureKey(event: KeyboardEvent): void;
  /** 绑定键位的可读显示（多键以「 / 」连接） */
  displayKeys(keys: readonly string[]): string;
}

/**
 * 创建键位面板。`handleCaptureKey` 是稳定引用，可直接用于注册与摘除监听。
 */
export function createKeybindingPanel(
  options: KeybindingPanelOptions,
): KeybindingPanel {
  const captureAction = ref<KeymapAction | null>(null);

  return {
    captureAction,
    matches(
      action: KeymapAction,
      fallback: readonly string[],
      event: KeyboardEvent,
    ): boolean {
      const override = options.readKeymap()?.[action];
      const pressed = event.key.toLowerCase();
      return (override ?? fallback).some((k) => k.toLowerCase() === pressed);
    },
    startCapture(action: KeymapAction): void {
      captureAction.value = action;
    },
    resetKeybinding(action: KeymapAction): void {
      options.preferences.clearKeybinding(action);
    },
    handleCaptureKey(event: KeyboardEvent): void {
      const action = captureAction.value;
      if (action === null) return;
      event.preventDefault();
      event.stopPropagation();
      captureAction.value = null;
      // Esc 只用于退出捕获：改绑成 Esc 会让「取消」与「绑定」撞车
      if (event.key === "Escape") return;
      options.preferences.setKeybinding(action, [event.key]);
    },
    displayKeys(keys: readonly string[]): string {
      return keys
        .map((k) => (k === " " ? "空格" : k.length === 1 ? k.toUpperCase() : k))
        .join(" / ");
    },
  };
}
