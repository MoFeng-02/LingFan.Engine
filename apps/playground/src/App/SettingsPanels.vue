<script setup lang="ts">
/**
 * 设置面板群：历史回溯、玩家偏好、多槽位存读。
 *
 * 三块共用 `history-panel` 外壳（同一处定位与滚动约定），故由同一文件承载。
 * 面板只渲染宿主给出的视图数据：回溯、改写偏好、写读槽位都回抛宿主，
 * 状态归核心层，读盘与写盘归引擎命令面。
 */
import {
  DEFAULT_KEYMAP,
  type AudioChannel,
  type HostInfo,
  type KeymapAction,
  type LayerZTable,
  type PlayerPrefsData,
} from "@lingfan/engine";
import { renderDialogueLine } from "@lingfan/ui";
import type { HistoryBlock, SlotPanelMode, SlotView } from "../host";

defineProps<{
  /** 层级（z 序）：三块各取自己的层 */
  layerZ: LayerZTable;
  /** 历史面板是否展开 */
  showHistory: boolean;
  /** 历史条目经连续累积行聚合后的呈现块 */
  historyBlocks: HistoryBlock[];
  /** 偏好面板是否展开 */
  showPrefs: boolean;
  /** 偏好快照的响应式镜像（模板读它，才会在偏好变化时重渲染） */
  prefsView: PlayerPrefsData;
  /** 音量通道表（面板行） */
  prefChannels: ReadonlyArray<{ channel: AudioChannel; label: string }>;
  /** 正在等待按键的动作（null = 未在捕获） */
  captureAction: KeymapAction | null;
  /** 绑定键位的可读显示（多键以「 / 」连接） */
  displayKeys: (keys: readonly string[]) => string;
  /** 槽位面板形态（null = 关闭） */
  slotPanel: SlotPanelMode | null;
  /** 槽位视图（标题与缩略图随档存储） */
  slotViews: SlotView[];
  /** 宿主事实（os/form，只读展示） */
  host: HostInfo;
}>();

/** 事件出口：设置项变更与动作逐项上抛（回滚 / 音量 / 静音 / 字速 / 横竖屏 / 全屏 / 按键捕获等），父层负责落地。 */
const emit = defineEmits<{
  "rollback-to-entry": [index: number];
  "set-pref-volume": [channel: AudioChannel, event: Event];
  "set-pref-muted": [event: Event];
  "set-pref-text-speed": [event: Event];
  "set-pref-orientation": [event: Event];
  "set-pref-fullscreen": [event: Event];
  "start-capture": [action: KeymapAction];
  "reset-keybinding": [action: KeymapAction];
  "choose-slot": [view: SlotView];
}>();
</script>

<template>
  <!-- 历史面板：累积段聚合为块，块级回溯 = 块尾检查点（同走统一渲染接缝） -->
  <section
    v-if="showHistory"
    class="history-panel"
    data-ui-zone
    :style="{ zIndex: layerZ.history }"
  >
    <p class="layer-prompt">历史</p>
    <ul>
      <li
        v-for="block in historyBlocks"
        :key="block.key"
        @click.stop="emit('rollback-to-entry', block.index)"
      >
        <span v-if="block.speaker" class="history-speaker"
          >{{ block.speaker }}：</span
        ><span
          v-if="!block.nvl"
          class="history-text"
          v-html="renderDialogueLine({ text: block.lines[0] ?? '' }).html"
        ></span>
        <div v-else class="history-nvl">
          <p
            v-for="(line, i) in block.lines"
            :key="i"
            class="history-text"
            v-html="renderDialogueLine({ text: line }).html"
          ></p>
        </div>
      </li>
    </ul>
  </section>
  <!-- 玩家偏好面板：与存档分离，独立持久化，不随档变动 -->
  <section
    v-if="showPrefs"
    class="history-panel prefs-panel"
    data-ui-zone
    :style="{ zIndex: layerZ.prefs }"
    @click.stop
  >
    <p class="layer-prompt">设置</p>
    <label v-for="c in prefChannels" :key="c.channel" class="prefs-row">
      <span class="prefs-label">{{ c.label }}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="prefsView.volumes[c.channel]"
        :disabled="prefsView.muted"
        @input="emit('set-pref-volume', c.channel, $event)"
      />
      <span class="prefs-value"
        >{{ Math.round(prefsView.volumes[c.channel] * 100) }}%</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">静音</span>
      <input
        type="checkbox"
        :checked="prefsView.muted"
        @change="emit('set-pref-muted', $event)"
      />
    </label>
    <label class="prefs-row">
      <span class="prefs-label">文字速度</span>
      <input
        type="range"
        min="1"
        max="80"
        step="1"
        :value="prefsView.textSpeed"
        @input="emit('set-pref-text-speed', $event)"
      />
      <span class="prefs-value"
        >{{ Math.round(prefsView.textSpeed) }} 字/秒</span
      >
    </label>
    <label class="prefs-row">
      <span class="prefs-label">屏幕方向</span>
      <select
        :value="prefsView.orientation ?? ''"
        @change="emit('set-pref-orientation', $event)"
      >
        <option value="">跟随工程</option>
        <option value="auto">跟随系统</option>
        <option value="portrait">竖屏</option>
        <option value="landscape">横屏</option>
      </select>
    </label>
    <div class="prefs-row">
      <span class="prefs-label">推进键</span>
      <button
        type="button"
        class="prefs-key"
        :class="{ capturing: captureAction === 'advance' }"
        @click.stop="emit('start-capture', 'advance')"
      >
        {{
          captureAction === "advance"
            ? "按任意键（Esc 取消）"
            : displayKeys(prefsView.keymap?.advance ?? DEFAULT_KEYMAP.advance)
        }}
      </button>
      <button
        type="button"
        class="prefs-key-reset"
        @click.stop="emit('reset-keybinding', 'advance')"
      >
        默认
      </button>
    </div>
    <div class="prefs-row">
      <span class="prefs-label">历史键</span>
      <button
        type="button"
        class="prefs-key"
        :class="{ capturing: captureAction === 'history' }"
        @click.stop="emit('start-capture', 'history')"
      >
        {{
          captureAction === "history"
            ? "按任意键（Esc 取消）"
            : displayKeys(prefsView.keymap?.history ?? DEFAULT_KEYMAP.history)
        }}
      </button>
      <button
        type="button"
        class="prefs-key-reset"
        @click.stop="emit('reset-keybinding', 'history')"
      >
        默认
      </button>
    </div>
    <label class="prefs-row">
      <span class="prefs-label">全屏</span>
      <input
        type="checkbox"
        :checked="prefsView.fullscreen ?? false"
        @change="emit('set-pref-fullscreen', $event)"
      />
    </label>
    <label class="prefs-row">
      <span class="prefs-label">宿主</span>
      <span class="prefs-value">{{ host.os }} · {{ host.form }}</span>
    </label>
  </section>
  <!-- 多槽位面板：存/读共用；槽位数 = shell.saves.slots，缩略图随档存储 -->
  <section v-if="slotPanel" class="history-panel saves-panel" data-ui-zone @click.stop>
    <p class="layer-prompt">{{ slotPanel === "save" ? "保存到槽位" : "读取槽位" }}</p>
    <div class="slot-grid">
      <button
        v-for="v in slotViews"
        :key="v.id"
        type="button"
        class="slot-cell"
        @click.stop="emit('choose-slot', v)"
      >
        <img v-if="v.screenshot" :src="v.screenshot" alt="" />
        <span v-else class="slot-empty">空</span>
        <span class="slot-label">{{ v.label }}</span>
        <span v-if="v.title" class="slot-title">{{ v.title }}</span>
        <span v-if="v.timestamp" class="slot-time">{{
          new Date(v.timestamp).toLocaleString()
        }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
/** 设置面板样式：存档槽格网与各设置分区的控件外观、布局与交互态。 */

.saves-panel {
  width: min(92vw, 560px);
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.slot-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #16161f;
  color: #a9b1d6;
  font-size: 0.8em;
  text-align: left;
  cursor: pointer;
}

.slot-cell:hover {
  border-color: #7aa2f7;
}

.slot-cell img {
  width: 100%;
  border-radius: 6px;
}

.slot-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 56px;
  border: 1px dashed #4448;
  border-radius: 6px;
  color: #565f89;
}

.slot-title {
  color: #e6e6f0;
}

.history-panel {
  position: fixed;
  top: calc(60px + env(safe-area-inset-top));
  left: calc(16px + env(safe-area-inset-left));
  width: min(80vw, 360px);
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid #4448;
  border-radius: 12px;
  background: #1e1e2eee;
  box-sizing: border-box;
  padding: 12px;
}

.history-panel ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-panel li {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85em;
  color: #a9b1d6;
}

.history-panel li:hover {
  background: #26263a;
}

.history-speaker {
  font-weight: 600;
  color: #7aa2f7;
}

.layer-prompt {
  margin: 0 0 10px;
  color: #9aa5ce;
  text-align: center;
}

/* 偏好面板：行式布局（label/div + 滑块/按钮 + 数值） */
.prefs-panel .prefs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  font-size: 0.85em;
  color: #a9b1d6;
}

.prefs-row .prefs-label {
  width: 4.5em;
  flex: none;
}

.prefs-row input[type="range"] {
  flex: 1;
  accent-color: #7aa2f7;
}

.prefs-row .prefs-value {
  width: 3.5em;
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.prefs-row .prefs-key {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 4px 8px;
  border: 1px solid #343a52;
  border-radius: 4px;
  background: #1a2030;
  color: #a9b1d6;
  cursor: pointer;
}

.prefs-row .prefs-key.capturing {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

.prefs-row .prefs-key-reset {
  flex: none;
  padding: 4px 8px;
  border: 1px solid #343a52;
  border-radius: 4px;
  background: transparent;
  color: #565f89;
  cursor: pointer;
}
</style>
