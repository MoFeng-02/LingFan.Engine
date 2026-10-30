/**
 * 原生形态挂载域出口（唯一出口）：组合根只从这里取渲染器与表形状。
 *
 * 与 `packages/ui` 的 mount 域分工：那边是框架无关的投影与差量（三形态共用），
 * 这边是「原生 DOM 怎么落」——一个渲染器、一份工厂表契约。
 * 框架叠加层不 import 本目录：它们的渲染交给各自的响应式系统。
 */
export {
  createNativeMountRenderer,
  type NativeMountRenderer,
  type NativeMountRendererOptions,
} from "./renderer";
export {
  resolveNativeFactory,
  type NativeUiFactory,
  type NativeUiInstance,
  type NativeUiTable,
} from "./table";
