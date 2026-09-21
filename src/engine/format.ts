/** 01-数据层：story JSON fail-closed 解析；任何结构不符 = 整次拒绝（抛 StoryFormatError）。 */
import type { Story, StoryColumn, StoryCommand } from "./contracts";

export class StoryFormatError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`故事 JSON 解析失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "StoryFormatError";
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验命令数组每一项都是「含非空 op 字符串的对象」（负载字段由执行器窄化校验，02-E3） */
function validateCommands(
  list: readonly unknown[],
  at: string,
  issues: string[],
): void {
  for (const [j, cmd] of list.entries()) {
    if (!isPlainObject(cmd) || typeof cmd.op !== "string" || cmd.op === "") {
      issues.push(`${at}[${j}] 必须为含非空 op 字符串的命令对象`);
    }
  }
}

function parseColumn(
  raw: unknown,
  i: number,
  issues: string[],
): StoryColumn | null {
  const at = `columns[${i}]`;
  if (!isPlainObject(raw)) {
    issues.push(`${at} 必须为对象`);
    return null;
  }
  if (typeof raw.id !== "string" || raw.id === "") {
    issues.push(`${at}.id 必须为非空字符串`);
    return null;
  }
  if (raw.kind !== "scene" && raw.kind !== "flow") {
    issues.push(
      `${at}.kind 必须为 "scene" 或 "flow"，收到 ${JSON.stringify(raw.kind)}`,
    );
    return null;
  }
  const kind = raw.kind;
  if (kind === "flow") {
    if (!Array.isArray(raw.commands)) {
      issues.push(`${at}（flow）必须有 commands 数组`);
      return null;
    }
    validateCommands(raw.commands, `${at}.commands`, issues);
  } else {
    if (!Array.isArray(raw.elements)) {
      issues.push(`${at}（scene）必须有 elements 数组`);
      return null;
    }
    validateCommands(raw.elements, `${at}.elements`, issues);
    if (raw.entry !== undefined) {
      if (!Array.isArray(raw.entry)) {
        issues.push(`${at}.entry 必须为数组`);
        return null;
      }
      validateCommands(raw.entry, `${at}.entry`, issues);
    }
  }
  return {
    id: raw.id,
    kind,
    elements: raw.elements as StoryCommand[],
    entry: raw.entry as StoryCommand[] | undefined,
    commands: raw.commands as StoryCommand[] | undefined,
  };
}

/** 解析并校验故事 JSON；columnId 全局唯一（F1）、结构不符整次拒绝。 */
export function parseStory(json: unknown): Story {
  const issues: string[] = [];
  if (!isPlainObject(json)) throw new StoryFormatError(["根节点必须是对象"]);

  if (json.formatVersion !== 1) {
    issues.push(
      `formatVersion 必须为 1，收到 ${JSON.stringify(json.formatVersion)}`,
    );
  }
  if (typeof json.id !== "string" || json.id === "")
    issues.push("id 必须为非空字符串");
  if (!Array.isArray(json.columns) || json.columns.length === 0) {
    issues.push("columns 必须为非空数组");
  }
  if (json.defines !== undefined && !isPlainObject(json.defines)) {
    issues.push("defines 必须为对象");
  }
  if (issues.length > 0) throw new StoryFormatError(issues);

  const columns: StoryColumn[] = [];
  const seenIds = new Set<string>();
  for (const [i, raw] of (json.columns as unknown[]).entries()) {
    const column = parseColumn(raw, i, issues);
    if (column === null) continue;
    // F1：columnId 全局唯一
    if (seenIds.has(column.id)) {
      issues.push(`columnId 重复：${column.id}（F1：columnId 全局唯一）`);
    } else {
      seenIds.add(column.id);
    }
    columns.push(column);
  }
  if (issues.length > 0) throw new StoryFormatError(issues);

  return {
    formatVersion: 1,
    id: json.id as string, // 根级校验通过后的收窄断言（issues 为空 ⇒ id 已验证为非空字符串）
    columns,
    defines: json.defines as Record<string, unknown> | undefined,
  };
}
