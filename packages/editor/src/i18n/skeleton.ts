/**
 * i18n 工具链 · overlay 骨架生成。
 *
 * 给定语言与分组策略，产出**文件内容**（原文 → 既有译文或占位）；落盘归调用方
 * （编辑器保存 / CLI），本模块保持纯函数（不碰平台 API）。合并语义与运行期
 * `mergeOverlayFiles` 对齐（main.json 兜底 + 其余按供给序覆盖）⇒ 骨架喂回合并后
 * 键集合与 `extractStoryKeys` 输出**双向一致**（互锁测试锁定）。
 *
 * 布局覆盖 overlay 形态：「平铺」= 条目即键值平面（三形态共用）；
 * 单大文件 `Lang/{lang}.json`、目录 `Lang/{lang}/main.json`、按故事分类
 * `Lang/{lang}/{章节子目录}/{故事}.json`——**per-story 镜像 `Stories/` 的递归目录**
 * （章节子目录更好区分归类；`.json` / `.json.enc`
 * 双识别归运行期供给，骨架产明文）。**增量模式**：命中的既有译文原样保留（含空串
 * 译文——运行期「命中即用」语义），绝不覆盖。
 */

import { isSafeFileNameSegment } from "@lingfan/engine";

/** 占位策略：original = 原文占位（未翻译时画面可读，翻译工作表语义）；empty = 空串（运行期命中即隐句） */
export type SkeletonPlaceholder = "original" | "empty";

/** 骨架布局：single = `Lang/{lang}.json`；main = `Lang/{lang}/main.json`；per-story = 镜像 Stories/ 递归目录 */
export type SkeletonLayout = "single" | "main" | "per-story";

export interface OverlaySkeletonFile {
  /** 相对资源根的 overlay 路径 */
  path: string;
  /** 键值平面（键 = 原文，稳定排序；值 = 既有译文（增量保留）或占位） */
  entries: Record<string, string>;
  /** 序列化好的文件内容（2 空格缩进 + 结尾换行；落盘即用，同输入逐字节确定） */
  content: string;
}

export interface SkeletonOptions {
  lang: string;
  layout: SkeletonLayout;
  /**
   * 故事 → 该故事的原文键（`extractStoryKeys` 输出；键序不要求，产出内会排序）。
   * **键 = 故事文件相对 `Stories/` 的路径（不含扩展名）**，如 `chapter1/tavern`——
   * per-story 布局按它镜像 `Stories/` 递归目录（平铺工程的键 = 故事 id，语义一致）。
   */
  storyKeys: ReadonlyMap<string, readonly string[]>;
  /** 增量模式：该语言已存在的 overlay（路径 → 条目）；命中的键保留原值 */
  existing?: ReadonlyMap<string, Record<string, string>>;
  placeholder?: SkeletonPlaceholder;
}

/**
 * 产出骨架文件列表。fail-closed：`lang` / 故事 id 不合法即抛——骨架路径要能落进
 * `Lang/` 而不越界（与故事文件名同一安全口径 `isSafeFileNameSegment`）。
 */
export function planOverlaySkeleton(
  options: SkeletonOptions,
): OverlaySkeletonFile[] {
  const { lang, layout, storyKeys, existing, placeholder = "original" } =
    options;
  if (typeof lang !== "string" || !isSafeFileNameSegment(lang)) {
    throw new Error(`语言码不合法：${String(lang)}（须为单段安全文件名）`);
  }
  const build = (path: string, keys: readonly string[]): OverlaySkeletonFile => {
    const prior = existing?.get(path) ?? {};
    const entries: Record<string, string> = {};
    for (const key of [...keys].sort()) {
      // 既有条目原样保留（含空串译文）；`undefined` = 未命中 → 占位
      const kept = prior[key];
      entries[key] =
        typeof kept === "string" ? kept : placeholder === "empty" ? "" : key;
    }
    return { path, entries, content: `${JSON.stringify(entries, null, 2)}\n` };
  };
  if (layout === "single" || layout === "main") {
    const union = new Set<string>();
    for (const keys of storyKeys.values()) {
      for (const key of keys) union.add(key);
    }
    const path =
      layout === "single" ? `Lang/${lang}.json` : `Lang/${lang}/main.json`;
    return [build(path, [...union])];
  }
  // per-story：镜像 `Stories/` 的递归目录——
  // 键 = 故事相对 `Stories/` 的路径（不含扩展名）；**段级**安全校验防路径越界。
  const files: OverlaySkeletonFile[] = [];
  for (const [storyPath, keys] of storyKeys) {
    const segments = storyPath.split("/");
    if (
      storyPath === "" ||
      segments.some((segment) => !isSafeFileNameSegment(segment))
    ) {
      throw new Error(
        `故事路径不合法：${storyPath}（须为相对 Stories/ 的段级安全路径，如 chapter1/tavern）`,
      );
    }
    files.push(build(`Lang/${lang}/${storyPath}.json`, keys));
  }
  return files;
}
