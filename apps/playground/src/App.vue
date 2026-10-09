<script setup lang="ts">
/**
 * 浏览器参考宿主：订阅引擎状态与事件，把状态渲染成舞台，把输入翻译成引擎命令。
 *
 * 组件只做三件事——订阅、落状态、转发输入；具体策略（状态投影、层 z、帧驱动、
 * 面板装配、演示工厂）都住在 `host/` 下，本组件负责把它们接到一起。
 * 平台端口与工程装配由组合根（`main.ts`）注入：本组件只消费契约，不知道任何具体实现。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import {
  DEFAULT_KEYMAP,
  SYS,
  StoryEngine,
  instanceZLayer,
  slotIds,
  type AudioPort,
  type GameStateWriter,
  type HostInfo,
  type I18nPort,
  type InteractionContext,
  type InteractionResult,
  type KeymapAction,
  type LayerId,
  type LayerZTable,
  type OpExtension,
  type PlayerPreferences,
  type ResourcePort,
  type SavePort,
  type SavesConfig,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import {
  Typewriter,
  builtinBubbleTemplate,
  builtinChoiceTemplate,
  builtinNotifyTemplate,
  createAudioRenderer,
  createChoiceTemplateRegistry,
  createCommandRegistry,
  createDialogueTemplateRegistry,
  createInputScopeState,
  createMinigameRegistry,
  createNotifyTemplateRegistry,
  createVideoRenderer,
  renderDialogueLine,
  routesToNarrative,
  toNotifyTone,
  type AudioRenderer,
  type ChoiceTemplateView,
  type DialogueTemplateView,
  type NotifyTemplateView,
  type VideoRenderer,
} from "@lingfan/ui";
import { captureSaveThumbnail, captureStageComposite, collectStageMedia, stripHtml } from "./shell";
import {
  abortSignalOf,
  buildHistoryBlocks,
  createClick3Demo,
  createElementLayer,
  createHostEffects,
  createInteractionWalk,
  createKeybindingPanel,
  createLayerZController,
  createNarrativeEvents,
  createNarrativeState,
  createNotices,
  createPreferencesPanel,
  filterHistoryEntries,
  loadSlotViews,
  startHostFrameLoop,
  type HistoryBlock,
  type HistoryEntry,
  type SlotPanelMode,
  type SlotView,
} from "./host";
// 守卫实现来自 stories:build 的 cell 生成物（源 = Stories.src/story.ts 的 cell 槽位）——
// 组合根零手写注册；名字闭合由构建期闸门执法（故事引用 ⊆ 生成注册表）。
import { guards as engineGuards } from "./stories";

// —— 核心层只写状态，UI 只经 ValueChanged 订阅渲染 ——
// 工程与平台端口都由组合根（main.ts）装配注入：本组件只消费契约，不知道任何具体实现
const props = defineProps<{
  /** 热重载：宿主以 ref 包装供给（换 value = 注入新 Story），消费方显式 .value */
  story: Ref<Story>;
  /** 平台区分：宿主事实（os/form，组合根装配；只读，用于展示与按端分支） */
  host: HostInfo;
  /** 层级（z 序）：内建默认 × 工程覆盖（shell.layers），组合根解析后注入 */
  layerZ: LayerZTable;
  /** 存档壳配置：槽位数与缩略图参数（project.json shell.saves 可覆盖） */
  saves: SavesConfig;
  savePort: SavePort;
  resourcePort: ResourcePort;
  /** I18N overlay 供给（可选：浏览器形态未装配 = 原文直出） */
  i18nPort?: I18nPort;
  /** 声明制扩展（组合根装载后注入；清单未声明 = 空数组） */
  extensions: OpExtension[];
  /** 玩家偏好（组合根装配：hydrate 后注入，与存档分离） */
  preferences: PlayerPreferences;
  /** 端口工厂而非实例：restart 重建音频/视频通道时保持「选择权在组合根」 */
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}>();

// —— 视图状态：状态键 → 视图意图 → 响应式字段 ——
// 解读规则来自共享的 host 域；本组件只注入宿主侧事实（层级键、角色配色、打字机重建）
const narrative = createNarrativeState({
  resolveLayer: (key) => instanceZLayer(key),
  // 本宿主不提供故事级打字机设置：字速一律取玩家偏好
  readTypingSetting: () => undefined,
  readCharacterColor: (name) => engine.getCharacter(name)?.color ?? null,
  readColorOverride: () => {
    const value = engine.get(SYS.currentDialogColor);
    return typeof value === "string" ? value : null;
  },
  onLayerZ: (layer, z) => {
    zController.set(layer, z);
  },
  onLayerZRestore: (z) => {
    zController.restore(z);
  },
  onDialogText: (line) => {
    // 打字速度 = 玩家偏好（SetTextSpeed 语义；每句重建取最新值）
    typewriter = new Typewriter(line, props.preferences.textSpeed);
  },
});
/** 叙事视图状态：模板直接读这些字段，组件不再自持字段 */
const {
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
} = narrative;

/**
 * 层 z 控制器：实例级覆盖的**响应式镜像** + 视频层下发。
 * 镜像必须响应式——模板绑定读它，才会在该层 z 变化时重渲染。
 */
const zController = createLayerZController({
  layerZ: props.layerZ,
  applyVideoZ: (z) => {
    videoPort.setZIndex?.(z);
  },
});
/** 层最终 z（实例 > 层默认 > 内建）——模板直接用 */
function zOf(layer: LayerId): number {
  return zController.zOf(layer);
}

/** 错误横幅内容（元素、小游戏、事件分支的 fail-closed 上报都落这里） */
const error = ref("");
/** 提示条出口：装配与驻留归共享的宿主层，本组件只把列表交给模板 */
const notices = createNotices();
/** 提示条列表（模板 v-for 读它） */
const notifications = notices.items;
// 命令注册制：元素 `cmd` 的业务命令由宿主注册（未注册 fail-closed，不静默吞掉）
const commands = createCommandRegistry();
// —— 语言选择：可用语言 = Lang/ 目录扫描（供给侧 API）；切换 = setLanguage 按需载入 ——
const currentLang = ref("");
const availableLangs = ref<string[]>([]);
// 扫描失败（资源根缺失等）宽容降级：语言列表保持空 = 选择器不出现（与 command 侧降级同语义）
void props.i18nPort?.listLanguages?.().then((langs) => {
  if (langs.length > 0) availableLangs.value = langs;
}).catch(() => {});
/** 外部系统挂载点（小游戏与玩法系统共用同一容器） */
const minigameHostEl = ref<HTMLElement | null>(null);
/** 舞台元素层容器（声明式空间层的挂载点） */
const elementLayerEl = ref<HTMLElement | null>(null);
/** 舞台根（震动偏移写它的 transform） */
const stageEl = ref<HTMLElement | null>(null);
/** 全屏转场遮罩（不透明度与显隐由帧驱动写入） */
const transitionEl = ref<HTMLElement | null>(null);
// —— NVL 累积层：已打完的行 memo 一次（O(新增)——静态行若随打字帧全量重渲染即 O(全文) 每帧），
// 最新一行走打字机（统一渲染接缝）——
const nvlPastLines = computed(() =>
  nvlBuffer.value
    .slice(0, -1)
    .map((line) => renderDialogueLine({ text: line }).html),
);
const nvlTypingLine = computed(() => nvlBuffer.value[nvlBuffer.value.length - 1] ?? "");
const nvlBody = ref<HTMLElement | null>(null);
watch(nvlBuffer, () => {
  void nextTick(() => {
    const body = nvlBody.value;
    if (body !== null) body.scrollTop = body.scrollHeight; // 累积层贴底（阅读最新句）
  });
});
// —— 对话框模板注册制：宿主装配注册表（作者扩展入口；编辑器可视化创作
// 未来产出同构描述装配到同一注册表）。核心层解析模板名三级优先级 → __dialog_template，
// 此处按名解析（未知名/null 回退默认）。NVL 累积层保持固定骨架（增量渲染约定）。
const dialogueTemplates = createDialogueTemplateRegistry();
dialogueTemplates.register("bubble", builtinBubbleTemplate, {
  makeDefault: true,
});
// 演示自定义模板（作者纯 TS 创作形态）：居中独白——隐藏说话人行 + 皮肤类
dialogueTemplates.register("center", (input) => ({
  rootClass: "tpl-center",
  speakerHtml: "",
  bodyHtml: input.lineHtml,
  hintHtml: input.canAdvance ? "▼" : "",
}));
// —— 选择层 / 通知层模板注册制（与对话模板同一形态：语义骨架挂点 + 根皮肤类）——
// 骨架由宿主固定渲染（提示行 / 选项列表 / 通知正文），模板只填各挂点内容：
// 未知模板名回退默认（展示层缺失应兜底，与元素/小游戏注册表的 fail-closed 口径不同）。
const choiceTemplates = createChoiceTemplateRegistry();
choiceTemplates.register("default", builtinChoiceTemplate, {
  makeDefault: true,
});
// 演示自定义选择模板（作者纯 TS 创作形态）：编号列表 + 独立皮肤类
choiceTemplates.register("numbered", (input) => ({
  rootClass: "tpl-choice-numbered",
  promptHtml:
    input.prompt === ""
      ? ""
      : renderDialogueLine({ text: input.prompt }).html,
  optionHtml: input.options.map(
    (opt, i) =>
      `<span class="choice-index">${i + 1}.</span> ${renderDialogueLine({ text: opt.text }).html}`,
  ),
}));
const choiceTemplateName = ref<string | null>("");
const notifyTemplates = createNotifyTemplateRegistry();
notifyTemplates.register("default", builtinNotifyTemplate, {
  makeDefault: true,
});
const choiceView = computed<ChoiceTemplateView>(() => {
  const template =
    choiceTemplates.resolve(choiceTemplateName.value) ?? builtinChoiceTemplate;
  return template({
    prompt: menuPrompt.value,
    options: menuOptions.value,
  });
});
const notifyViewOf = (text: string, tone: string): NotifyTemplateView => {
  const template = notifyTemplates.resolve(null) ?? builtinNotifyTemplate;
  return template({ text, tone: toNotifyTone(tone) });
};
// —— 小游戏注册表：宿主注册（任意技术实现工厂）；未注册 = fail-closed 不伪造完成 ——
const minigames = createMinigameRegistry();
// 演示小游戏「点够次数」：config.target 次点击后成功（signal abort = 立即收尾不回填）。
// DOM 构建在 `host/minigame-demo.ts`；本组件只提供宿主侧事实（容器类标记的写法）。
minigames.register(
  "click3",
  createClick3Demo({
    markHost: (host) => {
      host.classList.add("minigame-demo");
    },
  }),
);
/**
 * —— 外部玩法系统注册表（演示：极简 WASD 行走）——
 *
 * 与 minigame 注册表同口径：**未注册 = fail-closed**（不伪造完成、等待保持）。
 * 本演示刻意保持最小：只演示「接管 → 写状态 → 回填结果」三段，
 * 真实玩法系统（寻路、碰撞、战斗）由产品自行实现——引擎只提供接缝。
 */
const interactions = new Map<
  string,
  (
    host: HTMLElement,
    ctx: InteractionContext & { writer: GameStateWriter },
  ) => Promise<InteractionResult>
>();
/**
 * 输入域（宿主状态）：叙事层消费推进/回溯键的前提。
 * `dialogue` = 叙事激活（默认）；玩法系统接管时切 `world` 整体让位。
 * 与 `data-ui-zone`（控件消费优先）正交——前者管「模式」，后者管「事件目标」。
 */
const inputScope = createInputScopeState();
// 演示玩法系统：DOM 与按键循环在 `host/interaction-walk.ts`；
// 本组件只提供宿主侧事实（容器类标记的写法）与可调参数（默认值即演示值）。
interactions.set("walk", createInteractionWalk({
  markHost: (host) => {
    host.classList.add("walk-demo");
  },
}));
const dialogView = computed<DialogueTemplateView>(() => {
  const template =
    dialogueTemplates.resolve(dialogTemplateName.value) ??
    builtinBubbleTemplate;
  return template({
    speaker: speaker.value,
    speakerColor: speakerColor.value,
    lineHtml: renderDialogueLine({ text: shownText.value }).html,
    canAdvance: canAdvance.value,
  });
});
const showHistory = ref(false);
/** 历史条目（引擎快照经筛选后的可回溯行；刷新时机见 `refreshHistory`） */
const historyEntries = ref<HistoryEntry[]>([]);
/** 呈现块：连续 NVL 聚合成一行，回溯目标是块尾检查点 */
const historyBlocks = computed<HistoryBlock[]>(() => buildHistoryBlocks(historyEntries.value));
let typewriter: Typewriter | null = null;
let engine: StoryEngine;
// 守卫实现来自 stories:build 的 cell 生成物（源 = Stories.src/story.ts 的 cell 槽位）——
// 组合根零手写注册；名字闭合由构建期闸门执法（故事引用 ⊆ 生成注册表）。
let offState: (() => void) | undefined;
let offEvent: (() => void) | undefined;
// —— 音频：端口由组合根注入（本组件只见契约）；渲染器做状态差量 ——
function reportAudioError(message: string): void {
  error.value = message;
}
let audioPort: AudioPort = props.createAudioPort(reportAudioError);
let audioRenderer: AudioRenderer | null = null;
let videoPort: VideoPort = props.createVideoPort(reportAudioError);
let videoRenderer: VideoRenderer | null = null;

function createRenderer(): AudioRenderer {
  return createAudioRenderer(engine, audioPort, props.resourcePort, {
    onError: reportAudioError,
    preferences: props.preferences, // 通道有效音量合成 + 偏好变化即时重规划
  });
}

function createVideo(): VideoRenderer {
  return createVideoRenderer(engine, videoPort, props.resourcePort, {
    onError: reportAudioError,
    onVideoFinished: () => engine.videoFinished(), // 组合根职责：播完 → 引擎命令
  });
}

// —— 元素层：核心层只写 __elements，此处经注册表渲染到舞台层 ——
// 渲染、禁用态求值与动作分流都在宿主层叶子；本组件只把引擎命令面与容器接进去。
const elementLayer = createElementLayer({
  readContainer: () => elementLayerEl.value,
  resolveResource: (path) => props.resourcePort.resolve(path),
  readElements: () => elements.value,
  engine: {
    navigate: (target) => {
      engine.navigate(target);
    },
    runElementOps: (ops) => engine.runElementOps(ops),
    interpolate: (source) => engine.interpolate(source),
  },
  commands,
  reportError: (message) => {
    error.value = message;
  },
});

watch(elements, () => {
  void nextTick(() => {
    elementLayer.render(); // 容器挂载后再渲染（首帧容器可能尚未就绪）
  });
});

// —— 帧驱动表现：元素动画 / 全屏转场 / 屏幕震动 ——
// 核心只写「描述」（离散、进快照），逐帧插值归宿主层叶子（不逐帧写 SSOT）。
const driveEffects = createHostEffects({
  source: {
    animations: () => engine.animations(),
    transition: () => {
      const live = engine.get(SYS.transition) as { duration: number } | null | undefined;
      return live ?? undefined;
    },
    shake: () => {
      const live = engine.get(SYS.shake) as
        | { intensity: number; duration: number }
        | null
        | undefined;
      return live ?? undefined;
    },
    animationFinished: (seq) => {
      engine.animationFinished(seq);
    },
    transitionFinished: () => {
      engine.transitionFinished();
    },
    shakeFinished: () => {
      engine.shakeFinished();
    },
  },
  readElementHost: () => elementLayerEl.value,
  readOverlay: () => transitionEl.value,
  readStage: () => stageEl.value,
});

function handleState({ key, value }: { key: string; value: unknown }): void {
  narrative.handleState(key, value);
}

/** 回放或读档后，渲染状态与引擎对齐（回溯/读档重写了对话与 NVL 系统键） */
function syncFromEngine(): void {
  narrative.syncFromEngine((key) => engine.get(key));
}

/**
 * 事件落点：提示条、读档诊断与错误横幅。
 * 分流顺序留在本组件（接线契约），每条分支做什么归 `host/narrative-event.ts`。
 */
const narrativeEvents = createNarrativeEvents({
  notices,
  clearError: () => {
    error.value = "";
  },
  syncFromEngine,
  syncMedia: () => {
    audioRenderer?.sync(); // 媒体位置随快照恢复（回滚 seek）
    videoRenderer?.sync(); // 视频命令流对齐（回溯到段内 = 重播）
  },
  reportError: (message) => {
    error.value = message;
  },
});

function handleEvent({
  payload,
}: {
  payload: import("@lingfan/engine").OutboundPayload;
}): void {
  if (payload.kind === "notify") {
    narrativeEvents.notify(payload.text, payload.notifyType, payload.duration);
  } else if (payload.kind === "minigame.mount") {
    // 宿主经注册表解析工厂挂载；未注册 fail-closed（不伪造完成，等待保持）
    const factory = minigames.get(payload.game);
    if (factory === undefined) {
      error.value = `小游戏未注册：${payload.game}（fail-closed，可回溯/导航离开）`;
      return;
    }
    const host = minigameHostEl.value;
    if (host === null) return;
    // 中止事件订阅需要具体的中止类型：契约层只承诺 `aborted`，这里收窄回本宿主的实现
    const abortSignal = abortSignalOf(payload.signal);
    const onAbort = (): void => {
      abortSignal.removeEventListener("abort", onAbort);
      host.innerHTML = "";
      // 工厂在共享宿主上加的演示类必须随收尾移除（本处是两条结束路径的唯一收口，
      // 故只写一次；写在工厂内会漏掉「正常完成」那条路）
      host.classList.remove("minigame-demo");
      inMinigame.value = false;
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    void factory(host, { config: payload.config, signal: payload.signal })
      .then((result) => {
        if (payload.signal.aborted) return; // 中断竞态：以 abort 收尾为准
        onAbort();
        engine.resolveMinigame(result);
      })
      .catch((e: unknown) => {
        error.value = `小游戏异常：${String(e)}`;
        onAbort();
      });
  } else if (payload.kind === "interaction.mount") {
    // 外部玩法系统接管：宿主经注册表解析（未注册 = fail-closed，不伪造完成）
    const factory = interactions.get(payload.system);
    if (factory === undefined) {
      error.value = `玩法系统未注册：${payload.system}（fail-closed，可回溯/导航离开）`;
      return;
    }
    const host = minigameHostEl.value;
    if (host === null) return;
    inInteraction.value = true;
    // 接管期间切「玩法域」：推进/回溯键整体让位（不必逐事件 preventDefault）。
    // 域归宿主状态——输入路由是展示层职责，引擎只暴露等待态。
    inputScope.set("world");
    // 中止事件订阅需要具体的中止类型：契约层只承诺 `aborted`，这里收窄回本宿主的实现
    const abortSignal = abortSignalOf(payload.signal);
    const onAbort = (): void => {
      abortSignal.removeEventListener("abort", onAbort);
      host.innerHTML = "";
      inInteraction.value = false;
      // 工厂在共享宿主上加的演示类必须随收尾移除。本处是**两条结束路径的唯一收口**
      // （回填成功与中断都经此），故只写一次——分两处写必然漏一条，
      // 症状是残留类让「已结束的接管」在下次仍被算作进行中。
      host.classList.remove("walk-demo");
      // 外部接管结束：域交还叙事
      inputScope.set("dialogue");
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    void factory(host, {
      config: payload.config,
      signal: payload.signal,
      seq: payload.seq,
      writer: engine.gameState, // 外部系统写引擎状态的唯一面（状态即接口）
    })
      .then((result) => {
        if (payload.signal.aborted) return; // 中断竞态：以 abort 收尾为准
        onAbort();
        engine.resolveInteraction(payload.system, result);
      })
      .catch((e: unknown) => {
        error.value = `玩法系统异常：${String(e)}`;
        onAbort();
      });
  } else if (payload.kind === "save.done") {
    // 写档成功（失败走 engine.error 分支，不提示成功）
    narrativeEvents.saved(payload.slot);
  } else if (payload.kind === "load.done") {
    // 读档完成（引擎已重放到存档坐标）——清错误、同步渲染与媒体
    narrativeEvents.loaded(payload.slot);
  } else if (payload.kind === "rollback.done") {
    narrativeEvents.rollbackDone(); // 回放完成解除输入锁并同步渲染
  } else if (payload.kind === "load.notice") {
    // 读档诊断（非致命，宿主应知情）：演示宿主以通知条展示
    narrativeEvents.loadNotice(payload.text);
  } else {
    narrativeEvents.failed(payload.code, payload.message);
  }
}

function bindEngine(e: StoryEngine): void {
  offState = e.onStateChanged(handleState);
  offEvent = e.onEvent(handleEvent);
}

/**
 * fail-closed 停机（引擎报错后拒绝继续）的恢复入口：整体重建引擎。
 * 正式形态由命令面承担（读档/回标题，03/05）；演示层先给最简重开。
 */
function restart(): void {
  offState?.();
  offEvent?.();
  // 停播并释放播放器，再释放已解析 URL（顺序：先停播后回收，Blob 场景才安全）
  audioPort.dispose();
  audioRenderer?.dispose();
  audioPort = props.createAudioPort(reportAudioError);
  videoPort.dispose();
  videoRenderer?.dispose();
  videoPort = props.createVideoPort(reportAudioError);
  videoPort.setZIndex?.(zOf("video")); // 重建端口后补上当前实例 z
  engine.dispose();
  engine = new StoryEngine(props.story.value, {
    i18nPort: props.i18nPort,
    savePort: props.savePort,
    guards: engineGuards,
    extensions: props.extensions,
  });
  bindEngine(engine);
  audioRenderer = createRenderer();
  videoRenderer = createVideo();
  speaker.value = "";
  text.value = "";
  shownText.value = "";
  canAdvance.value = false;
  inMenu.value = false;
  inWait.value = false;
  inInput.value = false;
  inVideo.value = false;
  inMinigame.value = false;
  minigameHostEl.value?.replaceChildren();
  menuPrompt.value = "";
  inputPrompt.value = "";
  inputValue.value = "";
  error.value = "";
  rawTexts.value = [];
  rawTargets.value = [];
  dialogTemplateName.value = ""; // 重启回全局默认
  currentLang.value = ""; // 引擎状态重建：语言回默认（显示态与运行态一致）
  nvlMode.value = "none";
  nvlBuffer.value = [];
  elements.value = [];
  elementLayerEl.value?.replaceChildren();
  typewriter = null;
  engine.start();
}

// SavePort 注入引擎——存档编排（槽位校验/坐标/写读/错误出站）归核心层命令面，
  // UI 只发 save/load 命令并反应完成信号（save.done / load.done）
  engine = new StoryEngine(props.story.value, {
    i18nPort: props.i18nPort,
    savePort: props.savePort,
    guards: engineGuards,
    extensions: props.extensions,
  });
bindEngine(engine);
audioRenderer = createRenderer();
videoRenderer = createVideo();
engine.start();

// 热重载：组合根重新组装后注入新 story → 保运行态（变量/历史）重入当前列
// 监听 ref 本身（value 变化才触发；() => props.story 监听恒定 Ref 引用 = 永不触发）
watch(props.story, (fresh) => engine.reloadStory(fresh));

// —— rAF 帧循环驱动打字机 ——
// 帧内顺序（推进打字机 → 上交可见文本 → 媒体位置回写 → 帧驱动表现）归宿主层叶子，
// 本组件只把四个出口接进去。打字机为空时用正文兜底：整句直出（不经打字机）也得上屏。
const frameLoop = startHostFrameLoop({
  readTypewriter: () => typewriter,
  onText: (visible) => {
    shownText.value = typewriter === null ? text.value : visible;
  },
  onMediaTick: () => {
    audioRenderer?.pollPosition();
  },
  onFrame: (dt) => {
    driveEffects(dt);
  },
});

// —— 玩家偏好：状态归核心层（PlayerPreferences），面板只是 UI 皮 ——
// 镜像与五个 setter 都在宿主层叶子；本组件只把「字速即时作用于当前句」接进去。
const showPrefs = ref(false);
const prefs = createPreferencesPanel({
  preferences: props.preferences,
  onChanged: () => {
    // 速度偏好即时生效于当前句（SetTextSpeed；下句重建自然取新值）
    typewriter?.setSpeed(props.preferences.textSpeed);
  },
});
/** 偏好快照的响应式镜像（模板读它，才会在偏好变化时重渲染） */
const prefsView = prefs.view;
/** 音量通道表（面板行） */
const PREF_CHANNELS = prefs.channels;
/** 音量滑杆 */
const setPrefVolume = prefs.setVolume;
/** 静音开关 */
const setPrefMuted = prefs.setMuted;
/** 字速滑杆 */
const setPrefTextSpeed = prefs.setTextSpeed;
/** 屏幕方向下拉（空值 = 清除 = 跟随工程默认；落壳归组合根） */
const setPrefOrientation = prefs.setOrientation;
/** 全屏开关 */
const setPrefFullscreen = prefs.setFullscreen;

// —— 键位映射：偏好覆盖（prefs-keymap）× 内建默认（DEFAULT_KEYMAP）——
// 匹配与捕获在宿主层叶子；`keyMatches` 这个名字连同调用形态留在本组件：
// 叙事键的判定顺序（先问域、再问键）是源级契约的一部分。
const keys = createKeybindingPanel({
  preferences: props.preferences,
  readKeymap: () => prefs.view.value.keymap,
});
/** 捕获中的动作（null = 不在捕获态） */
const captureAction = keys.captureAction;
/** 按键匹配（大小写不敏感） */
function keyMatches(
  action: KeymapAction,
  fallback: readonly string[],
  e: KeyboardEvent,
): boolean {
  return keys.matches(action, fallback, e);
}

function onKeydown(e: KeyboardEvent): void {
  if (captureAction.value !== null) return; // 捕获中：capture 阶段监听器已处理
  // 域非对话（玩法接管/面板）或目标在控件内：叙事层不消费，连 advance 都不发
  if (!routesToNarrative(inputScope.current(), e.target)) return;
  if (keyMatches("advance", DEFAULT_KEYMAP.advance, e)) {
    e.preventDefault();
    onStageClick();
  } else if (keyMatches("history", DEFAULT_KEYMAP.history, e)) {
    toggleHistory();
  }
}

/** 进入捕获态 */
const startCapture = keys.startCapture;
/** 复位某个动作的键位（回内建默认） */
const resetKeybinding = keys.resetKeybinding;
/** capture 阶段键位捕获（优先于普通键位处理） */
const onCaptureKeydown = keys.handleCaptureKey;
/** 键位显示文本（空格与单字符的写法） */
const displayKeys = keys.displayKeys;

// 键位监听在挂载期注册、卸载期注销（成对）：窗口级监听的生命周期与组件一致，
// 不随模块求值残留。捕获监听走 capture 阶段，优先于普通键位处理。
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keydown", onCaptureKeydown, true);
});

// —— 05 存档：编排归引擎命令面（槽位校验/写读/错误出站都在核心层）——
// UI 只发 save/load 命令并反应完成信号（save.done / load.done）；端口经装配通道注入引擎。

/**
 * 多槽位：存/读共用槽位面板（槽位数与缩略图参数来自 shell.saves 配置）。
 * 打开时 list() + 逐槽 read() 取标题/缩略图（读取失败按空槽呈现，点选时再走引擎 fail-closed）。
 * 存 = 合成缩略图（canvas 卡片）+ engine.save(slot, { screenshot })；读 = engine.load(slot)。
 */
const slotPanel = ref<SlotPanelMode | null>(null);
const slotViews = ref<SlotView[]>([]);

async function openSlotPanel(mode: SlotPanelMode): Promise<void> {
  slotPanel.value = mode;
  slotViews.value = await loadSlotViews({
    savePort: props.savePort,
    slotIds: slotIds(props.saves.slots),
  });
}

async function chooseSlot(view: SlotView): Promise<void> {
  const mode = slotPanel.value;
  slotPanel.value = null;
  if (mode === "save") {
    const base = {
      width: props.saves.thumbnail.width,
      height: props.saves.thumbnail.height,
      quality: props.saves.thumbnail.quality,
      showText: props.saves.thumbnail.showText,
      speaker: dialogView.value.speakerHtml
        ? stripHtml(dialogView.value.speakerHtml)
        : undefined,
      text: stripHtml(dialogView.value.bodyHtml),
      timestamp: Date.now(),
    };
    // 真像素分层合成优先（元素图/视频帧）；污染/失败降级合成卡（尽力而为）
    let shot: string;
    try {
      shot = captureStageComposite({
        ...base,
        stage: {
          width: stageEl.value?.clientWidth ?? 0,
          height: stageEl.value?.clientHeight ?? 0,
        },
        media: collectStageMedia(stageEl.value),
      });
    } catch {
      shot = captureSaveThumbnail(base);
    }
    engine.save(view.id, { screenshot: shot }); // 标题沿用 save op 参数（如有）
  } else if (mode === "load") {
    engine.load(view.id);
  }
}

/** 打字机二段式点击（未完成=瞬间完成/越过停顿，完成=advance）；仅在对话等待中发 advance */
function onStageClick(): void {
  if (canAdvance.value) {
    if (typewriter !== null && !typewriter.done) {
      typewriter.click(); // 瞬间完成/越过停顿
      shownText.value = typewriter.visible;
      return;
    }
    engine.advance();
  } else if (inWait.value || inVideo.value) {
    engine.advance(); // wait 跳过 / cutscene 跳过（skipable 由引擎决定）
  }
}

/** 打开历史面板时刷新快照（历史面板是回溯的 UI 皮） */
function refreshHistory(): void {
  historyEntries.value = filterHistoryEntries(engine.historyView());
}

function toggleHistory(): void {
  showHistory.value = !showHistory.value;
  if (showHistory.value) refreshHistory();
}

function rollbackToEntry(index: number): void {
  engine.rollbackTo(index);
  showHistory.value = false;
  syncFromEngine();
}

/** 滚轮上=回退、下=前进（历史面板是回溯的 UI 皮，核心层只暴露坐标回溯）；
 *  仅在游戏域生效——面板/控件内的滚动归控件自己消费，不触发游戏回溯 */
function onWheel(event: WheelEvent): void {
  if (!routesToNarrative(inputScope.current(), event.target)) return;
  if (event.deltaY < 0) engine.back();
  else if (event.deltaY > 0) engine.forward();
}

function choose(target: string): void {
  engine.choose(target);
}

function submitInput(): void {
  engine.input(inputValue.value.trim());
  inputValue.value = "";
}

/** 语言切换：setLanguage 按需载入 overlay（供给失败引擎 fail-closed 上报，显示态回退） */
async function changeLang(lang: string): Promise<void> {
  currentLang.value = lang;
  await engine.setLanguage(lang);
  if (engine.get(SYS.currentLanguage) !== lang) currentLang.value = String(engine.get(SYS.currentLanguage) ?? "");
}

// 命令注册制示例：元素 `cmd="history"` / `cmd="prefs"` / `cmd="restart"` 由此分发
// （未注册的 cmd 由 activateElement fail-closed 上报，不静默吞掉）
commands.register("history", () => toggleHistory());
commands.register("prefs", () => {
  showPrefs.value = !showPrefs.value;
});
commands.register("restart", () => restart());

onUnmounted(() => {
  offState?.();
  offEvent?.();
  prefs.dispose(); // 退订偏好变更（与构造期订阅成对）
  props.preferences.dispose(); // 补发未落盘的末次偏好修改（防抖尾结算）
  audioPort.dispose(); // 先停播
  videoPort.dispose();
  audioRenderer?.dispose(); // 再释放已解析资源
  engine.dispose(); // 清挂起的 wait 定时器
  frameLoop.stop(); // 停 rAF 帧循环
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keydown", onCaptureKeydown, true);
});
</script>

<template>
  <main ref="stageEl" class="stage" @click="onStageClick" @wheel="onWheel">
    <!-- 舞台元素层：声明式空间层（z 由 shell.layers.stage 决定，默认 0 = 位于 video 之下） -->
    <div ref="elementLayerEl" class="element-layer" :style="{ zIndex: layerZ.stage }"></div>
    <!-- 全屏转场遮罩（屏幕级效果，恒在最上；透明度由帧驱动写入） -->
    <div ref="transitionEl" class="transition-overlay" aria-hidden="true"></div>
    <!-- 固定工具条：单条 flex 行（布局由构造保证不重叠；safe-area 适配移动端） -->
    <div class="toolbar" data-ui-zone :style="{ zIndex: layerZ.toolbar }">
      <!-- fail-closed 停机恢复入口：整体重建引擎（正式形态为读档/回标题命令面） -->
      <button
        class="restart"
        type="button"
        title="重新开始"
        aria-label="重新开始"
        @click.stop="restart"
      >
        ↻
      </button>
      <!-- 05 存档：TS 编排 + SavePort（Tauri=加密在 Rust；浏览器演示=localStorage） -->
      <div class="save-load">
        <button type="button" title="保存到槽位" @click.stop="openSlotPanel('save')">
          存
        </button>
        <button type="button" title="读取槽位" @click.stop="openSlotPanel('load')">
          读
        </button>
      </div>
      <!-- 历史面板开关（H 键） -->
      <button
        class="history-toggle"
        type="button"
        title="历史（H）"
        aria-label="历史面板"
        @click.stop="toggleHistory"
      >
        ☰
      </button>
      <!-- 玩家偏好面板开关 -->
      <button
        class="history-toggle"
        type="button"
        title="设置"
        aria-label="设置面板"
        @click.stop="showPrefs = !showPrefs"
      >
        ⚙
      </button>
      <!-- 语言选择（Lang/ 目录扫描供给；切换 = setLanguage 按需载入译文） -->
      <select
        v-if="availableLangs.length > 1"
        class="lang-select"
        :value="currentLang"
        title="语言"
        @click.stop
        @change.stop="changeLang(($event.target as HTMLSelectElement).value)"
      >
        <option value="">默认</option>
        <option v-for="lang in availableLangs" :key="lang" :value="lang">
          {{ lang }}
        </option>
      </select>
    </div>
    <!-- RenderTargets.overlay（notify toast）：模板骨架 = 通知项 + 正文挂点 -->
    <ul class="notifications" :style="{ zIndex: zOf('notifications') }">
      <li
        v-for="n in notifications"
        :key="n.id"
        :class="notifyViewOf(n.text, n.tone).rootClass"
        v-html="notifyViewOf(n.text, n.tone).bodyHtml"
      ></li>
    </ul>
    <!-- RenderTargets.choices 挂载点（选择层在对话层上方）：模板骨架 =
         提示行 + 选项列表；点击与目标解析归宿主（模板只填内容，不改叙事流向） -->
    <section
      v-if="inMenu"
      class="choices"
      :class="choiceView.rootClass"
      :style="{ zIndex: zOf('choices') }"
      aria-live="polite"
    >
      <p v-if="choiceView.promptHtml" class="layer-prompt" v-html="choiceView.promptHtml"></p>
      <div class="choice-row">
        <button
          v-for="(opt, idx) in menuOptions"
          :key="opt.target"
          type="button"
          :aria-label="opt.text"
          @click.stop="choose(opt.target)"
          v-html="choiceView.optionHtml[idx] ?? ''"
        ></button>
      </div>
    </section>
    <!-- RenderTargets.choices：输入形态（input 等待） -->
    <section
      v-if="inInput"
      class="choices"
      :style="{ zIndex: zOf('choices') }"
      aria-live="polite"
    >
      <p class="layer-prompt">{{ inputPrompt }}</p>
      <form class="input-row" @submit.stop.prevent="submitInput">
        <input
          v-model="inputValue"
          type="text"
          maxlength="20"
          placeholder="输入名字…"
          @click.stop
        />
        <button type="submit" @click.stop>确定</button>
      </form>
    </section>
    <!-- RenderTargets.minigame（宿主经注册表挂载；等待期可回溯 → signal abort 卸载）。
         外部玩法系统接管（interaction）复用同一挂载层：两者都是「外部系统整屏接管」形态，
         分别由 inMinigame / inInteraction 控制可见，宿主容器同一处。 -->
    <section
      v-show="inMinigame || inInteraction"
      class="choices"
      :style="{ zIndex: zOf('minigame') }"
      aria-live="polite"
      @click.stop
    >
      <div ref="minigameHostEl" class="minigame-host"></div>
    </section>
    <!-- RenderTargets.dialogue 挂载点；menu/input 等待时让位 -->
    <section
      v-show="!inMenu && !inInput && !inVideo && !dialogHidden"
      class="dialogue"
      :style="{ zIndex: zOf('dialogue') }"
      :class="[nvlMode === 'active' ? 'nvl-mode' : dialogView.rootClass]"
      aria-live="polite"
    >
      <!-- NVL 累积层——增量渲染约定保持固定骨架（不走模板全量重渲） -->
      <div v-if="nvlMode === 'active'" ref="nvlBody" class="nvl-body">
        <p
          v-for="(html, idx) in nvlPastLines"
          :key="idx"
          class="text"
          v-html="html"
        ></p>
        <p
          class="text"
          v-html="
            renderDialogueLine({ text: nvlTypingLine, typed: shownText }).html
          "
        ></p>
      </div>
      <!-- 模板骨架：speaker 行 / 正文 / 推进指示器三挂点（内容 = 注册模板产出；
           speaker/hint 随输入稳定，打字帧只有正文变化——Vue diff 不动稳定挂点） -->
      <template v-else>
        <p
          v-if="dialogView.speakerHtml"
          class="speaker"
          :style="speakerColor ? { color: speakerColor } : {}"
          v-html="dialogView.speakerHtml"
        ></p>
        <p class="text" v-html="dialogView.bodyHtml"></p>
        <span
          v-if="canAdvance && dialogView.hintHtml"
          class="advance-hint"
          v-html="dialogView.hintHtml"
        ></span>
      </template>
      <span v-if="inWait" class="advance-hint">···</span>
    </section>
    <!-- 历史面板（回溯的 UI 皮：NVL 段聚合为块，块级回溯 = 块尾检查点；同走统一渲染接缝） -->
    <section
      v-if="showHistory"
      class="history-panel"
      data-ui-zone
      :style="{ zIndex: layerZ.history }"
    >
      <p class="layer-prompt">历史</p>
      <ul>
        <li
          v-for="block in historyBlocks"
          :key="block.key"
          @click.stop="rollbackToEntry(block.index)"
        >
          <span v-if="block.speaker" class="history-speaker"
            >{{ block.speaker }}：</span
          ><span
            v-if="!block.nvl"
            class="history-text"
            v-html="renderDialogueLine({ text: block.lines[0] ?? '' }).html"
          ></span>
          <div v-else class="history-nvl">
            <p
              v-for="(line, i) in block.lines"
              :key="i"
              class="history-text"
              v-html="renderDialogueLine({ text: line }).html"
            ></p>
          </div>
        </li>
      </ul>
    </section>
    <!-- 玩家偏好面板（与存档分离：独立持久化，不随档变动） -->
    <section
      v-if="showPrefs"
      class="history-panel prefs-panel"
      data-ui-zone
      :style="{ zIndex: layerZ.prefs }"
      @click.stop
    >
      <p class="layer-prompt">设置</p>
      <label v-for="c in PREF_CHANNELS" :key="c.channel" class="prefs-row">
        <span class="prefs-label">{{ c.label }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="prefsView.volumes[c.channel]"
          :disabled="prefsView.muted"
          @input="setPrefVolume(c.channel, $event)"
        />
        <span class="prefs-value"
          >{{ Math.round(prefsView.volumes[c.channel] * 100) }}%</span
        >
      </label>
      <label class="prefs-row">
        <span class="prefs-label">静音</span>
        <input
          type="checkbox"
          :checked="prefsView.muted"
          @change="setPrefMuted"
        />
      </label>
      <label class="prefs-row">
        <span class="prefs-label">文字速度</span>
        <input
          type="range"
          min="1"
          max="80"
          step="1"
          :value="prefsView.textSpeed"
          @input="setPrefTextSpeed($event)"
        />
        <span class="prefs-value"
          >{{ Math.round(prefsView.textSpeed) }} 字/秒</span
        >
      </label>
      <label class="prefs-row">
        <span class="prefs-label">屏幕方向</span>
        <select
          :value="prefsView.orientation ?? ''"
          @change="setPrefOrientation"
        >
          <option value="">跟随工程</option>
          <option value="auto">跟随系统</option>
          <option value="portrait">竖屏</option>
          <option value="landscape">横屏</option>
        </select>
      </label>
      <div class="prefs-row">
        <span class="prefs-label">推进键</span>
        <button
          type="button"
          class="prefs-key"
          :class="{ capturing: captureAction === 'advance' }"
          @click.stop="startCapture('advance')"
        >
          {{
            captureAction === "advance"
              ? "按任意键（Esc 取消）"
              : displayKeys(prefsView.keymap?.advance ?? DEFAULT_KEYMAP.advance)
          }}
        </button>
        <button
          type="button"
          class="prefs-key-reset"
          @click.stop="resetKeybinding('advance')"
        >
          默认
        </button>
      </div>
      <div class="prefs-row">
        <span class="prefs-label">历史键</span>
        <button
          type="button"
          class="prefs-key"
          :class="{ capturing: captureAction === 'history' }"
          @click.stop="startCapture('history')"
        >
          {{
            captureAction === "history"
              ? "按任意键（Esc 取消）"
              : displayKeys(prefsView.keymap?.history ?? DEFAULT_KEYMAP.history)
          }}
        </button>
        <button
          type="button"
          class="prefs-key-reset"
          @click.stop="resetKeybinding('history')"
        >
          默认
        </button>
      </div>
      <label class="prefs-row">
        <span class="prefs-label">全屏</span>
        <input
          type="checkbox"
          :checked="prefsView.fullscreen ?? false"
          @change="setPrefFullscreen"
        />
      </label>
      <label class="prefs-row">
        <span class="prefs-label">宿主</span>
        <span class="prefs-value">{{ host.os }} · {{ host.form }}</span>
      </label>
    </section>
    <!-- 多槽位面板（存/读共用；槽位数 = shell.saves.slots，缩略图随档存储） -->
    <section v-if="slotPanel" class="history-panel saves-panel" data-ui-zone @click.stop>
      <p class="layer-prompt">{{ slotPanel === "save" ? "保存到槽位" : "读取槽位" }}</p>
      <div class="slot-grid">
        <button
          v-for="v in slotViews"
          :key="v.id"
          type="button"
          class="slot-cell"
          @click.stop="chooseSlot(v)"
        >
          <img v-if="v.screenshot" :src="v.screenshot" alt="" />
          <span v-else class="slot-empty">空</span>
          <span class="slot-label">{{ v.label }}</span>
          <span v-if="v.title" class="slot-title">{{ v.title }}</span>
          <span v-if="v.timestamp" class="slot-time">{{
            new Date(v.timestamp).toLocaleString()
          }}</span>
        </button>
      </div>
    </section>
    <p v-if="error" class="error">{{ error }}</p>
  </main>
</template>

<style>
/* 视口锁定（自适应基座）：不随内容溢出，层内自行约束 */
html,
body,
#app {
  margin: 0;
  height: 100%;
  overflow: hidden;
}
</style>

<style scoped>
.saves-panel {
  width: min(92vw, 560px);
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.slot-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #16161f;
  color: #a9b1d6;
  font-size: 0.8em;
  text-align: left;
  cursor: pointer;
}

.slot-cell:hover {
  border-color: #7aa2f7;
}

.slot-cell img {
  width: 100%;
  border-radius: 6px;
}

.slot-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 56px;
  border: 1px dashed #4448;
  border-radius: 6px;
  color: #565f89;
}

.slot-title {
  color: #e6e6f0;
}

.stage {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 12px;
  padding: clamp(12px, 3vh, 28px) clamp(12px, 4vw, 40px);
  cursor: pointer;
  /* 舞台是整屏点击目标：WebView 默认的点击高亮会随「被点元素」铺满整个视口
     （看起来像蒙了一层），故此处关闭；交互元素的触摸反馈不受影响。 */
  -webkit-tap-highlight-color: transparent;
  background: #12121a;
  color: #e6e6f0;
  font-size: clamp(14px, 1.4vw + 8px, 17px);
}

/* 舞台元素层：容器不阻塞舞台点击（可交互元素自身恢复 pointer-events） */
.element-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 全屏转场遮罩：屏幕级效果恒在 HUD 之上，透明度由帧驱动写入 */
.transition-overlay {
  position: absolute;
  inset: 0;
  display: none;
  background: #000;
  opacity: 0;
  pointer-events: none;
  z-index: 5000;
}

.notifications {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top));
  right: calc(16px + env(safe-area-inset-right));
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.notifications li {
  padding: 8px 14px;
  border-radius: 8px;
  background: #2a2f45dd;
  color: #9ece6a;
  font-size: 0.85em;
}

.toolbar {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top));
  left: calc(16px + env(safe-area-inset-left));
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.restart {
  width: 36px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 16px;
  cursor: pointer;
}

.restart:hover {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

.save-load {
  display: flex;
  gap: 6px;
}

.lang-select {
  padding: 5px 8px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 12px;
  cursor: pointer;
}

.save-load button {
  padding: 6px 12px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 13px;
  cursor: pointer;
}

.save-load button:hover {
  border-color: #9ece6a;
  color: #9ece6a;
}

.history-toggle {
  width: 36px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 16px;
  cursor: pointer;
}

.history-toggle:hover {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

.history-panel {
  position: fixed;
  top: calc(60px + env(safe-area-inset-top));
  left: calc(16px + env(safe-area-inset-left));
  width: min(80vw, 360px);
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid #4448;
  border-radius: 12px;
  background: #1e1e2eee;
  box-sizing: border-box;
  padding: 12px;
}

.history-panel ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-panel li {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85em;
  color: #a9b1d6;
}

.history-panel li:hover {
  background: #26263a;
}

.history-speaker {
  font-weight: 600;
  color: #7aa2f7;
}

.nvl-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialogue {
  position: relative;
  position: relative;
  width: min(100%, 960px);
  margin: 0 auto;
  min-height: clamp(5.5em, 18vh, 9em);
  padding: clamp(12px, 2vh, 18px) clamp(16px, 2.5vw, 24px);
  border: 1px solid #4444;
  border-radius: 12px;
  background: #1e1e2ecc;
  box-sizing: border-box;
}

/* NVL 累积层形态：对话容器抬升为阅读区（累积文本自上而下滚动） */
.dialogue.nvl-mode {
  min-height: 46vh;
  display: flex;
  flex-direction: column;
}

.nvl-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
}

.speaker {
  margin: 0 0 8px;
  font-weight: 600;
  color: #7aa2f7;
}

.text {
  margin: 0;
  white-space: pre-wrap;
}

.advance-hint {
  position: absolute;
  right: 12px;
  bottom: 8px;
  color: #7aa2f7;
  animation: blink 1.2s infinite;
}

.choices {
  position: relative;
  width: min(100%, 960px);
  margin: 0 auto;
  box-sizing: border-box;
}

.layer-prompt {
  margin: 0 0 10px;
  color: #9aa5ce;
  text-align: center;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.choices button {
  padding: clamp(8px, 1.6vh, 12px) clamp(18px, 3vw, 30px);
  border: 1px solid #7aa2f766;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #e6e6f0;
  font-size: 1em;
  cursor: pointer;
}

.choices button:hover {
  border-color: #7aa2f7;
  background: #26263add;
}

.input-row {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.input-row input {
  width: min(60vw, 320px);
  padding: 10px 14px;
  border: 1px solid #7aa2f766;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #e6e6f0;
  font-size: 1em;
  outline: none;
}

.input-row input:focus {
  border-color: #7aa2f7;
}

.error {
  margin: 0 auto;
  width: min(100%, 960px);
  color: #f7768e;
  font-size: 0.75em;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}

/* 偏好面板：行式布局（label/div + 滑块/按钮 + 数值） */
.prefs-panel .prefs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  font-size: 0.85em;
  color: #a9b1d6;
}

.prefs-row .prefs-label {
  width: 4.5em;
  flex: none;
}

.prefs-row input[type="range"] {
  flex: 1;
  accent-color: #7aa2f7;
}

.prefs-row .prefs-value {
  width: 3.5em;
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.prefs-row .prefs-key {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 4px 8px;
  border: 1px solid #343a52;
  border-radius: 4px;
  background: #1a2030;
  color: #a9b1d6;
  cursor: pointer;
}

.prefs-row .prefs-key.capturing {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

.prefs-row .prefs-key-reset {
  flex: none;
  padding: 4px 8px;
  border: 1px solid #343a52;
  border-radius: 4px;
  background: transparent;
  color: #565f89;
  cursor: pointer;
}

/* 模板皮肤（演示自定义模板 center：居中独白形态——骨架固定，皮肤类 + 挂点内容可换） */
.dialogue.tpl-center {
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 1.15em;
  background: #16161ecc;
  border-color: #7aa2f755;
}

/* 通知层模板皮肤：按 tone 换色（骨架固定，仅正文挂点与皮肤类由模板产出） */
.notifications li.tpl-notify-warning {
  color: #e0af68;
}

.notifications li.tpl-notify-error {
  color: #f7768e;
}

/* 选择层模板皮肤（演示自定义模板 numbered：编号列表形态） */
.choices.tpl-choice-numbered .choice-row button {
  text-align: left;
}

.choices.tpl-choice-numbered .choice-index {
  display: inline-block;
  min-width: 1.6em;
  color: #7aa2f7;
}

/* 小游戏挂载层：choices 层之上的宿主容器（内容归注册的工厂，骨架归宿主） */
.minigame-host {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.minigame-demo .minigame-label {
  margin: 0;
  color: #a9b1d6;
  font-size: 0.9em;
}

.minigame-demo .minigame-count {
  font-size: 1.6em;
  font-variant-numeric: tabular-nums;
  color: #7aa2f7;
}

.minigame-demo button {
  padding: 8px 22px;
  font-size: 1em;
  border-radius: 8px;
  border: 1px solid #7aa2f755;
  background: #24283b;
  color: #c0caf5;
  cursor: pointer;
}

/* 外部玩法系统演示（WASD 行走）：内容与样式都归注册的工厂，宿主只给容器 */
.walk-demo {
  width: 100%;
  align-items: flex-start;
}

.walk-demo .walk-hint {
  margin: 0;
  color: #a9b1d6;
  font-size: 0.9em;
}

.walk-demo .walk-avatar {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: linear-gradient(140deg, #7aa2f7, #bb9af7);
  box-shadow: 0 0 12px #7aa2f766;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .walk-demo .walk-avatar {
    transition: none;
  }
}
</style>
