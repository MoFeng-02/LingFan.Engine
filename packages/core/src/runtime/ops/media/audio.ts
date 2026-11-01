/**
 * 音频通道族：四通道（bgm / se / ambient / voice）的起播、停止与可恢复暂停。
 *
 * 核心只写通道状态，播放交给宿主适配器：状态回答「该不该出声、放什么」，
 * 位置留在播放器里。`se` 是一次性触发（带单调 seq），常驻通道写状态对象
 * （随快照 / 存档 / 回溯随行）。
 */
import {
  SYS,
  isAudioChannel,
  type AudioChannel,
  type AudioChannelState,
  type StoryCommand,
} from "../../../contracts/index.ts";
import type { OpContext } from "../../internal/index.ts";
import {
  AUDIO_CHANNEL_KEY,
  AUDIO_FIELDS,
  AUDIO_STOP_KEY,
  audioFade,
  audioVolume,
  isPlayState,
  readPausedPlayStates,
} from "./shared.ts";

/**
 * 四音频通道：核心只写状态，播放由 UI 适配器落地。
 * - bgm/ambient/voice 为常驻通道（写状态对象，随快照/存档随行）；se 为一次性触发（单调 seq）
 * - 同资源重写保留播放位置：重放不打断当前曲目（回滚 seek / 读档续播）
 * - stop_* 写 stop 形态（带淡出参数）；未知字段/非法负载 fail-closed
 */
export function execAudio(ctx: OpContext, cmd: StoryCommand): boolean {
  const unknown = Object.keys(cmd).filter(
    (k) => !(AUDIO_FIELDS[cmd.op]?.has(k) ?? false),
  );
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const fade = audioFade(ctx, cmd.fade, cmd.op);
  if (fade === null) return false;
  if (cmd.op === "stop_se") {
    // 音效是「一次性触发 + 可停止」：停止也要带单调序号，
    // 否则连续两次 stop_se 在渲染层看来是「状态没变」，第二次停不掉新触发的音效
    ctx.mediaSeq += 1;
    ctx.setSystem(SYS.audioSe, {
      kind: "stop",
      fadeMs: fade,
      seq: ctx.mediaSeq,
    } satisfies AudioChannelState);
    return true;
  }
  if (
    cmd.op === "stop_bgm" ||
    cmd.op === "stop_ambient" ||
    cmd.op === "stop_voice"
  ) {
    // 清通道为停止形态（淡出参数随状态走，不被丢弃）
    const stopKey = AUDIO_STOP_KEY[cmd.op]!;
    ctx.setSystem(stopKey, {
      kind: "stop",
      fadeMs: fade,
    } satisfies AudioChannelState);
    // 停止背景乐：播放位置归零（帧级键静默写）
    if (cmd.op === "stop_bgm") ctx.state.set(SYS.bgmPosition, 0);
    return true;
  }
  if (typeof cmd.resource !== "string" || cmd.resource === "") {
    ctx.fail(
      `${cmd.op}-invalid-resource`,
      `${cmd.op} 需要非空 resource 字符串`,
    );
    return false;
  }
  // 走到这里 op 只剩四个起播命令（stop_* 已在前面的分支返回）⇒ 通道就是 op 本身
  const channel = cmd.op as AudioChannel;
  const volume = audioVolume(ctx, cmd.volume, channel, channel);
  if (volume === null) return false;
  if (cmd.op === "se") {
    ctx.mediaSeq += 1;
    ctx.setSystem(SYS.audioSe, {
      kind: "play",
      resource: cmd.resource,
      volume,
      loop: false,
      fadeMs: 0,
      seq: ctx.mediaSeq,
    } satisfies AudioChannelState);
    return true;
  }
  const channelKey = AUDIO_CHANNEL_KEY[cmd.op]!;
  const previous = ctx.get(channelKey) as AudioChannelState | null | undefined;
  const restart = cmd.restart === true;
  if (cmd.op === "bgm") {
    // 首播/换曲/显式重播归零；同曲静默续播（回滚 seek / 读档续播）。
    // 帧级键静默写（高频键不进事件流），UI 经通道事件重读位置。
    const sameTrack =
      previous?.kind === "play" && previous.resource === cmd.resource;
    if (!sameTrack || restart) ctx.state.set(SYS.bgmPosition, 0);
  }
  const state: AudioChannelState = {
    kind: "play",
    resource: cmd.resource,
    volume,
    loop: cmd.op === "voice" ? false : cmd.loop !== false,
    fadeMs: fade,
  };
  if (cmd.op === "voice") state.autoStop = cmd.auto_stop !== false;
  if (restart) {
    // 单调序号：同曲连续两次 restart 也是两次独立事件（渲染层据此重播）
    ctx.mediaSeq += 1;
    state.restart = true;
    state.seq = ctx.mediaSeq;
  }
  ctx.setSystem(channelKey, state);
  return true;
}

/** 可暂停的常驻通道：`se` 是一次性触发，暂停它没有可恢复的东西 */
const PAUSABLE_CHANNELS = ["bgm", "ambient", "voice"] as const;
type PausableChannel = (typeof PAUSABLE_CHANNELS)[number];

/**
 * 暂停目标通道：不传 `channel` = 全部常驻通道（`se` 除外）。
 * 显式传 `se` 返回空集——一次性触发没有「暂停后从原位置继续」这回事，
 * 静默不动作而不是报错（作者写了也不算坏数据）。
 */
function pauseTargets(
  ctx: OpContext,
  cmd: StoryCommand,
): readonly PausableChannel[] | null {
  if (cmd.channel === undefined) return PAUSABLE_CHANNELS;
  const raw = cmd.channel;
  if (!isAudioChannel(raw)) {
    ctx.fail(
      `${cmd.op}-invalid-channel`,
      `${cmd.op} 的 channel 不合法：${JSON.stringify(raw)}（须为 bgm / se / ambient / voice 之一）`,
    );
    return null;
  }
  if (raw === "se") return [];
  return [raw];
}

/**
 * `audio_pause`：把常驻通道从 play 改成 pause，播放器实例与位置留给端口。
 *
 * 三条纪律：
 * - 只暂停 play 态——`stop` / 从未播放的通道不写，否则「从未触碰」会变成「暂停」，
 *   恢复时无实例可续，stop 的淡出参数也跟着丢；
 * - 已在 pause 态不重复写也不递增序号（幂等：连按两次暂停只有第一次是事件）；
 * - 暂停前的 play 态记进 `SYS.audioPaused`——`pause` 态本身不带资源，
 *   `audio_resume` 靠这份记账写回「从哪继续」（随快照 / 存档随行，读档后仍能恢复）。
 */
export function execAudioPause(ctx: OpContext, cmd: StoryCommand): boolean {
  const unknown = Object.keys(cmd).filter(
    (k) => !(AUDIO_FIELDS[cmd.op]?.has(k) ?? false),
  );
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const channels = pauseTargets(ctx, cmd);
  if (channels === null) return false;
  for (const channel of channels) {
    const key = AUDIO_CHANNEL_KEY[channel]!;
    const previous = ctx.get(key);
    if (!isPlayState(previous)) continue;
    ctx.mediaSeq += 1;
    ctx.setSystem(key, {
      kind: "pause",
      seq: ctx.mediaSeq,
    } satisfies AudioChannelState);
    const paused: Record<string, AudioChannelState> = {
      ...readPausedPlayStates(ctx),
    };
    paused[channel] = previous;
    ctx.setSystem(SYS.audioPaused, paused);
  }
  return true;
}

/**
 * `audio_resume`：把 pause 态的通道写回暂停前的 play 态。
 *
 * 写回的是**同一个 play 态**（资源 / 音量 / 循环 / 淡出参数原样），所以渲染层
 * 看到的是「pause → 同资源 play」，走 `resume` 而不是重新 `play`——从暂停位置续播，
 * 不从头播。`play` / `stop` 态的通道不动作（幂等）。
 *
 * 没有记账可续（例如手工改过档）时落成 `stop`：留一个永远无法恢复的 pause 态
 * 比停掉更糟——那条通道会一直「该出声但不出声」。
 */
export function execAudioResume(ctx: OpContext, cmd: StoryCommand): boolean {
  const unknown = Object.keys(cmd).filter(
    (k) => !(AUDIO_FIELDS[cmd.op]?.has(k) ?? false),
  );
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const channels = pauseTargets(ctx, cmd);
  if (channels === null) return false;
  for (const channel of channels) {
    const key = AUDIO_CHANNEL_KEY[channel]!;
    const current = ctx.get(key);
    if (current === null || typeof current !== "object") continue;
    if ((current as { kind?: unknown }).kind !== "pause") continue;
    const paused = readPausedPlayStates(ctx);
    const resumed = paused[channel];
    ctx.setSystem(
      key,
      resumed ?? ({ kind: "stop", fadeMs: 0 } satisfies AudioChannelState),
    );
    if (resumed !== undefined) {
      const next: Record<string, AudioChannelState> = { ...paused };
      delete next[channel];
      ctx.setSystem(SYS.audioPaused, next);
    }
  }
  return true;
}
