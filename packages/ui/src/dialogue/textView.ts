/**
 * 统一文字渲染接缝（同一管线多容器）：打字机前缀 / 整句 / NVL 行 / 历史条目 /
 * 未来模板——全部经此一条管线（转义 + 内联标记 → HTML）。
 * 容器（对话框 / NVL 累积层 / 历史面板 / 模板）只决定「放在哪、长什么样」，
 * 不各自实现渲染——这是对话渲染的复用结论。
 * 性能红线：**逐帧变化的只有打字前缀**；
 * 静态行（NVL 已打完的行 / 历史条目）的 HTML 必须由调用方 memo（computed），
 * 避免 O(全文) 每帧重建。
 */
import { renderInlineMarkup } from "./inline";

/**
 * 一行对话的渲染请求。`typed` 与 `text` 二选一即可——给了 `typed` 就按它渲染，
 * 这是「打字中每帧变、打完不变」两种调用形态共用同一入口的方式。
 */
export interface DialogueLineInput {
  /** 原始标记文本（`{b}{color=#…}` 等，核心层透传） */
  text: string;
  /** 打字机可见前缀（打字中传入；完成态/静态省略） */
  typed?: string;
}

/**
 * 渲染产物：转义后的富文本 HTML。内容已安全，容器可直接 `innerHTML` 上屏；
 * 输出刻意只有这一个字段——渲染接缝不掺布局决策。
 */
export interface DialogueLineView {
  /** 富文本 HTML（已全量转义；容器用 v-html / innerHTML 上屏） */
  html: string;
}

/** 统一渲染：typed 优先（打字中），否则整段 text。模板系统的替换点也在这里。 */
export function renderDialogueLine(line: DialogueLineInput): DialogueLineView {
  return { html: renderInlineMarkup(line.typed ?? line.text) };
}
