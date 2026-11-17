/**
 * I18N 翻译源的捕获与读写：状态存「源」（原文键 + 插值实参），展示值读时派生。
 *
 * 源结构是引擎内部形状，不进包公共契约面；经状态键 `SYS.i18nSources` 存放，
 * 随快照/存档/回溯自动随行。切语言只重建译文表，不改源。
 * 元素与 NVL 缓冲不另存源——它们自身内容即原文。
 *
 * 注意：values 可选——缺失时重插值回退当前作用域取值；老存档无此键读出为空
 * （对应表面切语言保持原样，属设计内降级，不抛错）。
 */
import { SYS } from "../../contracts/index.ts";
import type { ExprValue } from "../expr/index.ts";
import type { OpContext } from "../internal/context.ts";

/** 单条翻译源：key = 原文（也是译文表查表键）；values = 捕获时 {var} 占位符的实参 */
export interface I18nTextSource {
  key: string;
  values?: Record<string, ExprValue>;
}

/** 状态中各可见表面的翻译源（缺省 = 该表面当前没有可翻译内容） */
export interface I18nSources {
  dialog?: I18nTextSource;
  speaker?: I18nTextSource;
  menu?: { prompt?: I18nTextSource; options?: I18nTextSource[] };
  input?: { prompt?: I18nTextSource; candidates?: I18nTextSource[] };
}

/** 构造单条源：无实参时不写 values 字段（快照保持最小） */
export function captureSource(
  key: string,
  values?: Record<string, ExprValue>,
): I18nTextSource {
  return values === undefined ? { key } : { key, values };
}

/**
 * 从状态读翻译源：未写入或值不是对象（老存档/异常数据）降级为空。
 * 内部形状由 `writeSources` 的入参类型保证；状态键是保留键，外部写不进。
 */
export function readSources(ctx: OpContext): I18nSources {
  const raw = ctx.state.get(SYS.i18nSources);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as I18nSources;
}

/** 写翻译源（系统键通道，随状态快照/存档随行） */
export function writeSources(ctx: OpContext, sources: I18nSources): void {
  ctx.setSystem(SYS.i18nSources, sources);
}
