/**
 * 叙事覆盖层的对外契约：表面端口、渲染投影、装配选项与实例方法。
 *
 * 这些类型是宿主与覆盖层之间的边界——实现可以按职责拆开，边界形状不动；
 * 宿主只依赖这里声明的名字，不依赖覆盖层内部的模块划分。
 *
 * **渲染落点不在本文件**：覆盖层只产出每层的视图模型，落到哪个渲染体系由宿主实现的
 * `OverlaySurface` 决定（Web 实现见 `packages/ui/src/dom/overlay-surface.ts`）。
 * 因此本文件不出现任何平台类型。
 */
import type {
  ElementInstance,
  LayerZTable,
  StoryEngine,
} from "@lingfan-engine/core";
import type { ChoiceTemplateRegistry } from "../choices/templates";
import type { ChoicesTexts } from "./choices-view";
import type { DialogueTemplateRegistry } from "../dialogue/templates";
import type { ElementRegistry } from "../element/registry";
import type { NotifyTemplateRegistry } from "../notify/templates";
import type { OverlaySurface } from "./surface";

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

/**
 * 装配覆盖层的全部输入：一个覆盖层表面 + 一个已构造的引擎，其余都可省。
 *
 * 省掉的每一项都有明确后果（用内建默认或不做）——例如不传 `resolveResource`
 * 则元素里的图片一律显示替代文本。逐字段说明见下。
 */
export interface NarrativeOverlayOptions {
  /**
   * 覆盖层表面：宿主把「每一层要显示什么」落到自己渲染体系的出口。
   * Web 宿主用 `createDomOverlaySurface(container)`（层骨架由它建）。
   */
  surface: OverlaySurface;
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
  /** 选择层文案覆盖（输入提交按钮等；不传 = 内建缺省） */
  choiceTexts?: Partial<ChoicesTexts>;
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

/**
 * 装配出的覆盖层实例：一面是宿主给进来的表面（`surface`，宿主可自行往舞台/接管层挂内容），
 * 一面是交给宿主的动作。
 *
 * 引擎的推进权仍在宿主手里——`advance` / `choose` / `submitInput` 是宿主根据
 * 自己的输入路由决定要不要调的，覆盖层不代宿主决定。
 */
export interface NarrativeOverlay {
  /** 覆盖层表面（宿主可进一步定制，如往 `stage` / 接管层挂自己的内容） */
  readonly surface: OverlaySurface;
  /** 当前渲染投影（只读） */
  view(): NarrativeOverlayView;
  /** 与引擎状态对齐（读档 / 回溯完成后调用） */
  sync(): void;
  /** 帧循环开关（宿主游戏暂停时可关，避免空转） */
  setRunning(running: boolean): void;
  /**
   * 输入是否归叙事层消费（**只判事件目标**：控件/面板内不吃）。
   * 模式层面的让位（外部玩法系统接管）由宿主按自己的域状态决定——
   * 那是宿主游戏的路由权，覆盖层不代宿主决定。
   *
   * 参数是**事件目标**（DOM 宿主传 `event.target`），故类型为 `unknown`：
   * 判据在展示层唯一的 `isGameInputTarget` 里，本层不引入平台事件类型。
   */
  shouldConsumeInput(target: unknown): boolean;
  /** 推进（二段式已处理：打字中先瞬间完成） */
  advance(): void;
  /** 选择选项（`menu` 等待） */
  choose(target: string): void;
  /** 提交输入（`input` 等待） */
  submitInput(value: string): void;
  /** 卸载：停帧循环、退订、清空挂载点 */
  dispose(): void;
}
