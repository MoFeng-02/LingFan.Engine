<script setup lang="ts">
import { computed, inject } from "vue";
import type { Story } from "@lingfan/engine";
import { storySteps, type StepEdge, type StoryStep } from "@lingfan/editor";

/**
 * 步骤视图：以「步骤」为单位的布局——每列一条泳道，泳道内步骤盒按序竖排，
 * 分支步骤自右缘拉出连线指向目标列首步（一个步骤多目标 = 分叉，多边汇入 = 合流）。
 *
 * 步骤与出边的判定**全在 `@lingfan/editor` 的 `storySteps`**（其边界判据取自引擎的等待声明表）；
 * 本组件只做坐标换算与呈现，不含任何叙事语义。
 * 视图确定性排布（分层定 x、步序定 y），**不记忆布局**——步骤视图是派生视图，记忆即第二真源。
 */
const props = defineProps<{ story: Story; selectedId: string }>();

interface EditorApi {
  select(pointer: string | null): void;
  selectColumn(id: string): void;
}
const api = inject<EditorApi>("editorApi")!;

const LANE_W = 232;
const HEADER_H = 34;
const STEP_H = 44;
const GAP_X = 96;
const GAP_Y = 12;
const PAD = 20;

const layout = computed(() => storySteps(props.story));

/** 泳道几何：x 由 BFS 层决定；**同层内多条泳道纵向依次排布**（否则会重叠）。 */
interface LaneBox {
  columnId: string;
  x: number;
  y: number;
  height: number;
}
const laneBoxes = computed<LaneBox[]>(() => {
  const byLayer = new Map<number, typeof layout.value.lanes>();
  for (const lane of layout.value.lanes) {
    const bucket = byLayer.get(lane.layer) ?? [];
    bucket.push(lane);
    byLayer.set(lane.layer, bucket);
  }
  const boxes: LaneBox[] = [];
  for (const [layer, bucket] of [...byLayer.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    let y = PAD;
    for (const lane of bucket) {
      const height = HEADER_H + lane.steps.length * (STEP_H + GAP_Y);
      boxes.push({
        columnId: lane.columnId,
        x: PAD + layer * (LANE_W + GAP_X),
        y,
        height,
      });
      y += height + GAP_Y;
    }
  }
  return boxes;
});

const laneBoxOf = computed(
  () => new Map(laneBoxes.value.map((box) => [box.columnId, box])),
);

/** 步骤盒左上角坐标（泳道 y + 泳道头高 + 步序） */
function stepPos(columnId: string, stepIndex: number): { x: number; y: number } {
  const box = laneBoxOf.value.get(columnId);
  const x = box?.x ?? PAD;
  const y = (box?.y ?? PAD) + HEADER_H + stepIndex * (STEP_H + GAP_Y);
  return { x, y };
}

const svgSize = computed(() => {
  let w = 400;
  let h = 240;
  for (const box of laneBoxes.value) {
    w = Math.max(w, box.x + LANE_W + PAD);
    h = Math.max(h, box.y + box.height + PAD);
  }
  return { w, h };
});

/** 边几何：源 = 步骤盒右缘中点；目标 = 目标列**首步**左缘中点（无步则指泳道头） */
const edgeGeometry = computed(() =>
  layout.value.edges.map((edge) => {
    const from = stepPos(edge.fromColumnId, edge.fromStep);
    const targetLane = layout.value.lanes.find(
      (lane) => lane.columnId === edge.toColumnId,
    );
    const hasSteps = (targetLane?.steps.length ?? 0) > 0;
    const to = hasSteps
      ? stepPos(edge.toColumnId, 0)
      : { x: laneBoxOf.value.get(edge.toColumnId)?.x ?? PAD, y: 0 };
    const x1 = from.x + LANE_W;
    const y1 = from.y + STEP_H / 2;
    const x2 = to.x;
    const y2 = to.y + (hasSteps ? STEP_H / 2 : 8);
    const bend = Math.max(40, Math.abs(x2 - x1) / 2);
    return {
      edge,
      path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    };
  }),
);

/** 合流入度：目标列首步被多少条边指向（>1 显示合流标记） */
const mergeCount = computed(() => {
  const counts = new Map<string, number>();
  for (const edge of layout.value.edges) {
    counts.set(edge.toColumnId, (counts.get(edge.toColumnId) ?? 0) + 1);
  }
  return counts;
});

/** 合流标记文案（≤1 条边返回空串，模板据此不出标记） */
function mergeText(columnId: string): string {
  const count = mergeCount.value.get(columnId) ?? 0;
  return count > 1 ? `合流 ×${count}` : "";
}

/** 首步才挂合流标记（合流点画在泳道入口步上） */
function mergeTextOfStep(step: StoryStep): string {
  return step.index === 0 ? mergeText(step.columnId) : "";
}

function edgeClass(kind: StepEdge["kind"]): string {
  return `edge-${kind}`;
}

/** 步骤收尾说明：等待态 + 硬等待 / 可跳过 区分（展示层语义，判定仍来自引擎声明表） */
function stepLabel(step: StoryStep): string {
  const names: Record<string, string> = {
    dialog: "对话",
    menu: "菜单",
    wait: "等待",
    input: "输入",
    video: "过场",
    minigame: "小游戏",
    none: "出口",
  };
  return names[step.waiting] ?? step.waiting;
}

/** 成员命令的 op 摘要（步骤盒内的第二行：`say ×2 · set`；首次出现序，合并同名计数） */
function opSummary(step: StoryStep): string {
  const column = props.story.columns.find((c) => c.id === step.columnId);
  const field: "commands" | "entry" =
    column?.kind === "flow" ? "commands" : "entry";
  const list = (field === "commands" ? column?.commands : column?.entry) ?? [];
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const pointer of step.commands) {
    const index = Number(pointer.split("/").pop());
    const cmd = list[index] as { op?: unknown } | undefined;
    const op = typeof cmd?.op === "string" ? cmd.op : "?";
    if (!counts.has(op)) order.push(op);
    counts.set(op, (counts.get(op) ?? 0) + 1);
  }
  return order
    .map((op) => {
      const count = counts.get(op) ?? 1;
      return count > 1 ? `${op} ×${count}` : op;
    })
    .join(" · ");
}

function onStepClick(step: StoryStep): void {
  api.select(step.endPointer); // 现有 select 会切回时间线并滚到该行（零新增管道）
}
</script>

<script lang="ts">
export default { name: "StoryStepLayout" };
</script>

<template>
  <div class="step-layout">
    <p class="step-hint">
      一步 = 两个等待态之间的所有命令（阻塞是这一步的终点）；泳道 = 列，盒内为该步的顶层命令 ·
      边：蓝=跳转 · 黄=选项 · 绿=导航 · 边上的数字 = 汇入该列的合流条数 ·
      <b>点击步骤 = 定位到时间线对应行</b> · 点击泳道头 = 选中该列
    </p>
    <div class="step-scroll">
      <div
        class="step-canvas"
        :style="{ width: `${svgSize.w}px`, height: `${svgSize.h}px` }"
      >
        <svg :width="svgSize.w" :height="svgSize.h">
          <path
            v-for="item in edgeGeometry"
            :key="item.edge.pointer"
            class="edge"
            :class="edgeClass(item.edge.kind)"
            :d="item.path"
          >
            <title>
              {{
                `${item.edge.kind === "menu" ? "选项" : item.edge.kind === "jump" ? "跳转" : "导航"}${item.edge.label === undefined ? "" : `「${item.edge.label}」`} → ${item.edge.toColumnId}`
              }}
            </title>
          </path>
        </svg>

        <div
          v-for="box in laneBoxes"
          :key="`lane-${box.columnId}`"
          class="lane"
          :class="{ selected: box.columnId === selectedId }"
          :style="{
            left: `${box.x}px`,
            top: `${box.y}px`,
            width: `${LANE_W}px`,
            height: `${box.height}px`,
          }"
        ></div>

        <button
          v-for="lane in layout.lanes"
          :key="`head-${lane.columnId}`"
          type="button"
          class="lane-head"
          :class="{ selected: lane.columnId === selectedId }"
          :style="{
            left: `${laneBoxOf.get(lane.columnId)?.x ?? PAD}px`,
            top: `${laneBoxOf.get(lane.columnId)?.y ?? PAD}px`,
            width: `${LANE_W}px`,
          }"
          @click="api.selectColumn(lane.columnId)"
        >
          <span class="lane-id">{{ lane.columnId }}</span>
          <span class="lane-kind">{{ lane.kind === "flow" ? "流" : "景" }}</span>
          <span class="lane-count">{{
            lane.kind === "flow"
              ? `${lane.steps.length} 步`
              : `${lane.elementCount} 元素`
          }}</span>
        </button>

        <button
          v-for="step in layout.lanes.flatMap((lane) => lane.steps)"
          :key="`${step.columnId}#${step.index}`"
          type="button"
          class="step-box"
          :class="{ exit: step.kind === 'exit', hard: step.hard }"
          :style="{
            left: `${stepPos(step.columnId, step.index).x}px`,
            top: `${stepPos(step.columnId, step.index).y}px`,
            width: `${LANE_W}px`,
            height: `${STEP_H}px`,
          }"
          :title="`${step.columnId} · 第 ${step.index + 1} 步（${stepLabel(step)}）· 点击定位到时间线`"
          @click="onStepClick(step)"
        >
          <span class="step-no">{{ step.index + 1 }}</span>
          <span class="step-ops">{{ opSummary(step) }}</span>
          <span class="step-wait">
            {{ stepLabel(step) }}<template v-if="step.hard">（不可跳过）</template>
          </span>
          <span
            v-if="mergeTextOfStep(step) !== ''"
            class="merge-badge"
            :title="`合流：${mergeCount.get(step.columnId)} 条分支汇入本列`"
            >{{ mergeTextOfStep(step) }}</span
          >
        </button>

        <p
          v-for="lane in layout.lanes.filter((l) => l.steps.length === 0)"
          :key="`empty-${lane.columnId}`"
          class="lane-empty"
          :style="{
            left: `${laneBoxOf.get(lane.columnId)?.x ?? PAD}px`,
            top: `${(laneBoxOf.get(lane.columnId)?.y ?? PAD) + HEADER_H}px`,
            width: `${LANE_W}px`,
          }"
        >
          0 步{{ lane.kind === "scene" ? "（元素列：元素是声明式空间层，不计步）" : "" }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.step-hint {
  margin: 0;
  color: #565f89;
  font-size: 11px;
}
.step-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
  background: radial-gradient(circle, #24283b22 1px, transparent 1px) 0 0 / 22px
    22px;
  border-radius: 6px;
}
.step-canvas {
  position: relative;
}
svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.edge {
  fill: none;
  stroke-width: 1.8;
  opacity: 0.8;
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
/* 泳道背景与头（列容器，非步骤） */
.lane {
  position: absolute;
  background: #1a1b2622;
  border: 1px dashed #2b3050;
  border-radius: 8px;
  pointer-events: none;
}
.lane.selected {
  border-color: #3d59a1;
}
.lane-head {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  background: #1a1b26;
  border: 1px solid #3b4261;
  border-radius: 8px;
  color: #c0caf5;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.lane-head.selected {
  border-color: #7aa2f7;
}
.lane-kind,
.lane-count {
  color: #565f89;
  font-size: 11px;
}
.lane-count {
  margin-left: auto;
}
/* 步骤盒 */
.step-box {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  background: #1a1b26;
  border: 1px solid #3b4261;
  border-left: 3px solid #7aa2f7;
  border-radius: 6px;
  color: #c0caf5;
  font-size: 12px;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
}
.step-box:hover {
  border-color: #7aa2f7;
  background: #1f2335;
}
.step-box.exit {
  border-left-color: #565f89;
  color: #9aa0c0;
}
.step-box.hard {
  border-left-style: double;
}
.step-no {
  flex: none;
  width: 16px;
  color: #565f89;
  font-size: 11px;
}
.step-ops {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.step-wait {
  flex: none;
  color: #7dcfff;
  font-size: 11px;
}
.merge-badge {
  position: absolute;
  right: -6px;
  top: -8px;
  padding: 0 5px;
  background: #bb9af7;
  border-radius: 8px;
  color: #16161f;
  font-size: 10px;
  line-height: 15px;
}
.lane-empty {
  position: absolute;
  margin: 0;
  color: #565f89;
  font-size: 11px;
}
</style>