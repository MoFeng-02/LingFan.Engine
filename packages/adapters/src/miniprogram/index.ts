/**
 * 微信小程序适配器族出口：`apps/miniprogram` 宿主从这里取件（包外只从本包根出口导入）。
 * 只做具名转发，实现都在同目录各端口文件里；平台面（注入对象的形状）见 `platform.ts`。
 */
export type {
  MiniprogramAudioContextLike,
  MiniprogramCanvasFrameLike,
  MiniprogramFileSystemLike,
  MiniprogramStorageLike,
  MiniprogramVideoSurfaceLike,
} from "./platform.ts";
export { createMiniprogramAudioPort } from "./audio.ts";
export {
  createMiniprogramFrameSource,
  type MiniprogramFrameSource,
} from "./frame.ts";
export { createMiniprogramPreferencesPort } from "./preferences.ts";
export {
  createMiniprogramResourcePort,
  type MiniprogramResourceOptions,
} from "./resource.ts";
export { createMiniprogramSavePort, miniprogramStorageFace } from "./save.ts";
export {
  createMiniprogramVideoPort,
  type MiniprogramVideoOptions,
} from "./video.ts";
