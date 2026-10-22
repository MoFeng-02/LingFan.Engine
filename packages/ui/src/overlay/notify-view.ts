/**
 * 通知层视图模型：把引擎的 `notify` 事件算成一条 toast 的模型（**不碰节点、不管生命周期**）。
 *
 * 停留时长归端口调用的参数（`OverlaySurface.pushNotification(item, durationMs)`）——
 * 本模块只决定「长什么样」：模板给出语气类名与正文片段。
 */
import { builtinNotifyTemplate, toNotifyTone } from "../notify/templates";
import type { NotifyTemplateRegistry } from "../notify/templates";
import type { NotifyPayload } from "@lingfan-engine/core";
import type { NotifyLayerItem } from "./surface";

/** 通知层的装配输入：模板注册表可选 */
export interface NotifyViewDeps {
  templates?: NotifyTemplateRegistry;
}

/**
 * 算出一条通知模型：正文交给模板上色，本函数只把模板产物搬成模型。
 *
 * 与旧版不同的是：这里不再持有定时器——到时移除由宿主的渲染体系负责，
 * 因此 `clear()`（撤销在排定时器）也一并移到端口（`OverlaySurface.clear()`）。
 */
export function notifyLayerItem(
  payload: NotifyPayload,
  deps: NotifyViewDeps = {},
): NotifyLayerItem {
  const built = (deps.templates?.resolve(null) ?? builtinNotifyTemplate)({
    text: payload.text,
    tone: toNotifyTone(payload.notifyType),
  });
  return { rootClass: built.rootClass, bodyHtml: built.bodyHtml };
}
