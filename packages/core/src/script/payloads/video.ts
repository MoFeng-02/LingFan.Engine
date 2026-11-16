/**
 * 视频域 op 负载：video / cutscene / seek_video / pause_video / resume_video /
 * stop_video / video_skipable。
 *
 * 负载用 type 别名（对象字面量带隐式索引签名，CommandOf 产物可赋给
 * StoryCommand 的开放索引签名）；域 map 用 interface。资源 / 音量字段在本域
 * 自声明（不跨域引音频片段）；运行期约束（非空 / 有限 / 非负）归 editor 校验器。
 * 无字段 op（pause_video / resume_video / stop_video）用跨域 EmptyOpPayload。
 */
import type { EmptyOpPayload } from "./shared.ts";

/** video：非阻塞播放（loop 循环 / z 视频层层级） */
export type VideoOpPayload = {
  resource: string;
  volume?: number;
  loop?: boolean;
  z?: number;
};

/** cutscene：阻塞过场（skipable 可点击跳过 / z 视频层层级） */
export type CutsceneOpPayload = {
  resource: string;
  volume?: number;
  skipable?: boolean;
  z?: number;
};

/** seek_video：把当前视频跳转到第 seconds 秒 */
export type SeekVideoOpPayload = {
  seconds: number;
};

/** video_skipable：全局「视频可跳过」开关 */
export type VideoSkipableOpPayload = {
  value: boolean;
};

export interface VideoPayloadMap {
  video: VideoOpPayload;
  cutscene: CutsceneOpPayload;
  seek_video: SeekVideoOpPayload;
  pause_video: EmptyOpPayload;
  resume_video: EmptyOpPayload;
  stop_video: EmptyOpPayload;
  video_skipable: VideoSkipableOpPayload;
}
