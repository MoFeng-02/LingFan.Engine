/**
 * 音频实例族：`audio_play` / `audio_stop` / `audio_volume`。
 *
 * 实例与四通道**并存**，不是替换：通道是叙事语义（bgm / se / ambient / voice，
 * 各有一档玩家偏好），实例是作者的编排单元（数量不定、名字自起、各自独立叠放）。
 * 实例靠状态里的 `channel` 决定偏好归口，读侧乘的是同一个 `effectiveVolume`。
 */
import {
  AUDIO_INSTANCE_ID_PATTERN,
  MAX_AUDIO_INSTANCES,
  SYS,
  isAudioChannel,
  isAudioInstanceId,
  isAudioInstanceTable,
  type AudioChannel,
  type AudioChannelState,
  type AudioInstanceTable,
  type AudioInstanceState,
  type StoryCommand,
} from "../../../contracts/index.ts";
import type { OpContext } from "../../internal/index.ts";
import {
  AUDIO_FIELDS,
  audioFade,
  audioVolume,
  isPlayState,
  readPausedPlayStates,
} from "./shared.ts";

/**
 * 暂停记账里实例项的键前缀。
 *
 * 实例 id 与通道名同字符集（`bgm` / `se` / `ambient` / `voice` 都是合法实例名），
 * 两者共用一张记账表时不能拿裸 id 当键：通道恢复会读到某个同名实例的播放态，
 * 把别人的资源写回自己的通道。
 */
const PAUSE_KEY_PREFIX = "inst:";

/** 读实例表：形状不合（外部改坏）按空表处理，不让一条脏值卡死整个音频域 */
function instanceTableOf(ctx: OpContext): AudioInstanceTable {
  const value = ctx.get(SYS.audioInstances);
  return isAudioInstanceTable(value) ? value : {};
}

/** 整表新建后写回：**不得原地改** `table[id].state`，否则回溯会拿到被污染的值 */
function writeInstance(
  ctx: OpContext,
  table: AudioInstanceTable,
  instanceId: string,
  channel: AudioChannel,
  state: AudioChannelState,
): void {
  const next: Record<string, AudioInstanceState> = { ...table };
  next[instanceId] = { channel, state };
  ctx.setSystem(SYS.audioInstances, next satisfies AudioInstanceTable);
}

/**
 * 音频实例 op 的执行：`audio_play` / `audio_stop` / `audio_volume`。
 *
 * 实例与四通道**并存**，不是替换：通道是叙事语义（bgm / se / ambient / voice，
 * 各有一档玩家偏好），实例是作者的编排单元（数量不定、名字自起、各自独立叠放）。
 * 实例靠状态里的 `channel` 决定偏好归口，读侧乘的是同一个 `effectiveVolume`。
 *
 * 三个 op 的分工：`audio_play` 创建或更新；`audio_stop` 停一个（缺 `inst` = 停全部）；
 * `audio_volume` **只改音量，不重播也不递增 seq**——音量的变化由值比较感知，
 * 递增序号会让渲染层误判成一次重播，把正在放的那一轨打断。
 */
export function execAudioInstance(ctx: OpContext, cmd: StoryCommand): boolean {
  const known = AUDIO_FIELDS[cmd.op]!;
  const unknown = Object.keys(cmd).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const table = instanceTableOf(ctx);
  if (cmd.op === "audio_stop") return stopInstance(ctx, table, cmd);
  if (cmd.op === "audio_volume") return setInstanceVolume(ctx, table, cmd);
  return playInstance(ctx, table, cmd);
}

/** `audio_play`：创建或更新一个实例（同资源 = 更新，换资源 = 重播） */
function playInstance(
  ctx: OpContext,
  table: AudioInstanceTable,
  cmd: StoryCommand,
): boolean {
  const instanceId = cmd.inst;
  if (!isAudioInstanceId(instanceId)) {
    ctx.fail(
      "audio_play-invalid-instance",
      `audio_play 的 inst 不合法：${JSON.stringify(instanceId)}（须匹配 ${AUDIO_INSTANCE_ID_PATTERN.source}）`,
    );
    return false;
  }
  const channel = cmd.channel;
  if (!isAudioChannel(channel)) {
    ctx.fail(
      "audio_play-invalid-channel",
      `audio_play 的 channel 不合法：${JSON.stringify(channel)}（须为 bgm / se / ambient / voice 之一）`,
    );
    return false;
  }
  if (typeof cmd.resource !== "string" || cmd.resource === "") {
    ctx.fail(
      "audio_play-invalid-resource",
      "audio_play 需要非空 resource 字符串",
    );
    return false;
  }
  const previous = table[instanceId];
  if (
    previous === undefined &&
    Object.keys(table).length >= MAX_AUDIO_INSTANCES
  ) {
    // 上限在这里先拦一次（判据里也有，但那时已经写进存档了，错误发现得太晚）
    ctx.fail(
      "audio_play-instance-limit",
      `音频实例已达上限 ${MAX_AUDIO_INSTANCES}：${instanceId} 无处安放（先 audio_stop 掉不用的实例）`,
    );
    return false;
  }
  const volume = audioVolume(ctx, cmd.volume, "audio_play", channel);
  if (volume === null) return false;
  const fade = audioFade(ctx, cmd.fade, "audio_play");
  if (fade === null) return false;
  const restart = cmd.restart === true;
  const sameTrack =
    previous !== undefined &&
    previous.state.kind === "play" &&
    previous.state.resource === cmd.resource;
  const state: AudioChannelState = {
    kind: "play",
    resource: cmd.resource,
    volume,
    loop: cmd.loop !== false,
    fadeMs: fade,
  };
  if (restart || !sameTrack) {
    // 新实例 / 换资源 / 显式重播都要给一个新序号：渲染层据此判定「这是一次新的起播」
    ctx.mediaSeq += 1;
    state.seq = ctx.mediaSeq;
    if (restart) state.restart = true;
  } else if (
    previous.state.kind === "play" &&
    previous.state.seq !== undefined
  ) {
    // 同资源原地更新：**沿用旧序号**。沿用而不是省掉，是为了让「这一轨还是那一轨」
    // 在状态里始终可辨认；不递增则保证渲染层不会把它当成一次新起播。
    state.seq = previous.state.seq;
  }
  writeInstance(ctx, table, instanceId, channel, state);
  return true;
}

/** `audio_stop`：停一个实例；缺 `inst` = 停全部实例 */
function stopInstance(
  ctx: OpContext,
  table: AudioInstanceTable,
  cmd: StoryCommand,
): boolean {
  const fade = audioFade(ctx, cmd.fade, "audio_stop");
  if (fade === null) return false;
  const ids = Object.keys(table);
  if (cmd.inst === undefined) {
    if (ids.length === 0) return true; // 没有实例可停：不是错误
    const next: Record<string, AudioInstanceState> = { ...table };
    for (const id of ids) {
      ctx.mediaSeq += 1;
      next[id] = {
        channel: table[id]!.channel,
        // 每个实例各领一个序号：连续两次全停必须是两次独立事件
        state: { kind: "stop", fadeMs: fade, seq: ctx.mediaSeq },
      };
    }
    ctx.setSystem(SYS.audioInstances, next satisfies AudioInstanceTable);
    return true;
  }
  const instanceId = cmd.inst;
  if (!isAudioInstanceId(instanceId)) {
    ctx.fail(
      "audio_stop-invalid-instance",
      `audio_stop 的 inst 不合法：${JSON.stringify(instanceId)}（须匹配 ${AUDIO_INSTANCE_ID_PATTERN.source}）`,
    );
    return false;
  }
  const previous = table[instanceId];
  if (previous === undefined) {
    ctx.fail(
      "audio_stop-unknown-instance",
      `audio_stop 找不到实例 ${instanceId}（当前实例：${ids.join(", ") || "无"}）`,
    );
    return false;
  }
  ctx.mediaSeq += 1;
  writeInstance(ctx, table, instanceId, previous.channel, {
    kind: "stop",
    fadeMs: fade,
    seq: ctx.mediaSeq,
  });
  return true;
}

/** `audio_volume`：只改音量（双向闭环入口），不重播、不递增 seq */
function setInstanceVolume(
  ctx: OpContext,
  table: AudioInstanceTable,
  cmd: StoryCommand,
): boolean {
  const instanceId = cmd.inst;
  if (!isAudioInstanceId(instanceId)) {
    ctx.fail(
      "audio_volume-invalid-instance",
      `audio_volume 的 inst 不合法：${JSON.stringify(instanceId)}（须匹配 ${AUDIO_INSTANCE_ID_PATTERN.source}）`,
    );
    return false;
  }
  const previous = table[instanceId];
  if (previous === undefined) {
    ctx.fail(
      "audio_volume-unknown-instance",
      `audio_volume 找不到实例 ${instanceId}（当前实例：${Object.keys(table).join(", ") || "无"}）`,
    );
    return false;
  }
  if (cmd.volume === undefined) {
    ctx.fail("audio_volume-missing-volume", "audio_volume 需要 volume");
    return false;
  }
  if (previous.state.kind !== "play") {
    ctx.fail(
      "audio_volume-instance-stopped",
      `实例 ${instanceId} 当前是停止状态：先 audio_play 起播再调音量`,
    );
    return false;
  }
  const volume = audioVolume(ctx, cmd.volume, "audio_volume", previous.channel);
  if (volume === null) return false;
  writeInstance(ctx, table, instanceId, previous.channel, {
    ...previous.state,
    volume,
  });
  return true;
}

/**
 * 暂停全部实例：正在出声的实例转 `pause` 态，暂停前的播放态进 `SYS.audioPaused`。
 *
 * 常驻四通道由 `audio_pause` 覆盖，实例是另一张表，必须单独走一遍——否则
 * 「引擎暂停」只让 BGM 收声，故事里正在放的环境音实例照旧出声。
 * 记账与通道共用同一张表（同一概念一处声明），实例键加 `inst:` 前缀区分归属。
 *
 * 不经 op、直接改状态：这是引擎级暂停的内部步骤，不产生命令面的语义
 * （作者手写的 `audio_pause` 只作用于四通道，暂停态仍由同一把「引擎已暂停」的闸门拦住推进）。
 */
export function pauseAudioInstances(ctx: OpContext): void {
  const table = instanceTableOf(ctx);
  const ids = Object.keys(table);
  if (ids.length === 0) return;
  const paused = readPausedPlayStates(ctx);
  const next: Record<string, AudioInstanceState> = { ...table };
  let changed = false;
  for (const id of ids) {
    const entry = table[id];
    if (entry === undefined || !isPlayState(entry.state)) continue;
    ctx.mediaSeq += 1;
    paused[PAUSE_KEY_PREFIX + id] = entry.state;
    next[id] = {
      channel: entry.channel,
      state: { kind: "pause", seq: ctx.mediaSeq } satisfies AudioChannelState,
    };
    changed = true;
  }
  if (!changed) return;
  ctx.setSystem(SYS.audioInstances, next satisfies AudioInstanceTable);
  ctx.setSystem(SYS.audioPaused, paused);
}

/**
 * 恢复全部实例：按记账写回暂停前的播放态并递增 `seq`。
 *
 * 只认 `pause` 态：暂停期间被命令改成 `stop` 的实例不复活——留着一条「该出声却
 * 永远不出声」的实例比让它停着更糟，与通道恢复同一口径。
 */
export function resumeAudioInstances(ctx: OpContext): void {
  const table = instanceTableOf(ctx);
  const ids = Object.keys(table);
  if (ids.length === 0) return;
  const paused = readPausedPlayStates(ctx);
  const next: Record<string, AudioInstanceState> = { ...table };
  let changed = false;
  for (const id of ids) {
    const entry = table[id];
    if (entry === undefined || entry.state.kind !== "pause") continue;
    const key = PAUSE_KEY_PREFIX + id;
    const resumed = paused[key];
    if (resumed === undefined) continue;
    delete paused[key];
    ctx.mediaSeq += 1;
    next[id] = {
      channel: entry.channel,
      state: { ...resumed, seq: ctx.mediaSeq },
    };
    changed = true;
  }
  if (!changed) return;
  ctx.setSystem(SYS.audioInstances, next satisfies AudioInstanceTable);
  ctx.setSystem(SYS.audioPaused, paused);
}
