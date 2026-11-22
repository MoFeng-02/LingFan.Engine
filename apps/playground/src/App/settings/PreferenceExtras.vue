<script setup lang="ts">
/**
 * 偏好面板的扩展控件组：主音量 + 文本/播放/显示偏好 + 缓办字段禁用占位。
 *
 * 只渲染真正接了消费的字段，写入一律经宿主给的偏好面板句柄（`PlayerPreferences`
 * 端口），显示读响应式快照镜像；值域引用核心契约常量，不抄第二份数字。契约已增、
 * 消费尚待后续批的字段（打字音效/窗口尺寸）画成禁用占位并附说明。
 *
 * 独立成组件是为了让设置面板群文件不超载；行布局样式自带一份（ scoped 不穿透）。
 */
import {
  AUTO_DELAY_MS_RANGE,
  DIALOGUE_HEIGHT_SCALE_RANGE,
  DIALOGUE_POSITIONS,
  ELEMENT_FITS,
  FONT_SCALE_RANGE,
  NVL_PAGE_SIZE_RANGE,
  TRANSITION_SPEED_RANGE,
  type PlayerPrefsData,
} from "@lingfan-engine/core";
import { storyFonts } from "virtual:story-fonts";
import type { PreferencesPanel } from "../../host";

const props = defineProps<{
  /** 偏好面板句柄（写入口；状态归核心层） */
  prefs: PreferencesPanel;
  /** 偏好快照的响应式镜像（显示读它） */
  prefsView: PlayerPrefsData;
}>();

/** 对话框位置显示名 */
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
  <div class="prefs-extras">
    <!-- 音频：主音量（渲染层经 effectiveVolume 自动乘入；静音时禁用） -->
    <label class="prefs-row">
      <span class="prefs-label">主音量</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="props.prefsView.masterVolume ?? 1"
        :disabled="props.prefsView.muted"
        @input="props.prefs.setMasterVolume($event)"
      />
      <span class="prefs-value"
        >{{ Math.round((props.prefsView.masterVolume ?? 1) * 100) }}%</span
      >
    </label>

    <!-- 文本：即时显示 + NVL 每页行数 -->
    <label class="prefs-row">
      <span class="prefs-label">即时文本</span>
      <input
        type="checkbox"
        :checked="props.prefsView.instantText ?? false"
        @change="props.prefs.setInstantText($event)"
      />
    </label>
    <label class="prefs-row">
      <span class="prefs-label">NVL 行数</span>
      <input
        type="range"
        :min="NVL_PAGE_SIZE_RANGE.min"
        :max="NVL_PAGE_SIZE_RANGE.max"
        step="1"
        :value="props.prefsView.nvlPageSize ?? NVL_PAGE_SIZE_RANGE.max"
        @input="props.prefs.setNvlPageSize($event)"
      />
      <span class="prefs-value"
        >{{ props.prefsView.nvlPageSize ?? NVL_PAGE_SIZE_RANGE.max }} 行</span
      >
    </label>

    <!-- 播放：自动播放意图 + 推进延时 + 快进遇未读即停（节奏循环按这些偏好装配） -->
    <label class="prefs-row">
      <span class="prefs-label">自动播放</span>
      <input
        type="checkbox"
        :checked="props.prefsView.autoEnabled ?? false"
        @change="props.prefs.setAutoEnabled($event)"
      />
    </label>
    <label class="prefs-row">
      <span class="prefs-label">自动延时</span>
      <input
        type="range"
        :min="AUTO_DELAY_MS_RANGE.min"
        :max="AUTO_DELAY_MS_RANGE.max"
        step="100"
        :value="props.prefsView.autoDelayMs ?? 1500"
        @input="props.prefs.setAutoDelayMs($event)"
      />
      <span class="prefs-value"
        >{{ ((props.prefsView.autoDelayMs ?? 1500) / 1000).toFixed(1) }} s</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">未读即停</span>
      <input
        type="checkbox"
        :checked="props.prefsView.skipUnseenOnly ?? false"
        title="快进只走已读文本，遇到未读即停"
        @change="props.prefs.setSkipUnseenOnly($event)"
      />
    </label>

    <!-- 文本外观：字体（工程注册表供给）与字速来源（玩家值或故事作者值） -->
    <label class="prefs-row">
      <span class="prefs-label">字体</span>
      <select
        :value="props.prefsView.fontFamily ?? ''"
        @change="props.prefs.setFontFamily($event)"
      >
        <option value="">默认</option>
        <option v-for="font in storyFonts" :key="font.name" :value="font.name">
          {{ font.name }}
        </option>
      </select>
    </label>
    <label class="prefs-row">
      <span class="prefs-label">字速源</span>
      <select
        :value="props.prefsView.textSpeedSource ?? ''"
        @change="props.prefs.setTextSpeedSource($event)"
      >
        <option value="">默认（玩家优先）</option>
        <option value="player">玩家优先</option>
        <option value="story">跟随故事</option>
      </select>
    </label>

    <!-- 显示：转场/抖动倍率、减弱动效、字号、对话框外观、元素填充默认 -->
    <label class="prefs-row">
      <span class="prefs-label">转场倍率</span>
      <input
        type="range"
        :min="TRANSITION_SPEED_RANGE.min"
        :max="TRANSITION_SPEED_RANGE.max"
        step="0.1"
        :value="props.prefsView.transitionSpeed ?? 1"
        @input="props.prefs.setTransitionSpeed($event)"
      />
      <span class="prefs-value"
        >{{ (props.prefsView.transitionSpeed ?? 1).toFixed(1) }}×</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">抖动强度</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="props.prefsView.shakeScale ?? 1"
        @input="props.prefs.setShakeScale($event)"
      />
      <span class="prefs-value"
        >{{ Math.round((props.prefsView.shakeScale ?? 1) * 100) }}%</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">减弱动效</span>
      <select
        :value="
          props.prefsView.reducedMotion === undefined
            ? ''
            : props.prefsView.reducedMotion
              ? 'on'
              : 'off'
        "
        @change="props.prefs.setReducedMotion($event)"
      >
        <option value="">跟随系统</option>
        <option value="on">开</option>
        <option value="off">关</option>
      </select>
    </label>
    <label class="prefs-row">
      <span class="prefs-label">字号倍率</span>
      <input
        type="range"
        :min="FONT_SCALE_RANGE.min"
        :max="FONT_SCALE_RANGE.max"
        step="0.05"
        :value="props.prefsView.fontScale ?? 1"
        @input="props.prefs.setFontScale($event)"
      />
      <span class="prefs-value"
        >{{ (props.prefsView.fontScale ?? 1).toFixed(2) }}×</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">框透明度</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="props.prefsView.dialogueOpacity ?? 1"
        @input="props.prefs.setDialogueOpacity($event)"
      />
      <span class="prefs-value"
        >{{ Math.round((props.prefsView.dialogueOpacity ?? 1) * 100) }}%</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">框位置</span>
      <select
        :value="props.prefsView.dialoguePosition ?? ''"
        @change="props.prefs.setDialoguePosition($event)"
      >
        <option value="">默认</option>
        <option v-for="p in DIALOGUE_POSITIONS" :key="p" :value="p">
          {{ positionLabel(p) }}
        </option>
      </select>
    </label>
    <label class="prefs-row">
      <span class="prefs-label">框高倍率</span>
      <input
        type="range"
        :min="DIALOGUE_HEIGHT_SCALE_RANGE.min"
        :max="DIALOGUE_HEIGHT_SCALE_RANGE.max"
        step="0.05"
        :value="props.prefsView.dialogueHeightScale ?? 1"
        @input="props.prefs.setDialogueHeightScale($event)"
      />
      <span class="prefs-value"
        >{{ (props.prefsView.dialogueHeightScale ?? 1).toFixed(2) }}×</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">填充默认</span>
      <select
        :value="props.prefsView.elementFit ?? ''"
        @change="props.prefs.setElementFit($event)"
      >
        <option value="">默认</option>
        <option v-for="fit in ELEMENT_FITS" :key="fit" :value="fit">
          {{ fit }}
        </option>
      </select>
    </label>

    <!-- 缓办字段：契约已在、消费待后续批，禁用占位 + 说明（不留活控件死配置） -->
    <label class="prefs-row is-deferred">
      <span class="prefs-label">打字音效</span>
      <input type="checkbox" disabled title="待打字机音效接线后启用" />
    </label>
    <label class="prefs-row is-deferred">
      <span class="prefs-label">窗口尺寸</span>
      <input type="checkbox" disabled title="待桌面壳窗口能力接线后启用" />
    </label>
  </div>
</template>

<style scoped>
/* 行布局与设置面板群一致（scoped 不穿透，自带一份）；尺寸按 em 相对折算 */
.prefs-extras .prefs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  font-size: 0.85em;
  color: #a9b1d6;
}

.prefs-extras .prefs-label {
  width: 4.5em;
  flex: none;
}

.prefs-extras input[type="range"] {
  flex: 1;
  accent-color: #7aa2f7;
}

.prefs-extras select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid #343a52;
  border-radius: 4px;
  background: #1a2030;
  color: #a9b1d6;
}

.prefs-extras .prefs-value {
  width: 3.5em;
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.prefs-extras .is-deferred {
  opacity: 0.55;
}
</style>
