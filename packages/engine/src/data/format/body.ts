/** 块体校验：必填缺失即报（if 无 then → 报错），成员递归校验 */
import { validateCommand } from "./validate";

/**
 * 校验块字段（`if` 的 `then`、`while` 的 `body` 等）并逐条递归校验其中命令。
 *
 * 输入：`v` 待校验的块字段、`at` 定位前缀、`issues` 收集器、`required` 该块字段是否必填。
 * 产出：无返回值，问题通过 `issues` 交付。
 * 失败表现：不抛异常。`required` 为真且字段缺失时记一条「必填」；
 * 字段存在但不是数组时记一条「必须为数组」并停止递归；元素依次按 `${at}[i]` 定位校验。
 */
export function validateBody(
  v: unknown,
  at: string,
  issues: string[],
  required: boolean,
): void {
  if (v === undefined) {
    if (required) issues.push(`${at} 必填（块字段缺失）`);
    return;
  }
  if (!Array.isArray(v)) {
    issues.push(`${at} 必须为数组`);
    return;
  }
  for (const [i, item] of v.entries())
    validateCommand(item, `${at}[${i}]`, issues);
}
