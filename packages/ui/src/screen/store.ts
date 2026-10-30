/**
 * 屏幕订阅盒：把「此刻这一屏该长什么样」做成一个可订阅的只读值。
 *
 * 为什么不让每个形态自己去 `engine.onStateChanged` 里判键：判键与折膜会各写三份，
 * 退订时机也各不同（Vue 的 `onUnmounted`、React 的清理函数、原生的 `dispose`）。
 * 这里只做两件事——**存当前值**与**变化时才广播**，形态按自己的方式订阅即可。
 *
 * 与 `createMountStore` 同构：值由接线方推（`set`），本文件不读引擎、不筛键。
 * 折膜（列与存档 → 渲染输入）发生在宿主侧，那里才拿得到工程清单与存档摘要。
 */
import { sameScreenView, type ScreenView } from "./view.ts";

/** 订阅盒：读快照、推新值、订阅变化 */
export interface ScreenStore {
  /**
   * 当前这一屏。
   *
   * 首帧之前是 `undefined`：接线方在装配期就会推第一份值，界面拿不到值时不画，
   * 比拿一份猜出来的空壳去画要诚实。
   */
  snapshot(): ScreenView | undefined;
  /** 推一份新值；与当前等价时不广播 */
  set(view: ScreenView): void;
  /** 订阅变化；返回值是退订函数（可重复调用） */
  subscribe(listener: (view: ScreenView) => void): () => void;
}

/**
 * 造一个屏幕订阅盒。
 *
 * @returns 订阅盒（见 {@link ScreenStore}）。
 */
export function createScreenStore(): ScreenStore {
  let current: ScreenView | undefined = undefined;
  const listeners = new Set<(view: ScreenView) => void>();

  return {
    snapshot: () => current,
    set: (view) => {
      // 同值不广播：切屏会重挂组件，抖动代价远高于一次多余的比较
      if (current !== undefined && sameScreenView(current, view)) return;
      current = view;
      for (const listener of [...listeners]) listener(view);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
