/**
 * 叙事视图状态：把引擎状态键翻译成视图意图，再落到本宿主的响应式状态上。
 *
 * 引擎的状态键是弱类型的（`value: unknown`），每个键怎么解读、缺省怎么回退，是一套
 * 容易在多个宿主里各写一遍、然后慢慢走样的规则。解读规则本身来自共享的
 * `createStateView`（`@lingfan/ui` 的 host 域）；本模块负责本宿主这一侧的两件事：
 * 声明订阅哪些键，以及每条意图落到哪个响应式字段上。
 *
 * 共享投影会把非字符串的文本键归一成空串、把非数组的数组键归一成空数组；本宿主维持
 * 原判据——类型不符时**不动**已有值。两者只在引擎写出畸形值时可分辨，故这里的守卫
 * 按「保持原行为」保留。
 *
 * 键名与键分类都由本模块注入：订阅哪几个状态键是宿主与引擎之间的接线契约，
 * 共享投影不内置任何键名。
 *
 * 视图状态放在这里而不是组件里，是因为模板要用它们；`<script setup>` 顶层解构出的
 * ref 在模板里照常自动解包。
 */
import { computed, ref, type ComputedRef, type Ref } from "vue";
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

/** 本宿主订阅的状态键表（键名 → 可读别名） */
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

/** 视图状态需要宿主提供的外部事实与出口 */
export interface NarrativeStateOptions {
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

/** 叙事视图状态出口 */
export interface NarrativeState {
  /** 当前说话人（空串 = 无人说话） */
  readonly speaker: Ref<string>;
  /** 本句正文原文 */
  readonly text: Ref<string>;
  /** 本句已上屏的可见前缀（打字机产出） */
  readonly shownText: Ref<string>;
  /** 说话人配色（覆盖值优先，其次角色定义） */
  readonly speakerColor: Ref<string>;
  /** 可以推进（`waiting === "dialog"`） */
  readonly canAdvance: Ref<boolean>;
  /** 等待态：选项 */
  readonly inMenu: Ref<boolean>;
  /** 等待态：无输入等待 */
  readonly inWait: Ref<boolean>;
  /** 等待态：文本输入 */
  readonly inInput: Ref<boolean>;
  /** 等待态：视频 */
  readonly inVideo: Ref<boolean>;
  /** 等待态：小游戏 */
  readonly inMinigame: Ref<boolean>;
  /** 外部玩法系统接管中 */
  readonly inInteraction: Ref<boolean>;
  /** 对话框被故事显式隐藏（`window hide`） */
  readonly dialogHidden: Ref<boolean>;
  /** 菜单提示行 */
  readonly menuPrompt: Ref<string>;
  /** 输入提示行 */
  readonly inputPrompt: Ref<string>;
  /** 输入框内容 */
  readonly inputValue: Ref<string>;
  /** 选项文本（引擎原样） */
  readonly rawTexts: Ref<string[]>;
  /** 选项目标（引擎原样） */
  readonly rawTargets: Ref<string[]>;
  /** 选项（文本 + 目标配对后供模板渲染） */
  readonly menuOptions: ComputedRef<MenuOption[]>;
  /** 当前对话模板名（null = 全局默认回退） */
  readonly dialogTemplateName: Ref<string | null>;
  /** NVL 模式（`"none"` = 关闭） */
  readonly nvlMode: Ref<string>;
  /** NVL 缓冲行 */
  readonly nvlBuffer: Ref<string[]>;
  /** 舞台元素表 */
  readonly elements: Ref<ElementInstance[]>;
  /** 处理一条引擎状态变更 */
  handleState(key: string, value: unknown): void;
  /** 按引擎当前状态整体对齐视图（回溯 / 读档 / 重放后调用） */
  syncFromEngine(read: (key: string) => unknown): void;
}

/**
 * 创建叙事视图状态。返回的字段可直接在模板里使用。
 */
export function createNarrativeState(
  options: NarrativeStateOptions,
): NarrativeState {
  const speaker = ref("");
  const text = ref("");
  const shownText = ref("");
  const speakerColor = ref("");
  const canAdvance = ref(false);
  const inMenu = ref(false);
  const inWait = ref(false);
  const inInput = ref(false);
  const inVideo = ref(false);
  const inMinigame = ref(false);
  const inInteraction = ref(false);
  const dialogHidden = ref(false);
  const menuPrompt = ref("");
  const inputPrompt = ref("");
  const inputValue = ref("");
  const rawTexts = ref<string[]>([]);
  const rawTargets = ref<string[]>([]);
  const dialogTemplateName = ref<string | null>("");
  const nvlMode = ref("none");
  const nvlBuffer = ref<string[]>([]);
  const elements = ref<ElementInstance[]>([]);

  const menuOptions = computed<MenuOption[]>(() =>
    rawTexts.value.map((t, i) => ({
      text: t,
      target: rawTargets.value[i] ?? "",
    })),
  );

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

  /** 把一条意图落到响应式状态上；`key` 与 `value` 是原始状态，供类型守卫使用 */
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
        return;
      case "dialog-visible":
        dialogHidden.value = value === "hide";
        return;
      case "choices":
        // 选项与目标两键分别写入，各写各的字段
        if (key === STATE_KEYS.menuOptions) {
          if (Array.isArray(value)) rawTexts.value = value as string[];
        } else if (key === STATE_KEYS.menuTargets) {
          if (Array.isArray(value)) rawTargets.value = value as string[];
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
        // 四个键不在共享键表内：两个提示行、配色覆盖、对话模板名
        if (key === SYS.menuPrompt && typeof value === "string") {
          menuPrompt.value = value;
        } else if (key === SYS.inputPrompt && typeof value === "string") {
          inputPrompt.value = value;
        } else if (key === SYS.currentDialogColor) {
          refreshSpeakerColor();
        } else if (key === SYS.dialogTemplate) {
          dialogTemplateName.value = typeof value === "string" ? value : null;
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
    dialogHidden,
    menuPrompt,
    inputPrompt,
    inputValue,
    rawTexts,
    rawTargets,
    menuOptions,
    dialogTemplateName,
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
      dialogHidden.value = read(SYS.dialogVisible) === "hide";
      const mp = read(SYS.menuPrompt);
      menuPrompt.value = typeof mp === "string" ? mp : "";
      const ip = read(SYS.inputPrompt);
      inputPrompt.value = typeof ip === "string" ? ip : "";
      const opts = read(SYS.menuOptions);
      rawTexts.value = Array.isArray(opts) ? (opts as string[]) : [];
      const tgts = read(SYS.menuTargets);
      rawTargets.value = Array.isArray(tgts) ? (tgts as string[]) : [];
      const nm = read(SYS.nvlMode);
      nvlMode.value = typeof nm === "string" ? nm : "none";
      const nb = read(SYS.nvlBuffer);
      nvlBuffer.value = Array.isArray(nb) ? (nb as string[]) : [];
      const els = read(SYS.elements);
      elements.value = Array.isArray(els) ? (els as ElementInstance[]) : [];
      const dt = read(SYS.dialogTemplate);
      dialogTemplateName.value = typeof dt === "string" ? dt : null;
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
