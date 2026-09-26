/**
 * 故事树命令遍历器（编辑器内部共享）：列双容器（flow.commands / scene.elements+entry）
 * + 沿表单描述符递归块体（if.then/elif[].then/else、while/for/foreach.body、
 * switch.cases[].body/default、func.body）。校验与符号索引共用同一遍历，指针一致。
 */

import type { FieldDescriptor } from "../contracts";
import { escapePointerToken } from "../contracts";
import { describeForm } from "./forms";

export type CommandVisitor = (
  cmd: Record<string, unknown>,
  pointer: string,
  fields: readonly FieldDescriptor[] | undefined,
) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walkDescriptor(
  desc: FieldDescriptor,
  value: unknown,
  pointer: string,
  visit: CommandVisitor,
): void {
  if (desc.kind === "body") {
    if (Array.isArray(value)) walkCommands(value, pointer, visit);
    return;
  }
  if (desc.properties !== undefined && isPlainObject(value)) {
    for (const child of desc.properties) {
      walkDescriptor(
        child,
        value[child.key],
        `${pointer}/${escapePointerToken(child.key)}`,
        visit,
      );
    }
    return;
  }
  if (desc.item !== undefined && Array.isArray(value)) {
    value.forEach((element, index) => {
      walkDescriptor(desc.item!, element, `${pointer}/${index}`, visit);
    });
  }
}

function walkCommands(
  commands: unknown[],
  pointer: string,
  visit: CommandVisitor,
): void {
  commands.forEach((cmd, index) => {
    const commandPointer = `${pointer}/${index}`;
    if (!isPlainObject(cmd)) {
      visit(cmd as Record<string, unknown>, commandPointer, undefined);
      return;
    }
    const fields = describeForm(cmd.op as string)?.fields;
    visit(cmd, commandPointer, fields);
    if (fields === undefined) return;
    for (const field of fields) {
      walkDescriptor(
        field,
        cmd[field.key],
        `${commandPointer}/${escapePointerToken(field.key)}`,
        visit,
      );
    }
  });
}

/**
 * 遍历整棵故事树的全部**命令**（含嵌套块体）；visit 按命令指针回调。
 *
 * 注意：scene 列的 `elements` **不在**命令遍历内——元素是声明式空间层（08 §二.1），
 * 其形状/属性校验走 `walkStoryElements` + `validateElement`（F5）。
 * 混进命令遍历会被误报 `unknown-op`（元素只有 `type`，没有 `op`）。
 */
export function walkStoryCommands(story: unknown, visit: CommandVisitor): void {
  if (!isPlainObject(story) || !Array.isArray(story.columns)) return;
  story.columns.forEach((column, columnIndex) => {
    if (!isPlainObject(column)) return;
    const columnPointer = `/columns/${columnIndex}`;
    const fields = column.kind === "flow" ? ["commands"] : ["entry"];
    for (const field of fields) {
      const list = column[field];
      if (Array.isArray(list)) {
        walkCommands(list, `${columnPointer}/${field}`, visit);
      }
    }
  });
}

export type ElementVisitor = (
  node: Record<string, unknown>,
  pointer: string,
) => void;

function walkElementList(
  list: readonly unknown[],
  pointer: string,
  visit: ElementVisitor,
): void {
  list.forEach((node, index) => {
    const nodePointer = `${pointer}/${index}`;
    // 非对象也回调（由 validateElement 报「必须为对象」，保持诊断口径统一）
    visit(node as Record<string, unknown>, nodePointer);
    if (isPlainObject(node) && Array.isArray(node.children)) {
      walkElementList(node.children, `${nodePointer}/children`, visit);
    }
  });
}

/** 遍历 scene 列的舞台元素（含 `children` 递归）；visit 按元素指针回调（校验与索引共用） */
export function walkStoryElements(story: unknown, visit: ElementVisitor): void {
  if (!isPlainObject(story) || !Array.isArray(story.columns)) return;
  story.columns.forEach((column, columnIndex) => {
    if (!isPlainObject(column) || column.kind !== "scene") return;
    const list = column.elements;
    if (Array.isArray(list)) {
      walkElementList(list, `/columns/${columnIndex}/elements`, visit);
    }
  });
}
