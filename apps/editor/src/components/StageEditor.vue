<script setup lang="ts">
import { computed, inject, ref, type CSSProperties } from "vue";
import { ELEMENT_CONTAINER_TYPES, type ResourcePort, type Story } from "@lingfan/engine";
import {
  createElementDraft,
  describeElement,
  draggedPosition,
  elementLabel,
  getAtPointer,
  planElementDrop,
  type FieldDescriptor,
} from "@lingfan/editor";
import { elementSource } from "@lingfan/ui";
import FieldRow from "./FieldRow.vue";

/**
 * 06 §一.1 舞台编辑（scene 列的空间布局视图）：
 * - **画布**：把目标 scene 列的 `elements[]` 按 `x/y/width/height/zindex/opacity` 摆成可拖拽方块。
 *   编辑仍以布局为主（占位方块 + 尺寸/层级）。
 * - **资源缩略（P2 编辑器工程模型）**：打开工程后，带 `source/src/path` 的元素把已解析
 *   资源铺成方块背景（`@lingfan/ui` 的 `elementSource` 取路径，与渲染器同源判定）；
 *   未打开工程 = 无资源根 → 保持占位方块。
 * - **拖拽**：拖拽中仅本地预览（transform），**松手才写回一次** `x`/`y`，避免每帧污染 undo。
 *   字符串坐标（如 `"50%"`）保持原值不动（像素位移无法与百分比相加）。
 * - **落点创建（T04-03）**：从组件面板拖元素到画布 → 落点即 `x`/`y`，**一次拖入 = 一个 undo
 *   单元**（提交在 `editorApi.insertElement`）；落点在某容器块内 → 进其 `children`
 *   （坐标换算为相对容器原点，与运行期渲染一致）。类型/载荷 fail-closed：非元素类、
 *   未知类型一律忽略（锚点: editor-drag-create-element）。
 * - **属性**：选中元素 → 契约驱动的 `describeElement` 字段表（直接复用 `FieldRow`）。
 */
const props = defineProps<{
  story: Story;
  pointer: string | null;
  /** 已打开工程的资源供给端口（缺省 = 未打开工程：不解析缩略） */
  resourcePort?: ResourcePort;
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

interface EditorApi {
  update(pointer: string, value: unknown): void;
  select(pointer: string | null): void;
  /** T04-03：组件拖入的落点创建（一次拖入 = 一个 undo 单元，提交在宿主会话中枢） */
  insertElement(
    columnPointer: string,
    element: Record<string, unknown>,
    parentPointer?: string,
  ): void;
}
const api = inject<EditorApi>("editorApi")!;

/** 指针所在的 scene 列（舞台只编辑 scene 列；flow 列无空间层） */
const sceneColumn = computed(() => {
  const pointer = props.pointer;
  if (pointer === null) return undefined;
  const parts = pointer.split("/");
  if (parts[1] !== "columns" || parts[2] === undefined) return undefined;
  const colPointer = `/columns/${parts[2]}`;
  const column = getAtPointer(props.story, colPointer) as
    | { id?: string; kind?: string; elements?: unknown[] }
    | undefined;
  if (column === undefined || column.kind !== "scene") return undefined;
  return { pointer: colPointer, column };
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

function onPointerDown(index: number, event: PointerEvent): void {
  const element = elements.value[index];
  if (element === undefined) return;
  const target = elementPointer(index);
  api.select(target);
  const startX = event.clientX;
  const startY = event.clientY;
  drag.value = { index, dx: 0, dy: 0 };

  const onMove = (moveEvent: PointerEvent): void => {
    drag.value = {
      index,
      dx: moveEvent.clientX - startX,
      dy: moveEvent.clientY - startY,
    };
  };
  const onUp = (upEvent: PointerEvent): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const dx = upEvent.clientX - startX;
    const dy = upEvent.clientY - startY;
    drag.value = null;
    if (dx === 0 && dy === 0) return; // 单击 = 仅选中
    const nextX = draggedPosition(element.x, dx);
    const nextY = draggedPosition(element.y, dy);
    if (nextX !== null) api.update(`${target}/x`, nextX);
    if (nextY !== null) api.update(`${target}/y`, nextY);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
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
 * T04-03 落点创建：DOM/事件留在组件，**判定与数值走 `@lingfan/editor` 纯函数**。
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

    <p v-if="sceneColumn === undefined" class="hint">
      选中一个 <code>scene</code> 列后，可在此拖动它的元素定位（flow 列没有空间层）。
    </p>

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
          class="element"
          :class="{ selected: index === selectedIndex }"
          :style="blockStyle(element, index)"
          @pointerdown.prevent="onPointerDown(index, $event)"
        >
          <span class="tag">{{ elementLabel(String(element.type ?? "")) }}</span>
          <span v-if="element.id" class="id">#{{ element.id }}</span>
        </div>
        <p v-if="elements.length === 0" class="hint">
          该 scene 列还没有元素——从左侧「组件」面板拖入，或在 JSON / 文本视图添加。
        </p>
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
  background: #16161f;
  border: 1px solid #2a2a3a;
  border-radius: 8px;
}
/* T04-03：拖拽悬停时的落点提示 */
.canvas.drop-active {
  border-color: #7aa2f7;
  box-shadow: 0 0 0 1px #7aa2f766;
}
.element {
  position: absolute;
  display: flex;
  gap: 6px;
  align-items: center;
  box-sizing: border-box;
  padding: 4px 8px;
  overflow: hidden;
  font-size: 11px;
  color: #a9b1d6;
  cursor: grab;
  user-select: none;
  background: #24283b;
  border: 1px solid #3b4261;
  border-radius: 6px;
}
.element.selected {
  border-color: #7aa2f7;
  box-shadow: 0 0 0 1px #7aa2f7;
}
/* 资源缩略作背景时的可读性底衬（无缩略时观感不变） */
.element .tag,
.element .id {
  background: #16161ed9;
  border-radius: 4px;
  padding: 1px 4px;
}
.element .tag {
  color: #e6e6f0;
}
.element .id {
  color: #565f89;
}
.props {
  max-height: 42%;
  padding-top: 6px;
  overflow: auto;
  border-top: 1px solid #2a2a3a;
}
.hint {
  padding: 8px;
  font-size: 12px;
  color: #565f89;
}
</style>
