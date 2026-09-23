/**
 * 08 §六 媒体契约（四音频通道）：核心只写状态，播放由适配器落地（U1/U6）。
 * 端口入参为**已解析 URL**——资源寻址归 ResourcePort，媒体可能是加密资源。
 */

/** 08 §六.1 四通道：bgm 循环 / se 一次性 / ambient 独立循环层 / voice 互斥 */
export type AudioChannel = "bgm" | "se" | "ambient" | "voice";

/**
 * 通道状态（SSOT 系统键值）：play = 播放或续播，stop = 停止（fadeMs 淡出）；null = 从未触碰。
 * `stop` 独立成形态，避免用哨兵资源名承载「停止」而丢失淡出参数。
 */
export type AudioChannelState =
  | {
      kind: "play";
      resource: string;
      /** 0..1（越界由执行器钳制） */
      volume: number;
      loop: boolean;
      /** 本次变更的淡入毫秒（0 = 立即） */
      fadeMs: number;
      /** voice 专有：推进到下一句时自动停止（08 §六.1 auto_stop） */
      autoStop?: boolean;
      /** 显式重播：同曲重写默认无缝续播（seek），restart=true 才回到起点 */
      restart?: boolean;
      /**
       * 本次写入的单调序号（se 每次触发 / restart 重播都递增，不进快照）：
       * 让「同一资源连续两次写入」也能被渲染层识别为两次独立事件。
       */
      seq?: number;
    }
  | { kind: "stop"; fadeMs: number };

/** 08 §六 音频播放参数（端口入参，核心不碰解码器） */
export interface AudioPlayOptions {
  volume: number;
  loop: boolean;
  /** 起始位置（秒） */
  position: number;
  /** 淡入毫秒（0 = 立即） */
  fadeMs: number;
  /** true = 同 URL 也回到 position 重播（无缝续播的反面，显式请求） */
  restart: boolean;
}

/**
 * 08 §六 音频端口：实现 = infra 适配器（WebView 解码，Desktop/Mobile 同契约）。
 * 入参为**已解析 URL**（资源寻址归 ResourcePort，08-U7）；同 URL 且 restart=false = 更新而非重头播。
 */
export interface AudioPort {
  play(channel: AudioChannel, url: string, options: AudioPlayOptions): void;
  stop(channel: AudioChannel, fadeMs?: number): void;
  /** 当前播放位置（秒）；未播放返回 0（帧级回写用，08 §三.2） */
  position(channel: AudioChannel): number;
  dispose(): void;
}

// —— 08 §六.5 视频（单通道命令流）：新 video 替换当前；Desktop/Mobile 同契约 ——

/**
 * 视频命令（SSOT 系统键值，seq 单调有序）：渲染器按 seq 执行——
 * `video`/`cutscene` 发 play，`pause_video`/`resume_video`/`seek_video`/`stop_video`
 * 各发对应命令。cutscene = play 且 cutscene:true（引擎进入 video 等待）。
 */
export type VideoCommand =
  | {
      kind: "play";
      resource: string;
      /** 0..1 */
      volume: number;
      loop: boolean;
      /** true = 阻塞过场（引擎处于 video 等待，ended/跳过后解除） */
      cutscene: boolean;
      /** 可跳过（cutscene 时生效） */
      skipable: boolean;
      seq: number;
    }
  | { kind: "pause"; seq: number }
  | { kind: "resume"; seq: number }
  | { kind: "seek"; seconds: number; seq: number }
  | { kind: "stop"; seq: number };

/**
 * 视频端口：实现 = infra 适配器（WebView 解码，舞台层覆盖呈现）。
 * 入参为**已解析 URL**（资源寻址归 ResourcePort，08-U7）。
 * `onEnded`：自然播放结束回调（cutscene 由它解除引擎等待；非阻塞 video 可忽略）。
 */
export interface VideoPort {
  play(
    url: string,
    options: { volume: number; loop: boolean },
    onEnded?: () => void,
  ): void;
  pause(): void;
  resume(): void;
  seek(seconds: number): void;
  stop(): void;
  dispose(): void;
}
