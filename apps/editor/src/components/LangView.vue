<script setup lang="ts">
/**
 * 译文表视图（`Lang/**`）：键 → 译文 的**可编辑表格**。
 *
 * 数据来自宿主注入的读取能力（组合根绑 `ProjectFileSource.text`）——本组件
 * 不碰 IO（纪律同其它编辑器视图）。
 *
 * 编辑纪律：输入即暂存，**保存按钮显式**（不静默写盘）；空译文用占位提示
 * 「未翻译」而非空白（空白分不清"没译"和"故意留空"）。
 */
import { computed, ref, watch } from "vue";

export interface TranslationEntry {
  readonly key: string;
  readonly value: string;
}

const props = defineProps<{
  /** 逻辑路径（标题与保存用） */
  path: string;
  /** 原始文本（宿主读好的 JSON 文本） */
  source: string;
}>();

const emit = defineEmits<{
  (e: "save", path: string, text: string): void;
}>();

/** 坏 JSON ⇒ 如实报错（fail-closed，不静默当空表） */
const parsed = computed<{ entries: TranslationEntry[] } | { error: string }>(() => {
  try {
    const value: unknown = JSON.parse(props.source);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { error: "译文表根节点必须是对象（键 → 译文）" };
    }
    return {
      entries: Object.entries(value as Record<string, unknown>)
        .map(([key, v]) => ({ key, value: typeof v === "string" ? v : "" }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    };
  } catch (e) {
    return { error: `不是合法 JSON：${String(e)}` };
  }
});

/** 本地草稿（编辑中；保存才交给宿主） */
const draft = ref<Record<string, string>>({});
const loadedPath = ref<string | undefined>(undefined);

// 换文件 ⇒ 重置草稿（不把上一文件的改动带过来）
watch(
  () => props.path,
  () => {
    draft.value = {};
    loadedPath.value = props.path;
  },
  { immediate: true },
);

const rows = computed<readonly TranslationEntry[]>(() =>
  "error" in parsed.value ? [] : parsed.value.entries,
);
const valueOf = (key: string): string =>
  draft.value[key] ?? (rows.value.find((r) => r.key === key)?.value ?? "");
const dirty = computed(() =>
  Object.entries(draft.value).some(
    ([k, v]) => rows.value.find((r) => r.key === k)?.value !== v,
  ),
);
const missingCount = computed(() => rows.value.filter((r) => valueOf(r.key) === "").length);

function emitText(): string {
  const out: Record<string, string> = {};
  for (const row of rows.value) out[row.key] = valueOf(row.key);
  return `${JSON.stringify(out, null, 2)}\n`;
}
</script>

<template>
  <section class="lang-view">
    <header class="view-head">
      <h2>译文表</h2>
      <span class="path" :title="path">{{ path }}</span>
      <span class="spacer"></span>
      <span v-if="missingCount > 0" class="warn">{{ missingCount }} 条未译</span>
      <span class="count">{{ rows.length }} 条</span>
      <button :disabled="!dirty" @click="emit('save', path, emitText())">保存</button>
    </header>

    <p v-if="'error' in parsed" class="error">{{ parsed.error }}</p>
    <p v-else-if="rows.length === 0" class="empty">该译文表为空文件</p>

    <table v-else class="entries">
      <thead>
        <tr><th>原文键</th><th>译文</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <td class="key" :title="row.key">{{ row.key }}</td>
          <td>
            <input
              :value="valueOf(row.key)"
              :placeholder="row.value === '' ? '未翻译' : ''"
              @input="draft[row.key] = ($event.target as HTMLInputElement).value"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.lang-view {
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
  max-width: 40ch;
}
.spacer {
  flex: 1 1 auto;
}
.count {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
}
.warn {
  font-size: var(--lf-font-sm);
  color: var(--lf-warning);
}
.error,
.empty {
  color: var(--lf-danger);
  font-size: var(--lf-font-md);
}
.empty {
  color: var(--lf-text-hint);
  font-style: italic;
}
.entries {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border-collapse: collapse;
  font-size: var(--lf-font-md);
}
.entries th {
  position: sticky;
  top: 0;
  text-align: left;
  padding: 4px 8px;
  background: var(--lf-surface-raised);
  color: var(--lf-text-hint);
  font-weight: 400;
  border-bottom: 1px solid var(--lf-border-subtle);
}
.entries td {
  padding: 2px 8px;
  border-bottom: 1px solid var(--lf-surface-hover);
  vertical-align: top;
}
.entries td.key {
  width: 40%;
  color: var(--lf-text-secondary);
  font-family: Consolas, monospace;
  overflow-wrap: anywhere;
}
.entries input {
  width: 100%;
  font-size: var(--lf-font-md);
}
</style>
