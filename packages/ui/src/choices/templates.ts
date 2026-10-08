/**
 * 选择层模板（挂载点模板的一例：提示行 + 选项列表 + rootClass 皮肤）。
 *
 * 骨架挂点（宿主渲染固定结构，模板只填内容）：
 * - 提示行（`promptHtml`；空串 = 隐藏该行）
 * - 选项列表（`options`：每项文本与可选禁用态；**点击与目标解析归宿主**，
 *   模板不参与交互语义——那是核心层的 `choose(target)`）
 *
 * 与 Ren'Py `choice` screen 的差别：它的 `items` 里带 `action` 对象（可执行副作用），
 * 我们只给「渲染所需的数据」，动作仍由宿主 `choose(target)` 走核心语义——
 * 模板无法绕过引擎改变叙事流向，破坏面因此被限制在展示层。
 *
 * 未知名 / null 回退默认（模板只影响展示，缺失应兜底——与元素/小游戏注册表的
 * fail-closed 口径不同）。
 */
import { TemplateRegistry, createTemplateRegistry } from "../templates/registry";
import { renderDialogueLine } from "../dialogue/textView";

/** 单个选项的渲染投影（宿主从 `SYS.menuOptions` 映射） */
export interface ChoiceTemplateOption {
  /** 选项文本（原文；经统一接缝渲染） */
  text: string;
  /** 选项目标列 id（宿主点击时交核心 `choose(target)`；模板不得改写） */
  target: string;
}

/** 选择层模板输入：宿主投影的渲染状态 */
export interface ChoiceTemplateInput {
  /** 插值后的菜单提示（空 = 无提示行） */
  prompt: string;
  /** 选项列表（顺序即呈现顺序） */
  options: readonly ChoiceTemplateOption[];
  /** 当前所属场景（可选；模板可用于分场景换装） */
  scene?: string;
}

/** 选择层模板输出：语义骨架各挂点内容 */
export interface ChoiceTemplateView {
  /** 选择层根皮肤类（宿主布局类叠加） */
  rootClass: string;
  /** 提示行 HTML（空串 = 隐藏）；经统一接缝转义 */
  promptHtml: string;
  /** 选项行 HTML 列表（与 `options` 等长、同序——宿主按序挂点击） */
  optionHtml: readonly string[];
}

export type ChoiceTemplateFn = (input: ChoiceTemplateInput) => ChoiceTemplateView;

export type ChoiceTemplateRegistry = TemplateRegistry<
  ChoiceTemplateInput,
  ChoiceTemplateView
>;

export function createChoiceTemplateRegistry(): ChoiceTemplateRegistry {
  return createTemplateRegistry<ChoiceTemplateInput, ChoiceTemplateView>();
}

/** 内置默认模板：提示行 + 逐项转义文本（与既有参考实现等价） */
export const builtinChoiceTemplate: ChoiceTemplateFn = (input) => ({
  rootClass: "tpl-choice",
  promptHtml:
    input.prompt === ""
      ? ""
      : renderDialogueLine({ text: input.prompt }).html,
  optionHtml: input.options.map(
    (opt) => renderDialogueLine({ text: opt.text }).html,
  ),
});
