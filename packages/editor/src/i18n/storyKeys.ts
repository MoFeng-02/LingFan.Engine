import { STORIES_DIR } from "@lingfan/engine";

/**
 * 列 → 产物故事键（i18n per-story 骨架的权威口径）：列落盘文件相对 `Stories/` 的
 * 路径、不含扩展名——与 `planOverlaySkeleton` 的 per-story 键、构建的写盘路径
 * （`Stories/<相对源路径>.json`，文件名与列 id 解耦）同一规则，保证骨架
 * `Lang/{lang}/{故事键}.json` 与 `Resources/Stories/` 递归目录严格镜像。
 *
 * 多目录形态下列 id ≠ 文件名，键必须从 `column.sourcePath`（构建回填的产物路径）
 * 推导；缺省/非法（非 `Stories/` 前缀、含 `..`）回退引擎默认布局 `Stories/{id}.json`。
 */
export function columnStoryKey(column: {
  readonly id: string;
  readonly sourcePath?: string;
}): string {
  const fallback = `${STORIES_DIR}/${column.id}.json`;
  const sourcePath = column.sourcePath;
  const resolved =
    typeof sourcePath === "string" &&
    sourcePath.startsWith(`${STORIES_DIR}/`) &&
    !sourcePath.includes("..")
      ? sourcePath
      : fallback;
  const relative = resolved.slice(STORIES_DIR.length + 1);
  const dot = relative.lastIndexOf(".");
  return dot > 0 ? relative.slice(0, dot) : relative;
}
