/**
 * 01-故事格式契约（渐进子集）+ 07 工程清单。
 * op 全集按规约 01 §二渐进补齐；契约只增不改（宪法 §3.1）。
 */

/** 命令：已知 op 的负载由解析器/执行器窄化校验，未知字段/未知 op fail-closed（02-E3） */
export interface StoryCommand {
  op: string;
  [field: string]: unknown;
}

/** 01 §一.3 两类列：scene（空间层）与 flow（纯流程） */
export interface StoryColumn {
  id: string;
  kind: "scene" | "flow";
  /** scene 专有：元素命令数组（元素系统按规约 01 §二.2 延后实现） */
  elements?: StoryCommand[];
  /** scene 专有：入口命令，元素后按序执行 */
  entry?: StoryCommand[];
  /** flow 专有：纯流程命令 */
  commands?: StoryCommand[];
}

/** 01 §一.1 故事 = 列的集合（多文件组装后的运行时形态）；formatVersion 自 v1 起版本化 */
export interface Story {
  formatVersion: 1;
  id: string;
  /** 01 §一.7 入口列：project.json entry 字段；单文件故事默认首列 */
  entry: string;
  columns: StoryColumn[];
  /** 01 §一.6 顶层结构化定义：无条件 Set，后加载覆盖先加载 */
  defines?: Record<string, unknown>;
}

/** 07 §三 工程清单（project.json）：结构化/原子化多文件工程的组装契约 */
export interface ProjectManifest {
  formatVersion: 1;
  id: string;
  /** 入口列（01 §一.7：story.start 导航至入口列） */
  entry: string;
  /** 工程显示名（可选） */
  name?: string;
  /** 默认语言（01 §四 I18N 三层） */
  lang?: string;
  /** 工程级 defines：无条件 Set，先于故事文件应用（后加载覆盖） */
  defines?: Record<string, unknown>;
}

/** 01 §一.4 坐标：故事流唯一位置 `(columnId, index)` */
export interface ColumnCoordinate {
  columnId: string;
  index: number;
}
