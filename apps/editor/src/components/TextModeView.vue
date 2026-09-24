<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { Story } from "@lingfan/engine";
import { parseTextStory, projectText, TextFormatError } from "@lingfan/engine";

/**
 * 06 §一.1 文本模式：text.ts 双向投影。容错投影（projectText）——
 * scene 列/未知 op 收集为警告清单（部分内容可见可改），不整视图崩塌。
 * 「应用到故事」= parseTextStory 整树替换，一个 undo 单元；解析失败整次拒绝。
 */
const props = defineProps<{ story: Story }>();

interface EditorApi {
  replaceAll(next: Story, label: string): void;
}
const api = inject<EditorApi>("editorApi")!;

const projection = ref(projectText(props.story));
const draft = ref(projection.value.text);
const dirty = ref(false);
const errors = ref<string[]>([]);

watch(
  () => props.story,
  () => {
    if (!dirty.value) {
      projection.value = projectText(props.story);
      draft.value = projection.value.text;
    }
  },
);

function regenerate(): void {
  projection.value = projectText(props.story);
  draft.value = projection.value.text;
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
      <button :disabled="!dirty" @click="regenerate">⟳ 重新生成</button>
      <span class="stats">{{ stats }}</span>
      <span v-if="dirty" class="dirty">未应用改动</span>
      <span class="spacer"></span>
      <button class="apply" @click="apply">✓ 应用到故事</button>
    </div>
    <ul v-if="projection.issues.length > 0" class="text-warn">
      <li v-for="issue in projection.issues" :key="issue">{{ issue }}</li>
    </ul>
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
      label "列名": → 列；define "k" v → defines；menu 选项行 = "文本" -&gt;
      目标列
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
.text-warn {
  margin: 0;
  padding: 6px 10px;
  background: #2a2415;
  border: 1px solid #e0af6866;
  border-radius: 6px;
  color: #e0af68;
  font-size: 11px;
  max-height: 90px;
  overflow: auto;
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
