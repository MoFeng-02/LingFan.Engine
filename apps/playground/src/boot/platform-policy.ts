/**
 * 平台形态策略：媒体源物化的阈值与媒体端口的装配。
 *
 * 为什么只有 Android 需要物化：加密形态下媒体由自定义协议供给，而 Android WebView 的拦截层
 * 对**带 `Range` 头**的响应会在网络层直接失败（非零起点区间必错）——非 faststart 的 MP4 解复用
 * 必然读尾部，于是播放必坏。改经「无 `Range` 取回全量 → Blob URL」本地解码；其余平台保持直供
 * （Range 按需流式正常）。是否物化的判定条件留在组合根（那里同时握着构建形态、加密事实与宿主
 * 平台三件事），阈值与端口装配在这里。
 */
import {
  createWebAudioPort,
  createWebVideoPort,
  type BlobSourceOptions,
} from "@lingfan/adapters";
import type { AudioPort, VideoPort } from "@lingfan/engine";

/**
 * 媒体源物化上限（字节）：物化后整段驻留内存，故只承载小媒体（本工程 v1 媒体 ≤ 8 MiB）；
 * 超过即维持按需流式，不使用 Blob。
 *
 * v2 分块形态的大媒体（音视频）另有一条路：由 Rust 侧本机回环 HTTP 供给（带完整 `Range`
 * 语义），不经这里（见 `apps/playground/src-tauri/src/media_http/`）——本阈值只界定
 * 「需要整段取回才敢播」的小媒体。
 */
export const MEDIA_BLOB_SOURCE_MAX_BYTES = 16 * 1024 * 1024;

/** 媒体端口工厂的装配参数：判定结果与层级由组合根给定，端口实现与参数形状留在这里 */
export interface MediaPortFactoriesOptions {
  /** 媒体源物化上限（字节）；缺省 = 不物化，直供 URL（桌面等平台的既有行为） */
  mediaBlobSourceMaxBytes?: number;
  /** 视频覆盖层的层 z 序（层级契约解析结果由组合根传入） */
  videoZIndex: number;
}

/** 两个媒体端口工厂：舞台按需新建端口（重建 = 拿到新的端口实例，故每次调用都造新对象） */
export interface MediaPortFactories {
  /** 造音频端口（诊断出口逐次传入） */
  createAudioPort(onError: (message: string) => void): AudioPort;
  /** 造视频端口（层 z 与物化配置由装配参数给定） */
  createVideoPort(onError: (message: string) => void): VideoPort;
}

/**
 * 造两个媒体端口工厂：物化配置在这里成型一次，音视频两个端口**共用同一个配置对象**——上限
 * 取值与适配器侧的解析都只发生一次（与不物化时的 `undefined` 语义一一对应）。
 */
export function createMediaPortFactories(
  options: MediaPortFactoriesOptions,
): MediaPortFactories {
  const blobSource: BlobSourceOptions | undefined =
    options.mediaBlobSourceMaxBytes === undefined
      ? undefined
      : { maxBytes: options.mediaBlobSourceMaxBytes };
  return {
    createAudioPort(onError: (message: string) => void): AudioPort {
      return createWebAudioPort({ onError, blobSource });
    },
    createVideoPort(onError: (message: string) => void): VideoPort {
      return createWebVideoPort({
        onError,
        zIndex: options.videoZIndex,
        blobSource,
      });
    },
  };
}
