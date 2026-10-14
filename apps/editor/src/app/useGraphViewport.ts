/**
 * 节点图视口交互：节点拖拽、背景平移、缩放与布局记忆。
 *
 * 节点位置与缩放按故事记忆入 localStorage（键 `lingfan-editor-nodepos:{storyId}`），
 * 缩放不入故事 JSON——编辑器只读写故事树。缓存损坏 = 忽略退回自动布局；
 * 存储不可用（隐私模式）= 布局仅本次会话有效。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/** 缩放范围（Ctrl+滚轮与按钮共用同一夹取区间） */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;

export function useGraphViewport(
  storyId: () => string,
  scrollEl: Ref<HTMLDivElement | null>,
  svgRoot: Ref<SVGSVGElement | null>,
): {
  positions: Ref<Map<string, { x: number; y: number }>>;
  zoom: Ref<number>;
  panState: Ref<{ x: number; y: number; sl: number; st: number } | null>;
  toLogical: (clientX: number, clientY: number) => { x: number; y: number };
  startDrag: (node: { id: string; x: number; y: number }, event: PointerEvent) => void;
  startPan: (event: PointerEvent) => void;
  onWheel: (event: WheelEvent) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
} {
  const positions = ref<Map<string, { x: number; y: number }>>(new Map());
  const zoom = ref(1);
  const panState = ref<{ x: number; y: number; sl: number; st: number } | null>(
    null,
  );
  const dragging = ref<{ id: string; dx: number; dy: number } | null>(null);

  const storageKey = computed(() => `lingfan-editor-nodepos:${storyId()}`);

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

  /** 屏幕坐标 → 画布逻辑坐标（含缩放换算） */
  function toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRoot.value?.getBoundingClientRect();
    const z = zoom.value;
    if (rect === undefined) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z };
  }

  function startDrag(
    node: { id: string; x: number; y: number },
    event: PointerEvent,
  ): void {
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

  return {
    positions,
    zoom,
    panState,
    toLogical,
    startDrag,
    startPan,
    onWheel,
    zoomIn,
    zoomOut,
    zoomReset,
  };
}
