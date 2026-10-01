/**
 * 故事树命令遍历器（编辑器内部共享）：列双容器（flow.commands / scene.elements+entry）
 * + 沿表单描述符递归块体（if.then/elif[].then/else、while/for/foreach.body、
 * switch.cases[].body/default、func.body）。校验与符号索引共用同一遍历，指针一致。
 */

import type { FieldDescriptor } from "../contracts";
import { escapePointerToken } from "../contracts";
import { describeForm } from "./forms";
import { BUILTIN_OP_SURFACE, type OpSurface } from "./surface";

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
  surface: OpSurface,
): void {
  if (desc.kind === "body") {
    if (Array.isArray(value)) walkCommands(value, pointer, visit, surface);
    return;
  }
  if (desc.properties !== undefined && isPlainObject(value)) {
    for (const child of desc.properties) {
      walkDescriptor(
        child,
        value[child.key],
        `${pointer}/${escapePointerToken(child.key)}`,
        visit,
        surface,
      );
    }
    return;
  }
  if (desc.item !== undefined && Array.isArray(value)) {
    value.forEach((element, index) => {
      walkDescriptor(desc.item!, element, `${pointer}/${index}`, visit, surface);
    });
  }
}

function walkCommands(
  commands: unknown[],
  pointer: string,
  visit: CommandVisitor,
  surface: OpSurface,
): void {
  commands.forEach((cmd, index) => {
    const commandPointer = `${pointer}/${index}`;
    if (!isPlainObject(cmd)) {
      visit(cmd as Record<string, unknown>, commandPointer, undefined);
      return;
    }
    const fields = describeForm(cmd.op as string, surface)?.fields;
    visit(cmd, commandPointer, fields);
    if (fields !== undefined) {
      walkBodyFields(fields, cmd, commandPointer, visit, surface);
    }
  });
}

/** 块体递归本体（`fields` 已解析——`walkCommandBodies` 与 `walkCommands` 共用，避免重复解析） */
function walkBodyFields(
  fields: readonly FieldDescriptor[],
  cmd: Record<string, unknown>,
  commandPointer: string,
  visit: CommandVisitor,
  surface: OpSurface,
): void {
  for (const field of fields) {
    walkDescriptor(
      field,
      cmd[field.key],
      `${commandPointer}/${escapePointerToken(field.key)}`,
      visit,
      surface,
    );
  }
}

/**
 * 沿**单条命令**的表单描述符递归其全部块体（if.then/elif[].then/else、while/for/foreach.body、
 * switch.cases[].body/default、func.body），按有序体深度优先回调受控命令。
 * 与 `walkStoryCommands` 共用同一份「块体字段」知识（表单描述符的单点），
 * 故「某命令的体里有什么」在本包内不存在第二套判定。
 */
export function walkCommandBodies(
  cmd: Record<string, unknown>,
  commandPointer: string,
  visit: CommandVisitor,
  surface: OpSurface = BUILTIN_OP_SURFACE,
): void {
  const fields = describeForm(cmd.op as string, surface)?.fields;
  if (fields === undefined) return;
  walkBodyFields(fields, cmd, commandPointer, visit, surface);
}

/**
 * 遍历整棵故事树的全部**命令**（含嵌套块体）；visit 按命令指针回调。
 * `surface`（可选）= op 合并面（缺省内建；扩展注册后由组合根传入）。
 * 注意：scene 列的 `elements` **不在**命令遍历内——元素是声明式空间层，
 * 其形状/属性校验走 `walkStoryElements` + `validateElement`。
 * 混进命令遍历会被误报 `unknown-op`（元素只有 `type`，没有 `op`）。
 */
export function walkStoryCommands(
  story: unknown,
  visit: CommandVisitor,
  surface: OpSurface = BUILTIN_OP_SURFACE,
): void {
  if (!isPlainObject(story) || !Array.isArray(story.columns)) return;
  story.columns.forEach((column, columnIndex) => {
    if (!isPlainObject(column)) return;
    const columnPointer = `/columns/${columnIndex}`;
    const fields = column.kind === "flow" ? ["commands"] : ["entry"];
    for (const field of fields) {
      const list = column[field];
      if (Array.isArray(list)) {
        walkCommands(list, `${columnPointer}/${field}`, visit, surface);
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
