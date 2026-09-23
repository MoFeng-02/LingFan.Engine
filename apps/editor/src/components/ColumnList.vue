<script setup lang="ts">
import { computed, inject } from "vue";
import type { Story } from "@lingfan/engine";

const props = defineProps<{ story: Story; selectedId: string }>();

interface EditorApi {
  select(pointer: string | null): void;
  selectColumn(id: string): void;
  addColumn(kind: "flow" | "scene"): void;
  renameColumn(from: string, to: string): void;
  removeColumn(id: string): void;
}
const api = inject<EditorApi>("editorApi")!;

const columns = computed(() => props.story.columns);

function selectColumn(id: string): void {
  api.select(null); // 清命令选中（跨列选择不保留）
  api.selectColumn(id);
}

function promptRename(id: string): void {
  const next = window.prompt(`重命名列「${id}」（引用将同步更新）`, id);
  if (next === null || next === "" || next === id) return;
  api.renameColumn(id, next);
}

function confirmRemove(id: string): void {
  if (id === props.story.entry) {
    alert("入口列不可删除（可先改 story.entry）");
    return;
  }
  if (
    window.confirm(`删除列「${id}」？指向它的跳转将报 missing-target 诊断。`)
  ) {
    api.removeColumn(id);
  }
}
</script>

<template>
  <ul class="column-list">
    <li
      v-for="column in columns"
      :key="column.id"
      :class="{ selected: column.id === selectedId }"
      @click="selectColumn(column.id)"
    >
      <span class="kind" :class="column.kind">{{
        column.kind === "flow" ? "流" : "景"
      }}</span>
      <span class="cid">{{ column.id }}</span>
      <span v-if="column.id === story.entry" class="entry-badge" title="入口列"
        >入口</span
      >
      <span class="ops">
        <button
          class="mini"
          title="重命名（引用同步）"
          @click.stop="promptRename(column.id)"
        >
          ✎
        </button>
        <button
          class="mini danger"
          title="删除列"
          @click.stop="confirmRemove(column.id)"
        >
          ✕
        </button>
      </span>
    </li>
  </ul>
  <div class="add-row">
    <button @click="api.addColumn('flow')">+ 流程列</button>
    <button @click="api.addColumn('scene')">+ 场景列</button>
  </div>
</template>

<style scoped>
.column-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.column-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.column-list li:hover {
  background: #1a1b26;
}
.column-list li.selected {
  background: #24283b;
}
.kind {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
  color: #101014;
}
.kind.flow {
  background: #7aa2f7;
}
.kind.scene {
  background: #9ece6a;
}
.cid {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-badge {
  font-size: 10px;
  color: #e0af68;
  border: 1px solid #e0af6866;
  border-radius: 4px;
  padding: 0 4px;
}
.ops {
  display: none;
  gap: 2px;
}
.column-list li:hover .ops {
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
.add-row {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.add-row button {
  flex: 1;
}
</style>
