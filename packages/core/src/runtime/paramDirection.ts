/**
 * 参数方向查表：`PARAM_DIRECTION` 的取值实现。
 *
 * **为什么实现在 runtime 而不是 contracts**：契约层只放类型与数据，出现函数关键字即违约
 * （由 `tests/engine/runtime/scene-type.test.ts` 的「契约层只声明类型」判据锁住）。
 * 表本身仍是声明（`contracts/param-direction.ts`），本文件只负责查。
 */
import {
  PARAM_DIRECTION,
  type ParamDirection,
} from "../contracts/param-direction.ts";

/**
 * 查某键的方向档位：精确键优先，其次最长前缀匹配，都不命中 = `readonly`。
 *
 * 最长前缀而非首个命中：`game.` 与 `game.walk.` 同时存在时后者应赢，
 * 否则细分命名空间无法覆盖粗粒度默认。
 *
 * 缺省 `readonly` 是 fail-closed：新键默认不给写权限，要开放必须显式登记。
 */
export function directionOf(key: string): ParamDirection {
  const exact = PARAM_DIRECTION[key];
  if (exact !== undefined) return exact;
  let best: ParamDirection | undefined;
  let bestLength = 0;
  for (const [pattern, direction] of Object.entries(PARAM_DIRECTION)) {
    if (!pattern.endsWith(".")) continue; // 精确键已在上面查过
    if (!key.startsWith(pattern)) continue;
    if (pattern.length > bestLength) {
      best = direction;
      bestLength = pattern.length;
    }
  }
  return best ?? "readonly";
}
