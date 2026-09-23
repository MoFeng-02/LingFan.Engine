<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { Story } from "@lingfan/engine";
import {
  describeForm,
  getAtPointer,
  listOps,
  type OpGroup,
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

const opGroups: {
  group: OpGroup;
  label: string;
  ops: { op: string; label: string }[];
}[] = [
  { group: "narrative", label: "叙事", ops: [] },
  { group: "presentation", label: "表现", ops: [] },
  { group: "flow", label: "流程", ops: [] },
  { group: "variables", label: "变量", ops: [] },
  { group: "save", label: "存档", ops: [] },
  { group: "audio", label: "音频", ops: [] },
  { group: "video", label: "视频", ops: [] },
  { group: "minigame", label: "小游戏", ops: [] },
];
for (const meta of listOps()) {
  opGroups
    .find((g) => g.group === meta.group)
    ?.ops.push({
      op: meta.op,
      label: meta.label,
    });
}
const insertOp = ref("say");

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
    const op = (cmd as Record<string, unknown>)?.op;
    return {
      pointer,
      cmd: cmd as Record<string, unknown>,
      label:
        typeof op === "string" ? (describeForm(op)?.label ?? op) : "（坏命令）",
    };
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
  api.insertCommand(`/columns/${index}/${field}`, { op: insertOp.value });
}
function move(pointer: string, delta: number): void {
  api.moveCommand(pointer, delta);
}
function isSelected(pointer: string): boolean {
  return props.selectedPointer === pointer;
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
        <select v-model="insertOp" class="op-picker">
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
          空容器——选择 op 后「插入」
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
  font-size: 12px;
  color: #565f89;
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
  background: #1a1b26;
}
.rows li.selected {
  background: #24283b;
  border-color: #7aa2f766;
}
.index {
  color: #565f89;
  font-variant-numeric: tabular-nums;
  min-width: 18px;
  text-align: right;
}
.op-label {
  color: #7aa2f7;
  min-width: 76px;
}
.summary {
  flex: 1;
  color: #9aa5ce;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-ops {
  display: none;
  gap: 2px;
}
.rows li:hover .row-ops {
  display: inline-flex;
}
button.mini {
  padding: 0 5px;
  font-size: 11px;
  line-height: 18px;
}
button.danger:hover {
  color: #f7768e;
  border-color: #f7768e88;
}
.empty {
  color: #565f89;
  padding: 6px 8px;
  font-style: italic;
}
.op-picker {
  max-width: 220px;
}
</style>
