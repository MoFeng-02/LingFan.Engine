/**
 * 06 §一.1 组件面板（T04-02）：**元素 36 类型**与**命令 op**的归类源，为 T04-03（拖入画布）提供拖拽源。
 *
 * 两条纪律：
 * 1. **分组不新增事实**——元素分组是 `ELEMENT_TYPES` 既有顺序（文本/交互/图像/容器/滚动/进度/间隔，
 *    与老引擎 `DslKeywords.UiElementTypes` 一致）的显式化；互锁测试断言「按组序拍平 == ELEMENT_TYPES」
 *    ⇒ 契约加类型而此处不同步会立刻变红（不越界、不缺项）。
 * 2. **op 分组标签单一事实源**——此前硬编码在 `StoryTimeline.vue` 的菜单里；本模块导出后时间线与
 *    组件面板共用，避免第二份中文标签表漂移。
 *
 * 锚点: editor-component-palette
 */

import type { OpGroup } from "../contracts";
import { listOps } from "./forms";
import { BUILTIN_OP_SURFACE, type OpSurface } from "./surface";

/** 元素类型分组（顺序即 `ELEMENT_TYPES` 顺序；标签供面板展示） */
export interface ElementTypeGroup {
  group: string;
  label: string;
  types: readonly string[];
}

/**
 * 七组（对齐 `contracts/element.ts` 的分组注释与规约 09 §二）。
 * `types` 显式列出而非按索引切分——可读性优先；一致性由互锁测试锁定。
 */
export const ELEMENT_TYPE_GROUPS: readonly ElementTypeGroup[] = [
  { group: "text", label: "文本", types: ["text", "dialog", "narrator", "speaker"] },
  { group: "interaction", label: "交互", types: ["button", "choice", "imagebutton"] },
  { group: "media", label: "图像", types: ["image", "background", "portrait", "video"] },
  {
    group: "container",
    label: "容器",
    types: [
      "panel",
      "frame",
      "window",
      "dialogbox",
      "choicebox",
      "infobox",
      "overlay",
      "popup",
      "vbox",
      "hbox",
      "grid",
      "stack",
      "stackpanel",
      "canvas",
      "border",
    ],
  },
  { group: "scroll", label: "滚动", types: ["scroll", "scrollviewer", "viewport"] },
  {
    group: "progress",
    label: "进度",
    types: ["bar", "vbar", "progressbar", "slider", "checkbox"],
  },
  { group: "spacing", label: "间隔", types: ["separator", "spacer"] },
];

/** op 分组顺序（与时间线插入菜单一致） */
export const OP_GROUP_ORDER: readonly OpGroup[] = [
  "narrative",
  "presentation",
  "flow",
  "variables",
  "save",
  "audio",
  "video",
  "minigame",
];

/** op 分组中文标签（单一事实源） */
export const OP_GROUP_LABELS: Readonly<Record<OpGroup, string>> = {
  narrative: "叙事",
  presentation: "表现",
  flow: "流程",
  variables: "变量",
  save: "存档",
  audio: "音频",
  video: "视频",
  minigame: "小游戏",
};

export interface OpGroupEntries {
  group: OpGroup;
  label: string;
  ops: { op: string; label: string }[];
}

/**
 * op 按分组归类（时间线插入菜单与组件面板共用）。
 * `OP_GROUP_ORDER` 是**显式顺序**（不依赖 `OP_META` 的书写次序）；组内保持 `OP_META` 序。
 * `surface`（T08-04，可选）= op 合并面（缺省内建；扩展注册后由组合根传入）。
 */
export function listOpGroups(
  surface: OpSurface = BUILTIN_OP_SURFACE,
): readonly OpGroupEntries[] {
  const meta = listOps(surface);
  return OP_GROUP_ORDER.map((group) => ({
    group,
    label: OP_GROUP_LABELS[group],
    ops: meta
      .filter((entry) => entry.group === group)
      .map((entry) => ({ op: entry.op, label: entry.label })),
  }));
}