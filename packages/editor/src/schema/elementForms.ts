/**
 * 06 §一.1 舞台编辑：元素属性表单描述符（**契约驱动**）。
 *
 * 元素不是 op（无 op schema），字段面直接取自引擎元素契约（单一事实源）：
 * - `ELEMENT_TYPES`（36 类型）
 * - `ELEMENT_ATTRIBUTES`（F5 通用属性全集）
 * - `ELEMENT_SPECIFIC_ATTRS`（分类型属性，供高亮）
 *
 * 产出的 `FieldDescriptor` 与 op 表单同构 → 舞台编辑可直接复用 `FieldRow`。
 * 锚点: schema-driven-forms
 */
import type { FieldDescriptor, FieldKind } from "../contracts";
import {
  ELEMENT_ATTRIBUTES,
  ELEMENT_SPECIFIC_ATTRS,
  ELEMENT_TYPES,
} from "@lingfan/engine";

/** 36 类型中文标签（新建菜单与画布角标） */
const ELEMENT_LABELS: Readonly<Record<string, string>> = {
  text: "文本",
  dialog: "对话窗",
  narrator: "旁白",
  speaker: "说话人",
  button: "按钮",
  choice: "选项",
  imagebutton: "图像按钮",
  image: "图片",
  background: "背景",
  portrait: "立绘",
  video: "视频",
  panel: "面板",
  frame: "框架",
  window: "窗口",
  dialogbox: "对话框",
  choicebox: "选项框",
  infobox: "信息框",
  overlay: "遮罩",
  popup: "浮窗",
  vbox: "纵排",
  hbox: "横排",
  grid: "网格",
  stack: "堆叠",
  stackpanel: "堆叠面板",
  canvas: "画布",
  border: "边框",
  scroll: "滚动",
  scrollviewer: "滚动视图",
  viewport: "视口",
  bar: "进度条",
  vbar: "纵向进度条",
  progressbar: "进度条",
  slider: "滑块",
  checkbox: "复选框",
  separator: "分隔线",
  spacer: "留白",
};

/** 属性 → 呈现语义（未列出者回退 `string`） */
const ELEMENT_FIELD_META: Readonly<
  Record<string, { label: string; kind: FieldKind }>
> = {
  id: { label: "元素 id", kind: "identifier" },
  name: { label: "分组名", kind: "identifier" },
  class: { label: "样式类", kind: "string" },
  style: { label: "样式类（别名）", kind: "string" },
  source: { label: "资源路径", kind: "resource" },
  src: { label: "资源路径", kind: "resource" },
  path: { label: "资源路径", kind: "resource" },
  text: { label: "文本内容", kind: "text" },
  align: { label: "对齐（别名）", kind: "string" },
  halign: { label: "水平对齐", kind: "string" },
  valign: { label: "垂直对齐", kind: "string" },
  xalign: { label: "水平锚点", kind: "string" },
  yalign: { label: "垂直锚点", kind: "string" },
  // 「数字或 CSS 长度」一律 kind:value —— 纯数字须还原为数字，运行时 len() 才补 px；
  // 退化成字符串 "120" 会被 CSS 判为非法并静默丢弃（元素停在 0,0）
  x: { label: "X（数字或 CSS 长度）", kind: "value" },
  y: { label: "Y（数字或 CSS 长度）", kind: "value" },
  xoffset: { label: "X 偏移", kind: "value" },
  yoffset: { label: "Y 偏移", kind: "value" },
  xanchor: { label: "X 锚点", kind: "string" },
  yanchor: { label: "Y 锚点", kind: "string" },
  width: { label: "宽度", kind: "value" },
  height: { label: "高度", kind: "value" },
  minWidth: { label: "最小宽度", kind: "value" },
  minHeight: { label: "最小高度", kind: "value" },
  maxWidth: { label: "最大宽度", kind: "value" },
  maxHeight: { label: "最大高度", kind: "value" },
  margin: { label: "外边距", kind: "value" },
  padding: { label: "内边距", kind: "value" },
  right: { label: "右偏移", kind: "value" },
  bottom: { label: "下偏移", kind: "value" },
  fontSize: { label: "字号", kind: "value" },
  size: { label: "字号（文本类别名）", kind: "value" },
  font: { label: "字体", kind: "string" },
  color: { label: "颜色", kind: "string" },
  fontColor: { label: "文字颜色", kind: "string" },
  textColor: { label: "文字颜色", kind: "string" },
  textAlign: { label: "文本对齐", kind: "string" },
  order: { label: "排列序", kind: "number" },
  zindex: { label: "层级", kind: "number" },
  opacity: { label: "不透明度", kind: "number" },
  visible: { label: "可见", kind: "boolean" },
  enabled: { label: "启用", kind: "boolean" },
  disabled: { label: "禁用", kind: "boolean" },
  clipToBounds: { label: "裁剪溢出", kind: "boolean" },
  cursor: { label: "光标", kind: "string" },
  rotation: { label: "旋转（度）", kind: "number" },
  scale: { label: "缩放", kind: "number" },
  scaleX: { label: "X 缩放", kind: "number" },
  scaleY: { label: "Y 缩放", kind: "number" },
  cornerRadius: { label: "圆角", kind: "value" },
  borderBrush: { label: "边框色", kind: "string" },
  borderColor: { label: "边框色", kind: "string" },
  borderThickness: { label: "边框宽度", kind: "value" },
  spacing: { label: "间距", kind: "number" },
  direction: { label: "方向（vertical/horizontal）", kind: "string" },
  columns: { label: "列（数量或 CSS 轨道）", kind: "string" },
  rows: { label: "行（数量或 CSS 轨道）", kind: "string" },
  col: { label: "Grid 列（0 基）", kind: "number" },
  row: { label: "Grid 行（0 基）", kind: "number" },
  colspan: { label: "跨列", kind: "number" },
  rowspan: { label: "跨行", kind: "number" },
  min: { label: "最小值", kind: "number" },
  max: { label: "最大值", kind: "number" },
  orientation: { label: "方向", kind: "string" },
  checked: { label: "已选中", kind: "boolean" },
  stretch: { label: "拉伸方式", kind: "string" },
  scroll_h: { label: "允许横向滚动", kind: "boolean" },
  scroll_v: { label: "允许纵向滚动", kind: "boolean" },
  nav: { label: "跳转列", kind: "identifier" },
  cmd: { label: "宿主命令", kind: "identifier" },
  value: { label: "命令参数", kind: "value" },
  hover_source: { label: "悬停资源", kind: "resource" },
  hover_color: { label: "悬停颜色", kind: "string" },
  hover_opacity: { label: "悬停不透明度", kind: "number" },
  selected_source: { label: "选中资源", kind: "resource" },
  selected_color: { label: "选中颜色", kind: "string" },
};

/** 表单字段优先序（结构 → 内容 → 布局 → 外观 → 交互），未列出的属性按契约序追加 */
const FIELD_ORDER: readonly string[] = [
  "id",
  "name",
  "text",
  "source",
  "src",
  "path",
  "x",
  "y",
  "width",
  "height",
  "zindex",
  "opacity",
  "visible",
  "color",
  "fontSize",
  "font",
  "size",
  "halign",
  "valign",
  "align",
  "textAlign",
  "rotation",
  "scale",
  "scaleX",
  "scaleY",
  "margin",
  "padding",
  "xoffset",
  "yoffset",
  "xanchor",
  "yanchor",
  "right",
  "bottom",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "cornerRadius",
  "borderColor",
  "borderThickness",
  "direction",
  "spacing",
  "columns",
  "rows",
  "col",
  "row",
  "colspan",
  "rowspan",
  "min",
  "max",
  "orientation",
  "checked",
  "stretch",
  "scroll_h",
  "scroll_v",
  "nav",
  "cmd",
  "value",
  "hover_source",
  "hover_color",
  "hover_opacity",
  "selected_source",
  "selected_color",
  "disabled",
  "enabled",
  "clipToBounds",
  "cursor",
  "class",
  "style",
  "order",
];

export interface ElementFormDescriptor {
  type: string;
  label: string;
  fields: FieldDescriptor[];
}

/** 元素类型判定 + 表单描述符（未知类型 = undefined，调用方 fail-closed） */
export function describeElement(
  type: string,
): ElementFormDescriptor | undefined {
  if (!(ELEMENT_TYPES as readonly string[]).includes(type)) return undefined;
  const allowed = new Set<string>([...ELEMENT_ATTRIBUTES, "id", "name"]);
  const ordered = [
    ...FIELD_ORDER.filter((key) => allowed.has(key)),
    ...[...ELEMENT_ATTRIBUTES].filter((key) => !FIELD_ORDER.includes(key)),
  ];
  return {
    type,
    label: ELEMENT_LABELS[type] ?? type,
    fields: ordered.map((key) => ({
      key,
      label: ELEMENT_FIELD_META[key]?.label ?? key,
      kind: ELEMENT_FIELD_META[key]?.kind ?? "string",
      // 元素属性一律可选（`type` 是结构字段，不在表单里编辑）
      required: false,
      hasDefault: false,
    })),
  };
}

/** 36 类型（新建元素菜单） */
export function listElementTypes(): readonly string[] {
  return ELEMENT_TYPES;
}

/** 类型中文标签 */
export function elementLabel(type: string): string {
  return ELEMENT_LABELS[type] ?? type;
}

/** 该类型的专属属性（表单高亮用；通用属性表已含并集） */
export function specificAttrsOf(type: string): readonly string[] {
  return ELEMENT_SPECIFIC_ATTRS[type] ?? [];
}
