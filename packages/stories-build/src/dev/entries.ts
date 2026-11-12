/**
 * 直达清单：从编译产物里取「有哪些列可直接进入」，并按列 id 判定目标。
 *
 * 清单是磁盘事实的投影：扫描故事目录下的每个文件，解析出它声明的列 id。
 * 取数与引擎组装器同源——同一份扫描规则、同一份解析规则，故「清单里有的列」
 * 就是「引擎能进的列」。
 *
 * 校验在启动前完成：列 id 不存在或同名歧义时宁可失败，也不让开发服务器带着
 * 一个错误目标跑起来——那时用户要等一次冷启动才知道自己敲错了。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RESOURCES_DIR,
  STORIES_DIR,
  parseStoryFile,
} from "@lingfan-engine/core";
import { scanStoryRegistry } from "../story-list/index.ts";
import { StoryBuildError } from "../shared/index.ts";

/** 一列的直达信息 */
export interface DevEntry {
  /** 列 id（直达参数的唯一合法取值） */
  readonly id: string;
  /** 列所在产物文件的逻辑路径（相对资源根，如 `Stories/chapter1/inn.json`） */
  readonly sourcePath: string;
}

/** 清单结果：可用列 + 歧义登记 */
export interface DevEntries {
  /** 可直达的列（按文件顺序、再按文件内列序） */
  readonly entries: readonly DevEntry[];
  /** 同一 id 出现在多个文件时的候选登记（正常工程为空） */
  readonly ambiguous: Readonly<Record<string, readonly string[]>>;
}

/** 目标解析命中：清单里有且只有这一列 */
export interface DevTargetHit {
  readonly ok: true;
  readonly entry: DevEntry;
}

/** 目标解析未命中：列不存在，或同名出现在多个文件 */
export interface DevTargetMiss {
  readonly ok: false;
  /** 失败原因：unknown = 没有这列；ambiguous = 同名列出现在多个文件 */
  readonly reason: "unknown" | "ambiguous";
  /** 请求的列 id */
  readonly id: string;
  /** 候选文件（unknown 时为空） */
  readonly candidates: readonly string[];
}

/** 目标解析结果：要么命中唯一列，要么给出失败原因 */
export type DevTarget = DevTargetHit | DevTargetMiss;

/** 故事目录在工程根下的位置：资源根下的故事目录 */
function storiesDirOf(projectRoot: string): string {
  return join(projectRoot, RESOURCES_DIR, STORIES_DIR);
}

/**
 * 扫出工程里可直达的列。
 *
 * 顺序 = 文件的码元序（与引擎装载顺序同一条判据），文件内的列序 = 作者声明的顺序。
 *
 * @param projectRoot 工程根（其下有 `Resources/Stories`）
 */
export function listDevEntries(projectRoot: string): DevEntries {
  const storiesDir = storiesDirOf(projectRoot);
  const paths = scanStoryRegistry(storiesDir);
  if (paths.length === 0) {
    throw new StoryBuildError(
      `未找到故事文件（${storiesDir}）——先跑一次故事编译再直达`,
    );
  }
  const entries: DevEntry[] = [];
  const byId = new Map<string, string[]>();
  for (const logicalPath of paths) {
    const filePath = join(projectRoot, RESOURCES_DIR, logicalPath);
    const source = readFileSync(filePath, "utf8");
    let story;
    try {
      story = parseStoryFile(source, logicalPath);
    } catch (error: unknown) {
      throw new StoryBuildError(
        `故事文件解析失败（${logicalPath}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const column of story.columns) {
      entries.push({ id: column.id, sourcePath: logicalPath });
      const sources = byId.get(column.id);
      if (sources === undefined) byId.set(column.id, [logicalPath]);
      else sources.push(logicalPath);
    }
  }
  const ambiguous: Record<string, readonly string[]> = {};
  for (const [id, sources] of byId) {
    if (sources.length > 1) ambiguous[id] = sources;
  }
  return { entries, ambiguous };
}

/**
 * 在清单里找目标列。
 *
 * 命中多条同名列视为歧义并报出全部候选文件——引擎侧保证列 id 跨文件唯一，
 * 真出现同名说明工程有问题，此时不猜。
 *
 * @param entries 清单结果
 * @param id 目标列 id
 */
export function resolveDevTarget(entries: DevEntries, id: string): DevTarget {
  const candidates = entries.ambiguous[id];
  if (candidates !== undefined) {
    return { ok: false, reason: "ambiguous", id, candidates };
  }
  const entry = entries.entries.find((item) => item.id === id);
  if (entry === undefined)
    return { ok: false, reason: "unknown", id, candidates: [] };
  return { ok: true, entry };
}
