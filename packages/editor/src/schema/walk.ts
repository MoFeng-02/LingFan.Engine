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

/** 遍历整棵故事树的全部命令（含嵌套块体）；visit 按命令指针回调 */
export function walkStoryCommands(story: unknown, visit: CommandVisitor): void {
  if (!isPlainObject(story) || !Array.isArray(story.columns)) return;
  story.columns.forEach((column, columnIndex) => {
    if (!isPlainObject(column)) return;
    const columnPointer = `/columns/${columnIndex}`;
    const fields =
      column.kind === "flow" ? ["commands"] : ["elements", "entry"];
    for (const field of fields) {
      const list = column[field];
      if (Array.isArray(list)) {
        walkCommands(list, `${columnPointer}/${field}`, visit);
      }
    }
  });
}
