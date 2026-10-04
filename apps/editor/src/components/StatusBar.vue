<script setup lang="ts">
/**
 * 状态栏（底部）：**工程级**事实的常驻出口。
 *
 * 放什么（只放「别处看不到」的事实，否则是重复信息）：
 * 资源根路径 · 宿主能力（本地服务/浏览器）· 已打开文档数与脏数 · 诊断计数。
 * 诊断**计数**在中栏/顶栏也有 ⇒ 这里只作「同一口径的第二处可读点」，
 * 真正的信息增量是**宿主能力**与**脏文件数**（顶栏只有「是否脏」，这里有「几个」）。
 */
import { computed } from "vue";

const props = defineProps<{
  root: string;
  /** 宿主能力：有无本地服务（能力探测式降级的显式化） */
  localHost: boolean;
  documentCount: number;
  dirtyCount: number;
  errorCount: number;
  warningCount: number;
}>();

const dirtyText = computed(() =>
  props.dirtyCount === 0 ? "无未保存" : `${props.dirtyCount} 个未保存`,
);
</script>

<template>
  <footer class="status-bar">
    <span class="status-item" :title="root || '未绑定磁盘工程'">
      {{ root || "未绑定工程" }}
    </span>
    <span class="status-item" :class="{ muted: !localHost }" :title="localHost ? '本地服务已就绪：可绝对路径 / 外部打开 / 原生监视' : '浏览器形态：能力降级（无外部打开、无绝对路径）'">
      {{ localHost ? "本地宿主" : "浏览器" }}
    </span>
    <span class="spacer"></span>
    <span class="status-item">{{ documentCount }} 文档</span>
    <span class="status-item" :class="{ warn: dirtyCount > 0 }">{{ dirtyText }}</span>
    <span class="status-item" :class="{ err: errorCount > 0, warn: errorCount === 0 && warningCount > 0 }">
      诊断 {{ errorCount }}/{{ warningCount }}
    </span>
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
</style>
