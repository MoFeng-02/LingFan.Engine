<script setup lang="ts">
/**
 * 设置面板：音量（逐通道）/ 静音 / 字速，读写一律经玩家偏好层。
 *
 * 组件只管渲染与转发：偏好实例由页面在宿主装配后交进来（`host.preferences`），这里不碰
 * 引擎、不直接落盘——`setVolume` / `setMuted` / `setTextSpeed` 都走偏好层，防抖持久化与
 * 「音量 = op 音量 × 通道偏好」的合成都在那一处。偏好不是 Vue 响应式对象，镜像进 ref 再
 * 订阅 `onChange` 回填，滑杆拖动与外部改动（如读档后）都走同一条同步路径。
 *
 * 通道清单取核心 `AUDIO_CHANNELS`（单一事实源），标签是本宿主的展示文案；字速滑杆范围与
 * 桌面宿主偏好面板同口径（1–80 字符/秒）。
 */
import {
  AUDIO_CHANNELS,
  DEFAULT_PLAYER_PREFS,
  type AudioChannel,
  type PlayerPreferences,
} from "@lingfan-engine/core";
import { onUnmounted, ref, watch } from "vue";
import SettingsExtras from "./SettingsExtras.vue";

const props = defineProps<{
  /** 玩家偏好实例：宿主装配完成前为 null（面板此时不展开） */
  preferences: PlayerPreferences | null;
  /** 面板是否展开：false = 只留入口按钮 */
  open: boolean;
  /** 宿主静态文案翻译（语言门面的 t）：不给则原文直出 */
  translate?: (text: string) => string;
}>();

const emit = defineEmits<{
  /** 点入口按钮：展开面板 */
  open: [];
  /** 关闭面板 */
  close: [];
}>();

/** 通道展示标签（核心只给通道枚举，文案归宿主） */
const CHANNEL_LABELS: Record<AudioChannel, string> = {
  bgm: "BGM",
  se: "音效",
  ambient: "环境",
  voice: "语音",
};

/** 偏好镜像：偏好层不是响应式对象，订阅 onChange 回填这几个 ref */
const volumes = ref<Record<AudioChannel, number>>({
  ...DEFAULT_PLAYER_PREFS.volumes,
});
const muted = ref(DEFAULT_PLAYER_PREFS.muted);
const textSpeed = ref(DEFAULT_PLAYER_PREFS.textSpeed);

let stopWatch: (() => void) | null = null;

/** 从偏好层现读一份快照填进镜像（滑杆与开关的当前值都从这里来） */
function sync(): void {
  const prefs = props.preferences;
  if (prefs === null) return;
  const snapshot = prefs.snapshot();
  volumes.value = { ...snapshot.volumes };
  muted.value = snapshot.muted;
  textSpeed.value = snapshot.textSpeed;
}

// 偏好实例可能在装配后才到位：盯住它，到位即同步并订阅，换实例先退旧的订阅
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

/** 静态文案翻译：只包宿主字面量 */
function t(text: string): string {
  return props.translate?.(text) ?? text;
}

/** 滑杆百分比 ↔ 偏好 0–1 音量（滑杆用整数刻度，偏好存比例） */
function volumePercent(channel: AudioChannel): number {
  return Math.round(volumes.value[channel] * 100);
}

/** 拖动音量滑杆：写回偏好层（合成与落盘都在那一处），onChange 回填镜像 */
function onVolume(
  channel: AudioChannel,
  event: { detail: { value: number } },
): void {
  props.preferences?.setVolume(channel, event.detail.value / 100);
}

/** 静音开关：写回偏好层（静音把一切有效音量归零） */
function onMute(event: { detail: { value: boolean } }): void {
  props.preferences?.setMuted(event.detail.value);
}

/** 字速滑杆：写回偏好层（归属由 textSpeedSource 声明，下一句即生效） */
function onTextSpeed(event: { detail: { value: number } }): void {
  props.preferences?.setTextSpeed(event.detail.value);
}
</script>

<template>
  <view class="settings">
    <view
      v-if="!open"
      class="entry"
      aria-label="打开设置面板"
      @tap.stop="emit('open')"
    >
      {{ t("设置") }}
    </view>

    <view v-if="open" class="sheet">
      <view class="sheet-title">{{ t("设置") }}</view>

      <view v-for="channel in AUDIO_CHANNELS" :key="channel" class="row">
        <view class="row-label">{{ t(CHANNEL_LABELS[channel]) }}</view>
        <slider
          class="row-slider"
          :aria-label="`${t(CHANNEL_LABELS[channel])}音量`"
          :value="volumePercent(channel)"
          :min="0"
          :max="100"
          :step="1"
          :disabled="muted"
          @change="onVolume(channel, $event)"
        />
        <view class="row-value">{{ volumePercent(channel) }}</view>
      </view>

      <view class="row">
        <view class="row-label">{{ t("静音") }}</view>
        <switch :aria-label="t('静音')" :checked="muted" @change="onMute" />
      </view>

      <view class="row">
        <view class="row-label">{{ t("字速") }}</view>
        <slider
          class="row-slider"
          :aria-label="t('字速')"
          :value="textSpeed"
          :min="1"
          :max="80"
          :step="1"
          @change="onTextSpeed"
        />
        <view class="row-value">{{ textSpeed }}</view>
      </view>

      <!-- 扩展偏好控件组（主音量/文本/显示 + 缓办禁用占位）：独立组件 -->
      <SettingsExtras :preferences="preferences" :translate="translate" />

      <view class="close" aria-label="关闭设置面板" @tap.stop="emit('close')">
        {{ t("关闭") }}
      </view>
    </view>
  </view>
</template>

<style>
/* 入口在存读条下方：左上归存读、右上归语言与通知，设置往下顺延不抢位 */
.settings {
  position: absolute;
  left: 24rpx;
  top: 104rpx;
  pointer-events: auto;
}

.entry,
.close {
  padding: 12rpx 28rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 16rpx;
  background: rgba(30, 30, 46, 0.72);
  color: #e6e6f0;
  font-size: 26rpx;
  text-align: center;
}

.entry:active,
.close:active {
  background: rgba(60, 80, 130, 0.72);
}

/* 面板：卡片形态与存读面板同源（同一批色值） */
.sheet {
  width: 520rpx;
  padding: 24rpx 24rpx 16rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(68, 68, 68, 0.27);
  border-radius: 24rpx;
  background: rgba(30, 30, 46, 0.92);
  color: #e6e6f0;
}

.sheet-title {
  margin: 0 0 16rpx;
  color: #9aa5ce;
  font-size: 26rpx;
  text-align: center;
}

.row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 8rpx 0;
}

.row-label {
  width: 96rpx;
  font-size: 26rpx;
}

.row-slider {
  flex: 1;
  margin: 0;
}

.row-value {
  width: 64rpx;
  color: #9aa5ce;
  font-size: 24rpx;
  text-align: right;
}

.close {
  margin-top: 16rpx;
}
</style>
