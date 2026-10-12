/**
 * 标准全局白名单（字面量内允许直接引用；刻意最小——需要更多就走 import）。
 * 16 项逐字固定；调用方要放开别的名字，经 `scanCells` 的 `globalWhitelist` 注入。
 */
export const DEFAULT_GLOBAL_WHITELIST: ReadonlySet<string> = new Set([
  "JSON",
  "Math",
  "String",
  "Number",
  "Boolean",
  "Object",
  "Array",
  "Date",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "Infinity",
  "NaN",
  "undefined",
  "console",
]);
