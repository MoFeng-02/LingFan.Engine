/**
 * 侧栏内页。
 *
 * `chapters` 与 `columns` **必须带 `hint`**：两者都是"工程里的列"，
 * 名称不足以区分两者的口径差异。
 * `hint` 作为 tab 的 `title` 悬停可读，**一句话说清口径差异**。
 */
export type LeftTab =
  "resources" | "search" | "recent" | "chapters" | "columns" | "palette";

export const LEFT_TABS: readonly {
  id: LeftTab;
  label: string;
  hint?: string;
}[] = [
  {
    id: "resources",
    label: "资源",
    hint: "按文件种类浏览资源根（Resources/）",
  },
  {
    id: "search",
    label: "搜索",
    hint: "按**内容**搜索全部资源（先于名称匹配，它更精确）",
  },
  { id: "recent", label: "最近", hint: "最近改动过的资源" },
  {
    id: "chapters",
    label: "章节",
    hint: "章节树：按文件路径分章（Stories/chapter1/… ⇒ 章节 chapter1），结构由工程编排决定",
  },
  {
    id: "columns",
    label: "列",
    hint: "列列表：按作者手动分组排列（可自定义分组名与成员），与目录结构无关",
  },
  {
    id: "palette",
    label: "组件",
    hint: "插入元素：按类型挑模板（落到当前选中命令）",
  },
];
