<script setup lang="ts">
/**
 * 浏览器参考宿主：订阅引擎状态与事件，把状态渲染成舞台，把输入翻译成引擎命令。
 *
 * 组件只做三件事——订阅、落状态、转发输入；具体策略（状态投影、层 z、帧驱动、
 * 面板装配、演示工厂）都住在 `host/` 下，本组件负责把它们接到一起。
 * 平台端口与工程装配由组合根（`main.ts`）注入：本组件只消费契约，不知道任何具体实现。
 */
import { onMounted, onUnmounted, ref, type Ref } from "vue";
import {
  DEFAULT_KEYMAP, StoryEngine,
  type AudioPort, type GameStateWriter, type HostInfo, type I18nPort,
  type InteractionContext, type InteractionResult, type LayerZTable,
  type OpExtension, type PlayerPreferences, type ResourcePort,
  type SavePort, type SavesConfig, type Story, type VideoPort,
} from "@lingfan/engine";
import {
  createCommandRegistry, createInputScopeState,
  createMinigameRegistry, routesToNarrative,
} from "@lingfan/ui";
import {
  abortSignalOf, createClick3Demo, createInteractionWalk,
  createAppElementLayer, createAppEngineLife, createAppEvents, createAppFrame,
  createAppHistory, createAppLang, createAppMedia, createAppNarrative,
  createAppPrefs, createAppSlots, createAppTemplates,
} from "./host";
import { DemoHost, DialoguePanel, SettingsPanels, ToolbarPanel } from "./App";

// —— 核心层只写状态，UI 只经 ValueChanged 订阅渲染 ——
// 工程与平台端口都由组合根（main.ts）装配注入：本组件只消费契约，不知道任何具体实现
/** 注入契约：平台端口与工程事实由组合根以 props 供给，组件内只读不重赋值 */
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

/** 引擎实例：initEngine 建立订阅与媒体渲染器；restart 整体重建（取用句柄指向新实例） */
let engine: StoryEngine;

// —— 视图状态：状态键 → 视图意图 → 响应式字段 ——
// 解读规则来自共享的叙事状态域；这里注入宿主侧事实（层级键、角色配色、打字机重建）
/** 叙事状态装配：订阅引擎状态并投影成视图字段；zOf 出层级 z 序，typewriter 出打字机 */
const { narrative, zOf, typewriter } = createAppNarrative({
  getEngine: () => engine, layerZ: props.layerZ, preferences: props.preferences,
  applyVideoZ: (z) => { media.videoPort.setZIndex?.(z); },
});
/** 叙事视图状态：模板直接读这些字段，组件不再自持字段 */
const { inMenu, inWait, inInput, inVideo, inMinigame, inInteraction } = narrative;
/** 对话层显隐与内容字段：面板开关、NVL 模式、菜单选项、输入提示与输入值 */
const { dialogHidden, nvlMode, menuOptions, inputPrompt, inputValue } = narrative;
/** 对话文本视效字段：打字机可见文本、说话人配色与推进许可 */
const { shownText, speakerColor, canAdvance } = narrative;

// —— 语言选择：可用语言 = Lang/ 目录扫描（供给侧 API）；切换 = setLanguage 按需载入 ——
/** 语言能力：当前语言、可用语言清单与切换动作（切换按需载入语言包） */
const { currentLang, availableLangs, changeLang } = createAppLang({
  props, getEngine: () => engine,
});

/** 错误横幅内容（元素、小游戏、事件分支的 fail-closed 上报都落这里） */
const error = ref("");
// 命令注册制：元素 `cmd` 的业务命令由宿主注册（未注册 fail-closed，不静默吞掉）
/** 舞台命令注册表：元素 cmd 属性的业务命令在此注册；未注册命令 fail-closed */
const commands = createCommandRegistry();

/** 小游戏与玩法系统共用挂载点（DemoHost 组件；真元素经其暴露的 minigameHostEl 取用） */
const demoHostRef = ref<InstanceType<typeof DemoHost> | null>(null);
/** 舞台元素层容器（声明式空间层的挂载点） */
const elementLayerEl = ref<HTMLElement | null>(null);
/** 舞台根（震动偏移写它的 transform） */
const stageEl = ref<HTMLElement | null>(null);
/** 全屏转场遮罩（不透明度与显隐由帧驱动写入） */
const transitionEl = ref<HTMLElement | null>(null);
/** 对话面板实例（NVL 累积层滚动主体经其暴露） */
const dialoguePanelRef = ref<InstanceType<typeof DialoguePanel> | null>(null);

// —— 模板注册制与视图投影（对话框/选择层/通知层；NVL 累积层贴底监听随装配注册）——
/** 模板视图装配：注册模板族并把叙事字段投影成骨架挂点数据 */
const { choiceView, dialogView, notifyViewOf, nvlPastLines, nvlTypingLine } =
  createAppTemplates({ narrative, readNvlBody: () => dialoguePanelRef.value?.nvlBody ?? null });

// —— 小游戏注册表：宿主注册（任意技术实现工厂）；未注册 = fail-closed 不伪造完成 ——
/** 小游戏注册表：game 名 → 工厂；未注册的挂载请求 fail-closed（等待保持，不伪造完成） */
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

// —— 音视频渲染：端口由组合根注入（装配只见契约）；重启经单元格整体重建 ——
/** 音视频装配：订阅引擎事件渲染媒体；restart 时按单元格整体重建，旧端口成对释放 */
const media = createAppMedia({ props, getEngine: () => engine, error });

// —— 元素层装配（元素表渲染 + 容器挂载后渲染监听）——
createAppElementLayer({
  narrative, elementLayerEl, props, commands, error, getEngine: () => engine,
});

// —— 提示条出口、叙事事件落点与舞台命令（打字机二段式、选项与输入转发）——
/** 事件与输入出口：通知条状态、叙事事件落点、状态同步与舞台输入转发 */
const {
  notifications, narrativeEvents, handleState, syncFromEngine, choose, submitInput, onStageClick,
} = createAppEvents({ narrative, media, error, getEngine: () => engine, typewriter });

// —— 历史聚合（快照筛选 + NVL 块化 + 回溯收口）——
/** 历史面板能力：快照聚合视图、面板开关与按坐标回溯 */
const { showHistory, historyBlocks, toggleHistory, rollbackToEntry } = createAppHistory({
  getEngine: () => engine, syncFromEngine,
});

/**
 * 事件落点：提示条、读档诊断与错误横幅。
 * 分流顺序留在本组件（接线契约），每条分支做什么归 `host/narrative-event.ts`。
 */
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
    const host = demoHostRef.value?.minigameHostEl ?? null;
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
    // 挂载上下文与 interaction 分支同构：seq 供工厂分辨重放的新挂载，
    // writer 是外部系统写引擎状态的唯一面（状态即接口）。
    // 先收进变量再传参：注册表工厂只声明 MinigameContext（不认得 writer），
    // 新鲜字面量会被多余属性检查拒绝，变量形态交由结构化可赋值放行。
    const ctx = {
      config: payload.config,
      signal: payload.signal,
      seq: payload.seq,
      writer: engine.gameState,
    };
    void factory(host, ctx)
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
    const host = demoHostRef.value?.minigameHostEl ?? null;
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

// —— 引擎生命周期（构造/订阅接线/整体重建/订阅解除）——
/** 引擎生命周期：首次构造并接线订阅、restart 整体重建、卸载时解除订阅 */
const { initEngine, restart, unbind } = createAppEngineLife({
  props, getEngine: () => engine,
  setEngine: (next) => { engine = next; },
  media, narrative, currentLang, error, elementLayerEl, typewriter, zOf, handleState, handleEvent,
  readMinigameHost: () => demoHostRef.value?.minigameHostEl ?? null,
});

initEngine();

// —— 帧驱动表现与 rAF 帧循环（打字机推进 → 可见文本 → 媒体回写 → 表现）——
/** 帧驱动：rAF 循环串起打字机推进、媒体回写与舞台表现（遮罩透明度/层偏移） */
const { frameLoop } = createAppFrame({
  getEngine: () => engine, narrative, media, typewriter,
  elementLayerEl, transitionEl, stageEl,
});

// —— 玩家偏好与键位映射（状态归核心层，面板只是 UI 皮）——
/** 偏好面板能力：音量/静音/文字速度/方向/全屏视图、键位捕获与展示（状态归核心层） */
const prefsFaces = createAppPrefs({ preferences: props.preferences, typewriter });
/** 面板显隐、偏好视图与音量通道清单 */
const { showPrefs, prefsView, PREF_CHANNELS } = prefsFaces;
/** 音量、静音与文字速度的写入口 */
const { setPrefVolume, setPrefMuted, setPrefTextSpeed } = prefsFaces;
/** 屏幕方向与全屏的写入口 */
const { setPrefOrientation, setPrefFullscreen } = prefsFaces;
/** 键位捕获状态、按键判定与捕获启动 */
const { captureAction, keyMatches, startCapture } = prefsFaces;
/** 键位重置、捕获期按键分流与键位展示文案 */
const { resetKeybinding, onCaptureKeydown, displayKeys, prefs } = prefsFaces;

/** 叙事键判定：先问输入域（routesToNarrative），再问键位（keyMatches）——顺序是源级契约 */
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

/** 滚轮上=回退、下=前进（历史面板是回溯的 UI 皮，核心层只暴露坐标回溯）；
 *  仅在游戏域生效——面板/控件内的滚动归控件自己消费，不触发游戏回溯 */
function onWheel(event: WheelEvent): void {
  if (!routesToNarrative(inputScope.current(), event.target)) return;
  if (event.deltaY < 0) engine.back();
  else if (event.deltaY > 0) engine.forward();
}

// 键位监听在挂载期注册、卸载期注销（成对）：窗口级监听的生命周期与组件一致，
// 不随模块求值残留。捕获监听走 capture 阶段，优先于普通键位处理。
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keydown", onCaptureKeydown, true);
});

/**
 * 多槽位：存/读共用槽位面板（槽位数与缩略图参数来自 shell.saves 配置）。
 * 打开时 list() + 逐槽 read() 取标题/缩略图（读取失败按空槽呈现，点选时再走引擎 fail-closed）。
 * 存 = 合成缩略图（canvas 卡片）+ engine.save(slot, { screenshot })；读 = engine.load(slot)。
 */
const { slotPanel, slotViews, openSlotPanel, chooseSlot } = createAppSlots({
  props, dialogView, stageEl, getEngine: () => engine,
});

// 命令注册制示例：元素 `cmd="history"` / `cmd="prefs"` / `cmd="restart"` 由此分发
// （未注册的 cmd 由 activateElement fail-closed 上报，不静默吞掉）
commands.register("history", () => toggleHistory());
commands.register("prefs", () => {
  showPrefs.value = !showPrefs.value;
});
commands.register("restart", () => restart());

onUnmounted(() => {
  unbind(); // 订阅解除（与 bindEngine 成对；先于媒体与引擎释放）
  prefs.dispose(); // 退订偏好变更（与构造期订阅成对）
  props.preferences.dispose(); // 补发未落盘的末次偏好修改（防抖尾结算）
  media.audioPort.dispose(); // 先停播
  media.videoPort.dispose();
  media.audioRenderer?.dispose(); // 再释放已解析资源
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
    <ToolbarPanel
      :layer-z="layerZ"
      :available-langs="availableLangs"
      :current-lang="currentLang"
      @restart="restart"
      @open-slot-panel="openSlotPanel"
      @toggle-history="toggleHistory"
      @toggle-prefs="showPrefs = !showPrefs"
      @change-lang="changeLang"
    />
    <!-- RenderTargets.overlay（notify toast）：模板骨架 = 通知项 + 正文挂点 -->
    <ul class="notifications" :style="{ zIndex: zOf('notifications') }">
      <li
        v-for="n in notifications"
        :key="n.id"
        :class="notifyViewOf(n.text, n.tone).rootClass"
        v-html="notifyViewOf(n.text, n.tone).bodyHtml"
      ></li>
    </ul>
    <!-- 叙事层四层（选择 / 输入 / 玩法挂载 / 对话）共用一个面板骨架 -->
    <DialoguePanel
      ref="dialoguePanelRef"
      v-model:input-value="inputValue"
      :z-of="zOf"
      :in-menu="inMenu"
      :choice-view="choiceView"
      :menu-options="menuOptions"
      :in-input="inInput"
      :input-prompt="inputPrompt"
      :in-minigame="inMinigame"
      :in-interaction="inInteraction"
      :in-video="inVideo"
      :dialog-hidden="dialogHidden"
      :dialog-view="dialogView"
      :nvl-mode="nvlMode"
      :nvl-past-lines="nvlPastLines"
      :nvl-typing-line="nvlTypingLine"
      :shown-text="shownText"
      :speaker-color="speakerColor"
      :can-advance="canAdvance"
      :in-wait="inWait"
      @choose="choose"
      @submit-input="submitInput"
    >
      <!-- 外部系统挂载点（小游戏与玩法系统共用同一容器） -->
      <DemoHost ref="demoHostRef" />
    </DialoguePanel>
    <!-- 面板群：历史 / 偏好 / 槽位三张卡片共用一个面板族 -->
    <SettingsPanels
      :layer-z="layerZ"
      :show-history="showHistory"
      :history-blocks="historyBlocks"
      :show-prefs="showPrefs"
      :prefs-view="prefsView"
      :pref-channels="PREF_CHANNELS"
      :capture-action="captureAction"
      :display-keys="displayKeys"
      :slot-panel="slotPanel"
      :slot-views="slotViews"
      :host="host"
      @rollback-to-entry="rollbackToEntry"
      @set-pref-volume="setPrefVolume"
      @set-pref-muted="setPrefMuted"
      @set-pref-text-speed="setPrefTextSpeed"
      @set-pref-orientation="setPrefOrientation"
      @set-pref-fullscreen="setPrefFullscreen"
      @start-capture="startCapture"
      @reset-keybinding="resetKeybinding"
      @choose-slot="chooseSlot"
    />
    <p v-if="error" class="error">{{ error }}</p>
  </main>
</template>

<style>
/** 全局样式：舞台铺满视口且不产生页面滚动，滚动与溢出由舞台内部层自行约束 */
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
/** 舞台骨架样式：舞台根、元素层、转场遮罩、通知条与错误横幅（面板样式随各自组件） */

/* 舞台骨架与通知层：宿主自身的 DOM；各面板与叙事层的样式随各自组件走 */

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

.error {
  margin: 0 auto;
  width: min(100%, 960px);
  color: #f7768e;
  font-size: 0.75em;
}

/* 通知层模板皮肤：按 tone 换色（骨架固定，仅正文挂点与皮肤类由模板产出） */
.notifications li.tpl-notify-warning {
  color: #e0af68;
}

.notifications li.tpl-notify-error {
  color: #f7768e;
}
</style>
