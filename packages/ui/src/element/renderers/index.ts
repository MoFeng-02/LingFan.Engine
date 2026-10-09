/**
 * 元素渲染器的对外出口：只暴露注册入口，渲染器与绑定实现留在目录内部
 * （渲染器签名与内部拆分方式都不构成对外契约）。
 */
export { registerBuiltinElementRenderers } from "./register";
