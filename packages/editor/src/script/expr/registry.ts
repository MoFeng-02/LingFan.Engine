/**
 * 变量注册表与句柄：显式注册制的声明面。
 *
 * 引擎表达式是字符串、求值归引擎，本层只负责生成表达式文本——
 * `defineVars` 声明一个故事源用到的变量（IDE 补全与拼写检查由此而来），
 * 句柄树的叶子是 `VarHandle`，装配期按注册表核对：未注册的引用直接抛错。
 *
 * 注册表与警告池是模块态，一次导入 = 一个故事源。
 */

/** 变量种类（注册时声明；构建期轻校验的判类依据） */
export type VarKind = "num" | "str" | "bool";

export interface VarHandle {
  readonly kind: VarKind;
  /** 引擎状态键（如 `player.gold`） */
  readonly key: string;
}

const VAR_KINDS: ReadonlySet<string> = new Set(["num", "str", "bool"]);

/** 真句柄 = kind 为三种之一且 key 为字符串——未注册子树 Proxy 的 kind 是对象，判否 */
export function isVarHandle(value: unknown): value is VarHandle {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; key?: unknown };
  return (
    typeof candidate.kind === "string" &&
    VAR_KINDS.has(candidate.kind) &&
    typeof candidate.key === "string"
  );
}

/** 嵌套句柄树（`vars.player.gold` ⇒ handle{key: "player.gold"}） */
export interface VarTree {
  [prop: string]: VarTree | VarHandle;
}

/** 当前注册表（`expr` 标签读取；`defineVars` 绑定——每个故事源文件声明一次） */
export let currentRegistry: ReadonlyMap<string, VarKind> | null = null;

/** 构建期警告池（与 currentRegistry 同范式的模块态：一次导入 = 一个故事源；drain 后清零；装配层写入） */
export let warningSink: ExpressionWarning[] = [];

/**
 * 取走并清空构建期警告。stories-build 在源模块导入完成后调用一次进 BuildReport；
 * 连续两次调用，第二次必为空（drain 即清零）。
 */
export function drainExpressionWarnings(): readonly ExpressionWarning[] {
  const out = warningSink;
  warningSink = [];
  return out;
}

/**
 * 构建期轻类型校验警告（引擎 type-error 的构建期预告；不拦构建）。
 * 规则名与引擎 `runtime/expr/` 的类型规则一一对应（见 `ExpressionAuditor`）。
 */
export interface ExpressionWarning {
  /** 完整表达式文本（含 `{}` 包装） */
  readonly expression: string;
  readonly rule:
    | "arith-non-num"
    | "compare-non-num"
    | "equality-kind-mismatch"
    | "logical-non-bool"
    | "unary-not-non-bool"
    | "unary-minus-non-num"
    | "ternary-cond-non-bool"
    | "interpolation-inside-string"
    | "unclosed-string-literal";
  /** 人话说明（含引擎将抛的 type-error 语义与出错操作数） */
  readonly message: string;
}

function makeTree(
  prefix: string,
  handles: ReadonlyMap<string, VarHandle>,
): VarTree {
  return new Proxy({} as VarTree, {
    get(_target, prop): VarTree | VarHandle {
      if (typeof prop !== "string" || prop === "then") {
        throw new Error(
          `变量句柄路径非法：${String(prop)}（前缀 ${prefix || "(根)"}）`,
        );
      }
      const key = prefix === "" ? prop : `${prefix}.${prop}`;
      const handle = handles.get(key);
      if (handle !== undefined) return handle;
      // 未注册路径：继续给子树 Proxy（链式展开），expr 求值时校验终值
      return makeTree(key, handles);
    },
  });
}

/**
 * 声明变量清单并绑定为本文件的 `expr` 上下文。
 * 每个故事源文件调用一次（重复调用 = 覆盖前一份注册表——源文件间的变量清单
 * 各自独立声明，不共享）。
 *
 * ```ts
 * const vars = defineVars({ "player.gold": "num", "player.name": "str" });
 * cond`${vars.player.gold} >= 25` // ⇒ "{player.gold >= 25}"
 * ```
 */
export function defineVars(spec: Record<string, VarKind>): VarTree {
  currentRegistry = new Map(Object.entries(spec));
  const handles = new Map<string, VarHandle>(
    Object.entries(spec).map(([key, kind]) => [key, { kind, key }]),
  );
  return makeTree("", handles);
}

/** 句柄对应的注册键（expr 内部用；未注册 ⇒ 抛错——拼写错误在构建期就红） */
export function varKeyOf(
  handle: VarHandle,
  registry: ReadonlyMap<string, VarKind>,
): string {
  if (!registry.has(handle.key)) {
    throw new Error(
      `未注册的变量：${handle.key}——请在 defineVars 清单中声明后再引用`,
    );
  }
  return handle.key;
}
