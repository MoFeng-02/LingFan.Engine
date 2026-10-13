/**
 * 形态 B（define 累积）合并器：把求值期按书写序收集的 define 调用合并为一棵
 * 纯嵌套树，供 state 降维段与 config.state（形态 A）走同一条 flattenRoot 通道。
 *
 * 合并文法（界面规范 对应章节 形态 B 定稿）：
 * - 点路径切段折叠；空段拒（"a..b"、".a"、"a." 一律 fail-closed）；
 * - 同键二次定义 fail-closed（不后写覆盖）；叶值与分支对象两向同键都算形状冲突；
 * - 对象实参子树递归合并（同分支不同叶合法）；
 * - 对象字面量里的点键不在此拦——留给降维段的统一 dotKeyError 守卫（对应章节.3/对应章节.6）；
 * - 数组值是叶子（裸数组拒绝发生在降维段：请用 descriptor）；
 * - 冲突一次报全部（fail-closed，求值毕统一结算）。
 *
 * 多源汇入（mergeDefineCallsInto）：config.ts 的 define 树作为底树，模块层
 * define 带 `文件:行:列` 落点汇入；冲突文案区分单位置（仅本次来源）与两处位置
 * （既有来源 与 本次来源），全部路径的来源表随插入增量登记。
 */
import type { DefineCall } from "./const-eval";

export interface DefineMergeResult {
  /** 合并后的纯嵌套树（只含 define 贡献；无调用 = 空对象） */
  readonly tree: Record<string, unknown>;
  /** 冲突清单（逐条可读；非空 = fail-closed） */
  readonly conflicts: readonly string[];
}

/** 带落点的 define 调用（模块层收集器产物；与 LocatedDefineCall 结构兼容） */
export interface OriginatedDefineCall {
  readonly call: DefineCall;
  readonly origin: string;
}

/** 跨文件来源登记：路径 → `文件:行:列`（config 段恒为 "config.ts"） */
interface MergeContext {
  readonly origins: Map<string, string>;
  readonly origin: string;
}

const CONFIG_ORIGIN = "config.ts";

export function mergeDefineCalls(
  calls: readonly DefineCall[],
): DefineMergeResult {
  const tree: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const call of calls) {
    if (call.kind === "path") {
      insertSegments(
        tree,
        call.path.split("."),
        call.value,
        call.path,
        conflicts,
      );
    } else {
      mergeInto(tree, call.spec, [], conflicts);
    }
  }
  return { tree, conflicts };
}

/**
 * 把带落点的模块层 define 调用汇入既有合并树（就地变异）。
 * 返回冲突清单（非空 = fail-closed，编排层一次报全部）。
 */
export function mergeDefineCallsInto(
  tree: Record<string, unknown>,
  calls: readonly OriginatedDefineCall[],
): readonly string[] {
  const conflicts: string[] = [];
  const origins = new Map<string, string>();
  seedOrigins(tree, [], origins);
  for (const item of calls) {
    const ctx: MergeContext = { origins, origin: item.origin };
    if (item.call.kind === "path") {
      insertSegments(
        tree,
        item.call.path.split("."),
        item.call.value,
        item.call.path,
        conflicts,
        ctx,
      );
    } else {
      mergeInto(tree, item.call.spec, [], conflicts, ctx);
    }
    seedOrigins(tree, [], origins);
  }
  return conflicts;
}

/** 全树路径登记来源（先见保留：config 底树先登记，新增路径归本次调用） */
function seedOrigins(
  tree: Record<string, unknown>,
  prefix: readonly string[],
  origins: Map<string, string>,
): void {
  for (const [key, value] of Object.entries(tree)) {
    const path = [...prefix, key].join(".");
    if (!origins.has(path)) origins.set(path, CONFIG_ORIGIN);
    if (isBranch(value)) seedOrigins(value, [...prefix, key], origins);
  }
}

function unitSuffix(ctx: MergeContext | undefined): string {
  return ctx === undefined ? "" : `（${ctx.origin}）`;
}

function pairSuffix(path: string, ctx: MergeContext | undefined): string {
  if (ctx === undefined) return "";
  const existing = ctx.origins.get(path);
  return existing === undefined ? `（${ctx.origin}）` : `——${existing} 与 ${ctx.origin}`;
}

/** 把 `value` 按段序列插入树：中途遇叶子 = 叶↔分支冲突；终点同键 = 二次定义冲突。 */
function insertSegments(
  tree: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
  displayPath: string,
  conflicts: string[],
  ctx?: MergeContext,
): void {
  if (segments.some((segment) => segment === "")) {
    conflicts.push(
      `define("${displayPath}")：点路径含空段（"a..b"、".a"、"a." 形态不支持）${unitSuffix(ctx)}`,
    );
    return;
  }
  let current: Record<string, unknown> = tree;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = current[segment];
    if (existing === undefined) {
      const next: Record<string, unknown> = {};
      current[segment] = next;
      current = next;
    } else if (isBranch(existing)) {
      current = existing;
    } else {
      const path = segments.slice(0, i + 1).join(".");
      conflicts.push(
        `defines["${path}"]：键已是叶子值，不能再作为分支下钻（define("${displayPath}")）${pairSuffix(path, ctx)}`,
      );
      return;
    }
  }
  const leaf = segments[segments.length - 1]!;
  const existing = current[leaf];
  if (existing !== undefined) {
    if (isBranch(existing) && isBranch(value)) {
      mergeInto(existing, value, segments.slice(0, -1), conflicts, ctx);
      return;
    }
    const path = segments.join(".");
    conflicts.push(
      `defines["${path}"]：同键二次定义（fail-closed，不后写覆盖）${pairSuffix(path, ctx)}`,
    );
    return;
  }
  current[leaf] = value;
}

/** 对象实参子树合并：同分支不同叶合法；同叶/形状冲突按叶路径报。 */
function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  segments: readonly string[],
  conflicts: string[],
  ctx?: MergeContext,
): void {
  for (const key of Object.keys(source)) {
    const incoming = source[key];
    const existing = target[key];
    const path = [...segments, key].join(".");
    if (existing === undefined) {
      target[key] = incoming;
    } else if (isBranch(existing) && isBranch(incoming)) {
      mergeInto(existing, incoming, [...segments, key], conflicts, ctx);
    } else if (isBranch(existing) || isBranch(incoming)) {
      conflicts.push(
        `defines["${path}"]：形状冲突——叶值与分支对象不能同键（fail-closed）${pairSuffix(path, ctx)}`,
      );
    } else {
      conflicts.push(
        `defines["${path}"]：同键二次定义（fail-closed，不后写覆盖）${pairSuffix(path, ctx)}`,
      );
    }
  }
}

function isBranch(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
