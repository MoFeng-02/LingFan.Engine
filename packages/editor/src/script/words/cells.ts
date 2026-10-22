/**
 * Script 词汇层 · **具名实现槽位**（cell —— build-time 声明词）。
 *
 * cell 声明的实现由构建期扫描收集进生成注册物（`Stories.src/gen/fun_register.g.ts`）：
 * 故事 JSON 只留名字引用（guard 的 `fn` 字段），实现住生成模块——
 * 「名字在数据、实现在代码、build 做名字闭合」。
 *
 * cell 是 **build-time 声明词**：运行期（模块被导入时，如测试/类型检查）必须纯——
 * 只返回句柄、零副作用；实现文本由构建期 AST 提取，不经过本函数。
 */
import type { GuardFn } from "@lingfan-engine/core";

/** 具名实现句柄：消费方（guard 等）按 face 取名字；face v1 恒 `guards` */
export interface CellHandle<N extends string = string> {
  readonly face: "guards";
  readonly name: N;
}

/**
 * 守卫名注册表（类型扩充点）：生成物尾部 `declare module "@lingfan-engine/editor"`
 * 往本接口塞进每个已声明守卫名的字面量键 ⇒ `guard("…")` 的名字参数获得
 * 补全与写错即红（vue-router typed-routes 同机制）。
 * 空表 = `KnownGuardName` 退化为普通 string——不空注册表吓跑作者。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 类型扩充点：只有接口可被生成物 declare module 合并（type 别名不能），空体是有意形态
export interface GuardNameRegistry {}

/** 已声明守卫名（有声明 = 字面量联合；空 = string） */
export type KnownGuardName = keyof GuardNameRegistry extends never
  ? string
  : keyof GuardNameRegistry & string;

/**
 * 列名注册表（类型扩充点）：构建期生成的 `Stories.src/gen/stories.gen.d.ts`
 * 往本接口塞进工程内每个列 id 的字面量键 ⇒ `jump("…")` 与 `option("…", "…")`
 * 的目标列名获得补全、写错即红。空表退化为普通 string。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 类型扩充点：只有接口可被生成物 declare module 合并（type 别名不能），空体是有意形态
export interface ColumnNameRegistry {}

/** 已声明列名（有声明 = 字面量联合；空 = string） */
export type KnownColumnName = keyof ColumnNameRegistry extends never
  ? string
  : keyof ColumnNameRegistry & string;

/**
 * 插值键注册表（类型扩充点）：生成物塞进工程内所有能当 `{…}` 键的名字——
 * state schema 展平键、defineVars 登记变量、产物 op 流里的声明名，
 * 以及扩展命名空间前缀（生成物写成 `ext.<id>.${string}` 的字面量类型）。
 * 空表退化为普通 string；富文本行内标记由词汇层的模板串类型单独豁免。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 类型扩充点：只有接口可被生成物 declare module 合并（type 别名不能），空体是有意形态
export interface InterpolationKeyRegistry {}

/** 已声明插值键（有声明 = 字面量联合；空 = string） */
export type KnownInterpolationKey = keyof InterpolationKeyRegistry extends never
  ? string
  : keyof InterpolationKeyRegistry & string;

/**
 * 声明一个守卫实现槽位：构建期扫描收集 `impl` 生成注册物，故事数据里
 * 只留名字（{@link guard} 的 fn 字段）。运行期是纯声明——不执行 impl。
 * 返回的句柄可直接传给 {@link guard}，名字只写一次。
 *
 * @param name 守卫名（进故事 JSON 与生成注册物）。
 * @param impl 守卫实现纯函数（构建期 AST 提取，不在运行期调用）。
 * @returns 实现句柄（传给 {@link guard} 引用）。
 * @example
 * export const checkMoney = cell("checkMoney", (ctx, args) => true);
 * guard(checkMoney, { args: { cost: 50 } });
 */
export function cell<const N extends string>(
  name: N,
  impl: GuardFn,
): CellHandle<N> {
  void impl;
  return { face: "guards", name };
}
