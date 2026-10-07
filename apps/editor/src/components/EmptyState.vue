<script setup lang="ts">
/**
 * 统一空态：把「为什么空」讲清楚，并给出**可点的下一步**。
 *
 * 判据：空态不是一行灰字，必须回答「**为什么空**」与「**接下来做什么**」。
 * 文案与主动作由 `emptyStateOf` 统一给（可测），本组件只负责呈现与回抛动作。
 */
import { computed } from "vue";
import { emptyStateOf, type EmptyAction } from "../viewState";

const props = defineProps<{
  /** 空的原因（决定文案与主动作） */
  reason: string;
}>();

const emit = defineEmits<{ (e: "action", action: EmptyAction): void }>();

const state = computed(() => emptyStateOf(props.reason));
</script>

<template>
  <div class="empty-state" role="status">
    <p class="empty-title">{{ state.title }}</p>
    <p v-if="state.hint" class="empty-hint">{{ state.hint }}</p>
    <button
      v-if="state.id !== 'none'"
      class="empty-action"
      :class="{ primary: state.primary }"
      @click="emit('action', state)"
    >
      {{ state.label }}
    </button>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 140px;
  padding: 24px 16px;
  text-align: center;
}
.empty-title {
  margin: 0;
  font-size: var(--lf-font-lg);
  color: var(--lf-text-secondary);
}
.empty-hint {
  margin: 0;
  max-width: 44ch;
  font-size: var(--lf-font-md);
  line-height: 1.6;
  color: var(--lf-text-hint);
}
.empty-action {
  margin-top: 2px;
  padding: 5px 14px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-secondary);
  border-color: var(--lf-border-strong);
}
.empty-action.primary {
  color: var(--lf-text-primary);
  border-color: var(--lf-text-hint);
  background: var(--lf-border-subtle);
}
.empty-action:hover {
  background: var(--lf-surface-selected);
}
</style>
