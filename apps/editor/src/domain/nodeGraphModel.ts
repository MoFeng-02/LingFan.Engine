/**
 * 节点图模型：列图（列 = 节点，列目标 = 边）的纯计算。
 *
 * 邻接、BFS 分层（环安全）、层内排布与已拖拽位置优先，全部是纯函数——
 * 组件只负责视口交互与渲染。这类判据集中在此才可单测。
 *
 * 依赖方向：仅依赖 `@lingfan-engine/editor` 的 `indexStory`；零框架、零 DOM、零 I/O。
 */
import { indexStory } from "@lingfan-engine/editor";
import type { Story } from "@lingfan-engine/core";

/** 节点尺寸与层间距（自动布局用） */
export const NODE_W = 156;
export const NODE_H = 46;
export const GAP_X = 80;
export const GAP_Y = 28;

/** 列图节点：`kind` 区分流程列（可连分支）与场景列 */
export interface GraphNode {
  id: string;
  x: number;
  y: number;
  isEntry: boolean;
  kind: "flow" | "scene";
}

/** 列图边：jump / menu / navigate 三类列目标 */
export interface GraphEdge {
  from: string;
  to: string;
  kind: "jump" | "menu" | "navigate";
  key: string;
}

/**
 * 由故事构建列图：邻接取「仅存在的列目标」（call→function 不进列图），
 * BFS 分层（环安全），未连通列落到最深层的下一层；已拖拽位置优先于自动布局。
 */
export function buildGraphModel(
  story: Story,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const index = indexStory(story);
  const ids = story.columns.map((c) => c.id);
  const idSet = new Set(ids);
  // 邻接（仅存在的列目标；call→function 不进列图）
  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) adjacency.set(id, new Set());
  const edges: GraphEdge[] = [];
  for (const target of index.targets) {
    if (target.kind !== "column") continue;
    const fromMatch = /\/columns\/(\d+)/.exec(target.pointer);
    if (fromMatch === null) continue;
    const from = story.columns[Number(fromMatch[1])]?.id;
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
  const root = idSet.has(story.entry) ? story.entry : ids[0];
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
      const dragged = positions.get(id);
      nodes.push({
        id,
        x: dragged?.x ?? layer * (NODE_W + GAP_X) + 24,
        y: dragged?.y ?? i * (NODE_H + GAP_Y) + 24,
        isEntry: id === story.entry,
        kind:
          story.columns.find((c) => c.id === id)?.kind === "flow"
            ? "flow"
            : "scene",
      });
    });
  }
  return { nodes, edges };
}

/** 画布尺寸（含边距，至少 400×240） */
export function svgExtentOf(nodes: readonly GraphNode[]): { w: number; h: number } {
  let w = 400;
  let h = 240;
  for (const node of nodes) {
    w = Math.max(w, node.x + NODE_W + 40);
    h = Math.max(h, node.y + NODE_H + 40);
  }
  return { w, h };
}

/** 边的贝塞尔路径（源节点右缘中点 → 目标节点左缘中点） */
export function edgePathOf(
  edge: GraphEdge,
  nodeById: ReadonlyMap<string, GraphNode>,
): string {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (from === undefined || to === undefined) return "";
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

/** 拉线临时路径（源节点右缘中点 → 指针落点，样式 = 虚线） */
export function connectPathOf(
  from: GraphNode,
  to: { x: number; y: number },
): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const bend = Math.max(40, Math.abs(to.x - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

/** 落点命中：逻辑坐标落在哪个节点矩形内（不含 excludeId） */
export function hitNodeAt(
  nodes: readonly GraphNode[],
  x: number,
  y: number,
  excludeId: string,
): GraphNode | undefined {
  return nodes.find(
    (node) =>
      node.id !== excludeId &&
      x >= node.x &&
      x <= node.x + NODE_W &&
      y >= node.y &&
      y <= node.y + NODE_H,
  );
}
