/**
 * 06 §一.2 诊断（编辑期）：符号索引 + 诊断集，全部带 JSON Pointer（D6）。
 * - 未定义变量：定义集 = defines + set/define/let/local/array/dict 键 + random.var +
 *   循环变量 + input.store（并集保守策略：let/local 块级精度为已知限界，不误报优先）；
 *   `_` 前缀豁免（D4）；行内标记白名单镜像执行器语义（已定义变量 > 行内标记）。
 * - 跳转目标不存在（F1）、未知函数、重复 columnId、入口列缺失、资源路径缺失、
 *   未使用翻译键（overlay 键 − 可翻译原文）。
 * 锚点: diagnostics-with-pointer / undefined-var-underscore-exempt
 */

import type { Story } from "@lingfan/engine";
import type {
  AnalyzeOptions,
  Diagnostic,
  FieldDescriptor,
  SymbolIndex,
} from "../contracts";
import { joinPointer } from "../contracts";
import { walkStoryCommands } from "../schema/walk";
import { validateStory } from "../schema/validation";

/** 行内富文本标记（镜像 packages/engine/src/runtime/expr.ts；行为互锁见 tests/editor/schema.test.ts） */
const INLINE_SHORT_TAGS = new Set([
  "b",
  "/b",
  "i",
  "/i",
  "u",
  "/u",
  "w",
  "fast",
  "p",
  "color",
  "font",
  "size",
]);
const INLINE_PREFIXED_TAGS = [
  "color=",
  "/color",
  "font=",
  "/font",
  "size=",
  "/size",
];

function isInlineTag(content: string): boolean {
  if (INLINE_SHORT_TAGS.has(content)) return true;
  return INLINE_PREFIXED_TAGS.some((prefix) => content.startsWith(prefix));
}

/** 表达式内置名（01 §三.3）与字面量 */
const EXPR_BUILTINS = new Set([
  "random",
  "min",
  "max",
  "abs",
  "clamp",
  "true",
  "false",
]);
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/** 表达式中的根标识符引用（成员访问取根；跳过字符串字面量/数字尾巴/内置名） */
export function extractExpressionRefs(expr: string): string[] {
  let stripped = "";
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === '"') {
      i += 1;
      while (i < expr.length) {
        if (expr[i] === "\\") {
          i += 2;
          continue;
        }
        if (expr[i] === '"') break;
        i += 1;
      }
      continue;
    }
    stripped += ch;
  }
  const refs: string[] = [];
  for (const match of stripped.matchAll(IDENT_RE)) {
    const name = match[0];
    const prev = stripped.slice(0, match.index ?? 0).trimEnd();
    if (prev.endsWith(".")) continue;
    if (/\d$/.test(prev)) continue;
    if (EXPR_BUILTINS.has(name)) continue;
    if (!refs.includes(name)) refs.push(name);
  }
  return refs;
}

/** 引号字符串字面量剔除后的 {…} 段求值源提取（插值面：先判行内标记，再剥格式后缀） */
function exprSourcesInText(text: string): string[] {
  const sources: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) break;
    const content = text.slice(i + 1, end).trim();
    if (!isInlineTag(content)) {
      let exprSrc = content;
      if (!content.includes("?")) {
        const colon = content.indexOf(":");
        if (colon > 0) exprSrc = content.slice(0, colon).trim();
      }
      sources.push(exprSrc);
    }
    i = end + 1;
  }
  return sources;
}

/** 表达式面源提取（cond/on/in：{…} 包装剥壳，与执行器 evalCond 同构） */
function exprSourceInExpressionField(raw: string): string {
  const t = raw.trim();
  return t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : t;
}

const COMPOUND_PREFIX = /^\s*(\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/;

/** value 字段源提取（{expr} 包装或复合赋值右部；其余 = 字面量无引用），与执行器 evalValue/execAssign 同构 */
function exprSourceInValueField(raw: string): string | null {
  const compound = COMPOUND_PREFIX.exec(raw);
  if (compound !== null) return compound[2];
  const t = raw.trim();
  return t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : null;
}

/** 变量定义字段（op → 相对字段路径）；键 = 符号索引 definedKeys 的来源 */
const VAR_DEF_FIELDS: Readonly<Record<string, readonly string[]>> = {
  set: ["key"],
  define: ["key"],
  let: ["key"],
  local: ["key"],
  array: ["key"],
  dict: ["key"],
  random: ["var"],
  for: ["var"],
  foreach: ["var"],
  input: ["store"],
};

/** 跳转目标字段（op → [字段路径, 目标种类]） */
const TARGET_FIELDS: Readonly<
  Record<string, readonly (readonly [string, "column" | "function"])[]>
> = {
  jump: [["target", "column"]],
  call: [["target", "function"]],
  menu: [["options[].target", "column"]],
};

/** 可翻译原文面（运行时四处 Translate 挂接：say 文本/menu prompt+选项/input prompt/notify 文本） */
const TRANSLATE_SURFACES: Readonly<Record<string, readonly string[]>> = {
  say: ["text"],
  menu: ["prompt", "options[].text"],
  input: ["prompt"],
  notify: ["text"],
};

/** 字段路径取值（`a[].b` = 逐项迭代；返回值与其相对指针） */
function valuesAtPath(
  cmd: Record<string, unknown>,
  path: string,
): { value: unknown; pointer: string }[] {
  let current: { value: unknown; pointer: string }[] = [
    { value: cmd, pointer: "" },
  ];
  for (const segment of path.split(".")) {
    const iterate = segment.endsWith("[]");
    const key = iterate ? segment.slice(0, -2) : segment;
    const next: { value: unknown; pointer: string }[] = [];
    for (const entry of current) {
      if (entry.value === null || typeof entry.value !== "object") continue;
      const child = (entry.value as Record<string, unknown>)[key];
      const childPointer = `${entry.pointer}/${key}`;
      if (iterate) {
        if (Array.isArray(child)) {
          child.forEach((item, index) => {
            next.push({ value: item, pointer: `${childPointer}/${index}` });
          });
        }
      } else {
        next.push({ value: child, pointer: childPointer });
      }
    }
    current = next;
  }
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 06 §一.2 符号索引：一次遍历收集全部符号与引用（畸形输入 fail-closed 返回空索引） */
export function indexStory(story: Story): SymbolIndex {
  const index: SymbolIndex = {
    columnPointers: new Map(),
    duplicateColumns: [],
    entry: story?.entry,
    definedKeys: new Map(),
    functions: new Map(),
    targets: [],
    resources: [],
    variableRefs: [],
    originals: new Set(),
  };
  if (story === null || typeof story !== "object") return index;
  if (Array.isArray(story.columns)) {
    story.columns.forEach((column, columnIndex) => {
      if (!isPlainObject(column) || typeof column.id !== "string") return;
      const columnPointer = joinPointer("columns", columnIndex);
      if (index.columnPointers.has(column.id)) {
        index.duplicateColumns.push({ id: column.id, pointer: columnPointer });
      } else {
        index.columnPointers.set(column.id, columnPointer);
      }
    });
  }
  for (const key of Object.keys(story.defines ?? {})) {
    if (!index.definedKeys.has(key)) {
      index.definedKeys.set(key, joinPointer("defines", key));
    }
  }
  walkStoryCommands(story, (cmd, pointer, fields) => {
    if (!isPlainObject(cmd) || typeof cmd.op !== "string") return;
    const op = cmd.op;
    if (op === "func" && typeof cmd.name === "string") {
      if (!index.functions.has(cmd.name)) {
        index.functions.set(cmd.name, {
          params: Array.isArray(cmd.params)
            ? cmd.params.filter((p): p is string => typeof p === "string")
            : [],
          pointer,
        });
      }
    }
    if (op === "navigate") {
      const scene =
        typeof cmd.scene === "string" && cmd.scene !== "" ? cmd.scene : null;
      const target = scene ?? (typeof cmd.path === "string" ? cmd.path : "");
      if (target !== "") {
        index.targets.push({ pointer, target, kind: "column" });
      }
    }
    for (const [path, targetKind] of TARGET_FIELDS[op] ?? []) {
      for (const { value, pointer: fieldPointer } of valuesAtPath(cmd, path)) {
        if (typeof value === "string" && value !== "") {
          index.targets.push({
            pointer: `${pointer}${fieldPointer}`,
            target: value,
            kind: targetKind,
          });
        }
      }
    }
    for (const path of VAR_DEF_FIELDS[op] ?? []) {
      for (const { value, pointer: fieldPointer } of valuesAtPath(cmd, path)) {
        if (
          typeof value === "string" &&
          value !== "" &&
          !index.definedKeys.has(value)
        ) {
          index.definedKeys.set(value, `${pointer}${fieldPointer}`);
        }
      }
    }
    for (const path of TRANSLATE_SURFACES[op] ?? []) {
      for (const { value } of valuesAtPath(cmd, path)) {
        if (typeof value === "string" && value !== "")
          index.originals.add(value);
      }
    }
    scanFields(cmd, pointer, fields ?? [], index);
  });
  return index;
}

function scanFields(
  cmd: Record<string, unknown>,
  pointer: string,
  fields: readonly FieldDescriptor[],
  index: SymbolIndex,
): void {
  for (const field of fields) {
    const value = cmd[field.key];
    const fieldPointer = `${pointer}/${field.key}`;
    switch (field.kind) {
      case "expression":
        if (typeof value === "string" && value !== "") {
          for (const name of extractExpressionRefs(
            exprSourceInExpressionField(value),
          )) {
            index.variableRefs.push({
              pointer: fieldPointer,
              name,
              kind: "expression",
            });
          }
        }
        break;
      case "value":
        if (typeof value === "string" && value !== "") {
          const source = exprSourceInValueField(value);
          if (source !== null) {
            for (const name of extractExpressionRefs(source)) {
              index.variableRefs.push({
                pointer: fieldPointer,
                name,
                kind: "expression",
              });
            }
          }
        }
        break;
      case "text":
        if (typeof value === "string" && value !== "") {
          for (const source of exprSourcesInText(value)) {
            for (const name of extractExpressionRefs(source)) {
              index.variableRefs.push({
                pointer: fieldPointer,
                name,
                kind: "interpolation",
              });
            }
          }
        }
        break;
      case "resource":
        if (typeof value === "string" && value !== "") {
          index.resources.push({ pointer: fieldPointer, path: value });
        }
        break;
      case "array":
      case "body":
      case "object":
        if (isPlainObject(value)) {
          scanFields(
            value as Record<string, unknown>,
            fieldPointer,
            field.properties ?? [],
            index,
          );
        } else if (Array.isArray(value) && field.item !== undefined) {
          value.forEach((element, itemIndex) => {
            if (isPlainObject(element)) {
              scanFields(
                element as Record<string, unknown>,
                `${fieldPointer}/${itemIndex}`,
                field.item!.properties ?? [],
                index,
              );
            }
          });
        }
        break;
      default:
        break;
    }
  }
}

/**
 * 06 §一.2 编辑期诊断集（结构校验 + 语义诊断，一律带 JSON Pointer）。
 * resourceFiles / overlayKeys 缺省时对应诊断族跳过（供给侧数据未接入不误报）。
 */
export function analyzeStory(
  story: Story,
  options: AnalyzeOptions = {},
): Diagnostic[] {
  const out: Diagnostic[] = validateStory(story);
  const index = indexStory(story);

  for (const duplicate of index.duplicateColumns) {
    out.push({
      code: "duplicate-column",
      severity: "error",
      message: `columnId 重复：${duplicate.id}（F1：columnId 全局唯一）`,
      pointer: duplicate.pointer,
    });
  }
  if (
    typeof index.entry === "string" &&
    index.entry !== "" &&
    !index.columnPointers.has(index.entry)
  ) {
    out.push({
      code: "missing-entry",
      severity: "error",
      message: `入口列 ${index.entry} 不存在（F1）`,
      pointer: "/entry",
    });
  }
  for (const target of index.targets) {
    const registry =
      target.kind === "column" ? index.columnPointers : index.functions;
    if (!registry.has(target.target)) {
      out.push({
        code: target.kind === "column" ? "missing-target" : "unknown-function",
        severity: "error",
        message:
          target.kind === "column"
            ? `跳转目标列不存在：${target.target}（F1）`
            : `调用未注册的函数：${target.target}`,
        pointer: target.pointer,
      });
    }
  }
  for (const ref of index.variableRefs) {
    if (ref.name.startsWith("_")) continue;
    if (index.definedKeys.has(ref.name)) continue;
    out.push({
      code: "undefined-variable",
      severity: ref.kind === "expression" ? "error" : "warning",
      message: `未定义变量：${ref.name}${ref.kind === "expression" ? "（S5：表达式失败即停机）" : "（S8：插值失败保留原文）"}`,
      pointer: ref.pointer,
    });
  }
  if (options.resourceFiles !== undefined) {
    for (const resource of index.resources) {
      if (!options.resourceFiles.has(resource.path)) {
        out.push({
          code: "missing-resource",
          severity: "error",
          message: `资源路径不存在：${resource.path}`,
          pointer: resource.pointer,
        });
      }
    }
  }
  if (options.overlayKeys !== undefined) {
    for (const key of options.overlayKeys) {
      if (!index.originals.has(key)) {
        out.push({
          code: "unused-translation",
          severity: "warning",
          message: `未使用的译文键：${key}`,
          pointer: "",
        });
      }
    }
  }
  return out;
}

export type { AnalyzeOptions };
