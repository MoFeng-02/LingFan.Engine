/**
 * 故事章节树 · **纯判据**（可测，无 IO / 无 Vue）。
 *
 * 存在理由：左栏原按「资源种类」平铺，但工程实践揭示了**另一个骨架**——
 * `Stories/` 与 `Lang/` 常**按章节分目录**
 * （`chapter1/chapter1.story`、`Lang/en-US/chapter1/chapter1.json`），
 * 且 `Lang/` 有**三种布局并存**（en 平铺 / en-US 子目录分类 / ja 单文件）。
 * ⇒ **内容骨架是「章节」，不是文件**；文件怎么摆是**作者的自由**。
 *
 * **任意深度递归，不写死「一级 = 章节」**：常见工程恰好只到 1 层
 * （`Stories/chapter1/chapter1.story`），也有 0 层平铺
 * （`Stories/start.json`）；而 `Lang/en-US/system/about.json` 已到 2 层
 * ⇒ 按层数写死会错。
 * 0 层平铺工程退化为「无章节分组的全平铺列表」，**不报错**。
 */

import { isReplayableColumn, type StoryColumn } from "@lingfan/engine";

/** 章节树分组：剧情（可回溯）/ 界面（不参与历史与存档） */
export type ChapterGroup = "story" | "ui";

/** 一个章节（= 一个故事场景；**章节名取自所在目录链，不取自文件名**） */
export interface ChapterNode {
  /** 章节标识（= 列 id，全局唯一） */
  readonly id: string;
  /** 章节显示名（取自路径末级目录；0 层平铺时取文件名去后缀） */
  readonly label: string;
  /** 该章节的场景所属分组（由 `type` 决定，**不按目录猜**） */
  readonly group: ChapterGroup;
  /**
   * 原始场景类型（列的 `type` 字段原样透传；`undefined` = 缺省 game）。
   * 分组判定只吃 `group`；要**精确到 菜单/界面** 的展示走 `sceneTypeBadgeOf(node.type)`
   * （`group=ui` 只说明「不可回溯」，不说明是哪一种）。
   */
  readonly type: StoryColumn["type"];
  /** 章节在文件树中的位置（逻辑路径，用于联动资源树选中） */
  readonly path: string;
  /** 章节内命令条数（展示用；0 = 未知） */
  readonly commandCount: number;
}

/** 目录分组（**任意深度**：目录即章节组，叶子才是故事） */
export interface ChapterDir {
  /** 目录名（单层展示名；完整路径在 `path`） */
  readonly label: string;
  /** 目录逻辑路径（末尾带 `/`） */
  readonly path: string;
  readonly children: readonly ChapterNode[];
}

/** 故事文件的容器根（剥掉它，剩下的目录链才是「作者的章节编排」） */
const STORIES_ROOT = "Stories/";

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
  const dirName = dir.slice(0, dir.length - 1).split("/").pop() ?? "";
  // 目录名与文件名同前缀时（如 chapter1/chapter1.story）**取目录名**——
  // 目录才是「章节」，文件名只是文件。
  return dirName !== "" ? dirName : name;
}

/** 章节所属分组（**单一判定点**：直接用引擎的 `isReplayableColumn`，不另写一份） */
export function chapterGroupOf(column: Pick<StoryColumn, "type">): ChapterGroup {
  return isReplayableColumn(column) ? "story" : "ui";
}

/**
 * 场景类型的**徽标文案**（单一事实源：列侧栏 / 章节树共用，组件不得自写映射）。
 *
 * - `"menu"` → 「菜单」；`"ui"` → 「界面」
 * - 缺省（`undefined`）与 `"game"` → `null`（**game 是常态不标**——满屏「剧情」徽标是噪音）
 */
export function sceneTypeBadgeOf(
  type: StoryColumn["type"],
): "菜单" | "界面" | null {
  if (type === "menu") return "菜单";
  if (type === "ui") return "界面";
  return null;
}

/** 命令条数（flow 看 commands、scene 看 entry；缺省 0） */
function commandCountOf(column: StoryColumn): number {
  if (column.kind === "scene") return (column.entry ?? []).length;
  return (column.commands ?? []).length;
}

/** 组装入参：路径 + 列（两者按 `id` 关联） */
export interface ChapterInput {
  /** 故事文件的逻辑路径（如 `Stories/chapter1/chapter1.story`） */
  readonly path: string;
  readonly column: StoryColumn;
}

export interface ChapterIndex {
  /** 剧情组（可回溯）——排序：路径码元序（确定性） */
  readonly story: readonly ChapterNode[];
  /** 界面组（menu/ui） */
  readonly ui: readonly ChapterNode[];
  /** 目录分组（**只含子目录**；0 层平铺工程为空数组） */
  readonly dirs: readonly ChapterDir[];
  /**
   * **按组过滤的目录**（剧情组）。
   *
   * 为何要拆：目录是**作者的编排**，`type` 是**运行语义**——两者**正交**，
   * 一个目录里可能既有剧情又有界面（如 `system/` 里放 `about`(menu) + `sandbox`(game)）。
   * 而面板先按 type 分组展示（剧情 / 界面），故目录要**跟着组走**：
   * 若直接用全局 `dirs`，界面组的目录里会混进剧情节点。
   */
  readonly storyDirs: readonly ChapterDir[];
  /** 按组过滤的目录（界面组） */
  readonly uiDirs: readonly ChapterDir[];
  /** 是否为**平铺工程**（无任何子目录分组）—— UI 据此决定要不要显示「章节」标题 */
  readonly flat: boolean;
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
      label: path.slice(0, path.length - 1).split("/").pop() ?? path,
      path,
      children: [...children].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
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
export function buildChapterIndex(inputs: readonly ChapterInput[]): ChapterIndex {
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
      label: path.slice(0, path.length - 1).split("/").pop() ?? path,
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
