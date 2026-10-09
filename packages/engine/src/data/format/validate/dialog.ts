/**
 * dialog 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";
import { validateInstanceZ } from "../column";
import { isPlainObject } from "../../../shared";

export function validateDialogCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "say":
      requireNonEmptyString(cmd.text, `${at}.text`, issues);
      validateInstanceZ(cmd, at, issues); // say 的实例 z（dialogue 层）
      break;
    case "assert":
      requireNonEmptyString(cmd.cond, `${at}.cond`, issues);
      if (cmd.message !== undefined && typeof cmd.message !== "string") {
        issues.push(`${at}.message 必须为字符串`);
      }
      break;
    case "guard":
      requireNonEmptyString(cmd.fn, `${at}.fn`, issues);
      if (cmd.args !== undefined && !isPlainObject(cmd.args)) {
        issues.push(`${at}.args 必须为对象`);
      }
      break;
    case "notify":
      requireNonEmptyString(cmd.text, `${at}.text`, issues);
      if (cmd.type !== undefined && typeof cmd.type !== "string") {
        issues.push(`${at}.type 必须为字符串`);
      }
      if (cmd.duration !== undefined && typeof cmd.duration !== "number") {
        issues.push(`${at}.duration 必须为数字`);
      }
      validateInstanceZ(cmd, at, issues); // notify 的实例 z（notifications 层）
      break;
    case "wait":
      if (typeof cmd.seconds !== "number")
        issues.push(`${at}.seconds 必须为数字`);
      if (cmd.skipable !== undefined && typeof cmd.skipable !== "boolean") {
        issues.push(`${at}.skipable 必须为布尔`);
      }
      break;
    case "pause":
      if (typeof cmd.seconds !== "number")
        issues.push(`${at}.seconds 必须为数字`);
      break;
    case "input":
      requireNonEmptyString(cmd.prompt, `${at}.prompt`, issues);
      requireNonEmptyString(cmd.store, `${at}.store`, issues);
      if (cmd.options !== undefined) {
        issues.push(`${at}.options 选项式输入暂未实现（fail-closed）`);
      }
      validateInstanceZ(cmd, at, issues); // input 的实例 z（choices 层）
      break;
  }
}
