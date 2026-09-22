/**
 * 01-数据层：故事文件 fail-closed 解析。
 * 两种文件形态按内容识别（07 §三「单列小文件与多列文件均可」，对齐老引擎 Stories 目录语义）：
 * - 多列文件：{ formatVersion, columns[], defines?, entry?, id? }
 * - 单列原子文件：{ formatVersion, id, kind, commands/elements/entry…, defines? }
 * 任何结构不符 = 整次拒绝（抛 StoryFormatError，issues 带来源定位）。
 */
import { parseTextStory } from "./text";
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

function requireNonEmptyString(v: unknown, at: string, issues: string[]): void {
  if (typeof v !== "string" || v === "") issues.push(`${at} 必须为非空字符串`);
}

/** 文件名去目录去扩展名（组装层用它校验「单列文件名 = 列 id」不变量） */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const file = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** 单列原子文件形态判定（顶层即列对象：id + kind，无 columns[]） */
export function isSingleColumnFile(json: unknown): boolean {
  return (
    isPlainObject(json) &&
    !Array.isArray(json.columns) &&
    json.kind !== undefined
  );
}

/** 命令负载结构校验（已知 op；未实现 op 交执行器 fail-closed，E3） */
function validateCommand(cmd: unknown, at: string, issues: string[]): void {
  if (!isPlainObject(cmd)) {
    issues.push(`${at} 必须为对象`);
    return;
  }
  if (typeof cmd.op !== "string" || cmd.op === "") {
    issues.push(`${at} 必须为含非空 op 字符串的命令对象`);
    return;
  }
  switch (cmd.op) {
    case "say":
      requireNonEmptyString(cmd.text, `${at}.text`, issues);
      break;
    case "if": {
      requireNonEmptyString(cmd.cond, `${at}.cond`, issues);
      validateBody(cmd.then, `${at}.then`, issues, true);
      if (cmd.elif !== undefined) {
        if (!Array.isArray(cmd.elif)) {
          issues.push(`${at}.elif 必须为数组`);
        } else {
          for (const [j, elif] of cmd.elif.entries()) {
            if (!isPlainObject(elif)) {
              issues.push(`${at}.elif[${j}] 必须为对象`);
              continue;
            }
            requireNonEmptyString(elif.cond, `${at}.elif[${j}].cond`, issues);
            validateBody(elif.then, `${at}.elif[${j}].then`, issues, true);
          }
        }
      }
      if (cmd.else !== undefined)
        validateBody(cmd.else, `${at}.else`, issues, false);
      break;
    }
    case "menu": {
      if (cmd.prompt !== undefined && typeof cmd.prompt !== "string") {
        issues.push(`${at}.prompt 必须为字符串`);
      }
      if (!Array.isArray(cmd.options) || cmd.options.length === 0) {
        issues.push(`${at}.options 必须为非空数组`);
      } else {
        for (const [j, opt] of cmd.options.entries()) {
          if (!isPlainObject(opt)) {
            issues.push(`${at}.options[${j}] 必须为对象`);
            continue;
          }
          requireNonEmptyString(opt.text, `${at}.options[${j}].text`, issues);
          requireNonEmptyString(
            opt.target,
            `${at}.options[${j}].target`,
            issues,
          );
        }
      }
      break;
    }
    case "set":
    case "define":
    case "let":
    case "local":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!("value" in cmd)) issues.push(`${at}.value 必填`);
      break;
    case "undef":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      break;
    case "jump":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      break;
    case "notify":
      requireNonEmptyString(cmd.text, `${at}.text`, issues);
      if (cmd.type !== undefined && typeof cmd.type !== "string") {
        issues.push(`${at}.type 必须为字符串`);
      }
      if (cmd.duration !== undefined && typeof cmd.duration !== "number") {
        issues.push(`${at}.duration 必须为数字`);
      }
      break;
    case "wait":
      if (typeof cmd.seconds !== "number")
        issues.push(`${at}.seconds 必须为数字`);
      if (cmd.skipable !== undefined && typeof cmd.skipable !== "boolean") {
        issues.push(`${at}.skipable 必须为布尔`);
      }
      break;
    case "pause":
      if (typeof cmd.seconds !== "number")
        issues.push(`${at}.seconds 必须为数字`);
      break;
    case "while":
      requireNonEmptyString(cmd.cond, `${at}.cond`, issues);
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
    case "for":
      requireNonEmptyString(cmd.var, `${at}.var`, issues);
      requireNonEmptyString(cmd.in, `${at}.in`, issues);
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
    case "foreach":
      requireNonEmptyString(cmd.var, `${at}.var`, issues);
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
    case "switch": {
      requireNonEmptyString(cmd.on, `${at}.on`, issues);
      if (!Array.isArray(cmd.cases) || cmd.cases.length === 0) {
        issues.push(`${at}.cases 必须为非空数组`);
      } else {
        for (const [j, c] of cmd.cases.entries()) {
          if (!isPlainObject(c)) {
            issues.push(`${at}.cases[${j}] 必须为对象`);
            continue;
          }
          if (!("value" in c)) issues.push(`${at}.cases[${j}].value 必填`);
          validateBody(c.body, `${at}.cases[${j}].body`, issues, true);
        }
      }
      if (cmd.default !== undefined)
        validateBody(cmd.default, `${at}.default`, issues, false);
      break;
    }
    case "break":
    case "continue":
      break; // 无参数
    case "array":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!Array.isArray(cmd.items)) issues.push(`${at}.items 必须为数组`);
      if (cmd.once !== undefined && typeof cmd.once !== "boolean") {
        issues.push(`${at}.once 必须为布尔`);
      }
      break;
    case "array_push":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!("value" in cmd)) issues.push(`${at}.value 必填`);
      break;
    case "array_pop":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      break;
    case "dict":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!isPlainObject(cmd.value)) issues.push(`${at}.value 必须为对象`);
      if (cmd.once !== undefined && typeof cmd.once !== "boolean") {
        issues.push(`${at}.once 必须为布尔`);
      }
      break;
    case "dict_set":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      requireNonEmptyString(cmd.field, `${at}.field`, issues);
      if (!("value" in cmd)) issues.push(`${at}.value 必填`);
      break;
    case "func":
      requireNonEmptyString(cmd.name, `${at}.name`, issues);
      if (
        !Array.isArray(cmd.params) ||
        cmd.params.some((p) => typeof p !== "string" || p === "")
      ) {
        issues.push(`${at}.params 必须为非空字符串数组`);
      }
      validateBody(cmd.body, `${at}.body`, issues, true);
      break;
    case "call":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (cmd.args !== undefined && !Array.isArray(cmd.args)) {
        issues.push(`${at}.args 必须为数组`);
      }
      break;
    case "return":
      break; // value 可选
    case "input":
      requireNonEmptyString(cmd.prompt, `${at}.prompt`, issues);
      requireNonEmptyString(cmd.store, `${at}.store`, issues);
      if (cmd.options !== undefined) {
        issues.push(`${at}.options 选项式输入暂未实现（fail-closed）`);
      }
      break;
    case "random": {
      if (typeof cmd.seed !== "number" || !Number.isInteger(cmd.seed)) {
        issues.push(`${at}.seed 必须为整数`);
      }
      const range = cmd.range;
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        typeof range[0] !== "number" ||
        typeof range[1] !== "number"
      ) {
        issues.push(`${at}.range 必须为 [min, max] 数字数组`);
      }
      requireNonEmptyString(cmd.var, `${at}.var`, issues);
      break;
    }
    default:
      break; // 未实现 op：结构从简，执行器 fail-closed（E3）
  }
}

/** 块体校验：必填缺失即报（老规范 §八.4：if 无 then → 报错），成员递归校验 */
function validateBody(
  v: unknown,
  at: string,
  issues: string[],
  required: boolean,
): void {
  if (v === undefined) {
    if (required) issues.push(`${at} 必填（块字段缺失）`);
    return;
  }
  if (!Array.isArray(v)) {
    issues.push(`${at} 必须为数组`);
    return;
  }
  for (const [i, item] of v.entries())
    validateCommand(item, `${at}[${i}]`, issues);
}

function parseColumn(
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
    for (const [j, cmd] of raw.commands.entries()) {
      validateCommand(cmd, `${at}.commands[${j}]`, issues);
    }
  } else {
    if (!Array.isArray(raw.elements)) {
      issues.push(`${at}（scene）必须有 elements 数组`);
      return null;
    }
    for (const [j, cmd] of raw.elements.entries()) {
      validateCommand(cmd, `${at}.elements[${j}]`, issues);
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
    elements: raw.elements as StoryCommand[],
    entry: raw.entry as StoryCommand[] | undefined,
    commands: raw.commands as StoryCommand[] | undefined,
  };
}

/**
 * 解析单个故事文件（多列或单列形态，按内容识别）。
 * sourceName 用于错误定位与派生 id（组装层传文件路径）。
 */
export function parseStory(json: unknown, sourceName = "story"): Story {
  const issues: string[] = [];
  if (!isPlainObject(json))
    throw new StoryFormatError([`${sourceName}: 根节点必须是对象`]);
  if (json.formatVersion !== 1) {
    issues.push(
      `${sourceName}: formatVersion 必须为 1，收到 ${JSON.stringify(json.formatVersion)}`,
    );
  }
  if (json.defines !== undefined && !isPlainObject(json.defines)) {
    issues.push(`${sourceName}: defines 必须为对象`);
  }

  const hasColumns = Array.isArray(json.columns);
  const single = isSingleColumnFile(json);
  if (hasColumns && json.kind !== undefined) {
    issues.push(
      `${sourceName}: 文件形态歧义——columns 与单列字段（kind）不得并存`,
    );
  }
  if (issues.length > 0) throw new StoryFormatError(issues);

  if (hasColumns) {
    // —— 多列文件 ——
    const columns: StoryColumn[] = [];
    const seen = new Set<string>();
    for (const [i, raw] of (json.columns as unknown[]).entries()) {
      const column = parseColumn(raw, `${sourceName}: columns[${i}]`, issues);
      if (column === null) continue;
      if (seen.has(column.id)) {
        issues.push(
          `${sourceName}: columnId 重复：${column.id}（F1：columnId 全局唯一）`,
        );
      } else {
        seen.add(column.id);
      }
      columns.push(column);
    }
    if (columns.length === 0)
      issues.push(`${sourceName}: columns 必须为非空数组`);
    let entry: string;
    if (json.entry !== undefined) {
      if (typeof json.entry !== "string" || json.entry === "") {
        issues.push(`${sourceName}: entry 必须为非空字符串`);
        entry = columns[0]?.id ?? "";
      } else {
        entry = json.entry;
        if (!seen.has(entry))
          issues.push(`${sourceName}: 入口列 ${entry} 不存在（F1）`);
      }
    } else {
      entry = columns[0]?.id ?? "";
    }
    if (issues.length > 0) throw new StoryFormatError(issues);
    return {
      formatVersion: 1,
      id:
        typeof json.id === "string" && json.id !== ""
          ? json.id
          : baseName(sourceName),
      entry,
      columns,
      defines: json.defines as Record<string, unknown> | undefined,
    };
  }

  if (single) {
    // —— 单列原子文件：顶层即列对象（07 §三：单列小文件） ——
    const column = parseColumn(json, sourceName, issues);
    if (issues.length > 0 || column === null)
      throw new StoryFormatError(issues);
    return {
      formatVersion: 1,
      id: column.id,
      entry: column.id,
      columns: [column],
      defines: json.defines as Record<string, unknown> | undefined,
    };
  }

  throw new StoryFormatError([
    `${sourceName}: 无法识别的文件形态——需要 columns[]（多列）或 id+kind（单列原子文件）`,
  ]);
}

/** 07-T4 混存识别：内容以 { 开头 = JSON 投影，否则 = 文本投影（老 StoryLoader 内容识别语义） */
export function parseStoryFile(source: string, sourceName: string): Story {
  if (source.trimStart().startsWith("{")) {
    try {
      return parseStory(JSON.parse(source), sourceName);
    } catch (e) {
      if (e instanceof StoryFormatError) throw e;
      throw new StoryFormatError([
        `${sourceName}: JSON 解析失败：${String(e)}`,
      ]);
    }
  }
  return parseTextStory(source, sourceName);
}
