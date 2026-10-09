/**
 * 视频端口适配器：WebView 解码（HTMLVideoElement），舞台层覆盖呈现。
 * - 覆盖层 `pointer-events: none`：点击穿透到舞台（cutscene 跳过走引擎 advance 命令面）
 * - 入参为已解析 URL（资源寻址归 ResourcePort）
 * - 自然播放结束经 onEnded 上报（cutscene 由它解除引擎等待）
 * - 浏览器自动播放策略拒绝时登记，首次用户交互后重试
 */
import type { VideoPort } from "@lingfan/engine";
import { createBlobSource, type BlobSourceOptions } from "./blobSource";

/** 视频端口的装配参数：诊断出口、层 z 与可选的媒体源物化 */
export interface WebVideoPortOptions {
  /** 播放失败诊断（缺失/损坏资源不静默：报错诊断） */
  onError?: (message: string) => void;
  /** 层 z 序（层级契约）：组合根传入解析后的层表值；缺省 5 = 旧行为 */
  zIndex?: number;
  /** 媒体源物化配置（Android WebView 的 Range 拦截缺陷绕过，见 blobSource 模块）；
   *  缺省 = 直供 URL（桌面既有行为，形态差异归组合根裁决） */
  blobSource?: BlobSourceOptions;
}

/** 播放参数（契约 VideoPort.play 的 options） */
interface PlayOptions {
  volume: number;
  loop: boolean;
}

/**
 * 造一个视频端口：整块铺在舞台上方的 `<video>` 覆盖层，默认 `z-index: 5`；
 * 层不吃点击（`pointer-events: none`），所以跳过过场靠引擎命令而不是点画面。
 * 播完经 `onEnded` 通知调用方；自动播放被浏览器拒绝时不报错（玩家很快会交互）。
 * 解码失败只在 `<video>` 真带 MediaError 时上报（WebView 会为内建封面派发无错误码的 error）。
 */
export function createWebVideoPort(
  portOptions: WebVideoPortOptions = {},
): VideoPort {
  let element: HTMLVideoElement | null = null;
  let endedHandler: (() => void) | null = null;
  // 实例级 z：运行期可改；缺省 5 = 旧行为
  let zIndex = portOptions.zIndex ?? 5;
  const blobSource =
    portOptions.blobSource === undefined
      ? undefined
      : createBlobSource(portOptions.blobSource);
  /** 当前逻辑 URL（物化释放的键）；世代号作废在途物化（stop / dispose / 新 play 取代） */
  let currentUrl: string | null = null;
  let generation = 0;

  function ensure(): HTMLVideoElement {
    if (element === null) {
      element = document.createElement("video");
      // CORS 匿名加载：存档缩略图 canvas 合成需可导出（lfstream 已带 ACAO:*）——先于 src
      element.crossOrigin = "anonymous";
      // 舞台层覆盖（RenderTargets.stage 之上的呈现层）；点击穿透：跳过走命令面
      element.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;object-fit:contain;" +
        `background:#000;z-index:${zIndex};display:none;pointer-events:none;`;
      element.addEventListener("error", () => {
        // 只有真正的媒体错误才报（MediaError 非空）：WebView 会因内建默认封面加载失败
        // 派发一次不带 MediaError 的 error 事件，那不是解码失败，报出来会误导用户
        const mediaError = element?.error;
        if (mediaError === null || mediaError === undefined) return;
        portOptions.onError?.("视频资源无法解码或缺失");
      });
      document.body.appendChild(element);
    }
    return element;
  }

  function applyPlay(
    video: HTMLVideoElement,
    source: string,
    options: PlayOptions,
  ): void {
    video.src = source;
    video.loop = options.loop;
    video.volume = Math.min(1, Math.max(0, options.volume));
    video.style.display = "block";
    // 浏览器自动播放策略拒绝（未交互）时静默：cutscene 场景玩家即将交互
    void video.play().catch(() => undefined);
  }

  function startPlay(
    video: HTMLVideoElement,
    url: string,
    options: PlayOptions,
  ): void {
    if (blobSource === undefined) {
      applyPlay(video, url, options);
      return;
    }
    const mine = generation;
    void blobSource.materialize(url).then((source) => {
      if (mine !== generation) return; // 已被 stop / dispose / 新 play 取代
      applyPlay(video, source, options);
    });
  }

  return {
    // 实例级 z：运行期改本层 z（元素未创建则只记值，ensure 时生效）
    setZIndex(next: number): void {
      zIndex = next;
      if (element !== null) element.style.zIndex = String(next);
    },
    play(url, options, onEnded): void {
      const video = ensure();
      endedHandler = onEnded ?? null;
      video.onended = () => {
        if (endedHandler !== null) endedHandler();
      };
      currentUrl = url;
      generation += 1;
      startPlay(video, url, options);
    },
    pause(): void {
      element?.pause();
    },
    resume(): void {
      void element?.play().catch(() => undefined);
    },
    seek(seconds): void {
      if (element !== null) element.currentTime = Math.max(0, seconds);
    },
    stop(): void {
      generation += 1; // 作废在途物化
      const url = currentUrl;
      currentUrl = null;
      if (element !== null) {
        element.onended = null;
        element.pause();
        element.removeAttribute("src"); // 释放解码资源
        element.style.display = "none";
      }
      if (url !== null) blobSource?.release(url); // 先断源再释放物化结果
    },
    dispose(): void {
      generation += 1;
      currentUrl = null;
      if (element !== null) {
        element.pause();
        element.onended = null;
        element.removeAttribute("src");
        element.remove();
      }
      element = null;
      blobSource?.dispose();
    },
  };
}
