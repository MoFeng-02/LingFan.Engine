/**
 * 媒体域出口：音频与视频的 WebView 播放端口，以及自定义协议媒体源的 Blob 物化。
 * 播放端口只做播放控制（资源寻址归资源域）；物化用于绕开 Android WebView
 * 对分段请求的拦截，把整段字节先取回再交给 `blob:` 地址。
 */
export { createWebAudioPort, type WebAudioPortOptions } from "./audioPort";
export { createWebVideoPort, type WebVideoPortOptions } from "./videoPort";
export {
  createBlobSource,
  type BlobSource,
  type BlobSourceOptions,
} from "./blobSource";
