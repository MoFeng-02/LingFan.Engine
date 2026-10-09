/**
 * 命令负载结构校验的骨架：形状前置判定 + 按 op 族分发。
 * 各族的必填与类型判定都在 validate/ 下的族文件里，这里只负责路由。
 *
 * 未实现的 op 在族分片里没有 case，等于直接放行（结构从简）——
 * 这是有意的：执行器对未实现 op fail-closed，编辑期 schema 负责字段面。
 */
import { isPlainObject } from "../../shared";
import { validateDialogCommand } from "./validate/dialog";
import { validateFlowCommand } from "./validate/flow";
import { validateVariablesCommand } from "./validate/variables";
import { validateCollectionsCommand } from "./validate/collections";
import { validateSaveCommand } from "./validate/save";
import { validatePresentCommand } from "./validate/present";
import { validateBlocksCommand } from "./validate/blocks";

export function validateCommand(cmd: unknown, at: string, issues: string[]): void {
  if (!isPlainObject(cmd)) {
    issues.push(`${at} 必须为对象`);
    return;
  }
  if (typeof cmd.op !== "string" || cmd.op === "") {
    issues.push(`${at} 必须为含非空 op 字符串的命令对象`);
    return;
  }
  validateDialogCommand(cmd, at, issues);
  validateFlowCommand(cmd, at, issues);
  validateVariablesCommand(cmd, at, issues);
  validateCollectionsCommand(cmd, at, issues);
  validateSaveCommand(cmd, at, issues);
  validatePresentCommand(cmd, at, issues);
  validateBlocksCommand(cmd, at, issues);
}
