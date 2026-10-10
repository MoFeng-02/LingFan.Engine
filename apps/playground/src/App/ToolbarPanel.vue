<script setup lang="ts">
/**
 * 工具条：重开、存读档入口、历史与设置开关、语言选择。
 *
 * 面板只渲染控件并把用户动作回抛宿主——整体重建引擎、按需载入译文、槽位读盘
 * 都不是展示层能自持的事，状态与命令一律留在组合根。
 */
import type { LayerZTable } from "@lingfan/engine";
import type { SlotPanelMode } from "../host";

defineProps<{
  /** 层级（z 序）：工具条取 `toolbar` 层 */
  layerZ: LayerZTable;
  /** 已扫描到的可用语言；不足两种时选择器不出现 */
  availableLangs: string[];
  /** 当前语言（空串 = 跟随默认） */
  currentLang: string;
}>();

/** 事件出口：重启 / 打开槽位面板 / 历史 / 偏好 / 语言切换逐项上抛，父层负责落地。 */
const emit = defineEmits<{
  restart: [];
  "open-slot-panel": [mode: SlotPanelMode];
  "toggle-history": [];
  "toggle-prefs": [];
  "change-lang": [lang: string];
}>();
</script>

<template>
  <div class="toolbar" data-ui-zone :style="{ zIndex: layerZ.toolbar }">
    <!-- fail-closed 停机恢复入口：整体重建引擎（正式形态为读档/回标题命令面） -->
    <button
      class="restart"
      type="button"
      title="重新开始"
      aria-label="重新开始"
      @click.stop="emit('restart')"
    >
      ↻
    </button>
    <div class="save-load">
      <button
        type="button"
        title="保存到槽位"
        @click.stop="emit('open-slot-panel', 'save')"
      >
        存
      </button>
      <button
        type="button"
        title="读取槽位"
        @click.stop="emit('open-slot-panel', 'load')"
      >
        读
      </button>
    </div>
    <!-- 历史面板开关（H 键） -->
    <button
      class="history-toggle"
      type="button"
      title="历史（H）"
      aria-label="历史面板"
      @click.stop="emit('toggle-history')"
    >
      ☰
    </button>
    <!-- 玩家偏好面板开关 -->
    <button
      class="history-toggle"
      type="button"
      title="设置"
      aria-label="设置面板"
      @click.stop="emit('toggle-prefs')"
    >
      ⚙
    </button>
    <!-- 语言选择（Lang/ 目录扫描供给；切换 = setLanguage 按需载入译文） -->
    <select
      v-if="availableLangs.length > 1"
      class="lang-select"
      :value="currentLang"
      title="语言"
      @click.stop
      @change.stop="emit('change-lang', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">默认</option>
      <option v-for="lang in availableLangs" :key="lang" :value="lang">
        {{ lang }}
      </option>
    </select>
  </div>
</template>

<style scoped>
/** 工具栏样式：固定角落的工具条与按钮组（重启 / 存读档 / 历史 / 偏好 / 语言）的外观与交互态。 */

.toolbar {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top));
  left: calc(16px + env(safe-area-inset-left));
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.restart {
  width: 36px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 16px;
  cursor: pointer;
}

.restart:hover {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

.save-load {
  display: flex;
  gap: 6px;
}

.lang-select {
  padding: 5px 8px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 12px;
  cursor: pointer;
}

.save-load button {
  padding: 6px 12px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 13px;
  cursor: pointer;
}

.save-load button:hover {
  border-color: #9ece6a;
  color: #9ece6a;
}

.history-toggle {
  width: 36px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 16px;
  cursor: pointer;
}

.history-toggle:hover {
  border-color: #7aa2f7;
  color: #7aa2f7;
}
</style>
