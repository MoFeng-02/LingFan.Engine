/**
 * I18N 展示值派生：状态原值 → 当前语言展示值的唯一派生点。
 *
 * 派生键集合只在 `I18N_DERIVED_KEYS` 声明一次；读口/出站对状态原值调用
 * `deriveValue(ctx, key, rawStateValue)` 得到当前语言的展示值。
 * 非派生键、未装配译文表（overlay 为 null）一律原值返回（引用不变）。
 *
 * 派生结果按「原值引用 + 译文表引用 + 源引用」记忆化：状态没写、语言没切时
 * 重复读不重复查表（每帧零翻译）；写入/换表/恢复换引用即自动失效。
 * 对话正文与说话人带插值源——派生 = 译原文模板 + 用捕获实参重插值；
 * 其余表面状态自身即原文，逐条查表。元素递归译 props.text，输入候选只译 text。
 *
 * 注意：派生是纯读——不写状态、不改原值。老存档的译文残留经「疑似译文」
 * 内存标记跳过查表（防止译文恰等于另一键原文时误译），标记不落盘。
 */
import { SYS, type ElementInstance } from "../../contracts/index.ts";
import type { OpContext } from "../internal/context.ts";
import { readSources, reinterpolate, type I18nSources } from "./sources.ts";
import { translate, translateElements } from "./translate.ts";

/** 展示值随当前语言派生的状态键（唯一声明点；其余键状态里是什么就展示什么） */
export const I18N_DERIVED_KEYS: ReadonlySet<string> = new Set([
  SYS.currentDialogText,
  SYS.currentDialogSpeaker,
  SYS.menuPrompt,
  SYS.menuOptions,
  SYS.inputPrompt,
  SYS.inputOptions,
  SYS.nvlBuffer,
  SYS.elements,
]);

/** 派生缓存条目：三个引用任一变化即失效重算 */
interface DerivedEntry {
  raw: unknown;
  overlay: Map<string, string> | null;
  sources: unknown;
  value: unknown;
}

/** 每引擎一份派生缓存（WeakMap：引擎销毁即释放，不跨引擎串值） */
const derivedCache = new WeakMap<OpContext, Map<string, DerivedEntry>>();

/** 每引擎一份疑似译文标记（老存档读入时打；对应键被引擎重写时清） */
const suspectedLegacy = new WeakMap<OpContext, Set<string>>();

/**
 * 派生单个状态键的展示值：
 * 非派生键或 overlay 未装配 → 原值；派生键 → 按值形状翻译后的新值。
 * 对话正文/说话人优先按源重译重插值；无源（老存档/降级）回退对状态值查表。
 * 形状不符的值（不应出现，防御老存档/异常写入）原样返回，不抛错。
 */
export function deriveValue(
  ctx: OpContext,
  key: string,
  rawStateValue: unknown,
): unknown {
  if (!I18N_DERIVED_KEYS.has(key)) return rawStateValue;
  if (suspectedLegacy.get(ctx)?.has(key)) return rawStateValue;
  if (ctx.overlay === null || rawStateValue === undefined) return rawStateValue;
  // 只有带插值源的表面关心源引用；其余表面源变化不应使其缓存失效
  const sourcesRaw =
    key === SYS.currentDialogText || key === SYS.currentDialogSpeaker
      ? ctx.state.get(SYS.i18nSources)
      : undefined;
  const cache = derivedCache.get(ctx);
  const entry = cache?.get(key);
  if (
    entry !== undefined &&
    Object.is(entry.raw, rawStateValue) &&
    entry.overlay === ctx.overlay &&
    Object.is(entry.sources, sourcesRaw)
  ) {
    return entry.value;
  }
  const value = computeDerived(
    ctx,
    key,
    rawStateValue,
    sourcesRaw === undefined ? NO_SOURCES : readSources(ctx),
  );
  if (cache === undefined) {
    derivedCache.set(
      ctx,
      new Map([
        [
          key,
          {
            raw: rawStateValue,
            overlay: ctx.overlay,
            sources: sourcesRaw,
            value,
          },
        ],
      ]),
    );
  } else {
    cache.set(key, {
      raw: rawStateValue,
      overlay: ctx.overlay,
      sources: sourcesRaw,
      value,
    });
  }
  return value;
}

/** 无插值源表面的共享空源（避免每次派生存取源结构） */
const NO_SOURCES: I18nSources = {};

/** 实际派生（缓存未命中时）：按表面形状分派；源由调用方给定（活状态/检查点各读各的） */
function computeDerived(
  ctx: OpContext,
  key: string,
  rawStateValue: unknown,
  sources: I18nSources,
): unknown {
  switch (key) {
    case SYS.currentDialogText:
    case SYS.currentDialogSpeaker: {
      // 空串 = 表面已清空：无论文本还是源都不派生（清屏语义优先）
      if (rawStateValue === "") return rawStateValue;
      const source =
        key === SYS.currentDialogText ? sources.dialog : sources.speaker;
      if (source !== undefined) return reinterpolate(ctx, source);
      return typeof rawStateValue === "string"
        ? translate(ctx, rawStateValue)
        : rawStateValue;
    }
    case SYS.menuPrompt:
    case SYS.inputPrompt:
      return typeof rawStateValue === "string"
        ? translate(ctx, rawStateValue)
        : rawStateValue;
    case SYS.menuOptions:
    case SYS.nvlBuffer:
      return deriveTextList(ctx, rawStateValue);
    case SYS.inputOptions:
      return deriveInputOptions(ctx, rawStateValue);
    case SYS.elements:
      // 形状在元素 op 执行期已校验（与状态读口同一口径），此处只防非数组
      return Array.isArray(rawStateValue)
        ? translateElements(ctx, rawStateValue as ElementInstance[])
        : rawStateValue;
    default:
      return rawStateValue;
  }
}

/** 文本列表（menuOptions / nvlBuffer）：逐条翻译字符串项，非字符串项原样保留 */
function deriveTextList(ctx: OpContext, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((line: unknown) =>
    typeof line === "string" ? translate(ctx, line) : line,
  );
}

/** 输入候选（inputOptions）：只译展示 text；value 是提交值不是展示文字，不查表 */
function deriveInputOptions(ctx: OpContext, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item: unknown) => {
    if (typeof item !== "object" || item === null) return item;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.text !== "string") return item;
    return { ...candidate, text: translate(ctx, candidate.text) };
  });
}

/**
 * 检查点（历史快照）展示值派生：用该检查点自己捕获的源 + 当前译文表派生。
 * 与活表面同一派生模型（派生只在 core），但不读活状态、不走缓存与标记——
 * 快照不可变，历史面板按需读取。对话/说话人无源（老快照）⇒ 存值直出不查表：
 * 老快照里是译文成品，查表未命中本就回退，直出还避免译文恰等于另一键原文的误命中。
 * NVL 行自身即原文，逐条查表（老快照译文未命中自然回退）。
 */
export function deriveCheckpointValue(
  ctx: OpContext,
  sources: I18nSources,
  key: string,
  rawStateValue: unknown,
): unknown {
  if (!I18N_DERIVED_KEYS.has(key)) return rawStateValue;
  if (ctx.overlay === null || rawStateValue === undefined) return rawStateValue;
  if (key === SYS.currentDialogText || key === SYS.currentDialogSpeaker) {
    if (rawStateValue === "") return rawStateValue;
    const source =
      key === SYS.currentDialogText ? sources.dialog : sources.speaker;
    return source === undefined ? rawStateValue : reinterpolate(ctx, source);
  }
  return computeDerived(ctx, key, rawStateValue, sources);
}

/**
 * 清除某键的疑似译文标记（引擎重写该键时调用：新写入的是原文，正常派生）。
 * 同时失效该键缓存——标记期间的派生结果是原值直出，清标记后须重算。
 */
export function clearSuspected(ctx: OpContext, key: string): void {
  if (suspectedLegacy.get(ctx)?.delete(key)) {
    derivedCache.get(ctx)?.delete(key);
  }
}

/** 清空全部疑似译文标记与派生缓存（新格式读档/启动时调用） */
export function resetSuspected(ctx: OpContext): void {
  suspectedLegacy.delete(ctx);
  derivedCache.delete(ctx);
}

/**
 * 老存档读入后打疑似译文标记：状态里残留的是旧版本写入的译文，
 * 跳过翻译查找（否则译文恰等于另一键原文时会误译）。
 * 只标记「无源且非空」的表面——读档重放已重建源的等待表面不标；
 * 元素/NVL 不另存源，老档里非空即标。标记只在内存，不改存档格式。
 */
export function markLegacySurfaces(ctx: OpContext): void {
  resetSuspected(ctx);
  const sources = readSources(ctx);
  const marks = new Set<string>();
  for (const key of I18N_DERIVED_KEYS) {
    const value = ctx.state.get(key);
    if (!hasContent(value)) continue;
    if (hasSource(key, sources)) continue;
    marks.add(key);
  }
  if (marks.size > 0) suspectedLegacy.set(ctx, marks);
}

/** 表面值是否有内容（空串/空数组 = 无表面，不需要标记） */
function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

/** 该派生键是否有对应翻译源（元素/NVL 恒无源） */
function hasSource(key: string, sources: I18nSources): boolean {
  switch (key) {
    case SYS.currentDialogText:
      return sources.dialog !== undefined;
    case SYS.currentDialogSpeaker:
      return sources.speaker !== undefined;
    case SYS.menuPrompt:
      return sources.menu?.prompt !== undefined;
    case SYS.menuOptions:
      return sources.menu?.options !== undefined;
    case SYS.inputPrompt:
      return sources.input?.prompt !== undefined;
    case SYS.inputOptions:
      return sources.input?.candidates !== undefined;
    default:
      return false;
  }
}

/**
 * 切语言后对当前存在的派生键逐一出站（原文经出站漏斗派生成新语言译文）。
 * 只发出站事件、不写状态——状态里的原文与源不动；宿主收到新值即重绘。
 * 与换表在同一同步块内调用，保证宿主不会看到「新表旧值」的中间态。
 */
export function emitDerivedSurfaces(ctx: OpContext): void {
  for (const key of I18N_DERIVED_KEYS) {
    if (ctx.state.has(key)) {
      ctx.emit(key, ctx.state.get(key), "system");
    }
  }
}
