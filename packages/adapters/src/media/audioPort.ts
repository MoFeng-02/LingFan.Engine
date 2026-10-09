/**
 * 音频端口适配器：WebView 解码（HTMLAudioElement）。
 * 入参为已解析 URL（资源寻址归 ResourcePort）。
 * 同 URL 且 restart=false = 无缝续播/更新（只改音量/循环/位置，不重头播——回滚 seek 语义）；
 * restart=true = 回到起点重播（同源不重设 src，避免重复解码）。
 * 淡入淡出用音量斜坡（单条 rAF，斜坡清空即停）。
 * 浏览器自动播放策略拒绝时登记该通道，首次用户交互后重试（否则首曲静默丢失）。
 * 媒体源可经 `blobSource` 物化（Android WebView 的 Range 拦截缺陷绕过，见 blobSource 模块）：
 * URL 判等仍按**逻辑 URL**（物化不改变「同源不重设 src」的无缝续播语义）。
 */
import type {
  AudioChannel,
  AudioPlayOptions,
  AudioPort,
} from "@lingfan/engine";
import { createBlobSource, type BlobSourceOptions } from "./blobSource";

/** 位置写入容差（秒）：小于此不写 currentTime，避免每帧抖动 */
const SEEK_EPSILON = 0.25;

/** 一条在跑的淡入淡出：音量从 from 线性走到 to，start/ms 给出时间轴 */
interface Ramp {
  element: HTMLAudioElement;
  from: number;
  to: number;
  start: number;
  ms: number;
}

/** 音量夹到 [0, 1]：外部传入的音量不合法时按边界值处理，而不是整段静音 */
function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

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
  const urls = new Map<AudioChannel, string>();
  const ramps = new Map<AudioChannel, Ramp>();
  /** 被自动播放策略拒绝的通道：首次用户交互后重试 */
  const blocked = new Set<AudioChannel>();
  const blobSource =
    portOptions.blobSource === undefined
      ? undefined
      : createBlobSource(portOptions.blobSource);
  /** 每通道世代号：作废在途物化（stop / 新 play 取代后的迟到回填） */
  const generations = new Map<AudioChannel, number>();
  let gestureHandler: (() => void) | null = null;
  let rafId = 0;

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

  function tick(now: number): void {
    rafId = 0;
    for (const [channel, ramp] of [...ramps]) {
      const t = Math.min(1, (now - ramp.start) / ramp.ms);
      ramp.element.volume = clamp(ramp.from + (ramp.to - ramp.from) * t);
      if (t >= 1) {
        ramps.delete(channel);
        if (ramp.to === 0) ramp.element.pause();
      }
    }
    if (ramps.size > 0) rafId = requestAnimationFrame(tick);
  }

  function fade(
    channel: AudioChannel,
    element: HTMLAudioElement,
    to: number,
    ms: number,
  ): void {
    const target = clamp(to);
    if (ms <= 0) {
      ramps.delete(channel);
      element.volume = target;
      return;
    }
    ramps.set(channel, {
      element,
      from: element.volume,
      to: target,
      start: performance.now(),
      ms,
    });
    if (rafId === 0) rafId = requestAnimationFrame(tick);
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
      fade(channel, element, options.volume, options.fadeMs);
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

  function ensure(channel: AudioChannel): HTMLAudioElement {
    let element = elements.get(channel);
    if (element === undefined) {
      element = new Audio();
      element.preload = "auto";
      element.addEventListener("error", () => {
        portOptions.onError?.(`音频资源无法解码或缺失（通道 ${channel}）`);
      });
      elements.set(channel, element);
    }
    return element;
  }

  function play(
    channel: AudioChannel,
    url: string,
    options: AudioPlayOptions,
  ): void {
    if (channel === "se") {
      // 一次性音效：独立元素，允许与常驻通道叠放；无淡入淡出与位置语义，也不重试
      const shot = new Audio();
      shot.volume = clamp(options.volume);
      shot.addEventListener("error", () => {
        portOptions.onError?.(`音效资源无法解码或缺失：${url}`);
      });
      void resolveSource(url).then((source) => {
        shot.src = source;
        void shot.play().catch(() => undefined);
      });
      return;
    }
    const element = ensure(channel);
    const sameUrl = urls.get(channel) === url;
    if (sameUrl && !options.restart) {
      // 无缝续播/更新：不重设 src（不打断解码与播放位置）
      element.loop = options.loop;
      fade(channel, element, options.volume, options.fadeMs);
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
    ramps.delete(channel);
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
    const element = elements.get(channel);
    bumpGeneration(channel); // 作废在途物化：停止后不得再回填 src
    urls.delete(channel);
    blocked.delete(channel);
    if (element === undefined) return;
    if (fadeMs > 0) {
      fade(channel, element, 0, fadeMs); // 斜坡归零后在 tick 内 pause
      return;
    }
    ramps.delete(channel);
    element.pause();
    element.volume = 1; // 复位：下次淡入以满音量为基准
  }

  function position(channel: AudioChannel): number {
    return elements.get(channel)?.currentTime ?? 0;
  }

  function dispose(): void {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    rafId = 0;
    if (gestureHandler !== null) {
      window.removeEventListener("pointerdown", gestureHandler);
      window.removeEventListener("keydown", gestureHandler);
      gestureHandler = null;
    }
    ramps.clear();
    blocked.clear();
    for (const element of elements.values()) {
      element.pause();
      element.removeAttribute("src");
    }
    elements.clear();
    urls.clear();
    generations.clear();
    blobSource?.dispose(); // 元素已断源，物化结果可安全释放
  }

  return { play, stop, position, dispose };
}
