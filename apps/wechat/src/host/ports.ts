/**
 * 平台端口装配：把小程序能力接到引擎与展示层的端口上。
 *
 * 三件事：同步存储（存档与玩家偏好共用同一份面）、资源地址（包内路径直接可用，
 * 用户目录留了文件面的接口但本工程暂时没有可写文件，故不传）、以及存档键前缀
 * （与参考宿主的前缀区分开，同一台设备上不会串档）。
 */
import {
  createWechatPreferencesPort,
  createWechatResourcePort,
  createWechatSavePort,
  type WechatStorageLike,
} from "@lingfan/adapters";
import type { PreferencesPort, ResourcePort, SavePort } from "@lingfan/engine";
import { wechatApi } from "./platform.ts";

/** 本工程的存档键前缀（含高水位键，两者必须同前缀才互不干扰） */
const SAVE_KEY_PREFIX = "lingfan-wechat:";
/** 高水位键：低于已记录档数的读档会被拒绝，防误覆盖 */
const SAVE_HIGH_WATER_KEY = "lingfan-wechat:highwater";

/** 宿主给引擎与装配器用的三个端口 */
export interface WechatHostPorts {
  save: SavePort;
  preferences: PreferencesPort;
  resources: ResourcePort;
}

/** 装配平台端口 */
export function createWechatHostPorts(): WechatHostPorts {
  const storage = createStorageFace();
  return {
    save: createWechatSavePort(storage, {
      keyPrefix: SAVE_KEY_PREFIX,
      highWaterKey: SAVE_HIGH_WATER_KEY,
    }),
    preferences: createWechatPreferencesPort(storage),
    resources: createWechatResourcePort(),
  };
}

/** 把 `uni` 的同步存储包成适配器认识的存储面（取不到的键归一为空串） */
function createStorageFace(): WechatStorageLike {
  const api = wechatApi();
  return {
    set: (key, value) => {
      api.setStorageSync(key, value);
    },
    get: (key) => {
      const value = api.getStorageSync(key);
      return typeof value === "string" ? value : "";
    },
    remove: (key) => {
      api.removeStorageSync(key);
    },
    keys: () => api.getStorageInfoSync().keys,
  };
}
