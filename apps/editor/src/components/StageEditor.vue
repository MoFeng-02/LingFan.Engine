<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { Story } from "@lingfan/engine";
import {
  describeElement,
  draggedPosition,
  elementLabel,
  getAtPointer,
  type FieldDescriptor,
} from "@lingfan/editor";
import FieldRow from "./FieldRow.vue";

/**
 * 06 §一.1 舞台编辑（scene 列的空间布局视图）：
 * - **画布**：把目标 scene 列的 `elements[]` 按 `x/y/width/height/zindex/opacity` 摆成可拖拽方块。
 *   这是**占位表现**——真实外观归预览视图；本视图只负责布局编辑。
 * - **拖拽**：拖拽中仅本地预览（transform），**松手才写回一次** `x`/`y`，避免每帧污染 undo。
 *   字符串坐标（如 `"50%"`）保持原值不动（像素位移无法与百分比相加）。
 * - **属性**：选中元素 → 契约驱动的 `describeElement` 字段表（直接复用 `FieldRow`）。
 */
const props = defineProps<{ story: Story; pointer: string | null }>();

interface EditorApi {
  update(pointer: string, value: unknown): void;
  select(pointer: string | null): void;
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
</script>

<template>
  <div class="stage-editor">
    <h2>舞台编辑</h2>

    <p v-if="sceneColumn === undefined" class="hint">
      选中一个 <code>scene</code> 列后，可在此拖动它的元素定位（flow 列没有空间层）。
    </p>

    <template v-else>
      <div class="canvas">
        <div
          v-for="(element, index) in elements"
          :key="index"
          class="element"
          :class="{ selected: index === selectedIndex }"
          :style="{
            left: cssPos(element.x, 24 + index * 16),
            top: cssPos(element.y, 24 + index * 16),
            width: cssSize(element.width, 120),
            height: cssSize(element.height, 44),
            opacity:
              typeof element.opacity === 'number' ? element.opacity : 1,
            zIndex: typeof element.zindex === 'number' ? element.zindex : index,
            ...previewStyle(index),
          }"
          @pointerdown.prevent="onPointerDown(index, $event)"
        >
          <span class="tag">{{ elementLabel(String(element.type ?? "")) }}</span>
          <span v-if="element.id" class="id">#{{ element.id }}</span>
        </div>
        <p v-if="elements.length === 0" class="hint">
          该 scene 列还没有元素——可在 JSON 视图或文本视图添加。
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
