/**
 * I18N 翻译源的捕获与读写：状态存「源」（原文键 + 插值实参），展示值读时派生。
 *
 * 源结构是引擎内部形状，不进包公共契约面；经状态键 `SYS.i18nSources` 存放，
 * 随快照/存档/回溯自动随行。切语言只重建译文表，不改源。
 * 元素与 NVL 缓冲不另存源——它们自身内容即原文。
 *
 * 注意：values 可选——缺失时重插值回退当前作用域取值；老存档无此键读出为空
 * （对应表面切语言保持原样，属设计内降级，不抛错）。
 * 源写入一律静默（不出站）：源是派生的输入，不是宿主可观察的表面。
 */
import { SYS } from "../../contracts/index.ts";
import { interpolateText, type ExprValue } from "../expr/index.ts";
import type { OpContext } from "../internal/context.ts";
import { translate } from "./translate.ts";

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
 * 源形状守卫：不是对象（老存档/快照缺键/异常数据）降级为空。
 * 内部形状由 `writeSources` 的入参类型保证；状态键是保留键，外部写不进。
 * 快照里的源与活状态共用同一守卫——历史面板按检查点自己的源派生。
 */
export function asSources(raw: unknown): I18nSources {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as I18nSources;
}

/** 从状态读翻译源：未写入或值不是对象（老存档/异常数据）降级为空 */
export function readSources(ctx: OpContext): I18nSources {
  return asSources(ctx.state.get(SYS.i18nSources));
}

/** 写翻译源（静默写状态：随快照/存档随行，不触发观察事件） */
export function writeSources(ctx: OpContext, sources: I18nSources): void {
  ctx.state.set(SYS.i18nSources, sources);
}

/**
 * 按表面增量更新翻译源：patch 里出现的字段整体替换，值为 undefined 表示清除该表面源。
 * 没有任何字段变化时不写（保持同一对象引用，派生缓存据此判脏）。
 * 调用时机必须先于对应表面键的写入/清空——出站派生读的是「当时」的源。
 */
export function updateSources(
  ctx: OpContext,
  patch: Partial<I18nSources>,
): void {
  const current = readSources(ctx);
  const next: I18nSources = { ...current };
  let changed = false;
  for (const [field, value] of Object.entries(patch)) {
    const key = field as keyof I18nSources;
    if (value === undefined) {
      if (key in next) {
        delete next[key];
        changed = true;
      }
    } else if (current[key] !== value) {
      // 类型上 patch 的值与字段一一对应；Object.entries 抹掉了这层关联，按字段名落位
      (next as Record<string, unknown>)[key] = value;
      changed = true;
    }
  }
  if (changed) writeSources(ctx, next);
}

/** 插值捕获结果：text = 原文插值成品（写入状态的值）；source = 重译所需的最小上下文 */
export interface RecordedInterpolation {
  text: string;
  errors: ReturnType<typeof interpolateText>["errors"];
  source: I18nTextSource;
}

/**
 * 在 interpolateText 调用点捕获插值实参：记录器包住 ctx.resolveName，
 * 把求值成功的名称实参记进 values（插值函数本身不改）。
 * 切语言重译时用「说话那一刻」的实参重插值 ⇒ 画面只有语言变，语义不变。
 * 注意：随机/draw 类表达式不经名称解析，重插值会重新求值（源模型只存名称实参）。
 */
export function recordInterpolation(
  ctx: OpContext,
  key: string,
): RecordedInterpolation {
  const values: Record<string, ExprValue> = {};
  const recordingResolver = (name: string) => {
    const resolved = ctx.resolveName(name);
    if (resolved.found && isExprValue(resolved.value)) {
      values[name] = resolved.value;
    }
    return resolved;
  };
  const { text, errors } = interpolateText(key, recordingResolver, ctx.draw);
  const source = captureSource(
    key,
    Object.keys(values).length > 0 ? values : undefined,
  );
  return { text, errors, source };
}

/**
 * 按源重插值出当前语言的展示文本：先译原文模板，再用捕获实参插值。
 * 捕获里缺失的名称回退当前作用域（设计内降级）。读路径纯函数：
 * 插值失败保留原文片段（interpolateText 自带），错误不重复出站——写入时已校验过。
 * 注意：翻译对象是原文模板（键可含 {var} 占位）而非解析值——动态说话人如 "{name}"，
 * 若译文表键收的是解析名而非模板则未命中、显示原文；这是模板模型的固有语义
 * （译者面对模板占位，不面对解析值）。
 */
export function reinterpolate(ctx: OpContext, source: I18nTextSource): string {
  const template = translate(ctx, source.key);
  const resolver = (name: string) => {
    const captured = source.values?.[name];
    if (captured !== undefined)
      return { found: true as const, value: captured };
    return ctx.resolveName(name);
  };
  return interpolateText(template, resolver, ctx.draw).text;
}

/** ExprValue 值域守卫：捕获实参只收值域内的值（域外值不记，重插值回退当前作用域） */
function isExprValue(value: unknown): value is ExprValue {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isExprValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isExprValue);
  }
  return false;
}
