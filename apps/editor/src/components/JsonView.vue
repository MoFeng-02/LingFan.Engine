<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { Story } from "@lingfan/engine";

/**
 * 06 §一.1 JSON 视图：只读镜像 → 可编辑（结构化编辑的最直接形态）。
 * 应用 = JSON.parse 整树替换（一个 undo 单元）；解析失败行内拒绝。
 * 树内语义问题（缺必填/未知 op…）不在此拦截——诊断面板实时标红（D3 分工）。
 */
const props = defineProps<{ story: Story }>();

interface EditorApi {
  replaceAll(next: Story, label: string): void;
}
const api = inject<EditorApi>("editorApi")!;

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
  color: #565f89;
  font-size: 11px;
}
.dirty {
  color: #e0af68;
  font-size: 11px;
}
.spacer {
  flex: 1;
}
button.apply {
  border-color: #9ece6a88;
  color: #9ece6a;
}
.json-error {
  margin: 0;
  padding: 6px 10px;
  background: #2a1518;
  border: 1px solid #f7768e66;
  border-radius: 6px;
  color: #f7768e;
  font-size: 11px;
}
.json-text {
  flex: 1;
  font-family: Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  resize: none;
  color: #9aa5ce;
}
</style>
