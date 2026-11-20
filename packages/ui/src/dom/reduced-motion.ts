/**
 * 系统「减弱动效」偏好的测量与订阅：读 `prefers-reduced-motion` 媒体查询，把
 * 「系统现在要不要减弱动效」这一个平台事实交给宿主。有效减弱态的合成（玩家显式 >
 * 系统 > 内建关）是引擎层纯函数 `resolveReducedMotion` 的事，本模块不碰玩家偏好，
 * 只测系统层——故落 DOM 物化域，核心保持零 DOM。
 *
 * 兼容旧 WebView（Safari 13.1 基线）：`MediaQueryList.addEventListener` 到 Safari 14
 * 才有，这里特征探测——有 `addEventListener` 用之，否则回退老式 `addListener`；
 * 拆除同理。`matchMedia` 本身 13.1 已支持。
 */

/** 系统减弱动效查询的读面：现读、订阅、收尾三件。 */
export interface ReducedMotionQuery {
  /** 系统当前是否要求减弱动效（每次现读，跟随系统设置即时变化）。 */
  matches(): boolean;
  /** 订阅系统设置变化；返回退订函数。 */
  onChange(listener: () => void): () => void;
  /** 拆除媒体监听并清空订阅（宿主收尾调用，禁泄漏）。 */
  dispose(): void;
}

/**
 * 造系统减弱动效查询。默认读窗口的 `prefers-reduced-motion` 媒体查询；测试可注入
 * `MediaQueryList` 替身，无需真实窗口。订阅清理走 `dispose`，由装配它的宿主收尾调用。
 */
export function createReducedMotionQuery(
  media: MediaQueryList = window.matchMedia("(prefers-reduced-motion: reduce)"),
): ReducedMotionQuery {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  // 特征探测：旧 WebView 无 addEventListener，回退 addListener（Safari 13.1）。
  const useModern = typeof media.addEventListener === "function";
  if (useModern) media.addEventListener("change", notify);
  else media.addListener(notify);
  return {
    matches: () => media.matches,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (useModern) media.removeEventListener("change", notify);
      else media.removeListener(notify);
      listeners.clear();
    },
  };
}
