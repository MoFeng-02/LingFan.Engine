<script setup lang="ts">
/**
 * 工具条：重开、存读档入口、Auto/Skip 快捷切换、历史与设置开关、语言选择。
 *
 * 面板只渲染控件并把用户动作回抛宿主——整体重建引擎、按需载入译文、槽位读盘
 * 都不是展示层能自持的事，状态与命令一律留在组合根。
 */
import type { LayerZTable } from "@lingfan-engine/core";
import type { SlotPanelMode } from "../host";

const props = defineProps<{
  /** 层级（z 序）：工具条取 `toolbar` 层 */
  layerZ: LayerZTable;
  /** 已扫描到的可用语言；不足两种时选择器不出现 */
  availableLangs: string[];
  /** 当前语言（空串 = 跟随默认） */
  currentLang: string;
  /** 宿主静态文案查表（门面 t：未命中原样返回；不传 = 原文直出） */
  t?: (text: string) => string;
  /** 自动播放意图态（偏好 autoEnabled 的镜像）：亮 = 玩家已开启自动播放 */
  autoOn?: boolean;
  /** 快进运行态（引擎 skipActive 的镜像）：亮 = 正在快进 */
  skipOn?: boolean;
}>();

/** 静态文案本地化：经门面查当前语言译文；未注入翻译时保持原文（旧行为） */
const t = (text: string): string => props.t?.(text) ?? text;

/** 事件出口：重启 / 打开槽位面板 / Auto·Skip / 历史 / 偏好 / 语言切换逐项上抛，父层负责落地。 */
const emit = defineEmits<{
  restart: [];
  "open-slot-panel": [mode: SlotPanelMode];
  "toggle-auto": [];
  "toggle-skip": [];
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
      :title="t('重新开始')"
      :aria-label="t('重新开始')"
      @click.stop="emit('restart')"
    >
      ↻
    </button>
    <div class="save-load">
      <button
        type="button"
        :title="t('保存到槽位')"
        @click.stop="emit('open-slot-panel', 'save')"
      >
        {{ t("存") }}
      </button>
      <button
        type="button"
        :title="t('读取槽位')"
        @click.stop="emit('open-slot-panel', 'load')"
      >
        {{ t("读") }}
      </button>
    </div>
    <!-- Auto/Skip 快捷切换（Ren'Py 快捷菜单口径）：Auto 切偏好里的自动播放意图，
         Skip 切快进运行态；激活态高亮，与键盘按住快进、偏好面板同一事实源 -->
    <div class="auto-skip">
      <button
        type="button"
        :class="{ 'is-on': autoOn }"
        :aria-pressed="autoOn ?? false"
        :title="t('自动播放')"
        @click.stop="emit('toggle-auto')"
      >
        Auto
      </button>
      <button
        type="button"
        :class="{ 'is-on': skipOn }"
        :aria-pressed="skipOn ?? false"
        :title="t('快进')"
        @click.stop="emit('toggle-skip')"
      >
        Skip
      </button>
    </div>
    <!-- 历史面板开关（H 键） -->
    <button
      class="history-toggle"
      type="button"
      :title="t('历史（H）')"
      :aria-label="t('历史面板')"
      @click.stop="emit('toggle-history')"
    >
      ☰
    </button>
    <!-- 玩家偏好面板开关 -->
    <button
      class="history-toggle"
      type="button"
      :title="t('设置')"
      :aria-label="t('设置面板')"
      @click.stop="emit('toggle-prefs')"
    >
      ⚙
    </button>
    <!-- 语言选择（Lang/ 目录扫描供给；切换 = setLanguage 按需载入译文） -->
    <select
      v-if="availableLangs.length > 1"
      class="lang-select"
      :value="currentLang"
      :title="t('语言')"
      @click.stop
      @change.stop="
        emit('change-lang', ($event.target as HTMLSelectElement).value)
      "
    >
      <option value="">{{ t("默认") }}</option>
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
  /* UI 层（窗口坐标系）：贴窗口左上角，随窗口收放留边，safe-area 适配移动端 */
  top: calc(clamp(10px, 1.6vh, 18px) + env(safe-area-inset-top));
  left: calc(clamp(12px, 2.4vw, 22px) + env(safe-area-inset-left));
  display: flex;
  gap: 8px;
  align-items: stretch;
  pointer-events: auto;
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

.auto-skip {
  display: flex;
  gap: 6px;
}

.auto-skip button {
  padding: 6px 12px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 13px;
  cursor: pointer;
}

.auto-skip button:hover {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

/* 激活态：常亮主色（与 hover 同色但常驻），一眼看出 Auto/Skip 正开着 */
.auto-skip button.is-on {
  border-color: #7aa2f7;
  background: #7aa2f733;
  color: #7aa2f7;
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
