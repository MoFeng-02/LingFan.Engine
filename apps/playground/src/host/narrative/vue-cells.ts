/**
 * Vue 响应式单元到 shell 状态单元的适配：`ref` 结构上就是 Cell
 * （`{ value: T }`），Vue 侧零包装直传；此处只声明这一事实并给出类型证明。
 */
import { ref } from "vue";
import type { Cell, StateCells } from "@lingfan/shell";

/** Vue 形状的状态单元集：`cell` 即 `ref` */
export const vueCells: StateCells = {
  cell: <T>(initial: T): Cell<T> => ref(initial) as unknown as Cell<T>,
};
