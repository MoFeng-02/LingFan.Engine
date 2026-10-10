/**
 * Script 词汇层 · **音频域**（bgm / se / ambient / voice 四通道 + 对称 stop）。
 * 生命周期由作者手动控制（引擎 R7：状态走 `__audio_*` 系统键 ⇒ 快照/存档/回溯随行）。
 * Options 派生自 schema（零漂移）；voice 例外——autoStop 是作者侧驼峰词，
 * builder 负责映射到 op 的 auto_stop 字段。
 */
import type { CommandOf } from "../../schema";

export type BgmOptions = Omit<CommandOf<"bgm">, "op" | "resource">;

export type PlayOptions = Pick<BgmOptions, "volume">;

export type StopOptions = Omit<CommandOf<"stop_bgm">, "op">;

export function bgm(resource: string, opts?: BgmOptions): CommandOf<"bgm"> {
  return { op: "bgm", resource, ...opts };
}

export function stopBgm(opts?: StopOptions): CommandOf<"stop_bgm"> {
  return { op: "stop_bgm", ...opts };
}

export function se(resource: string, opts?: PlayOptions): CommandOf<"se"> {
  return { op: "se", resource, ...opts };
}

export function ambient(
  resource: string,
  opts?: BgmOptions,
): CommandOf<"ambient"> {
  return { op: "ambient", resource, ...opts };
}

export function stopAmbient(opts?: StopOptions): CommandOf<"stop_ambient"> {
  return { op: "stop_ambient", ...opts };
}

export interface VoiceOptions extends PlayOptions {
  autoStop?: boolean;
  restart?: boolean;
}

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

export function stopVoice(opts?: StopOptions): CommandOf<"stop_voice"> {
  return { op: "stop_voice", ...opts };
}
