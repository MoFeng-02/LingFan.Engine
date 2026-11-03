/** shared 域唯一出口：文案表、参数校验与版本运算。 */
export { defaultCreateTexts, type CreateTexts } from "./texts.ts";
export {
  caretRange,
  isValidProjectName,
  suggestProjectName,
} from "./guards.ts";
export {
  compareSemver,
  floorOfRange,
  meetsMinimum,
  parseSemver,
  type Semver,
} from "./semver.ts";
