/**
 * i18n 工具链 · 缺译 / 多译对账。
 *
 * 对账 = 原文键集合与各语言 overlay 键集合的双向差：
 * - **缺译**（正向）= 原文 − 该语言 overlay（按语言分组；运行期「缺译文回退原文」的预警）
 * - **多译**（反向）= overlay 键 − 原文（与诊断 `unused-translation` 同口径：未使用 = 冗余）
 *
 * 纯函数 + 可读报告文本（编辑器面板一节 / CLI stdout 共用）。加密 overlay（`.json.enc`）
 * 走同一解密供给后与明文同口径参与（供给侧职责见 adapters `loadDiagnosticSupply`）。
 */

import type { EditorTexts } from "../contracts/index.ts";
import { resolveEditorTexts } from "../contracts/index.ts";

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
