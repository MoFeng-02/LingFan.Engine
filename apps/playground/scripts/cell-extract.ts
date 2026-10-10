/**
 * cell 声明提取器的字面路径出口：实现已按职责拆到 `./cell`（唯一出口），
 * 本文件只把原有的公共面转发出去，供构建流水线与测试按原路径取用。
 *
 * 「名字在数据、实现在代码、build 做名字闭合」的提取半边：从 `Stories.src/**` 树收集
 * `cell("name", impl)` 调用，产出生成注册物（`fun_register.g.ts`）所需的实现文本、
 * 导入搬运集与冲突/违规判定。规则硬点见 `./cell` 的目录说明。
 */
export {
  CellExtractError,
  renderFunRegister,
  scanCells,
  type CellIssue,
  type CellScan,
} from "./cell";
