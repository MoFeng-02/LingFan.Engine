/**
 * 通知层模板（挂载点模板的一例：单条 toast 的内容 + rootClass 皮肤）。
 *
 * 与 Ren'Py `notify` screen 的差别：它的 screen 里可挂任意控件（甚至写 `timer` 控制消失），
 * 我们只给「渲染一条通知所需的数据」，**消失时机归宿主**（`duration`）——
 * 模板不得控制生命周期，否则回溯/并发通知的语义会漂移。
 *
 * 未知名 / null 回退默认（模板只影响展示）。
 */
import { TemplateRegistry, createTemplateRegistry } from "../templates/registry";
import { renderDialogueLine } from "../dialogue/textView";

/** 通知层级（作者可选；模板据以换装/加图标） */
export type NotifyTone = "info" | "warning" | "error";

/** 通知模板输入：单条通知的渲染投影 */
export interface NotifyTemplateInput {
  /** 通知文本（原文；经统一接缝渲染） */
  text: string;
  /** 通知类型（`notify` op 的 `type`；未声明 = info） */
  tone: NotifyTone;
}

/** 通知模板输出：语义骨架挂点内容 */
export interface NotifyTemplateView {
  /** 通知项根皮肤类 */
  rootClass: string;
  /** 通知正文 HTML（经统一接缝转义） */
  bodyHtml: string;
}

/** 通知层模板：吃投影出的单条通知，吐骨架挂点内容。纯函数——不控消失时机、不挂定时器 */
export type NotifyTemplateFn = (input: NotifyTemplateInput) => NotifyTemplateView;

/** 通知层模板注册表：按名存 `NotifyTemplateFn`，按名解析，未知名回退默认 */
export type NotifyTemplateRegistry = TemplateRegistry<
  NotifyTemplateInput,
  NotifyTemplateView
>;

/** 造一张空的通知层模板注册表；宿主在装配期向它 `register` 模板（本函数不装内建默认） */
export function createNotifyTemplateRegistry(): NotifyTemplateRegistry {
  return createTemplateRegistry<NotifyTemplateInput, NotifyTemplateView>();
}

/** 通知类型归一（未知/缺省 → info；不静默丢信息） */
export function toNotifyTone(raw: unknown): NotifyTone {
  return raw === "warning" || raw === "error" ? raw : "info";
}

/** 内置默认模板：正文转义 + 按类型加皮肤类 */
export const builtinNotifyTemplate: NotifyTemplateFn = (input) => ({
  rootClass: `tpl-notify tpl-notify-${input.tone}`,
  bodyHtml: renderDialogueLine({ text: input.text }).html,
});
