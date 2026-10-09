/**
 * save 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";

export function validateSaveCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "save":
      requireNonEmptyString(cmd.slot, `${at}.slot`, issues);
      if (cmd.title !== undefined && typeof cmd.title !== "string") {
        issues.push(`${at}.title 必须为字符串`);
      }
      break;
    case "load":
    case "save_delete":
      requireNonEmptyString(cmd.slot, `${at}.slot`, issues);
      break;
    case "auto_save":
      if (cmd.enabled !== true && cmd.enabled !== false) {
        issues.push(`${at}.enabled 必须为布尔`);
      }
      break;
  }
}
