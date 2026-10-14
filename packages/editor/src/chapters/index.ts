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
 *
 * 域出口：本文件只保留类型声明与转发；判据与装配实现见 `./build`。
 */

import type { StoryColumn } from "@lingfan/engine";

export {
  buildChapterIndex,
  chapterDirOf,
  chapterGroupOf,
  chapterLabelOf,
  chapterSummaryText,
  sceneTypeBadgeOf,
} from "./build";

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
