/**
 * 偏好持久化（小程序）：微信同步存储上的明文 JSON，语义与 Web 演示实现共用同一份代码——
 * 没存过或存坏了都返回 `null`（上层用默认值起航，不因偏好损坏挡住启动）。
 */
import type { PreferencesPort } from "@lingfan/engine";
import { createWebStoragePreferencesPort } from "../preferences/webStoragePreferences.ts";
import type { WechatStorageLike } from "./platform.ts";
import { wechatStorageFace } from "./save.ts";

/**
 * 造一个偏好端口（小程序）。
 * @param storage 微信同步存储面（宿主注入 `wx` 上那四个动作）
 */
export function createWechatPreferencesPort(
  storage: WechatStorageLike,
): PreferencesPort {
  return createWebStoragePreferencesPort(wechatStorageFace(storage));
}
