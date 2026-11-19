/**
 * 音频控制面：单实例暂停 / 恢复（`audio_pause` / `audio_resume` 的 `inst` 目标）
 * 与 `audio_seek`（实例 / 通道双目标定位）。
 *
 * 与通道族同一套纪律：只写状态，播放交给宿主适配器；暂停前的播放态进
 * `SYS.audioPaused` 记账（实例键带 `inst:` 前缀，与通道名分区）；定位写进
 * play 态的 `position`（随快照 / 存档随行，回滚 / 读档后仍能回到那一刻）。
 */
import {
  AUDIO_INSTANCE_ID_PATTERN,
  SYS,
  isAudioInstanceId,
  type AudioChannelState,
  type AudioInstanceTable,
  type AudioInstanceState,
  type StoryCommand,
} from "../../../contracts/index.ts";
import type { OpContext } from "../../internal/index.ts";
import {
  AUDIO_CHANNEL_KEY,
  AUDIO_FIELDS,
  isPlayState,
  mediaSeconds,
  readPausedPlayStates,
  resolveAudioTarget,
} from "./shared.ts";
import {
  PAUSE_KEY_PREFIX,
  instanceTableOf,
  writeInstance,
} from "./instances.ts";

/** 单实例目标解析：id 形态与存在性都 fail-closed（不猜「不存在就当新建」） */
function requireInstance(
  ctx: OpContext,
  cmd: StoryCommand,
): {
  table: AudioInstanceTable;
  id: string;
  entry: AudioInstanceState;
} | null {
  const op = cmd.op;
  const id = cmd.inst;
  if (!isAudioInstanceId(id)) {
    ctx.fail(
      `${op}-invalid-instance`,
      `${op} 的 inst 不合法：${JSON.stringify(id)}（须匹配 ${AUDIO_INSTANCE_ID_PATTERN.source}）`,
    );
    return null;
  }
  const table = instanceTableOf(ctx);
  const entry = table[id];
  if (entry === undefined) {
    ctx.fail(
      `${op}-unknown-instance`,
      `${op} 找不到实例 ${id}（当前实例：${Object.keys(table).join(", ") || "无"}）`,
    );
    return null;
  }
  return { table, id, entry };
}

/**
 * `audio_pause inst=…`：只暂停那一轨。
 *
 * 与通道暂停同三条纪律：只暂停 play 态（stop / 从未播放不写）；已在 pause 态
 * 幂等不动作；暂停前的 play 态记进 `SYS.audioPaused`（`inst:` 前缀键），
 * `audio_resume` 靠它写回「从哪继续」。
 */
export function pauseInstanceById(ctx: OpContext, cmd: StoryCommand): boolean {
  const found = requireInstance(ctx, cmd);
  if (found === null) return false;
  const { table, id, entry } = found;
  if (!isPlayState(entry.state)) return true;
  ctx.mediaSeq += 1;
  writeInstance(ctx, table, id, entry.channel, {
    kind: "pause",
    seq: ctx.mediaSeq,
  } satisfies AudioChannelState);
  const paused: Record<string, AudioChannelState> = {
    ...readPausedPlayStates(ctx),
  };
  paused[PAUSE_KEY_PREFIX + id] = entry.state;
  ctx.setSystem(SYS.audioPaused, paused);
  return true;
}

/**
 * `audio_resume inst=…`：把 pause 态的实例写回暂停前的 play 态（新序号）。
 *
 * 没有记账可续（例如手工改过档）时落成 `stop`：留一条永远无法恢复的 pause
 * 比停掉更糟。play / stop 态幂等不动作。
 */
export function resumeInstanceById(ctx: OpContext, cmd: StoryCommand): boolean {
  const found = requireInstance(ctx, cmd);
  if (found === null) return false;
  const { table, id, entry } = found;
  if (entry.state.kind !== "pause") return true;
  const paused = readPausedPlayStates(ctx);
  const key = PAUSE_KEY_PREFIX + id;
  const resumed = paused[key];
  ctx.mediaSeq += 1;
  const state: AudioChannelState =
    resumed !== undefined
      ? { ...resumed, seq: ctx.mediaSeq }
      : { kind: "stop", fadeMs: 0, seq: ctx.mediaSeq };
  writeInstance(ctx, table, id, entry.channel, state);
  if (resumed !== undefined) {
    const next: Record<string, AudioChannelState> = { ...paused };
    delete next[key];
    ctx.setSystem(SYS.audioPaused, next);
  }
  return true;
}

/**
 * `audio_seek`：把一轨定位到指定秒数（实例或常驻通道，恰好一个目标）。
 *
 * 定位写进 play 态的 `position` 并领一个新序号——渲染层据此执行一次 seek；
 * 同时清掉 `restart` 旗标：定位不是重播，带着重播旗标会让渲染层从头起播。
 * 只作用于 play 态（pause 态不带资源与位置，stop 态没有可定位的东西）；
 * `se` 是一次性触发，没有定位语义，显式 targeting 它时静默不动作。
 * bgm 另把帧级位置键同步到目标秒数：宿主的位置差比较据此触发 seek，
 * 回滚 / 读档也靠这份记账回到当时的位置。
 */
export function execAudioSeek(ctx: OpContext, cmd: StoryCommand): boolean {
  const known = AUDIO_FIELDS[cmd.op]!;
  const unknown = Object.keys(cmd).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const target = resolveAudioTarget(ctx, cmd);
  if (target === null) return false;
  const seconds = mediaSeconds(ctx, cmd.seconds, cmd.op);
  if (seconds === null) return false;
  if ("inst" in target) {
    const found = requireInstance(ctx, cmd);
    if (found === null) return false;
    const { table, id, entry } = found;
    if (!isPlayState(entry.state)) {
      ctx.fail(
        "audio_seek-instance-stopped",
        `实例 ${id} 当前不在播放：先 audio_play 起播再定位`,
      );
      return false;
    }
    ctx.mediaSeq += 1;
    writeInstance(ctx, table, id, entry.channel, {
      ...entry.state,
      restart: false,
      position: seconds,
      seq: ctx.mediaSeq,
    });
    return true;
  }
  if (target.channel === "se") return true;
  const key = AUDIO_CHANNEL_KEY[target.channel]!;
  const previous = ctx.get(key);
  if (!isPlayState(previous)) {
    ctx.fail(
      "audio_seek-channel-stopped",
      `通道 ${target.channel} 当前不在播放：先起播再定位`,
    );
    return false;
  }
  ctx.mediaSeq += 1;
  ctx.setSystem(key, {
    ...previous,
    restart: false,
    position: seconds,
    seq: ctx.mediaSeq,
  });
  if (target.channel === "bgm") {
    // 帧级键静默写：不进事件流，但随快照与存档持久化（读档续播）
    ctx.state.set(SYS.bgmPosition, seconds);
  }
  return true;
}
