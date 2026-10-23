/**
 * 平台取用点：宿主工程里的 `uni` 全局只在本文件出现，其余模块一律经此取件。
 *
 * UniApp 的 `uni` 是各端 API 的统一面（微信端即 `wx` 的镜像），因此同一份页面代码既能跑
 * 小程序，也能在浏览器里跑 H5 预览。把全局收在一处的原因有两条：其余模块要能在 Node 下被
 * 类型检查与单测导入，把 `uni` 撒在各处会让它们只能在真机里跑；平台能力的形状集中在这里，
 * 将来换端只需替换本文件。
 */

import type {
  HttpFetch,
  MiniprogramAudioContextLike,
} from "@lingfan-engine/adapters";

/** 小程序同步存储面（值与键都是字符串；取不存在的键返回空串） */
export interface UniStorageApi {
  setStorageSync(key: string, value: string): void;
  getStorageSync(key: string): unknown;
  removeStorageSync(key: string): void;
  getStorageInfoSync(): { keys: string[] };
}

/** 画布节点面：只声明宿主用到的那一层（帧源与像素尺寸） */
export interface MiniprogramCanvasNode {
  width: number;
  height: number;
  requestAnimationFrame(callback: (now: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

/** 系统信息面：只声明窗口尺寸与像素比 */
export interface UniSystemInfo {
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  platform?: string;
}

/** 选择器查询面：只声明取画布节点用到的那两步 */
export interface UniSelectorQuery {
  select(selector: string): UniSelectorQuery;
  node(
    callback: (result: { node?: MiniprogramCanvasNode }) => void,
  ): UniSelectorQuery;
  exec(): void;
}

/** 尺寸变化回执：小程序按窗口给了新的逻辑尺寸 */
export interface UniResizeResult {
  size: { windowWidth: number; windowHeight: number };
}

/** 网络请求回执：只声明工程接口用到的那几个字段（`data` 可能已被平台解析） */
export interface UniRequestResult {
  statusCode: number;
  data: unknown;
}

/** 网络请求的失败回执：`errMsg` 是平台给的可读原因 */
export interface UniRequestFailure {
  errMsg?: string;
}

/** 网络请求参数：只声明本工程用到的那一层 */
export interface UniRequestOptions {
  url: string;
  method?: "GET";
  /** 返回体的处理方式：`"text"` = 不当 JSON 解析（故事要原文） */
  dataType?: string;
  responseType?: string;
  success(result: UniRequestResult): void;
  fail(error: UniRequestFailure): void;
}

/**
 * 视频组件的控制柄（`uni.createVideoContext(id)` 返回值里用到的四个动作）。
 * 小程序的 `video` 是声明式组件：起播靠组件属性，播放中控制靠这个柄。
 */
export interface UniVideoContext {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  stop(): void;
}

/** 本工程用到的 `uni` 全局的一层 */
export interface UniApi {
  getSystemInfoSync(): UniSystemInfo;
  setStorageSync(key: string, value: string): void;
  getStorageSync(key: string): unknown;
  removeStorageSync(key: string): void;
  getStorageInfoSync(): { keys: string[] };
  createSelectorQuery(): UniSelectorQuery;
  createInnerAudioContext(): MiniprogramAudioContextLike;
  createVideoContext(id: string): UniVideoContext;
  request(options: UniRequestOptions): void;
  onWindowResize(callback: (result: UniResizeResult) => void): void;
  offWindowResize(callback: (result: UniResizeResult) => void): void;
  nextTick(callback: () => void): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/** 画布节点查询的等待上限：超时按「取不到」处理，退回定时器帧源 */
const CANVAS_QUERY_TIMEOUT_MS = 300;

/** 取 `uni` 全局（本工程唯一的取用点） */
export function uniApi(): UniApi {
  return uni as unknown as UniApi;
}

/** 读窗口尺寸：小程序给的是逻辑像素，不需要再折算像素比 */
export function readWindowSize(): { width: number; height: number } {
  const info = uniApi().getSystemInfoSync();
  return { width: info.windowWidth, height: info.windowHeight };
}

/**
 * 造一个音频实例（`bgm` / `ambient` / `voice` / `se` 四条通道各持一个）。
 *
 * 实例的 `src` 是包内路径或临时地址；`se` 通道播完即销毁，常驻通道由适配器回收。
 */
export function createAudioContext(): MiniprogramAudioContextLike {
  return uniApi().createInnerAudioContext();
}

/**
 * 取页面上某个 `video` 组件的控制柄；组件还没渲染时调用方要自己兜住异常。
 * @param id 页面里 `video` 组件的 id
 */
export function createVideoContext(id: string): UniVideoContext {
  return uniApi().createVideoContext(id);
}

/**
 * 造一个取件面（HTTP）：把 `uni.request` 包成适配器认的最小 `fetch` 形状。
 *
 * 工程接口要的是**原文**（故事的解析归引擎），所以返回体不交给平台解析；失败走 reject，
 * 由装载方 fail-closed（不降级成空工程）。取件面在调用时才碰 `uni`，模块导入不依赖运行时。
 */
export function createRequestFetch(): HttpFetch {
  return (url) =>
    new Promise((resolve, reject) => {
      uniApi().request({
        url,
        method: "GET",
        // 非 json 的处理方式：原样拿到文本，不在平台侧解析
        dataType: "text",
        responseType: "text",
        success: (result) => {
          resolve({
            ok: result.statusCode >= 200 && result.statusCode < 300,
            status: result.statusCode,
            text: async () =>
              typeof result.data === "string"
                ? result.data
                : JSON.stringify(result.data),
          });
        },
        fail: (error) => {
          reject(new Error(`${url} 请求失败：${error.errMsg ?? "未知原因"}`));
        },
      });
    });
}

/**
 * 按选择器取画布节点；取不到、或该端不支持节点查询时返回 null，由调用方决定退回哪条帧源。
 *
 * 两种取不到都要兜住：H5 的节点查询不回调，小程序上画布可能还没渲染完。
 */
export function queryCanvasNode(
  selector: string,
): Promise<MiniprogramCanvasNode | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (node: MiniprogramCanvasNode | null): void => {
      if (settled) return;
      settled = true;
      resolve(node);
    };
    try {
      uniApi()
        .createSelectorQuery()
        .select(selector)
        .node((result) => {
          finish(result.node ?? null);
        })
        .exec();
    } catch {
      finish(null);
      return;
    }
    setTimeout(() => {
      finish(null);
    }, CANVAS_QUERY_TIMEOUT_MS);
  });
}

/** 盯住窗口尺寸变化；返回退订函数（卸载时调用，避免页面销毁后仍被回调） */
export function watchWindowResize(handler: () => void): () => void {
  const api = uniApi();
  const callback = (): void => {
    handler();
  };
  api.onWindowResize(callback);
  return () => {
    api.offWindowResize(callback);
  };
}
