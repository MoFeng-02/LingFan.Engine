/**
 * 媒体契约的数据形态：音频通道状态与视频命令，都是写进系统键、随后被界面读走的值。
 * 引擎只写这些值，真正的播放交给适配器。
 *
 * 端口（播放器要实现的方法集合）见同目录 `ports.ts`。
 */
import { SHORT_ID_PATTERN } from "../identifiers.ts";

/** 四通道：bgm 循环 / se 一次性 / ambient 独立循环层 / voice 互斥 */
export type AudioChannel = "bgm" | "se" | "ambient" | "voice";

/**
 * 通道全集（顺序即偏好表的书写顺序）。
 *
 * 唯一声明处：解析工程默认音量、判通道合法性、渲染层逐通道取状态都读它，
 * 各处不得自建同名数组——多一份就多一个「新增通道时漏改」的位置。
 */
export const AUDIO_CHANNELS: readonly AudioChannel[] = [
  "bgm",
  "se",
  "ambient",
  "voice",
];

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
  | {
      kind: "stop";
      fadeMs: number;
      /**
       * 停止请求的单调序号（仅 `se` 写入，不进快照）：
       * `se` 是「一次性触发 + 可停止」的通道，连续两次 `stop_se` 也必须是两次独立事件，
       * 否则渲染层无法分辨「又停了一次」与「状态没变」。
       */
      seq?: number;
    };

/**
 * 音频实例的 id 形态：与扩展 / 玩法系统的短 id 同源（同一份 `SHORT_ID_PATTERN`）。
 *
 * 作者要在故事里按名字点名实例（`audio_play inst="rain"`），所以 id 也是契约的一部分；
 * 另写一条正则会立刻与短 id 分叉，故这里只是**别名**，改一处即三处生效。
 */
export const AUDIO_INSTANCE_ID_PATTERN = SHORT_ID_PATTERN;

/**
 * 同时存活的音频实例上限。
 *
 * 整张表是一个状态值 ⇒ 每加一个实例都进快照、进存档。上限不是为了省内存
 * （真实瓶颈在解码器那边），而是为了让「存档体积」这件事有界：没有上限时
 * 一个循环里的 `audio_play` 能把存档撑到无法写盘，而那种错发现得太晚。
 */
export const MAX_AUDIO_INSTANCES = 32;

/**
 * 单个音频实例的状态：**归属哪条通道** + 与通道键同构的播放状态。
 *
 * 为什么要记 `channel`：音量偏好是按通道分的（BGM 0.8 / 音效 0.6 …），
 * 不记归属就没法把偏好乘到实例上，作者也只能靠命名猜。
 */
export interface AudioInstanceState {
  readonly channel: AudioChannel;
  readonly state: AudioChannelState;
}

/**
 * 音频实例表（SSOT 系统键 `__audio_instances` 的值）：实例 id → 状态。
 *
 * **写时复制**：整表是一个值，改写时必须新建对象而不是原地改字段——快照与存档
 * 持有的是同一个引用的历史版本，原地改会让回溯拿到被污染的值。
 */
export type AudioInstanceTable = Readonly<Record<string, AudioInstanceState>>;

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
