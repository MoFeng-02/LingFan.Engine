/**
 * video 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards.ts";
import {
  requireNonNegativeFiniteNumber,
  validateInstanceZ,
  validateOptionalBoolean,
  validateOptionalFiniteNumber,
} from "./shape.ts";

/**
 * video 族各 op 的必填与类型（播放/过场 + 定位/暂停/恢复/停止 + 可跳过开关）。
 * 不匹配的 op 直接落到函数末尾，等于放行（结构从简）；本族问题尽量一次报全。
 */
export function validateVideoCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "video":
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      validateOptionalFiniteNumber(cmd, "volume", at, issues);
      validateOptionalBoolean(cmd, "loop", at, issues);
      validateOptionalBoolean(cmd, "restart", at, issues);
      validateInstanceZ(cmd, at, issues);
      break;
    case "cutscene":
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      validateOptionalFiniteNumber(cmd, "volume", at, issues);
      validateOptionalBoolean(cmd, "skipable", at, issues);
      validateOptionalBoolean(cmd, "restart", at, issues);
      validateInstanceZ(cmd, at, issues);
      break;
    case "seek_video":
      requireNonNegativeFiniteNumber(cmd.seconds, `${at}.seconds`, issues);
      break;
    case "pause_video":
    case "resume_video":
    case "stop_video":
      break;
    case "video_skipable":
      if (typeof cmd.value !== "boolean") {
        issues.push(`${at}.value 必须为布尔`);
      }
      break;
  }
}
