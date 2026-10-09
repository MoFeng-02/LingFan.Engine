/**
 * variables 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";

export function validateVariablesCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "set":
    case "define":
    case "let":
    case "local":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      if (!("value" in cmd)) issues.push(`${at}.value 必填`);
      break;
    case "undef":
      requireNonEmptyString(cmd.key, `${at}.key`, issues);
      break;
  }
}
