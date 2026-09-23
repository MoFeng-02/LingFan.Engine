/**
 * 01 §四.3 I18N overlay 合并（老引擎 I18nService 思想的引擎侧落点）：
 * main.json 最先载入作为全局兜底，其余文件按供给顺序逐条覆盖（后加载覆盖先加载）。
 * 内部组织方式自由：扁平、子文件夹分类、单一大文件均可（老引擎同承诺）。
 */
import type { I18nOverlayFile } from "../contracts";

/** 合并 overlay 文件为译文表：main.json 兜底 + 其余按序覆盖（确定性，供给顺序即覆盖序） */
export function mergeOverlayFiles(
  files: readonly I18nOverlayFile[],
): Map<string, string> {
  const main = files.find((f) => f.path === "main.json");
  const merged = new Map<string, string>(Object.entries(main?.entries ?? {}));
  for (const file of files) {
    if (file === main) continue;
    for (const [original, translation] of Object.entries(file.entries)) {
      merged.set(original, translation);
    }
  }
  return merged;
}
