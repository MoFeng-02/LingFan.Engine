/**
 * 媒体命令的执行：音频通道、视频命令流、出站通知。
 *
 * 这一族的共同点是「核心只写状态，播放交给宿主」——音频写四通道的通道对象，
 * 视频写单调递增的命令流，通知只发出站事件。渲染器按状态与事件执行，
 * 核心不持有播放器，也不关心播放是否成功。
 *
 * 按「音频通道 / 视频 / 音频实例 / 通知」分文件，域内共用部分在 `shared.ts`；
 * 这里只做转发，不放任何实现。
 */
export { execAudio, execAudioPause, execAudioResume } from "./audio.ts";
export { execVideo } from "./video.ts";
export {
  execAudioInstance,
  pauseAudioInstances,
  resumeAudioInstances,
} from "./instances.ts";
export { execNotify } from "./notify.ts";
