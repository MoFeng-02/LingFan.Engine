/**
 * flow 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";
import { validateInstanceZ } from "../column";
import { isPlainObject } from "../../../shared";

export function validateFlowCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "jump":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      break;
    case "navigate":
      requireNonEmptyString(cmd.path, `${at}.path`, issues);
      if (cmd.scene !== undefined) {
        requireNonEmptyString(cmd.scene, `${at}.scene`, issues);
      }
      break;
    case "break":
    case "continue":
      break; // 无参数
    case "call":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (cmd.args !== undefined && !Array.isArray(cmd.args)) {
        issues.push(`${at}.args 必须为数组`);
      }
      break;
    case "return":
      break; // value 可选
    case "minigame": {
      requireNonEmptyString(cmd.game, `${at}.game`, issues);
      validateInstanceZ(cmd, at, issues); // minigame 的实例 z（minigame 层）
      if (cmd.config !== undefined && !isPlainObject(cmd.config)) {
        issues.push(`${at}.config 必须为对象`);
      }
      for (const field of ["on_success", "on_fail"] as const) {
        if (cmd[field] !== undefined) {
          requireNonEmptyString(cmd[field], `${at}.${field}`, issues);
        }
      }
      if (cmd.reward !== undefined) {
        if (!Array.isArray(cmd.reward)) {
          issues.push(`${at}.reward 必须为键值数组`);
        } else {
          for (const [j, entry] of cmd.reward.entries()) {
            if (!isPlainObject(entry)) {
              issues.push(`${at}.reward[${j}] 必须为 { key, value } 对象`);
              continue;
            }
            requireNonEmptyString(entry.key, `${at}.reward[${j}].key`, issues);
            if (!("value" in entry)) {
              issues.push(`${at}.reward[${j}].value 必填`);
            }
          }
        }
      }
      break;
    }
  }
}
