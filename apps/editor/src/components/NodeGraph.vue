<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import type { Story } from "@lingfan/engine";
import { indexStory } from "@lingfan/editor";

/**
 * 06 §一.1 节点图（简版）：列 = 节点，jump/menu/navigate 的列目标 = 边。
 * 布局 = 入口 BFS 分层（确定性）；拖拽位置存 localStorage（按 story.id 键，
 * 不入故事 JSON——D1 编辑器只读写故事树）。舞台编辑随元素系统另立增量。
 */
const props = defineProps<{ story: Story; selectedId: string }>();

interface EditorApi {
  selectColumn(id: string): void;
}
const api = inject<EditorApi>("editorApi")!;

const NODE_W = 156;
const NODE_H = 46;
const GAP_X = 80;
const GAP_Y = 28;

const selectedColumnId = computed(() => props.selectedId);

interface GraphNode {
  id: string;
  x: number;
  y: number;
  isEntry: boolean;
}
interface GraphEdge {
  from: string;
  to: string;
  kind: "jump" | "menu" | "navigate";
  key: string;
}

const positions = ref<Map<string, { x: number; y: number }>>(new Map());
const dragging = ref<{ id: string; dx: number; dy: number } | null>(null);
const svgRoot = ref<SVGSVGElement | null>(null);

const storageKey = computed(() => `lingfan-editor-nodepos:${props.story.id}`);

onMounted(() => {
  try {
    const raw = localStorage.getItem(storageKey.value);
    if (raw !== null) {
      const saved = JSON.parse(raw) as Record<string, { x: number; y: number }>;
      for (const [id, pos] of Object.entries(saved)) {
        positions.value.set(id, pos);
      }
    }
  } catch {
    /* 布局缓存损坏 = 忽略，退回自动布局 */
  }
});

function persist(): void {
  try {
    const data: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of positions.value) data[id] = pos;
    localStorage.setItem(storageKey.value, JSON.stringify(data));
  } catch {
    /* 存储不可用（隐私模式）= 布局仅本次会话有效 */
  }
}

const graph = computed(() => {
  const index = indexStory(props.story);
  const ids = props.story.columns.map((c) => c.id);
  const idSet = new Set(ids);
  // 邻接（仅存在的列目标；call→function 不进列图）
  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) adjacency.set(id, new Set());
  const edges: GraphEdge[] = [];
  for (const target of index.targets) {
    if (target.kind !== "column") continue;
    const fromMatch = /\/columns\/(\d+)/.exec(target.pointer);
    if (fromMatch === null) continue;
    const from = props.story.columns[Number(fromMatch[1])]?.id;
    if (from === undefined || !idSet.has(target.target)) continue;
    const kind: GraphEdge["kind"] = target.pointer.includes("/options/")
      ? "menu"
      : target.pointer.endsWith("/target")
        ? "jump"
        : "navigate";
    edges.push({ from, to: target.target, kind, key: `${target.pointer}` });
    adjacency.get(from)?.add(target.target);
  }
  // BFS 分层（环安全）
  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  const root = idSet.has(props.story.entry) ? props.story.entry : ids[0];
  if (root !== undefined) {
    layerOf.set(root, 0);
    queue.push(root);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    for (const next of adjacency.get(current) ?? []) {
      if (!layerOf.has(next)) {
        layerOf.set(next, layerOf.get(current)! + 1);
        queue.push(next);
      }
    }
  }
  const fallbackLayer = Math.max(0, ...layerOf.values()) + 1;
  for (const id of ids) {
    if (!layerOf.has(id)) layerOf.set(id, fallbackLayer);
  }
  // 层内纵向排布 + 已拖拽位置优先
  const perLayer = new Map<number, string[]>();
  for (const id of ids) {
    const layer = layerOf.get(id)!;
    const bucket = perLayer.get(layer) ?? [];
    bucket.push(id);
    perLayer.set(layer, bucket);
  }
  const nodes: GraphNode[] = [];
  for (const [layer, bucket] of [...perLayer.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    bucket.forEach((id, i) => {
      const dragged = positions.value.get(id);
      nodes.push({
        id,
        x: dragged?.x ?? layer * (NODE_W + GAP_X) + 24,
        y: dragged?.y ?? i * (NODE_H + GAP_Y) + 24,
        isEntry: id === props.story.entry,
      });
    });
  }
  return { nodes, edges };
});

const nodeById = computed(() => {
  const map = new Map<string, GraphNode>();
  for (const node of graph.value.nodes) map.set(node.id, node);
  return map;
});

const svgSize = computed(() => {
  let w = 400;
  let h = 240;
  for (const node of graph.value.nodes) {
    w = Math.max(w, node.x + NODE_W + 40);
    h = Math.max(h, node.y + NODE_H + 40);
  }
  return { w, h };
});

function edgePath(edge: GraphEdge): string {
  const from = nodeById.value.get(edge.from);
  const to = nodeById.value.get(edge.to);
  if (from === undefined || to === undefined) return "";
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function edgeClass(kind: GraphEdge["kind"]): string {
  return `edge-${kind}`;
}

function startDrag(node: GraphNode, event: PointerEvent): void {
  const svg = svgRoot.value;
  if (svg === null) return;
  const rect = svg.getBoundingClientRect();
  dragging.value = {
    id: node.id,
    dx: event.clientX - rect.left - node.x,
    dy: event.clientY - rect.top - node.y,
  };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag, { once: true });
}
function onDragMove(event: PointerEvent): void {
  const drag = dragging.value;
  const svg = svgRoot.value;
  if (drag === null || svg === null) return;
  const rect = svg.getBoundingClientRect();
  positions.value.set(drag.id, {
    x: Math.max(4, event.clientX - rect.left - drag.dx),
    y: Math.max(4, event.clientY - rect.top - drag.dy),
  });
}
function endDrag(): void {
  dragging.value = null;
  persist();
}

function selectNode(id: string): void {
  api.selectColumn(id);
}
</script>

<script lang="ts">
export default { name: "StoryNodeGraph" };
</script>

<template>
  <div class="node-graph">
    <p class="graph-hint">
      拖拽排列（按故事记忆）；边：蓝=跳转 · 黄=选项 · 绿=导航 · 点击节点选列
    </p>
    <div class="graph-scroll">
      <svg ref="svgRoot" :width="svgSize.w" :height="svgSize.h">
        <path
          v-for="edge in graph.edges"
          :key="edge.key"
          class="edge"
          :class="edgeClass(edge.kind)"
          :d="edgePath(edge)"
        />
      </svg>
      <div
        v-for="node in graph.nodes"
        :key="node.id"
        class="node"
        :class="{ entry: node.isEntry, selected: node.id === selectedColumnId }"
        :style="{
          left: `${node.x}px`,
          top: `${node.y}px`,
          width: `${NODE_W}px`,
          height: `${NODE_H}px`,
        }"
        @pointerdown.prevent="startDrag(node, $event)"
        @click="selectNode(node.id)"
      >
        <span v-if="node.isEntry" class="entry-dot" title="入口列"></span>
        <span class="node-id">{{ node.id }}</span>
        <span class="node-kind">{{
          story.columns.find((c) => c.id === node.id)?.kind === "flow"
            ? "流"
            : "景"
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-graph {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.graph-hint {
  margin: 0;
  color: #565f89;
  font-size: 11px;
}
.graph-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
  background: radial-gradient(circle, #24283b22 1px, transparent 1px) 0 0 / 22px
    22px;
  border-radius: 6px;
}
svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.edge {
  fill: none;
  stroke-width: 1.6;
  opacity: 0.75;
}
.edge-jump {
  stroke: #7aa2f7;
}
.edge-menu {
  stroke: #e0af68;
}
.edge-navigate {
  stroke: #9ece6a;
  stroke-dasharray: 5 4;
}
.node {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: #1a1b26;
  border: 1px solid #3b4261;
  border-radius: 8px;
  cursor: grab;
  user-select: none;
}
.node:active {
  cursor: grabbing;
}
.node:hover {
  border-color: #7aa2f7aa;
}
.node.selected {
  border-color: #7aa2f7;
  background: #24283b;
}
.node.entry {
  border-color: #e0af68aa;
}
.entry-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e0af68;
  flex-shrink: 0;
}
.node-id {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #c0caf5;
}
.node-kind {
  font-size: 10px;
  color: #565f89;
}
</style>
