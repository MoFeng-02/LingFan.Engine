/**
 * 引擎级暂停与恢复：把「停住」与「中断」分成两件事。
 *
 * 暂停只做三件事——挂起等待定时器、让正在出声的媒体收声、记下暂停标记；
 * 外部接管（小游戏 / 玩法系统 / 扩展 op 等待）**保持挂载**，它们只是不再收到推进输入。
 * 所以这里不调 `abortExternalTakeovers`：那是中断的语义（销毁、导航、读档、回溯），
 * 调了之后宿主会卸载接管面板，再恢复就不是「接着玩」而是「重进」。
 *
 * 恢复按暂停时记下的剩余毫秒续上原来的等待，媒体按**当前状态**逐个恢复——
 * 暂停期间被命令改成 stop 的通道不复活（留着一条「该出声却永远不出声」的通道更糟）。
 */
import { SYS, type VideoCommand } from "../contracts/index.ts";
import {
  armWaitTimer,
  nowMs,
  pausedSession,
  type OpContext,
} from "./internal/index.ts";
import {
  execAudioPause,
  execAudioResume,
  pauseAudioInstances,
  resumeAudioInstances,
} from "./ops/index.ts";

/** 视频命令流里「正在播」的形态判定（暂停只对正在播的过场有意义） */
function playingVideo(value: unknown): value is VideoCommand {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "play"
  );
}

/** 视频命令流里「已暂停」的形态判定（恢复只对暂停过的过场有意义） */
function pausedVideo(value: unknown): value is VideoCommand {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "pause"
  );
}

/**
 * 挂起等待定时器：记下剩余毫秒并取消，等恢复时按剩余量重排。
 *
 * 剩余量靠到期时刻与当前时刻相减——`clear` 之后句柄再也问不出「还剩多久」。
 * 没有到期时刻（非本模块建立的定时器）就退回「不知道剩余量」，
 * 恢复时宁可丢弃这段等待，也不排一个凭空多出来的完整时长。
 */
function suspendWaitTimer(ctx: OpContext): void {
  const handle = ctx.pendingTimer;
  if (handle === null) return;
  const dueAt = ctx.pendingTimerDueAt;
  ctx.pausedTimerRemainingMs =
    dueAt === null ? null : Math.max(0, dueAt - nowMs(ctx));
  ctx.timerPort.clear(handle);
  ctx.pendingTimer = null;
  ctx.pendingTimerDueAt = null;
}

/**
 * 引擎级暂停：幂等，重复调用不改状态、不重复发事件。
 *
 * 常驻音频复用 `audio_pause` 的执行语义（只暂停 play 态、把暂停前的播放态记账），
 * 引擎级暂停与作者手写 `audio_pause` 因此是同一件事，恢复时走同一条路。
 * 实例族另走一遍：它们是另一张表（`SYS.audioInstances`），不受通道暂停覆盖，
 * 漏掉就会留下「引擎已暂停、作者编排的环境音还在放」的状态。
 */
export function pauseSession(ctx: OpContext): void {
  if (pausedSession(ctx)) return;
  ctx.setSystem(SYS.paused, true);
  suspendWaitTimer(ctx);
  execAudioPause(ctx, { op: "audio_pause" });
  pauseAudioInstances(ctx);
  const video = ctx.get(SYS.video);
  if (playingVideo(video)) {
    ctx.videoSeq += 1;
    ctx.setSystem(SYS.video, {
      kind: "pause",
      seq: ctx.videoSeq,
    } satisfies VideoCommand);
  }
}

/**
 * 解除引擎级暂停：未暂停时幂等空操作。
 *
 * 续起等待前先确认故事仍停在同一个 wait 上——暂停期间可能读过档或导航过，
 * 那时剩余毫秒属于一段已经不存在的等待，排出来只会提前解除别的等待。
 */
export function resumeSession(ctx: OpContext): void {
  if (!pausedSession(ctx)) return;
  ctx.setSystem(SYS.paused, false);
  const remaining = ctx.pausedTimerRemainingMs;
  ctx.pausedTimerRemainingMs = null;
  if (
    remaining !== null &&
    ctx.pendingTimer === null &&
    ctx.get(SYS.waiting) === "wait"
  ) {
    armWaitTimer(ctx, remaining);
  }
  execAudioResume(ctx, { op: "audio_resume" });
  resumeAudioInstances(ctx);
  const video = ctx.get(SYS.video);
  if (pausedVideo(video)) {
    ctx.videoSeq += 1;
    ctx.setSystem(SYS.video, {
      kind: "resume",
      seq: ctx.videoSeq,
    } satisfies VideoCommand);
  }
}
