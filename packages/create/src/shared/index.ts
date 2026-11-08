/** shared 域唯一出口：文案表、参数校验、包管理器识别与版本运算。 */
export { defaultCreateTexts, type CreateTexts } from "./texts.ts";
export {
  caretRange,
  DESCRIPTION_MAX_LENGTH,
  isValidProjectName,
  normalizeDescription,
  suggestProjectName,
} from "./guards.ts";
export {
  currentPackageManager,
  detectPackageManager,
  parsePackageManager,
  type PackageManager,
  type PackageManagerId,
} from "./package-manager.ts";
export {
  compareSemver,
  floorOfRange,
  meetsMinimum,
  parseSemver,
  type Semver,
} from "./semver.ts";
