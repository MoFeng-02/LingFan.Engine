/**
 * 元素系统契约（元素声明 / 舞台层叠）。
 *
 * 类型与属性全集：
 * - 36 类型全集（文本 / 交互 / 图像 / 容器 / 滚动 / 进度 / 间隔七组）
 * - 属性全集 = 通用属性表与元素特定属性的合并
 *
 * 未知类型 / 未知属性一律 fail-closed——「写了也不渲染」的静默容忍是缺陷，不是特性。
 *
 * 元素寻址显式化为契约字段：`id`（唯一，精确寻址）与 `name`（可重复，批量寻址），
 * 不使用隐式魔法键。
 */

/**
 * 元素动作序列（`ops`）中**不可用**的 op：等待类、位置类、存档类。
 *
 * 理由：`ops` 是「点击时按序执行一串 op」，跑在**当前叙事流的等待画面上**——
 * 这些 op 会打断或替换该流程（进入新等待 / 换列 / 改动存档坐标），与「点一下做点事、
 * 然后继续」的语义冲突。执行期整次拒绝（`element-ops-blocked-op`，状态原样）。
 *
 * 跳列请用元素的 `nav` 属性（那条路走核心 `navigate`，语义明确）。
 * 单一事实源：引擎执行期与编辑器编辑期诊断共用本清单。
 */
export const ELEMENT_OPS_BLOCKED: ReadonlySet<string> = new Set([
  // 等待类（进入新等待，替换当前流程）
  "say",
  "menu",
  "input",
  "wait",
  "pause",
  "nvl",
  "cutscene",
  "minigame",
  // 位置类（替换命令流 / 改变叙事坐标）
  "jump",
  "navigate",
  "call",
  "return",
  // 存档类（存档坐标必须是玩家所见的等待点，点击不是）
  "save",
  "load",
  "auto_save",
  "save_delete",
]);

/**
 * 舞台元素类型全集（36）。
 * 分组：文本 / 交互 / 图像 / 容器 / 滚动 / 进度 / 间隔七组。
 */
export const ELEMENT_TYPES = [
  // 文本
  "text",
  "dialog",
  "narrator",
  "speaker",
  // 交互
  "button",
  "choice",
  "imagebutton",
  // 图像
  "image",
  "background",
  "portrait",
  "video",
  // 容器
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
  // 滚动
  "scroll",
  "scrollviewer",
  "viewport",
  // 进度 / 滑块 / 选择
  "bar",
  "vbar",
  "progressbar",
  "slider",
  "checkbox",
  // 间隔
  "separator",
  "spacer",
] as const;

/** 元素类型名（从 `ELEMENT_TYPES` 派生，是元素表与校验白名单的共同键） */
export type ElementType = (typeof ELEMENT_TYPES)[number];

/**
 * 媒体填充方式：媒体内容在元素的框内怎么摆放（属性 `stretch` 的值域）。
 *
 * - `fill`：拉伸填满，不保比例——纯色底、渐变、可拉伸的边框图；
 * - `contain`：等比装下留边——立绘、道具图这类不能被裁的内容；
 * - `cover`：等比铺满、裁掉溢出——背景图最常见的意图；
 * - `none`：原始尺寸居中，超出裁掉——像素画与图标；
 * - `scale-down`：`none` 与 `contain` 取更小者——「图小于框就别放大」。
 *
 * 为什么不直接存 CSS 字符串：小程序没有 `object-fit`（只有 `<image>` 的 `mode`），
 * 未来的 AOT 渲染要按词算绘制矩形，两者都需要一个中立词表各自映射；
 * CSS 字符串则只能靠类型约束、没法在运行期枚举与校验。
 *
 * 缺省取 `cover`：叙事背景铺不满会露底色，观感断裂比裁边严重得多；
 * 立绘类元素不依赖缺省——它们的框本来就按图的比例设。
 */
export type ElementFit = "fill" | "contain" | "cover" | "none" | "scale-down";

/** 填充方式全集（属性校验与编辑器下拉的共同词表，顺序即呈现顺序） */
export const ELEMENT_FITS: readonly ElementFit[] = [
  "fill",
  "contain",
  "cover",
  "none",
  "scale-down",
];

/** 未声明 `stretch` 时的填充方式（见 `ElementFit` 的缺省理由） */
export const DEFAULT_ELEMENT_FIT: ElementFit = "cover";

/** 结构字段（非属性）：type 必填，id/name 为寻址标识，children 为容器嵌套 */
export const ELEMENT_STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "id",
  "name",
  "children",
]);

/**
 * 属性全集 = 通用属性表与元素特定属性的合并（合并结果即校验白名单）。
 * 分组注释保留来源信息（编辑器表单按 `ELEMENT_SPECIFIC_ATTRS` 分类型提示）。
 */
export const ELEMENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  // 内容 / 样式
  "class",
  "style",
  "source",
  "src",
  "path",
  "text",
  // 对齐
  "align",
  "halign",
  "valign",
  "xalign",
  "yalign",
  // 尺寸 / 位置
  "width",
  "height",
  "fontSize",
  "font",
  "order",
  "size",
  "x",
  "y",
  "xoffset",
  "yoffset",
  "xanchor",
  "yanchor",
  "margin",
  "padding",
  "right",
  "bottom",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "min",
  "max",
  "orientation",
  "checked",
  // 颜色 / 字体
  "color",
  "fontColor",
  "textColor",
  // 交互（点击优先级：disabled > nav > ops > cmd；视觉态 hover_* / selected_* / disabled_* 与点击正交）
  "disabled",
  "nav",
  "ops",
  "cmd",
  "value",
  "hover_source",
  "hover_color",
  "hover_opacity",
  "selected_source",
  "selected_color",
  "disabled_source",
  "disabled_color",
  "disabled_opacity",
  // Grid 附着
  "col",
  "row",
  "colspan",
  "rowspan",
  // 外观
  "opacity",
  "visible",
  "enabled",
  "zindex",
  "clipToBounds",
  "cursor",
  // 变换
  "rotation",
  "scale",
  "scaleX",
  "scaleY",
  // 边框
  "cornerRadius",
  "borderBrush",
  "borderColor",
  "borderThickness",
  // 容器
  "spacing",
  "direction",
  "columns",
  "rows",
  // 文本
  "textAlign",
  // 图片
  "stretch",
  // 滚动
  "scroll_h",
  "scroll_v",
]);

/**
 * 分类型属性：供编辑器表单按类型提示，
 * 校验仍走 `ELEMENT_ATTRIBUTES` 并集（宽松归属判定）。
 */
export const ELEMENT_SPECIFIC_ATTRS: Readonly<
  Record<string, readonly string[]>
> = {
  text: ["size"],
  dialog: ["size"],
  narrator: ["size"],
  speaker: ["size"],
  grid: ["columns", "rows"],
  panel: ["direction", "spacing"],
  vbox: ["direction", "spacing"],
  hbox: ["direction", "spacing"],
  frame: ["direction", "spacing"],
  window: ["direction", "spacing"],
  dialogbox: ["direction", "spacing"],
  choicebox: ["direction", "spacing"],
  infobox: ["direction", "spacing"],
  overlay: ["direction", "spacing"],
  popup: ["direction", "spacing"],
  stack: ["direction", "spacing"],
  stackpanel: ["direction", "spacing"],
  image: ["stretch"],
  imagebutton: [
    "stretch",
    "hover_source",
    "selected_source",
    "disabled_source",
  ],
  portrait: ["stretch"],
  // 背景元素的框就是舞台（宽高由引擎写成 100%），填充方式决定图怎么铺满这个框：
  // `cover` 裁边、`contain` 留边、`fill` 拉伸，与图像元素同一份词表
  background: ["stretch"],
  // 视频元素在描述树里只是占位节点，真实 `<video>` 由视频端口直挂——
  // 属性照常写在元素上，由组合根读出来喂给端口的 `fit` 闭包
  video: ["stretch"],
  slider: ["min", "max", "orientation"],
  progressbar: ["min", "max"],
  bar: ["min", "max"],
  vbar: ["min", "max"],
  checkbox: ["checked"],
  scroll: ["scroll_h", "scroll_v"],
  scrollviewer: ["scroll_h", "scroll_v"],
  viewport: ["scroll_h", "scroll_v"],
};

/**
 * 舞台元素声明节点（scene 列 `elements[]` 的元素）。
 * JSON 形态为平铺（
 * `{ "type": "image", "source": "Images/bg.png", "x": "0" }`），属性与 type 同级。
 */
export interface ElementNode {
  type: string;
  /** 唯一标识（同列内重复 = fail-closed）；show/hide/animate 的首选目标 */
  id?: string;
  /** 可重复的分组标识（批量寻址：一次操作一组元素） */
  name?: string;
  /** 容器专有：子元素（投影为缩进子元素行） */
  children?: ElementNode[];
  /** 其余键 = 属性全集（校验白名单） */
  [attr: string]: unknown;
}

/**
 * 运行期元素实例：装载进 `SYS.elements`，随快照 / 存档 / 回溯自动随行
 * （整体 state Map 快照，无需重放重建）。
 */
export interface ElementInstance {
  /** 稳定标识：显式 id > 派生 `{列id}#{序号}`（派生值仅供内部兜底，不作为稳定契约） */
  id: string;
  type: string;
  /** 分组标识（可重复；未声明则不出现） */
  name?: string;
  /** ELEMENT_ATTRIBUTES 内的属性副本（不含 type/id/name/children） */
  props: Record<string, unknown>;
  /** 舞台内叠放序：显式 `zindex` > 到达序（声明顺序 + 动态追加序） */
  z: number;
  children: ElementInstance[];
}

/**
 * 容器类型：支持 `children` 嵌套。
 * 统一口径为「容器 = 支持 children」，取 vbox/hbox 等可嵌套类型的并集。
 */
export const ELEMENT_CONTAINER_TYPES: ReadonlySet<string> = new Set([
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
  "scroll",
  "scrollviewer",
  "viewport",
]);

/**
 * 元素动画描述（`animate` / `animate_block` 写入 `SYS.animations`）。
 *
 * 分工：核心层只写「动画描述」（离散、进快照），**UI 每帧插值**应用到 DOM
 * （帧驱动；高频帧级值不进 SSOT/事件流），播毕调 `animationFinished(seq)`
 * 由核心把终值写回元素 `props`——保证快照/存档/回溯都是**终态**语义。
 *
 * 用**队列 + 完成回调**表达动画，避免为每个动画属性铺一串状态键。
 */
export interface AnimationSpec {
  /** 动画归属元素 id（写入时由 `target` 寻址解析并**固化**，避免回溯后寻址漂移） */
  target: string;
  /** 动效属性名（元素属性全集内的数值属性） */
  property: string;
  from: number;
  to: number;
  /** 时长（秒） */
  duration: number;
  /** 缓动名（默认 `EaseOutQuad`；UI 侧映射到实际缓动函数） */
  easing: string;
  /** 单调序号：同一目标的连续动画、重放后的同命令可分辨（参考 `__video` 的 seq 去重语义） */
  seq: number;
}
