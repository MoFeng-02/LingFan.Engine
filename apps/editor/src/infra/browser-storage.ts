/**
 * 浏览器本机存储：把 `window.localStorage` 取成 `KeyValueStorage` 契约。
 *
 * 站点数据被禁时，连读取 `window.localStorage` 这个属性本身都会抛异常 ⇒
 * 返回 `undefined`，调用方按「本会话无持久化」降级，功能不因偏好存不下而失效。
 * 平台细节只出现在本层：上层只见到契约类型与 `undefined`。
 */
import type { KeyValueStorage } from "@lingfan-engine/editor";

/** 取浏览器本机存储；不可用时返回 `undefined` */
export function createBrowserStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
