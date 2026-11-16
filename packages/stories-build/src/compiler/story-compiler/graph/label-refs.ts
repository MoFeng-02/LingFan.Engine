/**
 * label 引用扫描：从源码里收出「被 `jump("…")` / `navigate("…")` 指过、但不是列」的目标名。
 *
 * 背景：`jump` 的形参类型是 `KnownColumnName`，而列名注册表只装真列（`export default`
 * 的故事函数）。于是作者把一段可跳转的流程写成 `export function X` 时，`jump("X")`
 * 在类型期就红——可 `X` 明明是一个完整的函数体，只是没人给它一个列位。
 *
 * 这里不做裁定，只做收集：收出所有字符串字面量目标（含落点），由装配段决定
 * 哪些要按需产列、哪些已存在、哪些根本不存在。判据刻意窄：
 * - 只认 `jump` / `navigate` 这两个词（含 `script.` 前缀写法）；
 * - 只认**字符串字面量**与无替换模板串（`jump(someVar)` 静态不可判定，不收）；
 * - `navigate` 只取第一个实参（第二个是场景名，不是列名）。
 */
import * as ts from "typescript";
import type { ModuleRecord } from "./core.ts";

/** 一个 label 引用：目标名 + 它在源码里的落点（报错要指到那一行） */
export interface LabelRef {
  /** 目标名（字符串字面量的原文） */
  readonly name: string;
  /** 引用所在文件（相对 `Stories.src/` 的 posix 路径） */
  readonly file: string;
  /** 引用所在的调用表达式（诊断定位用） */
  readonly node: ts.Node;
}

/** 会被当成跳转目标的词名 */
const LABEL_WORDS: ReadonlySet<string> = new Set(["jump", "navigate"]);

/**
 * 收出全部 label 引用（名字 → 首次出现的落点）。
 *
 * 同一名字在多处被引用只留第一处（码元序最小的文件、再按出现位置），
 * 保证诊断顺序与文件系统枚举顺序无关。
 *
 * 返回 Map 而不是 Set：语义上它就是一个集合（去重后的目标名），Map 只是额外携带
 * 落点，好让「目标不存在」这条 fail-closed 诊断指到 `jump("X")` 那一行——
 * 没有落点就只能报文件名，读者还得自己去找是哪一次调用。
 */
export function collectLabelRefs(
  records: ReadonlyMap<string, ModuleRecord>,
): ReadonlyMap<string, LabelRef> {
  const out = new Map<string, LabelRef>();
  for (const record of [...records.values()].sort((a, b) =>
    a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0,
  )) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = labelWordOf(node.expression);
        const arg = node.arguments[0];
        if (name !== undefined && arg !== undefined) {
          const target = literalText(arg);
          if (target !== undefined && !out.has(target)) {
            out.set(target, { name: target, file: record.rel, node });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(record.sf);
  }
  return out;
}

/** 调用目标是不是 `jump` / `navigate`（含 `script.jump` 这类前缀写法） */
function labelWordOf(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return LABEL_WORDS.has(expression.text) ? expression.text : undefined;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const name = expression.name.text;
    return LABEL_WORDS.has(name) ? name : undefined;
  }
  return undefined;
}

/** 字面量实参的文本；带替换的模板串不是静态值，返回 `undefined` */
function literalText(arg: ts.Expression): string | undefined {
  if (ts.isStringLiteral(arg)) return arg.text;
  if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
}
