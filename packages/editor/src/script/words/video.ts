/**
 * Script 词汇层 · **视频域**（video / cutscene / seek / pause / resume / stop / skipable）。
 * Options 派生自 schema（零漂移）；返回类型 = `CommandOf<op>` 判别联合成员。
 */
import type { CommandOf } from "../../schema/index.ts";

/** video / cutscene 共用的可选项：volume 音量、loop 循环、z 视频层层级 */
export type VideoOptions = Omit<CommandOf<"video">, "op" | "resource">;

/**
 * 播放视频（非阻塞）：画面切到视频层，故事**立即继续**执行下一句，
 * 视频在背景里继续播。
 * @param resource 视频资源路径。
 * @param opts 可选项：volume 音量、loop 循环、z 层级。
 * @returns `video` 故事命令。
 * @example
 * video("video/opening.mp4");
 */
export function video(
  resource: string,
  opts?: VideoOptions,
): CommandOf<"video"> {
  return { op: "video", resource, ...opts };
}

export type CutsceneOptions = Omit<CommandOf<"cutscene">, "op" | "resource">;

/**
 * 播放过场（阻塞）：故事**等待**视频播完（或被玩家跳过）才继续。
 * 过场开始时建立回溯检查点；开启 autoSave 时此处自动存档。
 *
 * 可跳过性：显式传 `skipable` 优先；否则用 {@link videoSkipable} 的全局
 * 开关；两者都未设置时缺省可跳过。
 *
 * @param resource 视频资源路径。
 * @param opts 可选项：volume 音量、loop 循环、skipable 可点击跳过、z 层级。
 * @returns `cutscene` 故事命令。
 * @example
 * cutscene("video/intro.mp4", { skipable: true });
 */
export function cutscene(
  resource: string,
  opts?: CutsceneOptions,
): CommandOf<"cutscene"> {
  return { op: "cutscene", resource, ...opts };
}

/**
 * 把当前视频跳转到第 `seconds` 秒（立即生效，故事继续）。
 * @param seconds 目标时刻（秒）。
 * @returns `seek_video` 故事命令。
 */
export function seekVideo(seconds: number): CommandOf<"seek_video"> {
  return { op: "seek_video", seconds };
}

/** 暂停当前视频（立即生效，故事继续）。@returns `pause_video` 故事命令。 */
export function pauseVideo(): CommandOf<"pause_video"> {
  return { op: "pause_video" };
}

/** 继续播放已暂停的视频（立即生效，故事继续）。@returns `resume_video` 故事命令。 */
export function resumeVideo(): CommandOf<"resume_video"> {
  return { op: "resume_video" };
}

/** 停止并关闭当前视频层（立即生效，故事继续）。@returns `stop_video` 故事命令。 */
export function stopVideo(): CommandOf<"stop_video"> {
  return { op: "stop_video" };
}

/**
 * 设置「视频可跳过」全局开关（持久生效，影响之后的视频与过场；
 * 过场显式传 skipable 时以其为准）。立即生效、故事继续。
 * @param value true = 允许玩家跳过视频。
 * @returns `video_skipable` 故事命令。
 */
export function videoSkipable(value: boolean): CommandOf<"video_skipable"> {
  return { op: "video_skipable", value };
}
