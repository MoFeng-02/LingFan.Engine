/**
 * 双向锁的类型级断言工具。
 *
 * 不用严格 Equal：仓库未开 exactOptionalPropertyTypes，zod `.optional()` 的
 * 输出带 `| undefined` 而手写 interface 可选字段不带，Equal 会对结构等价的
 * 负载面误报。改用「双向可赋值 + 键集相等 + @ts-expect-error 锚」共同锁漂：
 * 可赋值对单侧多余字段不敏感，故键集断言（SameKeys）不可省。
 */

/** A 可赋给 B（元组包裹防联合分发） */
export type Assignable<A, B> = [A] extends [B] ? true : never;

/** A 与 B 的键集互相相等（传入 keyof 结果） */
export type SameKeys<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
