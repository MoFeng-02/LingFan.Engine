/**
 * 通用取值判据：本包多个域（诊断、i18n、布局）都要对「这个值是不是一条记录」下判断。
 *
 * 为什么放在共享层：判据本身不含业务含义，任何层都可以引用；而它一旦分叉，
 * 分叉点就是静默的行为差异——同一棵树，两处判定不同就会出现「这边认、那边不认」。
 * 所以本包只有这一处实现，缺人少写一个 `!Array.isArray` 就是症状的来源。
 */

/**
 * 是否是**普通对象**（JSON 意义上的记录）：`null` 与数组都不算。
 *
 * 关键在最后那个 `!Array.isArray`：数组也是 `typeof === "object"`，
 * 少了它就会让数组通过「记录」校验，下游会拿下标当字段名继续走。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
