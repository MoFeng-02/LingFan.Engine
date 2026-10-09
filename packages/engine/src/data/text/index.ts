/**
 * 文本创作模式子域的唯一出口（对外 6 个名字）。
 * 文本 = JSON v1 的投影（双向）：读向在 parse/、写向在 generate/、共享词法与字面量在根层。
 */
export { TextFormatError } from "./error";
export {
  generateText,
  parseTextStory,
  projectText,
  type TextProjection,
} from "./entry";
export { drainTextProjectionWarnings } from "./warnings";
