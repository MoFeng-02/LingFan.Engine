/**
 * 08 §四.5 对话框模板注册制（老引擎 IDialogTemplateRegistry / Phase 65 语义）：
 * 模板 = 对话框「语义骨架各挂点」的注册渲染函数（纯 TS 可测；作者纯 TS 创作与
 * 未来编辑器可视化创作产出同构描述，装配到同一注册表）。
 * 模板名由核心层解析三级优先级后写入 `__dialog_template`（say template >
 * character screen > 全局默认），本表按名解析、未知名/null 回退默认
 * （老引擎 Resolve ?? GetDefault 同语义）。
 * 性能红线（老引擎 B1/C4 教训）：打字帧每帧重算——speaker/hint 输入不变时输出
 * 为纯字符串派生（宿主 Vue diff 后不 patch）；NVL 累积层因增量渲染纪律保持宿主
 * 固定骨架，不走模板全量重渲。统一渲染接缝（renderDialogueLine）即行渲染原语。
 */
import { renderDialogueLine } from "./textView";

/** 模板输入：对话渲染状态投影（宿主从引擎状态/渲染态映射） */
export interface DialogueTemplateInput {
  /** 插值后说话人（空 = 无说话人行） */
  speaker: string;
  /** U4 角色色（空 = 默认；内置模板经宿主 style 应用，自定义模板可自定消费） */
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

export type DialogueTemplateFn = (
  input: DialogueTemplateInput,
) => DialogueTemplateView;

export class DialogueTemplateRegistry {
  private readonly templates = new Map<string, DialogueTemplateFn>();
  private defaultName: string | null = null;

  /** 注册模板（同名覆盖更新——老引擎 AddDialogTemplates 注册即设默认的可选语义） */
  register(
    name: string,
    fn: DialogueTemplateFn,
    opts: { makeDefault?: boolean } = {},
  ): void {
    if (name === "") return; // 空名 = 「无模板」哨兵，不可被注册占用
    this.templates.set(name, fn);
    if (opts.makeDefault === true) this.defaultName = name;
  }

  has(name: string): boolean {
    return this.templates.has(name);
  }

  /** 老引擎 Resolve ?? GetDefault：未知名/null 回退默认；未设默认 = null（宿主兜底） */
  resolve(name?: string | null): DialogueTemplateFn | null {
    if (name !== null && name !== undefined && name !== "") {
      const hit = this.templates.get(name);
      if (hit !== undefined) return hit;
    }
    if (this.defaultName === null) return null;
    return this.templates.get(this.defaultName) ?? null;
  }
}

export function createDialogueTemplateRegistry(): DialogueTemplateRegistry {
  return new DialogueTemplateRegistry();
}

/** 内置 bubble 模板：复刻 08-U1 参考视觉（speaker 行 + 统一接缝正文 + ▼ 推进） */
export const builtinBubbleTemplate: DialogueTemplateFn = (input) => ({
  rootClass: "tpl-bubble",
  speakerHtml:
    input.speaker === ""
      ? ""
      : renderDialogueLine({ text: input.speaker }).html,
  bodyHtml: input.lineHtml,
  hintHtml: input.canAdvance ? "▼" : "",
});
