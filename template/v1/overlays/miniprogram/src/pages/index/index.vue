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
import { ref } from "vue";
import ChoiceLayer from "../../components/ChoiceLayer.vue";
import DialogueLayer from "../../components/DialogueLayer.vue";
import NoticeLayer from "../../components/NoticeLayer.vue";
import SaveLoadBar from "../../components/SaveLoadBar.vue";
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

let host: MiniprogramHostHandle | null = null;
let stopResizeWatch: (() => void) | null = null;

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

/** 启动宿主：取画布（拿不到就退回定时器帧源），接上数据发布口与尺寸变化监听 */
async function boot(): Promise<void> {
  try {
    const canvas = await queryCanvasNode(CANVAS_SELECTOR);
    const started = await startMiniprogramHost({ canvas, publish: applyPatch });
    host = started;
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
  stopResizeWatch?.();
  stopResizeWatch = null;
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
        @open="openSlots"
        @choose="onChooseSlot"
        @close="closeSlots"
      />
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
