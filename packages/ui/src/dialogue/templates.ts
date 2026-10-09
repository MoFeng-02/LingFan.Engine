/**
 * 对话框模板（挂载点模板的一例：语义骨架三挂点 + rootClass 皮肤）。
 *
 * 模板 = 对话框「语义骨架各挂点」的注册渲染函数（纯 TS 可测；作者纯 TS 创作与
 * 未来编辑器可视化创作产出同构描述，装配到同一注册表）。
 * 模板名由核心层解析三级优先级后写入 `__dialog_template`（say template >
 * character screen > 全局默认），本表按名解析、未知名/null 回退默认。
 * 性能红线：打字帧每帧重算——speaker/hint 输入不变时输出
 * 为纯字符串派生（宿主 Vue diff 后不 patch）；NVL 累积层按增量渲染约定保持宿主
 * 固定骨架，不走模板全量重渲。统一渲染接缝（renderDialogueLine）即行渲染原语。
 *
 * 注册语义（注册 / 解析 / 默认回退）由通用 [`TemplateRegistry`] 承载——
 * 本模块只定义对话挂载点的输入输出形状与内置模板。
 */
import { TemplateRegistry, createTemplateRegistry } from "../templates/registry";
import { renderDialogueLine } from "./textView";

/** 模板输入：对话渲染状态投影（宿主从引擎状态/渲染态映射） */
export interface DialogueTemplateInput {
  /** 插值后说话人（空 = 无说话人行） */
  speaker: string;
  /** 角色色（空 = 默认；内置模板经宿主 style 应用，自定义模板可自定消费） */
  speakerColor: string;
  /** 统一接缝产物：renderDialogueLine({ text, typed }).html（含打字前缀） */
  lineHtml: string;
  /** 对话等待推进指示（▼） */
  canAdvance: boolean;
}

/** 模板输出：语义骨架各挂点内容（宿主骨架固定：speaker 行 / 正文 / 推进指示器） */
export interface DialogueTemplateView {
  /** 对话框根皮肤类（宿主布局类叠加） */
  rootClass: string;
  /** 说话人行 HTML（空串 = 隐藏该行）；经统一接缝转义 */
  speakerHtml: string;
  /** 正文 HTML（打字帧每帧变化） */
  bodyHtml: string;
  /** 推进指示器 HTML（空串 = 隐藏） */
  hintHtml: string;
}

/** 对话层模板：吃投影出的对话状态，吐骨架三挂点内容。纯函数——打字帧每帧调用，不得有副作用 */
export type DialogueTemplateFn = (
  input: DialogueTemplateInput,
) => DialogueTemplateView;

/** 对话挂载点的模板注册表（通用注册表的具体化） */
export type DialogueTemplateRegistry = TemplateRegistry<
  DialogueTemplateInput,
  DialogueTemplateView
>;

/** 造一张空的对话层模板注册表；宿主在装配期向它 `register` 模板（本函数不装内建默认） */
export function createDialogueTemplateRegistry(): DialogueTemplateRegistry {
  return createTemplateRegistry<DialogueTemplateInput, DialogueTemplateView>();
}

/** 内置 bubble 模板：参考视觉（speaker 行 + 统一接缝正文 + ▼ 推进） */
export const builtinBubbleTemplate: DialogueTemplateFn = (input) => ({
  rootClass: "tpl-bubble",
  speakerHtml:
    input.speaker === ""
      ? ""
      : renderDialogueLine({ text: input.speaker }).html,
  bodyHtml: input.lineHtml,
  hintHtml: input.canAdvance ? "▼" : "",
});
