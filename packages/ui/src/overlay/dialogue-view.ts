/**
 * 对话层视图模型：把投影出的对话渲染态经模板算成一层模型，**不碰任何节点**。
 *
 * 骨架固定（说话人 / 正文 / 推进提示），模板只决定「长什么样」——本模块负责把模板产物与
 * 渲染态合成 `DialogueLayerView`；落到哪个渲染体系由宿主的 `OverlaySurface` 决定。
 * 每次重渲都整层重算（模板输出很灵活，增量 diff 会引入第二份骨架知识）。
 */
import { builtinBubbleTemplate } from "../dialogue/templates";
import { sanitizeFont } from "../dialogue/inline";
import type { DialogueTemplateRegistry } from "../dialogue/templates";
import type { DialogueLayerView } from "./surface";

/** 一次对话层重渲所需的渲染态（全部来自状态投影） */
export interface DialogueRenderInput {
  speaker: string;
  speakerColor: string;
  /** 本句对话字体（空串 = 无声明；正文回落宿主 CSS 变量或浏览器默认） */
  dialogFont: string;
  canAdvance: boolean;
  dialogHidden: boolean;
  waiting: string;
  /** 当前正文 HTML（打字中 = 可见前缀） */
  lineHtml: string;
}

/**
 * 对话层的装配输入。模板名不是参数而是回调——它逐帧从引擎状态读，
 * 因此对话框换装（角色 screen / 逐句 template）不需要重建视图。
 */
export interface DialogueViewDeps {
  /** 模板注册表（不传 = 内建默认） */
  templates?: DialogueTemplateRegistry;
  /** 读当前模板名（`null` = 全局默认） */
  readTemplateName: () => string | null;
}

/**
 * 算出一层对话模型：骨架三段由模板给内容，本函数只做「合成 + 白名单校验 + 可见性判定」。
 *
 * 菜单、输入或视频等待期间整层不可见——是隐藏而非清空，避免恢复时闪一下。
 * 字体只在非空且通过白名单时才写（同 `{font=}` 的口径），空串交给宿主 CSS 承接。
 */
export function dialogueLayerView(
  input: DialogueRenderInput,
  deps: DialogueViewDeps,
): DialogueLayerView {
  const template =
    deps.templates?.resolve(deps.readTemplateName()) ?? builtinBubbleTemplate;
  const built = template({
    speaker: input.speaker,
    speakerColor: input.speakerColor,
    lineHtml: input.lineHtml,
    canAdvance: input.canAdvance,
  });

  const font = input.dialogFont === "" ? null : sanitizeFont(input.dialogFont);
  const visible =
    !input.dialogHidden &&
    input.waiting !== "menu" &&
    input.waiting !== "input" &&
    input.waiting !== "video";

  return {
    rootClass: built.rootClass,
    visible,
    speakerHtml: built.speakerHtml,
    speakerColor: input.speakerColor,
    bodyHtml: built.bodyHtml,
    bodyFont: font ?? "",
    hintHtml: built.hintHtml,
  };
}
