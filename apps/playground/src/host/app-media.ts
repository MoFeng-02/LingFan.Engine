/**
 * 音视频渲染的宿主侧装配：端口由组合根注入（装配只见契约），渲染器做状态差量。
 *
 * 端口与渲染器都以可变单元格暴露——重启会整体重建端口与渲染器（先停播再回收），
 * 重建直接改写单元格字段，所有消费方经同一单元格读到最新实例，不持有旧引用。
 * 端口工厂（`createAudioPort` / `createVideoPort`）同样由组合根注入：restart 重建
 * 通道时保持「选择权在组合根」。
 */

import { type Ref } from "vue";
import {
  type AudioPort,
  type PlayerPreferences,
  type ResourcePort,
  type StoryEngine,
  type VideoPort,
} from "@lingfan/engine";
import {
  createAudioRenderer,
  createVideoRenderer,
  type AudioRenderer,
  type VideoRenderer,
} from "@lingfan/ui";

/** 装配入参：媒体相关宿主属性、引擎句柄与错误横幅 */
export interface AppMediaOptions {
  /** 组合根注入的宿主属性（只读消费媒体相关字段） */
  props: {
    resourcePort: ResourcePort;
    preferences: PlayerPreferences;
    createAudioPort: (onError: (message: string) => void) => AudioPort;
    createVideoPort: (onError: (message: string) => void) => VideoPort;
  };
  /** 引擎句柄取用（渲染器挂接与视频完成回传；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 错误横幅内容（媒体装配失败的 fail-closed 上报都落这里） */
  error: Ref<string>;
}

/** 媒体单元格：端口与渲染器句柄、错误上报（字段可变，重启时整体改写） */
export interface AppMedia {
  /** 音频端口（重启重建时改写此字段） */
  audioPort: AudioPort;
  /** 视频端口（重启重建时改写此字段） */
  videoPort: VideoPort;
  /** 音频渲染器（initEngine 装配 / restart 重建时改写） */
  audioRenderer: AudioRenderer | null;
  /** 视频渲染器（initEngine 装配 / restart 重建时改写） */
  videoRenderer: VideoRenderer | null;
  /** 媒体错误上报（写错误横幅；端口重建时也复用它） */
  reportAudioError: (message: string) => void;
  /** 构造音频渲染器（引擎状态 → 端口命令的差量执行） */
  createRenderer: () => AudioRenderer;
  /** 构造视频渲染器（含播完回传引擎命令） */
  createVideo: () => VideoRenderer;
}

/** 装配媒体单元格：按宿主属性建端口对，渲染器经工厂按需构造 */
export function createAppMedia(options: AppMediaOptions): AppMedia {
  const { props, getEngine, error } = options;
  // —— 音频/视频：端口由组合根注入（装配只见契约）；渲染器做状态差量 ——
  function reportAudioError(message: string): void {
    error.value = message;
  }
  const media: AppMedia = {
    audioPort: props.createAudioPort(reportAudioError),
    videoPort: props.createVideoPort(reportAudioError),
    audioRenderer: null,
    videoRenderer: null,
    reportAudioError,
    createRenderer(): AudioRenderer {
      return createAudioRenderer(getEngine(), media.audioPort, props.resourcePort, {
        onError: reportAudioError,
        preferences: props.preferences, // 通道有效音量合成 + 偏好变化即时重规划
      });
    },
    createVideo(): VideoRenderer {
      return createVideoRenderer(getEngine(), media.videoPort, props.resourcePort, {
        onError: reportAudioError,
        onVideoFinished: () => getEngine().videoFinished(), // 组合根职责：播完 → 引擎命令
      });
    },
  };
  return media;
}
