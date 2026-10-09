/**
 * 诊断（编辑期）：符号索引 + 诊断集，全部带 JSON Pointer。
 * - 未定义变量：定义集 = defines + set/define/let/local/array/dict 键 + random.var +
 *   循环变量 + input.store（并集保守策略：let/local 块级精度为已知限界，不误报优先）；
 *   `_` 前缀豁免；行内标记白名单镜像执行器语义（已定义变量 > 行内标记）。
 * - 跳转目标不存在、未知函数、重复 columnId、入口列缺失、资源路径缺失、
 *   未使用翻译键（overlay 键 − 可翻译原文）、已声明但无渲染语义的元素属性。
 */

import type { Story } from "@lingfan/engine";
import { ELEMENT_OPS_BLOCKED } from "@lingfan/engine";
import type {
  AnalyzeOptions,
  Diagnostic,
  FieldDescriptor,
  SymbolIndex,
} from "../contracts";
import { escapePointerToken, joinPointer } from "../contracts";
import { TRANSLATE_SURFACES, valuesAtPath } from "../i18n/surfaces";
import { UNIMPLEMENTED_ELEMENT_ATTRS } from "../schema/elementForms";
import { walkStoryCommands, walkStoryElements } from "../schema/walk";
import { validateStory } from "../schema/validation";

/** 行内富文本标记（镜像 packages/engine/src/runtime/expr/interpolate.ts；行为互锁见 tests/editor/schema.test.ts） */
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

/** 表达式内置名与字面量 */
const EXPR_BUILTINS = new Set([
  "random",
  "min",
  "max",
  "abs",
  "clamp",
  "true",
  "false",
]);
const IDENT_PATH_RE =
  /[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*(?:\.[A-Za-z_][A-Za-z0-9_\u4e00-\u9fa5]*)*/g;

/** 表达式中的变量键引用（点路径整键 = 全局键路径/字典下钻；跳过字符串字面量/数字尾巴/内置名） */
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
  for (const match of stripped.matchAll(IDENT_PATH_RE)) {
    const name = match[0];
    const prev = stripped.slice(0, match.index ?? 0).trimEnd();
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
  Record<string, readonly (readonly [string, "column" | "function" | "callable"])[]>
> = {
  jump: [["target", "column"]],
  // `call` 的目标**可以是列（label）或 func**（「调用子过程（func 或 label）」）
  // ⇒ `callable` = 任一存在即可。
  call: [["target", "callable"]],
  menu: [["options[].target", "column"]],
};

// 可翻译原文面与路径取值 = i18n 工具链模块的单一事实源：
// 诊断的 originals 收集与 extractStoryKeys 消费同一张表（互锁: i18n-key-extract-parity）

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 符号索引：一次遍历收集全部符号与引用（畸形输入 fail-closed 返回空索引） */
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
  // 翻译面：元素展示文字（`text`，运行期装载时 Translate）也计入原文集合
  walkStoryElements(story, (node) => {
    if (!isPlainObject(node)) return;
    const text = node.text;
    if (typeof text === "string" && text !== "") index.originals.add(text);
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
 * 编辑期诊断集（结构校验 + 语义诊断，一律带 JSON Pointer）。
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
      message: `columnId 重复：${duplicate.id}（columnId 全局唯一）`,
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
      message: `入口列 ${index.entry} 不存在`,
      pointer: "/entry",
    });
  }
  for (const target of index.targets) {
    const found =
      target.kind === "column"
        ? index.columnPointers.has(target.target)
        : target.kind === "function"
          ? index.functions.has(target.target)
          : // callable：列或 func **任一存在**即通过
            index.columnPointers.has(target.target) || index.functions.has(target.target);
    if (!found) {
      out.push({
        // `"function"` 分支当前**无字段产出**（`call` 用的是 `callable`）——
        // 保留它是**契约完备性**（`TargetKind` 有三种，判定要覆盖三种），
        // 将来若出现「只允许 func」的新字段即可直接复用（当前无产出路径，非冗余代码）。
        code: target.kind === "function" ? "unknown-function" : "missing-target",
        severity: "error",
        message:
          target.kind === "column"
            ? `跳转目标列不存在：${target.target}`
            : target.kind === "function"
              ? `调用未注册的函数：${target.target}`
              : `调用目标不存在：${target.target}（既不是 func 也不是列）`,
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
      message:
        ref.kind === "expression"
          ? `未定义变量：${ref.name}（表达式里使用，求值会失败并**停机**——请先用 set/define 定义它）`
          : `未定义变量：${ref.name}（插值失败将按原文保留——若它应是变量请先定义，若只是普通文字请去掉花括号）`,
      pointer: ref.pointer,
    });
  }
  if (options.resourceFiles !== undefined) {
    for (const resource of index.resources) {
      if (!options.resourceFiles.has(resource.path)) {
        out.push({
          code: "missing-resource",
          // 提醒级：素材"先写引用后补"是正常工作流，
          // error 会拦保存门禁；运行期缺资源由运行时自己 fail-closed 兜底。
          severity: "warning",
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
          message: `未使用的译文键：${key}（say / menu / input / notify 四个翻译面均未命中原文——该键运行期不会生效；若这段文字只用于元素文本或宿主界面，本条可忽略）`,
          pointer: "",
        });
      }
    }
    // 缺译（正向，与 unused-translation 反向对称）：原文在**全部语言**的 overlay
    // 里都没有 = 玩家必然看到原文（提醒级，不拦保存）。仅在「工程确实启用了 i18n」
    // （overlay 非空）时提醒——不启用 i18n 的工程原文直出是常态（"不需要多语言
    // 就不需要 i18n"），不制造全量噪声。
    if (options.overlayKeys.size > 0) {
      for (const original of index.originals) {
        if (!options.overlayKeys.has(original)) {
          out.push({
            code: "missing-translation",
            severity: "warning",
            message: `原文未有任何译文：${original}（所有语言的 overlay 均未命中——运行期回退原文；专有名词等有意保留原文的可忽略）`,
            pointer: "",
          });
        }
      }
    }
  }
  // 未实现属性清单：已声明但**当前无渲染语义**的元素属性（写了不生效且静默）→ warning。
  // 指针精确到该属性；清单与表单下架同源（`UNIMPLEMENTED_ELEMENT_ATTRS`），避免两份事实。
  walkStoryElements(story, (node, pointer) => {
    if (!isPlainObject(node)) return; // 非对象由 invalid-element 负责
    for (const attr of UNIMPLEMENTED_ELEMENT_ATTRS) {
      if (node[attr] === undefined) continue;
      out.push({
        code: "unimplemented-element-attr",
        severity: "warning",
        message: `元素属性 ${attr} 已声明但当前无渲染语义（写入不生效）`,
        pointer: `${pointer}/${escapePointerToken(attr)}`,
      });
    }
    // 点击动作序列里的**执行期必拒** op：编辑期即报，别等运行时才发现点不动。
    // 清单与执行期同源（引擎契约 `ELEMENT_OPS_BLOCKED`）——两处各写一份必然漂移。
    const ops = node.ops;
    if (Array.isArray(ops)) {
      ops.forEach((item, i) => {
        if (!isPlainObject(item)) return; // 形态问题由 invalid-element 负责
        const op = item.op;
        if (typeof op !== "string" || !ELEMENT_OPS_BLOCKED.has(op)) return;
        out.push({
          code: "element-ops-blocked-op",
          severity: "error",
          message: `元素动作序列里的 ${op} 不可用（等待/位置/存档类会打断当前叙事流）；跳列请用 nav 属性`,
          pointer: `${pointer}/ops/${i}`,
        });
      });
    }
  });
  return out;
}

export type { AnalyzeOptions };

/**
 * 诊断集的分组与摘要（可按严重度筛选），以及消息文本的拆分与一句话简述。
 * 两族住在同域的其他文件里，此处一并转发，让本目录只有一个取用入口。
 */
export {
  diagnosticCodeLabel,
  diagnosticSummaryText,
  filterDiagnosticsBySeverity,
  groupDiagnostics,
  summarizeDiagnostics,
  type DiagnosticGroup,
  type DiagnosticSummary,
  type SeverityFilter,
} from "./grouping";
export {
  diagnosticBrief,
  splitDiagnosticMessage,
  type DiagnosticMessageParts,
} from "./message";
