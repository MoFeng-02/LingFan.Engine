/**
 * 叙事视图状态（平台无关）：把引擎状态键翻译成视图意图，再落到注入的状态单元上。
 *
 * 引擎的状态键是弱类型的（`value: unknown`），每个键怎么解读、缺省怎么回退，是一套
 * 容易在多个宿主里各写一遍、然后慢慢走样的规则。解读规则本身来自共享的
 * `createStateView`（`@lingfan/ui` 的 host 域）；本模块负责两件事：声明订阅哪些键，
 * 以及每条意图落到哪个状态单元上。
 *
 * 共享投影会把非字符串的文本键归一成空串、把非数组的数组键归一成空数组；本模块维持
 * 原判据——类型不符时**不动**已有值。两者只在引擎写出畸形值时可分辨，故这里的守卫
 * 按「保持原行为」保留。
 *
 * 键名与键分类都由装配方注入：订阅哪几个状态键是宿主与引擎之间的接线契约，
 * 共享投影不内置任何键名。
 *
 * 状态单元由装配方经 StateCells 提供——框架宿主传自己的响应式单元（Vue 的 `ref`
 * 结构上就是 Cell，可直接传），无框架宿主传普通对象。本模块不触碰任何框架、DOM
 * 或宿主全局。
 */
import {
  INSTANCE_Z_KEYS,
  SYS,
  type ElementInstance,
  type LayerId,
} from "@lingfan/engine";
import {
  createStateView,
  type StateIntent,
  type StateKeyTable,
  type TypingSetting,
} from "@lingfan/ui";
import type { Cell, ReadonlyCell } from "../cell";

/** 本域订阅的状态键表（键名 → 可读别名） */
const STATE_KEYS: StateKeyTable = {
  speaker: SYS.currentDialogSpeaker,
  dialogText: SYS.currentDialogText,
  waiting: SYS.waiting,
  nvlMode: SYS.nvlMode,
  nvlBuffer: SYS.nvlBuffer,
  menuOptions: SYS.menuOptions,
  menuTargets: SYS.menuTargets,
  dialogVisible: SYS.dialogVisible,
  elements: SYS.elements,
};

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

/**
 * 创建叙事视图状态。字段是装配方给的状态单元——框架宿主的单元自带响应性，
 * 绑定层照常消费；无框架宿主可轮询或手动同步。
 */
export function createNarrativeState(
  options: NarrativeStateOptions,
): NarrativeState {
  const { cell } = options.cells;
  const speaker = cell("");
  const text = cell("");
  const shownText = cell("");
  const speakerColor = cell("");
  const canAdvance = cell(false);
  const inMenu = cell(false);
  const inWait = cell(false);
  const inInput = cell(false);
  const inVideo = cell(false);
  const inMinigame = cell(false);
  const inInteraction = cell(false);
  const inExtension = cell(false);
  const dialogHidden = cell(false);
  const menuPrompt = cell("");
  const inputPrompt = cell("");
  const inputValue = cell("");
  const rawTexts = cell<string[]>([]);
  const rawTargets = cell<string[]>([]);
  const dialogTemplateName = cell<string | null>("");
  const dialogFont = cell("");
  const nvlMode = cell("none");
  const nvlBuffer = cell<string[]>([]);
  const elements = cell<ElementInstance[]>([]);

  /**
   * 选项列表 = 选项文本与选项目标逐位配对。
   * 本模块独占 `rawTexts`/`rawTargets` 的全部写入点，故在写入点直接重算这个
   * 普通单元即可——不要求装配方提供响应式派生（无依赖追踪的框架也能接入）。
   */
  const menuOptions = cell<MenuOption[]>([]);
  function refreshMenuOptions(): void {
    // 与既有派生语义逐位一致：目标缺失（含两键长度不齐）按空串兜底
    menuOptions.value = rawTexts.value.map((t, i) => ({
      text: t,
      target: rawTargets.value[i] ?? "",
    }));
  }

  const toIntent = createStateView({
    keys: STATE_KEYS,
    resolveLayer: (key) => options.resolveLayer(key),
    readTypingSetting: () => options.readTypingSetting(),
    readCharacterColor: (name) => options.readCharacterColor(name),
  });

  /**
   * 重算说话人颜色 = 本句覆盖值优先，其次角色定义。
   *
   * 为什么是函数而不是「在说话人分支里算」：配色是
   * `(speaker, currentDialogColor)` 的派生值——引擎按 `color → speaker` 顺序写两个键，
   * 若只在说话人分支算，本句的 color 可能还没到（算成上一句的颜色，滞后一句）。
   * 派生值不该依赖事件到达顺序，故两个键变更都调它（幂等）。
   */
  function refreshSpeakerColor(): void {
    const def = options.readCharacterColor(speaker.value);
    const override = options.readColorOverride();
    speakerColor.value =
      (override !== null && override !== "" ? override : def) ?? "";
  }

  /** 把一条意图落到状态单元上；`key` 与 `value` 是原始状态，供类型守卫使用 */
  function applyIntent(intent: StateIntent, key: string, value: unknown): void {
    switch (intent.kind) {
      case "layer":
        // 视频层与 DOM 层同走这一条：该层 z 最终落到哪由出口决定
        options.onLayerZ(intent.layer, intent.z);
        return;
      case "speaker":
        if (typeof value !== "string") return;
        speaker.value = value;
        refreshSpeakerColor();
        return;
      case "dialog-text":
        if (typeof value !== "string") return;
        text.value = value;
        options.onDialogText(value);
        return;
      case "waiting":
        canAdvance.value = value === "dialog";
        inMenu.value = value === "menu";
        inWait.value = value === "wait";
        inInput.value = value === "input";
        inVideo.value = value === "video";
        inMinigame.value = value === "minigame";
        inExtension.value = value === "extension";
        return;
      case "dialog-visible":
        dialogHidden.value = value === "hide";
        return;
      case "choices":
        // 选项与目标两键分别写入，各写各的字段
        if (key === STATE_KEYS.menuOptions) {
          if (Array.isArray(value)) {
            rawTexts.value = value as string[];
            refreshMenuOptions();
          }
        } else if (key === STATE_KEYS.menuTargets) {
          if (Array.isArray(value)) {
            rawTargets.value = value as string[];
            refreshMenuOptions();
          }
        }
        return;
      case "nvl-mode":
        if (typeof value !== "string") return;
        nvlMode.value = value;
        return;
      case "nvl-buffer":
        if (!Array.isArray(value)) return;
        nvlBuffer.value = value as string[];
        return;
      case "elements":
        if (!Array.isArray(value)) return;
        elements.value = value as ElementInstance[];
        return;
      case "none":
        // 表外键：两个提示行、配色覆盖、对话模板名、对话字体
        if (key === SYS.menuPrompt && typeof value === "string") {
          menuPrompt.value = value;
        } else if (key === SYS.inputPrompt && typeof value === "string") {
          inputPrompt.value = value;
        } else if (key === SYS.currentDialogColor) {
          refreshSpeakerColor();
        } else if (key === SYS.dialogTemplate) {
          dialogTemplateName.value = typeof value === "string" ? value : null;
        } else if (key === SYS.dialogFont && typeof value === "string") {
          dialogFont.value = value;
        }
        return;
    }
  }

  return {
    speaker,
    text,
    shownText,
    speakerColor,
    canAdvance,
    inMenu,
    inWait,
    inInput,
    inVideo,
    inMinigame,
    inInteraction,
    inExtension,
    dialogHidden,
    menuPrompt,
    inputPrompt,
    inputValue,
    rawTexts,
    rawTargets,
    menuOptions,
    dialogTemplateName,
    dialogFont,
    nvlMode,
    nvlBuffer,
    elements,
    handleState(key: string, value: unknown): void {
      applyIntent(toIntent(key, value), key, value);
    },
    syncFromEngine(read: (key: string) => unknown): void {
      // 回放或读档后，渲染状态与引擎对齐（回溯/读档重写了对话与 NVL 系统键）
      const sp = read(SYS.currentDialogSpeaker);
      const tx = read(SYS.currentDialogText);
      speaker.value = typeof sp === "string" ? sp : "";
      text.value = typeof tx === "string" ? tx : "";
      const w = read(SYS.waiting);
      canAdvance.value = w === "dialog";
      inMenu.value = w === "menu";
      inWait.value = w === "wait";
      inInput.value = w === "input";
      inMinigame.value = w === "minigame";
      inInteraction.value = w === "interaction";
      inExtension.value = w === "extension";
      dialogHidden.value = read(SYS.dialogVisible) === "hide";
      const mp = read(SYS.menuPrompt);
      menuPrompt.value = typeof mp === "string" ? mp : "";
      const ip = read(SYS.inputPrompt);
      inputPrompt.value = typeof ip === "string" ? ip : "";
      const opts = read(SYS.menuOptions);
      rawTexts.value = Array.isArray(opts) ? (opts as string[]) : [];
      const tgts = read(SYS.menuTargets);
      rawTargets.value = Array.isArray(tgts) ? (tgts as string[]) : [];
      refreshMenuOptions();
      const nm = read(SYS.nvlMode);
      nvlMode.value = typeof nm === "string" ? nm : "none";
      const nb = read(SYS.nvlBuffer);
      nvlBuffer.value = Array.isArray(nb) ? (nb as string[]) : [];
      const els = read(SYS.elements);
      elements.value = Array.isArray(els) ? (els as ElementInstance[]) : [];
      const dt = read(SYS.dialogTemplate);
      dialogTemplateName.value = typeof dt === "string" ? dt : null;
      const df = read(SYS.dialogFont);
      dialogFont.value = typeof df === "string" ? df : "";
      // 实例级 z：逐层覆盖；本次读数里没有的层回落到工程层默认
      const zNext: Partial<Record<string, number>> = {};
      for (const [layer, zKey] of Object.entries(INSTANCE_Z_KEYS)) {
        const z = read(zKey as string);
        if (typeof z === "number") zNext[layer] = z;
      }
      options.onLayerZRestore(zNext);
      refreshSpeakerColor();
      options.onDialogText(text.value);
    },
  };
}
