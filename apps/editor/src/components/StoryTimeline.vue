<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { Story } from "@lingfan/engine";
import {
  createElementDraft,
  describeNodeLabel,
  ELEMENT_TYPE_GROUPS,
  elementLabel,
  getAtPointer,
  listOpGroups,
} from "@lingfan/editor";

const props = defineProps<{
  story: Story;
  columnId: string;
  selectedPointer: string | null;
}>();

interface EditorApi {
  select(pointer: string | null): void;
  insertCommand(pointer: string, command: Record<string, unknown>): void;
  removeCommand(pointer: string): void;
  moveCommand(pointer: string, delta: number): void;
}
const api = inject<EditorApi>("editorApi")!;

/** op 分组与中文标签 = `@lingfan/editor` 单一事实源（与组件面板共用，勿在此另列清单） */
const opGroups = listOpGroups();
const insertOp = ref("say");
/** 元素层容器的插入源 = 元素类型分组（与组件面板同源），默认取第一组首个类型 */
const insertType = ref(ELEMENT_TYPE_GROUPS[0]?.types[0] ?? "");

const column = computed(() =>
  props.story.columns.find((c) => c.id === props.columnId),
);

interface Row {
  pointer: string;
  cmd: Record<string, unknown>;
  label: string;
}
function rowsOf(field: "commands" | "elements" | "entry"): Row[] {
  const index = props.story.columns.findIndex((c) => c.id === props.columnId);
  if (index < 0) return [];
  const list = getAtPointer(props.story, `/columns/${index}/${field}`);
  if (!Array.isArray(list)) return [];
  return list.map((cmd, i): Row => {
    const pointer = `/columns/${index}/${field}/${i}`;
    const record = cmd as Record<string, unknown>;
    // 标签走单一事实源：命令按 op、元素按类型（元素没有 op）——见 describeNodeLabel
    return { pointer, cmd: record, label: describeNodeLabel(record) };
  });
}
const containers = computed(() => {
  const col = column.value;
  if (col === undefined) return [];
  return col.kind === "flow"
    ? [
        {
          field: "commands" as const,
          label: "命令流",
          rows: rowsOf("commands"),
        },
      ]
    : [
        {
          field: "elements" as const,
          label: "元素层",
          rows: rowsOf("elements"),
        },
        { field: "entry" as const, label: "入口命令", rows: rowsOf("entry") },
      ];
});

function insert(field: "commands" | "elements" | "entry"): void {
  const index = props.story.columns.findIndex((c) => c.id === props.columnId);
  if (index < 0) return;
  // 元素层只产元素草稿（createElementDraft fail-closed），绝不产 {op} 命令形态
  if (field === "elements") {
    const draft = createElementDraft(insertType.value, 0, 0);
    if (draft !== null) api.insertCommand(`/columns/${index}/elements`, draft);
    return;
  }
  api.insertCommand(`/columns/${index}/${field}`, { op: insertOp.value });
}
function move(pointer: string, delta: number): void {
  api.moveCommand(pointer, delta);
}
function isSelected(pointer: string): boolean {
  return props.selectedPointer === pointer;
}
function emptyHint(field: "commands" | "elements" | "entry"): string {
  return field === "elements"
    ? "空容器——选择元素类型后「插入」"
    : "空容器——选择 op 后「插入」";
}
function summary(cmd: Record<string, unknown>): string {
  const text = cmd.text ?? cmd.prompt ?? cmd.target ?? cmd.slot ?? cmd.key;
  return typeof text === "string" && text !== "" ? text : "";
}
</script>

<template>
  <div class="timeline">
    <div
      v-for="container in containers"
      :key="container.field"
      class="container"
    >
      <div class="container-head">
        <h2>{{ container.label }}</h2>
        <!-- 元素层用元素类型下拉（同源组件面板），命令容器仍用 op 下拉 -->
        <select
          v-if="container.field === 'elements'"
          v-model="insertType"
          class="op-picker"
        >
          <optgroup
            v-for="group in ELEMENT_TYPE_GROUPS"
            :key="group.group"
            :label="group.label"
          >
            <option v-for="type in group.types" :key="type" :value="type">
              {{ elementLabel(type) }}（{{ type }}）
            </option>
          </optgroup>
        </select>
        <select v-else v-model="insertOp" class="op-picker">
          <optgroup
            v-for="group in opGroups"
            :key="group.group"
            :label="group.label"
          >
            <option v-for="op in group.ops" :key="op.op" :value="op.op">
              {{ op.label }}（{{ op.op }}）
            </option>
          </optgroup>
        </select>
        <button @click="insert(container.field)">插入</button>
      </div>

      <ol class="rows">
        <li
          v-for="(row, i) in container.rows"
          :key="row.pointer"
          :class="{ selected: isSelected(row.pointer) }"
          @click="api.select(row.pointer)"
        >
          <span class="index">{{ i }}</span>
          <span class="op-label">{{ row.label }}</span>
          <span class="summary">{{ summary(row.cmd) }}</span>
          <span class="row-ops" @click.stop>
            <button
              class="mini"
              title="上移"
              :disabled="i === 0"
              @click="move(row.pointer, -1)"
            >
              ↑
            </button>
            <button
              class="mini"
              title="下移"
              :disabled="i === container.rows.length - 1"
              @click="move(row.pointer, 1)"
            >
              ↓
            </button>
            <button
              class="mini danger"
              title="删除命令"
              @click="api.removeCommand(row.pointer)"
            >
              ✕
            </button>
          </span>
        </li>
        <li v-if="container.rows.length === 0" class="empty">
          {{ emptyHint(container.field) }}
        </li>
      </ol>
    </div>
    <p v-if="column === undefined" class="empty">左侧选择一列</p>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.container-head h2 {
  margin: 0 8px 0 0;
  font-size: var(--lf-font-md);
  color: var(--lf-text-hint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex: 1;
}
.rows {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rows li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
.rows li:hover {
  background: var(--lf-surface-hover);
}
.rows li.selected {
  background: var(--lf-border-subtle);
  border-color: color-mix(in srgb, var(--lf-accent) 40%, transparent);
}
.index {
  color: var(--lf-text-hint);
  font-variant-numeric: tabular-nums;
  min-width: 18px;
  text-align: right;
}
.op-label {
  color: var(--lf-accent);
  min-width: 76px;
}
.summary {
  flex: 1;
  color: var(--lf-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-ops {
  /* 常显低强调（E2 建议值）：hover-only 的行内操作在触屏与新用户面前等于不存在
     （D-62②）。改常显但压低视觉权重，hover 时才提升 —— 可见性不靠鼠标。 */
  display: inline-flex;
  gap: 2px;
  opacity: 0.45;
  transition: opacity 120ms ease;
}
.rows li:hover .row-ops {
  opacity: 1;
}
button.mini {
  padding: 0 5px;
  font-size: var(--lf-font-sm);
  line-height: 18px;
}
button.danger:hover {
  color: var(--lf-danger);
  border-color: color-mix(in srgb, var(--lf-danger) 53%, transparent);
}
.empty {
  color: var(--lf-text-hint);
  padding: 6px 8px;
  font-style: italic;
}
.op-picker {
  max-width: 220px;
}
</style>
