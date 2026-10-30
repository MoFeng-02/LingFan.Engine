/**
 * UI 句柄的类型面锚点：故事源里一行 import 就能拿到带类型的句柄。
 *
 * 本文件不导出故事（不是列），只为 `stories-typecheck` 守住四件事：
 * - `*.vue` 通配模块声明生效——否则这条 import 就是 TS2307；
 * - 句柄是真类型而不是 `any` 兜底——落到 `any` 时下面的断言红；
 * - 句柄的形状就是 `{ face, name }`——改掉 ambient 声明的形状也红；
 * - UI 名收窄生效——生成物把名字合进 `UiNameRegistry`，未登记的名字在类型期被拒。
 *
 * 模块层不写取值语句：模块层 const 必须是可折叠标量，属性访问不参与折叠，
 * 所以类型面只用类型断言表达；需要写调用表达式的负例放进函数体。
 *
 * 这里不 import 生成物里的具名句柄：源树内的文件其顶层 import 会被 cell 扫描按
 * 「能搬进生成物」判定，生成物在源根之外必然报越界。生成物自身的形状由
 * `tests/stories-build/ui-register.test.ts` 逐字锚定，收窄由下面的断言锚定。
 */
import { type KnownUiName, mount } from "@lingfan-engine/editor";
import hub from "../../ui/hub/hub.vue";

/** 两类型互相可赋才算相等——`any` 与任何类型都单向可赋，单向比较会漏掉 `any`。 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** 约束失败的唯一后果是 `true` 之外的实参 ⇒ 编译期报错。 */
type AssertTrue<T extends true> = T;

/** `0 extends 1 & T` 只有 `T` 是 `any` 时为真：区分 `any` 与真正类型的判据。 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** 句柄不是 `any`。 */
export type UiHandleIsTyped = AssertTrue<Same<IsAny<typeof hub>, false>>;

/** 句柄形状与词汇层的 `UiHandle` 一致（两字段、同字面量）。 */
export type UiHandleShape = AssertTrue<
  Same<typeof hub, { readonly face: "uis"; readonly name: string }>
>;

/** `face` 是字面量 `"uis"` 而不是宽 `string`：句柄折叠前仍带身份标记。 */
export type UiHandleFace = AssertTrue<Same<typeof hub.face, "uis">>;

/**
 * 两条句柄路折叠出同一个名字：`*.vue` 导入的句柄与生成物具名句柄都是
 * `{ face: "uis", name }`，而 `mount` 只读 `name`——所以这里断言「句柄当名字用」
 * 与「直接写字面量」在类型上不可区分。
 */
export type UiHandleAsName = AssertTrue<Same<typeof hub.name, string>>;

/** 名字收窄生效：生成物登记过的名字才是 `KnownUiName` 的成员。 */
export type RegisteredUiName = AssertTrue<Same<KnownUiName, "hub">>;

/**
 * 未登记的名字在类型期被拒——`@ts-expect-error` 停止报错即失效。
 *
 * 放函数体而不是模块层：模块层只允许可折叠的 const，调用表达式在这里不成立。
 */
export function uiNameNarrowingProbe(): void {
  mount("hub", true);
  // @ts-expect-error 未登记的 UI 名不在 KnownUiName 里
  mount("未登记的界面", true);
}
