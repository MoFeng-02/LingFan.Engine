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
  DEFAULT_KEYMAP,
  StoryEngine,
  type AudioPort,
  type HostInfo,
  type I18nPort,
  type LayerZTable,
  type OpExtension,
  type PlayerPreferences,
  type ResourcePort,
  type SavePort,
  type SavesConfig,
  type StageConfig,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import { createCommandRegistry, routesToNarrative } from "@lingfan/ui";
import {
  browserFrameSource,
  createAppElementLayer,
  createAppEngineLife,
  createAppEvents,
  createAppFrame,
  createAppHistory,
  createAppLang,
  createAppMedia,
  createAppNarrative,
  createAppPrefs,
  createAppSlots,
  createAppStageFit,
  createAppTemplates,
} from "./host";
import {
  createExtensionMountHandler,
  createMountRegistries,
  handleInteractionMount,
  handleMinigameMount,
  type ExtensionOverlay,
} from "./host/mount";
import {
  DemoHost,
  DialoguePanel,
  ExtensionOverlayCard,
  NotificationLayer,
  SettingsPanels,
  ToolbarPanel,
} from "./App";

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
  /** 舞台适配配置：设计基准像素与适配策略（project.json shell.stage 可覆盖） */
  stage: StageConfig;
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
  createVideoPort: (
    onError: (message: string) => void,
    readContainer?: () => HTMLElement | null,
  ) => VideoPort;
}>();

/** 引擎实例：initEngine 建立订阅与媒体渲染器；restart 整体重建（取用句柄指向新实例） */
let engine: StoryEngine;

// —— 视图状态：状态键 → 视图意图 → 响应式字段 ——
// 解读规则来自共享的叙事状态域；这里注入宿主侧事实（层级键、角色配色、打字机重建）
/** 叙事状态装配：订阅引擎状态并投影成视图字段；zOf 出层级 z 序，typewriter 出打字机 */
const { narrative, zOf, typewriter } = createAppNarrative({
  getEngine: () => engine,
  layerZ: props.layerZ,
  preferences: props.preferences,
  applyVideoZ: (z) => {
    media.videoPort.setZIndex?.(z);
  },
});
/** 叙事视图状态：模板直接读这些字段，组件不再自持字段 */
const {
  inMenu,
  inWait,
  inInput,
  inVideo,
  inMinigame,
  inInteraction,
  inExtension,
} = narrative;
/** 对话层显隐与内容字段：面板开关、NVL 模式、菜单选项、输入提示与输入值 */
const { dialogHidden, nvlMode, menuOptions, inputPrompt, inputValue } =
  narrative;
/** 对话文本视效字段：打字机可见文本、说话人配色与推进许可 */
const { shownText, speakerColor, dialogFont, canAdvance } = narrative;

// —— 语言选择：可用语言 = Lang/ 目录扫描（供给侧 API）；切换 = setLanguage 按需载入 ——
/** 语言能力：当前语言、可用语言清单与切换动作（切换按需载入语言包） */
const { currentLang, availableLangs, changeLang } = createAppLang({
  props,
  getEngine: () => engine,
});

/** 错误横幅内容（元素、小游戏、事件分支的 fail-closed 上报都落这里） */
const error = ref("");
// 命令注册制：元素 `cmd` 的业务命令由宿主注册（未注册 fail-closed，不静默丢弃）
/** 舞台命令注册表：元素 cmd 属性的业务命令在此注册；未注册命令 fail-closed */
const commands = createCommandRegistry();

// —— 扩展 op 等待覆盖层（extension.mount 出站的宿主接管面）——
/** 当前扩展等待的展示态（null = 无扩展等待）；解除权在宿主——覆盖层「确认」触发 resolve */
const extensionOverlay = ref<ExtensionOverlay | null>(null);
/** 扩展等待解除：清覆盖层与订阅后回填成功结果（信号已中止则以 abort 收尾为准，不回填） */
function resolveExtension(): void {
  const overlay = extensionOverlay.value;
  if (overlay === null) return;
  handleExtensionMount.abort();
  extensionOverlay.value = null;
  if (overlay.signal.aborted) return; // 中断竞态：以 abort 收尾为准
  engine.resolveExtensionOp(overlay.op, { outcome: "success" });
}

/** 小游戏与玩法系统共用挂载点（DemoHost 组件；真元素经其暴露的 minigameHostEl 取用） */
const demoHostRef = ref<InstanceType<typeof DemoHost> | null>(null);
/** 舞台元素层容器（声明式空间层的挂载点） */
const elementLayerEl = ref<HTMLElement | null>(null);
/** 舞台外框（铺满视口；适配读数从这里来，舞台在其中居中留边） */
const stageViewportEl = ref<HTMLElement | null>(null);
/** 舞台根（作者坐标系：基准宽高与适配变换由适配装配写入，别再往它写别的 transform） */
const stageEl = ref<HTMLElement | null>(null);
/** 舞台内容层（震动偏移写它的 transform——与舞台根的适配变换分层，互不覆盖） */
const stageShakeEl = ref<HTMLElement | null>(null);
/** 全屏转场遮罩（不透明度与显隐由帧驱动写入） */
const transitionEl = ref<HTMLElement | null>(null);
/** 对话面板实例（NVL 累积层滚动主体经其暴露） */
const dialoguePanelRef = ref<InstanceType<typeof DialoguePanel> | null>(null);

// —— 模板注册制与视图投影（对话框/选择层/通知层；NVL 累积层贴底监听随装配注册）——
/** 模板视图装配：注册模板族并把叙事字段投影成骨架挂点数据 */
const { choiceView, dialogView, notifyViewOf, nvlPastLines, nvlTypingLine } =
  createAppTemplates({
    narrative,
    readNvlBody: () => dialoguePanelRef.value?.nvlBody ?? null,
  });

// —— 挂载注册表（小游戏 / 玩法系统 / 输入域）：演示工厂就地注册，未注册 fail-closed ——
/** 挂载注册表与输入域：解析工厂 + 键位路由；演示类标记的写法由装配处持有 */
const { minigames, interactions, inputScope } = createMountRegistries();
/** 扩展挂载分支处理器：闭包持 abort 订阅解除（重放的新挂载顶掉旧订阅） */
const handleExtensionMount = createExtensionMountHandler({
  overlay: extensionOverlay,
});

// —— 音视频渲染：端口由组合根注入（装配只见契约）；重启经单元格整体重建 ——
/** 音视频装配：订阅引擎事件渲染媒体；restart 时按单元格整体重建，旧端口成对释放 */
const media = createAppMedia({
  props,
  getEngine: () => engine,
  error,
  // 视频层挂舞台根：整场缩放时它跟着缩（不能挂在 body 上按视口定位）
  readVideoContainer: () => stageEl.value,
});

// —— 元素层装配（元素表渲染 + 容器挂载后渲染监听）——
createAppElementLayer({
  narrative,
  elementLayerEl,
  props,
  commands,
  error,
  getEngine: () => engine,
});

// —— 提示条出口、叙事事件落点与舞台命令（打字机二段式、选项与输入转发）——
/** 事件与输入出口：通知条状态、叙事事件落点、状态同步与舞台输入转发 */
const {
  notifications,
  narrativeEvents,
  handleState,
  syncFromEngine,
  choose,
  submitInput,
  onStageClick,
} = createAppEvents({
  narrative,
  media,
  error,
  getEngine: () => engine,
  typewriter,
});

// —— 历史聚合（快照筛选 + NVL 块化 + 回溯收尾）——
/** 历史面板能力：快照聚合视图、面板开关与按坐标回溯 */
const { showHistory, historyBlocks, toggleHistory, rollbackToEntry } =
  createAppHistory({
    getEngine: () => engine,
    syncFromEngine,
  });

/**
 * 事件落点：提示条、读档诊断与错误横幅。
 * 分流顺序留在本组件（接线契约），每条分支做什么归 `@lingfan/shell` 的事件域与
 * `host/mount/` 挂载分支。
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
    handleMinigameMount(payload, {
      minigames,
      readHost: () => demoHostRef.value?.minigameHostEl ?? null,
      inMinigame,
      error,
      resolveMinigame: (result) => engine.resolveMinigame(result),
      writer: engine.gameState,
    });
  } else if (payload.kind === "interaction.mount") {
    // 外部玩法系统接管：宿主经注册表解析（未注册 = fail-closed，不伪造完成）
    handleInteractionMount(payload, {
      interactions,
      readHost: () => demoHostRef.value?.minigameHostEl ?? null,
      inInteraction,
      inputScope,
      error,
      resolveInteraction: (system, result) =>
        engine.resolveInteraction(system, result),
      writer: engine.gameState,
    });
  } else if (payload.kind === "extension.mount") {
    // 扩展 op 等待接管：宿主展示关闭式覆盖层（本组件唯一的扩展演示接缝）
    handleExtensionMount(payload);
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
  } else if (payload.kind === "character.missing") {
    // 注销知情（非致命）：演示宿主以通知条提示，故事继续推进
    narrativeEvents.notify(
      `角色 ${payload.key} 未注册，跳过注销`,
      "warning",
      undefined,
    );
  } else {
    narrativeEvents.failed(payload.code, payload.message);
  }
}

// —— 引擎生命周期（构造/订阅接线/整体重建/订阅解除）——
/** 引擎生命周期：首次构造并接线订阅、restart 整体重建、卸载时解除订阅 */
const { initEngine, restart, unbind } = createAppEngineLife({
  props,
  getEngine: () => engine,
  setEngine: (next) => {
    engine = next;
  },
  media,
  narrative,
  currentLang,
  error,
  elementLayerEl,
  typewriter,
  zOf,
  handleState,
  handleEvent,
  readMinigameHost: () => demoHostRef.value?.minigameHostEl ?? null,
  readVideoContainer: () => stageEl.value,
});

initEngine();

// —— 帧驱动表现与共享帧循环（打字机推进 → 可见文本 → 媒体回写 → 表现）——
/** 帧驱动：帧循环串起打字机推进、媒体回写与舞台表现（帧源由本宿主提供 rAF 实现） */
const { frameLoop } = createAppFrame({
  getEngine: () => engine,
  frame: browserFrameSource(),
  narrative,
  media,
  typewriter,
  elementLayerEl,
  transitionEl,
  shakeEl: stageShakeEl,
});

// —— 舞台适配（作者按基准像素写坐标，整场等比缩放套进外框）——
/** 舞台适配：配置来自组合根（`project.json shell.stage` 解析结果），读数取外框容器的布局尺寸
 *（不是舞台自身的 clientWidth——那已被变换放大过） */
const stageFit = createAppStageFit({
  readFrame: () => ({
    width: stageViewportEl.value?.clientWidth ?? 0,
    height: stageViewportEl.value?.clientHeight ?? 0,
  }),
  readStageRoot: () => stageEl.value,
  config: props.stage,
});
/** 外框尺寸变化（窗口缩放、旋转、软键盘收起）后重算一次：读数即时取，不依赖事件载荷 */
function applyStageFit(): void {
  stageFit.apply();
}

// —— 玩家偏好与键位映射（状态归核心层，面板只是 UI 皮）——
/** 偏好面板能力：音量/静音/文字速度/方向/全屏视图、键位捕获与展示（状态归核心层） */
const prefsFaces = createAppPrefs({
  preferences: props.preferences,
  typewriter,
});
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
  // 舞台适配：挂载后才量得到外框尺寸；窗口变化与方向切换都要重算
  applyStageFit();
  window.addEventListener("resize", applyStageFit);
  window.addEventListener("orientationchange", applyStageFit);
});

/**
 * 多槽位：存/读共用槽位面板（槽位数与缩略图参数来自 shell.saves 配置）。
 * 打开时 list() + 逐槽 read() 取标题/缩略图（读取失败按空槽呈现，点选时再走引擎 fail-closed）。
 * 存 = 合成缩略图（canvas 卡片）+ engine.save(slot, { screenshot })；读 = engine.load(slot)。
 */
const { slotPanel, slotViews, openSlotPanel, chooseSlot } = createAppSlots({
  props,
  dialogView,
  stageEl,
  getEngine: () => engine,
});

// 命令注册制示例：元素 `cmd="history"` / `cmd="prefs"` / `cmd="restart"` 由此分发
// （未注册的 cmd 由 activateElement fail-closed 上报，不静默丢弃）
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
  window.removeEventListener("resize", applyStageFit);
  window.removeEventListener("orientationchange", applyStageFit);
});
</script>

<template>
  <!-- 舞台外框：铺满视口不滚动，舞台与 UI 两层都挂在它下面；叙事的点击与滚轮也以这层为落点 -->
  <div
    ref="stageViewportEl"
    class="stage-viewport"
    @click="onStageClick"
    @wheel="onWheel"
  >
    <!-- 舞台（作者坐标系，基准像素）：只住元素层与扩展覆盖层——宽高与适配变换由适配装配写入 -->
    <main ref="stageEl" class="stage">
      <!-- 舞台内容层：舞台根的适配变换之外的另一层变换——震动偏移写这里，两层各写各的 -->
      <div ref="stageShakeEl" class="stage-shake">
        <!-- 舞台元素层：声明式空间层（z 由 shell.layers.stage 决定，默认 0 = 位于 video 之下） -->
        <div
          ref="elementLayerEl"
          class="element-layer"
          :style="{ zIndex: layerZ.stage }"
        ></div>
        <!-- 扩展 op 等待覆盖层：extension.mount 展示，「确认」即 resolveExtensionOp 解除（解除权在宿主） -->
        <ExtensionOverlayCard
          v-if="extensionOverlay !== null"
          :overlay="extensionOverlay"
          :z-of="zOf"
          @confirm="resolveExtension"
        />
      </div>
    </main>
    <!-- UI 层（窗口坐标系）：工具栏、通知、叙事面板与面板族——不随舞台缩放，随窗口自适应 -->
    <div class="shell-ui">
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
      <!-- RenderTargets.overlay（notify toast）：列表状态与皮肤类经 NotificationLayer 落地 -->
      <NotificationLayer
        :notices="notifications"
        :notify-view-of="notifyViewOf"
        :z-of="zOf"
      />
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
        :in-extension="inExtension"
        :in-video="inVideo"
        :dialog-hidden="dialogHidden"
        :dialog-view="dialogView"
        :nvl-mode="nvlMode"
        :nvl-past-lines="nvlPastLines"
        :nvl-typing-line="nvlTypingLine"
        :shown-text="shownText"
        :speaker-color="speakerColor"
        :dialog-font="dialogFont"
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
    </div>
    <!-- 全屏转场遮罩：屏幕级效果（含留边在内恒在最上），透明度由帧驱动写入 -->
    <div ref="transitionEl" class="transition-overlay" aria-hidden="true"></div>
  </div>
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
  /* 文本框选：游玩界面的文字（台词、按钮、面板标签）只作展示，拖动或连点不该留下选中段。
     要提供复制能力时，给那个部件加 data-lf-selectable 放行，不在宿主外面破例。 */
  user-select: none;
  -webkit-user-select: none;
}

/* 放行名单：输入框要能选词改写；带 data-lf-selectable 的部件由给出复制操作的宿主自行标记 */
input,
textarea,
[data-lf-selectable] {
  user-select: text;
  -webkit-user-select: text;
}
</style>

<style scoped>
/** 舞台骨架样式：外框、舞台根、元素层、转场遮罩与错误横幅（面板与通知/扩展层的样式随各自组件） */

/* 舞台外框：铺满视口、不滚动；舞台与 UI 两层都挂在这里。舞台等比缩放后的留边露出这里的底色 */
.stage-viewport {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #0a0a10;
}

/* 舞台根：作者坐标系（基准像素，1280 × 720）——宽高与适配变换由适配装配按外框写入，
   这里只定摆放与外观。只有元素层与扩展覆盖层住在这一层，UI 在隔壁的窗口坐标系里。 */
.stage {
  position: absolute;
  top: 0;
  left: 0;
  cursor: pointer;
  /* 舞台是整屏点击目标：WebView 默认的点击高亮会随「被点元素」铺满整个视口
     （看起来像蒙了一层），故此处关闭；交互元素的触摸反馈不受影响。 */
  -webkit-tap-highlight-color: transparent;
  background: #12121a;
  color: #e6e6f0;
  font-size: 17px;
}

/* 舞台内容层：元素层的摆放盒（内边距即元素层的可用边界，元素坐标以此为原点）。
   震动偏移写它的 transform——舞台根那层归适配变换，两层各写各的、互不覆盖。 */
.stage-shake {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 22px 40px;
}

/* 舞台元素层：容器不阻塞舞台点击（可交互元素自身恢复 pointer-events） */
.element-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* UI 层（窗口坐标系）：工具栏、通知、叙事面板与面板族都在这层里，不随舞台缩放而随窗口自适应。
   容器不吃指针事件（点击与滚轮要落到舞台与外框上），需要交互的部件各自恢复 pointer-events。 */
.shell-ui {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: clamp(8px, 1.6vh, 16px);
  box-sizing: border-box;
  padding: clamp(10px, 2.2vh, 22px) clamp(12px, 3vw, 40px);
  font-size: 17px;
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

.error {
  margin: 0 auto;
  width: min(100%, 960px);
  color: #f7768e;
  font-size: 0.75em;
  pointer-events: auto;
}
</style>
