<script setup lang="ts">
/**
 * 只读视图：`Saves/**`（运行时产物）与未识别资源的**兜底**。
 *
 * 为什么用只读而不是隐藏：用户在自己的工程里看到 `Saves/` 有文件是**事实**，
 * 隐藏会让人以为文件丢了。视图须**明示「不归本编辑器」并给出原因**。
 */
defineProps<{
  path: string;
  reason: string;
}>();
</script>

<template>
  <section class="readonly-view">
    <p class="title">{{ path }}</p>
    <p class="reason">{{ reason }}</p>
    <p class="hint">
      该资源由**工程运行时**产生，编辑器不提供编辑面。可用外部工具查看，但请注意
      手工改动可能破坏存档一致性。
    </p>
  </section>
</template>

<style scoped>
.readonly-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  max-width: 60ch;
}
.title {
  margin: 0;
  font-size: var(--lf-font-lg);
  color: var(--lf-text-primary);
  font-family: Consolas, monospace;
  overflow-wrap: anywhere;
}
.reason {
  margin: 0;
  font-size: var(--lf-font-md);
  color: var(--lf-warning);
}
.hint {
  margin: 0;
  font-size: var(--lf-font-md);
  color: var(--lf-text-hint);
  line-height: 1.6;
}
</style>
