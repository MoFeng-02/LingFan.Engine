/**
 * Script 词汇层 · **视频域**（video / cutscene / seek / pause / resume / stop / skipable）。
 * Options 派生自 schema（零漂移）；返回类型 = `CommandOf<op>` 判别联合成员。
 */
import type { CommandOf } from "../../schema/opSchemas";

export type VideoOptions = Omit<CommandOf<"video">, "op" | "resource">;

export function video(
  resource: string,
  opts?: VideoOptions,
): CommandOf<"video"> {
  return { op: "video", resource, ...opts };
}

export type CutsceneOptions = Omit<CommandOf<"cutscene">, "op" | "resource">;

/** 过场（阻塞，建立检查点）；skipable ⇒ 可点击跳过 */
export function cutscene(
  resource: string,
  opts?: CutsceneOptions,
): CommandOf<"cutscene"> {
  return { op: "cutscene", resource, ...opts };
}

export function seekVideo(seconds: number): CommandOf<"seek_video"> {
  return { op: "seek_video", seconds };
}

export function pauseVideo(): CommandOf<"pause_video"> {
  return { op: "pause_video" };
}

export function resumeVideo(): CommandOf<"resume_video"> {
  return { op: "resume_video" };
}

export function stopVideo(): CommandOf<"stop_video"> {
  return { op: "stop_video" };
}

/** 视频可跳开关（全局语义开关；bool 必填） */
export function videoSkipable(value: boolean): CommandOf<"video_skipable"> {
  return { op: "video_skipable", value };
}
