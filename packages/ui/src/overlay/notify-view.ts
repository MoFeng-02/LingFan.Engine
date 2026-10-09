/**
 * 通知层渲染：引擎的 `notify` 事件落成一条 toast，到时自动移除。
 *
 * 停留时长归本模块（模板只决定「长什么样」，不控制生命周期）；已排定的定时器
 * 逐实例登记，卸载时一并撤销，避免卸载后仍有回调去碰已清空的挂载点。
 */
import { builtinNotifyTemplate, toNotifyTone } from "../notify/templates";
import type { NotifyTemplateRegistry } from "../notify/templates";
import type { NarrativeMounts } from "./types";

/** 通知缺省停留时长（`notify` 的 `duration` 优先） */
export const NOTIFY_DURATION_MS = 3000;

/** 一条通知的渲染输入：正文必填，`notifyType` 决定配色语气，`duration` 覆盖缺省停留时长 */
export interface NotifyPayload {
  text: string;
  notifyType?: string;
  duration?: number;
}

/** 通知层视图：上屏一条通知、卸载时撤销在排定时器 */
export interface NotifyView {
  /** 上屏一条通知（按 `duration` 或缺省时长到时移除） */
  render(payload: NotifyPayload): void;
  /** 撤销全部在排定时器（卸载时调用） */
  clear(): void;
}

/** 通知视图的装配输入：通知条目挂到 `mounts.overlay`，`templates` 缺省时用内建模板 */
export interface NotifyViewDeps {
  container: HTMLElement;
  mounts: NarrativeMounts;
  templates?: NotifyTemplateRegistry;
}

/**
 * 造一个通知视图：同一条通知只上屏一次，到时（`duration` 或 `NOTIFY_DURATION_MS`）自行移除。
 *
 * 模板只决定长什么样，停留时长归本视图；定时器逐实例登记在闭包内，因此多个视图互不干扰。
 * 卸载时必须调用 `clear()`——否则已排定回调会在挂载点清空后继续触碰 DOM。
 */
export function createNotifyView(deps: NotifyViewDeps): NotifyView {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    render(payload: NotifyPayload): void {
      const built = (
        deps.templates?.resolve(null) ?? builtinNotifyTemplate
      )({ text: payload.text, tone: toNotifyTone(payload.notifyType) });
      const item = deps.container.ownerDocument.createElement("div");
      item.className = built.rootClass;
      item.innerHTML = built.bodyHtml;
      deps.mounts.overlay.appendChild(item);
      const timer = setTimeout(() => {
        timers.delete(timer);
        item.remove();
      }, payload.duration ?? NOTIFY_DURATION_MS);
      timers.add(timer);
    },
    clear(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
