<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
import type { Story } from "@lingfan/engine";
import { EDITOR_API_KEY } from "../contracts";
import { useDialog } from "../dialogInjection";
import {
  branchPointerToCommand,
  indexStory,
  isBranchTarget,
  planBranchInsertion,
} from "@lingfan/editor";

/**
 * 节点图：列 = 节点，jump/menu/navigate 的列目标 = 边。
 * 视图操作：节点拖拽（位置按故事记忆入 localStorage）+ 背景拖拽平移 +
 * Ctrl+滚轮/按钮缩放（视口中心稳定）；缩放不入故事 JSON——编辑器只读写故事树。
 * **连线建分支**：从 flow 节点右缘连接点拉线到另一 flow 节点 → 落库为
 * `jump`（源列无 menu）或 menu 选项（源列最后一个 menu，文本 prompt 可改）；
 * 一次拉线 = 一个 undo 单元（提交在 `editorApi.connectBranch`）；scene 列 / 自连
 * fail-closed 提示。点击边 = 选中对应命令
 * （改在属性面板，删走时间线既有入口）。
 * 舞台编辑随元素系统另立增量。
 */
const props = defineProps<{ story: Story; selectedId: string }>();

const api = inject(EDITOR_API_KEY)!;
/** 应用内对话框（替代原生 alert/prompt） */
const dialog = useDialog();

const NODE_W = 156;
const NODE_H = 46;
const GAP_X = 80;
const GAP_Y = 28;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;

const selectedColumnId = computed(() => props.selectedId);

interface GraphNode {
  id: string;
  x: number;
  y: number;
  isEntry: boolean;
  kind: "flow" | "scene";
}
interface GraphEdge {
  from: string;
  to: string;
  kind: "jump" | "menu" | "navigate";
  key: string;
}

const positions = ref<Map<string, { x: number; y: number }>>(new Map());
const zoom = ref(1);
const scrollEl = ref<HTMLDivElement | null>(null);
const dragging = ref<{ id: string; dx: number; dy: number } | null>(null);
const panState = ref<{ x: number; y: number; sl: number; st: number } | null>(
  null,
);
const svgRoot = ref<SVGSVGElement | null>(null);

const storageKey = computed(() => `lingfan-editor-nodepos:${props.story.id}`);

onMounted(() => {
  try {
    const raw = localStorage.getItem(storageKey.value);
    if (raw !== null) {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      if (typeof saved.zoom === "number") {
        zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, saved.zoom));
      }
      const nodes = (saved.nodes ?? saved) as Record<
        string,
        { x: number; y: number }
      >;
      for (const [id, pos] of Object.entries(nodes)) {
        if (
          pos !== null &&
          typeof pos === "object" &&
          typeof pos.x === "number"
        ) {
          positions.value.set(id, pos);
        }
      }
    }
  } catch {
    /* 布局缓存损坏 = 忽略，退回自动布局 */
  }
  scrollEl.value?.addEventListener("wheel", onWheel, { passive: false });
});

onBeforeUnmount(() => {
  scrollEl.value?.removeEventListener("wheel", onWheel);
});

function persist(): void {
  try {
    const data: Record<string, unknown> = { zoom: zoom.value, nodes: {} };
    for (const [id, pos] of positions.value) {
      (data.nodes as Record<string, { x: number; y: number }>)[id] = pos;
    }
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
        kind:
          props.story.columns.find((c) => c.id === id)?.kind === "flow"
            ? "flow"
            : "scene",
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

/* —— 视图操作：节点拖拽 / 背景平移 / 缩放 —— */

/** 屏幕坐标 → 画布逻辑坐标（含缩放换算） */
function toLogical(clientX: number, clientY: number): { x: number; y: number } {
  const rect = svgRoot.value?.getBoundingClientRect();
  const z = zoom.value;
  if (rect === undefined) return { x: 0, y: 0 };
  return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z };
}

function startDrag(node: GraphNode, event: PointerEvent): void {
  const cursor = toLogical(event.clientX, event.clientY);
  dragging.value = {
    id: node.id,
    dx: cursor.x - node.x,
    dy: cursor.y - node.y,
  };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag, { once: true });
}

function onDragMove(event: PointerEvent): void {
  const drag = dragging.value;
  if (drag === null) return;
  const cursor = toLogical(event.clientX, event.clientY);
  positions.value.set(drag.id, {
    x: Math.max(4, cursor.x - drag.dx),
    y: Math.max(4, cursor.y - drag.dy),
  });
}

function endDrag(): void {
  dragging.value = null;
  window.removeEventListener("pointermove", onDragMove);
  persist();
}

/** 背景拖拽 = 平移视口（调整容器滚动位；节点 pointerdown 已 stop 冒泡） */
function startPan(event: PointerEvent): void {
  const el = scrollEl.value;
  if (el === null) return;
  panState.value = {
    x: event.clientX,
    y: event.clientY,
    sl: el.scrollLeft,
    st: el.scrollTop,
  };
  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", endPan, { once: true });
}

function onPanMove(event: PointerEvent): void {
  const pan = panState.value;
  const el = scrollEl.value;
  if (pan === null || el === null) return;
  el.scrollLeft = pan.sl - (event.clientX - pan.x);
  el.scrollTop = pan.st - (event.clientY - pan.y);
}

function endPan(): void {
  panState.value = null;
  window.removeEventListener("pointermove", onPanMove);
}

/** Ctrl+滚轮缩放（视口中心稳定）；普通滚轮 = 原生滚动 */
function onWheel(event: WheelEvent): void {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const el = scrollEl.value;
  if (el === null) return;
  setZoom(
    zoom.value * (event.deltaY < 0 ? 1.1 : 0.9),
    el.scrollLeft + el.clientWidth / 2,
    el.scrollTop + el.clientHeight / 2,
  );
}

function setZoom(next: number, anchorX: number, anchorY: number): void {
  const el = scrollEl.value;
  if (el === null) return;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (clamped === zoom.value) return;
  const ratio = clamped / zoom.value;
  zoom.value = clamped;
  void nextTick(() => {
    el.scrollLeft = anchorX * ratio - el.clientWidth / 2;
    el.scrollTop = anchorY * ratio - el.clientHeight / 2;
    persist();
  });
}

function zoomIn(): void {
  const el = scrollEl.value;
  if (el === null) return;
  setZoom(
    zoom.value * 1.2,
    el.scrollLeft + el.clientWidth / 2,
    el.scrollTop + el.clientHeight / 2,
  );
}

function zoomOut(): void {
  const el = scrollEl.value;
  if (el === null) return;
  setZoom(
    zoom.value / 1.2,
    el.scrollLeft + el.clientWidth / 2,
    el.scrollTop + el.clientHeight / 2,
  );
}

function zoomReset(): void {
  const el = scrollEl.value;
  if (el === null) return;
  setZoom(
    1,
    el.scrollLeft + el.clientWidth / 2,
    el.scrollTop + el.clientHeight / 2,
  );
}

function selectNode(id: string): void {
  api.selectColumn(id);
}

/* —— 连线建分支：flow 节点右缘连接点拉线到目标节点 —— */

const connecting = ref<{
  fromId: string;
  /** 临时线终点（画布逻辑坐标） */
  x: number;
  y: number;
} | null>(null);

/** 落点命中：逻辑坐标落在哪个节点矩形内（不含源节点） */
function hitNode(x: number, y: number, excludeId: string): GraphNode | undefined {
  return graph.value.nodes.find(
    (node) =>
      node.id !== excludeId &&
      x >= node.x &&
      x <= node.x + NODE_W &&
      y >= node.y &&
      y <= node.y + NODE_H,
  );
}

function startConnect(node: GraphNode, event: PointerEvent): void {
  const cursor = toLogical(event.clientX, event.clientY);
  connecting.value = { fromId: node.id, x: cursor.x, y: cursor.y };
  window.addEventListener("pointermove", onConnectMove);
  window.addEventListener("pointerup", endConnect, { once: true });
}

function onConnectMove(event: PointerEvent): void {
  const current = connecting.value;
  if (current === null) return;
  const cursor = toLogical(event.clientX, event.clientY);
  connecting.value = { ...current, x: cursor.x, y: cursor.y };
}

async function endConnect(event: PointerEvent): Promise<void> {
  const current = connecting.value;
  connecting.value = null;
  window.removeEventListener("pointermove", onConnectMove);
  if (current === null) return;
  const cursor = toLogical(event.clientX, event.clientY);
  const target = hitNode(cursor.x, cursor.y, current.fromId);
  if (target === undefined) return; // 松手在空白处 = 放弃拉线
  const source = props.story.columns.find((c) => c.id === current.fromId);
  const targetColumn = props.story.columns.find((c) => c.id === target.id);
  // fail-closed：非 flow 源/目标、自连一律拒绝并给可操作提示（不静默落库）
  if (!isBranchTarget(source) || !isBranchTarget(targetColumn)) {
    await dialog.notify({
      title: "无法连分支",
      message: `源列与目标列都必须是「流程列」（scene 列是空间层，${
        source?.kind === "flow" ? `「${target.id}」是场景列` : `「${current.fromId}」是场景列`
      }）。`,
      tone: "error",
    });
    return;
  }
  if (source?.id === target.id) return;
  const plan = planBranchInsertion(source, target.id);
  if (plan === null) return;
  // 取消输入 = 放弃（`null` 语义；留空会被引擎当作空文本选项，故此处不允许留空）
  const optionText =
    plan.kind === "menu-option"
      ? await dialog.askText({
          title: `「${current.fromId}」已有菜单`,
          message: "输入新选项的文本。",
          initial: "新选项",
          allowEmpty: false,
        })
      : undefined;
  if (plan.kind === "menu-option" && optionText === null) return;
  const applied = api.connectBranch(current.fromId, target.id, optionText ?? undefined);
  if (!applied) {
    await dialog.notify({
      title: "无法连分支",
      message: `${current.fromId} → ${target.id}（非法组合）`,
      tone: "error",
    });
  }
}

/** 临时拉线终点跟随指针（连接点 → 指针，样式 = 虚线） */
function connectPath(): string {
  const current = connecting.value;
  if (current === null) return "";
  const from = nodeById.value.get(current.fromId);
  if (from === undefined) return "";
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const bend = Math.max(40, Math.abs(current.x - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${current.x - bend} ${current.y}, ${current.x} ${current.y}`;
}

/** 点击边 = 选中对应命令（jump 命令 / menu 命令；改在属性面板，删走时间线） */
function selectEdge(edge: GraphEdge): void {
  api.select(branchPointerToCommand(edge.key));
}
</script>

<script lang="ts">
export default { name: "StoryNodeGraph" };
</script>

<template>
  <div class="node-graph">
    <p class="graph-hint">
      拖节点排列 · 拖背景平移 · Ctrl+滚轮缩放；边：蓝=跳转 · 黄=选项 · 绿=导航 ·
      点击节点选列 · <b>从流程节点右缘圆点拉线到另一节点 = 建分支</b>（点边选中命令）
    </p>
    <div
      ref="scrollEl"
      class="graph-scroll"
      :class="{ panning: panState !== null }"
      @pointerdown="startPan"
    >
      <div
        class="graph-outer"
        :style="{
          width: `${svgSize.w * zoom}px`,
          height: `${svgSize.h * zoom}px`,
        }"
      >
        <div class="graph-canvas" :style="{ transform: `scale(${zoom})` }">
          <svg ref="svgRoot" :width="svgSize.w" :height="svgSize.h">
            <path
              v-for="edge in graph.edges"
              :key="edge.key"
              class="edge clickable"
              :class="edgeClass(edge.kind)"
              :d="edgePath(edge)"
              :title="`选中 ${edge.kind === 'menu' ? '菜单命令' : edge.kind === 'jump' ? '跳转命令' : '导航命令'}`"
              @click.stop="selectEdge(edge)"
            />
            <path
              v-if="connecting !== null"
              class="edge connect-line"
              :d="connectPath()"
            />
          </svg>
          <div
            v-for="node in graph.nodes"
            :key="node.id"
            class="node"
            :class="{
              entry: node.isEntry,
              selected: node.id === selectedColumnId,
            }"
            :style="{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${NODE_W}px`,
              height: `${NODE_H}px`,
            }"
            @pointerdown.stop.prevent="startDrag(node, $event)"
            @click="selectNode(node.id)"
          >
            <span v-if="node.isEntry" class="entry-dot" title="入口列"></span>
            <span class="node-id">{{ node.id }}</span>
            <span class="node-kind">{{
              node.kind === "flow" ? "流" : "景"
            }}</span>
            <span
              v-if="node.kind === 'flow'"
              class="connect-dot"
              role="button"
              :aria-label="`从 ${node.id} 拉出分支`"
              :title="`拖到另一节点 = 建分支（jump / 菜单选项）`"
              @pointerdown.stop.prevent="startConnect(node, $event)"
            ></span>
          </div>
        </div>
      </div>
      <div class="zoom-controls" @pointerdown.stop>
        <button class="mini" title="缩小" aria-label="缩小视图" @click="zoomOut">−</button>
        <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
        <button class="mini" title="放大" aria-label="放大视图" @click="zoomIn">＋</button>
        <button class="mini" title="重置缩放" aria-label="重置缩放" @click="zoomReset">⟲</button>
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
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
}
.graph-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
  background: radial-gradient(circle, color-mix(in srgb, var(--lf-border-subtle) 13%, transparent) 1px, transparent 1px) 0 0 / 22px
    22px;
  border-radius: var(--lf-radius-md);
  cursor: grab;
}
.graph-scroll.panning {
  cursor: grabbing;
}
.graph-canvas {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
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
  stroke: var(--lf-accent);
}
.edge-menu {
  stroke: var(--lf-warning);
}
.edge-navigate {
  stroke: var(--lf-success);
  stroke-dasharray: 5 4;
}
/* 边可点击选中对应命令；拉线中的临时线 */
svg .edge.clickable {
  pointer-events: stroke;
  cursor: pointer;
  stroke-width: 2.4;
}
svg .edge.clickable:hover {
  opacity: 1;
  stroke-width: 3.2;
}
.edge.connect-line {
  stroke: var(--lf-accent-strong);
  stroke-dasharray: 6 4;
}
.connect-dot {
  position: absolute;
  right: -6px;
  top: 50%;
  width: 11px;
  height: 11px;
  transform: translateY(-50%);
  background: var(--lf-accent);
  border: 2px solid var(--lf-info-surface);
  border-radius: 50%;
  cursor: crosshair;
}
.connect-dot:hover {
  transform: translateY(-50%) scale(1.35);
}
.node {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: var(--lf-surface-hover);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
  cursor: grab;
  user-select: none;
}
.node:active {
  cursor: grabbing;
}
.node:hover {
  border-color: color-mix(in srgb, var(--lf-accent) 67%, transparent);
}
.node.selected {
  border-color: var(--lf-accent);
  background: var(--lf-border-subtle);
}
.node.entry {
  border-color: color-mix(in srgb, var(--lf-warning) 67%, transparent);
}
.entry-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lf-warning);
  flex-shrink: 0;
}
.node-id {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lf-text-primary);
}
.node-kind {
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
}
.zoom-controls {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: color-mix(in srgb, var(--lf-surface-overlay) 93%, transparent);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
  padding: 4px 8px;
}
.zoom-value {
  color: var(--lf-text-secondary);
  font-size: var(--lf-font-sm);
  min-width: 38px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
button.mini {
  padding: 0 6px;
  font-size: var(--lf-font-md);
  line-height: 18px;
}
</style>
