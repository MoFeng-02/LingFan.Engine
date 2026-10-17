/**
 * 平台端口装配：把小程序能力接到引擎与展示层的端口上。
 *
 * 四件事：同步存储（存档与玩家偏好共用同一份面）、资源地址（包根指到
 * `/static/Resources/`：故事里的裸 id 由端口拼成包内绝对地址；用户目录留了文件面的
 * 接口但本工程暂时没有可写文件，故不传）、媒体端口（音频实例由平台造，视频呈现面由
 * 组合根注入——它要写页面数据，属宿主形态而非平台能力）、以及存档键前缀（与参考
 * 宿主的前缀区分开，同一台设备上不会串档）。
 */
import {
  createMiniprogramAudioPort,
  createMiniprogramPreferencesPort,
  createMiniprogramResourcePort,
  createMiniprogramSavePort,
  createMiniprogramVideoPort,
  type MiniprogramStorageLike,
  type MiniprogramVideoSurfaceLike,
} from "@lingfan/adapters";
import type {
  AudioPort,
  PreferencesPort,
  ResourcePort,
  SavePort,
  VideoPort,
} from "@lingfan/engine";
import { createAudioContext, uniApi } from "./platform.ts";

/** 本工程的存档键前缀（含高水位键，两者必须同前缀才互不干扰） */
const SAVE_KEY_PREFIX = "lingfan-miniprogram:";
/** 高水位键：低于已记录档数的读档会被拒绝，防误覆盖 */
const SAVE_HIGH_WATER_KEY = "lingfan-miniprogram:highwater";
/**
 * 包内资源根：故事里的资源 id（`Audio/x.mp3` 一类）不带根，运行时按包根拼。
 * uni-app 只把 `src/static/` 原样拷进包，所以素材放 `src/static/Resources/`，
 * 运行时地址就是 `/static/Resources/…`。
 */
export const PACKAGE_RESOURCE_ROOT = "/static/Resources/";

/** 宿主给引擎与装配器用的端口 */
export interface MiniprogramHostPorts {
  save: SavePort;
  preferences: PreferencesPort;
  resources: ResourcePort;
  /** 音频端口：四条通道共用一套实例管理（实例由平台造） */
  audio: AudioPort;
  /** 视频端口：状态推给呈现面，播放中的控制走组件控制柄 */
  video: VideoPort;
}

/** 端口装配参数：视频呈现面由组合根造（它要写页面数据） */
export interface MiniprogramPortsOptions {
  /** 视频呈现面（宿主形态相关，不属于平台能力） */
  videoSurface: MiniprogramVideoSurfaceLike;
}

/**
 * 造包内资源端口：故事里的资源 id → 包内绝对地址。
 *
 * 单独拆出来是为了「素材落在哪」这条口径能被单元测试直接验证——它不碰平台全局，
 * 也不需要起宿主。
 */
export function createPackageResourcePort(): ResourcePort {
  return createMiniprogramResourcePort(undefined, {
    packageRoot: PACKAGE_RESOURCE_ROOT,
  });
}

/** 装配平台端口 */
export function createMiniprogramHostPorts(
  options: MiniprogramPortsOptions,
): MiniprogramHostPorts {
  const storage = createStorageFace();
  return {
    save: createMiniprogramSavePort(storage, {
      keyPrefix: SAVE_KEY_PREFIX,
      highWaterKey: SAVE_HIGH_WATER_KEY,
    }),
    preferences: createMiniprogramPreferencesPort(storage),
    resources: createPackageResourcePort(),
    audio: createMiniprogramAudioPort(createAudioContext),
    video: createMiniprogramVideoPort(options.videoSurface),
  };
}

/** 把 `uni` 的同步存储包成适配器认识的存储面（取不到的键归一为空串） */
function createStorageFace(): MiniprogramStorageLike {
  const api = uniApi();
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
