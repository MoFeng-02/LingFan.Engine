<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { Story } from "@lingfan/engine";
import { parseTextStory, projectText, TextFormatError } from "@lingfan/engine";

/**
 * 文本模式：text.ts 双向投影。容错投影（projectText）——
 * scene 列/未知 op 收集为警告清单（部分内容可见可改），不整视图崩塌。
 * 「应用到故事」= parseTextStory 整树替换，一个 undo 单元；解析失败整次拒绝。
 * ⚠️ 该按钮**必须带 `dirty` 门**：无改动时点击会落一棵内容相同的树 ⇒ **凭空产生一个
 * undo 单元**（撤销步数被污染），且与 JSON 视图的同名按钮行为不一致（D-61）。
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
      <button class="apply" :disabled="!dirty" @click="apply">
        ✓ 应用到故事
      </button>
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
.text-warn {
  margin: 0;
  padding: 6px 10px;
  background: var(--lf-warning-tint);
  border: 1px solid color-mix(in srgb, var(--lf-warning) 40%, transparent);
  border-radius: var(--lf-radius-md);
  color: var(--lf-warning);
  font-size: var(--lf-font-sm);
  max-height: 90px;
  overflow: auto;
}
.text-errors {
  margin: 0;
  padding: 6px 10px;
  background: var(--lf-danger-surface);
  border: 1px solid color-mix(in srgb, var(--lf-danger) 40%, transparent);
  border-radius: var(--lf-radius-md);
  color: var(--lf-danger);
  font-size: var(--lf-font-sm);
  max-height: 120px;
  overflow: auto;
}
textarea.dsl {
  flex: 1;
  font-family: Consolas, monospace;
  font-size: var(--lf-font-md);
  line-height: 1.5;
  resize: none;
  min-height: 200px;
}
.text-note {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
  margin: 0;
}
</style>
