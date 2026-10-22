/**
 * 叙事视图状态（本宿主类型面）：字段表从 `@lingfan-engine/shell` 的叙事状态域**派生**，
 * 本文件只声明「单元 → Vue 单元」这一步映射——Vue 的 `ref`/`computed` 结构上就是
 * Cell（`{ value: T }`），模板解包与类型检查按 Vue 语义走。
 */
import type { ComputedRef, Ref } from "vue";
import type { MenuChoice, NarrativeState } from "@lingfan-engine/shell";

/** 单元 → Vue 单元：带 `value` 的盒子映射成 `Ref`，方法原样保留 */
type VueUnit<T> = T extends { value: infer V } ? Ref<V> : T;

/**
 * Vue 形状的叙事视图状态：字段名与读写关系都取自 shell 的 `NarrativeState`，
 * 只在单元类型上换成 Vue 语义。
 *
 * `menuOptions` 单独点明为 `ComputedRef`：`Cell<T>` 与 `ReadonlyCell<T>` 结构同形，
 * 条件类型分不出只读，而它是域出口里唯一的只读单元（运行期由 `computed` 产出）。
 */
export type VueNarrativeState = Omit<
  { [K in keyof NarrativeState]: VueUnit<NarrativeState[K]> },
  "menuOptions"
> & {
  readonly menuOptions: ComputedRef<MenuChoice[]>;
};
