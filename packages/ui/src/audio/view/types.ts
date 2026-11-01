/**
 * 音频渲染域的形状：视图（状态快照）与端口动作（差量结果）。
 *
 * 两者是「状态 → 动作」这一层的唯一形状来源：规划器只产出 `AudioAction`，渲染器只消费它，
 * 中间不再有第二套中间态。
 */
import type { AudioChannel, AudioChannelState } from "@lingfan-engine/core";

/**
 * 渲染视图：四通道状态 + 实例状态 + bgm 播放位置（帧级键直读，不进事件流）。
 *
 * 实例表按 id 收进视图（`instanceId → 状态`），只取三态里的 kind 与 seq 做差量；
 * 通道与实例是两张表，各自独立判定，互不代偿。
 */
export interface AudioView {
  bgm: AudioChannelState | null;
  ambient: AudioChannelState | null;
  voice: AudioChannelState | null;
  se: AudioChannelState | null;
  instances: Readonly<Record<string, AudioChannelState>>;
  bgmPosition: number;
}

/** 端口动作：play = 播放/更新/定位/重播，stop = 停止（fadeMs 淡出），pause/resume = 可恢复暂停 */
export type AudioAction =
  | {
      type: "play";
      channel: AudioChannel;
      resource: string;
      volume: number;
      loop: boolean;
      position: number;
      fadeMs: number;
      /** true = 回到 position 重播；false = 同资源无缝续播/更新 */
      restart: boolean;
    }
  | { type: "stop"; channel: AudioChannel; fadeMs: number }
  | { type: "pause"; channel: AudioChannel }
  | { type: "resume"; channel: AudioChannel }
  | { type: "pauseInstance"; instanceId: string }
  | { type: "resumeInstance"; instanceId: string };
