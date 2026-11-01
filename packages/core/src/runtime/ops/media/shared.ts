/**
 * 媒体域共用：op 负载白名单与音量 / 淡出解析。
 *
 * 白名单是 fail-closed 的唯一来源——执行器只查这里，未知字段一律拒绝；
 * 音量与淡出是音频与视频两族共用的窄化，口径必须一处（否则同一个
 * `volume` 在两条命令上会有两种边界行为）。
 */
import {
  SYS,
  type AudioChannel,
  type AudioChannelState,
} from "../../../contracts/index.ts";
import type { OpContext } from "../../internal/index.ts";

/** 音频 op 已知负载字段（未知字段 fail-closed） */
export const AUDIO_FIELDS: Record<string, ReadonlySet<string>> = {
  bgm: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  se: new Set(["op", "resource", "volume"]),
  ambient: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  stop_bgm: new Set(["op", "fade"]),
  stop_ambient: new Set(["op", "fade"]),
  stop_se: new Set(["op", "fade"]),
  voice: new Set(["op", "resource", "volume", "auto_stop", "restart"]),
  stop_voice: new Set(["op", "fade"]),
  audio_play: new Set([
    "op",
    "inst",
    "channel",
    "resource",
    "volume",
    "loop",
    "fade",
    "restart",
  ]),
  audio_stop: new Set(["op", "inst", "fade"]),
  audio_volume: new Set(["op", "inst", "volume"]),
  audio_pause: new Set(["op", "channel"]),
  audio_resume: new Set(["op", "channel"]),
};

/** 停止类 op → 目标常驻通道系统键 */
export const AUDIO_STOP_KEY: Record<string, string> = {
  stop_bgm: SYS.audioBgm,
  stop_ambient: SYS.audioAmbient,
  stop_voice: SYS.audioVoice,
};

/** 音频通道 op → 常驻通道系统键（se 为一次性触发，不在表内） */
export const AUDIO_CHANNEL_KEY: Record<string, string> = {
  bgm: SYS.audioBgm,
  ambient: SYS.audioAmbient,
  voice: SYS.audioVoice,
};

/**
 * volume 三级解析：命令显式值 ?? 工程默认（`shell.audio.volumes[通道]`）?? 1。
 *
 * 顺序不能反：显式值是作者在这一条命令上的意图，工程默认是整部作品的口径，
 * 内建 1 只在前两级都缺席时兜底（与「不指定 = 满音量」的既有语义逐字节一致）。
 * 玩家偏好不在这里——它是渲染层最外层的乘算，混进来会让「换个工程，玩家设置
 * 被这个工程的默认值改掉」。
 *
 * `channel` 缺省（视频族）表示没有工程默认级：视频音量只认命令与内建 1。
 * 非有限数字一律 fail-closed（作者写错不能静默当满音量），越界按物理范围钳制。
 */
export function audioVolume(
  ctx: OpContext,
  raw: unknown,
  op: string,
  channel?: AudioChannel,
): number | null {
  let explicit: number | undefined;
  if (raw !== undefined) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      ctx.fail(`${op}-invalid-volume`, `${op} 的 volume 必须是有限数字`);
      return null;
    }
    explicit = raw;
  }
  const fallback =
    channel === undefined ? 1 : (ctx.audioConfig.volumes[channel] ?? 1);
  return Math.min(1, Math.max(0, explicit ?? fallback));
}

/** fade 窄化：缺省 0；负数/非有限数字 fail-closed */
export function audioFade(
  ctx: OpContext,
  raw: unknown,
  op: string,
): number | null {
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    ctx.fail(`${op}-invalid-fade`, `${op} 的 fade 必须是非负有限数字（毫秒）`);
    return null;
  }
  return raw;
}

/**
 * 播放态判定：暂停记账只记录「有东西可续播」的状态。
 *
 * `pause` 态本身不带资源、`stop` 态已经结束，两者都没有可写回的播放态。判据按契约
 * 形状严格比对——记账表随快照 / 存档随行，读回来的可能是被外部改坏的值，把非 play
 * 态当成 play 态会让恢复写回一条没有资源的播放态。
 */
export function isPlayState(value: unknown): value is AudioChannelState {
  if (value === null || typeof value !== "object") return false;
  const state = value as { kind?: unknown; resource?: unknown };
  return state.kind === "play" && typeof state.resource === "string";
}

/**
 * 读 `SYS.audioPaused` 暂停记账表：逐项只留 play 态，形状不合按空表处理。
 *
 * 同一张表按两套键空间分区存放：常驻通道项用通道名（`bgm` / `ambient` / `voice`），
 * 音频实例项用 `inst:<实例id>`。这里原样返回全部键，由调用方按自己的键空间取值——
 * 在读函数里按前缀过滤会让另一族读不到自己的项。
 *
 * 外部改坏的值一律静默过滤：一条脏值不该让整条暂停 / 恢复路径失败。
 */
export function readPausedPlayStates(
  ctx: OpContext,
): Record<string, AudioChannelState> {
  const value = ctx.get(SYS.audioPaused);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, AudioChannelState> = {};
  for (const [key, state] of Object.entries(value as Record<string, unknown>)) {
    if (isPlayState(state)) out[key] = state;
  }
  return out;
}
