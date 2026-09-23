/**
 * 列级/命令级映射器便捷操作（全部纯函数、不可变，基于指针原语）：
 * addColumn / removeColumn / renameColumn（引用同步更新）/ 命令容器定位与增删改移。
 * renameColumn 更新 jump.target、menu.options[].target、navigate（scene ?? path）
 * ——「列名即标签」（01 §一.2），重命名必须保持全部列的引用图一致。
 * 锚点: editor-is-pure-mapper
 */

import type { Story } from "@lingfan/engine";
import {
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
  removeAtPointer,
  setAtPointer,
} from "./pointers";

/** 列的命令容器：flow → commands；scene → elements + entry（01 §一.3） */
export function columnContainers(column: unknown): {
  field: "commands" | "elements" | "entry";
  list: unknown[];
}[] {
  if (column === null || typeof column !== "object") return [];
  const record = column as Record<string, unknown>;
  if (record.kind === "flow") {
    return Array.isArray(record.commands)
      ? [{ field: "commands", list: record.commands }]
      : [];
  }
  const out: { field: "elements" | "entry"; list: unknown[] }[] = [];
  if (Array.isArray(record.elements)) {
    out.push({ field: "elements", list: record.elements });
  }
  if (Array.isArray(record.entry))
    out.push({ field: "entry", list: record.entry });
  return out;
}

/** 指向某列命令容器的数组指针（列不存在返回 null） */
export function containerPointer(
  story: Story,
  columnId: string,
  field: "commands" | "elements" | "entry",
): string | null {
  const index = story.columns.findIndex((column) => column.id === columnId);
  if (index < 0) return null;
  return `/columns/${index}/${field}`;
}

function nextColumnId(story: Story): string {
  let n = story.columns.length + 1;
  let id = `column-${n}`;
  while (story.columns.some((column) => column.id === id)) {
    n += 1;
    id = `column-${n}`;
  }
  return id;
}

/** 追加列；id 缺省自动生成并保证唯一；显式 id 撞名 = fail-closed 原样返回；scene 预置双容器 */
export function addColumn(
  story: Story,
  options: { id?: string; kind?: "scene" | "flow" } = {},
): { story: Story; id: string } {
  const id = options.id ?? nextColumnId(story);
  if (
    options.id !== undefined &&
    story.columns.some((column) => column.id === id)
  ) {
    return { story, id };
  }
  const kind = options.kind ?? "flow";
  const column =
    kind === "flow"
      ? { id, kind, commands: [] }
      : { id, kind, elements: [], entry: [] };
  const next = insertAtPointer(story, "/columns", story.columns.length, column);
  if (next === null) return { story, id };
  return { story: next, id };
}

/** 删除列（引用完整性交诊断层报 missing-target，不做静默改指） */
export function removeColumn(story: Story, columnId: string): Story | null {
  const index = story.columns.findIndex((column) => column.id === columnId);
  if (index < 0) return null;
  return removeAtPointer(story, `/columns/${index}`);
}

/** 引用同步面：jump.target / menu.options[].target / navigate（scene ?? path） */
function updateRefsDeep(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => updateRefsDeep(item, from, to));
  }
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  let next = record;
  const replace = () => {
    next = { ...next };
  };
  if (next.op === "jump" && next.target === from) {
    replace();
    next.target = to;
  }
  if (next.op === "menu" && Array.isArray(next.options)) {
    replace();
    next.options = next.options.map((option) => {
      if (
        option !== null &&
        typeof option === "object" &&
        (option as Record<string, unknown>).target === from
      ) {
        return { ...(option as Record<string, unknown>), target: to };
      }
      return option;
    });
  }
  if (next.op === "navigate") {
    // 目标列 = scene ?? path（② navigate 语义）：显式 scene 优先，无 scene 时 path 承载目标
    if (
      next.scene === from ||
      (next.scene === undefined && next.path === from)
    ) {
      replace();
      if (next.scene === from) next.scene = to;
      else next.path = to;
    }
  }
  return next;
}

/** 重命名列并同步全部列内的引用（jump/menu/navigate）；列不存在或新 id 撞名返回 null */
export function renameColumn(
  story: Story,
  from: string,
  to: string,
): Story | null {
  if (from === to) return story;
  const index = story.columns.findIndex((column) => column.id === from);
  if (index < 0) return null;
  if (story.columns.some((column) => column.id === to)) return null;
  const columns = story.columns.map((column, i) => {
    const renamed = i === index;
    const containers = columnContainers(column);
    if (!renamed && containers.length === 0) return column;
    const next: Record<string, unknown> = {
      ...(column as unknown as Record<string, unknown>),
    };
    if (renamed) next.id = to;
    for (const container of containers) {
      next[container.field] = updateRefsDeep(next[container.field], from, to);
    }
    return next as unknown as typeof column;
  });
  return { ...story, columns };
}

/** 向列容器插入命令（index 缺省 = 末尾） */
export function insertCommand(
  story: Story,
  columnId: string,
  field: "commands" | "elements" | "entry",
  command: Record<string, unknown>,
  index?: number,
): Story | null {
  const pointer = containerPointer(story, columnId, field);
  if (pointer === null) return null;
  const list = getAtPointer(story, pointer);
  if (!Array.isArray(list)) return null;
  return insertAtPointer(story, pointer, index ?? list.length, command);
}

/** 移除命令（elementPointer 指向命令对象） */
export function removeCommand(
  story: Story,
  elementPointer: string,
): Story | null {
  return removeAtPointer(story, elementPointer);
}

/** 更新命令负载字段（elementPointer 指向命令对象） */
export function updateCommandField(
  story: Story,
  elementPointer: string,
  field: string,
  value: unknown,
): Story | null {
  return setAtPointer(story, `${elementPointer}/${field}`, value);
}

/** 移动命令在容器内的位置（toIndex 为移除后目标位） */
export function moveCommand(
  story: Story,
  elementPointer: string,
  toIndex: number,
): Story | null {
  return moveAtPointer(story, elementPointer, toIndex);
}
