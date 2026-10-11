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

/**
 * 文本元素：在场景里显示一段文字。产物是元素**节点**（数据），
 * 放进 scene 列的 `elements` 数组才会出现在画面上。
 * @param text 显示的文字。
 * @param opts 元素属性（id/x/y/width/height/color/size/halign/opacity/zindex 等）。
 * @returns text 元素节点。
 * @example
 * textElement("第二章 · 广场", { x: "5%", y: "12%", size: 32 });
 */
export function textElement(text: string, opts?: ElementOptions): ElementNode {
  return { type: "text", text, ...opts };
}

/**
 * 图片元素：在场景里显示一张图。产物是元素**节点**（数据）。
 * @param source 图片资源路径。
 * @param opts 元素属性（id/x/y/width/height/opacity/zindex 等）。
 * @returns image 元素节点。
 * @example
 * imageElement("images/market.png", { x: "10%", y: "30%", width: "40%" });
 */
export function imageElement(
  source: string,
  opts?: ElementOptions,
): ElementNode {
  return { type: "image", source, ...opts };
}

/**
 * 按钮元素：可点击的按钮；`nav` 给出点击后跳转的目标列名。
 * 产物是元素**节点**（数据）。
 * @param text 按钮上的文字。
 * @param opts 元素属性 + nav（点击跳转的目标列名）。
 * @returns button 元素节点。
 * @example
 * buttonElement("开始游戏", { nav: "intro", y: "60%" });
 */
export function buttonElement(
  text: string,
  opts?: ElementOptions & { nav?: string },
): ElementNode {
  return { type: "button", text, ...opts };
}

/**
 * 场景设置：背景 + 可选标题两个元素。
 * 产物 = 元素**数组**（作者展开进 scene 列的 elements）。
 * @param backgroundPath 背景图资源路径（铺满整屏）。
 * @param title 场景标题文字（可省略，出现在画面上方居中）。
 * @param opts 可选项：bgOpacity 背景不透明度、titleSize 标题字号、
 *   titleColor 标题颜色。
 * @returns 背景与标题元素节点数组（可省略标题）。
 * @example
 * export default scene("square", () => ({
 *   type: "menu",
 *   elements: [...sceneSetup("images/square.png", "城镇广场")],
 *   columns: { ... },
 * }));
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

/**
 * 列的 `type` 字段（game 缺省不写——与序列化口径一致）。
 * @param type 列类型：menu（菜单列）或 ui（界面列）。
 * @returns 带类型标记的对象，展开进列定义。
 */
export function sceneType(type: "menu" | "ui"): { type: "menu" | "ui" } {
  return { type };
}
