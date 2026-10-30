/**
 * 原生形态的「名字 → UI 工厂」表。
 *
 * 框架形态里 UI 就是组件对象，原生形态没有组件这个概念——UI 是一个**函数**：
 * 拿入参、造出一棵 DOM 子树、返回节点与拆除钩子。表由生成物 `src/gen/ui_register.g.ts`
 * 提供（名字即 `src/ui/<名>/` 目录名），本文件只负责**取表项并验形**。
 *
 * 为什么不在渲染器里直接 `table[name]`：生成物是 `Record<string, unknown>`，值可能因为
 * 作者把 `.vue` 写进原生工程而变成组件对象。那种情况必须 fail-closed 并说清原因，
 * 而不是让渲染器在 `factory is not a function` 上崩掉整屏。
 */

/** 一份已挂载的原生 UI：一个根节点 + 可选拆除钩子 */
export interface NativeUiInstance {
  /** 挂进容器的根节点；渲染器只 append / remove 它，不看它内部 */
  readonly element: HTMLElement;
  /** 拆除：退订、清定时器、释放资源；渲染器在卸载与整份重挂时调用一次 */
  dispose?(): void;
}

/** 原生形态的 UI：入参进，节点出 */
export type NativeUiFactory = (
  props: Readonly<Record<string, unknown>>,
) => NativeUiInstance;

/** 「名字 → 工厂」表（生成物 `uis` 的原生形态投影） */
export type NativeUiTable = Readonly<Record<string, NativeUiFactory>>;

/**
 * 取某个名字的工厂；取不到或形态不对时返回 `undefined`（由调用方决定怎么报）。
 *
 * 形态判据是「函数」而不是「对象」：原生形态的 UI 是工厂，Vue / React 的组件对象
 * 也是函数或带 `setup` 的对象——两者在 `typeof` 上都可能像函数，所以这里不猜，
 * 只认调用结果：真调不通时由渲染器捕获并报一条带名字的诊断。
 */
export function resolveNativeFactory(
  table: Readonly<Record<string, unknown>>,
  name: string,
): NativeUiFactory | undefined {
  const candidate = table[name];
  return typeof candidate === "function"
    ? (candidate as NativeUiFactory)
    : undefined;
}
