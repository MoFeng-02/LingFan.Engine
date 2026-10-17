/**
 * 微信小程序适配器族出口：`apps/miniprogram` 宿主从这里取件（包外只从本包根出口导入）。
 * 只做具名转发，实现都在同目录各端口文件里；平台面（注入对象的形状）见 `platform.ts`。
 */
export type {
  WechatAudioContextLike,
  WechatCanvasFrameLike,
  WechatFileSystemLike,
  WechatStorageLike,
  WechatVideoSurfaceLike,
} from "./platform.ts";
export { createWechatAudioPort } from "./audio.ts";
export { createWechatFrameSource, type WechatFrameSource } from "./frame.ts";
export { createWechatPreferencesPort } from "./preferences.ts";
export {
  createWechatResourcePort,
  type WechatResourceOptions,
} from "./resource.ts";
export { createWechatSavePort, wechatStorageFace } from "./save.ts";
export { createWechatVideoPort, type WechatVideoOptions } from "./video.ts";
