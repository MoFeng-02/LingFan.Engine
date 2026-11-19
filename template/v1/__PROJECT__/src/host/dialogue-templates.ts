/**
 * 对话框模板装配：内置 bubble 默认 + 一个示例「居中」皮肤。
 *
 * 模板名由核心层解析三级优先级（命令 template > 角色 screen > 工程默认）写入
 * `__dialog_template`，对话视图按名解析、未知名回退默认。这里只注册「换皮不换交互」
 * 的模板：骨架三挂点（说话人 / 正文 / 推进指示）语义不变，推进/选项/输入仍由等待态驱动。
 * 作者可照此追加自己的模板（纯 TS 函数，吃对话投影吐挂点 HTML）。
 */
import {
  builtinBubbleTemplate,
  createDialogueTemplateRegistry,
  renderInlineMarkup,
  type DialogueTemplateFn,
  type DialogueTemplateRegistry,
} from "@lingfan-engine/ui";

/** 示例「居中」模板：与 bubble 同骨架，只换根皮肤类（演示模板切换的可见效果）。 */
const centerTemplate: DialogueTemplateFn = (input) => ({
  rootClass: "tpl-center",
  speakerHtml: input.speaker === "" ? "" : renderInlineMarkup(input.speaker),
  bodyHtml: input.lineHtml,
  hintHtml: input.canAdvance ? "▼" : "",
});

/** 造脚手架的对话模板注册表（bubble 为默认，center 为示例备选）。 */
export function createTemplateDialogueTemplates(): DialogueTemplateRegistry {
  const registry = createDialogueTemplateRegistry();
  registry.register("bubble", builtinBubbleTemplate, { makeDefault: true });
  registry.register("center", centerTemplate);
  return registry;
}
