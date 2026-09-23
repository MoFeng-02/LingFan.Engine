/**
 * 07 §三 工程组装：project.json（工程清单）+ Stories/**（多列/单列文件）→ 组装 Story。
 * 纯函数：文件内容由平台适配器供给（WebView 无 Node——I/O 归 Rust/打包器，环境边界 00 §3.2-2）。
 * fail-closed：清单、文件、columnId 唯一（F1）、入口存在性（01 §一.7）任何不符 = 整次拒绝。
 */
import type { Story, StoryColumn } from "../contracts";
import {
  baseName,
  isSingleColumnFile,
  parseStory,
  parseStoryFile,
  StoryFormatError,
} from "./format";

export class ProjectAssemblyError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`工程组装失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "ProjectAssemblyError";
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 确定性文件顺序（路径码元序）——defines 覆盖与列序不随 Map 构造顺序漂移 */
function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 组装工程。装载顺序：工程 defines 最先（工程默认值），文件按路径码元序，
 * 同名 define 后加载覆盖（01 §一.6 无条件 Set 语义）。
 */
export function assembleProject(
  manifest: unknown,
  files: ReadonlyMap<string, unknown>,
): Story {
  const issues: string[] = [];
  if (!isPlainObject(manifest))
    throw new ProjectAssemblyError(["project.json: 根节点必须是对象"]);

  if (manifest.formatVersion !== 1) {
    issues.push(
      `project.json: formatVersion 必须为 1，收到 ${JSON.stringify(manifest.formatVersion)}`,
    );
  }
  if (typeof manifest.id !== "string" || manifest.id === "") {
    issues.push("project.json: id 必须为非空字符串");
  }
  if (typeof manifest.entry !== "string" || manifest.entry === "") {
    issues.push("project.json: entry 必须为非空字符串（入口列，01 §一.7）");
  }
  if (manifest.defines !== undefined && !isPlainObject(manifest.defines)) {
    issues.push("project.json: defines 必须为对象");
  }
  if (manifest.name !== undefined && typeof manifest.name !== "string") {
    issues.push("project.json: name 必须为字符串");
  }
  if (manifest.lang !== undefined && typeof manifest.lang !== "string") {
    issues.push("project.json: lang 必须为字符串");
  }
  if (issues.length > 0) throw new ProjectAssemblyError(issues);

  const columns: StoryColumn[] = [];
  const owner = new Map<string, string>(); // columnId → 首个声明它的文件
  const defines: Record<string, unknown> = {
    ...((manifest.defines as Record<string, unknown> | undefined) ?? {}),
  };

  for (const path of [...files.keys()].sort(byPath)) {
    const value = files.get(path);
    // 值的两种合法形态：解析后的文件 JSON（对象）或原始文本（JSON v1 / .story，T4 混存由
    // parseStoryFile 识别）。组装器是**唯一解析点**——调用方只供文本，避免双重解析丢失
    // 「单列原子文件」形态而绕过文件名不变量（F1 族的按 id 定位文件）。
    let story: Story;
    let atomic: boolean;
    try {
      if (typeof value === "string") {
        story = parseStoryFile(value, path);
        atomic = story.columns.length === 1; // 文本形态：单 label = 原子文件
      } else {
        story = parseStory(value, path);
        atomic = isSingleColumnFile(value);
      }
    } catch (e) {
      if (e instanceof StoryFormatError) {
        for (const issue of e.issues) issues.push(issue);
        continue;
      }
      throw e;
    }
    // 单列原子文件：文件名（去扩展名）必须等于列 id——AI/编辑器「按 id 定位文件」的不变量
    // （I18N 多语言文件名 {id}_{lang} 豁免随 01 §四 落地时引入）
    const first = story.columns[0];
    if (atomic && first !== undefined && first.id !== baseName(path)) {
      issues.push(
        `${path}: 单列文件名（${baseName(path)}）必须等于列 id（${first.id}）`,
      );
      continue;
    }
    for (const column of story.columns) {
      const prev = owner.get(column.id);
      if (prev !== undefined) {
        issues.push(
          `${path}: columnId 重复：${column.id}（与 ${prev} 冲突，F1）`,
        );
        continue;
      }
      owner.set(column.id, path);
      columns.push(column);
    }
    Object.assign(defines, story.defines ?? {});
  }
  if (issues.length > 0) throw new ProjectAssemblyError(issues);

  const entry = manifest.entry as string;
  if (!owner.has(entry)) {
    throw new ProjectAssemblyError([
      `project.json: 入口列 ${entry} 不存在（F1：跳转目标必须存在）`,
    ]);
  }
  return {
    formatVersion: 1,
    id: manifest.id as string,
    entry,
    columns,
    defines,
  };
}
