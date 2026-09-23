/**
 * 对话渲染域出口：内联标记（08 §四.3）+ 打字机二段式（08-U3）+
 * **统一文字渲染接缝**（textView——打字机/NVL/历史/模板共用的唯一管线）。
 */
export { renderInlineMarkup } from "./inline";
export { Typewriter, tokenizeStream } from "./typewriter";
export {
  renderDialogueLine,
  type DialogueLineInput,
  type DialogueLineView,
} from "./textView";
