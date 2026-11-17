/**
 * i18n 工具链 · 缺译 / 多译对账。
 *
 * 对账 = 原文键集合与各语言 overlay 键集合的双向差：
 * - **缺译**（正向）= 原文 − 该语言 overlay（按语言分组；运行期「缺译文回退原文」的预警）
 * - **多译**（反向）= overlay 键 − 原文（与诊断 `unused-translation` 同口径：未使用 = 冗余）
 *
 * 纯函数 + 可读报告文本（编辑器面板一节 / CLI stdout 共用）。加密 overlay（`.json.enc`）
 * 走同一解密供给后与明文同口径参与（供给侧职责见 adapters `loadDiagnosticSupply`）。
 *
 * 另承载三类诊断数据：孤儿键（多译同口径）、宿主未标记文案（含 CJK 但未包 t()，
 * 检测归 ast-scan，本模块只聚合数据与格式化）、布局冲突（同键跨文件取值不一）。
 */

import type { I18nOverlayFile } from "@lingfan-engine/core";
import type { EditorTexts } from "../contracts/index.ts";
import { resolveEditorTexts } from "../contracts/index.ts";
import { planOverlaySkeleton, type SkeletonLayout } from "./skeleton.ts";

export interface TranslationReconcileReport {
  /** 每语言缺译键（稳定排序；语言无缺译时为空数组——「齐」也是显式状态） */
  missingByLang: ReadonlyMap<string, readonly string[]>;
  /** 多译键（跨语言并集口径，稳定排序；= unused-translation 诊断同源） */
  unused: readonly string[];
}

/**
 * 三态对账：某语言缺译 / 多译 / 齐。`overlayKeysByLang` 的键 = 语言码
 * （单语言工具传单键对象即可）。
 */
export function reconcileTranslations(
  sources: readonly string[],
  overlayKeysByLang: Readonly<Record<string, readonly string[]>>,
): TranslationReconcileReport {
  const sourceSet = new Set(sources);
  const missingByLang = new Map<string, readonly string[]>();
  const unused = new Set<string>();
  for (const [lang, keys] of Object.entries(overlayKeysByLang)) {
    const keySet = new Set(keys);
    for (const key of keySet) {
      if (!sourceSet.has(key)) unused.add(key);
    }
    const missing: string[] = [];
    for (const source of sourceSet) {
      if (!keySet.has(source)) missing.push(source);
    }
    missing.sort();
    missingByLang.set(lang, missing);
  }
  return { missingByLang, unused: [...unused].sort() };
}

/** 可读报告（编辑器面板一节 / CLI stdout 共用）；逐语言缺译 + 多译两节。
 * `texts`（可选）= 集中文案表注入（缺省 defaultEditorTexts）。 */
export function formatTranslationReport(
  report: TranslationReconcileReport,
  texts: Partial<EditorTexts> = {},
): string {
  const t = resolveEditorTexts(texts);
  const lines: string[] = [];
  for (const [lang, missing] of [...report.missingByLang.entries()].sort()) {
    if (missing.length === 0) {
      lines.push(t.missingZero(lang));
      continue;
    }
    lines.push(t.missingCount(lang, missing.length));
    for (const key of missing) lines.push(`  - ${key}`);
  }
  if (report.unused.length === 0) {
    lines.push(t.unusedZero());
  } else {
    lines.push(t.unusedCount(report.unused.length));
    for (const key of report.unused) lines.push(`  - ${key}`);
  }
  return lines.join("\n");
}

/* ———————————————— 三类诊断数据（孤儿键 / 宿主未标记 / 布局冲突） ———————————————— */

/** 宿主未标记文案：含 CJK 但未包登记 t() 调用的字面量（不进键集合，只进诊断；1 基坐标） */
export interface UnmarkedHostText {
  /** 工程内相对源文件路径（`/` 分隔） */
  file: string;
  line: number;
  column: number;
  text: string;
}

/** 布局冲突的一个落点：某 overlay 文件里该键的取值 */
export interface LayoutConflictSite {
  path: string;
  value: string;
}

/** 布局冲突：同键出现在 ≥2 个文件且取值 ≥2 种（合并后写胜会静默遮蔽，必须显式报告） */
export interface LayoutConflict {
  key: string;
  /** 全部落点（路径码元序，同路径按值序；确定性） */
  sites: readonly LayoutConflictSite[];
}

/** 从 overlay 文件列表找布局冲突（键排序；同键同值不算冲突——重复但无害） */
export function findLayoutConflicts(
  files: readonly I18nOverlayFile[],
): LayoutConflict[] {
  const sitesByKey = new Map<string, LayoutConflictSite[]>();
  for (const file of files) {
    for (const [key, value] of Object.entries(file.entries)) {
      const sites = sitesByKey.get(key) ?? [];
      sites.push({ path: file.path, value });
      sitesByKey.set(key, sites);
    }
  }
  const conflicts: LayoutConflict[] = [];
  for (const [key, sites] of sitesByKey) {
    if (sites.length < 2) continue;
    if (new Set(sites.map((site) => site.value)).size < 2) continue;
    sites.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : a.value < b.value ? -1 : 1,
    );
    conflicts.push({ key, sites });
  }
  conflicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return conflicts;
}

/** --prune 会删除的键（既有 − 源，稳定排序）；默认增量不删孤儿键，显式开启时逐条列出 */
export function prunedOverlayKeys(
  sourceKeys: readonly string[],
  priorKeys: readonly string[],
): string[] {
  const source = new Set(sourceKeys);
  return [...new Set(priorKeys)].filter((key) => !source.has(key)).sort();
}

/** 计划外孤儿文件：既有 overlay 中路径不在任何落位分组、且含无源孤儿键的文件 */
export interface UnplannedOrphanFile {
  /** 相对资源根的 overlay 路径（计划外——故事改名/拆分/删除后残留） */
  path: string;
  /** 该文件里的无源孤儿键（稳定排序；与 report.unused 同口径 = 键 − 源集） */
  keys: string[];
}

/**
 * --prune 盲区诊断（只报告不删除）。骨架只迭代落位分组，既有 overlay 里路径不在任何
 * 分组的「计划外文件」永不被访问 ⇒ prune 对其静默无操作。本函数按 report 同口径
 * （复用 prunedOverlayKeys：键 − 源集）逐计划外文件算孤儿，供调用方显式报告「未删除」，
 * 使 exit 0 不再虚假暗示清理完成。本函数只报告不删除；是否实删计划外孤儿文件键由调用方决定。
 */
export function unplannedOrphanKeys(
  existing: ReadonlyMap<string, Record<string, string>>,
  plannedPaths: readonly string[],
  sourceKeys: readonly string[],
): UnplannedOrphanFile[] {
  const planned = new Set(plannedPaths);
  const result: UnplannedOrphanFile[] = [];
  for (const [path, entries] of existing) {
    if (planned.has(path)) continue;
    const keys = prunedOverlayKeys(sourceKeys, Object.keys(entries));
    if (keys.length > 0) result.push({ path, keys });
  }
  result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return result;
}

/** 计划外孤儿报告节（--prune 未删除的孤儿键，逐条 键@文件；文件路径码元序） */
export function formatUnplannedOrphans(
  unplanned: readonly UnplannedOrphanFile[],
): string {
  const total = unplanned.reduce((n, file) => n + file.keys.length, 0);
  const lines: string[] = [
    `${total} 个孤儿键位于 ${unplanned.length} 个计划外文件，--prune 未删除：`,
  ];
  for (const file of unplanned) {
    for (const key of file.keys) lines.push(`  - ${key}@${file.path}`);
  }
  return lines.join("\n");
}

/** 宿主未标记文案报告节（file:line:column 定位；按位置稳定排序） */
export function formatUnmarkedTexts(
  unmarked: readonly UnmarkedHostText[],
): string {
  const lines: string[] = [];
  if (unmarked.length === 0) {
    lines.push("宿主未标记文案 0 条（静态文案均已包 t()）");
    return lines.join("\n");
  }
  lines.push(
    `宿主未标记文案 ${unmarked.length} 条（含中文但未包 t()，不进键集合）：`,
  );
  const sorted = [...unmarked].sort((a, b) =>
    a.file < b.file
      ? -1
      : a.file > b.file
        ? 1
        : a.line !== b.line
          ? a.line - b.line
          : a.column - b.column,
  );
  for (const site of sorted) {
    lines.push(`  - ${site.file}:${site.line}:${site.column} ${site.text}`);
  }
  return lines.join("\n");
}

/** 布局冲突报告节（键 + 各落点取值） */
export function formatLayoutConflicts(
  conflicts: readonly LayoutConflict[],
): string {
  const lines: string[] = [];
  if (conflicts.length === 0) {
    lines.push("布局冲突 0 处（同键跨文件取值一致）");
    return lines.join("\n");
  }
  lines.push(
    `布局冲突 ${conflicts.length} 处（同键多文件取值不一，合并后写胜会静默遮蔽）：`,
  );
  for (const conflict of conflicts) {
    lines.push(`  - ${conflict.key}`);
    for (const site of conflict.sites) {
      lines.push(`      ${site.path} = ${site.value}`);
    }
  }
  return lines.join("\n");
}

/** 宿主诊断两节合并报告（scan 只用未标记节；report/check 用全量） */
export function formatI18nDiagnostics(diag: {
  unmarked: readonly UnmarkedHostText[];
  conflicts: readonly LayoutConflict[];
}): string {
  return [
    formatUnmarkedTexts(diag.unmarked),
    formatLayoutConflicts(diag.conflicts),
  ].join("\n");
}

/**
 * 三布局键集合一致性（互锁 L2 的体检项；只报告不阻断——先报告后收紧）。
 * 同一输入分别按三种布局生成骨架，键集合签名逐一相等即一致。
 */
export function layoutKeySetsConsistent(options: {
  lang: string;
  storyKeys: ReadonlyMap<string, readonly string[]>;
  hostKeys?: ReadonlyMap<string, readonly string[]>;
}): boolean {
  const layouts: readonly SkeletonLayout[] = ["single", "main", "per-story"];
  const signatures = layouts.map((layout) => {
    const keys = new Set<string>();
    for (const file of planOverlaySkeleton({ ...options, layout })) {
      for (const key of Object.keys(file.entries)) keys.add(key);
    }
    return [...keys].sort().join("\u0000");
  });
  return signatures[0] === signatures[1] && signatures[1] === signatures[2];
}
