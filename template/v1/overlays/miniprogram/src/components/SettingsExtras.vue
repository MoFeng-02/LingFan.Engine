<script setup lang="ts">
/**
 * 设置面板的扩展控件组：主音量 + 文本/显示偏好 + 缓办字段禁用占位。
 *
 * 只渲染本宿主真正接了消费的字段（小程序不渲染转场/震动，故无动效倍率控件）；写入一律经
 * 玩家偏好层，显示读镜像 ref（订阅 onChange 回填）。值域引用核心契约常量，不抄第二份数字。
 * 契约已增、消费尚待后续批的字段画成禁用占位并附说明。
 */
import {
  DIALOGUE_HEIGHT_SCALE_RANGE,
  DIALOGUE_POSITIONS,
  ELEMENT_FITS,
  FONT_SCALE_RANGE,
  NVL_PAGE_SIZE_RANGE,
  type PlayerPreferences,
} from "@lingfan-engine/core";
import { onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  /** 玩家偏好实例：宿主装配完成前为 null */
  preferences: PlayerPreferences | null;
  /** 宿主静态文案翻译 */
  translate?: (text: string) => string;
}>();

/** 扩展字段镜像（偏好层非响应式，订阅 onChange 回填） */
const masterVolume = ref(1);
const instantText = ref(false);
const nvlPageSize = ref(NVL_PAGE_SIZE_RANGE.max);
const fontScale = ref(1);
const dialogueOpacity = ref(1);
const dialogueHeightScale = ref(1);
const dialoguePosition = ref("");
const elementFit = ref("");

let stopWatch: (() => void) | null = null;

function sync(): void {
  const prefs = props.preferences;
  if (prefs === null) return;
  const s = prefs.snapshot();
  masterVolume.value = s.masterVolume ?? 1;
  instantText.value = s.instantText ?? false;
  nvlPageSize.value = s.nvlPageSize ?? NVL_PAGE_SIZE_RANGE.max;
  fontScale.value = s.fontScale ?? 1;
  dialogueOpacity.value = s.dialogueOpacity ?? 1;
  dialogueHeightScale.value = s.dialogueHeightScale ?? 1;
  dialoguePosition.value = s.dialoguePosition ?? "";
  elementFit.value = s.elementFit ?? "";
}

watch(
  () => props.preferences,
  (prefs) => {
    stopWatch?.();
    stopWatch = null;
    if (prefs !== null) {
      sync();
      stopWatch = prefs.onChange(sync);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  stopWatch?.();
  stopWatch = null;
});

function t(text: string): string {
  return props.translate?.(text) ?? text;
}

function onMasterVolume(event: { detail: { value: number } }): void {
  props.preferences?.setMasterVolume(event.detail.value / 100);
}
function onInstantText(event: { detail: { value: boolean } }): void {
  props.preferences?.setInstantText(event.detail.value);
}
function onNvlPageSize(event: { detail: { value: number } }): void {
  props.preferences?.setNvlPageSize(event.detail.value);
}
function onFontScale(event: { detail: { value: number } }): void {
  props.preferences?.setFontScale(event.detail.value / 100);
}
function onDialogueOpacity(event: { detail: { value: number } }): void {
  props.preferences?.setDialogueOpacity(event.detail.value / 100);
}
function onDialogueHeightScale(event: { detail: { value: number } }): void {
  props.preferences?.setDialogueHeightScale(event.detail.value / 100);
}
function pickPosition(value: string): void {
  if (value === "") props.preferences?.clearDialoguePosition();
  else
    props.preferences?.setDialoguePosition(
      value as "bottom" | "top" | "center",
    );
}
function pickFit(value: string): void {
  if (value === "") props.preferences?.clearElementFit();
  else props.preferences?.setElementFit(value as (typeof ELEMENT_FITS)[number]);
}

/** 位置显示名 */
function positionLabel(position: string): string {
  switch (position) {
    case "bottom":
      return "底部";
    case "top":
      return "顶部";
    case "center":
      return "居中";
    default:
      return position;
  }
}
</script>

<template>
  <view class="extras">
    <view class="row">
      <view class="row-label">{{ t("主音量") }}</view>
      <slider
        class="row-slider"
        :aria-label="t('主音量')"
        :value="Math.round(masterVolume * 100)"
        :min="0"
        :max="100"
        :step="1"
        @change="onMasterVolume"
      />
      <view class="row-value">{{ Math.round(masterVolume * 100) }}</view>
    </view>

    <view class="row">
      <view class="row-label">{{ t("即时文本") }}</view>
      <switch
        :aria-label="t('即时文本')"
        :checked="instantText"
        @change="onInstantText"
      />
    </view>

    <view class="row">
      <view class="row-label">{{ t("NVL 行数") }}</view>
      <slider
        class="row-slider"
        :aria-label="t('NVL 行数')"
        :value="nvlPageSize"
        :min="NVL_PAGE_SIZE_RANGE.min"
        :max="NVL_PAGE_SIZE_RANGE.max"
        :step="1"
        @change="onNvlPageSize"
      />
      <view class="row-value">{{ nvlPageSize }}</view>
    </view>

    <view class="row">
      <view class="row-label">{{ t("字号倍率") }}</view>
      <slider
        class="row-slider"
        :aria-label="t('字号倍率')"
        :value="Math.round(fontScale * 100)"
        :min="FONT_SCALE_RANGE.min * 100"
        :max="FONT_SCALE_RANGE.max * 100"
        :step="5"
        @change="onFontScale"
      />
      <view class="row-value">{{ fontScale.toFixed(2) }}×</view>
    </view>

    <view class="row">
      <view class="row-label">{{ t("框透明度") }}</view>
      <slider
        class="row-slider"
        :aria-label="t('框透明度')"
        :value="Math.round(dialogueOpacity * 100)"
        :min="0"
        :max="100"
        :step="5"
        @change="onDialogueOpacity"
      />
      <view class="row-value">{{ Math.round(dialogueOpacity * 100) }}</view>
    </view>

    <view class="row">
      <view class="row-label">{{ t("框高倍率") }}</view>
      <slider
        class="row-slider"
        :aria-label="t('框高倍率')"
        :value="Math.round(dialogueHeightScale * 100)"
        :min="DIALOGUE_HEIGHT_SCALE_RANGE.min * 100"
        :max="DIALOGUE_HEIGHT_SCALE_RANGE.max * 100"
        :step="5"
        @change="onDialogueHeightScale"
      />
      <view class="row-value">{{ dialogueHeightScale.toFixed(2) }}×</view>
    </view>

    <view class="row">
      <view class="row-label">{{ t("框位置") }}</view>
      <view class="chips">
        <view
          class="chip"
          :class="{ on: dialoguePosition === '' }"
          @tap.stop="pickPosition('')"
          >{{ t("默认") }}</view
        >
        <view
          v-for="p in DIALOGUE_POSITIONS"
          :key="p"
          class="chip"
          :class="{ on: dialoguePosition === p }"
          @tap.stop="pickPosition(p)"
          >{{ t(positionLabel(p)) }}</view
        >
      </view>
    </view>

    <view class="row">
      <view class="row-label">{{ t("填充默认") }}</view>
      <view class="chips">
        <view
          class="chip"
          :class="{ on: elementFit === '' }"
          @tap.stop="pickFit('')"
          >{{ t("默认") }}</view
        >
        <view
          v-for="fit in ELEMENT_FITS"
          :key="fit"
          class="chip"
          :class="{ on: elementFit === fit }"
          @tap.stop="pickFit(fit)"
          >{{ fit }}</view
        >
      </view>
    </view>

    <!-- 缓办字段：契约已在、消费待后续批，禁用占位 + 说明 -->
    <view class="row deferred">
      <view class="row-label">{{ t("打字音效") }}</view>
      <switch :aria-label="t('打字音效')" :checked="false" disabled />
    </view>
    <view class="row deferred">
      <view class="row-label">{{ t("窗口尺寸") }}</view>
      <switch :aria-label="t('窗口尺寸')" :checked="false" disabled />
    </view>
    <view class="row deferred">
      <view class="row-label">{{ t("字体") }}</view>
      <switch :aria-label="t('字体')" :checked="false" disabled />
    </view>
    <view class="row deferred">
      <view class="row-label">{{ t("自动播放") }}</view>
      <switch :aria-label="t('自动播放')" :checked="false" disabled />
    </view>
    <view class="row deferred">
      <view class="row-label">{{ t("快进") }}</view>
      <switch :aria-label="t('快进')" :checked="false" disabled />
    </view>
  </view>
</template>

<style>
.extras .row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 12rpx 0;
}

.extras .row-label {
  width: 140rpx;
  flex: none;
  font-size: 26rpx;
  color: #a9b1d6;
}

.extras .row-slider {
  flex: 1;
  margin: 0;
}

.extras .row-value {
  width: 90rpx;
  flex: none;
  text-align: right;
  font-size: 24rpx;
  color: #e6e6f0;
  font-variant-numeric: tabular-nums;
}

.extras .chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  flex: 1;
}

.extras .chip {
  padding: 6rpx 16rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.35);
  border-radius: 12rpx;
  font-size: 22rpx;
  color: #a9b1d6;
}

.extras .chip.on {
  background: rgba(122, 162, 247, 0.3);
  color: #e6e6f0;
}

.extras .deferred {
  opacity: 0.55;
}
</style>
