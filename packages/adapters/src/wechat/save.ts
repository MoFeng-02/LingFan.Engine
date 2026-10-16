/**
 * SavePort 小程序实现：把微信同步存储（`wx.setStorageSync` 系）接到既有的同步键值存储实现上——
 * 命名空间、高水位、列表语义与 Web 演示实现共用同一份代码，平台差异只在取空约定：
 * 微信存储取不存在的键返回**空串**，这里归一成 `null`（Web 侧 `localStorage` 本身就是 null）。
 * 明文存储，不作为安全边界。
 */
import type { SavePort } from "@lingfan/engine";
import {
  createWebStorageSavePort,
  type SyncStorageLike,
  type WebStorageSaveOptions,
} from "../save/webStorage.ts";
import type { WechatStorageLike } from "./platform.ts";

/** 把微信存储面接成存档实现要的同步键值面（空串 = 不存在） */
export function wechatStorageFace(storage: WechatStorageLike): SyncStorageLike {
  return {
    getItem: (key) => {
      const raw = storage.get(key);
      return raw === "" ? null : raw;
    },
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.remove(key),
    keys: () => storage.keys(),
  };
}

/**
 * 造一个存档端口（小程序）：数据明文存微信同步存储，高水位由本侧自管（读旧档同样被拒）。
 * @param storage 微信同步存储面（宿主注入 `wx` 上那四个动作）
 * @param options 存储键命名空间；缺省沿用演示值（`lf3-demo:`），换前缀后旧档读不到——迁移由宿主自管
 */
export function createWechatSavePort(
  storage: WechatStorageLike,
  options?: WebStorageSaveOptions,
): SavePort {
  return createWebStorageSavePort(options, wechatStorageFace(storage));
}
