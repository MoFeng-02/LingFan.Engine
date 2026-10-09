/**
 * 叙事覆盖层的对外契约：挂载点、渲染投影、装配选项与实例方法。
 *
 * 这些类型是宿主与覆盖层之间的边界——实现可以按职责拆开，边界形状不动；
 * 宿主只依赖这里声明的名字，不依赖覆盖层内部的模块划分。
 */
import type {
  ElementInstance,
  LayerZTable,
  StoryEngine,
} from "@lingfan/engine";
import type { ChoiceTemplateRegistry } from "../choices/templates";
import type { DialogueTemplateRegistry } from "../dialogue/templates";
import type { ElementRegistry } from "../element/registry";
import type { NotifyTemplateRegistry } from "../notify/templates";

/** 覆盖层挂载点（`RenderTargets` 的宿主侧落地形态） */
export interface NarrativeMounts {
  /** 覆盖层根 */
  root: HTMLElement;
  /** 舞台层：背景 / 立绘 */
  stage: HTMLElement;
  /** 元素层：舞台之上的空间层（元素树渲染目标） */
  elementLayer: HTMLElement;
  /** 对话层（含打字机） */
  dialogue: HTMLElement;
  /** 选择层（菜单 / 输入） */
  choices: HTMLElement;
  /** 通知层（toast） */
  overlay: HTMLElement;
  /** 外部系统接管层（小游戏 / 玩法系统） */
  takeover: HTMLElement;
  /** 全屏转场遮罩 */
  transition: HTMLElement;
}

/** 渲染投影（只读快照；宿主诊断与自定义渲染可读） */
export interface NarrativeOverlayView {
  speaker: string;
  text: string;
  /** 当前正文 HTML（打字中 = 可见前缀） */
  lineHtml: string;
  canAdvance: boolean;
  /** 当前等待态（`none` = 无等待） */
  waiting: string;
  menuPrompt: string;
  /** 选项（文本 + 目标列，顺序即呈现顺序） */
  menuOptions: readonly { text: string; target: string }[];
  inputPrompt: string;
  nvlMode: string;
  nvlLines: readonly string[];
  /** 元素树是否非空（宿主可据此决定是否显示自己的背景层） */
  hasElements: boolean;
}

export interface NarrativeOverlayOptions {
  /** 挂载点父容器（本装配器在其内创建层骨架） */
  container: HTMLElement;
  /** 引擎实例（已构造；`start()` 与平台端口归宿主） */
  engine: StoryEngine;
  /**
   * 每帧回调（宿主游戏主循环钩子）：本装配器每帧调用一次，
   * 宿主据此把覆盖层与自己引擎的位置对齐（如气泡跟随角色）。
   */
  onFrame?: (dtSeconds: number) => void;
  /** 打字速度（字符/秒；缺省 30，与内建默认一致） */
  textSpeed?: number;
  /** 渲染投影变化通知（宿主可作状态指示；每帧打字推进也会触发） */
  onView?: (view: NarrativeOverlayView) => void;
  /** 对话模板注册表（不传 = 内建） */
  dialogueTemplates?: DialogueTemplateRegistry;
  /** 选择模板注册表（不传 = 内建） */
  choiceTemplates?: ChoiceTemplateRegistry;
  /** 通知模板注册表（不传 = 内建） */
  notifyTemplates?: NotifyTemplateRegistry;
  /** 元素渲染器注册表（不传 = 内建全集） */
  elementRegistry?: ElementRegistry;
  /**
   * 层级 z 表（不传 = 内建默认）。
   * 宿主若从 `project.json shell.layers` 解析过覆盖表，经 `resolveLayerZ` 后注入。
   */
  layerZ?: LayerZTable;
  /** 元素 `cmd` 命令处理器（未注册 fail-closed 上报） */
  commands?: Map<
    string,
    (value: string | undefined, element: ElementInstance) => void
  >;
  /** 资源解析（元素 source/src/path → URL） */
  resolveResource?: (path: string) => string | undefined;
  /** 错误上报（引擎错误、未注册类型/命令；缺省 = 控制台） */
  onError?: (message: string) => void;
}

export interface NarrativeOverlay {
  /** 挂载点（宿主可进一步定制，如往 stage 内插自己的背景） */
  readonly mounts: NarrativeMounts;
  /** 当前渲染投影（只读） */
  view(): NarrativeOverlayView;
  /** 与引擎状态对齐（读档 / 回溯完成后调用） */
  sync(): void;
  /** 帧循环开关（宿主游戏暂停时可关，避免空转） */
  setRunning(running: boolean): void;
  /**
   * 输入是否归叙事层消费（**只判事件目标**：控件/面板内不吃）。
   * 模式层面的让位（外部玩法系统接管）由宿主按自己的域状态决定——
   * 那是宿主游戏的路由权，覆盖层不替它拍板。
   */
  shouldConsumeInput(event: Event): boolean;
  /** 推进（二段式已处理：打字中先瞬间完成） */
  advance(): void;
  /** 选择选项（`menu` 等待） */
  choose(target: string): void;
  /** 提交输入（`input` 等待） */
  submitInput(value: string): void;
  /** 卸载：停帧循环、退订、清空挂载点 */
  dispose(): void;
}
