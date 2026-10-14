/**
 * 构建期字体名引用检查：词命令产物里的静态字体引用对照字体名注册表，未注册名 fail-closed。
 *
 * 覆盖两类静态可达面：
 * 1. 文本里的 `{font=名}` 行内标签（模板串已整体降糖为静态字符串，标签可见）；
 * 2. `say` 行参 `font`（角色字体字段的静态源）。
 *
 * 动态值不在此档：模板插值与标识符实参在降糖后是 `{…}` 包裹形态（编译期不可见真值），
 * 编译期放行，由渲染层注册表回退 + 诊断兜底（两档语义）。
 */
import * as ts from "typescript";
import type { BodyCtx } from "./shared.ts";
import { diag } from "./shared.ts";

/** 降糖形态的插值段：`{…}` 包裹（模板插值与标识符实参都落成这个形态） */
const INTERP_SEGMENT = /\{[^{}]*\}/;
const FONT_TAG = /\{font=([^}]*)\}/g;

/**
 * 检查一个词命令产物里的字体引用；每个未注册的静态名报一条诊断（一次报全部）。
 * 注册表为空集（工程未声明字体）时同样 fail-closed——引用了就报。
 */
export function checkFontReferences(
  ctx: BodyCtx,
  node: ts.Node,
  product: unknown,
): void {
  const registry = ctx.shared.fontNames;
  const bad = new Set<string>();
  collectFontRefs(product, registry, bad);
  for (const name of bad) {
    diag(
      ctx,
      node,
      `未注册的字体名 "${name}"——Resources/Fonts 里没有对应字体文件（字体名 = 文件名去扩展名）`,
    );
  }
}

function collectFontRefs(
  value: unknown,
  registry: ReadonlySet<string>,
  bad: Set<string>,
): void {
  if (typeof value === "string") {
    collectFromString(value, registry, bad);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFontRefs(item, registry, bad);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      // 角色字体字段的静态源（say 行参 font）：裸字符串名直接对照注册表；
      // 插值降糖形态（{…} 包裹）= 动态值，编译期放行
      if (key === "font" && typeof item === "string" && !INTERP_SEGMENT.test(item)) {
        noteName(item, registry, bad);
      }
      collectFontRefs(item, registry, bad);
    }
  }
}

function collectFromString(
  text: string,
  registry: ReadonlySet<string>,
  bad: Set<string>,
): void {
  for (const match of text.matchAll(FONT_TAG)) {
    const name = match[1]!.trim();
    // 空名 / 含插值段的标签 = 动态，运行期档负责
    if (name === "" || name.includes("{")) {
      continue;
    }
    noteName(name, registry, bad);
  }
}

function noteName(
  name: string,
  registry: ReadonlySet<string>,
  bad: Set<string>,
): void {
  if (!registry.has(name)) {
    bad.add(name);
  }
}
