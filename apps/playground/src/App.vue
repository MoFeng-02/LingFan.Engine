<script setup lang="ts">
/**
 * 浏览器参考宿主：订阅引擎状态与事件，把状态渲染成舞台，把输入翻译成引擎命令。
 *
 * 组件只做三件事——订阅、落状态、转发输入；具体策略（状态投影、层 z、帧驱动、
 * 面板装配、演示工厂）都住在 `host/` 下，本组件负责把它们接到一起。
 * 平台端口与工程装配由组合根（`main.ts`）注入：本组件只消费契约，不知道任何具体实现。
 */
import { onMounted, onUnmounted, ref } from "vue";
import {
  DEFAULT_KEYMAP,
  StoryEngine,
  type OutboundPayload,
} from "@lingfan-engine/core";
import { createCommandRegistry, routesToNarrative } from "@lingfan-engine/ui";
import {
  createAppEventRouter,
  createAppLifecycle,
  createAppMounts,
  createAppPanels,
  createAppStageFit,
  createAppStageView,
  type AppProps,
} from "./host";
import { handleInteractionMount } from "./host/mount";
import {
  DemoHost,
  DialoguePanel,
  ExtensionOverlayCard,
  NotificationLayer,
  SettingsPanels,
  ToolbarPanel,
} from "./App";
import { PausePage, StartPage } from "./pages";

// —— 核心层只写状态，UI 只经 ValueChanged 订阅渲染 ——
// 工程与平台端口都由组合根（main.ts）装配注入：本组件只消费契约，不知道任何具体实现
/** 注入契约：平台端口与工程事实由组合根以 props 供给，组件内只读不重赋值 */
const props = defineProps<AppProps>();

/** 引擎实例：initEngine 建立订阅与媒体渲染器；restart 整体重建（取用句柄指向新实例） */
let engine: StoryEngine;

/** 错误横幅内容（元素、小游戏、事件分支的 fail-closed 上报都落这里） */
const error = ref("");
// 命令注册制：元素 `cmd` 的业务命令由宿主注册（未注册 fail-closed，不静默丢弃）
/** 舞台命令注册表：元素 cmd 属性的业务命令在此注册；未注册命令 fail-closed */
const commands = createCommandRegistry();

// —— 模板 ref（DOM 容器与小游戏/对话面板的实例句柄，装配期只读取值）——
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

/** 小游戏/玩法系统的挂载点取用（未就绪时为空，挂载分支据此 fail-closed） */
function readMinigameHost(): HTMLElement | null {
  return demoHostRef.value?.minigameHostEl ?? null;
}

// —— 舞台视图：叙事状态投影 + 音视频与元素层 + 事件与输入出口 ——
/**
 * 视频层挂舞台根：整场缩放时它跟着缩（不能挂在 body 上按视口定位）。
 * 操作通道的取用函数在这里闭合：restart 之后它仍指向新实例。
 */
const stageView = createAppStageView({
  props,
  getEngine: () => engine,
  error,
  elementLayerEl,
  commands,
  readVideoContainer: () => stageEl.value,
});
/** 叙事视图状态（含层级 z、打字机句柄与媒体单元格；模板直接读这些字段） */
const { narrative, typewriter, media, zOf, controls: controlsFace } = stageView;
/** 事件与输入出口：通知条状态、叙事事件落点、状态同步与舞台输入转发 */
const { notifications, narrativeEvents, handleState } = stageView;
const { syncFromEngine, choose, submitInput, onStageClick } = stageView;
const { inMenu, inWait, inInput, inVideo, inMinigame } = narrative;
const { inInteraction, inExtension, dialogHidden, nvlMode } = narrative;
const { menuOptions, inputPrompt, inputCandidates, inputValue } = narrative;
const { shownText, speakerColor, dialogFont, canAdvance } = narrative;

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

// —— 挂载注册表（小游戏 / 玩法系统 / 输入域）：演示工厂就地注册，未注册 fail-closed ——
/** 挂载注册表、输入域与扩展等待覆盖层的编排（解除动作由覆盖层的「确认」触发） */
const mounts = createAppMounts({ getEngine: () => engine });
const { inputScope, extensionOverlay, resolveExtension } = mounts;

// —— 面板与视图投影（语言、模板、历史、偏好键位、槽位）：状态归核心层，面板只是皮 ——
/** 面板装配：语言选择、模板注册、历史聚合、偏好与键位、多槽位存取 */
const panels = createAppPanels({
  props,
  getEngine: () => engine,
  narrative,
  readNvlBody: () => dialoguePanelRef.value?.nvlBody ?? null,
  syncFromEngine,
  stageEl,
  typewriter,
});
const { currentLang, availableLangs, changeLang, choiceView } = panels;
const { dialogView, notifyViewOf, nvlPastLines, nvlTypingLine } = panels;
const { showHistory, historyBlocks, toggleHistory, rollbackToEntry } = panels;
const { showPrefs, prefsView, PREF_CHANNELS, prefs } = panels;
const { setPrefVolume, setPrefMuted, setPrefTextSpeed } = panels;
const { setPrefOrientation, setPrefFullscreen, captureAction } = panels;
const { keyMatches, startCapture, resetKeybinding, displayKeys } = panels;
const { onCaptureKeydown, slotPanel, slotViews, openSlotPanel } = panels;
const { chooseSlot } = panels;

// —— 事件分流、引擎生命周期、帧循环与对局会话 ——
/** 写档成功后刷新「继续」槽位摘要的落点：会话装配晚于事件分流，故留一个可换的目标 */
const resumeSlotSink: { apply?: () => void } = {};
/** 事件分流器：除玩法系统接管外，其余出站按种类落到提示条、挂载与错误横幅 */
const { route } = createAppEventRouter({
  narrative,
  mounts,
  narrativeEvents,
  getEngine: () => engine,
  error,
  readMinigameHost,
  refreshResumeSlot: () => resumeSlotSink.apply?.(),
});

/**
 * 事件落点：外部玩法系统接管（挂载点与输入域都在本组件闭包里，分支体随装配留在这里），
 * 其余种类一律转给分流器。分流链与分支体跨两个文件，合起来才是完整的接线契约。
 */
function handleEvent({ payload }: { payload: OutboundPayload }): void {
  if (payload.kind === "interaction.mount") {
    // 外部玩法系统接管：宿主经注册表解析（未注册 = fail-closed，不伪造完成）
    handleInteractionMount(payload, {
      interactions: mounts.interactions,
      readHost: readMinigameHost,
      inInteraction,
      inputScope,
      error,
      resolveInteraction: (system, result) =>
        engine.resolveInteraction(system, result),
      writer: engine.gameState,
    });
    return;
  }
  route({ payload });
}

/**
 * 引擎生命周期、帧驱动与对局会话：造引擎并接线 → 起帧循环 → 装会话 → 接暂停态落点 →
 * 登记业务命令。`initEngine()` 在该装配内部立即执行，位置不可挪（见其文件头注释）。
 */
const life = createAppLifecycle({
  props,
  engine: {
    get: () => engine,
    set: (next) => {
      engine = next;
    },
  },
  view: { narrative, media, error, currentLang, zOf, typewriter },
  wiring: { handleState, handleEvent, commands, prefs },
  dom: { elementLayerEl, transitionEl, shakeEl: stageShakeEl },
  actions: {
    advance: onStageClick,
    applyStageFit,
    readMinigameHost,
    readVideoContainer: () => stageEl.value,
  },
  session: { controls: controlsFace, toggleHistory, showPrefs },
});
/** 对局会话：进没进对局、暂停与否、挂载表投影与页面动作 */
const { inGame, paused, resumeSlot, quickSlot, mounted } = life;
const { onStart, onContinue, togglePause, restart } = life;
const { onResume, onSave, onLoad, onHome, onStageClickInGame } = life;
const { refreshResumeSlot, teardown } = life;
const { browsingSaves, resumeViews, toggleSaves, onPickSave } = life;
// 会话就绪后接上「继续」槽位摘要的刷新落点：此后写档成功才会点到新增的档
resumeSlotSink.apply = refreshResumeSlot;

/** 叙事键判定：先问输入域（routesToNarrative），再问键位（keyMatches）——顺序是源级契约 */
function onKeydown(e: KeyboardEvent): void {
  if (captureAction.value !== null) return; // 捕获中：capture 阶段监听器已处理
  // 域非对话（玩法接管/面板）或目标在控件内：叙事层不消费，连 advance 都不发
  if (!routesToNarrative(inputScope.current(), e.target)) return;
  // 暂停中只认 Esc（收起暂停菜单），其余键位留给暂停菜单自己的按钮
  if (paused.value) {
    if (e.key === "Escape") {
      e.preventDefault();
      togglePause();
    }
    return;
  }
  if (keyMatches("advance", DEFAULT_KEYMAP.advance, e)) {
    e.preventDefault();
    onStageClick();
  } else if (keyMatches("history", DEFAULT_KEYMAP.history, e)) {
    toggleHistory();
  } else if (e.key === "Escape") {
    e.preventDefault();
    togglePause();
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
  // 启动页的「继续」要看有没有档：进游戏之前先读一次存档摘要
  void refreshResumeSlot();
});

onUnmounted(() => {
  teardown(); // 订阅解除 → 会话解除 → 偏好退订落盘 → 停播释放 → 引擎释放 → 停帧循环
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
    @click="onStageClickInGame"
    @wheel="onWheel"
  >
    <!-- 启动页：尚未进对局时只有它，舞台不在 DOM 里（引擎已构造但未启动） -->
    <StartPage
      v-if="!inGame"
      :title="projectTitle"
      :resume="resumeSlot"
      :saves="resumeViews"
      :browsing="browsingSaves"
      @start="onStart"
      @continue="onContinue"
      @toggle-saves="toggleSaves"
      @pick-save="onPickSave"
    />
    <template v-else>
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
          :input-candidates="inputCandidates"
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
    </template>
    <!-- 挂载层：引擎把「要显示哪些 UI」写在 SYS.mounts，组件由生成物表按名字查；
       容器不吃事件，组件自身要交互时自己声明（与工具箱同一口径）。
       它始终在 DOM 里（未进对局时是空的）：挂载表是引擎状态，宿主界面不该决定它在不在 -->
    <div id="mounts" class="mounts">
      <component
        :is="item.component"
        v-for="item in mounted"
        :key="item.name"
        v-bind="item.props"
        :controls="controlsFace"
      />
    </div>
    <!-- 暂停菜单：舞台保持挂载（元素层与帧循环都抓着它的节点），由这层遮罩接管点击 -->
    <PausePage
      v-if="paused"
      :title="projectTitle"
      :can-load="resumeSlot !== ''"
      :save-slot="quickSlot"
      @resume="onResume"
      @save="onSave"
      @load="onLoad"
      @home="onHome"
    />
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

/* UI 层容器不吃指针事件（空白处的点击要穿到舞台上推进对话），层内的原生控件一律恢复：
   面板作者漏写容器的 pointer-events 时，按钮与输入框不该跟着整层一起静默失活
   （2026-10-17 选择/输入层就这么失效过：元素在、没有命中、点不到也 focus 不上）。 */
.shell-ui :is(button, input, textarea, select):not(:disabled) {
  pointer-events: auto;
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
   容器不吃指针事件（点击与滚轮要落到舞台与外框上），需要交互的部件各自恢复 pointer-events。
   文字默认值（颜色与字号）写在这一层：它住在舞台外面，继承不到舞台根那套外观。 */
.shell-ui {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: clamp(8px, 1.6vh, 16px);
  box-sizing: border-box;
  padding: clamp(10px, 2.2vh, 22px) clamp(12px, 3vw, 40px);
  color: #e6e6f0;
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

/* 挂载层：整屏覆盖但不吃事件——容器让点击穿到舞台，组件要交互时自己恢复
   （与模板骨架的 #mounts 同一口径）。层级在 UI 层之上、暂停菜单与转场之下。 */
.mounts {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.mounts > * {
  pointer-events: auto;
}
</style>
