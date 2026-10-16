/**
 * 覆盖层表面端口：中立面只描述「每一层要显示什么」，落到哪个渲染体系由宿主决定。
 *
 * **解决的问题**：覆盖层的五层（舞台 / 元素 / 转场 / 对话 / 选择 / 通知 / 接管）原先直接由
 * 展示层建 `HTMLElement` 并写 `style` / `innerHTML`，于是「叙事能力嵌进已有游戏」这条路上，
 * 任何非 Web 宿主都得自己重写一份渲染接线。
 *
 * **为什么不是元素层那种描述树**：元素层每帧整棵重建即可（`RenderSpec` 无状态、可序列化）；
 * 覆盖层不是——对话层有打字机**逐帧改同一处文本**的高频写，通知层有**生命周期**（到时移除），
 * 输入形态有**焦点与光标**（整层重建会丢正在输入的字）。因此这里传的是**每层的视图模型**
 * （纯数据）+ 一次整层提交：模型怎么算归中立核心，怎么落到节点/组件/`setData` 归宿主。
 *
 * **契约边界**：本文件不得出现任何平台类型（`HTMLElement` / `document` / `window` …）。
 * DOM 实现见 `packages/ui/src/dom/overlay-surface.ts`（`createDomOverlaySurface`）。
 */
import type { RenderPort } from "../element/spec";
import type { FrameSource } from "../host/frame-loop";

/** 覆盖层的层位（中立词表；与 DOM 无关，宿主按自己的层级体系落地） */
export type OverlayLayerId =
  | "stage"
  | "element"
  | "transition"
  | "dialogue"
  | "choices"
  | "takeover"
  | "notifications";

/**
 * 对话层的一次整层提交。
 *
 * 骨架固定为「说话人 / 正文 / 推进提示」三段，皮肤由 `rootClass` 与三个 HTML 片段表达；
 * `visible` 为假时**隐藏而非清空**（恢复时不闪）——隐藏与清空是两种语义，故显式入模型。
 */
export interface DialogueLayerView {
  /** 皮肤类名（模板产出；DOM 侧拼在基类之后） */
  rootClass: string;
  /** 本层是否可见（假 = 让位给菜单/输入/视频层） */
  visible: boolean;
  /** 说话人片段 HTML（空串 = 本句无说话人） */
  speakerHtml: string;
  /** 说话人配色（空串 = 用皮肤默认） */
  speakerColor: string;
  /** 正文片段 HTML（打字中 = 可见前缀） */
  bodyHtml: string;
  /** 正文整句字体族（已过白名单校验；空串 = 不设，回落宿主 CSS/浏览器默认） */
  bodyFont: string;
  /** 推进提示片段 HTML（空串 = 本句无提示） */
  hintHtml: string;
}

/** 选择层的一个选项（`html` 是呈现片段，`label` 是可访问名，`target` 是回核心的列 id） */
export interface ChoicesLayerOption {
  html: string;
  label: string;
  target: string;
}

/** 选择层的输入形态参数（表单提交回核心） */
export interface ChoicesLayerInput {
  /** 输入提示（同时作为输入框的可访问名；空串 = 用宿主文案「输入」） */
  prompt: string;
  /** 提交按钮显示文本 */
  submitText: string;
}

/**
 * 选择层的一次整层提交（菜单与输入两形态互斥，用哪个由哪个字段非空表达）。
 *
 * 层内不存在需要保留的局部状态（原文如此），因此每次重渲都整体重建；
 * 点击与提交不是模型的一部分——它们是端口上的两条回调（见 `OverlaySurface`）。
 */
export interface ChoicesLayerView {
  /** 皮肤类名（菜单形态的模板产出；输入形态为空串） */
  rootClass: string;
  /** 菜单提示片段 HTML（空串 = 无提示） */
  promptHtml: string;
  /** 菜单选项（顺序即呈现顺序；输入形态为空数组） */
  options: readonly ChoicesLayerOption[];
  /** 输入形态参数（菜单形态为 `null`） */
  input: ChoicesLayerInput | null;
}

/** 通知层的一条 toast（停留时长不在这里——它由端口调用的参数给出的毫秒数决定） */
export interface NotifyLayerItem {
  /** 语气类名（模板产出） */
  rootClass: string;
  /** 正文片段 HTML */
  bodyHtml: string;
}

/**
 * 覆盖层表面端口：宿主实现它，把每层模型落到自己的渲染体系。
 *
 * 两个 `RenderPort`（舞台 / 元素）复用元素层的描述树词表；其余层各有自己的整层提交方法。
 * 时钟与定时器不进中立面：帧能力经 `frame` 注入，通知的到时移除归宿主实现。
 */
export interface OverlaySurface {
  /** 帧源（宿主平台的「下一帧」能力；无帧环境返回一个永不回调的帧源） */
  readonly frame: FrameSource;
  /** 舞台层：背景 / 立绘（宿主也可自行往这里提描述树） */
  readonly stage: RenderPort;
  /** 元素层：元素树渲染目标 */
  readonly elements: RenderPort;
  /** 层级 z 下发（幂等，可反复调用；未显式指定的层走宿主默认） */
  setLayerZ(layer: OverlayLayerId, z: number): void;
  /** 提交对话层（整层重建） */
  setDialogue(view: DialogueLayerView): void;
  /** 提交选择层；`null` = 整层隐藏（菜单/输入都结束） */
  setChoices(view: ChoicesLayerView | null): void;
  /** 上屏一条通知，`durationMs` 毫秒后由宿主移除 */
  pushNotification(item: NotifyLayerItem, durationMs: number): void;
  /**
   * 卸载收尾：清空全部层与在排定时器。
   *
   * 注意**接管层与转场遮罩不在这里**：它们是宿主自己的层（外部玩法系统 / 转场动画），
   * 中立核心从不驱动它们（引擎只把它们的 z 交下来）。Web 宿主用 DOM 实现暴露的 `nodes`
   * 或 `stage` 端口自行落地；非 Web 宿主用自己的渲染体系，不需要本端口提供方法。
   */
  clear(): void;
  /** 选择出口（装配器在构造时挂上；点是玩家的动作，不是模型的一部分） */
  onChoose?: (target: string) => void;
  /** 输入提交出口（装配器在构造时挂上） */
  onSubmitInput?: (value: string) => void;
}
