/**
 * Script 词汇层 · **具名实现槽位**（cell —— build-time 声明词）。
 *
 * cell 声明的实现由构建期扫描收集进生成注册物（`Stories.src/gen/fun_register.g.ts`）：
 * 故事 JSON 只留名字引用（guard 的 `fn` 字段），实现住生成模块——
 * 「名字在数据、实现在代码、build 做名字闭合」（设计稿 2026-10-06-函数注册构建期提取）。
 *
 * ⚠️ cell 是 **build-time 声明词**：运行期（模块被导入时，如测试/类型检查）必须纯——
 * 只返回句柄、零副作用；实现文本由构建期 AST 提取，不经过本函数。
 */
import type { GuardFn } from "@lingfan/engine";

/** 具名实现句柄：消费方（guard 等）按 face 取名字；face v1 恒 `guards` */
export interface CellHandle<N extends string = string> {
  readonly face: "guards";
  readonly name: N;
}

/**
 * 守卫名注册表（类型扩充点）：生成物尾部 `declare module "@lingfan/editor"`
 * 往本接口塞进每个已声明守卫名的字面量键 ⇒ `guard("…")` 的名字参数获得
 * 补全与写错即红（vue-router typed-routes 同机制）。
 * 🔴 空表 = `KnownGuardName` 退化为普通 string——不空注册表吓跑作者。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 类型扩充点：只有接口可被生成物 declare module 合并（type 别名不能），空体是有意形态
export interface GuardNameRegistry {}

/** 已声明守卫名（有声明 = 字面量联合；空 = string） */
export type KnownGuardName = keyof GuardNameRegistry extends never
  ? string
  : keyof GuardNameRegistry & string;

export function cell<const N extends string>(
  name: N,
  impl: GuardFn,
): CellHandle<N> {
  void impl;
  return { face: "guards", name };
}
