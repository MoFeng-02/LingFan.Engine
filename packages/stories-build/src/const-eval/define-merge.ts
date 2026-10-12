/**
 * 形态 B（define 累积）合并器：把求值期按书写序收集的 define 调用合并为一棵
 * 纯嵌套树，供 state 降维段与 config.state（形态 A）走同一条 flattenRoot 通道。
 *
 * 合并文法（设计稿 §二 形态 B 定稿）：
 * - 点路径切段折叠；空段拒（"a..b"、".a"、"a." 一律 fail-closed）；
 * - 同键二次定义 fail-closed（不后写覆盖）；叶值与分支对象两向同键都算形状冲突；
 * - 对象实参子树递归合并（同分支不同叶合法）；
 * - 对象字面量里的点键不在此拦——留给降维段的统一 dotKeyError 守卫（§二.3/§二.6）；
 * - 数组值是叶子（裸数组拒绝发生在降维段：请用 descriptor）；
 * - 冲突一次报全部（fail-closed，求值毕统一结算）。
 */
import type { DefineCall } from "./const-eval";

export interface DefineMergeResult {
  /** 合并后的纯嵌套树（只含 define 贡献；无调用 = 空对象） */
  readonly tree: Record<string, unknown>;
  /** 冲突清单（逐条可读；非空 = fail-closed） */
  readonly conflicts: readonly string[];
}

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

/** 把 `value` 按段序列插入树：中途遇叶子 = 叶↔分支冲突；终点同键 = 二次定义冲突。 */
function insertSegments(
  tree: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
  displayPath: string,
  conflicts: string[],
): void {
  if (segments.some((segment) => segment === "")) {
    conflicts.push(
      `define("${displayPath}")：点路径含空段（"a..b"、".a"、"a." 形态不支持）`,
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
      conflicts.push(
        `defines["${segments.slice(0, i + 1).join(".")}"]：键已是叶子值，不能再作为分支下钻（define("${displayPath}")）`,
      );
      return;
    }
  }
  const leaf = segments[segments.length - 1]!;
  const existing = current[leaf];
  if (existing !== undefined) {
    if (isBranch(existing) && isBranch(value)) {
      mergeInto(existing, value, segments.slice(0, -1), conflicts);
      return;
    }
    conflicts.push(
      `defines["${segments.join(".")}"]：同键二次定义（fail-closed，不后写覆盖）`,
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
): void {
  for (const key of Object.keys(source)) {
    const incoming = source[key];
    const existing = target[key];
    if (existing === undefined) {
      target[key] = incoming;
    } else if (isBranch(existing) && isBranch(incoming)) {
      mergeInto(existing, incoming, [...segments, key], conflicts);
    } else if (isBranch(existing) || isBranch(incoming)) {
      conflicts.push(
        `defines["${[...segments, key].join(".")}"]：形状冲突——叶值与分支对象不能同键（fail-closed）`,
      );
    } else {
      conflicts.push(
        `defines["${[...segments, key].join(".")}"]：同键二次定义（fail-closed，不后写覆盖）`,
      );
    }
  }
}

function isBranch(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
