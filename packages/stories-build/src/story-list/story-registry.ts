/**
 * 故事文件清单注册表：扫描资源根下的故事目录，得出要装载的故事逻辑路径。
 *
 * 清单是**磁盘事实的投影**，不是需要作者维护的声明文件。让作者手抄名单的代价不是
 * 「多写一行」，而是漏抄时构建期毫无察觉——漏登记的那一列要到运行期才以
 * `unknown-column` 现形。
 *
 * 目录名不在这里写死：资源根与故事目录名都是 `@lingfan-engine/core` 的一处声明
 * （`RESOURCES_DIR` / `STORIES_DIR`），构建侧、引擎侧与宿主侧的扫描共用同一份判据。
 *
 * 两种创作形态落在同一棵树：手写 `.story` 与 TS 源编译出的 `.json` 都是故事文件，
 * 共用这一条扫描——创作形态不改变清单的来源。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareOrdinal, STORIES_DIR } from "@lingfan-engine/core";

/** 故事文件扩展名：手写文本形态 `.story` 与编译产物 `.json` 都算 */
export const STORY_EXTENSIONS = [".story", ".json"] as const;

/** 故事文件清单条目：相对资源根的逻辑路径（`<故事目录>/<章节>/<文件>`） */
export type StoryPath = string;

/**
 * 递归扫描故事目录，返回相对资源根的逻辑路径。
 *
 * 顺序 = 路径码元序，与引擎组装器的装载顺序同一条判据（`compareOrdinal`）——列序因此与磁盘
 * 布局一致，不随目录读取顺序漂移。
 *
 * @param storiesDir 故事目录的绝对路径（资源根下的 `<STORIES_DIR>`）
 */
export function scanStoryRegistry(storiesDir: string): readonly StoryPath[] {
  const out: StoryPath[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      if (dot <= 0) continue;
      if (
        (STORY_EXTENSIONS as readonly string[]).includes(
          entry.name.slice(dot).toLowerCase(),
        )
      ) {
        out.push(rel);
      }
    }
  };
  if (existsSync(storiesDir)) walk(storiesDir, STORIES_DIR);
  return out.sort(compareOrdinal);
}
