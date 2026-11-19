/**
 * 视频族：核心只写命令流（`__video`，seq 单调），渲染器按序执行。
 */
import {
  SYS,
  type StoryCommand,
  type VideoCommand,
} from "../../../contracts/index.ts";
import type { Frame, OpContext } from "../../internal/index.ts";
import { audioVolume, mediaSeconds } from "./shared.ts";

/** 视频族已知负载字段（未知字段 fail-closed） */
const VIDEO_FIELDS: Record<string, ReadonlySet<string>> = {
  video: new Set(["op", "resource", "volume", "loop", "restart", "z"]),
  cutscene: new Set(["op", "resource", "volume", "skipable", "restart", "z"]),
  seek_video: new Set(["op", "seconds"]),
  pause_video: new Set(["op"]),
  resume_video: new Set(["op"]),
  stop_video: new Set(["op"]),
  video_skipable: new Set(["op", "value"]),
};

/**
 * 视频族：核心只写命令流（`__video`，seq 单调），渲染器按序执行。
 * - `video` = 非阻塞播放（故事继续）；`cutscene` = 阻塞过场（等待建立时提交检查点，
 *   同 menu/wait/input；ended/跳过解除）。
 * - 同资源重写默认无缝续播（沿用旧 seq，渲染器不打断当前画面）；`restart=true`
 *   才领新序号从头重播——与音频通道族同口径。`cutscene` 例外：每次过场都是一次
 *   新的阻塞呈现，渲染器要重新登记 ended 回调来解除等待，所以恒领新序号。
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
    const previous = ctx.get(SYS.video) as VideoCommand | undefined;
    const sameTrack =
      !cutscene &&
      cmd.restart !== true &&
      previous?.kind === "play" &&
      previous.resource === cmd.resource;
    let seq: number;
    if (
      sameTrack &&
      previous !== undefined &&
      previous.kind === "play" &&
      typeof previous.seq === "number"
    ) {
      // 同资源续播：沿用旧序号，渲染器据此判定「还是那一轨」，不打断当前画面
      seq = previous.seq;
    } else {
      ctx.videoSeq += 1;
      seq = ctx.videoSeq;
    }
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
  ctx.videoSeq += 1;
  const seq = ctx.videoSeq;
  if (cmd.op === "seek_video") {
    const seconds = mediaSeconds(ctx, cmd.seconds, cmd.op);
    if (seconds === null) return false;
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
  // video_skipable：布尔严格——非布尔值拒绝，不做「非 false 一律 true」的宽松 coercion
  if (typeof cmd.value !== "boolean") {
    ctx.fail(
      "video_skipable-invalid-value",
      "video_skipable 的 value 必须是布尔值（true / false）",
    );
    return false;
  }
  ctx.setSystem(SYS.videoSkipable, cmd.value);
  return true;
}
