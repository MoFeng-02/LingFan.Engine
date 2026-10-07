/**
 * 列级/命令级映射器便捷操作（全部纯函数、不可变，基于指针原语）：
 * addColumn / removeColumn / renameColumn（引用同步更新）/ 命令容器定位与增删改移。
 * renameColumn 更新 jump.target、menu.options[].target、navigate（scene ?? path）
 * ——「列名即标签」，重命名必须保持全部列的引用图一致。
 */

import type { Story } from "@lingfan/engine";
import { isSafeFileNameSegment } from "@lingfan/engine";
import {
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
  removeAtPointer,
  setAtPointer,
} from "./pointers";

/** 列的命令容器：flow → commands；scene → elements + entry */
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

/**
 * 语义化列 id 生成：建议 → 唯一化 → 兜底。 `hint` 是**建议**非命令：非法（空 / 不安全文件名字符）→ 回退 `column-N` 计数
 * （不抛、不静默把作者输入改写成另一个语义 id）；重名 → `-2`/`-3` 递增取空位。
 * 列 id 语义：文件名 = 列 id 是存储不变量，运行时永不派生；
 * 列序 = 文件路径码元序 ⇒ 语义化 id 优于计数 id（`column-N` 重排后落字母位，仅兜底）。
 */
export function suggestColumnId(
  hint: string | null | undefined,
  existingIds: readonly string[],
): string {
  const taken = new Set(existingIds);
  const cleaned = typeof hint === "string" ? hint.trim() : "";
  if (cleaned !== "" && isSafeFileNameSegment(cleaned)) {
    if (!taken.has(cleaned)) return cleaned;
    let n = 2;
    while (taken.has(`${cleaned}-${n}`)) n += 1;
    return `${cleaned}-${n}`;
  }
  let n = existingIds.length + 1;
  while (taken.has(`column-${n}`)) n += 1;
  return `column-${n}`;
}

/** 追加列；id 缺省时按 `hint` 生成语义化 id（无建议 → column-N 兜底）并保证唯一；显式 id 撞名 = fail-closed 原样返回；scene 预置双容器 */
export function addColumn(
  story: Story,
  options: {
    id?: string;
    kind?: "scene" | "flow";
    /**
     * 运行语义轴（与 `kind` 正交）：game 缺省 / menu 菜单 / ui 覆盖层。
     * **缺省与 game 都不写字段**——默认值不显式存储（与写回保真同一口径：
     * 新建列的内存形态必须与重开后的解析形态深等）。
     */
    type?: "game" | "menu" | "ui";
    /** 语义化建议（仅 id 缺省时参与；见 suggestColumnId） */
    hint?: string | null;
  } = {},
): { story: Story; id: string } {
  const id =
    options.id ??
    suggestColumnId(
      options.hint,
      story.columns.map((column) => column.id),
    );
  if (
    options.id !== undefined &&
    story.columns.some((column) => column.id === id)
  ) {
    return { story, id };
  }
  const kind = options.kind ?? "flow";
  const base =
    kind === "flow"
      ? { id, kind, commands: [] }
      : { id, kind, elements: [], entry: [] };
  // 仅非 game 的显式 type 才落字段（默认形态保持与旧工程逐字节一致）
  const column =
    options.type !== undefined && options.type !== "game"
      ? { ...base, type: options.type }
      : base;
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

/**
 * 反查：**哪个文件承载的第一个列**（列序；资源树点击故事文件时用）。
 *
 * 语义：一个 `.story` 文件可承载**多个列**（如 `chapter1.story` = 4 列），
 * 「点击资源树里的故事文件」⇒ 打开该文件**列序第一**的列（确定性，不猜作者意图）。
 * 匹配键 = 组装器回填的 `sourcePath`（工程级事实；默认路径 `Stories/<id>.json`
 * 不显式存 `sourcePath`——那种文件由 `columnIdOfDocument` 先行命中，不走这里）。
 */
export function firstColumnIdOfSourcePath(
  story: Story,
  filePath: string,
): string | undefined {
  return story.columns.find(
    (column) =>
      typeof column.sourcePath === "string" &&
      column.sourcePath !== "" &&
      column.sourcePath === filePath,
  )?.id;
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
    if (renamed) {
      next.id = to;
      // **重命名 ⇒ 来源文件同步改名**。
      // `sourcePath` 是「这个列来自哪个文件」；列 id 变了而文件名不变，
      // 会写回旧文件名（`Stories/inn.json` 里躺着 id=tavern 的列）——
      // 那是**分裂**：文件名与内容 id 不一致，下次打开会被组装器拒绝
      // （「单列文件名必须等于列 id」）。
      // 只改**文件名段**（basename），目录层级（作者的章节编排）保持不变。
      const source = column.sourcePath;
      if (typeof source === "string" && source !== "") {
        const slash = source.lastIndexOf("/");
        const dir = slash < 0 ? "" : source.slice(0, slash + 1);
        const base = slash < 0 ? source : source.slice(slash + 1);
        const dot = base.indexOf(".");
        const ext = dot < 0 ? "" : base.slice(dot);
        next.sourcePath = `${dir}${to}${ext}`;
      }
    }
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
