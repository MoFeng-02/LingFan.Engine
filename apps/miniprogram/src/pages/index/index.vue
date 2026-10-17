<script setup lang="ts">
/**
 * 页面装配：把宿主演出的数据挂到界面上，再把玩家的动作转回叙事。
 *
 * 这一层刻意很薄：装载、布局、渲染数据都归 `host/`，页面只做三件事——取画布、把补丁写进
 * 页面状态、把点击与输入交给覆盖层。别在页面里写叙事逻辑。
 *
 * 层次口径与桌面宿主一致：舞台层是唯一带基准尺寸与变换的容器（画布等比缩放），对话、
 * 选择、通知各层住在窗口坐标系里，尺寸只跟窗口走（`rpx`/百分比），不随舞台缩放。
 */
import { onReady, onUnload } from "@dcloudio/uni-app";
import { ref } from "vue";
import NodeTree from "../../components/NodeTree.vue";
import {
  queryCanvasNode,
  startMiniprogramHost,
  watchWindowResize,
  type MiniprogramHostHandle,
  type MiniprogramHostPatch,
  type MiniprogramSurfaceData,
  type MiniprogramVideoData,
} from "../../host/index.ts";

/** 帧时钟画布的节点选择器 */
const CANVAS_SELECTOR = "#stage-canvas";

const stage = ref<MiniprogramSurfaceData["stage"]>([]);
const elements = ref<MiniprogramSurfaceData["elements"]>([]);
const dialogue = ref<MiniprogramSurfaceData["dialogue"]>(null);
const choices = ref<MiniprogramSurfaceData["choices"]>(null);
const notices = ref<MiniprogramSurfaceData["notices"]>([]);
const layers = ref<MiniprogramSurfaceData["layers"]>({});
const stageBox = ref("");
const video = ref<MiniprogramVideoData | null>(null);
const error = ref("");
const inputValue = ref("");

let host: MiniprogramHostHandle | null = null;
let stopResizeWatch: (() => void) | null = null;

/** 把一次补丁写进页面状态：字段缺省即不动（`null` 是「清空」而不是「不动」） */
function applyPatch(patch: MiniprogramHostPatch): void {
  if (patch.stage !== undefined) stage.value = patch.stage;
  if (patch.elements !== undefined) elements.value = patch.elements;
  if (patch.dialogue !== undefined) dialogue.value = patch.dialogue;
  if (patch.choices !== undefined) choices.value = patch.choices;
  if (patch.notices !== undefined) notices.value = patch.notices;
  if (patch.layers !== undefined) layers.value = patch.layers;
  if (patch.stageBox !== undefined) stageBox.value = patch.stageBox;
  if (patch.video !== undefined) video.value = patch.video;
  if (patch.error !== undefined) error.value = patch.error;
}

/** 层序：核心下发的 z 表转成行内 z-index（小程序渲染层就是 WebView，z-index 可用） */
function layerStyle(layer: string): { zIndex: number } {
  return { zIndex: layers.value[layer] ?? 0 };
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
function onInput(event: Event): void {
  const detail = (event as unknown as { detail?: { value?: unknown } }).detail;
  inputValue.value = typeof detail?.value === "string" ? detail.value : "";
}

/** 提交输入：清空输入框再交回，免得下一句沿用上一句的字 */
function onSubmitInput(): void {
  const value = inputValue.value;
  inputValue.value = "";
  host?.overlay.submitInput(value);
}

/** 选择层根的占位处理：只用来拦住冒泡，别让选项点击同时推进对话 */
function onNothing(): void {
  // 有意留空
}

/** 视频自然播完：交回宿主，由它解除引擎的 video 等待 */
function onVideoEnded(): void {
  host?.videoEnded();
}
</script>

<template>
  <view class="page">
    <!-- 舞台层：视口 → 舞台盒（按宿主算好的缩放与平移变换）→ 元素层 -->
    <view class="viewport" @tap="onAdvance">
      <!-- 帧时钟：本宿主的帧源取自这块画布（2d 节点带 requestAnimationFrame） -->
      <canvas class="frame-clock" type="2d" id="stage-canvas"></canvas>
      <view class="stage-box" :style="stageBox">
        <NodeTree :nodes="stage" />
        <view class="element-layer">
          <NodeTree :nodes="elements" />
        </view>
      </view>
    </view>

    <!-- 视频层：声明式组件——起播与换片靠这里的数据，控制动作由宿主的 videoContext 驱动 -->
    <video
      v-if="video && video.visible"
      id="stage-video"
      class="layer video"
      :src="video.url"
      :autoplay="true"
      :loop="video.loop"
      :volume="video.volume"
      :controls="false"
      :show-center-play-btn="false"
      :enable-progress-gesture="false"
      :style="layerStyle('video')"
      @ended="onVideoEnded"
    />

    <!-- 对话层：说话人 / 正文 / 推进提示三段 -->
    <view
      v-if="dialogue && dialogue.visible"
      class="layer dialogue"
      :class="dialogue.rootClass"
      :style="layerStyle('dialogue')"
      @tap="onAdvance"
    >
      <view
        v-if="dialogue.speakerHtml"
        class="speaker"
        :style="{ color: dialogue.speakerColor }"
      >
        <rich-text :nodes="dialogue.speakerHtml" />
      </view>
      <view
        class="body"
        :style="
          dialogue.bodyFont ? { fontFamily: dialogue.bodyFont } : undefined
        "
      >
        <rich-text :nodes="dialogue.bodyHtml" />
      </view>
      <view v-if="dialogue.hintHtml" class="hint">
        <rich-text :nodes="dialogue.hintHtml" />
      </view>
    </view>

    <!-- 选择层：菜单与输入两形态互斥 -->
    <view
      v-if="choices"
      class="layer choices"
      :class="choices.rootClass"
      :style="layerStyle('choices')"
      @tap.stop="onNothing"
    >
      <view v-if="choices.promptHtml" class="prompt">
        <rich-text :nodes="choices.promptHtml" />
      </view>
      <view v-if="choices.options.length" class="menu">
        <view
          v-for="option in choices.options"
          :key="option.key"
          class="option"
          @tap="onChoose(option.target)"
        >
          <rich-text :nodes="option.html" />
        </view>
      </view>
      <view v-if="choices.input" class="input-row">
        <input
          class="input-box"
          :value="inputValue"
          :placeholder="choices.input.prompt"
          @input="onInput"
          @confirm="onSubmitInput"
        />
        <view class="submit" @tap="onSubmitInput">
          {{ choices.input.submitText }}
        </view>
      </view>
    </view>

    <!-- 通知层：不吃点击，免得挡住下面的层 -->
    <view class="layer notices" :style="layerStyle('notifications')">
      <view
        v-for="notice in notices"
        :key="notice.key"
        class="notice"
        :class="notice.rootClass"
      >
        <rich-text :nodes="notice.bodyHtml" />
      </view>
    </view>

    <!-- 失败横幅：只显示信息，不参与交互 -->
    <view v-if="error" class="error">{{ error }}</view>
  </view>
</template>

<style>
/**
 * 页面样式：舞台按宿主算好的尺寸与变换摆放，其余各层直接铺在视口上。
 *
 * 尺寸单位：舞台内的元素尺寸来自叙事数据（px，基准坐标系），页面自身的留白与字号用
 * rpx——两者不混用，换算只在舞台那一层发生。
 */
.page {
  display: block;
}

.viewport {
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0a0a10;
}

.frame-clock {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* 舞台盒：基准尺寸 + 宿主下发的平移与缩放；原点取左上角，与布局口径一致 */
.stage-box {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

/* 元素层不吃点击：叙事元素暂不接管交互（元素交互走覆盖层的命令出口，属后续接线） */
.element-layer {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
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

/* 对话层：贴在底部的三段式，上缘渐隐压在舞台之上 */
.dialogue {
  top: auto;
  bottom: 0;
  padding: 24rpx 32rpx 40rpx;
  box-sizing: border-box;
  background: linear-gradient(
    180deg,
    rgba(10, 12, 18, 0) 0%,
    rgba(10, 12, 18, 0.88) 40%
  );
}

.speaker {
  font-size: 26rpx;
  letter-spacing: 1rpx;
  margin-bottom: 10rpx;
  opacity: 0.92;
}

.body {
  font-size: 32rpx;
  line-height: 1.7;
}

.hint {
  margin-top: 14rpx;
  font-size: 24rpx;
  opacity: 0.6;
}

/* 选择层：整屏遮暗，菜单或输入二选一 */
.choices {
  top: auto;
  bottom: 0;
  padding: 48rpx 32rpx 72rpx;
  box-sizing: border-box;
  background: rgba(8, 10, 16, 0.84);
}

.prompt {
  font-size: 30rpx;
  opacity: 0.86;
  margin-bottom: 22rpx;
}

.menu {
  display: flex;
  flex-direction: column;
}

.option {
  padding: 22rpx 26rpx;
  margin-bottom: 16rpx;
  border: 1rpx solid rgba(140, 170, 255, 0.35);
  border-radius: 14rpx;
  background: rgba(30, 38, 60, 0.62);
  font-size: 30rpx;
}

.option:active {
  background: rgba(60, 80, 130, 0.72);
}

.input-row {
  display: flex;
  align-items: center;
}

.input-box {
  flex: 1;
  padding: 18rpx 22rpx;
  border-radius: 12rpx;
  background: rgba(30, 38, 60, 0.72);
  color: #e8ecf5;
  font-size: 30rpx;
}

.submit {
  margin-left: 18rpx;
  padding: 18rpx 30rpx;
  border-radius: 12rpx;
  background: rgba(90, 120, 220, 0.78);
  font-size: 30rpx;
}

/* 通知层：居中偏上的一条条气泡，不吃点击 */
.notices {
  top: auto;
  bottom: 360rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.notice {
  margin-top: 14rpx;
  padding: 14rpx 26rpx;
  border-radius: 999rpx;
  background: rgba(0, 0, 0, 0.68);
  font-size: 26rpx;
}

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
</style>
