/**
 * 音频域 op 负载：四通道（bgm / se / ambient / voice）+ 对称 stop + 实例编排。
 *
 * 负载用 type 别名（对象字面量带隐式索引签名，CommandOf 产物可赋给
 * StoryCommand 的开放索引签名）；域 map 用 interface。运行期约束
 * （非空 / 有限 / 短 id 正则）归 editor 校验器，类型面只承载结构。
 * 通道字面量联合复用 contracts/media/entities.ts 的 AudioChannel（import 不重声明）。
 */
import type { AudioChannel } from "../../contracts/media/entities.ts";

/** 播放类共用的资源 + 音量片段（域内片段，不进跨域 shared） */
export type PlayFields = {
  resource: string;
  volume?: number;
};

/** bgm：循环背景音乐（ambient 共用同一负载形状） */
export type BgmOpPayload = PlayFields & {
  loop?: boolean;
  fade?: number;
  restart?: boolean;
};

/** se：一次性音效（只有资源 + 音量） */
export type SeOpPayload = PlayFields;

/** voice：互斥语音通道（auto_stop 自动停止 / restart 重播） */
export type VoiceOpPayload = PlayFields & {
  auto_stop?: boolean;
  restart?: boolean;
};

/** stop_bgm / stop_ambient / stop_voice / stop_se 共用：fade 渐出毫秒 */
export type StopOpPayload = {
  fade?: number;
};

/** audio_play：按名字点名的独立音轨（channel 决定偏好归口） */
export type AudioPlayOpPayload = {
  inst: string;
  channel: AudioChannel;
  resource: string;
  volume?: number;
  loop?: boolean;
  fade?: number;
  restart?: boolean;
};

/** audio_stop：给 inst 只停那一轨，省略停全部实例 */
export type AudioStopOpPayload = {
  inst?: string;
  fade?: number;
};

/**
 * audio_volume：只改音量（不动播放位置、不重播）。
 * inst 与 channel 恰好给一个：inst 改单轨，channel 改整条通道。
 */
export type AudioVolumeOpPayload = {
  inst?: string;
  channel?: AudioChannel;
  volume: number;
};

/**
 * audio_pause / audio_resume 共用：
 * 给 inst 只暂停 / 恢复那一轨；否则 channel 省略 = 全部常驻通道（se 除外）。
 * inst 与 channel 互斥（同时给 = 目标歧义，运行期拒绝）。
 */
export type AudioChannelOpPayload = {
  channel?: AudioChannel;
  inst?: string;
};

/**
 * audio_seek：把音频定位到第 seconds 秒（不重播、不改音量）。
 * inst 与 channel 恰好给一个；se 是一次性音效，无定位语义（执行期空操作）。
 */
export type AudioSeekOpPayload = {
  inst?: string;
  channel?: AudioChannel;
  seconds: number;
};

export interface AudioPayloadMap {
  bgm: BgmOpPayload;
  stop_bgm: StopOpPayload;
  se: SeOpPayload;
  ambient: BgmOpPayload;
  stop_ambient: StopOpPayload;
  voice: VoiceOpPayload;
  stop_voice: StopOpPayload;
  stop_se: StopOpPayload;
  audio_play: AudioPlayOpPayload;
  audio_stop: AudioStopOpPayload;
  audio_volume: AudioVolumeOpPayload;
  audio_pause: AudioChannelOpPayload;
  audio_resume: AudioChannelOpPayload;
  audio_seek: AudioSeekOpPayload;
}
