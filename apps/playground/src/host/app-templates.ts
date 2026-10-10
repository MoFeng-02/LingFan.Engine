/**
 * 模板注册制与视图投影的宿主侧装配：对话框、选择层、通知层三张注册表在此装配
 * （作者扩展入口；编辑器可视化创作未来产出同构描述装配到同一注册表），并把注册
 * 产出与叙事状态合成为模板直接消费的视图。
 *
 * 骨架由面板固定渲染（提示行 / 选项列表 / 通知正文），模板只填各挂点内容：未知
 * 模板名回退默认（展示层缺失应兜底，与元素/小游戏注册表的 fail-closed 口径不同）。
 * NVL 累积层保持固定骨架（增量渲染约定）：已打完的行 memo 一次（O(新增)——静态行
 * 若随打字帧全量重渲染即 O(全文) 每帧），最新一行走打字机（统一渲染接缝）。
 */

import { computed, nextTick, ref, watch, type ComputedRef } from "vue";
import {
  builtinBubbleTemplate,
  builtinChoiceTemplate,
  builtinNotifyTemplate,
  createChoiceTemplateRegistry,
  createDialogueTemplateRegistry,
  createNotifyTemplateRegistry,
  renderDialogueLine,
  toNotifyTone,
  type ChoiceTemplateView,
  type DialogueTemplateView,
  type NotifyTemplateView,
} from "@lingfan/ui";
import type { NarrativeState } from "./narrative-state";

/** 装配入参：叙事视图状态与 NVL 滚动主体取用 */
export interface AppTemplatesOptions {
  /** 叙事视图状态（菜单/对话/输入字段的响应式来源） */
  narrative: NarrativeState;
  /** NVL 累积层滚动主体取用（对话面板暴露的容器；新句落定后贴底） */
  readNvlBody: () => HTMLElement | null;
}

/** 模板视图能力：选择层/对话框/通知条视图与 NVL 行文本（模板直读） */
export interface AppTemplates {
  /** 选择层当前视图（模板骨架挂点由注册产出填充） */
  choiceView: ComputedRef<ChoiceTemplateView>;
  /** 对话框当前视图（说话人、正文与推进提示） */
  dialogView: ComputedRef<DialogueTemplateView>;
  /** 通知条目视图（按 tone 换肤；骨架固定） */
  notifyViewOf: (text: string, tone: string) => NotifyTemplateView;
  /** NVL 已打完的行（渲染一次，随累积增长） */
  nvlPastLines: ComputedRef<string[]>;
  /** NVL 正在打字的最新一行 */
  nvlTypingLine: ComputedRef<string>;
}

/** 装配模板视图：注册对话框模板族，投影叙事字段为模板骨架挂点数据 */
export function createAppTemplates(options: AppTemplatesOptions): AppTemplates {
  const { readNvlBody } = options;
  const {
    menuPrompt,
    menuOptions,
    speaker,
    speakerColor,
    shownText,
    canAdvance,
    dialogTemplateName,
    nvlBuffer,
  } = options.narrative;
  // —— 对话框模板注册制：宿主装配注册表。核心层解析模板名三级优先级 →
  // __dialog_template，此处按名解析（未知名/null 回退默认）。
  const dialogueTemplates = createDialogueTemplateRegistry();
  dialogueTemplates.register(
    "bubble",
    builtinBubbleTemplate,
    {
      makeDefault: true,
    },
  );
  // 演示自定义模板（作者纯 TS 创作形态）：居中独白——隐藏说话人行 + 皮肤类
  dialogueTemplates.register("center", (input) => ({
    rootClass: "tpl-center",
    speakerHtml: "",
    bodyHtml: input.lineHtml,
    hintHtml: input.canAdvance ? "▼" : "",
  }));
  // —— 选择层 / 通知层模板注册制（与对话模板同一形态：语义骨架挂点 + 根皮肤类）——
  const choiceTemplates = createChoiceTemplateRegistry();
  choiceTemplates.register(
    "default",
    builtinChoiceTemplate,
    {
      makeDefault: true,
    },
  );
  // 演示自定义选择模板（作者纯 TS 创作形态）：编号列表 + 独立皮肤类
  choiceTemplates.register("numbered", (input) => ({
    rootClass: "tpl-choice-numbered",
    promptHtml:
      input.prompt === ""
        ? ""
        : renderDialogueLine({ text: input.prompt }).html,
    optionHtml: input.options.map(
      (opt, i) =>
        `<span class="choice-index">${i + 1}.</span> ${renderDialogueLine({ text: opt.text }).html}`,
    ),
  }));
  const choiceTemplateName = ref<string | null>("");
  const notifyTemplates = createNotifyTemplateRegistry();
  notifyTemplates.register(
    "default",
    builtinNotifyTemplate,
    {
      makeDefault: true,
    },
  );
  const choiceView = computed<ChoiceTemplateView>(() => {
    const template =
      choiceTemplates.resolve(choiceTemplateName.value) ?? builtinChoiceTemplate;
    return template({
      prompt: menuPrompt.value,
      options: menuOptions.value,
    });
  });
  const notifyViewOf = (text: string, tone: string): NotifyTemplateView => {
    const template = notifyTemplates.resolve(null) ?? builtinNotifyTemplate;
    return template({ text, tone: toNotifyTone(tone) });
  };
  const dialogView = computed<DialogueTemplateView>(() => {
    const template =
      dialogueTemplates.resolve(dialogTemplateName.value) ??
      builtinBubbleTemplate;
    return template({
      speaker: speaker.value,
      speakerColor: speakerColor.value,
      lineHtml: renderDialogueLine({ text: shownText.value }).html,
      canAdvance: canAdvance.value,
    });
  });
  const nvlPastLines = computed(() =>
    nvlBuffer.value
      .slice(0, -1)
      .map((line) => renderDialogueLine({ text: line }).html),
  );
  const nvlTypingLine = computed(() => nvlBuffer.value[nvlBuffer.value.length - 1] ?? "");
  watch(nvlBuffer, () => {
    void nextTick(() => {
      const body = readNvlBody();
      if (body !== null) body.scrollTop = body.scrollHeight; // 累积层贴底（阅读最新句）
    });
  });
  return { choiceView, notifyViewOf, dialogView, nvlPastLines, nvlTypingLine };
}
