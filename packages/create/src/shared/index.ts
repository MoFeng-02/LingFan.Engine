/** shared 域唯一出口：文案表与参数校验。 */
export { defaultCreateTexts, type CreateTexts } from "./texts.ts";
export {
  caretRange,
  isValidProjectName,
  suggestProjectName,
} from "./guards.ts";
