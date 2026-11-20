<script setup lang="ts">
/**
 * 页面装配：把宿主演出的数据挂到界面上，再把玩家的动作转回叙事。
 *
 * 这一层刻意很薄：装载、布局、渲染数据都归 `mp/`，页面只做三件事——取画布、把补丁写进
 * 页面状态、把点击与输入交给覆盖层。别在页面里写叙事逻辑。
 *
 * 层次口径与桌面宿主一致：舞台层是唯一带基准尺寸与变换的容器（画布等比缩放），对话、
 * 选择、通知各层住在窗口坐标系里，尺寸只跟窗口走。各层的模板与样式归各自的组件，
 * 页面只负责编排——这样单文件留在可读尺度内，改一层的形态不必翻整页。
 *
 * 差别只在单位——桌面用 px + clamp 跟窗口，小程序页面按平台惯例用 rpx（宽度基准 750），
 * 比例同源、绝对尺寸按 750 宽度折算。
 */
import { onReady, onUnload } from "@dcloudio/uni-app";
import { DEFAULT_LANG, type PlayerPreferences } from "@lingfan-engine/core";
import {
  DIALOGUE_FONT_SCALE_VAR,
  DIALOGUE_HEIGHT_SCALE_VAR,
  DIALOGUE_OPACITY_VAR,
} from "@lingfan-engine/ui";
import { computed, ref } from "vue";
import ChoiceLayer from "../../components/ChoiceLayer.vue";
import DialogueLayer from "../../components/DialogueLayer.vue";
import NoticeLayer from "../../components/NoticeLayer.vue";
import SaveLoadBar from "../../components/SaveLoadBar.vue";
import SettingsPanel from "../../components/SettingsPanel.vue";
import StageView from "../../components/StageView.vue";
import {
  chooseHostSlot,
  loadHostSlotViews,
  queryCanvasNode,
  startMiniprogramHost,
  watchWindowResize,
  type MiniprogramHostHandle,
  type MiniprogramHostPatch,
  type MiniprogramNvlData,
  type MiniprogramSurfaceData,
  type MiniprogramVideoData,
  type SlotPanelMode,
  type SlotView,
} from "../../mp/index.ts";

/** 帧时钟画布的节点选择器 */
const CANVAS_SELECTOR = "#stage-canvas";

const stage = ref<MiniprogramSurfaceData["stage"]>([]);
const elements = ref<MiniprogramSurfaceData["elements"]>([]);
const dialogue = ref<MiniprogramSurfaceData["dialogue"]>(null);
const nvl = ref<MiniprogramNvlData | null>(null);
const choices = ref<MiniprogramSurfaceData["choices"]>(null);
const notices = ref<MiniprogramSurfaceData["notices"]>([]);
const layers = ref<MiniprogramSurfaceData["layers"]>({});
const stageBox = ref("");
const video = ref<MiniprogramVideoData | null>(null);
const error = ref("");
const inputValue = ref("");
/** 存读面板模式与逐槽视图：null = 收起（只留入口条） */
const slotMode = ref<SlotPanelMode | null>(null);
const slotViews = ref<SlotView[]>([]);
/** 当前语言：空串 = 默认语言（原文直出）。门面 cell 不是 Vue 响应式，镜像进 ref */
const currentLang = ref("");
/** 可选语言清单（门面缺省只含默认语言，端口清单异步补齐后同步） */
const langs = ref<string[]>([DEFAULT_LANG]);
/** 玩家偏好实例：装配完成后交给设置面板（此前为 null，面板不展开） */
const prefs = ref<PlayerPreferences | null>(null);
/** 设置面板是否展开 */
const settingsOpen = ref(false);
/** 对话框外观偏好的响应式投影（CSS 变量 + 位置）：偏好改动经 onChange 重投，模板绑它 */
const dialogueAppearance = ref<{
  style: Record<string, string>;
  position: string;
}>({ style: {}, position: "" });

let host: MiniprogramHostHandle | null = null;
let stopResizeWatch: (() => void) | null = null;
let stopLangWatch: (() => void) | null = null;
let stopAppearanceWatch: (() => void) | null = null;

/** 读偏好投影对话框外观：三态字段未设置则不写对应变量（样式回退内建外观） */
function refreshDialogueAppearance(): void {
  const p = prefs.value;
  if (p === null) {
    dialogueAppearance.value = { style: {}, position: "" };
    return;
  }
  const style: Record<string, string> = {
    [DIALOGUE_FONT_SCALE_VAR]: String(p.fontScale),
  };
  if (p.dialogueOpacity !== undefined)
    style[DIALOGUE_OPACITY_VAR] = String(p.dialogueOpacity);
  if (p.dialogueHeightScale !== undefined)
    style[DIALOGUE_HEIGHT_SCALE_VAR] = String(p.dialogueHeightScale);
  dialogueAppearance.value = { style, position: p.dialoguePosition ?? "" };
}

/** 把一次补丁写进页面状态：字段缺省即不动（`null` 是「清空」而不是「不动」） */
function applyPatch(patch: MiniprogramHostPatch): void {
  if (patch.stage !== undefined) stage.value = patch.stage;
  if (patch.elements !== undefined) elements.value = patch.elements;
  if (patch.dialogue !== undefined) dialogue.value = patch.dialogue;
  if (patch.nvl !== undefined) nvl.value = patch.nvl;
  if (patch.choices !== undefined) choices.value = patch.choices;
  if (patch.notices !== undefined) notices.value = patch.notices;
  if (patch.layers !== undefined) layers.value = patch.layers;
  if (patch.stageBox !== undefined) stageBox.value = patch.stageBox;
  if (patch.video !== undefined) video.value = patch.video;
  if (patch.error !== undefined) error.value = patch.error;
}

/** 层序：核心下发的 z 表转成行内 z-index（小程序渲染层就是 WebView，z-index 可用） */
function layerZ(layer: string): number {
  return layers.value[layer] ?? 0;
}

/** 语言选择器当前项：空串（默认）映射到清单里的默认语言码 */
const langIndex = computed(() => {
  const shown = currentLang.value === "" ? DEFAULT_LANG : currentLang.value;
  const index = langs.value.indexOf(shown);
  return index < 0 ? 0 : index;
});

/** 把门面的语言状态镜像进页面响应式（清单补齐后也要重取一次） */
function syncLang(): void {
  const current = host;
  if (current === null) return;
  currentLang.value = current.i18n.currentLang.value;
  langs.value = [...current.i18n.availableLangs];
}

/** 静态文案翻译：读 currentLang 建立响应式依赖，切语言后模板自动重渲 */
function translate(text: string): string {
  const current = host;
  // 默认语言原文直出（不查表）；引擎未起时也直出
  if (current === null || currentLang.value === "") return text;
  return current.i18n.t(text);
}

/** 语言选择：默认语言映射回空串（引擎的「原文直出」语义），其余按语言码切换 */
function onLangChange(event: { detail: { value: string | number } }): void {
  const current = host;
  const lang = langs.value[Number(event.detail.value)];
  if (current === null || lang === undefined) return;
  const code = lang === DEFAULT_LANG ? "" : lang;
  void current.i18n
    .changeLang(code)
    .then(() => {
      // 切换记住：成功落定后写回偏好作下次会话启动种子（默认语言 = 清空种子）
      if (code === "") current.preferences.clearLanguage();
      else current.preferences.setLanguage(code);
    })
    .catch((cause: unknown) => {
      error.value = String(cause);
    });
}

/** 启动宿主：取画布（拿不到就退回定时器帧源），接上数据发布口与尺寸变化监听 */
async function boot(): Promise<void> {
  try {
    const canvas = await queryCanvasNode(CANVAS_SELECTOR);
    const started = await startMiniprogramHost({ canvas, publish: applyPatch });
    host = started;
    // 偏好实例交给设置面板：读写音量/静音/字速都经它（机器级，独立于存档）
    prefs.value = started.preferences;
    // 对话框外观投影：装配即投一次，偏好改动（设置面板）即时重投
    refreshDialogueAppearance();
    stopAppearanceWatch = started.preferences.onChange(() => {
      refreshDialogueAppearance();
    });
    syncLang();
    // 语言出站（含清单异步补齐前的首次切换）：镜像回页面，模板里的 t() 依赖随之重算
    stopLangWatch = started.i18n.subscribe(() => {
      syncLang();
    });
    stopResizeWatch = watchWindowResize(() => {
      started.resize();
    });
  } catch (cause: unknown) {
    error.value = String(cause);
  }
}

onReady(() => {
  void boot();
});

onUnload(() => {
  stopLangWatch?.();
  stopLangWatch = null;
  stopResizeWatch?.();
  stopResizeWatch = null;
  stopAppearanceWatch?.();
  stopAppearanceWatch = null;
  host?.dispose();
  host = null;
});

/** 点击舞台或对话层 = 推进（打字中则先补完本句，归覆盖层判据） */
function onAdvance(): void {
  host?.overlay.advance();
}

/** 选择菜单：选项带回核心的列 id */
function onChoose(target: string): void {
  if (target !== "") host?.overlay.choose(target);
}

/** 输入框：值先落在页面状态里，提交时一次性交回核心 */
function onInput(value: string): void {
  inputValue.value = value;
}

/** 提交输入：清空输入框再交回，免得下一句沿用上一句的字 */
function onSubmitInput(): void {
  const value = inputValue.value;
  inputValue.value = "";
  host?.overlay.submitInput(value);
}

/** 视频自然播完：交回宿主，由它解除引擎的 video 等待 */
function onVideoEnded(): void {
  host?.videoEnded();
}

/** 打开存读面板：槽位视图从宿主取（槽数来自工程清单），取不到就把原因摆到横幅上 */
async function openSlots(mode: SlotPanelMode): Promise<void> {
  const current = host;
  if (current === null) return;
  slotMode.value = mode;
  try {
    slotViews.value = await loadHostSlotViews({
      savePort: current.ports.save,
      slots: current.saves.slots,
    });
  } catch (cause: unknown) {
    error.value = String(cause);
  }
}

/** 点槽位：面板先收起（存读结果由引擎发通知，宿主不弹第二层） */
function onChooseSlot(view: SlotView): void {
  const current = host;
  const mode = slotMode.value;
  slotMode.value = null;
  if (current === null || mode === null) return;
  chooseHostSlot({
    mode,
    view,
    save: (slot) => current.saveGame(slot),
    load: (slot) => current.loadGame(slot),
  });
}

/** 收起面板：不动任何叙事状态，玩家可以继续点舞台推进 */
function closeSlots(): void {
  slotMode.value = null;
}

defineOptions({ name: "PageIndex" });
</script>

<template>
  <view class="page">
    <!-- 舞台层：视口 → 舞台盒（按宿主算好的缩放与平移变换）→ 元素层，见 StageView -->
    <view class="viewport" @tap="onAdvance">
      <!-- 帧时钟：本宿主的帧源取自这块画布（2d 节点带 requestAnimationFrame） -->
      <canvas class="frame-clock" type="2d" id="stage-canvas"></canvas>
      <StageView :stage="stage" :elements="elements" :stage-box="stageBox" />
    </view>

    <!-- 视频层：声明式组件——起播与换片靠这里的数据，控制动作由宿主的 videoContext 驱动 -->
    <video
      v-if="video && video.visible"
      id="stage-video"
      class="video"
      :src="video.url"
      :autoplay="true"
      :loop="video.loop"
      :volume="video.volume"
      :controls="false"
      :show-center-play-btn="false"
      :enable-progress-gesture="false"
      :style="{ zIndex: layerZ('video') }"
      @ended="onVideoEnded"
    />

    <!-- 对话层：普通形态与 NVL 形态，见 DialogueLayer -->
    <DialogueLayer
      v-if="dialogue && dialogue.visible"
      :dialogue="dialogue"
      :nvl="nvl"
      :z-index="layerZ('dialogue')"
      :appearance="dialogueAppearance"
      @advance="onAdvance"
    />

    <!-- 选择层：菜单与输入两形态互斥，见 ChoiceLayer -->
    <ChoiceLayer
      v-if="choices"
      :choices="choices"
      :input-value="inputValue"
      :z-index="layerZ('choices')"
      @choose="onChoose"
      @input="onInput"
      @submit="onSubmitInput"
    />

    <!-- 通知层：贴右上角，不吃点击，见 NoticeLayer -->
    <NoticeLayer :notices="notices" :z-index="layerZ('notifications')" />

    <!-- 失败横幅：只显示信息，不参与交互 -->
    <view v-if="error" class="error">{{ error }}</view>

    <!--
      宿主界面层：存读入口与槽位面板。层序跟通知层同档（都属操作面），
      容器本身不吃点击，只有入口条与面板本体接手势——舞台推进照常。
    -->
    <view class="ui-chrome" :style="{ zIndex: layerZ('notifications') }">
      <SaveLoadBar
        :mode="slotMode"
        :views="slotViews"
        :translate="translate"
        @open="openSlots"
        @choose="onChooseSlot"
        @close="closeSlots"
      />
      <!-- 设置面板：音量/静音/字速，读写经偏好层；入口在存读条下方顺延 -->
      <SettingsPanel
        :preferences="prefs"
        :open="settingsOpen"
        :translate="translate"
        @open="settingsOpen = true"
        @close="settingsOpen = false"
      />
      <!-- 语言选择器：清单来自构建期扫描（门面的 availableLangs），默认语言=原文直出 -->
      <picker
        class="lang-picker"
        mode="selector"
        :range="langs"
        :value="langIndex"
        @change="onLangChange"
      >
        <view class="lang-value">{{
          currentLang === "" ? DEFAULT_LANG : currentLang
        }}</view>
      </picker>
    </view>
  </view>
</template>

<style>
/* 页面壳：小程序的页面根节点默认不撑满，显式给块级尺寸 */
.page {
  display: block;
}

/* 视口：舞台与各层的公共坐标系，铺满窗口且裁掉溢出（舞台按基准尺寸缩放，会超出） */
.viewport {
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0a0a10;
}

/* 帧时钟画布：只用来拿 requestAnimationFrame，不可见也不吃点击 */
.frame-clock {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* 视频层：铺满窗口，层序由宿主下发的 z 决定（要压在舞台之上、对话之下） */
.video {
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background: #000;
}

/* 宿主界面层：容器不吃点击，只有其中的入口与面板接手势（舞台推进不被挡住） */
.ui-chrome {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  pointer-events: none;
}

/* 语言选择器：右上角落位（左上是存读入口，右上通知层不吃点击、不冲突） */
.lang-picker {
  position: absolute;
  right: 24rpx;
  top: 24rpx;
  pointer-events: auto;
}

.lang-value {
  padding: 12rpx 28rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 16rpx;
  background: rgba(30, 30, 46, 0.72);
  color: #e6e6f0;
  font-size: 26rpx;
  text-align: center;
}

/* 失败横幅：压在一切之上，只读 */
.error {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  padding: 16rpx 24rpx;
  background: #8a2233;
  color: #ffffff;
  font-size: 24rpx;
  pointer-events: none;
  z-index: 9999;
}

@media (orientation: landscape) {
  .error {
    padding: 8px 12px;
    font-size: 12px;
  }
}
</style>
