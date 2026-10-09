/**
 * 资源域出口（UI 侧单一入口）：逻辑资源路径 → 已解析 URL 的缓存。
 *
 * 音频 / 视频 / 元素三处渲染路径共用同一份实现，避免各自维护一份「查表 + 在途去重」。
 */
export {
  createResourceUrlCache,
  type ResourceUrlCache,
  type ResourceUrlCacheOptions,
} from "./urlCache";
