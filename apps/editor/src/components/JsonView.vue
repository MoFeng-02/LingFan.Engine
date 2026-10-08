<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { Story } from "@lingfan/engine";
import { EDITOR_API_KEY } from "../contracts";

/**
 * JSON 视图：只读镜像 → 可编辑（结构化编辑的最直接形态）。
 * 应用 = JSON.parse 整树替换（一个 undo 单元）；解析失败行内拒绝。
 * 树内语义问题（缺必填/未知 op…）不在此拦截——诊断面板实时标红（分工）。
 */
const props = defineProps<{ story: Story }>();

const api = inject(EDITOR_API_KEY)!;

const draft = ref(JSON.stringify(props.story, null, 2));
const dirty = ref(false);
const error = ref("");

watch(
  () => props.story,
  () => {
    if (!dirty.value) draft.value = JSON.stringify(props.story, null, 2);
  },
);

function regenerate(): void {
  draft.value = JSON.stringify(props.story, null, 2);
  dirty.value = false;
  error.value = "";
}

function onEdit(event: Event): void {
  draft.value = (event.target as HTMLTextAreaElement).value;
  dirty.value = true;
}

function apply(): void {
  try {
    const parsed = JSON.parse(draft.value) as Story;
    api.replaceAll(parsed, "应用 JSON 编辑");
    dirty.value = false;
    error.value = "";
  } catch (e) {
    error.value = `JSON 解析失败：${String(e)}`;
  }
}

const lineCount = computed(() => draft.value.split("\n").length);
</script>

<template>
  <div class="json-view">
    <div class="json-toolbar">
      <button :disabled="!dirty" @click="regenerate">⟳ 重新生成</button>
      <span class="stats">{{ lineCount }} 行</span>
      <span v-if="dirty" class="dirty">未应用改动</span>
      <span class="spacer"></span>
      <button class="apply" :disabled="!dirty" @click="apply">✓ 应用</button>
    </div>
    <p v-if="error !== ''" class="json-error">{{ error }}</p>
    <textarea
      class="json-text"
      :value="draft"
      spellcheck="false"
      @change="onEdit"
    ></textarea>
  </div>
</template>

<style scoped>
.json-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.json-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stats {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
}
.dirty {
  color: var(--lf-warning);
  font-size: var(--lf-font-sm);
}
.spacer {
  flex: 1;
}
button.apply {
  border-color: color-mix(in srgb, var(--lf-success) 53%, transparent);
  color: var(--lf-success);
}
.json-error {
  margin: 0;
  padding: 6px 10px;
  background: var(--lf-danger-surface);
  border: 1px solid color-mix(in srgb, var(--lf-danger) 40%, transparent);
  border-radius: var(--lf-radius-md);
  color: var(--lf-danger);
  font-size: var(--lf-font-sm);
}
.json-text {
  flex: 1;
  font-family: Consolas, monospace;
  font-size: var(--lf-font-sm);
  line-height: 1.5;
  resize: none;
  color: var(--lf-text-secondary);
}
</style>
