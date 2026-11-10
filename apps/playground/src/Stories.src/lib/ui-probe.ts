/**
 * UI 句柄的类型面锚点：故事源里一行 import 就能拿到带类型的句柄。
 *
 * 本文件不导出故事（不是列），只为故事源的类型检查守住四件事：
 * - 句柄是真类型而不是 `any` 兜底——落到 `any` 时下面的断言红；
 * - 句柄的形状就是 `{ face, name }` 两字段、同字面量——生成物里的句柄换形也红；
 * - `face` 是字面量 `"uis"` 而不是宽 `string`：句柄折叠前仍带身份标记；
 * - UI 名收窄生效——生成物把名字合进 `UiNameRegistry`，未登记的名字在类型期被拒。
 *
 * 句柄从**生成物的具名导出**取（`import type { hub } from "../../gen/ui_register.g"`），
 * 不从 `*.vue` 默认导入取：组件编译器（vue-tsc、IDE 的 Vue 语言服务）会把 `*.vue`
 * 解析成真实组件类型，顶掉 authoring 声明的 `UiHandle` 通配，`mount(句柄)`
 * 于是被判成型不匹配。生成物里的句柄是纯类型声明，谁编译都认它是句柄。
 *
 * 这里用 `import type`：本文件只做类型面断言，不需要运行期绑定；类型导入也不会
 * 被构建期当成 UI 导入登记，不会往任何列的 `uis` 声明里塞条目。
 *
 * `*.vue` 默认导入那条路（authoring 的 ambient 通配）由
 * `tests/stories-build/playground-anchor.test.ts` 的 vue-tsc 探针守住。
 *
 * 模块层不写取值语句：模块层 const 必须是可折叠标量，属性访问不参与折叠，
 * 所以类型面只用类型断言表达；需要写调用表达式的负例放进函数体。
 */
import { type KnownUiName, type UiHandle, mount } from "@lingfan-engine/editor";
import type { hub } from "../../gen/ui_register.g";

/** 两类型互相可赋才算相等——`any` 与任何类型都单向可赋，单向比较会漏掉 `any`。 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** 约束失败的唯一后果是 `true` 之外的实参 ⇒ 编译期报错。 */
type AssertTrue<T extends true> = T;

/** `0 extends 1 & T` 只有 `T` 是 `any` 时为真：区分 `any` 与真正类型的判据。 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** 句柄不是 `any`。 */
export type UiHandleIsTyped = AssertTrue<Same<IsAny<typeof hub>, false>>;

/** 句柄形状就是 `{ face, name }` 两字段、同字面量——生成物里的句柄换形也红。 */
export type UiHandleShape = AssertTrue<
  Same<typeof hub, { readonly face: "uis"; readonly name: "hub" }>
>;

/** 句柄类型就是词汇层的 `UiHandle`：生成物导出的必须是那个类型，不是别的形状。 */
export type UiHandleMatchesVocabulary = AssertTrue<
  Same<typeof hub, UiHandle<"hub">>
>;

/** `face` 是字面量 `"uis"` 而不是宽 `string`：句柄折叠前仍带身份标记。 */
export type UiHandleFace = AssertTrue<Same<typeof hub.face, "uis">>;

/** 句柄名当字符串用：折叠时按名字取值，宽 `string` 与字面量都成立。 */
export type UiHandleAsName = AssertTrue<
  Same<typeof hub.name extends string ? true : false, true>
>;

/** 名字是生成物登记过的那个字面量：写错名字在类型期就红。 */
export type UiHandleNameIsRegistered = AssertTrue<Same<typeof hub.name, "hub">>;

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
