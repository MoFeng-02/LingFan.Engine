/**
 * 选择层视图模型：菜单选项与输入等待两个形态共用一个提交点，**不碰任何节点**。
 *
 * 两个形态互斥（`input` 等待渲染输入表单，`menu` 等待渲染选项列表），因此给出的是
 * `ChoicesLayerView | null`：`null` 表示整层隐藏。点击一律交核心：选项目标是**列 id**
 * （不是显示文本），输入值经宿主提交路径送核心。
 */
import { builtinChoiceTemplate } from "../choices/templates";
import type { ChoiceTemplateRegistry } from "../choices/templates";
import type { ChoicesLayerView } from "./surface";

/** 一次选择层重渲所需的渲染态（全部来自状态投影） */
export interface ChoicesRenderInput {
  waiting: string;
  menuPrompt: string;
  menuOptions: readonly { text: string; target: string }[];
  inputPrompt: string;
  /** 输入候选（缺省空数组 = 只有输入框） */
  inputCandidates?: readonly { text: string; value: string }[];
}

/** 选择层文案（宿主可覆盖；缺省实现即内建文案） */
export interface ChoicesTexts {
  /** 输入提交按钮的显示文本 */
  inputSubmit: string;
}

/**
 * 选择层的装配输入。`choose` / `submitInput` 不在模型里——它们是端口上的两条出口
 * （见 `OverlaySurface.onChoose` / `onSubmitInput`），视图模型不认识引擎。
 */
export interface ChoicesViewDeps {
  /** 模板注册表（不传 = 内建模板） */
  templates?: ChoiceTemplateRegistry;
  /** 文案覆盖（不传 = 内建缺省） */
  texts?: Partial<ChoicesTexts>;
}

/** 内建文案：不传 texts 时的缺省值 */
const DEFAULT_CHOICES_TEXTS: ChoicesTexts = { inputSubmit: "确定" };

/**
 * 算出一层选择模型：等待态不是 `menu` / `input` 时返回 `null`（整层隐藏）。
 *
 * 输入形态不带皮肤类名（原文如此：`lf-choices` 基类由渲染侧拼，模板只服务菜单形态）；
 * 菜单形态连同每个选项的三个字段一起给出——`html` 是呈现片段，`label` 是可访问名，
 * 因此「innerHTML 不进无障碍名计算」这条口径在宿主侧照样能落实。
 */
export function choicesLayerView(
  input: ChoicesRenderInput,
  deps: ChoicesViewDeps = {},
): ChoicesLayerView | null {
  if (input.waiting === "input") {
    const texts: ChoicesTexts = { ...DEFAULT_CHOICES_TEXTS, ...deps.texts };
    // 候选与输入框并存：玩家可以点候选，也可以自己打字（两者走同一个提交出口）
    const candidates = (input.inputCandidates ?? []).map((item) => ({
      label: item.text,
      value: item.value,
    }));
    return {
      rootClass: "",
      promptHtml: "",
      options: [],
      input: {
        prompt: input.inputPrompt,
        submitText: texts.inputSubmit,
        candidates,
      },
    };
  }
  if (input.waiting !== "menu") return null;

  const built = (deps.templates?.resolve(null) ?? builtinChoiceTemplate)({
    prompt: input.menuPrompt,
    options: input.menuOptions,
  });
  return {
    rootClass: built.rootClass,
    promptHtml: built.promptHtml,
    options: input.menuOptions.map((option, index) => ({
      html: built.optionHtml[index] ?? "",
      label: option.text,
      target: option.target,
    })),
    input: null,
  };
}
