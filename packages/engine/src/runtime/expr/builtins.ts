/**
 * 内建函数：求值期可调用的函数全集。
 *
 * random 经注入的 rng 取值（rngState 进快照保确定性）；
 * arrayGet/dictGet/optGet/len 走注入的 resolve 读路径数据，路径缺失一律返回 null
 * （配合 `??` 兜底），路径存在但形态不符仍 fail-closed；未知函数 fail-closed。
 */
import { ExpressionError, type ExprValue } from "./value.ts";
import type { NameResolver } from "../resolver.ts";

/** 内建函数全集：random/min/max/abs/clamp（算术）+ arrayGet/dictGet/optGet/len（路径读取） */
export function callBuiltin(
  name: string,
  args: ExprValue[],
  rng: () => number,
  resolve: NameResolver,
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
  /** 路径型内建共用的首参校验 + 解析：路径缺失返回 null（由各内建自行决定后续形态校验） */
  const resolvePath = (): { value: ExprValue } | null => {
    if (args.length < 1 || typeof args[0] !== "string") {
      throw new ExpressionError("type-error", `${name} 首参必须是路径字符串`);
    }
    const hit = resolve(args[0]);
    return hit.found ? { value: hit.value as ExprValue } : null;
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
    case "optGet": {
      if (args.length !== 1) {
        throw new ExpressionError(
          "arity-error",
          `optGet 需要 1 个参数，收到 ${args.length}`,
        );
      }
      const hit = resolvePath();
      return hit === null ? null : hit.value;
    }
    case "arrayGet": {
      if (args.length !== 2) {
        throw new ExpressionError(
          "arity-error",
          `arrayGet 需要 2 个参数，收到 ${args.length}`,
        );
      }
      const hit = resolvePath();
      if (hit === null) return null;
      if (!Array.isArray(hit.value)) {
        throw new ExpressionError("type-error", "arrayGet 路径必须是数组");
      }
      const index = args[1]!;
      if (typeof index !== "number" || !Number.isInteger(index)) {
        throw new ExpressionError("type-error", "arrayGet 下标必须为整数");
      }
      return index >= 0 && index < hit.value.length ? hit.value[index] : null; // 越界与缺失同义
    }
    case "dictGet": {
      if (args.length !== 2) {
        throw new ExpressionError(
          "arity-error",
          `dictGet 需要 2 个参数，收到 ${args.length}`,
        );
      }
      const hit = resolvePath();
      if (hit === null) return null;
      if (
        typeof hit.value !== "object" ||
        hit.value === null ||
        Array.isArray(hit.value)
      ) {
        throw new ExpressionError("type-error", "dictGet 路径必须是字典");
      }
      const key = args[1]!;
      if (typeof key !== "string") {
        throw new ExpressionError("type-error", "dictGet 键必须为字符串");
      }
      return key in hit.value ? hit.value[key] : null;
    }
    case "len": {
      if (args.length !== 1) {
        throw new ExpressionError(
          "arity-error",
          `len 需要 1 个参数，收到 ${args.length}`,
        );
      }
      const hit = resolvePath();
      if (hit === null) return null;
      if (typeof hit.value === "string") return hit.value.length;
      if (Array.isArray(hit.value)) return hit.value.length;
      throw new ExpressionError("type-error", "len 路径必须是字符串或数组");
    }
    default:
      throw new ExpressionError(
        "unknown-function",
        `未知函数：${name}（可用：random/min/max/abs/clamp/arrayGet/dictGet/optGet/len）`,
      );
  }
}
