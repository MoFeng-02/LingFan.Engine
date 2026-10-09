/**
 * 故事文件解析入口：JSON 形态按内容识别（多列 / 单列原子 / 文本投影）。
 * 任何结构不符 = 整次拒绝（StoryFormatError，issues 带来源定位）。
 */
import { baseName } from "./naming";
import { isSingleColumnFile, parseColumn } from "./column";
import { StoryFormatError } from "./error";
import { isPlainObject } from "../../shared";
import { parseTextStory } from "../text";
import type { Story, StoryColumn } from "../../contracts";

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
  if (json.lang !== undefined && typeof json.lang !== "string") {
    issues.push(`${sourceName}: lang 必须为字符串（信封语言声明）`);
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
          `${sourceName}: columnId 重复：${column.id}（columnId 全局唯一）`,
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
          issues.push(`${sourceName}: 入口列 ${entry} 不存在`);
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
      lang: typeof json.lang === "string" ? json.lang : undefined,
    };
  }

  if (single) {
    // —— 单列原子文件：顶层即列对象（单列小文件） ——
    const column = parseColumn(json, sourceName, issues);
    if (issues.length > 0 || column === null)
      throw new StoryFormatError(issues);
    return {
      formatVersion: 1,
      id: column.id,
      entry: column.id,
      columns: [column],
      defines: json.defines as Record<string, unknown> | undefined,
      lang: typeof json.lang === "string" ? json.lang : undefined,
    };
  }

  throw new StoryFormatError([
    `${sourceName}: 无法识别的文件形态——需要 columns[]（多列）或 id+kind（单列原子文件）`,
  ]);
}

/** 混存识别：内容以 { 开头 = JSON 投影，否则 = 文本投影 */
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
