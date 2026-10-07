<script setup lang="ts">
/**
 * JSON 资源视图（`project.json` 等工程元数据）：**只读展示 + 显式保存**。
 *
 * 为何不直接给文本框：清单是**结构化契约**（`formatVersion` / `entry` / `defines`…），
 * 逐字段手编 JSON 极易写坏契约。本视图**只读展示**（高亮键）+ 显式保存按钮（内容未改时禁用），
 * 把「能改」留给带表单的视图 —— **不假装有编辑器**。
 */
import { computed, ref, watch } from "vue";

const props = defineProps<{
  path: string;
  title: string;
  source: string;
}>();

const emit = defineEmits<{ (e: "save", path: string, text: string): void }>();

/** 坏 JSON ⇒ 如实报错（fail-closed） */
const parsed = computed<{ entries: [string, unknown][] } | { error: string }>(() => {
  try {
    const value: unknown = JSON.parse(props.source);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { error: "根节点必须是对象" };
    }
    return { entries: Object.entries(value as Record<string, unknown>) };
  } catch (e) {
    return { error: `不是合法 JSON：${String(e)}` };
  }
});

/** 草稿（编辑后才可保存；未改则禁用——不产生无意义的重写） */
const draft = ref<string | undefined>(undefined);
watch(() => props.path, () => (draft.value = undefined));

const current = computed(() => draft.value ?? props.source);
const dirty = computed(() => draft.value !== undefined && draft.value !== props.source);
const typeOf = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
</script>

<template>
  <section class="json-resource">
    <header class="view-head">
      <h2>{{ title }}</h2>
      <span class="path" :title="path">{{ path }}</span>
      <span class="spacer"></span>
      <span v-if="dirty" class="warn">未保存</span>
      <button :disabled="!dirty" @click="emit('save', path, current)">保存</button>
    </header>

    <p v-if="'error' in parsed" class="error">{{ parsed.error }}</p>
    <template v-else>
      <ul class="fields">
        <li v-for="[key, value] in parsed.entries" :key="key">
          <span class="key">{{ key }}</span>
          <span class="type">{{ typeOf(value) }}</span>
          <span class="value">{{
            typeof value === "string"
              ? value
              : JSON.stringify(value)
          }}</span>
        </li>
      </ul>
      <details class="raw">
        <summary>原始 JSON</summary>
        <textarea v-model="current" spellcheck="false"></textarea>
      </details>
    </template>
  </section>
</template>

<style scoped>
.json-resource {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  gap: 6px;
}
.view-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.view-head h2 {
  margin: 0;
  font-size: var(--lf-font-md);
  color: var(--lf-text-secondary);
}
.path {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  font-family: Consolas, monospace;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50ch;
}
.spacer {
  flex: 1 1 auto;
}
.warn {
  font-size: var(--lf-font-sm);
  color: var(--lf-warning);
}
.error {
  color: var(--lf-danger);
  font-size: var(--lf-font-md);
}
.fields {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1 1 auto;
  min-height: 0;
  font-size: var(--lf-font-md);
}
.fields li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--lf-surface-hover);
  min-width: 0;
}
.key {
  color: var(--lf-accent-strong);
  font-family: Consolas, monospace;
  flex: 0 0 auto;
}
.type {
  flex: 0 0 auto;
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
  border: 1px solid var(--lf-border-subtle);
  border-radius: var(--lf-radius-sm);
  padding: 0 4px;
}
.value {
  color: var(--lf-text-secondary);
  min-width: 0;
  overflow-wrap: anywhere;
}
.raw {
  flex: 0 0 auto;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
}
.raw summary {
  cursor: pointer;
}
.raw textarea {
  width: 100%;
  height: 30vh;
  margin-top: 4px;
  font-family: Consolas, monospace;
  font-size: var(--lf-font-sm);
  resize: vertical;
}
</style>
