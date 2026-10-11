/**
 * Script 词汇层 · **音频域**（bgm / se / ambient / voice 四通道 + 对称 stop）。
 * 生命周期由作者手动控制（引擎 R7：状态走 `__audio_*` 系统键 ⇒ 快照/存档/回溯随行）。
 * Options 派生自 schema（零漂移）；voice 例外——autoStop 是作者侧驼峰词，
 * builder 负责映射到 op 的 auto_stop 字段。
 */
import type { CommandOf } from "../../schema";

/** bgm / ambient 共用的可选项：volume 音量、loop 循环、fade 渐入毫秒、restart 重播 */
export type BgmOptions = Omit<CommandOf<"bgm">, "op" | "resource">;

/** 一次性播放（se）的可选项：只有音量 */
export type PlayOptions = Pick<BgmOptions, "volume">;

/** stop_* 共用的可选项：fade 渐出毫秒 */
export type StopOptions = Omit<CommandOf<"stop_bgm">, "op">;

/**
 * 播放背景音乐：立即开始（故事继续，不等待），一直循环播放到
 * {@link stopBgm} 或下一次换曲。
 *
 * - `loop` 缺省循环；`volume` 缺省 1（范围 0–1）；`fade` 渐入毫秒（缺省 0）。
 * - 同一曲重复调用保留播放位置；换曲或 `restart: true` 时从 0 重播。
 * - 通道状态随快照/存档/回溯走：回溯到检查点时 BGM 自动恢复到当时的曲子。
 *
 * @param resource 音频资源路径。
 * @param opts 可选项，见 {@link BgmOptions}。
 * @returns `bgm` 故事命令。
 * @example
 * bgm("audio/town.mp3", { fade: 1000 });
 * stopBgm();
 */
export function bgm(resource: string, opts?: BgmOptions): CommandOf<"bgm"> {
  return { op: "bgm", resource, ...opts };
}

/**
 * 停止背景音乐：立即停止（`fade` 渐出毫秒，缺省立即），故事继续。
 * @param opts 可选项：fade 渐出毫秒。
 * @returns `stop_bgm` 故事命令。
 */
export function stopBgm(opts?: StopOptions): CommandOf<"stop_bgm"> {
  return { op: "stop_bgm", ...opts };
}

/**
 * 播放一次性音效（不循环）：立即开始（故事继续，不等待），播完自然结束。
 * @param resource 音频资源路径。
 * @param opts 可选项：volume 音量（缺省 1，范围 0–1）。
 * @returns `se` 故事命令。
 * @example
 * se("audio/door_open.ogg");
 */
export function se(resource: string, opts?: PlayOptions): CommandOf<"se"> {
  return { op: "se", resource, ...opts };
}

/**
 * 播放环境音：语义同 {@link bgm}（独立通道、缺省循环、状态随存档/回溯走），
 * 常用于雨声、市场喧闹等持续底噪。
 * @param resource 音频资源路径。
 * @param opts 可选项，见 {@link BgmOptions}。
 * @returns `ambient` 故事命令。
 * @example
 * ambient("audio/rain_loop.ogg");
 */
export function ambient(
  resource: string,
  opts?: BgmOptions,
): CommandOf<"ambient"> {
  return { op: "ambient", resource, ...opts };
}

/** 停止环境音（`fade` 渐出毫秒，缺省立即），故事继续。 */
export function stopAmbient(opts?: StopOptions): CommandOf<"stop_ambient"> {
  return { op: "stop_ambient", ...opts };
}

/** voice 的可选项：autoStop 自动停止、restart 同曲重播、volume 音量 */
export interface VoiceOptions extends PlayOptions {
  autoStop?: boolean;
  restart?: boolean;
}

/**
 * 播放语音（独立通道、不循环）：立即开始（故事继续，不等待）。
 *
 * - `autoStop` 缺省 true：语音不再需要时自动停止；需要手动管理时设为
 *   false 并用 {@link stopVoice}。
 * - `restart: true` 强制从头重播同一条语音；`volume` 缺省 1。
 *
 * @param resource 语音资源路径。
 * @param opts 可选项，见 {@link VoiceOptions}。
 * @returns `voice` 故事命令。
 * @example
 * voice("audio/line_01.ogg", { volume: 0.9 });
 */
export function voice(
  resource: string,
  opts?: VoiceOptions,
): CommandOf<"voice"> {
  return {
    op: "voice",
    resource,
    ...(opts?.autoStop === undefined ? {} : { auto_stop: opts.autoStop }),
    ...(opts?.restart === undefined ? {} : { restart: opts.restart }),
    ...(opts?.volume === undefined ? {} : { volume: opts.volume }),
  };
}

/** 停止语音（`fade` 渐出毫秒，缺省立即），故事继续。 */
export function stopVoice(opts?: StopOptions): CommandOf<"stop_voice"> {
  return { op: "stop_voice", ...opts };
}
