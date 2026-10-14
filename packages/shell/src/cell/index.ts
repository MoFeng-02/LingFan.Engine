/**
 * 响应式最小接口（Cell）：宿主跨层传递可变值与只读值的最小形状。
 *
 * 宿主编排层不绑定任何响应式框架——它需要的只是「一个带 `value` 的盒子」。
 * 任意框架的响应式单元（Vue 的 `ref`、Solid 的 signal 包装等）或一个普通的
 * `{ value: T }` 对象都满足此形状，可直接赋给 `Cell`/`ReadonlyCell`，零包装。
 */

/** 可变值盒子：持有方写 `value`，消费方读 `value` */
export interface Cell<T> {
  value: T;
}

/** 只读值盒子：持有方维护，消费方只读 */
export interface ReadonlyCell<T> {
  readonly value: T;
}
