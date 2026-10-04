<script setup lang="ts">
/**
 * 资源树（侧栏主体）：工程维度的资源浏览。
 *
 * 纯渲染 + 折叠态本控——**数据与分组规则全在 `resourceTree.ts` 纯函数里**（可测），
 * 本组件只负责「把节点画出来 + 折叠/选中回抛」。
 *
 * 状态完备（规划稿 §2.2③）：空（未打开工程）/ 无匹配（搜索）/ 加载中 各有明确文案，
 * **不用空白或 spinner 代替解释**。
 */
import { computed } from "vue";
import type { ResourceNode } from "../resourceTree";
import { flattenResources } from "../resourceTree";

const props = defineProps<{
  /** 树节点（已分组排序）；空数组 = 未打开工程 */
  nodes: readonly ResourceNode[];
  /** 当前活动文档路径（高亮联动） */
  activePath: string | undefined;
  /** 搜索/最近模式下要过滤的节点（资源模式下为全部） */
  filter?: (node: ResourceNode) => boolean;
}>();

const emit = defineEmits<{
  (e: "open", path: string): void;
}>();

/** 折叠的目录路径集合（本组件本控，不入持久化——属瞬时视图态） */
const collapsed = new Set<string>();

function toggle(node: ResourceNode): void {
  if (!node.collapsible) return;
  if (collapsed.has(node.path)) collapsed.delete(node.path);
  else collapsed.add(node.path);
}

/** 关键词（由父组件经 v-model 传入，避免本组件自持搜索状态） */
const keyword = defineModel<string>("keyword", { default: "" });

const isCollapsed = (node: ResourceNode): boolean => collapsed.has(node.path);

/** 树形渲染（保留目录层级 + 折叠态）：搜索/最近模式用扁平列表，资源模式用层级 */
function visibleTree(
  nodes: readonly ResourceNode[],
  depth = 0,
): { node: ResourceNode; depth: number }[] {
  const out: { node: ResourceNode; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children.length > 0 && !isCollapsed(node)) {
      out.push(...visibleTree(node.children, depth + 1));
    }
  }
  return out;
}

/** 资源模式 = 层级视图（目录可折叠）；搜索/最近 = 扁平过滤结果 */
const rows = computed<{ node: ResourceNode; depth: number }[]>(() => {
  if (props.filter !== undefined) {
    return flattenResources(props.nodes)
      .filter(props.filter)
      .map((node) => ({ node, depth: 0 }));
  }
  return visibleTree(props.nodes);
});

/** 当前视图下的空态文案（区分「没工程」与「没匹配」） */
const emptyText = computed(() => {
  if (props.nodes.length === 0) return "未打开工程";
  return keyword.value.trim() === "" ? "无条目" : `无匹配「${keyword.value.trim()}」`;
});
</script>

<template>
  <div class="resource-tree">
    <p v-if="nodes.length === 0" class="tree-empty">未打开工程</p>
    <template v-else>
      <p v-if="rows.length === 0" class="tree-empty">{{ emptyText }}</p>
      <ul v-else class="tree-list">
        <li v-for="row in rows" :key="row.node.path">
          <button
            class="tree-row"
            :class="{
              active: row.node.path === activePath,
              readonly: row.node.readOnly,
              dir: row.node.collapsible,
            }"
            :style="{ paddingLeft: `${8 + row.depth * 12}px` }"
            :title="
              row.node.readOnly
                ? `${row.node.path}（只读${row.node.kind === 'saves' ? '：运行时产物，不归编辑器' : ''}）`
                : row.node.path
            "
            :aria-current="row.node.path === activePath"
            @click="
              row.node.collapsible
                ? toggle(row.node)
                : emit('open', row.node.path)
            "
          >
            <span
              v-if="row.node.collapsible"
              class="tree-caret"
              :class="{ closed: isCollapsed(row.node) }"
              aria-hidden="true"
            ></span>
            <span class="tree-kind" :data-kind="row.node.kind" aria-hidden="true"></span>
            <span class="tree-name">{{ row.node.name }}</span>
            <span v-if="row.node.readOnly" class="tree-badge">只读</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.resource-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.tree-list {
  list-style: none;
  margin: 0;
  padding: 2px 0;
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 8px;
  background: transparent;
  border: none;
  border-radius: 0;
  color: var(--lf-text-secondary);
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.tree-row:hover {
  background: var(--lf-surface-hover);
}
.tree-row.active {
  background: var(--lf-border-subtle);
  color: var(--lf-text-primary);
}
.tree-row.readonly {
  color: var(--lf-text-hint);
}
/* 种类标记（形状 + 色，不引图标库） */
.tree-kind {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}
.tree-kind[data-kind="story"] {
  background: var(--lf-accent);
  border-color: var(--lf-accent);
}
.tree-kind[data-kind="lang"] {
  border-radius: 50%;
  border-color: var(--lf-success);
}
.tree-kind[data-kind="image"] {
  border-color: var(--lf-warning);
}
.tree-kind[data-kind="audio"] {
  border-radius: 50%;
  border-color: var(--lf-danger);
}
.tree-kind[data-kind="video"] {
  background: var(--lf-accent-strong);
  border-color: var(--lf-accent-strong);
}
.tree-kind[data-kind="manifest"] {
  border-radius: 1px;
  border-width: 2px;
}
.tree-kind[data-kind="saves"] {
  border-style: dashed;
}
.tree-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--lf-font-md);
  font-family: Consolas, "Cascadia Mono", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-badge {
  flex: 0 0 auto;
  font-size: var(--lf-font-xs);
  padding: 0 4px;
  border-radius: 3px;
  background: var(--lf-border-subtle);
  color: var(--lf-text-hint);
}
.tree-empty,
.tree-empty-wrap .tree-empty {
  padding: 8px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-hint);
  font-style: italic;
  list-style: none;
}
</style>
