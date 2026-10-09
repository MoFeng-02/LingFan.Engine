/**
 * 媒体命令的执行：音频通道、视频命令流、出站通知。
 *
 * 这一族的共同点是「核心只写状态，播放交给宿主」——音频写四通道的通道对象，
 * 视频写单调递增的命令流，通知只发出站事件。渲染器按状态与事件执行，
 * 核心不持有播放器，也不关心播放是否成功。
 */
import {
  SYS,
  type AudioChannelState,
  type OutboundEvent,
  type OutboundPayload,
  type StoryCommand,
  type VideoCommand,
} from "../../contracts";
import { interpolateText } from "../expr";
import type { Frame, OpContext } from "../internal";

/** 音频 op 已知负载字段（未知字段 fail-closed） */
const AUDIO_FIELDS: Record<string, ReadonlySet<string>> = {
  bgm: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  se: new Set(["op", "resource", "volume"]),
  ambient: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  stop_bgm: new Set(["op", "fade"]),
  stop_ambient: new Set(["op", "fade"]),
  voice: new Set(["op", "resource", "volume", "auto_stop", "restart"]),
  stop_voice: new Set(["op", "fade"]),
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
  const volume = audioVolume(ctx, cmd.volume, cmd.op);
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

/** volume 窄化：缺省 1；非有限数字 fail-closed，越界按物理范围钳制 */
function audioVolume(ctx: OpContext, raw: unknown, op: string): number | null {
  if (raw === undefined) return 1;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    ctx.fail(`${op}-invalid-volume`, `${op} 的 volume 必须是有限数字`);
    return null;
  }
  return Math.min(1, Math.max(0, raw));
}

/** fade 窄化：缺省 0；负数/非有限数字 fail-closed */
function audioFade(ctx: OpContext, raw: unknown, op: string): number | null {
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    ctx.fail(
      `${op}-invalid-fade`,
      `${op} 的 fade 必须是非负有限数字（毫秒）`,
    );
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

/** notify：出站 toast 事件（覆盖层）；文本插值与 say 同语义 */
export function execNotify(ctx: OpContext, cmd: StoryCommand): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  const { text, errors } = interpolateText(
    ctx.translate(cmd.text as string),
    ctx.resolveName,
    ctx.draw,
  );
  for (const e of errors)
    ctx.fail(e.code, `插值失败（保留原文）：${e.message}`);
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
