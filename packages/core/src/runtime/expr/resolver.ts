/** 名称解析接缝：表达式/插值通过它读取作用域与状态，求值器本身不接触执行器内部。 */
export interface NameResolver {
  (name: string): { found: true; value: unknown } | { found: false };
}
