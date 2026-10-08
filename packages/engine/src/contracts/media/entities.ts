/**
 * 媒体契约的数据形态：音频通道状态与视频命令，都是写进系统键、随后被界面读走的值。
 * 引擎只写这些值，真正的播放交给适配器。
 *
 * 端口（播放器要实现的方法集合）见同目录 `ports.ts`。
 */

/** 四通道：bgm 循环 / se 一次性 / ambient 独立循环层 / voice 互斥 */
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
      /** voice 专有：推进到下一句时自动停止（auto_stop） */
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

/** 音频播放参数（端口入参，核心不碰解码器） */
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
