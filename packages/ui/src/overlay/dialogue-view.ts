/**
 * 对话层渲染：把投影出的对话渲染态经模板落成 DOM。
 *
 * 骨架固定（说话人行 / 正文 / 推进提示），模板只决定「长什么样」——内容与皮肤
 * 由模板给出，本模块负责把它挂到对话层上。每次重渲整体重建（模板可能的输出很灵活，
 * 增量 diff 会引入第二份骨架知识；打字帧重渲的代价由模板输出的纯字符串派生兜住）。
 */
import { builtinBubbleTemplate } from "../dialogue/templates";
import type { DialogueTemplateRegistry } from "../dialogue/templates";
import type { NarrativeMounts } from "./types";

/** 一次对话层重渲所需的渲染态（全部来自状态投影） */
export interface DialogueRenderInput {
  speaker: string;
  speakerColor: string;
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
  /** 挂载点父容器（`ownerDocument` 的来源） */
  container: HTMLElement;
  mounts: NarrativeMounts;
  /** 模板注册表（不传 = 内建默认） */
  templates?: DialogueTemplateRegistry;
  /** 读当前模板名（`null` = 全局默认） */
  readTemplateName: () => string | null;
}

/**
 * 造一个对话层渲染函数：调用它即用当帧的渲染态整体重渲对话层。
 *
 * 骨架固定为「说话人 / 正文 / 推进提示」三段，模板只填内容；每帧重建是因为打字帧
 * 本来就要重写正文，增量对比省不下什么却要再养一份骨架知识。等待菜单、输入或
 * 视频时整层隐藏——是隐藏而非清空，避免恢复时闪一下。
 */
export function createDialogueView(
  deps: DialogueViewDeps,
): (input: DialogueRenderInput) => void {
  return (input) => {
    const template =
      deps.templates?.resolve(deps.readTemplateName()) ?? builtinBubbleTemplate;
    const built = template({
      speaker: input.speaker,
      speakerColor: input.speakerColor,
      lineHtml: input.lineHtml,
      canAdvance: input.canAdvance,
    });

    const doc = deps.container.ownerDocument;
    const dialogue = deps.mounts.dialogue;
    dialogue.className = `lf-dialogue ${built.rootClass}`;
    dialogue.innerHTML = "";
    if (built.speakerHtml !== "") {
      const p = doc.createElement("p");
      p.className = "lf-speaker";
      p.innerHTML = built.speakerHtml;
      if (input.speakerColor !== "") p.style.color = input.speakerColor;
      dialogue.appendChild(p);
    }
    const body = doc.createElement("p");
    body.className = "lf-text";
    body.innerHTML = built.bodyHtml;
    dialogue.appendChild(body);
    if (built.hintHtml !== "") {
      const hint = doc.createElement("span");
      hint.className = "lf-hint";
      hint.innerHTML = built.hintHtml;
      dialogue.appendChild(hint);
    }

    // 菜单/输入/视频等待期间，对话层让位给对应的层
    const visible =
      !input.dialogHidden &&
      input.waiting !== "menu" &&
      input.waiting !== "input" &&
      input.waiting !== "video";
    dialogue.style.display = visible ? "" : "none";
  };
}
