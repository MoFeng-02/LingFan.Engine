import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { STORIES_DIR, type Story } from "@lingfan/engine";
import { StoryBuildError } from "./errors";

/** 列 id → 该列声明的来源文件路径（逻辑路径，相对资源根） */
export type ColumnLayout = Map<string, string>;

/**
 * 从源模块的 default 导出里提取布局声明（parse **之前**）。
 *
 * 列上的 `sourcePath` = 「这列住在哪个故事文件」（章节目录 / 多列成组 / `.story`
 * 扩展名随声明）。`parseStory` **刻意丢弃 sourcePath**（防自指：故事文件不描述自己的
 * 位置）⇒ 在 parse 之前提取为构建配置、parse 之后按 id 回填（与组装器从磁盘回填同一
 * 语义）——引擎契约零改动。四条校验各自 fail-closed 并带列 id 定位。
 */
export async function loadLayoutDeclaration(
  sourcesDir: string,
  source: string,
): Promise<{ mod: { default?: unknown }; layout: ColumnLayout }> {
  const mod = (await import(pathToFileURL(join(sourcesDir, source)).href)) as {
    default?: unknown;
  };
  if (mod?.default === undefined) {
    throw new StoryBuildError(
      `${source}: 缺 default 导出（TS 源约定：default 导出多列 Story 值；\`satisfies Story\` 提供编译期类型检查）`,
    );
  }
  const layout: ColumnLayout = new Map<string, string>();
  const rawColumns = (mod.default as { columns?: unknown }).columns;
  if (!Array.isArray(rawColumns)) {
    throw new StoryBuildError(`${source}: columns 必须为数组`);
  }
  for (const entry of rawColumns) {
    const id = (entry as { id?: unknown }).id;
    const sourcePath = (entry as { sourcePath?: unknown }).sourcePath;
    if (typeof id !== "string" || id === "") continue;
    if (sourcePath === undefined) continue;
    if (
      typeof sourcePath !== "string" ||
      !sourcePath.startsWith(`${STORIES_DIR}/`)
    ) {
      throw new StoryBuildError(
        `${source}: 列 ${id} 的 sourcePath 必须以 "${STORIES_DIR}/" 开头，收到 ${JSON.stringify(sourcePath)}`,
      );
    }
    if (sourcePath.includes("..")) {
      throw new StoryBuildError(
        `${source}: 列 ${id} 的 sourcePath 不得包含 ".."（目录逃逸）`,
      );
    }
    if (!sourcePath.endsWith(".story") && !sourcePath.endsWith(".json")) {
      throw new StoryBuildError(
        `${source}: 列 ${id} 的 sourcePath 扩展名必须是 .story 或 .json，收到 ${JSON.stringify(sourcePath)}`,
      );
    }
    layout.set(id, sourcePath);
  }
  return { mod, layout };
}

/** 布局回填（parse 之后、serialize 之前——`columnFilePath` 据此落章节文件） */
export function applyLayout(story: Story, layout: ColumnLayout): void {
  for (const column of story.columns) {
    const declared = layout.get(column.id);
    if (declared !== undefined) column.sourcePath = declared;
  }
}
