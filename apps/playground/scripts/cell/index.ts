/**
 * cell 声明提取器出口（唯一出口）：把 `Stories.src/**` 树里的 `cell("name", impl)` 调用
 * 扫成生成注册物所需的实现文本与导入搬运集，`scripts/build/**` 只从这里取。
 *
 * 「名字在数据、实现在代码、build 做名字闭合」的提取半边。规则硬点：
 * - 实现三形态：箭头/函数字面量（原文落生成物）、标识符引用、成员访问引用；
 *   **调用表达式（参数固化）= L2，v1 显式不支持**；
 * - 字面量内自由标识符必须 ∈（所在文件导入绑定 ∪ 函数参数 ∪ 内部声明 ∪ 标准全局），
 *   引用模块级本地 const = fail-closed（**不做传递闭包**——规则简单才可靠）；
 * - 身份键 = (face, name)、指纹 = 实现文本 trim：**同键同纹去重、同键异纹冲突**
 *   （fail-closed 带两处定位，不隐式覆盖）；
 * - face v1 恒 `guards`；`cell` 只认裸标识符调用（house style 解构导入）；
 * - **导入搬运按生成物位置重写相对说明符**：生成物在 `Stories.src/gen/`（比源文件
 *   深一层），`"./x"`/`"../x"` 必须换算到同一目标——越出 `Stories.src` 根 fail-closed。
 */

/** cell 声明提取失败（带 `origin` 定位：`相对路径:行`）——由调用方决定是否中断构建 */
export { CellExtractError } from "./errors";
/** 单文件扫描：`cell(...)` 三类实现形态判定与逐条 fail-closed 文案 */
export { rootIdentifier, scanFile } from "./scan-file";
/** 全树扫描：去重、指纹冲突、导入搬运 */
export { scanCells } from "./scan-cells";
/** 生成物渲染（文本逐字节确定） */
export { renderFunRegister } from "./render-register";
/** 标准全局白名单（16 项），供调用方比对或拼接自己的白名单 */
export { DEFAULT_GLOBAL_WHITELIST } from "./whitelist";
/** 提取产出、问题与可配置项的形状 */
export type { CellIssue, CellScan, FileImports, ScanCellsOptions } from "./types";
