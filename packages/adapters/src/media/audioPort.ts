/**
 * 音频端口适配器：WebView 解码（HTMLAudioElement）。
 * 入参为已解析 URL（资源寻址归 ResourcePort）。
 * 同 URL 且 restart=false = 无缝续播/更新（只改音量/循环/位置，不重头播——回滚 seek 语义）；
 * restart=true = 回到起点重播（同源不重设 src，避免重复解码）。
 * 淡入淡出用音量斜坡（单条 rAF，斜坡清空即停）。
 * 浏览器自动播放策略拒绝时登记该通道，首次用户交互后重试（否则首曲静默丢失）。
 * 媒体源可经 `blobSource` 物化（Android WebView 的 Range 拦截缺陷绕过，见 blobSource 模块）：
 * URL 判等仍按**逻辑 URL**（物化不改变「同源不重设 src」的无缝续播语义）。
 *
 * 本文件只装**四通道**维度（叙事语义：这段是 BGM、这句是语音）。实例维度
 * （作者的编排单元，可叠放）在 `audioInstances` 模块，斜坡调度在 `audioRamps` 模块——
 * 三者共用同一条 rAF 与同一套音量夹取，故调度要向下注入而不是各起一条。
 */
import type {
  AudioChannel,
  AudioPlayOptions,
  AudioPort,
} from "@lingfan-engine/core";
import { createBlobSource, type BlobSourceOptions } from "./blobSource";
import { SEEK_EPSILON, clamp } from "./audioRamp";
import { createAudioInstances, type AudioInstances } from "./audioInstances";
import { createAudioRampScheduler } from "./audioRamps";

/** 音频端口的装配参数：诊断出口与可选的媒体源物化 */
export interface WebAudioPortOptions {
  /** 播放失败诊断（缺失/损坏资源不静默：报错诊断） */
  onError?: (message: string) => void;
  /** 媒体源物化配置（Android WebView 的 Range 拦截缺陷绕过，见 blobSource 模块）；
   *  缺省 = 直供 URL（桌面既有行为，形态差异归组合根裁决） */
  blobSource?: BlobSourceOptions;
}

/**
 * 造一个音频端口：常驻通道各持一个 `HTMLAudioElement`，`se` 一次性不入表（允许叠放）。
 * 元素、URL 与状态逐实例持有；被自动播放策略拒绝的通道登记后等首次用户交互重试。
 */
export function createWebAudioPort(
  portOptions: WebAudioPortOptions = {},
): AudioPort {
  /** 常驻通道元素（se 为一次性，不入表——允许叠放） */
  const elements = new Map<AudioChannel, HTMLAudioElement>();
  /**
   * 在播的一次性音效（`se`）。
   *
   * 与常驻通道分开记：常驻通道每通道至多一个元素，音效每次触发都是新元素且允许叠放。
   * 记在这里的唯一目的是让 `stop("se")` 能找到它们——不记就停不掉，只能等播完。
   * 播完/出错/被停止时自行出列，集合不会无限增长。
   */
  const shots = new Set<HTMLAudioElement>();
  const urls = new Map<AudioChannel, string>();
  /** 各通道最近一次 play 的逻辑 URL：仅供 error 文案点名资源（元素与监听器常驻复用） */
  const errorUrls = new Map<AudioChannel, string>();
  /** 被自动播放策略拒绝的通道：首次用户交互后重试 */
  const blocked = new Set<AudioChannel>();
  const blobSource =
    portOptions.blobSource === undefined
      ? undefined
      : createBlobSource(portOptions.blobSource);
  /** 每通道世代号：作废在途物化（stop / 新 play 取代后的迟到回填） */
  const generations = new Map<AudioChannel, number>();
  const ramps = createAudioRampScheduler();
  let gestureHandler: (() => void) | null = null;
  let instances: AudioInstances | null = null;

  /** 物化为可口喂元素的 URL（未配置物化 = 原样返回） */
  function resolveSource(url: string): Promise<string> {
    return blobSource === undefined
      ? Promise.resolve(url)
      : blobSource.materialize(url);
  }

  /** 取通道世代号（不递增） */
  function generationOf(channel: AudioChannel): number {
    return generations.get(channel) ?? 0;
  }

  /** 递增通道世代号（作废该通道在途物化） */
  function bumpGeneration(channel: AudioChannel): number {
    const next = generationOf(channel) + 1;
    generations.set(channel, next);
    return next;
  }

  function retryBlocked(): void {
    for (const channel of [...blocked]) {
      const element = elements.get(channel);
      if (element === undefined) continue;
      void element.play().then(
        () => blocked.delete(channel),
        () => undefined,
      );
    }
    instances?.retryBlocked();
  }

  /** 首个用户交互（pointerdown/keydown）后重试被拒通道，然后解绑 */
  function bindGestureRetry(): void {
    if (gestureHandler !== null) return;
    gestureHandler = (): void => {
      const handler = gestureHandler;
      if (handler !== null) {
        window.removeEventListener("pointerdown", handler);
        window.removeEventListener("keydown", handler);
        gestureHandler = null;
      }
      retryBlocked();
    };
    window.addEventListener("pointerdown", gestureHandler);
    window.addEventListener("keydown", gestureHandler);
  }

  function start(
    channel: AudioChannel,
    element: HTMLAudioElement,
    options: AudioPlayOptions,
  ): void {
    if (options.fadeMs > 0) {
      element.volume = 0;
      ramps.fade(channel, element, options.volume, options.fadeMs);
    } else {
      element.volume = clamp(options.volume);
    }
    void element.play().then(
      () => blocked.delete(channel),
      () => {
        blocked.add(channel);
        bindGestureRetry();
      },
    );
  }

  /**
   * 取通道元素（必要时创建）。`url` 是**本次 play 的逻辑 URL**，只用于 error 文案：
   * 元素常驻复用，监听器却只挂一次，所以文案不能闭包捕获首播 URL——由 `errorUrl`
   * 在每次换源后写入，报错时读最新值，才点得出是哪个资源。
   */
  function ensure(channel: AudioChannel, url: string): HTMLAudioElement {
    let element = elements.get(channel);
    if (element === undefined) {
      element = new Audio();
      element.preload = "auto";
      element.addEventListener("error", () => {
        portOptions.onError?.(
          `音频资源无法解码或缺失：${errorUrls.get(channel) ?? url}（通道 ${channel}）`,
        );
      });
      elements.set(channel, element);
    }
    errorUrls.set(channel, url);
    return element;
  }

  function play(
    channel: AudioChannel,
    url: string,
    options: AudioPlayOptions,
  ): void {
    if (channel === "se") {
      // 一次性音效：独立元素，允许与常驻通道叠放；无淡入淡出与位置语义，也不重试。
      // 入列以支持 stop("se")——出列点：播完 / 出错 / 被停止。
      const shot = new Audio();
      shots.add(shot);
      const forget = (): void => {
        shots.delete(shot);
      };
      shot.addEventListener("ended", forget);
      shot.volume = clamp(options.volume);
      shot.addEventListener("error", () => {
        forget();
        portOptions.onError?.(`音效资源无法解码或缺失：${url}`);
      });
      void resolveSource(url).then((source) => {
        if (!shots.has(shot)) return; // 解析期间已被 stop_se 停掉
        shot.src = source;
        void shot.play().catch(() => undefined);
      });
      return;
    }
    const element = ensure(channel, url);
    const sameUrl = urls.get(channel) === url;
    if (sameUrl && !options.restart) {
      // 无缝续播/更新：不重设 src（不打断解码与播放位置）
      element.loop = options.loop;
      ramps.fade(channel, element, options.volume, options.fadeMs);
      if (Math.abs(element.currentTime - options.position) > SEEK_EPSILON) {
        element.currentTime = options.position;
      }
      return;
    }
    if (sameUrl) {
      // 显式重播：同源回到起点（不重设 src，避免重复解码）
      element.loop = options.loop;
      element.currentTime = options.position;
      start(channel, element, options);
      return;
    }
    urls.set(channel, url);
    ramps.cancel(channel);
    blocked.delete(channel);
    const mine = bumpGeneration(channel);
    void resolveSource(url).then((source) => {
      if (generationOf(channel) !== mine) return; // 已被 stop / 新 play 取代
      element.src = source;
      element.loop = options.loop;
      if (options.position > 0) {
        // 新元素元数据未就绪时写 currentTime 会被忽略，等 loadedmetadata 再定位
        element.addEventListener(
          "loadedmetadata",
          () => {
            element.currentTime = options.position;
          },
          { once: true },
        );
      }
      start(channel, element, options);
    });
  }

  function stop(channel: AudioChannel, fadeMs = 0): void {
    if (channel === "se") {
      // 音效停止 = 停掉当前在播的全部一次性元素（每次触发独立叠放，没有「哪一个」的概念）。
      // 元素从集合移除后，仍在途的解析结果不再回填（见 play 的 se 分支）。
      const playing = [...shots];
      shots.clear();
      for (const shot of playing) {
        if (fadeMs > 0) {
          ramps.ramp(shot, 0, fadeMs, () => shot.pause());
          continue;
        }
        shot.pause();
      }
      return;
    }
    const element = elements.get(channel);
    bumpGeneration(channel); // 作废在途物化：停止后不得再回填 src
    urls.delete(channel);
    blocked.delete(channel);
    if (element === undefined) return;
    if (fadeMs > 0) {
      ramps.fade(channel, element, 0, fadeMs); // 斜坡归零后在调度内 pause
      return;
    }
    ramps.cancel(channel);
    element.pause();
    element.volume = 1; // 复位：下次淡入以满音量为基准
  }

  function position(channel: AudioChannel): number {
    return elements.get(channel)?.currentTime ?? 0;
  }

  /**
   * 暂停通道：保留元素与播放位置，只是不出声。
   *
   * 与 `stop` 的分界——`stop` 会作废在途物化并复位音量（下次淡入以满音量为基准），
   * 那是「这一段结束了」；`pause` 是「这段还没结束，先别出声」，所以不动世代号、
   * 不动音量、不删 `urls`：恢复时同一个元素从 `currentTime` 继续，不重新解码。
   *
   * `se` 是一次性触发（每次一个独立元素，没有「第几个」的概念），不参与暂停；
   * 通道未起播或已停止时是空操作（不建元素、不改任何记录）。
   */
  function pause(channel: AudioChannel): void {
    if (channel === "se") return;
    const element = elements.get(channel);
    if (element === undefined) return;
    ramps.cancel(channel); // 在途淡入淡出作废：暂停后音量不该继续被坡改
    element.pause();
  }

  /**
   * 从暂停位置继续：未暂停（含未起播、已停止）是空操作。
   *
   * 不走 `start`：`start` 会把音量重置成 `options.volume` 并可能触发淡入，
   * 而恢复只是「继续」，音量与位置都该保持暂停前的样子。
   */
  function resume(channel: AudioChannel): void {
    if (channel === "se") return;
    const element = elements.get(channel);
    if (element === undefined || !element.paused) return;
    void element.play().then(
      () => blocked.delete(channel),
      () => {
        blocked.add(channel);
        bindGestureRetry();
      },
    );
  }

  /** 实例维度按需构建：未用到实例能力的宿主不必付出这份状态 */
  function instanceFace(): AudioInstances {
    instances ??= createAudioInstances({
      onError: portOptions.onError,
      resolveSource,
      ramps,
      requestGestureRetry: bindGestureRetry,
    });
    return instances;
  }

  function dispose(): void {
    ramps.dispose();
    if (gestureHandler !== null) {
      window.removeEventListener("pointerdown", gestureHandler);
      window.removeEventListener("keydown", gestureHandler);
      gestureHandler = null;
    }
    blocked.clear();
    for (const shot of shots) {
      shot.pause();
      shot.removeAttribute("src");
    }
    shots.clear();
    for (const element of elements.values()) {
      element.pause();
      element.removeAttribute("src");
    }
    elements.clear();
    instances?.dispose();
    instances = null;
    urls.clear();
    errorUrls.clear();
    generations.clear();
    blobSource?.dispose(); // 元素已断源，物化结果可安全释放
  }

  return {
    play,
    stop,
    pause,
    resume,
    position,
    dispose,
    playInstance: (instanceId, url, options) =>
      instanceFace().play(instanceId, url, options),
    stopInstance: (instanceId, fadeMs) =>
      instanceFace().stop(instanceId, fadeMs),
    setVolumeInstance: (instanceId, volume) =>
      instanceFace().setVolume(instanceId, volume),
    pauseInstance: (instanceId) => instanceFace().pause(instanceId),
    resumeInstance: (instanceId) => instanceFace().resume(instanceId),
  };
}
