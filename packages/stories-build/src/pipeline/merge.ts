/**
 * 工程级合并：把编译器交回的条目拼成一份 `Story`，并把跨来源的 defines 收敛成一张表。
 *
 * 与 `orchestrate.ts` 的分工：那边负责「按什么顺序做哪些段」，这边负责「段与段之间的
 * 拼接与冲突判定」——都是纯函数，入参出参都是普通值，不碰 fs、不读配置。
 */
import {
  STORIES_DIR,
  type Story,
  type StoryColumn,
} from "@lingfan-engine/core";
import { StoryBuildError } from "../shared/index.ts";
import type { CompiledStoryEntry } from "../compiler/index.ts";
import type { LocatedDefineCall } from "../const-eval/index.ts";

/**
 * 把一个编译条目读成 `{ story, column }`：取条目列（columnId 必须在产物列集中）、
 * 回填产物 sourcePath、复核 story 骨架（columns 列集 + id/entry 字符串）。
 * 更深的合法性（列 id 安全段、重复、entry 存在性等）交给 serializeProject /
 * assembleProject 的既有校验兜底。
 */
export function readCompiledEntry(
  entry: CompiledStoryEntry,
  sourcesDirName: string,
): { story: Story; column: StoryColumn } {
  const sourceLabel = `${sourcesDirName}/${entry.sourceRelPath}`;
  if (!isRecord(entry.story) || !Array.isArray(entry.story.columns)) {
    throw new StoryBuildError(
      `${sourceLabel}: 编译器条目 story 缺少列集（compileStories 契约破坏）`,
    );
  }
  const column = entry.story.columns.find(
    (item) => isRecord(item) && item.id === entry.columnId,
  );
  if (column === undefined) {
    throw new StoryBuildError(
      `${sourceLabel}: 编译器条目 columnId "${entry.columnId}" 不在产物列集中（compileStories 契约破坏）`,
    );
  }
  if (
    typeof entry.story.id !== "string" ||
    entry.story.id === "" ||
    typeof entry.story.entry !== "string" ||
    entry.story.entry === ""
  ) {
    throw new StoryBuildError(
      `${sourceLabel}: 编译器条目 story 缺少 id/entry（compileStories 契约破坏）`,
    );
  }
  const story = entry.story as unknown as Story;
  const typedColumn = column as unknown as StoryColumn;
  typedColumn.sourcePath = `${STORIES_DIR}/${entry.sourceRelPath.replace(/\.ts$/, ".json")}`;
  return { story, column: typedColumn };
}

/** 形态 A（state 导出）与模块层 define 互斥时的失败文案：每条调用一行，带落点。 */
export function raiseFormAConflict(
  sourcesDirName: string,
  configFile: string,
  calls: readonly LocatedDefineCall[],
): never {
  throw new StoryBuildError(
    [
      `${sourcesDirName}/${configFile}: 形态 A（state 导出）与模块层构建期 define 互斥——形态 A/B 二选一：`,
      ...calls.map((call) => `- ${call.origin}${defineLabel(call)}`),
    ].join("\n"),
  );
}

/**
 * 跨来源的 defines 合并：同键同值收敛，同键异值 = 冲突 fail-closed（一次报全部）。
 * 来源 = config 状态（config 先行：形态 A state 或形态 B define 合并树）+ 各故事文件；
 * config 与故事同键异值同样冲突。
 */
export function mergeDefines(
  bySource: ReadonlyMap<string, { story: Story; columns: StoryColumn[] }>,
  sourcesDirName: string,
  schemaDefines: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];
  const put = (key: string, value: unknown, source: string): void => {
    if (key in merged && merged[key] !== value) {
      conflicts.push(
        `- defines["${key}"] 在 ${sourcesDirName}/${source} 与先前的声明不一致（${JSON.stringify(merged[key])} ≠ ${JSON.stringify(value)}）`,
      );
      return;
    }
    merged[key] = value;
  };
  for (const [key, value] of Object.entries(schemaDefines)) {
    put(key, value, "config.ts（state/define）");
  }
  for (const [source, { story }] of bySource) {
    for (const [key, value] of Object.entries(story.defines ?? {})) {
      put(key, value, source);
    }
  }
  if (conflicts.length > 0) {
    throw new StoryBuildError(
      `跨故事文件的 defines 冲突（工程级 defines 只有一份，请统一到工程清单或消除同名异值）：\n${conflicts.join("\n")}`,
    );
  }
  return merged;
}

/**
 * 枚举槽位回收的模块源文：按调用落点去重排序，树里缺文本的文件跳过。
 * 排序是为让回收顺序稳定（同样的源必得同样的类型面）。
 */
export function moduleSlotFiles(
  sourceTree: ReadonlyMap<string, string>,
  calls: readonly { rel: string }[],
): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of [...new Set(calls.map((call) => call.rel))].sort()) {
    const text = sourceTree.get(rel);
    if (text !== undefined) files.set(rel, text);
  }
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 互斥文案里的一条调用签名（path 形带键名；spec 形统一签名） */
function defineLabel(call: LocatedDefineCall): string {
  return call.call.kind === "path"
    ? `define("${call.call.path}")`
    : "define({…})";
}
