/**
 * Script 词汇层 · **复合词**（多 op/元素的高频组合，纯展开）。
 * 复合词不产出新语义：每个函数 = 既有元素的语法糖。
 */
import type { ElementNode } from "@lingfan/engine";

export interface ElementOptions {
  id?: string;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  color?: string;
  size?: number | string;
  halign?: string;
  opacity?: number;
  zindex?: number;
  [attr: string]: unknown;
}

export function textElement(text: string, opts?: ElementOptions): ElementNode {
  return { type: "text", text, ...opts };
}

export function imageElement(
  source: string,
  opts?: ElementOptions,
): ElementNode {
  return { type: "image", source, ...opts };
}

export function buttonElement(
  text: string,
  opts?: ElementOptions & { nav?: string },
): ElementNode {
  return { type: "button", text, ...opts };
}

/**
 * 场景设置：背景 + 可选标题两个元素。
 * 产物 = 元素**数组**（作者展开进 scene 列的 elements）。
 */
export function sceneSetup(
  backgroundPath: string,
  title?: string,
  opts?: {
    bgOpacity?: number;
    titleSize?: number | string;
    titleColor?: string;
  },
): ElementNode[] {
  const bg: ElementNode = {
    type: "background",
    source: backgroundPath,
    x: "0",
    y: "0",
    width: "100%",
    height: "100%",
    ...(opts?.bgOpacity === undefined ? {} : { opacity: opts.bgOpacity }),
  };
  const heading =
    title === undefined
      ? []
      : [
          {
            type: "text",
            text: title,
            x: "5%",
            y: "12%",
            width: "90%",
            halign: "center",
            ...(opts?.titleSize === undefined ? {} : { size: opts.titleSize }),
            ...(opts?.titleColor === undefined
              ? {}
              : { color: opts.titleColor }),
          } satisfies ElementNode,
        ];
  return [bg, ...heading];
}

/** 列的 `type` 字段（game 缺省不写——与序列化口径一致） */
export function sceneType(type: "menu" | "ui"): { type: "menu" | "ui" } {
  return { type };
}
