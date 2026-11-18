/**
 * i18n 工具链 · 统一落位与合并视图。
 *
 * 落位 = 布局 × 内容来源 → overlay 文件分组（**唯一声明点**，骨架生成委托本模块）：
 * 故事键与宿主键是两种内容来源，三种布局只改文件组织、不改键集合——
 * single = 全进 `Lang/{lang}.json`；main = 全进 `Lang/{lang}/main.json`；
 * per-story = 故事键镜像 `Stories/` 递归目录、宿主键走 `hostOverlayFile` 归属映射。
 * 多来源落进同一文件时组内合并去重；组序 = 故事 Map 插入序 + 宿主首现序（确定性）。
 *
 * 合并视图调 core `planOverlayMerge`（合并语义唯一声明点在 core，本模块不复写）：
 * main.json 兜底最先 + 其余按路径码元序供给，后写胜。
 */

import type { I18nOverlayFile } from "@lingfan-engine/core";
import {
  isSafeFileNameSegment,
  LANG_DIR,
  planOverlayMerge,
} from "@lingfan-engine/core";
import type { EditorTexts } from "../contracts/index.ts";
import { resolveEditorTexts } from "../contracts/index.ts";
import { hostOverlayFile } from "./host-keys.ts";

/** overlay 根目录名——单一声明点在 core `naming.ts`，这里只转发保持既有出口面 */
export { LANG_DIR };

/**
 * 骨架布局：single = `Lang/{lang}.json`；main = `Lang/{lang}/main.json`；
 * per-story = 镜像 Stories/ 递归目录。声明点在落位层（布局语义由落位决定），
 * 骨架层与调用方经各自出口取用，避免 plan ↔ skeleton 相互引用。
 */
export type SkeletonLayout = "single" | "main" | "per-story";

export interface OverlayPlacementGroup {
  /** 相对资源根的 overlay 路径 */
  path: string;
  /** 归属该文件的原文键（去重；排序归序列化层） */
  keys: string[];
}

export interface PlacementOptions {
  lang: string;
  layout: SkeletonLayout;
  /**
   * 故事 → 该故事的原文键（`extractStoryKeys` 输出；键序不要求，产出内会排序）。
   * **键 = 故事文件相对 `Stories/` 的路径（不含扩展名）**，如 `chapter1/tavern`——
   * per-story 布局按它镜像 `Stories/` 递归目录（平铺工程的键 = 故事 id，语义一致）。
   */
  storyKeys: ReadonlyMap<string, readonly string[]>;
  /** 宿主源文件路径 → 该文件扫出的键（ast-scan 输出；落位走归属映射，仅建议） */
  hostKeys?: ReadonlyMap<string, readonly string[]>;
  /** 集中文案表注入（缺省 defaultEditorTexts） */
  texts?: Partial<EditorTexts>;
}

/**
 * 产出落位分组。fail-closed：`lang` / 故事路径 / 宿主 overlay 路径不合法即抛——
 * 骨架路径要能落进 `Lang/` 而不越界（与故事文件名同一安全口径 `isSafeFileNameSegment`）。
 */
export function planOverlayPlacement(
  options: PlacementOptions,
): OverlayPlacementGroup[] {
  const { lang, layout, storyKeys, hostKeys } = options;
  const t: EditorTexts = resolveEditorTexts(options.texts);
  if (typeof lang !== "string" || !isSafeFileNameSegment(lang)) {
    throw new Error(t.invalidLangCode(String(lang)));
  }
  const groups = new Map<string, Set<string>>();
  const add = (path: string, keys: readonly string[]): void => {
    const bucket = groups.get(path) ?? new Set<string>();
    for (const key of keys) bucket.add(key);
    groups.set(path, bucket);
  };
  if (layout === "single" || layout === "main") {
    const path =
      layout === "single"
        ? `${LANG_DIR}/${lang}.json`
        : `${LANG_DIR}/${lang}/main.json`;
    // 预建分组：空键集合也产一个文件（空骨架也是显式状态）
    groups.set(path, new Set<string>());
    for (const keys of storyKeys.values()) add(path, keys);
    if (hostKeys !== undefined) {
      for (const keys of hostKeys.values()) add(path, keys);
    }
  } else {
    // per-story：故事键镜像 `Stories/` 递归目录——**段级**安全校验防路径越界
    for (const [storyPath, keys] of storyKeys) {
      const segments = storyPath.split("/");
      if (
        storyPath === "" ||
        segments.some((segment) => !isSafeFileNameSegment(segment))
      ) {
        throw new Error(t.invalidStoryPath(storyPath));
      }
      add(`${LANG_DIR}/${lang}/${storyPath}.json`, keys);
    }
    // 宿主键走归属映射；多个源文件可落同一 overlay（如 host/main.json），组内合并
    if (hostKeys !== undefined) {
      for (const [sourcePath, keys] of hostKeys) {
        const relative = hostOverlayFile(sourcePath);
        const segments = relative.split("/");
        if (segments.some((segment) => !isSafeFileNameSegment(segment))) {
          throw new Error(
            `宿主 overlay 路径不合法：${relative}（须为段级安全相对路径；源文件 ${sourcePath}）`,
          );
        }
        add(`${LANG_DIR}/${lang}/${relative}`, keys);
      }
    }
  }
  return [...groups].map(([path, keys]) => ({ path, keys: [...keys] }));
}

export interface MergedOverlayView {
  /** 合并后的键值平面（后写胜；main.json 兜底最先） */
  entries: ReadonlyMap<string, string>;
  /** 规范化供给顺序（main.json 最先，其余按路径码元序） */
  order: readonly string[];
  /** 合并键集合（稳定排序） */
  keys: readonly string[];
}

/** overlay 文件列表 → 合并视图（对账/覆盖率/布局冲突的统一输入；键集合与供给序无关） */
export function mergeOverlayView(
  files: readonly I18nOverlayFile[],
): MergedOverlayView {
  const merged = planOverlayMerge(files);
  return {
    entries: merged.entries,
    order: merged.order,
    keys: [...merged.entries.keys()].sort(),
  };
}