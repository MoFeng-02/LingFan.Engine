/**
 * present 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards";
import { isPlainObject } from "../../../shared";

export function validatePresentCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "show":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (cmd.background !== undefined && typeof cmd.background !== "boolean") {
        issues.push(`${at}.background 必须为布尔`);
      }
      break;
    case "hide":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      break;
    case "background":
    case "bg_switch":
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      break;
    case "zindex":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (typeof cmd.value !== "number" || !Number.isFinite(cmd.value)) {
        issues.push(`${at}.value 必须为有限数字`);
      }
      break;
    case "style":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      if (!isPlainObject(cmd.props)) issues.push(`${at}.props 必须为对象`);
      break;
    case "window":
      if (cmd.mode !== "auto" && cmd.mode !== "show" && cmd.mode !== "hide") {
        issues.push(`${at}.mode 必须为 "auto" | "show" | "hide"`);
      }
      break;
    case "animate":
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      requireNonEmptyString(cmd.property, `${at}.property`, issues);
      if (typeof cmd.value !== "number" || !Number.isFinite(cmd.value)) {
        issues.push(`${at}.value 必须为有限数字`);
      }
      break;
    case "animate_block": {
      requireNonEmptyString(cmd.target, `${at}.target`, issues);
      for (const field of ["x", "y", "opacity", "rotation", "scale"]) {
        const value = cmd[field];
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value))
        ) {
          issues.push(`${at}.${field} 必须为有限数字`);
        }
      }
      break;
    }
    case "transition":
      requireNonEmptyString(cmd.type, `${at}.type`, issues);
      break;
    case "shake":
      break; // intensity / duration 均可选（执行器给缺省）
    case "text_typewriter":
      if (cmd.enabled !== undefined && typeof cmd.enabled !== "boolean") {
        issues.push(`${at}.enabled 必须为布尔`);
      }
      if (
        cmd.speed !== undefined &&
        (typeof cmd.speed !== "number" ||
          !Number.isFinite(cmd.speed) ||
          cmd.speed <= 0)
      ) {
        issues.push(`${at}.speed 必须为正数（字符/秒）`);
      }
      if (cmd.enabled === undefined && cmd.speed === undefined) {
        issues.push(`${at} 至少需要 enabled 或 speed`);
      }
      break;
  }
}
