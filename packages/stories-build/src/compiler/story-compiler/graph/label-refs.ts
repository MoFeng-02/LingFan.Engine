/**
 * label 引用扫描：从源码里收出「被跳转 / 选项 / 导航指过、但不是列」的目标名。
 *
 * 背景：`jump` / `navigate` / `option` 的目标形参类型是 `KnownColumnName`，而列名注册表
 * 只装真列（`export default` 的故事函数）与按需补出的 label 列。于是作者把一段可跳转的
 * 流程写成 `export function X` 时，若只有 `option("…", "X")` 这类写法指它，X 不补列
 * 就会在类型期红——可 X 明明是一个完整的函数体，只是没人给它一个列位。
 *
 * 这里不做裁定，只做收集：收出所有字符串字面量目标（含落点），由装配段决定
 * 哪些要按需产列、哪些已存在、哪些根本不存在。判据刻意窄：
 * - 只认 {@link LABEL_TARGET_ARGS} 表里的词与实参位（含 `script.` 前缀写法）；
 * - 只认**字符串字面量**与无替换模板串（`jump(someVar)` 静态不可判定，不收）。
 *
 * 单一事实源：{@link LABEL_TARGET_ARGS} 是「哪些词的哪些实参承载列 / label 目标」的唯一
 * 声明，与词汇层 `KnownColumnName` 收窄的形参位逐一对应。收集范围必须与收窄范围一致，
 * 不另起一套收集词表——收窄面加了目标位，这里同步补一行，反之亦然。
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

/**
 * 列 / label 目标词 → 承载目标名的实参位（0 基）。
 *
 * 与词汇层 `KnownColumnName` 形参位一一对应：
 * - `jump(target)`：第 0 参；
 * - `navigate(path, scene?)`：第 0、1 参（二者都是目标列 id，scene 优先）；
 * - `option(text, target)`：第 1 参（选中后跳进的列）。
 *
 * 这是收集面的唯一事实源：新增受 `KnownColumnName` 收窄的目标位时在此补一行，
 * 装配段据此按需产列。导出供测试机械核对「收集范围 ≡ 收窄范围」。
 */
export const LABEL_TARGET_ARGS: Readonly<Record<string, readonly number[]>> = {
  jump: [0],
  navigate: [0, 1],
  option: [1],
};

/**
 * 收出全部 label 引用（名字 → 首次出现的落点）。
 *
 * 同一名字在多处被引用只留第一处（码元序最小的文件、再按出现位置），
 * 保证诊断顺序与文件系统枚举顺序无关。
 *
 * 返回 Map 而不是 Set：语义上它就是一个集合（去重后的目标名），Map 只是额外携带
 * 落点，好让「目标不存在」这条 fail-closed 诊断指到引用它的那一行——
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
        if (name !== undefined) {
          for (const pos of LABEL_TARGET_ARGS[name] ?? []) {
            const arg = node.arguments[pos];
            if (arg === undefined) continue;
            const target = literalText(arg);
            if (target !== undefined && !out.has(target)) {
              out.set(target, { name: target, file: record.rel, node });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(record.sf);
  }
  return out;
}

/** 调用目标是不是列 / label 目标词（含 `script.jump` 这类前缀写法） */
function labelWordOf(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text in LABEL_TARGET_ARGS ? expression.text : undefined;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const name = expression.name.text;
    return name in LABEL_TARGET_ARGS ? name : undefined;
  }
  return undefined;
}

/** 字面量实参的文本；带替换的模板串不是静态值，返回 `undefined` */
function literalText(arg: ts.Expression): string | undefined {
  if (ts.isStringLiteral(arg)) return arg.text;
  if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
}
