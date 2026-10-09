/**
 * 列对象（scene / flow）的形状判定与解析。
 *
 * 形状是否合法是**单一判定点**：`columnShapeDefect` 出缺陷码，各调用点只管把缺陷
 * 渲染成自己那边的定位文案（故事文件里用列路径，组装层用列 id），判定本身不许各写一份。
 * 不改判定、不改文案的分片搬运是安全的；一旦有人把这里的 kind/type 判据另写一份，
 * 两条路径迟早会对同一个文件给出不同结论。
 */
import { isPlainObject } from "../../shared";
import { isSceneType, type ElementNode, type SceneType, type StoryColumn, type StoryCommand } from "../../contracts";
import { validateElement } from "../element";
import { validateCommand } from "./validate";

/** 单列原子文件形态判定（顶层即列对象：id + kind，无 columns[]） */
export function isSingleColumnFile(json: unknown): boolean {
  return (
    isPlainObject(json) &&
    !Array.isArray(json.columns) &&
    json.kind !== undefined
  );
}

/**
 * 实例级 z：命令上的可选 `z` = 单控件实例的层级覆盖。
 * 只允许**非负有限数**（fail-closed：负数 / NaN / Infinity / 字符串一律拒绝）。
 * 仅「拥有独立渲染层」的命令接受该字段（say / menu / input / notify / minigame）。
 */
export function validateInstanceZ(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  if (cmd.z === undefined) return;
  if (typeof cmd.z !== "number" || !Number.isFinite(cmd.z) || cmd.z < 0) {
    issues.push(`${at}.z 必须为非负有限数（实例级层级）`);
  }
}

/**
 * 列形状缺陷：只报「哪里不对」，不含定位文案（各调用点自己渲染）。
 */
export type ColumnShapeDefect =
  | { reason: "bad-kind"; received: unknown }
  | { reason: "bad-type"; received: unknown }
  | { reason: "flow-without-commands" }
  | { reason: "scene-without-elements" };

/**
 * 列对象形状判定（缺省校验 `type`）。
 *
 * `type`（运行语义：game/menu/ui）**缺省合法 = game**，但**给了就必须合法**——
 * 非法值 fail-closed（不静默当 game，否则作者以为设了菜单其实是剧情，
 * 那种错要等存档/回溯出问题才发现，代价极高）。
 *
 * 已经另行校验过 `type` 的调用点可传 `checkType: false`，避免同一处报两遍。
 */
export function columnShapeDefect(
  column: Record<string, unknown>,
  options?: { checkType?: boolean },
): ColumnShapeDefect | null {
  const kind = column.kind;
  if (kind !== "scene" && kind !== "flow") {
    return { reason: "bad-kind", received: kind };
  }
  if (
    options?.checkType !== false &&
    column.type !== undefined &&
    !isSceneType(column.type)
  ) {
    return { reason: "bad-type", received: column.type };
  }
  if (kind === "flow") {
    if (!Array.isArray(column.commands)) return { reason: "flow-without-commands" };
    return null;
  }
  if (!Array.isArray(column.elements)) return { reason: "scene-without-elements" };
  return null;
}

/**
 * 把一段未知 JSON 解析成故事列，形状不合法即拒。
 *
 * 输入：`raw` 待解析的列数据、`at` 定位前缀、`issues` 收集器。
 * 产出：解析成功的 `StoryColumn`；`id` 缺失或形状不合法时返回 `null`。
 * 失败表现：不抛异常，一律把原因（带 `at` 定位）推入 `issues` 后返回 `null`。
 * 形状判定收敛在 `columnShapeDefect`，本函数只负责把缺陷码渲染成既有的用户可见文案。
 */
export function parseColumn(
  raw: unknown,
  at: string,
  issues: string[],
): StoryColumn | null {
  if (!isPlainObject(raw)) {
    issues.push(`${at} 必须为对象`);
    return null;
  }
  if (typeof raw.id !== "string" || raw.id === "") {
    issues.push(`${at}.id 必须为非空字符串`);
    return null;
  }
  const shape = columnShapeDefect(raw);
  if (shape !== null) {
    if (shape.reason === "bad-kind") {
      issues.push(
        `${at}.kind 必须为 "scene" 或 "flow"，收到 ${JSON.stringify(shape.received)}`,
      );
    } else if (shape.reason === "bad-type") {
      issues.push(
        `${at}.type 必须为 "game" / "menu" / "ui"，收到 ${JSON.stringify(shape.received)}`,
      );
    } else if (shape.reason === "flow-without-commands") {
      issues.push(`${at}（flow）必须有 commands 数组`);
    } else {
      issues.push(`${at}（scene）必须有 elements 数组`);
    }
    return null;
  }
  const type = raw.type as SceneType | undefined;
  const kind = raw.kind as "scene" | "flow";
  if (kind === "flow") {
    if (!Array.isArray(raw.commands)) {
      issues.push(`${at}（flow）必须有 commands 数组`);
      return null;
    }
    for (const [j, cmd] of raw.commands.entries()) {
      validateCommand(cmd, `${at}.commands[${j}]`, issues);
    }
  } else {
    if (!Array.isArray(raw.elements)) {
      issues.push(`${at}（scene）必须有 elements 数组`);
      return null;
    }
    const seenElementIds = new Set<string>();
    for (const [j, node] of raw.elements.entries()) {
      validateElement(node, `${at}.elements[${j}]`, issues);
      if (isPlainObject(node) && typeof node.id === "string" && node.id !== "") {
        if (seenElementIds.has(node.id)) {
          issues.push(
            `${at}.elements[${j}].id 重复：${node.id}（同列内元素 id 必须唯一，寻址前提）`,
          );
        } else {
          seenElementIds.add(node.id);
        }
      }
    }
    if (raw.entry !== undefined) {
      if (!Array.isArray(raw.entry)) {
        issues.push(`${at}.entry 必须为数组`);
        return null;
      }
      for (const [j, cmd] of raw.entry.entries()) {
        validateCommand(cmd, `${at}.entry[${j}]`, issues);
      }
    }
  }
  return {
    id: raw.id,
    kind,
    type,
    // `sourcePath` **刻意不解析**：它是编辑期记账（由组装器从实际文件路径回填），
    // 故事文件里不该有这个键——写进去也无效（防止自指：文件描述自己的位置）。
    elements: raw.elements as ElementNode[] | undefined,
    entry: raw.entry as StoryCommand[] | undefined,
    commands: raw.commands as StoryCommand[] | undefined,
  };
}
