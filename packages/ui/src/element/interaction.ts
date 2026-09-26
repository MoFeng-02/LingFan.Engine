/**
 * F6 点击动作解析（08 §七：输入语义归核心层，UI 只做翻译）。
 *
 * 优先级严格照抄老引擎 `InteractionBinder.ApplyInteraction`（`Views/InteractionBinder.cs:28-205`）：
 * **`disabled` > `nav` > `cmd` > `hover_*` > `selected_*`** —— 前三级决定**点击行为**
 * （`disabled` 短路、`nav` 优先于 `cmd`），后两级是与点击正交的**视觉态**（由渲染器绑定）。
 *
 * 纯函数：宿主据此选路（`nav` → 核心 `navigate`；`cmd` → 宿主命名命令注册表）。
 * 锚点: interaction-priority
 */
import type { ElementInstance } from "@lingfan/engine";

export type ElementAction =
  | { kind: "none" }
  | { kind: "nav"; target: string }
  /** `value` 为原文（可能含 `{expr}`）——宿主按点击时刻插值后再交处理器 */
  | { kind: "cmd"; name: string; value?: string };

export function resolveElementAction(
  props: Record<string, unknown>,
): ElementAction {
  // F6 最高优先级：禁用（enabled=false 同义）→ 不产生任何动作
  if (props.disabled === true || props.enabled === false) return { kind: "none" };

  const nav = props.nav;
  if (typeof nav === "string" && nav !== "") return { kind: "nav", target: nav };

  const cmd = props.cmd;
  if (typeof cmd === "string" && cmd !== "") {
    const value = props.value;
    return typeof value === "string"
      ? { kind: "cmd", name: cmd, value }
      : { kind: "cmd", name: cmd };
  }
  return { kind: "none" };
}

/** 元素是否拥有交互（点击类）——渲染器据此决定是否挂点击与手型光标 */
export function hasElementInteraction(props: Record<string, unknown>): boolean {
  return resolveElementAction(props).kind !== "none";
}

/** 供宿主把动作翻译成引擎/注册表调用（`source` 回传给命令处理器） */
export type ElementActionSource = ElementInstance;
