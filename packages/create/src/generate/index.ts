/**
 * 生成域的公共出口。
 *
 * 只做转发：域外的调用方（CLI、测试）只认这一处，内部文件改位置不会外溢。
 */
export {
  collectDependencyNames,
  DEFAULT_SOURCES,
  generateProject,
  layerBases,
  pinnedNames,
  SKELETON_DIR,
} from "./project.ts";
export type { GenerateOptions, GenerateResult } from "./project.ts";
export {
  isTextPath,
  PLACEHOLDERS,
  replaceInFile,
  replacePlaceholders,
} from "./replace.ts";
export { restoreDotfile } from "./dotfiles.ts";
