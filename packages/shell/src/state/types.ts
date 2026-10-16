/**
 * 叙事视图状态的形状：状态单元集、装配方需供的外部事实，以及暴露给绑定层的出口。
 *
 * 状态单元由装配方经 StateCells 提供——框架宿主传自己的响应式单元（Vue 的 `ref`
 * 结构上就是 Cell，可直接传），无框架宿主传普通对象。本域不触碰任何框架、DOM
 * 或宿主全局。
 */
import type { ElementInstance, LayerId } from "@lingfan/engine";
import type { TypingSetting } from "@lingfan/ui";
import type { Cell, ReadonlyCell } from "../cell";

/** 一条菜单选项：展示文本 + 选中后要去的列 */
export interface MenuOption {
  text: string;
  target: string;
}

/** 本域的状态单元集：每个视图字段一个单元（框架宿主传响应式单元） */
export interface StateCells {
  /** 新建一个状态单元；任意框架的响应式盒子或普通对象都满足此形状 */
  cell<T>(initial: T): Cell<T>;
}

/** 视图状态需要宿主提供的外部事实与出口 */
export interface NarrativeStateOptions {
  /** 状态单元集（字段落点） */
  cells: StateCells;
  /** 键名 → 该键是否承载某一层的实例级 z */
  resolveLayer(key: string): LayerId | undefined;
  /** 读当前故事级打字机设置 */
  readTypingSetting(): TypingSetting | undefined;
  /** 角色配色查询；无名或未定义配色时返回 null */
  readCharacterColor(name: string): string | null;
  /** 本句配色覆盖值（`say color=`）；无覆盖时返回 null */
  readColorOverride(): string | null;
  /** 某层实例级 z 变化（`undefined` = 回工程层默认） */
  onLayerZ(layer: LayerId, z: number | undefined): void;
  /** 整体回档：表里没有的层回落到工程层默认 */
  onLayerZRestore(z: Partial<Record<string, number>>): void;
  /** 新的一句正文到达：宿主据此重建打字机 */
  onDialogText(text: string): void;
}

/** 叙事视图状态出口（字段即状态单元，模板/绑定层按平台约定消费） */
export interface NarrativeState {
  /** 当前说话人（空串 = 无人说话） */
  readonly speaker: Cell<string>;
  /** 本句正文原文 */
  readonly text: Cell<string>;
  /** 本句已上屏的可见前缀（打字机产出） */
  readonly shownText: Cell<string>;
  /** 说话人配色（覆盖值优先，其次角色定义） */
  readonly speakerColor: Cell<string>;
  /** 可以推进（`waiting === "dialog"`） */
  readonly canAdvance: Cell<boolean>;
  /** 等待态：选项 */
  readonly inMenu: Cell<boolean>;
  /** 等待态：无输入等待 */
  readonly inWait: Cell<boolean>;
  /** 等待态：文本输入 */
  readonly inInput: Cell<boolean>;
  /** 等待态：视频 */
  readonly inVideo: Cell<boolean>;
  /** 等待态：小游戏 */
  readonly inMinigame: Cell<boolean>;
  /** 外部玩法系统接管中 */
  readonly inInteraction: Cell<boolean>;
  /** 扩展 op 等待接管中（覆盖层显隐走 mount 事件，此位供对齐与让位判定） */
  readonly inExtension: Cell<boolean>;
  /** 对话框被故事显式隐藏（`window hide`） */
  readonly dialogHidden: Cell<boolean>;
  /** 菜单提示行 */
  readonly menuPrompt: Cell<string>;
  /** 输入提示行 */
  readonly inputPrompt: Cell<string>;
  /** 输入框内容 */
  readonly inputValue: Cell<string>;
  /** 选项文本（引擎原样） */
  readonly rawTexts: Cell<string[]>;
  /** 选项目标（引擎原样） */
  readonly rawTargets: Cell<string[]>;
  /** 选项（文本 + 目标配对后供渲染） */
  readonly menuOptions: ReadonlyCell<MenuOption[]>;
  /** 当前对话模板名（null = 全局默认回退） */
  readonly dialogTemplateName: Cell<string | null>;
  /** 本句对话字体（引擎分辨链结果；空串 = 无声明，回落项目默认） */
  readonly dialogFont: Cell<string>;
  /** NVL 模式（`"none"` = 关闭） */
  readonly nvlMode: Cell<string>;
  /** NVL 缓冲行 */
  readonly nvlBuffer: Cell<string[]>;
  /** 舞台元素表 */
  readonly elements: Cell<ElementInstance[]>;
  /** 处理一条引擎状态变更 */
  handleState(key: string, value: unknown): void;
  /** 按引擎当前状态整体对齐视图（回溯 / 读档 / 重放后调用） */
  syncFromEngine(read: (key: string) => unknown): void;
}
