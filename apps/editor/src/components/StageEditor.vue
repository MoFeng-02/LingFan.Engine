<script setup lang="ts">
import { computed, inject, ref, type CSSProperties } from "vue";
import { ELEMENT_CONTAINER_TYPES, type ResourcePort, type Story } from "@lingfan/engine";
import {
  createElementDraft,
  describeElement,
  draggedPosition,
  elementLabel,
  planElementDrop,
  type FieldDescriptor,
} from "@lingfan/editor";
import { elementSource } from "@lingfan/ui";
import EmptyState from "./EmptyState.vue";
import { EDITOR_API_KEY } from "../contracts";
import type { EmptyAction } from "../viewState";
import { interactionIntent, shouldSuppressClick } from "../pointerIntent";
import { snapGuides, type SnapCandidate, type SnapResult } from "../snapGuides";
import FieldRow from "./FieldRow.vue";

/**
 * 舞台编辑（scene 列的空间布局视图）：
 * - **画布**：把目标 scene 列的 `elements[]` 按 `x/y/width/height/zindex/opacity` 摆成可拖拽方块。
 *   编辑仍以布局为主（占位方块 + 尺寸/层级）。
 * - **资源缩略（编辑器工程模型）**：打开工程后，带 `source/src/path` 的元素把已解析
 *   资源铺成方块背景（`@lingfan/ui` 的 `elementSource` 取路径，与渲染器同源判定）；
 *   未打开工程 = 无资源根 → 保持占位方块。
 * - **拖拽**：拖拽中仅本地预览（transform），**松手才写回一次** `x`/`y`，避免每帧污染 undo。
 *   字符串坐标（如 `"50%"`）保持原值不动（像素位移无法与百分比相加）。
 * - **落点创建**：从组件面板拖元素到画布 → 落点即 `x`/`y`，**一次拖入 = 一个 undo
 *   单元**（提交在 `editorApi.insertElement`）；落点在某容器块内 → 进其 `children`
 *   （坐标换算为相对容器原点，与运行期渲染一致）。类型/载荷 fail-closed：非元素类、
 *   未知类型一律忽略。
 * - **属性**：选中元素 → 契约驱动的 `describeElement` 字段表（直接复用 `FieldRow`）。
 */
const props = defineProps<{
  story: Story;
  pointer: string | null;
  /** 已打开工程的资源供给端口（缺省 = 未打开工程：不解析缩略） */
  resourcePort?: ResourcePort;
  /**
   * 工程级**第一个场景列**的 id（App 从整工程树计算）。
   * 空态动作「去选一个场景列」要用它导航——**切片里只有当前一列**，
   * 在切片里 findIndex scene 列是死动作（本组件吃不到工程级树，宿主给）。
   */
  firstSceneColumnId?: string | null;
}>();

/**
 * 资源缩略缓存：声明式侧缓存（`@lingfan/ui` 的 `createElementResourceResolver` 面向
 * 「解析落地后重渲染 DOM」的命令式宿主；这里需要**响应式**失效，故就地维护）。
 * 失败保持占位方块（不伪造 URL）。
 */
const thumbUrls = ref<Record<string, string>>({});
const thumbPending = new Set<string>();

function elementThumb(element: Record<string, unknown>): string | undefined {
  const path = elementSource(element);
  if (path === undefined || props.resourcePort === undefined) return undefined;
  const cached = thumbUrls.value[path];
  if (cached !== undefined) return cached;
  if (!thumbPending.has(path)) {
    thumbPending.add(path);
    void props.resourcePort.resolve(path).then(
      (url) => {
        thumbPending.delete(path);
        thumbUrls.value = { ...thumbUrls.value, [path]: url };
      },
      () => {
        thumbPending.delete(path);
      },
    );
  }
  return undefined;
}

const api = inject(EDITOR_API_KEY)!;

/**
 * 舞台编辑的**当前列 = 活动文档切片的列**（`props.story.columns[0]`）。
 *
 * **为什么不能从选中指针推导**：用户若从**列侧栏选中列**，
 * `selectColumn` 会先 `select(null)`（跨列不保留命令选中）⇒ `pointer = null`
 * ⇒ `sceneColumn = undefined` ⇒ `elements = []` ⇒ 舞台对**场景列**误报
 * 「当前列没有空间层」，且**画布上没有任何元素可拖**（「拖动不能改变位置」同根）。
 * 活动文档恒单列（「一文档 = 一列」不变量）⇒ 切片首列就是当前列，与选中态无关。
 */
const sceneColumn = computed(() => {
  const column = props.story.columns[0];
  if (column === undefined || column.kind !== "scene") return undefined;
  return { pointer: "/columns/0", column };
});

const elements = computed<Array<Record<string, unknown>>>(() => {
  const scene = sceneColumn.value;
  return (scene?.column.elements ?? []) as Array<Record<string, unknown>>;
});

/** 指针选中的元素下标（`/columns/<i>/elements/<j>`） */
const selectedIndex = computed(() => {
  const parts = props.pointer?.split("/") ?? [];
  if (parts[1] !== "columns" || parts[3] !== "elements") return -1;
  const index = Number(parts[4]);
  return Number.isInteger(index) ? index : -1;
});

function elementPointer(index: number): string {
  return `${sceneColumn.value?.pointer ?? ""}/elements/${index}`;
}

/** 画布定位：数字 → px；CSS 长度串原样；缺失 → 层叠默认（便于看到重叠元素） */
function cssPos(value: unknown, fallback: number): string {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value === "string" && value !== "") return value;
  return `${fallback}px`;
}

function cssSize(value: unknown, fallback: number): string {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value === "string" && value !== "") return value;
  return `${fallback}px`;
}

/** 方块样式（含资源缩略背景；`elementThumb` 每次渲染只调一次，避免重复发起解析） */
function blockStyle(
  element: Record<string, unknown>,
  index: number,
): CSSProperties {
  const thumb = elementThumb(element);
  return {
    left: cssPos(element.x, 24 + index * 16),
    top: cssPos(element.y, 24 + index * 16),
    width: cssSize(element.width, 120),
    height: cssSize(element.height, 44),
    opacity: typeof element.opacity === "number" ? element.opacity : 1,
    zIndex: typeof element.zindex === "number" ? element.zindex : index,
    backgroundImage: thumb === undefined ? undefined : `url("${thumb}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    ...previewStyle(index),
  };
}

const drag = ref<{ index: number; dx: number; dy: number } | null>(null);

/** 拖拽中的本地预览（不写文档） */
function previewStyle(index: number): Record<string, string> {
  const current = drag.value;
  if (current === null || current.index !== index) return {};
  return { transform: `translate(${current.dx}px, ${current.dy}px)` };
}

/**
 * 拖拽中的对齐参考线。
 *
 * **只提示、不吸附**：`snapGuides` 只返回"该画哪条线"，**不改**最终坐标 ——
 * 静默把元素挪到吸附位会让"我拖到这儿"与"它落到那儿"不一致（改写作者意图）。
 * 判据与边界见 `apps/editor/src/snapGuides.ts`。
 */
const guides = ref<SnapResult>({ vx: null, hy: null });

/** 其它元素的候选线（左/中/右 · 上/中/下），画布坐标 */
function snapCandidatesOf(index: number): SnapCandidate {
  const canvas = canvasEl.value;
  const origin = canvas?.getBoundingClientRect();
  const v: number[] = [];
  const h: number[] = [];
  if (origin === undefined) return { v, h };
  const canvasBox = canvas?.getBoundingClientRect();
  elements.value.forEach((_el, i) => {
    if (i === index) return; // 不与自己比
    const node = canvas?.querySelector<HTMLElement>(`[data-idx="${i}"]`);
    if (node === null || node === undefined || canvasBox === undefined) return;
    const r = node.getBoundingClientRect();
    // 跳过**真正的全屏背景**（**两个方向都**接近满幅）—— 它的左/中/右覆盖整块画布，
    // 参考线永远命中且无参考价值（用户只看到一条贴边的线）。
    // 阈值必须**两个方向同时**判：若写成 `||`（单方向 90% 即跳），
    //   会把「宽 945 / 画布 1050」这类正常元素也误杀 ⇒ 参考线永不出现。
    if (r.width >= canvasBox.width * 0.92 && r.height >= canvasBox.height * 0.92) return;
    v.push(r.left - origin.left, r.left - origin.left + r.width / 2, r.left - origin.left + r.width);
    h.push(r.top - origin.top, r.top - origin.top + r.height / 2, r.top - origin.top + r.height);
  });
  return { v, h };
}

/**
 * 依**当前实际位置**算参考线（画布坐标）。
 *
 * **不接收位移参数**：`getBoundingClientRect()` 已含 transform 位移，
 *   再补偿一次会让位移算两遍 ⇒ 参考线永不命中（故签名里就没有它）。
 */
function updateGuides(index: number): void {
  const canvas = canvasEl.value;
  const node = canvas?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
  if (canvas === null || canvas === undefined || node === null || node === undefined) {
    guides.value = { vx: null, hy: null };
    return;
  }
  const origin = canvas.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  // `r` 是 `getBoundingClientRect()` —— **已含当前 transform 位移**（`previewStyle` 生效中）。
  //   候选线也是同样口径（各元素的实时矩形）⇒ 直接用 `r` 即可。
  //   若在此**又加一次 dx**（"补回位移"）⇒ 位移算两遍 ⇒ **永远对不齐、参考线永不出现**。
  //   判据只吃"当前实际位置"，不重复补偿。
  guides.value = snapGuides(
    {
      x: r.left - origin.left,
      y: r.top - origin.top,
      width: r.width,
      height: r.height,
    },
    snapCandidatesOf(index),
  );
}

function onPointerDown(index: number, event: PointerEvent): void {
  const element = elements.value[index];
  if (element === undefined) return;
  const target = elementPointer(index);
  // 用**就地选中**（`select`），不用带切视图副作用的那个 ⇒
  //   舞台不会因 `v-else-if` 在按下瞬间被卸载，拖拽的 move/up 监听不会落空。
  api.select(target);
  const startX = event.clientX;
  const startY = event.clientY;
  const probe = { startX, startY, clientX: startX, clientY: startY };
  drag.value = { index, dx: 0, dy: 0 };
  // 指针捕获：拖出元素范围也继续跟手（不 capture 时指针移出会丢事件）
  const handle = event.currentTarget as HTMLElement | null;
  handle?.setPointerCapture?.(event.pointerId);

  const onMove = (moveEvent: PointerEvent): void => {
    probe.clientX = moveEvent.clientX;
    probe.clientY = moveEvent.clientY;
    // **阈值内不显示位移**——否则「想点一下」也会看到元素
    // 跟着手抖一下，像被误认成拖拽。
    if (!shouldSuppressClick(probe)) return;
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    drag.value = { index, dx, dy };
    updateGuides(index);
  };
  const onUp = (upEvent: PointerEvent): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    probe.clientX = upEvent.clientX;
    probe.clientY = upEvent.clientY;
    // 释放前查引用：拖拽中组件可能已被卸载（切工程/换标签）⇒ 空引用会抛。
    if (handle !== null && handle.isConnected && handle.hasPointerCapture?.(upEvent.pointerId)) {
      handle.releasePointerCapture(upEvent.pointerId);
    }
    const dx = upEvent.clientX - startX;
    const dy = upEvent.clientY - startY;
    drag.value = null;
    guides.value = { vx: null, hy: null }; // 参考线只活在拖拽期间
    // 阈值内 = 单击 = **仅选中**（已在 pointerdown 做过），不提交位移
    if (interactionIntent(probe) === "click") return;
    const nextX = draggedPosition(element.x, dx);
    const nextY = draggedPosition(element.y, dy);
    if (nextX !== null) api.update(`${target}/x`, nextX);
    if (nextY !== null) api.update(`${target}/y`, nextY);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/**
 * 空态主动作：**切到工程里第一个场景（scene）列**。
 *
 * 导航目标必须是**工程级**事实（App 从整工程树算好经 prop 传入）——
 * 若在切片里 `findIndex(kind === "scene")`，切片恒单列 ⇒ 当前是 flow 列时
 * 永远找不到 ⇒ **按钮点了没反应**。
 */
function onEmptyAction(action: EmptyAction): void {
  if (action.id !== "goto-scene-column") return;
  const id = props.firstSceneColumnId;
  if (id === undefined || id === null || id === "") return; // 工程里没有 scene 列 ⇒ 不给假出路
  api.selectColumn(id);
}

const selectedElement = computed(() =>
  selectedIndex.value >= 0 ? elements.value[selectedIndex.value] : undefined,
);
const descriptor = computed(() =>
  selectedElement.value === undefined
    ? undefined
    : describeElement(String(selectedElement.value.type ?? "")),
);
const fields = computed<readonly FieldDescriptor[]>(
  () => descriptor.value?.fields ?? [],
);

/**
 * 落点创建：DOM/事件留在组件，**判定与数值走 `@lingfan/editor` 纯函数**。
 * 画布内容坐标 = client 坐标 − 画布原点（含边框：`clientLeft`）+ 滚动量；
 * 容器命中 = 顶级容器块中**DOM 序最后**（默认 z 序最上）包含落点者。
 */
const canvasEl = ref<HTMLDivElement | null>(null);
const dropActive = ref(false);
const PALETTE_TYPE = "application/x-lingfan-palette";

function isPaletteDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(PALETTE_TYPE) ?? false;
}

function onDragOver(event: DragEvent): void {
  if (!isPaletteDrag(event)) return;
  event.preventDefault(); // 允许 drop
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
  dropActive.value = true;
}

function onDragLeave(): void {
  dropActive.value = false;
}

function onDrop(event: DragEvent): void {
  dropActive.value = false;
  const scene = sceneColumn.value;
  const canvas = canvasEl.value;
  if (scene === undefined || canvas === null) return;
  const dt = event.dataTransfer;
  const raw = dt?.getData(PALETTE_TYPE) ?? "";
  if (raw === "") return;
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return; // 畸形载荷 fail-closed
  }
  if (payload === null || typeof payload !== "object") return;
  const { kind, id } = payload as { kind?: unknown; id?: unknown };
  // 只接元素；命令（kind:"op"）的落点创建不在本任务面，忽略
  if (kind !== "element" || typeof id !== "string") return;

  const canvasRect = canvas.getBoundingClientRect();
  const localX = event.clientX - canvasRect.left + canvas.scrollLeft;
  const localY = event.clientY - canvasRect.top + canvas.scrollTop;

  const blocks = canvas.querySelectorAll<HTMLElement>(":scope > .element");
  let hit: { index: number; originX: number; originY: number } | undefined;
  elements.value.forEach((element, index) => {
    if (!ELEMENT_CONTAINER_TYPES.has(String(element.type ?? ""))) return;
    const rect = blocks[index]?.getBoundingClientRect();
    if (rect === undefined) return;
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }
    hit = {
      index,
      originX: rect.left - canvasRect.left + canvas.scrollLeft,
      originY: rect.top - canvasRect.top + canvas.scrollTop,
    };
  });

  const plan = planElementDrop(localX, localY, hit);
  const draft = createElementDraft(String(id), plan.x, plan.y);
  if (draft === null) return; // 未知类型 fail-closed（不静默造坏节点）
  api.insertElement(
    scene.pointer,
    draft,
    plan.parentIndex === null ? undefined : elementPointer(plan.parentIndex),
  );
}
</script>

<template>
  <div class="stage-editor">
    <h2>舞台编辑</h2>

    <!-- 空态**必须有可点的下一步**（空实现占满画布而可点动作数为 0
         ⇒ 大片空白 + 无出路，用户只能猜） -->
    <EmptyState
      v-if="sceneColumn === undefined"
      class="stage-empty"
      reason="no-scene-column"
      @action="onEmptyAction"
    />

    <template v-else>
      <div
        ref="canvasEl"
        class="canvas"
        :class="{ 'drop-active': dropActive }"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <div
          v-for="(element, index) in elements"
          :key="index"
          :data-idx="index"
          class="element"
          :class="{ selected: index === selectedIndex }"
          :style="blockStyle(element, index)"
          @pointerdown.prevent="onPointerDown(index, $event)"
        >
          <span class="tag">{{ elementLabel(String(element.type ?? "")) }}</span>
          <span v-if="element.id" class="id">#{{ element.id }}</span>
        </div>
        <!-- 对齐参考线（步4）：拖拽中显示，pointer-events:none 不吃点击 -->
        <div v-if="guides.vx !== null" class="guide guide-v" :style="{ left: `${guides.vx}px` }"></div>
        <div v-if="guides.hy !== null" class="guide guide-h" :style="{ top: `${guides.hy}px` }"></div>
        <EmptyState
          v-if="elements.length === 0"
          class="stage-empty"
          reason="no-elements"
        />
      </div>

      <div v-if="descriptor !== undefined" class="props">
        <h3>{{ descriptor.label }} · 第 {{ selectedIndex }} 个</h3>
        <FieldRow
          v-for="field in fields"
          :key="field.key"
          :field="field"
          :pointer="`${elementPointer(selectedIndex)}/${field.key}`"
          :value="selectedElement?.[field.key]"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.stage-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.canvas {
  position: relative;
  flex: 1;
  min-height: 200px;
  overflow: auto;
  border: 1px solid var(--lf-border-default);
  border-radius: var(--lf-radius-md);
  /* 步4：点阵网格 —— 给"空间"一个参照，否则元素定位纯靠手拖、没有尺度感。
     用 radial-gradient 画点（不引依赖）；透明度压到 0.07 以免抢元素注意力。 */
  background-color: var(--lf-info-surface);
  background-image: radial-gradient(
    circle at 1px 1px,
    color-mix(in srgb, var(--lf-text-hint) 22%, transparent) 1px,
    transparent 0
  );
  background-size: 16px 16px;
}
/* 拖拽时的对齐参考线（吸附辅助） */
.guide {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  background: var(--lf-accent);
  opacity: 0.75;
}
.guide-v {
  top: 0;
  bottom: 0;
  width: 1px;
}
.guide-h {
  left: 0;
  right: 0;
  height: 1px;
}
/* 拖拽悬停时的落点提示 */
.canvas.drop-active {
  border-color: var(--lf-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--lf-accent) 40%, transparent);
}
.element {
  position: absolute;
  display: flex;
  gap: 6px;
  align-items: center;
  box-sizing: border-box;
  padding: 4px 8px;
  overflow: hidden;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-muted);
  cursor: grab;
  user-select: none;
  background: var(--lf-border-subtle);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
}
.element.selected {
  border-color: var(--lf-accent);
  box-shadow: 0 0 0 1px var(--lf-accent);
}
/* 资源缩略作背景时的可读性底衬（无缩略时观感不变） */
.element .tag,
.element .id {
  background: color-mix(in srgb, var(--lf-surface-overlay) 85%, transparent);
  border-radius: var(--lf-radius-sm);
  padding: 1px 4px;
}
.element .tag {
  color: var(--lf-text-primary);
}
.element .id {
  color: var(--lf-text-hint);
}
.props {
  max-height: 42%;
  padding-top: 6px;
  overflow: auto;
  border-top: 1px solid var(--lf-border-default);
}
.hint {
  padding: 8px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-hint);
}
</style>
