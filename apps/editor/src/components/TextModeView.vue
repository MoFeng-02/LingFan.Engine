<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { Story } from "@lingfan/engine";
import { TextFormatError, generateText, parseTextStory } from "@lingfan/engine";

/** 06 §一.1 文本模式：text.ts 双向投影——生成只读快照 + 显式「应用」（整树替换 = 一个 undo 单元） */
const props = defineProps<{ story: Story }>();

interface EditorApi {
  replaceAll(next: Story, label: string): void;
}
const api = inject<EditorApi>("editorApi")!;

const draft = ref(generateText(props.story));
const dirty = ref(false);
const errors = ref<string[]>([]);

watch(
  () => props.story,
  () => {
    if (!dirty.value) draft.value = generateText(props.story);
  },
);

function regenerate(): void {
  draft.value = generateText(props.story);
  dirty.value = false;
  errors.value = [];
}

function onEdit(event: Event): void {
  draft.value = (event.target as HTMLTextAreaElement).value;
  dirty.value = true;
}

/** 应用：解析失败 = fail-closed 列出全部问题（不落树）；成功保留 id/lang/entry 语义 */
function apply(): void {
  try {
    const parsed = parseTextStory(draft.value, props.story.id);
    const merged: Story = {
      ...parsed,
      id: props.story.id,
      ...(props.story.lang !== undefined ? { lang: props.story.lang } : {}),
      entry: parsed.columns.some((c) => c.id === props.story.entry)
        ? props.story.entry
        : parsed.entry,
    };
    api.replaceAll(merged, "应用文本模式");
    dirty.value = false;
    errors.value = [];
  } catch (e) {
    errors.value =
      e instanceof TextFormatError ? e.issues : [`解析失败：${String(e)}`];
  }
}

const stats = computed(() => {
  const labels = (draft.value.match(/^label /gm) ?? []).length;
  return `${labels} 列 · ${draft.value.split("\n").length} 行`;
});
</script>

<template>
  <div class="text-mode">
    <div class="text-toolbar">
      <button @click="regenerate" :disabled="!dirty">⟳ 重新生成</button>
      <span class="stats">{{ stats }}</span>
      <span v-if="dirty" class="dirty">未应用改动</span>
      <span class="spacer"></span>
      <button class="apply" @click="apply">✓ 应用到故事</button>
    </div>
    <ul v-if="errors.length > 0" class="text-errors">
      <li v-for="issue in errors" :key="issue">{{ issue }}</li>
    </ul>
    <textarea
      class="dsl"
      :value="draft"
      spellcheck="false"
      @change="onEdit"
    ></textarea>
    <p class="text-note">
      label "列名": → 列；define "k" v → defines；scene
      列暂无文本投影（元素系统未实现）
    </p>
  </div>
</template>

<style scoped>
.text-mode {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.text-toolbar {
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
.text-errors {
  margin: 0;
  padding: 6px 10px;
  background: #2a1518;
  border: 1px solid #f7768e66;
  border-radius: 6px;
  color: #f7768e;
  font-size: 11px;
  max-height: 120px;
  overflow: auto;
}
textarea.dsl {
  flex: 1;
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: none;
  min-height: 200px;
}
.text-note {
  color: #565f89;
  font-size: 11px;
  margin: 0;
}
</style>
