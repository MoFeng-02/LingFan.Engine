/**
 * 校验期的小工具：非空字符串判定。
 * 结构形状判定（isPlainObject）是数据层共用的单一判定点，落在 shared/，此处不另写一份。
 */
export function requireNonEmptyString(v: unknown, at: string, issues: string[]): void {
  if (typeof v !== "string" || v === "") issues.push(`${at} 必须为非空字符串`);
}
