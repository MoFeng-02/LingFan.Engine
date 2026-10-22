/**
 * 节点图视口：节点拖拽、背景平移、缩放与布局记忆。
 *
 * 节点位置与缩放按故事记忆存本机（键 `lingfan-editor-nodepos:{storyId}`），
 * 缩放不入故事 JSON——编辑器只读写故事树。缓存损坏 = 忽略退回自动布局；
 * 存储不可用（隐私模式）= 布局仅本次会话有效。
 *
 * 本模块不接触 `window` / DOM：元素量测与滚动读写由 `GraphViewportHost` 注入
 * （视图层提供），指针与滚轮事件的监听由视图层按既有范式挂在 `window` / 容器上，
 * 本模块只暴露 `startDrag` / `onDragMove` / `endDrag` 等纯状态推进函数。
 */
import { computed, nextTick, onMounted, ref, type Ref } from "vue";
import type { KeyValueStorage } from "@lingfan-engine/editor";

/** 缩放范围（Ctrl+滚轮与按钮共用同一夹取区间） */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;

/** 视口几何：由视图层实现——元素量测与滚动读写在 UI 层，换算在本模块 */
export interface GraphViewportHost {
  /** 画布根矩形相对视口的左上偏移；未挂载 = `undefined` */
  canvasOrigin(): { left: number; top: number } | undefined;
  /** 容器滚动位与可见尺寸；未挂载 = `undefined` */
  scroll():
    { left: number; top: number; width: number; height: number } | undefined;
  /** 写容器滚动位（越界由浏览器夹取） */
  scrollTo(left: number, top: number): void;
}

export function useGraphViewport(
  storyId: () => string,
  host: GraphViewportHost,
  storage: () => KeyValueStorage | undefined,
): {
  positions: Ref<Map<string, { x: number; y: number }>>;
  zoom: Ref<number>;
  panState: Ref<{ x: number; y: number; sl: number; st: number } | null>;
  toLogical: (clientX: number, clientY: number) => { x: number; y: number };
  startDrag: (
    node: { id: string; x: number; y: number },
    event: PointerEvent,
  ) => void;
  onDragMove: (event: PointerEvent) => void;
  endDrag: () => void;
  startPan: (event: PointerEvent) => void;
  onPanMove: (event: PointerEvent) => void;
  endPan: () => void;
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
      const raw = storage()?.getItem(storageKey.value) ?? null;
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
  });

  function persist(): void {
    try {
      const data: Record<string, unknown> = { zoom: zoom.value, nodes: {} };
      for (const [id, pos] of positions.value) {
        (data.nodes as Record<string, { x: number; y: number }>)[id] = pos;
      }
      storage()?.setItem(storageKey.value, JSON.stringify(data));
    } catch {
      /* 存储不可用（隐私模式）= 布局仅本次会话有效 */
    }
  }

  /** 屏幕坐标 → 画布逻辑坐标（含缩放换算；画布未挂载时返回原点） */
  function toLogical(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const origin = host.canvasOrigin();
    const z = zoom.value;
    if (origin === undefined) return { x: 0, y: 0 };
    return { x: (clientX - origin.left) / z, y: (clientY - origin.top) / z };
  }

  /** 开始拖拽节点：只记锚点；`pointermove` / `pointerup` 由视图层监听后回推 */
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

  /** 结束拖拽：清锚点并落盘（失败静默 = 布局仅本次会话有效） */
  function endDrag(): void {
    dragging.value = null;
    persist();
  }

  /** 背景拖拽 = 平移视口（调整容器滚动位；节点 pointerdown 已 stop 冒泡） */
  function startPan(event: PointerEvent): void {
    const view = host.scroll();
    if (view === undefined) return;
    panState.value = {
      x: event.clientX,
      y: event.clientY,
      sl: view.left,
      st: view.top,
    };
  }

  function onPanMove(event: PointerEvent): void {
    const pan = panState.value;
    if (pan === null) return;
    host.scrollTo(
      pan.sl - (event.clientX - pan.x),
      pan.st - (event.clientY - pan.y),
    );
  }

  function endPan(): void {
    panState.value = null;
  }

  /** Ctrl+滚轮缩放（视口中心稳定）；普通滚轮 = 原生滚动 */
  function onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const view = host.scroll();
    if (view === undefined) return;
    setZoom(
      zoom.value * (event.deltaY < 0 ? 1.1 : 0.9),
      view.left + view.width / 2,
      view.top + view.height / 2,
    );
  }

  function setZoom(next: number, anchorX: number, anchorY: number): void {
    const view = host.scroll();
    if (view === undefined) return;
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (clamped === zoom.value) return;
    const ratio = clamped / zoom.value;
    zoom.value = clamped;
    void nextTick(() => {
      const sized = host.scroll();
      if (sized === undefined) return;
      host.scrollTo(
        anchorX * ratio - sized.width / 2,
        anchorY * ratio - sized.height / 2,
      );
      persist();
    });
  }

  /** 以视口中心为锚点缩放（按钮入口） */
  function setZoomCentered(factor: number): void {
    const view = host.scroll();
    if (view === undefined) return;
    setZoom(
      zoom.value * factor,
      view.left + view.width / 2,
      view.top + view.height / 2,
    );
  }

  function zoomIn(): void {
    setZoomCentered(1.2);
  }

  function zoomOut(): void {
    setZoomCentered(1 / 1.2);
  }

  function zoomReset(): void {
    setZoomCentered(1);
  }

  return {
    positions,
    zoom,
    panState,
    toLogical,
    startDrag,
    onDragMove,
    endDrag,
    startPan,
    onPanMove,
    endPan,
    onWheel,
    zoomIn,
    zoomOut,
    zoomReset,
  };
}
