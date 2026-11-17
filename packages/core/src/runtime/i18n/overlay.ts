/**
 * I18N overlay 合并：
 * 默认语言文件（main.json）最先合并（兜底层），其余文件按名排序依次覆盖；同键后写胜。
 * main.json 最先载入作为全局兜底，其余文件按供给顺序逐条覆盖（后加载覆盖先加载）。
 * 内部组织方式自由：扁平、子文件夹分类、单一大文件均可。
 */
import type { I18nOverlayFile } from "../../contracts/index.ts";

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

/**
 * 规划 overlay 合并：先把文件排成**规范供给序**，再按该序合并出译文表。
 *
 * 规范供给序（合并顺序与冲突胜出的唯一声明点，运行期/编辑器/CLI 共用）：
 * 1. main.json 最先（全局兜底层）；
 * 2. 其余文件按路径字典序（码元比较，不依赖 locale）依次覆盖；
 * 3. 同键后写胜。
 *
 * 确定性：同一批文件无论以什么顺序读入，结果（entries 与 order）都相同。
 * 用法：`const { entries, order } = planOverlayMerge(files)`——entries 直接喂查表，
 * order 是规范序路径列表（报告/诊断用）。
 * 注意：`mergeOverlayFiles` 保持「供给顺序即覆盖序」的原语义不变；本函数只负责
 * 把任意供给序规范化后交给它合并，两者对同一规范序输入产出同键同值。
 * 路径假定唯一（文件系统保证）；重复路径不属于合法供给。
 */
export function planOverlayMerge(files: readonly I18nOverlayFile[]): {
  entries: Map<string, string>;
  order: string[];
} {
  const ordered = [...files].sort((a, b) => {
    if (a.path === "main.json") return b.path === "main.json" ? 0 : -1;
    if (b.path === "main.json") return 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return {
    entries: mergeOverlayFiles(ordered),
    order: ordered.map((f) => f.path),
  };
}
