import type { KeyValueStorage } from "@lingfan/editor";

/** 浏览器可能禁站点数据（取 `localStorage` 本身即抛）——失败即无持久化，不影响可用性 */
export function readLocalStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
