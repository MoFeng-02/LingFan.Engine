<script setup lang="ts">
/**
 * 可拖拽分栏条：把「面板宽度」从写死 CSS 变成**可拖 + 可持久化**。
 *
 * 为何不用 CSS 原生 `resize`：`resize` 只能改**一个方向**、无法持久化、
 * 且各浏览器的把手样式不一致（要跨浏览器一致就得自己画）。
 *
 * 键盘可达（a11y）：`←/→` 每次 16px，`Home/End` 到边界 —— 拖拽不是唯一入口。
 * 拖拽中用 **pointer capture**（承接批 1 D-63 的教训：别让 move/up 挂在 window 上）。
 */
import { computed, ref } from "vue";

const props = defineProps<{
  /** 当前厚度（px） */
  size: number;
  min: number;
  max: number;
  /** 拖哪个方向：`left` = 改左侧面板宽度；`right` = 改右侧面板宽度 */
  side: "left" | "right";
  label: string;
}>();

const emit = defineEmits<{ (e: "resize", size: number): void }>();

const dragging = ref(false);

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(value)));
}

function fromPointer(clientX: number, host: HTMLElement): number {
  const rect = host.getBoundingClientRect();
  // 左侧面板：把手左边缘到容器左边 = 宽度；右侧面板反之（用右边缘算）
  return props.side === "left" ? clientX - rect.left : rect.right - clientX;
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  const host = handle.parentElement;
  if (host === null) return;
  dragging.value = true;
  handle.setPointerCapture(event.pointerId);
  event.preventDefault();

  const onMove = (e: PointerEvent): void => {
    emit("resize", clamp(fromPointer(e.clientX, host)));
  };
  const onUp = (): void => {
    dragging.value = false;
    // ⚠️ 元素可能已卸载（拖拽中面板被折叠/换工程）⇒ 释放前必须查引用，
    //    `releasePointerCapture` 拿不到会抛「Cannot read properties of null」。
    if (handle.isConnected && handle.hasPointerCapture?.(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  // move/up 挂 window：拖出把手范围也要跟手（capture 只保证事件不丢，仍需窗口级收尾）
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 48 : 16;
  const grow = props.side === "left" ? "ArrowRight" : "ArrowLeft";
  const shrink = props.side === "left" ? "ArrowLeft" : "ArrowRight";
  if (event.key === grow) {
    emit("resize", clamp(props.size + step));
    event.preventDefault();
  } else if (event.key === shrink) {
    emit("resize", clamp(props.size - step));
    event.preventDefault();
  } else if (event.key === "Home") {
    emit("resize", props.min);
    event.preventDefault();
  } else if (event.key === "End") {
    emit("resize", props.max);
    event.preventDefault();
  }
}

const cursor = computed(() => (props.side === "left" ? "ew-resize" : "ew-resize"));
</script>

<template>
  <div
    class="splitter"
    :class="{ dragging }"
    role="separator"
    :aria-label="label"
    :aria-valuenow="size"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    :style="{ cursor }"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
    @dblclick="emit('resize', side === 'left' ? 260 : 320)"
  ></div>
</template>

<style scoped>
.splitter {
  flex: 0 0 auto;
  width: 5px;
  background: transparent;
  border: none;
  padding: 0;
}
.splitter:hover,
.splitter:focus-visible {
  background: var(--lf-border-subtle);
  outline: none;
}
.splitter.dragging {
  background: var(--lf-text-hint);
}
</style>
