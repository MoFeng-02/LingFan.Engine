/**
 * 视图层：组件与样式（只认契约，不认平台）。
 *
 * 组件从这里取 `contracts` 声明的类型与注入键，不直接 import 平台适配器——
 * 换宿主或换运行形态时视图代码不动。样式与设计变量同属此层。
 *
 * 依赖方向：可用 `contracts` / `domain` / `shared`；不得依赖 `infra` / `app`。
 *
 * 组件位于 `src/components/`；本入口不导出成员，只声明层归属。
 */
export {};
