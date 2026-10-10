/**
 * 符号索引：把故事里的定义键 / 列 / 函数 / 跳转目标 / 变量引用与可翻译原文
 * 收进一张 SymbolIndex（单次遍历）。消费方是分析器（./analyze）与编辑器功能。
 */
import type { Story } from "@lingfan/engine";
import type { FieldDescriptor, SymbolIndex } from "../contracts";
import { joinPointer } from "../contracts";
import { TRANSLATE_SURFACES, valuesAtPath } from "../i18n";
import { walkStoryCommands, walkStoryElements } from "../schema";
import { isPlainObject } from "../shared";
import {
  extractExpressionRefs,
  exprSourceInExpressionField,
  exprSourceInValueField,
  exprSourcesInText,
} from "./refs";

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
