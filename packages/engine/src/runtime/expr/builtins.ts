/**
 * 内建函数：求值期可调用的函数全集。
 *
 * random 经注入的 rng 取值（rngState 进快照保确定性）；未知函数 fail-closed。
 */
import { ExpressionError, type ExprValue } from "./value";

/** 内置函数全集：random（含端点）/ min / max / abs / clamp；random 经注入的 rng 取值（rngState 进快照保确定性） */
export function callBuiltin(
  name: string,
  args: ExprValue[],
  rng: () => number,
): ExprValue {
  const numbers = (n: number): number[] => {
    if (args.length !== n) {
      throw new ExpressionError(
        "arity-error",
        `${name} 需要 ${n} 个参数，收到 ${args.length}`,
      );
    }
    return args.map((a) => {
      if (typeof a !== "number") {
        throw new ExpressionError("type-error", `${name} 参数必须为 number`);
      }
      return a;
    });
  };
  switch (name) {
    case "random": {
      const [lo, hi] = numbers(2);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        throw new ExpressionError("type-error", "random 参数必须为整数");
      }
      if (lo > hi)
        throw new ExpressionError("invalid-range", "random 下界必须 ≤ 上界");
      return lo + Math.floor(rng() * (hi - lo + 1)); // 含端点
    }
    case "min": {
      const [a, b] = numbers(2);
      return Math.min(a, b);
    }
    case "max": {
      const [a, b] = numbers(2);
      return Math.max(a, b);
    }
    case "abs": {
      const [a] = numbers(1);
      return Math.abs(a);
    }
    case "clamp": {
      const [v, lo, hi] = numbers(3);
      return Math.min(Math.max(v, lo), hi);
    }
    default:
      throw new ExpressionError(
        "unknown-function",
        `未知函数：${name}（可用：random/min/max/abs/clamp）`,
      );
  }
}
