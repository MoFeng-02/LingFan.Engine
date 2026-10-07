<script setup lang="ts">
/**
 * 资源树（侧栏主体）：工程维度的资源浏览。
 *
 * 纯渲染 + 折叠态本控——**数据与分组规则全在 `resourceTree.ts` 纯函数里**（可测），
 * 本组件只负责「把节点画出来 + 折叠/选中回抛」。
 *
 * 状态完备：空（未打开工程）/ 无匹配（搜索）/ 加载中 各有明确文案，
 * **不用空白或 spinner 代替解释**。
 */
import { computed, nextTick, ref, watch } from "vue";
import type { KeyValueStorage } from "@lingfan/editor";
import type { ResourceNode } from "../resourceTree";
import {
  createCollapsedDirsStore,
  flattenResources,
} from "../resourceTree";

const props = defineProps<{
  /** 树节点（已分组排序）；空数组 = 未打开工程 */
  nodes: readonly ResourceNode[];
  /** 当前活动文档路径（高亮联动） */
  activePath: string | undefined;
  /** 搜索/最近模式下要过滤的节点（资源模式下为全部） */
  filter?: (node: ResourceNode) => boolean;
  /** 工程身份（收展持久化的隔离轴，T7）；缺省/空 = 仅会话内折叠态 */
  projectId?: string;
}>();

const emit = defineEmits<{
  (e: "open", path: string): void;
}>();

/**
 * 折叠的目录路径集合（本组件本控；按工程持久化——`projectId` 给了才落本机）。
 *
 * **必须是 `ref`**：若是裸 `Set`，`toggle` 改了集合但 Vue **不追踪非响应式状态**
 * ⇒ 永不重渲染，点了没反应。
 */
const collapsed = ref<ReadonlySet<string>>(new Set());

/** 浏览器可能禁站点数据（取 `localStorage` 本身即抛）——失败即无持久化，不影响可用性 */
function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
const collapsedStore = createCollapsedDirsStore(safeLocalStorage());

/** 换工程随身份归位（阻止组件视图态跨工程残留） */
watch(
  () => props.projectId,
  (id) => {
    collapsed.value = collapsedStore.load(id ?? "");
  },
  { immediate: true },
);

function toggle(node: ResourceNode): void {
  if (!node.collapsible) return;
  const next = new Set(collapsed.value);
  if (next.has(node.path)) next.delete(node.path);
  else next.add(node.path);
  collapsed.value = next;
  collapsedStore.save(props.projectId ?? "", next);
}

/** 关键词（由父组件经 v-model 传入，避免本组件自持搜索状态） */
const keyword = defineModel<string>("keyword", { default: "" });

const isCollapsed = (node: ResourceNode): boolean => collapsed.value.has(node.path);

/** 容器（定位当前打开时滚动用） */
const container = ref<HTMLElement | null>(null);

/**
 * **定位当前打开**：活动路径变化 ⇒ 展开祖先链 + 滚动到可视区。
 * 只做 `active` 高亮是不够的——节点被折叠藏起时高亮等于不存在。
 * 高亮键 = `activePath`（App 已换算成**磁盘路径**——合成文档路径对 `.story`
 * 工程永不命中，见 App 的 `resourceFocusPath`）。
 */
watch(
  () => props.activePath,
  async (active) => {
    if (active === undefined || active === "") return;
    // 展开全部祖先目录（`Stories/chapter1/x.story` ⇒ `Stories/`、`Stories/chapter1/`）
    const ancestors = new Set(collapsed.value);
    let dir = active.includes("/") ? active.slice(0, active.lastIndexOf("/") + 1) : "";
    while (dir !== "") {
      ancestors.delete(dir);
      dir = dir.includes("/") && dir.lastIndexOf("/") > 0
        ? dir.slice(0, dir.lastIndexOf("/", dir.length - 2) + 1)
        : "";
    }
    if (ancestors.size !== collapsed.value.size) {
      collapsed.value = ancestors;
      collapsedStore.save(props.projectId ?? "", ancestors);
    }
    await nextTick();
    container.value
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  },
  { immediate: true },
);

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
  <div ref="container" class="resource-tree">
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
            :data-path="row.node.path"
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
  border-radius: var(--lf-radius-sm);
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
  border-radius: var(--lf-radius-sm);
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
  border-radius: var(--lf-radius-sm);
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
