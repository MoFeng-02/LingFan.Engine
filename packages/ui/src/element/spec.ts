/**
 * 渲染描述树（平台中立）：渲染器不建节点，只产出这棵树；由宿主注入的渲染端口
 * 物化成自己的节点模型（Web 侧实现见 `packages/ui/src/dom`）。
 *
 * 中立判据：本文件不出现 DOM 类型、DOM 全局与 DOM 标签名——节点种类用 `RenderKind`
 * 词表。`slider` / `checkbox` 不与 `input` 合并成「`input` + type 字段」：
 * `range` / `checkbox` 是 DOM 的 type 词表，留在描述树里等于把 DOM 词汇漏进中立面。
 */

/** 节点种类：物化器负责映射到自己平台的标签/组件 */
export type RenderKind =
  | "box"
  | "text"
  | "image"
  | "media"
  | "input"
  | "slider"
  | "checkbox"
  | "action";

/** 写入节点的原生属性值（属性名沿用各民族平台的通用拼写：`src` / `alt` / `disabled` …） */
export type RenderPropValue = string | number | boolean;

/**
 * 事件触发时对目标节点应用的改动。
 *
 * 视觉态交换（hover 进入/离开、点击切换选中）都走这条通道：
 * 渲染器不需要拿到节点，就能表达「触发时改哪些样式/属性」。
 */
export interface RenderEventPatch {
  style?: Readonly<Record<string, string>>;
  props?: Readonly<Record<string, RenderPropValue>>;
}

/**
 * 事件名：前三个是交互态（进出/点击），后两个带值（表单类控件用）。
 *
 * `input` 是「值在变」（连续），`change` 是「值已定」（一次）——滑块拖动时前者每帧都来，
 * 后者只在松手/提交时来，写回状态一律走 `change`，避免每帧刷引擎。
 */
export type RenderEventName =
  "click" | "mouseenter" | "mouseleave" | "input" | "change";

/**
 * 事件绑定；`handler` 的返回值即触发时要应用的补丁（无返回值 = 不改节点）。
 *
 * `handler` 的可选参数是事件载荷：只有 `input` / `change` 会带（控件当前值），
 * 其余事件一律 `undefined`。既有 handler 不接参数，多一个可选参数对它们零影响。
 */
export interface RenderEvent {
  on: RenderEventName;
  handler?: (value?: RenderPropValue) => RenderEventPatch | void;
  /** 阻止冒泡（元素点击不应同时触发舞台推进） */
  stopPropagation?: boolean;
}

/**
 * 一棵节点的描述。字段与物化顺序一致：类名 → 样式 → 文本/富文本 → 属性 → 定位锚 →
 * 子节点 → 事件。
 *
 * `html` 沿用「调用方负责转义」的既有约定（见对话文本视图），本树不做二次净化。
 */
export interface RenderSpec {
  kind: RenderKind;
  /** 类名（物化器原样写入；元素渲染器在此放基类 + 类型类 + 作者 class） */
  className?: string;
  /** CSS 声明（camelCase 键，与元素的属性 → CSS 映射同源） */
  style?: Readonly<Record<string, string>>;
  /** 纯文本内容 */
  text?: string;
  /** 富文本内容（调用方负责转义） */
  html?: string;
  props?: Readonly<Record<string, RenderPropValue>>;
  children?: readonly RenderSpec[];
  events?: readonly RenderEvent[];
  /** 定位锚（动画按元素 id 找节点；无锚点概念的宿主可忽略） */
  id?: string;
}

/**
 * 渲染端口（宿主注入）：一对动作——清空渲染根、物化一棵描述树挂上去。
 *
 * 「整体重建」是元素渲染的既有语义（每帧全量给元素，不做增量对比），
 * 因此端口只需这两条原语即可覆盖现状；增量更新由宿主内部决定。
 */
export interface RenderPort {
  /** 清空渲染根下的全部节点 */
  clear(): void;
  /** 物化一棵描述树并挂到渲染根下 */
  mount(spec: RenderSpec): void;
}
