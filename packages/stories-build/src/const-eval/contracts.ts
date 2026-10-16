/**
 * const-eval 域共享契约：JSON 可序列化值、求值两态结果、define 调用与非法调用记录。
 * 独立成文件是为了让入口 `./const-eval.ts` 与 worker 轮次 `./round/` 引用同一份声明，
 * 又不产生「入口 ↔ 轮次」相互 import（环判据白名单为空）。
 */
import type { CompilerDiagnostic } from "../compiler/index.ts";

/** JSON 可序列化值（求值产物的唯一合法形态）。 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 求值结果：要么拿到全部导出常量的可序列化值，要么拿到一组诊断（fail-closed）。 */
export type ConstEvalResult =
  | { values: Record<string, JsonValue>; defineCalls: readonly DefineCall[] }
  | { diags: CompilerDiagnostic[] };

/**
 * define() 构建期内建的调用记录（形态 B 累积；书写序即合并序）：
 * - `path`：`define("a.b", value)` 点路径单值声明；
 * - `spec`：`define({...})` 对象字面量子树声明。
 * 值在 worker 内已过 classify（JSON 安全）；非法值不进此表（走 defineBad 诊断）。
 */
export type DefineCall =
  | { kind: "path"; path: string; value: JsonValue }
  | { kind: "spec"; spec: Record<string, JsonValue> };

/** define() 非法调用的记录（求值段把每条翻成诊断，统一挂入口 1:1）。 */
export interface DefineBad {
  readonly path: string;
  readonly reason: string;
}
