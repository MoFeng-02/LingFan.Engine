/**
 * 音频实例表的读入判据：把运行期到手的 `unknown` 收窄成契约里的实例表。
 *
 * 契约层只声明形态，实例表却可能来自存档、来自扩展、来自被改坏的工程文件，
 * 所以每次读入都得先判后用（与 `guards.ts` 同一套纪律：判不过就由调用方
 * fail-closed，这里不抛错也不猜默认值）。
 *
 * 三条规则一次判清，缺一条都会让坏数据漏进状态：
 * - 表是普通对象（数组与 `null` 不算——数组会把下标当实例 id）
 * - 实例 id 合 `AUDIO_INSTANCE_ID_PATTERN`（作者要按名字点名，形态必须统一）
 * - 实例数不超 `MAX_AUDIO_INSTANCES`（整表进快照与存档，无上限存档会写到写不动）
 */
import {
  AUDIO_INSTANCE_ID_PATTERN,
  MAX_AUDIO_INSTANCES,
  type AudioChannel,
  type AudioChannelState,
  type AudioInstanceState,
  type AudioInstanceTable,
} from "../contracts/media/index.ts";
import { isPlainObject } from "./guards.ts";

const AUDIO_CHANNELS: readonly string[] = ["bgm", "se", "ambient", "voice"];

/** 是否是已知的音频通道（`bgm` / `se` / `ambient` / `voice`） */
export function isAudioChannel(value: unknown): value is AudioChannel {
  return typeof value === "string" && AUDIO_CHANNELS.includes(value);
}

/** 是否是合形态的实例 id（与扩展 / 玩法系统同一份短 id 规则） */
export function isAudioInstanceId(value: unknown): value is string {
  return typeof value === "string" && AUDIO_INSTANCE_ID_PATTERN.test(value);
}

function isChannelState(value: unknown): value is AudioChannelState {
  if (!isPlainObject(value)) return false;
  if (typeof value.fadeMs !== "number" || !Number.isFinite(value.fadeMs)) {
    return false;
  }
  const fadeMs = value.fadeMs;
  if (value.kind === "stop") {
    return value.seq === undefined || isOptionalSeq(value.seq);
  }
  if (value.kind !== "play") return false;
  return (
    typeof value.resource === "string" &&
    value.resource !== "" &&
    typeof value.volume === "number" &&
    Number.isFinite(value.volume) &&
    typeof value.loop === "boolean" &&
    fadeMs >= 0 &&
    (value.autoStop === undefined || typeof value.autoStop === "boolean") &&
    (value.restart === undefined || typeof value.restart === "boolean") &&
    (value.seq === undefined || isOptionalSeq(value.seq))
  );
}

function isOptionalSeq(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** 是否是合形态的单个实例状态：通道已知 + 播放状态合形态 */
export function isAudioInstanceState(
  value: unknown,
): value is AudioInstanceState {
  if (!isPlainObject(value)) return false;
  return isAudioChannel(value.channel) && isChannelState(value.state);
}

/**
 * 是否是合形态的实例表：普通对象 + 键合 id + 值合形态 + 条数不超上限。
 *
 * **上限在这里判**而不是在写入 op 里判：读入与写入都走同一个判据，
 * 存档里被人改成 100 个实例时也能在装载阶段挡下来。
 */
export function isAudioInstanceTable(
  value: unknown,
): value is AudioInstanceTable {
  if (!isPlainObject(value)) return false;
  const ids = Object.keys(value);
  if (ids.length > MAX_AUDIO_INSTANCES) return false;
  for (const id of ids) {
    if (!isAudioInstanceId(id)) return false;
    if (!isAudioInstanceState(value[id])) return false;
  }
  return true;
}

/**
 * 取实例表的 id 清单（字典序）：不合形态的表按空表处理。
 *
 * 渲染层按 id 排序后下发才能保证「同一份状态 → 同一串播放动作」，
 * 否则对象键序会让同一存档在两台机器上叠出不同顺序的音轨。
 */
export function audioInstanceIds(value: unknown): readonly string[] {
  return isAudioInstanceTable(value) ? Object.keys(value).sort() : [];
}
