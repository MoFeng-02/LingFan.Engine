<script setup lang="ts">
/**
 * 状态栏（底部）：**工程级**事实的常驻出口。
 *
 * 放什么（只放其他视图不展示的事实，避免重复信息）：
 * 资源根路径 · 宿主能力（本地服务/浏览器）· 已打开文档数与脏数 · 诊断计数。
 * 诊断**计数**在中栏/顶栏也有 ⇒ 这里只作「同一口径的第二处可读点」，
 * 真正的信息增量是**宿主能力**与**脏文件数**（顶栏只有「是否脏」，这里有「几个」）。
 *
 * 打包入口是**低频动作**（以分钟计），不该占右栏一级 tab；
 * 状态栏常驻**带文字标签**的按钮（非 icon-only，满足 a11y），
 * 打包中状态也在这里（长任务必须有存在感，切走面板也不丢进度感知）。
 */
import { computed } from "vue";
import type { DegradedOpen } from "@lingfan/engine";

const props = defineProps<{
  root: string;
  /** 宿主能力：有无本地服务（能力探测式降级的显式化） */
  localHost: boolean;
  documentCount: number;
  dirtyCount: number;
  errorCount: number;
  warningCount: number;
  /** 打包请求进行中（App 在 send 包装处记账——面板切走后状态栏仍可见） */
  packing: boolean;
  /** 右栏当前正显示打包页（按钮的 aria-pressed / 激活态） */
  packActive: boolean;
  /** 降级打开回执（缺 project.json）；undefined = 正常打开 */
  degraded: DegradedOpen | undefined;
}>();

const emit = defineEmits<{
  /** 点击打包入口：App 侧 toggle 右栏的打包页（已在 ⇒ 回诊断） */
  (e: "toggle-pack"): void;
}>();

const dirtyText = computed(() =>
  props.dirtyCount === 0 ? "无未保存" : `${props.dirtyCount} 个未保存`,
);
const packLabel = computed(() => (props.packing ? "打包中…" : "打包"));
</script>

<template>
  <footer class="status-bar">
    <span class="status-item" :title="root || '未绑定磁盘工程'">
      {{ root || "未绑定工程" }}
    </span>
    <!-- 降级打开：显式告知（状态口径 + title 详情），不做静默处理 -->
    <span
      v-if="degraded"
      class="status-item warn"
      role="status"
      :title="degraded.reason"
    >降级打开</span>
    <span class="status-item" :class="{ muted: !localHost }" :title="localHost ? '本地服务已就绪：可绝对路径 / 外部打开 / 原生监视' : '浏览器形态：能力降级（无外部打开、无绝对路径）'">
      {{ localHost ? "本地宿主" : "浏览器" }}
    </span>
    <span class="spacer"></span>
    <span class="status-item">{{ documentCount }} 文档</span>
    <span class="status-item" :class="{ warn: dirtyCount > 0 }">{{ dirtyText }}</span>
    <span class="status-item" :class="{ err: errorCount > 0, warn: errorCount === 0 && warningCount > 0 }">
      诊断 {{ errorCount }}/{{ warningCount }}
    </span>
    <button
      class="pack-entry"
      :class="{ active: packActive, busy: packing }"
      :aria-pressed="packActive"
      :title="packActive ? '收起打包面板' : '快速打包：产出加密发布包（lfenpack）'"
      @click="emit('toggle-pack')"
    >
      {{ packLabel }}
    </button>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 3px 10px;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
  background: var(--lf-surface-sunken);
  border-top: 1px solid var(--lf-border-subtle);
  flex: 0 0 auto;
}
.status-item {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-item.muted {
  color: var(--lf-text-hint);
}
.status-item.warn {
  color: var(--lf-warning);
}
.status-item.err {
  color: var(--lf-danger);
}
.spacer {
  flex: 1 1 auto;
}
/* 打包入口：状态栏里的真按钮，激活态描边、打包中提亮 */
.pack-entry {
  flex-shrink: 0;
  padding: 1px 8px;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
  font-variant-numeric: tabular-nums;
}
.pack-entry:hover {
  color: var(--lf-text-primary);
}
.pack-entry.active {
  border-color: var(--lf-border-strong);
  background: var(--lf-surface-hover);
  color: var(--lf-text-primary);
}
.pack-entry.busy {
  color: var(--lf-accent);
}
</style>
