/**
 * 选择层渲染：菜单选项与输入等待两个形态共用一个挂载点。
 *
 * 两个形态互斥（`input` 等待渲染表单，`menu` 等待渲染选项列表），因此每次重渲
 * 都先清空并整体重建——层内不存在需要保留的局部状态。
 * 点击一律交核心：选项目标是**列 id**（不是显示文本），输入值经宿主提交路径送核心。
 */
import { builtinChoiceTemplate } from "../choices/templates";
import type { ChoiceTemplateRegistry } from "../choices/templates";
import { clickable } from "./dom";
import type { NarrativeMounts } from "./types";

/** 一次选择层重渲所需的渲染态（全部来自状态投影） */
export interface ChoicesRenderInput {
  waiting: string;
  menuPrompt: string;
  menuOptions: readonly { text: string; target: string }[];
  inputPrompt: string;
}

export interface ChoicesViewDeps {
  container: HTMLElement;
  mounts: NarrativeMounts;
  templates?: ChoiceTemplateRegistry;
  /** 选择选项（交核心 `choose(列 id)`） */
  choose: (target: string) => void;
  /** 提交输入（交核心 `input`） */
  submitInput: (value: string) => void;
}

export function createChoicesView(
  deps: ChoicesViewDeps,
): (input: ChoicesRenderInput) => void {
  return (input) => {
    const doc = deps.container.ownerDocument;
    const choices = deps.mounts.choices;
    const active = input.waiting === "menu" || input.waiting === "input";
    choices.style.display = active ? "" : "none";
    choices.innerHTML = "";
    if (!active) return;

    if (input.waiting === "input") {
      choices.className = "lf-choices";
      const label = doc.createElement("p");
      label.className = "lf-prompt";
      label.textContent = input.inputPrompt;
      const form = doc.createElement("form");
      form.className = "lf-input-row";
      const field = clickable(doc.createElement("input"));
      field.type = "text";
      field.setAttribute(
        "aria-label",
        input.inputPrompt === "" ? "输入" : input.inputPrompt,
      );
      const submit = clickable(doc.createElement("button"));
      submit.type = "submit";
      submit.textContent = "确定";
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        deps.submitInput(field.value.trim());
      });
      form.append(field, submit);
      choices.append(label, form);
      return;
    }

    const built = (deps.templates?.resolve(null) ?? builtinChoiceTemplate)({
      prompt: input.menuPrompt,
      options: input.menuOptions,
    });
    choices.className = `lf-choices ${built.rootClass}`;
    if (built.promptHtml !== "") {
      const p = doc.createElement("p");
      p.className = "lf-prompt";
      p.innerHTML = built.promptHtml;
      choices.appendChild(p);
    }
    const row = doc.createElement("div");
    row.className = "lf-choice-row";
    for (const [idx, option] of input.menuOptions.entries()) {
      const btn = clickable(doc.createElement("button"));
      btn.type = "button";
      btn.innerHTML = built.optionHtml[idx] ?? "";
      // innerHTML 内容不进无障碍名计算（等价于 v-html）：显式给可访问名
      btn.setAttribute("aria-label", option.text);
      // 点击交核心 choose(目标是列 id，不是显示文本)
      btn.addEventListener("click", () => deps.choose(option.target));
      row.appendChild(btn);
    }
    choices.appendChild(row);
  };
}
