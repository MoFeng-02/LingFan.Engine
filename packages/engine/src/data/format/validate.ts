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

/**
 * 校验单条命令的负载结构，把问题记进 `issues`。
 *
 * 输入：`cmd` 待校验的命令对象（形态未知，本函数负责收窄）、`at` 报错定位前缀
 * （如 `列 id.commands[2]`，各条 issue 都以它开头）、`issues` 外部收集器。
 * 产出：无返回值。先判对象与 op，再把剩余判定按 op 族交给 `validate/` 下的族文件，
 * 因此一次调用可以同时收集多条问题。
 * 失败表现：不抛异常。非对象或 op 非法的命令在此提前返回；其余情况由各族函数补齐。
 */
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
