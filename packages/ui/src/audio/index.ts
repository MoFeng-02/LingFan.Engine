/**
 * 音频渲染域出口：状态视图（view）、差量规划（plan）、渲染器（renderer）。
 *
 * 核心只写状态，本域把状态差量翻译成端口动作（可测纯逻辑），由适配器落地播放；
 * 资源寻址经 ResourcePort，播放位置回写走帧级键。
 */
export {
  EMPTY_AUDIO_VIEW,
  readAudioView,
  type AudioAction,
  type AudioView,
} from "./view/index.ts";
export { planAudioActions } from "./plan/index.ts";
export {
  createAudioRenderer,
  type AudioRenderer,
  type AudioRendererOptions,
} from "./renderer/index.ts";
