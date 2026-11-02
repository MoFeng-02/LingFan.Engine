/**
 * 舞台视图的宿主侧总装：叙事状态投影、音视频与元素层、事件与输入出口三件事装成一份。
 *
 * 三者按固定次序装配——叙事状态先立（舞台栈要按它投影元素表），舞台栈次之（事件出口
 * 要拿它的媒体单元格），事件出口最后。视频层 z 的下发要等媒体单元格存在，故经本地
 * 单元格延迟取值：叙事装配只注册下发回调，真正的端口在舞台栈装配后才就位。
 */

import { type Ref } from "vue";
import {
  type AudioPort,
  type HostControls,
  type LayerZTable,
  type PlayerPreferences,
  type ResourcePort,
  type StoryEngine,
  type VideoPort,
} from "@lingfan-engine/core";
import { type createCommandRegistry } from "@lingfan-engine/ui";
import {
  createAppNarrative,
  type AppNarrative,
} from "../../narrative/wiring/app-narrative";
import type { AppMedia } from "../../stage/media/app-media";
import { createAppStageStack } from "../../stage/app-stage-stack";
import { createAppEvents, type AppEvents } from "../../engine/app-events";

/** 装配入参：宿主属性、引擎句柄、错误横幅与两个舞台容器 */
export interface AppStageViewOptions {
  /** 组合根注入的宿主属性（只读消费层级、偏好与媒体端口工厂） */
  props: {
    layerZ: LayerZTable;
    preferences: PlayerPreferences;
    resourcePort: ResourcePort;
    createAudioPort: (onError: (message: string) => void) => AudioPort;
    createVideoPort: (
      onError: (message: string) => void,
      readContainer?: () => HTMLElement | null,
    ) => VideoPort;
    /** 外部宿主注入的操作通道（缺省时由舞台栈造一份） */
    controls?: HostControls;
  };
  /** 引擎句柄取用（重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 错误横幅内容（媒体、元素与事件分支的 fail-closed 上报都落这里） */
  error: Ref<string>;
  /** 舞台元素层容器（模板 ref） */
  elementLayerEl: Ref<HTMLElement | null>;
  /** 元素 `cmd` 业务命令注册表（未注册 fail-closed） */
  commands: ReturnType<typeof createCommandRegistry>;
  /** 视频层的呈现容器（舞台根：视频层随舞台缩放） */
  readVideoContainer: () => HTMLElement | null;
}

/** 装配结果：叙事视图状态、媒体单元格、生效的操作通道与事件输入出口 */
export interface AppStageView extends AppNarrative, AppEvents {
  /** 媒体单元格（重启重建时字段整体改写） */
  media: AppMedia;
  /** 生效的操作通道（外部注入优先，缺省为舞台栈自造） */
  controls: HostControls;
}

/** 装配舞台视图：叙事状态 → 舞台栈 → 事件出口 */
export function createAppStageView(options: AppStageViewOptions): AppStageView {
  const { props, getEngine, error, elementLayerEl, commands } = options;
  // 视频 z 的下发发生在层 z 变化时，晚于舞台栈装配：经闭包后置取用媒体单元格
  const { narrative, zOf, typewriter } = createAppNarrative({
    getEngine,
    layerZ: props.layerZ,
    preferences: props.preferences,
    applyVideoZ: (z) => {
      stage.media.videoPort.setZIndex?.(z);
    },
  });
  const stage = createAppStageStack({
    props,
    getEngine,
    error,
    narrative,
    elementLayerEl,
    commands,
    readVideoContainer: options.readVideoContainer,
  });
  const events = createAppEvents({
    narrative,
    media: stage.media,
    error,
    getEngine,
    typewriter,
  });
  return {
    narrative,
    zOf,
    typewriter,
    media: stage.media,
    controls: stage.controls,
    ...events,
  };
}
