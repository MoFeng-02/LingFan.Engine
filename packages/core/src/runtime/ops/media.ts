/**
 * 媒体命令的执行：音频通道、视频命令流、出站通知。
 *
 * 这一族的共同点是「核心只写状态，播放交给宿主」——音频写四通道的通道对象，
 * 视频写单调递增的命令流，通知只发出站事件。渲染器按状态与事件执行，
 * 核心不持有播放器，也不关心播放是否成功。
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
  type OutboundEvent,
  type OutboundPayload,
  type StoryCommand,
  type VideoCommand,
} from "../../contracts/index.ts";
import { interpolateText } from "../expr/index.ts";
import type { Frame, OpContext } from "../internal/index.ts";

/** 音频 op 已知负载字段（未知字段 fail-closed） */
const AUDIO_FIELDS: Record<string, ReadonlySet<string>> = {
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
};

/** 停止类 op → 目标常驻通道系统键 */
const AUDIO_STOP_KEY: Record<string, string> = {
  stop_bgm: SYS.audioBgm,
  stop_ambient: SYS.audioAmbient,
  stop_voice: SYS.audioVoice,
};

/** 音频通道 op → 常驻通道系统键（se 为一次性触发，不在表内） */
const AUDIO_CHANNEL_KEY: Record<string, string> = {
  bgm: SYS.audioBgm,
  ambient: SYS.audioAmbient,
  voice: SYS.audioVoice,
};

/** 视频族已知负载字段（未知字段 fail-closed） */
const VIDEO_FIELDS: Record<string, ReadonlySet<string>> = {
  video: new Set(["op", "resource", "volume", "loop", "z"]),
  cutscene: new Set(["op", "resource", "volume", "skipable", "z"]),
  seek_video: new Set(["op", "seconds"]),
  pause_video: new Set(["op"]),
  resume_video: new Set(["op"]),
  stop_video: new Set(["op"]),
  video_skipable: new Set(["op", "value"]),
};

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
function audioVolume(
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
function audioFade(ctx: OpContext, raw: unknown, op: string): number | null {
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    ctx.fail(`${op}-invalid-fade`, `${op} 的 fade 必须是非负有限数字（毫秒）`);
    return null;
  }
  return raw;
}

/**
 * 视频族：核心只写命令流（`__video`，seq 单调），渲染器按序执行。
 * - `video` = 非阻塞播放（故事继续）；`cutscene` = 阻塞过场（等待建立时提交检查点，
 *   同 menu/wait/input；ended/跳过解除）。
 * - `seek_video`/`pause_video`/`resume_video`/`stop_video` 为离散命令；
 *   `video_skipable` 设后续 video/cutscene 的缺省 skipable。
 */
export function execVideo(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
  cutscene = false,
): boolean {
  const known = VIDEO_FIELDS[cmd.op]!;
  const unknown = Object.keys(cmd).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  ctx.videoSeq += 1;
  const seq = ctx.videoSeq;
  if (cmd.op === "video" || cmd.op === "cutscene") {
    if (ctx.rejectBadInstanceZ(cmd)) return false; // 先拒非法 z（不动状态）
    ctx.setInstanceZ(SYS.videoZ, cmd.z); // 视频层实例 z（宿主解析后交 VideoPort.setZIndex）
    if (typeof cmd.resource !== "string" || cmd.resource === "") {
      ctx.fail(
        `${cmd.op}-invalid-resource`,
        `${cmd.op} 需要非空 resource 字符串`,
      );
      return false;
    }
    const volume = audioVolume(ctx, cmd.volume, cmd.op);
    if (volume === null) return false;
    // skipable：cutscene 显式参数 > video_skipable 持久开关（缺省可跳）
    const skipable =
      cutscene && cmd.skipable !== undefined
        ? cmd.skipable === true
        : ctx.get(SYS.videoSkipable) !== false;
    ctx.setSystem(SYS.video, {
      kind: "play",
      resource: cmd.resource,
      volume,
      loop: cmd.loop === true,
      cutscene,
      skipable,
      seq,
    } satisfies VideoCommand);
    if (cutscene) {
      // 过场等待建立时提交检查点（同 menu/wait/input）；重放期同坐标原位替换
      ctx.setSystem(SYS.waiting, "video");
      ctx.commitCheckpoint(ctx.takeSnapshot(ctx.checkpointCoord(frame)));
      ctx.liveCheckpointed = true;
      ctx.autoSaveAtCheckpoint(); // cutscene 等待画面建立 = auto_save 消费点
      frame.index += 1;
    }
    return true;
  }
  if (cmd.op === "seek_video") {
    const seconds = cmd.seconds;
    if (
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      ctx.fail(
        "seek_video-invalid-seconds",
        "seek_video 需要非负有限数字（秒）",
      );
      return false;
    }
    ctx.setSystem(SYS.video, {
      kind: "seek",
      seconds,
      seq,
    } satisfies VideoCommand);
    return true;
  }
  if (cmd.op === "pause_video") {
    ctx.setSystem(SYS.video, { kind: "pause", seq } satisfies VideoCommand);
    return true;
  }
  if (cmd.op === "resume_video") {
    ctx.setSystem(SYS.video, { kind: "resume", seq } satisfies VideoCommand);
    return true;
  }
  if (cmd.op === "stop_video") {
    ctx.setSystem(SYS.video, { kind: "stop", seq } satisfies VideoCommand);
    return true;
  }
  // video_skipable
  ctx.setSystem(SYS.videoSkipable, cmd.value !== false);
  return true;
}

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

/** notify：出站 toast 事件（覆盖层）；文本插值与 say 同语义 */
export function execNotify(ctx: OpContext, cmd: StoryCommand): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  const { text, errors } = interpolateText(
    ctx.translate(cmd.text as string),
    ctx.resolveName,
    ctx.draw,
  );
  for (const e of errors)
    ctx.fail(e.code, ctx.texts.interpolationFallback(e.message));
  ctx.setInstanceZ(SYS.notificationsZ, cmd.z); // 本条通知的实例 z（notifications 层）
  const payload: OutboundPayload = {
    kind: "notify",
    text,
    ...(typeof cmd.type === "string" ? { notifyType: cmd.type } : {}),
    ...(typeof cmd.duration === "number" ? { duration: cmd.duration } : {}),
  };
  const event: OutboundEvent = { v: 1, kind: "event", payload };
  for (const listener of ctx.eventListeners) listener(event);
}
