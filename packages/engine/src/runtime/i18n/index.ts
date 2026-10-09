/**
 * 文本国际化子层出口：覆盖层文件合并与运行时文案翻译。
 *
 * 执行器与运行层内部模块从这里取国际化成员；子层各文件之间仍按需直接引用。
 * 这里只做转发，不放任何实现。
 */
export { mergeOverlayFiles } from "./overlay";
export { translate, translateElements } from "./translate";
