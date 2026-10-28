/**
 * 故事章节树 · 判据与装配实现（可测，无 IO / 无 Vue）。
 *
 * 域出口 `./index.ts` 只做转发（类型见 `./types.ts`）；实现集中在本文件。
 * 设计约定（分组只看 type、任意深度、0 层平铺退化）见出口文件头注。
 */

import {
  isReplayableColumn,
  STORIES_DIR,
  type StoryColumn,
} from "@lingfan-engine/core";
import type {
  ChapterDir,
  ChapterGroup,
  ChapterIndex,
  ChapterInput,
  ChapterNode,
} from "./types.ts";

/** 故事文件的容器根（剥掉它，剩下的目录链才是「作者的章节编排」；由引擎 SSOT 常量派生） */
const STORIES_ROOT = `${STORIES_DIR}/`;

/** 剥掉 `Stories/` 前缀（**容器根不算章节**——否则 `Stories/start.json` 的章节名会变成「Stories」） */
function insideStories(path: string): string {
  return path.startsWith(STORIES_ROOT) ? path.slice(STORIES_ROOT.length) : path;
}

/** 章节目录键（不依赖 `ResourceNode`，直接吃路径集——便于纯测）
 *
 * **只取 `Stories/` 之下的目录**（`Stories/start.json` ⇒ `""` ⇒ 平铺，
 * 因为「深一层」只是把文件分组，**不是编排章节**；只有 `Stories/a/b.story` 才是）。
 * 容器根 `Stories/` 本身**不算章节**——否则章节名全变成 "Stories"。
 */
export function chapterDirOf(path: string): string {
  const inner = insideStories(path);
  const idx = inner.lastIndexOf("/");
  return idx < 0 ? "" : inner.slice(0, idx + 1);
}

/** 章节显示名：**优先取目录名**（作者的分章意图），0 层平铺时退回文件名去后缀 */
export function chapterLabelOf(path: string): string {
  const inner = insideStories(path);
  const file = inner.slice(inner.lastIndexOf("/") + 1);
  const dot = file.indexOf(".");
  const name = dot < 0 ? file : file.slice(0, dot);
  const dir = chapterDirOf(path);
  const dirName =
    dir
      .slice(0, dir.length - 1)
      .split("/")
      .pop() ?? "";
  // 目录名与文件名同前缀时（如 chapter1/chapter1.story）**取目录名**——
  // 目录才是「章节」，文件名只是文件。
  return dirName !== "" ? dirName : name;
}

/** 章节所属分组（**单一判定点**：直接用引擎的 `isReplayableColumn`，不另写一份） */
export function chapterGroupOf(
  column: Pick<StoryColumn, "type">,
): ChapterGroup {
  return isReplayableColumn(column) ? "story" : "ui";
}

/**
 * 场景类型的**徽标文案**（单一事实源：列侧栏 / 章节树共用，组件不得自写映射）。
 *
 * - `"ui"` → 「界面」
 * - 缺省（`undefined`）与 `"game"` → `null`（**game 是常态不标**——满屏「剧情」徽标是噪音）
 */
export function sceneTypeBadgeOf(
  type: StoryColumn["type"],
): "界面" | null {
  return type === "ui" ? "界面" : null;
}

/** 命令条数（flow 看 commands、scene 看 entry；缺省 0） */
function commandCountOf(column: StoryColumn): number {
  if (column.kind === "scene") return (column.entry ?? []).length;
  return (column.commands ?? []).length;
}

/** 按组归并目录（`dirs` 的**分组版本**；同一目录在两个组各出一份，children 不交叉） */
function dirsOfGroup(
  nodes: readonly ChapterNode[],
  group: ChapterGroup,
): ChapterDir[] {
  const byDir = new Map<string, ChapterNode[]>();
  for (const node of nodes) {
    if (node.group !== group) continue; // ← 关键：只收本组的节点
    const dir = chapterDirOf(node.path);
    if (dir === "") continue; // 0 层平铺：不进目录分组
    const bucket = byDir.get(dir);
    if (bucket === undefined) byDir.set(dir, [node]);
    else bucket.push(node);
  }
  return [...byDir.entries()]
    .map(([path, children]) => ({
      label:
        path
          .slice(0, path.length - 1)
          .split("/")
          .pop() ?? path,
      path,
      children: [...children].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      ),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * 构建章节目录。
 *
 * **分组只看 `type`，绝不看目录名** —— 作者可能把剧情放进 `system/`、
 * 把菜单放进 `chapter1/`。按目录分组会把它们错分。
 * **目录只表达「作者的编排意图」，类型才表达「运行语义」。**
 */
export function buildChapterIndex(
  inputs: readonly ChapterInput[],
): ChapterIndex {
  const nodes: ChapterNode[] = inputs.map(({ path, column }) => ({
    id: column.id,
    label: chapterLabelOf(path),
    group: chapterGroupOf(column),
    type: column.type,
    path,
    commandCount: commandCountOf(column),
  }));
  const byCodeUnit = (a: ChapterNode, b: ChapterNode): number =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  const story = nodes.filter((n) => n.group === "story").sort(byCodeUnit);
  const ui = nodes.filter((n) => n.group === "ui").sort(byCodeUnit);

  // 目录分组：按 `chapterDirOf` 归并（**任意深度**：目录路径原样做键）
  const dirs = new Map<string, ChapterNode[]>();
  for (const node of nodes) {
    const dir = chapterDirOf(node.path);
    // 0 层平铺：路径不含 `/` ⇒ dir 为空串 ⇒ **不进目录分组**（退化为平铺列表）
    if (dir === "") continue;
    const bucket = dirs.get(dir);
    if (bucket === undefined) dirs.set(dir, [node]);
    else bucket.push(node);
  }
  const dirNodes: ChapterDir[] = [...dirs.entries()]
    .map(([path, children]) => ({
      label:
        path
          .slice(0, path.length - 1)
          .split("/")
          .pop() ?? path,
      path,
      children: [...children].sort(byCodeUnit),
    }))
    // 排序键用**完整路径**而非显示名——两个不同路径可能同名（同层不同章），
    // 用显示名排会抖动（两边都叫 chapter1 时顺序不定）
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    story,
    ui,
    // `dirs` = **全局目录清单**（不分 type；保留给「按目录浏览」这类不分组的视图）
    dirs: dirNodes,
    // 面板**按组展示** ⇒ 用分组版（否则界面组的目录会混进剧情节点）
    storyDirs: dirsOfGroup(nodes, "story"),
    uiDirs: dirsOfGroup(nodes, "ui"),
    flat: dirNodes.length === 0,
  };
}

/** 汇总文案（面板/状态栏用；**不逐条罗列**） */
export function chapterSummaryText(index: ChapterIndex): string {
  if (index.story.length === 0 && index.ui.length === 0) return "无场景";
  const parts: string[] = [];
  if (index.story.length > 0) parts.push(`${index.story.length} 个剧情`);
  if (index.ui.length > 0) parts.push(`${index.ui.length} 个界面`);
  return parts.join(" · ");
}
