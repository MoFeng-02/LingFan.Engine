/**
 * 统一文字渲染接缝（08-U1 同一管线多容器）：打字机前缀 / 整句 / NVL 行 / 历史条目 /
 * 未来模板——全部经此一条管线（转义 + 内联标记 → HTML）。
 * 容器（对话框 / NVL 累积层 / 历史面板 / 模板）只决定「放在哪、长什么样」，
 * 不各自实现渲染——这是老引擎 DialogEngine + DialogTextRenderer 的复用结论。
 *
 * 性能红线（老引擎 B1/C4 缺陷①）：**逐帧变化的只有打字前缀**；
 * 静态行（NVL 已打完的行 / 历史条目）的 HTML 必须由调用方 memo（computed），
 * 避免 O(全文) 每帧重建。
 */
import { renderInlineMarkup } from "./inline";

export interface DialogueLineInput {
  /** 原始标记文本（`{b}{color=#…}` 等，核心层透传） */
  text: string;
  /** 打字机可见前缀（打字中传入；完成态/静态省略） */
  typed?: string;
}

export interface DialogueLineView {
  /** 富文本 HTML（已全量转义；容器用 v-html / innerHTML 上屏） */
  html: string;
}

/** 统一渲染：typed 优先（打字中），否则整段 text。模板系统的替换点也在这里。 */
export function renderDialogueLine(line: DialogueLineInput): DialogueLineView {
  return { html: renderInlineMarkup(line.typed ?? line.text) };
}
