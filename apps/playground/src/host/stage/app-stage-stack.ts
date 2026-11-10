/**
 * 舞台层的宿主侧总装：把音视频渲染、元素层与操作通道三件事装成一份。
 *
 * 三者共用同一个引擎句柄与错误横幅，且都以「重启整体重建」为前提，故由一处装配、
 * 一处返回。操作通道入参是取用函数而不是实例：重建后它必须指向新实例。
 */

import { type Ref } from "vue";
import {
  type AudioPort,
  type ElementFit,
  type HostControls,
  type PlayerPreferences,
  type ResourcePort,
  type StoryEngine,
  type VideoPort,
} from "@lingfan-engine/core";
import { type createCommandRegistry } from "@lingfan-engine/ui";
import { createAppElementLayer } from "./elements";
import { createAppMedia, type AppMedia } from "./media";
import { createHostControls } from "../controls";
import type { VueNarrativeState } from "../narrative/runtime/narrative-state";

/** 装配入参：宿主属性、引擎句柄、叙事状态与两个舞台容器 */
export interface AppStageStackOptions {
  /** 组合根注入的宿主属性（只读消费媒体与元素相关字段） */
  props: {
    resourcePort: ResourcePort;
    preferences: PlayerPreferences;
    createAudioPort: (onError: (message: string) => void) => AudioPort;
    createVideoPort: (
      onError: (message: string) => void,
      readContainer?: () => HTMLElement | null,
      readFit?: () => ElementFit,
    ) => VideoPort;
    /** 外部宿主注入的操作通道（缺省时由本装配造一份） */
    controls?: HostControls;
  };
  /** 引擎句柄取用（重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 错误横幅内容（媒体与元素装配的 fail-closed 上报都落这里） */
  error: Ref<string>;
  /** 叙事视图状态（元素表响应式来源） */
  narrative: VueNarrativeState;
  /** 舞台元素层容器（模板 ref） */
  elementLayerEl: Ref<HTMLElement | null>;
  /** 元素 `cmd` 业务命令注册表（未注册 fail-closed） */
  commands: ReturnType<typeof createCommandRegistry>;
  /** 视频层的呈现容器（舞台根就传它：视频层随舞台缩放） */
  readVideoContainer?: () => HTMLElement | null;
}

/** 装配结果：媒体单元格与生效的操作通道 */
export interface AppStageStack {
  media: AppMedia;
  controls: HostControls;
}

/** 装配音视频渲染、元素层与操作通道 */
export function createAppStageStack(
  options: AppStageStackOptions,
): AppStageStack {
  const { props, getEngine, error, narrative, elementLayerEl, commands } =
    options;
  const media = createAppMedia({
    props,
    getEngine,
    error,
    readVideoContainer: options.readVideoContainer,
  });
  createAppElementLayer({
    narrative,
    elementLayerEl,
    props,
    commands,
    error,
    getEngine,
  });
  const localControls = createHostControls({
    engine: getEngine,
    audio: () => media.audioPort,
    video: () => media.videoPort,
  });
  return { media, controls: props.controls ?? localControls };
}
