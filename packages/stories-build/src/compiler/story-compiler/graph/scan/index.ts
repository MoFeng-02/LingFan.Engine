/**
 * 模块扫描族出口：读 TS 源、解析 import、收集常量与绑定声明。
 *
 * 轴 = 读源三部——扫描声明（`module-scan.ts`）、解析 import（`imports.ts`）、
 * 收集常量与绑定（`bindings.ts`）。这一族只产出记录，不建图。
 *
 * 组件导入（`ui` / `scenes`）与模块导入分开：组件文件不进模块图，其说明符由
 * 组件通道单独判定并落账。
 */
export { assertNpmNamesConstOnly, scanConstStatement } from "./bindings.ts";
export { resolveImports } from "./imports.ts";
export { scanModule } from "./module-scan.ts";
export { resolveSceneImports } from "./scene-import.ts";
export { resolveUiImports } from "./ui-import.ts";
