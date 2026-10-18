<script setup lang="ts">
/**
 * 页面装配：把宿主演出的数据挂到界面上，再把玩家的动作转回叙事。
 *
 * 这一层刻意很薄：装载、布局、渲染数据都归 `host/`，页面只做三件事——取画布、把补丁写进
 * 页面状态、把点击与输入交给覆盖层。别在页面里写叙事逻辑。
 *
 * 层次口径与桌面宿主一致：舞台层是唯一带基准尺寸与变换的容器（画布等比缩放），对话、
 * 选择、通知各层住在窗口坐标系里，尺寸只跟窗口走。
 *
 * 对话面板形态也与桌面面板对齐（一份视觉语言两处落地）：居中卡片、上衣色卡、同名的
 * `.text`/`.speaker`/`.advance-hint`/`.layer-prompt`/`.choice-row` 结构，NVL 累积层用
 * `.nvl-mode`/`.nvl-body` 把容器抬成阅读区。差别只在单位——桌面用 px + clamp 跟窗口，
 * 小程序页面按平台惯例用 rpx（宽度基准 750），比例同源、绝对尺寸按 750 宽度折算。
 */
import { onReady, onUnload } from "@dcloudio/uni-app";
import { ref } from "vue";
import NodeTree from "../../components/NodeTree.vue";
import SaveLoadBar from "../../components/SaveLoadBar.vue";
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
} from "../../host/index.ts";

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

    <!--
      对话层：普通形态三段式（说话人 / 正文 / 推进提示）；
      NVL 形态把容器抬成阅读区（累积行 + 打字中的最新一行），与桌面面板同构。
    -->
    <view
      v-if="dialogue && dialogue.visible"
      class="layer dialogue"
      :class="nvl ? 'nvl-mode' : dialogue.rootClass"
      :style="layerStyle('dialogue')"
      @tap="onAdvance"
    >
      <view v-if="nvl" class="nvl-body">
        <view v-for="(html, index) in nvl.pastLines" :key="index" class="text">
          <rich-text :nodes="html" />
        </view>
        <view class="text">
          <rich-text :nodes="nvl.typingHtml" />
        </view>
      </view>
      <template v-else>
        <view
          v-if="dialogue.speakerHtml"
          class="speaker"
          :style="{ color: dialogue.speakerColor }"
        >
          <rich-text :nodes="dialogue.speakerHtml" />
        </view>
        <view
          class="text"
          :style="
            dialogue.bodyFont ? { fontFamily: dialogue.bodyFont } : undefined
          "
        >
          <rich-text :nodes="dialogue.bodyHtml" />
        </view>
        <view v-if="dialogue.hintHtml" class="advance-hint">
          <rich-text :nodes="dialogue.hintHtml" />
        </view>
      </template>
    </view>

    <!-- 选择层：菜单与输入两形态互斥 -->
    <view
      v-if="choices"
      class="layer choices"
      :class="choices.rootClass"
      :style="layerStyle('choices')"
      @tap.stop="onNothing"
    >
      <view v-if="choices.promptHtml" class="layer-prompt">
        <rich-text :nodes="choices.promptHtml" />
      </view>
      <view v-if="choices.options.length" class="choice-row">
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

    <!-- 通知层：贴右上角，不吃点击，免得挡住下面的层 -->
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

    <!--
      宿主界面层：存读入口与槽位面板。层序跟通知层同档（都属操作面），
      容器本身不吃点击，只有入口条与面板本体接手势——舞台推进照常。
    -->
    <view class="layer ui-chrome" :style="layerStyle('notifications')">
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
/**
 * 页面样式：舞台按宿主算好的尺寸与变换摆放，其余各层直接铺在视口上。
 *
 * 尺寸单位：舞台内的元素尺寸来自叙事数据（px，基准坐标系）；页面自身的留白、字号与面板
 * 几何用 rpx（宽度基准 750）。桌面对应值来自 `apps/playground/src/App/DialoguePanel.vue`
 * （那里用 px + clamp 跟窗口），两边只差单位，不差形态——改形态时两处一起改。
 *
 * 横屏例外：横过来后宽度变大、高度变小，rpx 会把字号与内边距一起放大，所以结尾那段
 * `@media (orientation: landscape)` 用 px 定死排版；层高一律用百分比随视口。
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

/* 宿主界面层：容器不吃点击，只有其中的入口与面板接手势（舞台推进不被挡住） */
.ui-chrome {
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

/* 对话层：贴底居中的卡片（桌面对应 `.dialogue`：宽上限、圆角、半透明底）。
   高度按视口百分比给下限：竖屏约等于桌面的 104~150px，横屏不会因为 rpx 基准换成大宽度而撑破屏。 */
.dialogue {
  top: auto;
  bottom: 24rpx;
  left: 24rpx;
  right: 24rpx;
  width: auto;
  min-height: 16%;
  padding: 32rpx 40rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(68, 68, 68, 0.27);
  border-radius: 24rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
}

/* NVL 累积层形态：容器抬升为阅读区（累积文本自上而下滚动） */
.dialogue.nvl-mode {
  min-height: 46%;
  display: flex;
  flex-direction: column;
}

.nvl-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  overflow-y: auto;
  min-height: 0;
}

.speaker {
  margin: 0 0 16rpx;
  font-weight: 600;
  font-size: 30rpx;
  letter-spacing: 1rpx;
}

.text {
  margin: 0;
  font-size: 34rpx;
  line-height: 1.7;
  white-space: pre-wrap;
}

/* 推进指示器：右下角闪烁（桌面对应 `.advance-hint`） */
.advance-hint {
  position: absolute;
  right: 24rpx;
  bottom: 16rpx;
  font-size: 26rpx;
  color: #7aa2f7;
  opacity: 0.9;
  animation: blink 1.2s infinite;
}

/* 选择层：与对话层同一张卡片形态，菜单或输入二选一 */
.choices {
  top: auto;
  bottom: 24rpx;
  left: 24rpx;
  right: 24rpx;
  width: auto;
  padding: 32rpx 40rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(68, 68, 68, 0.27);
  border-radius: 24rpx;
  background: rgba(30, 30, 46, 0.92);
  color: #e6e6f0;
}

.layer-prompt {
  margin: 0 0 20rpx;
  color: #9aa5ce;
  text-align: center;
  font-size: 30rpx;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
  justify-content: center;
}

.option {
  padding: 16rpx 32rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 20rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
  font-size: 30rpx;
  text-align: center;
}

.option:active {
  background: rgba(60, 80, 130, 0.72);
}

.input-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.input-box {
  flex: 1;
  padding: 16rpx 24rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 20rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
  font-size: 30rpx;
}

.submit {
  padding: 16rpx 32rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 20rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
  font-size: 30rpx;
}

/* 通知层：贴右上角的一条条气泡（桌面对应 NotificationLayer），不吃点击 */
.notices {
  top: 24rpx;
  left: auto;
  right: 24rpx;
  width: auto;
  max-width: 560rpx;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 16rpx;
  pointer-events: none;
}

.notice {
  padding: 16rpx 28rpx;
  border-radius: 16rpx;
  background: rgba(42, 47, 69, 0.87);
  color: #9ece6a;
  font-size: 26rpx;
}

/* 通知层皮肤：按 tone 换色（与桌面的 .tpl-notify-* 同名同色） */
.notice.tpl-notify-warning {
  color: #e0af68;
}

.notice.tpl-notify-error {
  color: #f7768e;
}

/* 对话模板皮肤：居中独白形态（与桌面的 .tpl-center 同名同色） */
.dialogue.tpl-center {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 1.15em;
  background: rgba(22, 22, 30, 0.8);
  border-color: rgba(122, 162, 247, 0.27);
}

/* 编号选项皮肤：整行靠左（序号由模板正文自带） */
.choices.tpl-choice-numbered .option {
  text-align: left;
}

/*
 * 横屏：`rpx` 的基准是窗口宽度，横过来宽度变大、同一串 rpx 会被放大（字号与内边距都涨），
 * 而屏幕高度反而变小。所以方向相关的排版在横屏下改用 px 定值，与桌面面板的 px/clamp 同一量级；
 * 竖屏继续用 rpx（平台惯例）。层高用百分比随视口，两种方向都不会撑破屏。
 */
@media (orientation: landscape) {
  .dialogue,
  .choices {
    bottom: 12px;
    left: 12px;
    right: 12px;
    padding: 12px 16px;
    border-width: 1px;
    border-radius: 12px;
  }

  .speaker {
    margin: 0 0 6px;
    font-size: 15px;
    letter-spacing: 0;
  }

  .text,
  .layer-prompt,
  .option,
  .input-box,
  .submit {
    font-size: 16px;
  }

  .advance-hint {
    right: 12px;
    bottom: 8px;
    font-size: 13px;
  }

  .choice-row {
    gap: 10px;
  }

  .layer-prompt {
    margin-bottom: 10px;
  }

  .option,
  .submit {
    padding: 8px 16px;
    border-width: 1px;
    border-radius: 10px;
  }

  .input-row {
    gap: 10px;
  }

  .input-box {
    padding: 8px 12px;
    border-width: 1px;
    border-radius: 10px;
  }

  .notices {
    top: 12px;
    right: 12px;
    max-width: 320px;
    gap: 8px;
  }

  .notice {
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
  }
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
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
