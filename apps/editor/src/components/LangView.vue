<script setup lang="ts">
/**
 * 译文表视图（`Lang/**`）：键 → 译文的**可编辑表格**（**支持增删改行**）。
 *
 * 数据来自宿主注入的读取能力（组合根绑 `ProjectFileSource.text`）——本组件
 * 不碰 IO（与其它编辑器视图同一约束）。**增删改的判据全在 `packages/editor` 的
 * `i18n/table.ts`**（纯函数），本组件只渲染与收集意图。
 *
 * 编辑约定：输入即暂存，**保存按钮显式**（不静默写盘）；空译文用占位提示
 * 「未翻译」而非空白（空白分不清"没译"和"故意留空"）。行集是**单一状态源**
 * （`rows`），不另设「原值 + 覆盖层」双份——双份会让增删行判脏判不出来。
 */
import { computed, ref, watch } from "vue";
import {
  addTranslationRow,
  isTableDirty,
  parseTranslationTable,
  removeTranslationRow,
  renameTranslationRow,
  serializeTranslationTable,
  setTranslationValue,
  type TranslationRow,
} from "@lingfan/editor";
import { useDialog } from "../dialogInjection";

const props = defineProps<{
  /** 逻辑路径（标题与保存用） */
  path: string;
  /** 原始文本（宿主读好的 JSON 文本） */
  source: string;
}>();

const emit = defineEmits<{
  (e: "save", path: string, text: string): void;
}>();

const dialog = useDialog();

/** 坏 JSON ⇒ 如实报错（fail-closed，不静默当空表） */
const parsed = computed(() => parseTranslationTable(props.source));

/** 基线行集（读盘时的形态；`isTableDirty` 的另一侧） */
const baseRows = computed<readonly TranslationRow[]>(() =>
  parsed.value.ok ? parsed.value.rows : [],
);

/** 草稿行集（编辑中；**唯一状态源**） */
const rows = ref<readonly TranslationRow[]>([]);
/** 正在改键的行（改键须先提交/取消，不能边打字边改行身份） */
const renamingKey = ref<string | null>(null);

// 换文件 ⇒ 重置草稿（不把上一文件的改动带过来）
watch(
  () => props.path,
  () => {
    rows.value = baseRows.value;
    renamingKey.value = null;
  },
  { immediate: true },
);

const dirty = computed(() => isTableDirty(rows.value, baseRows.value));
const missingCount = computed(() => rows.value.filter((r) => r.text === "").length);

function emitText(): string {
  return serializeTranslationTable(rows.value);
}

/** 把一次失败的编辑（重复键 / 空键…）如实说给用户——不静默忽略 */
async function reportFailure(reason: string): Promise<void> {
  await dialog.notify({ title: "无法应用该操作", message: reason, tone: "warning" });
}

/** 增行：**先问键名，判据通过才插行**。
 *
 * 不要「先插占位行再改名」——改名被拒（重复键/非法键）时**占位行会残留**，
 * 留下一个用户没要求过的空行，还得手动删。改成「先取值 → 判据 → 一次插入」
 * 则失败零副作用。
 */
async function onAdd(): Promise<void> {
  const answer = await dialog.askText({
    title: "新增译文行",
    message: "请输入原文键（须与原文一致；运行期按此键查译文）。",
    placeholder: "如 ui.hello",
  });
  if (answer === null) return; // 取消 = 不执行（判据见 `parseTextAnswer`）
  const key = answer.trim();
  const edit = addTranslationRow(rows.value, key);
  if (!edit.ok) {
    await reportFailure(edit.error);
    return;
  }
  rows.value = edit.rows;
}

function onRemove(row: TranslationRow): void {
  //删行是破坏性的（译文会真的丢）⇒ 二次确认，且说清后果
  void (async () => {
    const ok = await dialog.askConfirm({
      title: "删除该译文行",
      message: `键「${row.key}」将从译文表中删除。保存后即写入磁盘，原译文不会留在任何备份里。`,
      danger: true,
    });
    if (!ok) return;
    const edit = removeTranslationRow(rows.value, row.key);
    if (!edit.ok) {
      await reportFailure(edit.error);
      return;
    }
    rows.value = edit.rows;
    if (renamingKey.value === row.key) renamingKey.value = null;
  })();
}

function onRenameCommit(from: string, to: string): void {
  const target = to.trim();
  renamingKey.value = null;
  if (target === from) return;
  const edit = renameTranslationRow(rows.value, from, target);
  if (!edit.ok) {
    void reportFailure(edit.error);
    return;
  }
  rows.value = edit.rows;
}

function onRenameCancel(): void {
  renamingKey.value = null;
}

function onValueInput(key: string, text: string): void {
  const edit = setTranslationValue(rows.value, key, text);
  // 键必然存在（行集是唯一状态源）⇒ 失败只可能是防御性分支
  if (edit.ok) rows.value = edit.rows;
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
      <button class="mini" title="新增一个译文行" @click="onAdd">+行</button>      <button :disabled="!dirty" @click="emit('save', path, emitText())">保存</button>
    </header>

    <p v-if="!parsed.ok" class="error">{{ parsed.error }}</p>
    <p v-else-if="rows.length === 0" class="empty">
      该译文表为空文件——点「+行」添加第一个键。
    </p>

    <table v-else class="entries">
      <thead>
        <tr><th>原文键</th><th>译文</th><th class="ops-col"></th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <td class="key">
            <!-- 改键态：显式两态（提交/取消），不搞「边打字边换行身份」 -->
            <template v-if="renamingKey === row.key">
              <input
                class="rename-input"
                :value="row.key"
                autofocus
                @keydown.enter.prevent="onRenameCommit(row.key, ($event.target as HTMLInputElement).value)"
                @keydown.esc.prevent="onRenameCancel"
                @blur="onRenameCommit(row.key, ($event.target as HTMLInputElement).value)"
              />
            </template>
            <template v-else>
              <span :title="row.key">{{ row.key }}</span>
            </template>
          </td>
          <td>
            <input
              :value="row.text"
              :placeholder="row.text === '' ? '未翻译' : ''"
              @input="onValueInput(row.key, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td class="ops">
            <button
              v-if="renamingKey !== row.key"
              class="mini"
              title="修改该行的键"
              @click="renamingKey = row.key"
            >
              改键
            </button>
            <button class="mini danger" title="删除该行" @click="onRemove(row)">删</button>
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
.error {
  color: var(--lf-danger);
  font-size: var(--lf-font-md);
}
.empty {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-md);
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
.entries th.ops-col {
  width: 1%;
}
.entries td {
  padding: 2px 8px;
  border-bottom: 1px solid var(--lf-surface-hover);
  vertical-align: top;
}
.entries td.key {
  width: 34%;
  color: var(--lf-text-secondary);
  font-family: Consolas, monospace;
  overflow-wrap: anywhere;
}
.entries td.ops {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}
.entries td.ops .mini {
  margin-left: 4px;
}
.entries .mini.danger:hover {
  color: var(--lf-danger);
  border-color: var(--lf-danger);
}
.entries input {
  width: 100%;
  font-size: var(--lf-font-md);
}
.entries .rename-input {
  font-family: Consolas, monospace;
}
</style>
