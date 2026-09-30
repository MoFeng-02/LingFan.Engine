<script setup lang="ts">
import { computed, ref } from "vue";
import { ELEMENT_CONTAINER_TYPES } from "@lingfan/engine";
import {
  ELEMENT_TYPE_GROUPS,
  elementLabel,
  listOpGroups,
} from "@lingfan/editor";

/**
 * 组件面板：**元素 36 类型** + **命令 op** 的归类视图。
 *
 * 本轮职责 = 归类展示 + **拖拽源**（拖到舞台/时间线以创建，落点在舞台视图）；
 * 分组数据全部取自 `@lingfan/editor` 的纯模块（`ELEMENT_TYPE_GROUPS` / `listOpGroups`），
 * 本组件不新增任何类型清单——面板覆盖度由互锁测试锁定。
 * 面板是**静态归类源**（不依赖当前故事），故不声明 props。
 */

/** 拖拽 MIME：与列分组的 `application/x-lingfan-column` 并列，落点据此分派 */
const DRAG_TYPE = "application/x-lingfan-palette";

const groups = computed(() => ELEMENT_TYPE_GROUPS);
const opGroups = computed(() => listOpGroups());
const collapsedGroups = ref<Set<string>>(new Set());
const query = ref("");

const opCount = computed(() =>
  opGroups.value.reduce((total, entry) => total + entry.ops.length, 0),
);
const elementCount = computed(() =>
  groups.value.reduce((total, entry) => total + entry.types.length, 0),
);

/** 搜索态下只保留命中项（空查询 = 全量，保持分组结构） */
const filter = computed(() => query.value.trim().toLowerCase());
function matches(...texts: string[]): boolean {
  const needle = filter.value;
  if (needle === "") return true;
  return texts.some((text) => text.toLowerCase().includes(needle));
}
const visibleElementGroups = computed(() =>
  groups.value
    .map((entry) => ({
      ...entry,
      types: entry.types.filter((type) =>
        matches(type, elementLabel(type)),
      ),
    }))
    .filter((entry) => entry.types.length > 0),
);
const visibleOpGroups = computed(() =>
  opGroups.value
    .map((entry) => ({
      ...entry,
      ops: entry.ops.filter((item) => matches(item.op, item.label)),
    }))
    .filter((entry) => entry.ops.length > 0),
);

function toggle(group: string): void {
  const next = new Set(collapsedGroups.value);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  collapsedGroups.value = next;
}
function isCollapsed(group: string): boolean {
  // 搜索时强制展开，便于看到命中项
  return filter.value === "" && collapsedGroups.value.has(group);
}

function onDragStart(
  event: DragEvent,
  kind: "element" | "op",
  id: string,
  label: string,
): void {
  const dt = event.dataTransfer;
  if (dt === null) return;
  dt.setData(DRAG_TYPE, JSON.stringify({ kind, id }));
  dt.setData("text/plain", label); // 拖到外部输入框也得体
  dt.effectAllowed = "copy";
}
</script>

<template>
  <div class="palette">
    <p class="palette-hint">
      元素拖到舞台画布即创建（落点即 x/y；命令的落点创建随后续任务提供）。元素
      {{ elementCount }} 类型 / 命令 {{ opCount }} 个。
    </p>
    <input
      v-model="query"
      class="palette-search"
      type="search"
      placeholder="筛选类型 / 命令"
    />

    <section class="palette-section">
      <h3>元素</h3>
      <div v-for="entry in visibleElementGroups" :key="entry.group" class="group">
        <button
          class="group-head"
          :aria-expanded="!isCollapsed(entry.group)"
          @click="toggle(entry.group)"
        >
          <span class="caret">{{ isCollapsed(entry.group) ? "▸" : "▾" }}</span>
          <span class="gname">{{ entry.label }}</span>
          <span class="gcount">{{ entry.types.length }}</span>
        </button>
        <ul v-show="!isCollapsed(entry.group)" class="items">
          <li
            v-for="type in entry.types"
            :key="type"
            class="item"
            draggable="true"
            :title="`${elementLabel(type)}（${type}）${
              ELEMENT_CONTAINER_TYPES.has(type) ? ' · 容器，可容纳子元素' : ''
            }`"
            @dragstart="onDragStart($event, 'element', type, elementLabel(type))"
          >
            <span class="ilabel">{{ elementLabel(type) }}</span>
            <span class="itype">{{ type }}</span>
            <span v-if="ELEMENT_CONTAINER_TYPES.has(type)" class="badge">容器</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="palette-section">
      <h3>命令</h3>
      <div v-for="entry in visibleOpGroups" :key="entry.group" class="group">
        <button
          class="group-head"
          :aria-expanded="!isCollapsed(entry.group)"
          @click="toggle(entry.group)"
        >
          <span class="caret">{{ isCollapsed(entry.group) ? "▸" : "▾" }}</span>
          <span class="gname">{{ entry.label }}</span>
          <span class="gcount">{{ entry.ops.length }}</span>
        </button>
        <ul v-show="!isCollapsed(entry.group)" class="items">
          <li
            v-for="item in entry.ops"
            :key="item.op"
            class="item"
            draggable="true"
            :title="`${item.label}（${item.op}）`"
            @dragstart="onDragStart($event, 'op', item.op, item.label)"
          >
            <span class="ilabel">{{ item.label }}</span>
            <span class="itype">{{ item.op }}</span>
          </li>
        </ul>
      </div>
    </section>

    <p v-if="visibleElementGroups.length === 0 && visibleOpGroups.length === 0" class="empty">
      没有匹配「{{ query }}」的类型或命令。
    </p>
  </div>
</template>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}
.palette-hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: #565f89;
}
.palette-search {
  width: 100%;
  box-sizing: border-box;
  font-size: 11px;
  padding: 3px 6px;
}
.palette-section h3 {
  margin: 0 0 4px;
  font-size: 11px;
  color: #7aa2f7;
  font-weight: 600;
}
.group {
  margin-bottom: 4px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px 4px;
  font-size: 11px;
  background: none;
  border: none;
  color: #c0caf5;
  cursor: pointer;
  text-align: left;
}
.group-head:hover {
  background: #1a1b26;
}
.group-head .gname {
  flex: 1;
}
.group-head .gcount {
  font-size: 10px;
  color: #565f89;
}
.caret {
  color: #565f89;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0 0 0 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  border-radius: 5px;
  font-size: 11px;
  cursor: grab;
}
.item:hover {
  background: #24283b;
}
.item:active {
  cursor: grabbing;
}
.ilabel {
  color: #c0caf5;
}
.itype {
  flex: 1;
  font-size: 10px;
  color: #565f89;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  font-size: 9px;
  color: #9ece6a;
  border: 1px solid #9ece6a55;
  border-radius: 3px;
  padding: 0 3px;
}
.empty {
  margin: 0;
  font-size: 11px;
  color: #565f89;
}
</style>