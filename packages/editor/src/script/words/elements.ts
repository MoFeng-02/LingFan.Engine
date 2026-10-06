/**
 * Script 词汇层 · **元素域**（show / hide / background / bg_switch / zindex / style /
 * window / animate / animate_block / transition / shake / text_typewriter）。
 * x/y = 数字（px）或 CSS 长度串（`"50%"`）——与元素系统契约一致。
 * Options 派生自 schema（零漂移）；返回类型 = `CommandOf<op>` 判别联合成员。
 */
import type { CommandOf, ScriptValue } from "../../schema/opSchemas";

export type ShowOptions = Omit<CommandOf<"show">, "op" | "target">;

export function show(target: string, opts?: ShowOptions): CommandOf<"show"> {
  return { op: "show", target, ...opts };
}

export function hide(target: string): CommandOf<"hide"> {
  return { op: "hide", target };
}

export function background(resource: string): CommandOf<"background"> {
  return { op: "background", resource };
}

export function bgSwitch(resource: string): CommandOf<"bg_switch"> {
  return { op: "bg_switch", resource };
}

export function setZ(target: string, value: number): CommandOf<"zindex"> {
  return { op: "zindex", target, value };
}

export function style(
  target: string,
  props: Record<string, ScriptValue>,
): CommandOf<"style"> {
  return { op: "style", target, props: { ...props } };
}

export type DialogWindowMode = CommandOf<"window">["mode"];

export function dialogWindow(mode: DialogWindowMode): CommandOf<"window"> {
  return { op: "window", mode };
}

export type AnimateOptions = Omit<
  CommandOf<"animate">,
  "op" | "target" | "property" | "value"
>;

export function animate(
  target: string,
  property: string,
  value: number,
  opts?: AnimateOptions,
): CommandOf<"animate"> {
  return { op: "animate", target, property, value, ...opts };
}

export type AnimateBlockOptions = Omit<
  CommandOf<"animate_block">,
  "op" | "target"
>;

export function animateBlock(
  target: string,
  opts?: AnimateBlockOptions,
): CommandOf<"animate_block"> {
  return { op: "animate_block", target, ...opts };
}

export function transition(
  type: string,
  duration?: number,
): CommandOf<"transition"> {
  return {
    op: "transition",
    type,
    ...(duration === undefined ? {} : { duration }),
  };
}

export type ShakeOptions = Omit<CommandOf<"shake">, "op">;

export function shake(opts?: ShakeOptions): CommandOf<"shake"> {
  return { op: "shake", ...opts };
}

export type TypewriterOptions = Omit<CommandOf<"text_typewriter">, "op">;

export function textTypewriter(
  opts?: TypewriterOptions,
): CommandOf<"text_typewriter"> {
  return { op: "text_typewriter", ...opts };
}
