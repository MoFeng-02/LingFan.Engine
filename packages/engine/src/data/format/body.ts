/** 块体校验：必填缺失即报（if 无 then → 报错），成员递归校验 */
import { validateCommand } from "./validate";

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
