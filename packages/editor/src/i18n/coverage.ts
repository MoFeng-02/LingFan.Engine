/**
 * 本地化工作台 · **覆盖率与状态判据**（纯函数，可测）。
 *
 * 为何不直接用 `reconcileTranslations` 就够了：它给的是**缺译/多译的键集合**，
 * 而工作台要回答的是「这个语言**到什么程度**了」——需要**比率**与**三态**，
 * 且比率的**分母口径**必须显式（见下）。这是 UI 判据，不该散在模板里算。
 *
 * ⚠️ **分母口径（本模块最重要的决定）**：覆盖率分母 = **原文键总数**（`sources.length`），
 * 而非「已出现的译键数」。理由：若用后者，`sources=[]` 时会出现 `0/0`，
 * 而 `0/0` 在 UI 上会被渲染成 `NaN%` 或 `Infinity%` ⇒ 用户看到"进度 100%"
 * 或"进度未定义"。本模块把该情形**显式判为 `empty` 态**（见 `coverageStateOf`）。
 */

/** 单语言覆盖率 */
export interface LangCoverage {
  readonly lang: string;
  /** 原文键总数（分母） */
  readonly total: number;
  /** 该语言已译键数（分子；只数**原文里存在**的键，多译键不进分子） */
  readonly translated: number;
  /** 缺译键（稳定排序） */
  readonly missing: readonly string[];
  /** 多译键（该语言有、原文无；稳定排序） */
  readonly unused: readonly string[];
  /** 覆盖率 0~1（**分母为 0 时取 0**，绝不给 NaN） */
  readonly ratio: number;
}

/**
 * 单语言覆盖率。
 *
 * ⚠️ 分子的口径：`translated` 只数**原文与该语言译文的交集**——
 * 多译键（译文有、原文无）**不计入**（它们不是"翻译了原文"，是残留）。
 */
export function langCoverage(
  sources: readonly string[],
  lang: string,
  overlayKeys: readonly string[],
): LangCoverage {
  const sourceSet = new Set(sources);
  const overlaySet = new Set(overlayKeys);
  const missing: string[] = [];
  let translated = 0;
  for (const source of sources) {
    if (overlaySet.has(source)) translated += 1;
    else missing.push(source);
  }
  missing.sort();
  const unused = [...overlaySet].filter((k) => !sourceSet.has(k)).sort();
  return {
    lang,
    total: sources.length,
    translated,
    missing,
    unused,
    ratio: sources.length === 0 ? 0 : translated / sources.length,
  };
}

/** 多语言工作台全貌（稳定排序：按语言码码元序） */
export interface WorkbenchOverview {
  readonly coverages: readonly LangCoverage[];
  /** 全部语言的多译键并集（= `unused-translation` 诊断同口径） */
  readonly unusedAll: readonly string[];
  /** 原文键总数（各语言共用同一分母） */
  readonly totalSources: number;
}

/** 汇总多语言覆盖率（`overlayKeysByLang` 的键 = 语言码） */
export function workbenchOverview(
  sources: readonly string[],
  overlayKeysByLang: Readonly<Record<string, readonly string[]>>,
): WorkbenchOverview {
  const langs = Object.keys(overlayKeysByLang).sort();
  const coverages = langs.map((lang) => langCoverage(sources, lang, overlayKeysByLang[lang] ?? []));
  const unusedAll = [...new Set(coverages.flatMap((c) => c.unused))].sort();
  return { coverages, unusedAll, totalSources: sources.length };
}

/** 覆盖率的**三态**（UI 据此选文案与配色，绝不裸显示 `NaN%`） */
export type CoverageState = "empty" | "untranslated" | "partial" | "complete";

/**
 * 三态判定。
 *
 * - `empty` = **原文为空**（无可译内容；`0/0` 归此类，**不是 100%**）
 * - `complete` = 全部已译
 * - `untranslated` = 一条都没译
 * - `partial` = 其余
 */
export function coverageStateOf(c: LangCoverage): CoverageState {
  if (c.total === 0) return "empty";
  if (c.translated === c.total) return "complete";
  if (c.translated === 0) return "untranslated";
  return "partial";
}

/** 三态的显示文案（**状态口径**：描述当前状态，不叙述历史） */
export function coverageLabelOf(state: CoverageState): string {
  switch (state) {
    case "empty":
      return "无可译内容";
    case "complete":
      return "已全部译出";
    case "untranslated":
      return "尚未开始";
    default:
      return "部分已译";
  }
}

/** 百分比文本（**永不出现 NaN/Infinity**；空态给「—」而不是 0%） */
export function coveragePercentOf(c: LangCoverage): string {
  if (c.total === 0) return "—";
  return `${Math.round(c.ratio * 100)}%`;
}

/** 骨架生成的分组依据（骨架布局决定 `Lang/{lang}/**` 怎么切） */
export type SkeletonLayoutChoice = "single" | "main" | "per-story";

/**
 * 按布局把「故事 → 该故事原文键」分好组，供 `planOverlaySkeleton` 消费。
 *
 * ⚠️ **键 = 故事文件相对 `Stories/` 的路径（不含扩展名）**（与 `SkeletonOptions` 契约一致）——
 * 这里只做**分组**不做过滤（非法 id 由 `planOverlaySkeleton` fail-closed 抛）。
 */
export function groupKeysByStory(
  storyKeys: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const [story, keys] of storyKeys) {
    out.set(story, [...keys].sort());
  }
  return out;
}
