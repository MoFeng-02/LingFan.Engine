/**
 * audio 族的命令负载结构校验（validateCommand 的族分片）。
 * 只判本族 op 的必填与类型，未知字段不在此拒绝（编辑期 schema 负责）。
 */
import { requireNonEmptyString } from "../guards.ts";
import {
  requireNonNegativeFiniteNumber,
  validateOptionalBoolean,
  validateOptionalFiniteNumber,
  validateOptionalNonNegativeNumber,
} from "./shape.ts";
import {
  AUDIO_CHANNELS,
  AUDIO_INSTANCE_ID_PATTERN,
} from "../../../contracts/index.ts";

/** 实例 id：短标识形态（与运行期判定同一模式，装载期先拒一遍）。 */
function validateInstanceIdField(
  v: unknown,
  at: string,
  issues: string[],
): void {
  if (typeof v !== "string" || !AUDIO_INSTANCE_ID_PATTERN.test(v)) {
    issues.push(
      `${at} 必须为短 id（匹配 ${AUDIO_INSTANCE_ID_PATTERN.source}）`,
    );
  }
}

/** 通道名：四个已知通道之一。 */
function validateChannelField(v: unknown, at: string, issues: string[]): void {
  if (
    typeof v !== "string" ||
    !(AUDIO_CHANNELS as readonly string[]).includes(v)
  ) {
    issues.push(`${at} 必须为 bgm / se / ambient / voice 之一`);
  }
}

/**
 * 双目标字段（inst / channel）的共用形状：
 * - 给了就判各自形态；两个都给 = 互斥违规（执行期同样拒绝，装载期先报）；
 * - requireTarget 的命令（audio_volume / audio_seek）还要求至少给一个。
 * audio_pause / audio_resume 的目标整体可选（缺省 = 全部常驻通道）。
 */
function validateAudioTarget(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
  requireTarget: boolean,
): void {
  if (cmd.inst !== undefined)
    validateInstanceIdField(cmd.inst, `${at}.inst`, issues);
  if (cmd.channel !== undefined)
    validateChannelField(cmd.channel, `${at}.channel`, issues);
  if (cmd.inst !== undefined && cmd.channel !== undefined) {
    issues.push(`${at} 的 inst 与 channel 互斥（恰好给一个）`);
  } else if (
    requireTarget &&
    cmd.inst === undefined &&
    cmd.channel === undefined
  ) {
    issues.push(`${at} 需要 inst 或 channel 之一`);
  }
}

/**
 * audio 族各 op 的必填与类型（四通道播放/停止 + 实例命令面 + 暂停/恢复/音量/定位）。
 * 不匹配的 op 直接落到函数末尾，等于放行（结构从简）；本族问题尽量一次报全。
 */
export function validateAudioCommand(
  cmd: Record<string, unknown>,
  at: string,
  issues: string[],
): void {
  switch (cmd.op) {
    case "bgm":
    case "ambient":
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      validateOptionalFiniteNumber(cmd, "volume", at, issues);
      validateOptionalBoolean(cmd, "loop", at, issues);
      validateOptionalNonNegativeNumber(cmd, "fade", at, issues);
      validateOptionalBoolean(cmd, "restart", at, issues);
      break;
    case "se":
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      validateOptionalFiniteNumber(cmd, "volume", at, issues);
      break;
    case "voice":
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      validateOptionalFiniteNumber(cmd, "volume", at, issues);
      validateOptionalBoolean(cmd, "auto_stop", at, issues);
      validateOptionalBoolean(cmd, "restart", at, issues);
      break;
    case "stop_bgm":
    case "stop_ambient":
    case "stop_se":
    case "stop_voice":
      validateOptionalNonNegativeNumber(cmd, "fade", at, issues);
      break;
    case "audio_play":
      validateInstanceIdField(cmd.inst, `${at}.inst`, issues);
      validateChannelField(cmd.channel, `${at}.channel`, issues);
      requireNonEmptyString(cmd.resource, `${at}.resource`, issues);
      validateOptionalFiniteNumber(cmd, "volume", at, issues);
      validateOptionalBoolean(cmd, "loop", at, issues);
      validateOptionalNonNegativeNumber(cmd, "fade", at, issues);
      validateOptionalBoolean(cmd, "restart", at, issues);
      break;
    case "audio_stop":
      if (cmd.inst !== undefined)
        validateInstanceIdField(cmd.inst, `${at}.inst`, issues);
      validateOptionalNonNegativeNumber(cmd, "fade", at, issues);
      break;
    case "audio_volume":
      validateAudioTarget(cmd, at, issues, true);
      if (typeof cmd.volume !== "number" || !Number.isFinite(cmd.volume)) {
        issues.push(`${at}.volume 必须为有限数字`);
      }
      break;
    case "audio_pause":
    case "audio_resume":
      validateAudioTarget(cmd, at, issues, false);
      break;
    case "audio_seek":
      validateAudioTarget(cmd, at, issues, true);
      requireNonNegativeFiniteNumber(cmd.seconds, `${at}.seconds`, issues);
      break;
  }
}
