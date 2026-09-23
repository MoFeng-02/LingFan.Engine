/**
 * 08 §六 音频端口适配器：WebView 解码（HTMLAudioElement）。
 * 入参为已解析 URL（资源寻址归 ResourcePort，08-U7）。
 * 同 URL 且 restart=false = 无缝续播/更新（只改音量/循环/位置，不重头播——03-R7 回滚 seek 语义）；
 * restart=true = 回到起点重播（同源不重设 src，避免重复解码）。
 * 淡入淡出用音量斜坡（单条 rAF，斜坡清空即停）。
 * 浏览器自动播放策略拒绝时登记该通道，首次用户交互后重试（否则首曲静默丢失）。
 */
import type {
  AudioChannel,
  AudioPlayOptions,
  AudioPort,
} from "@lingfan/engine";

/** 位置写入容差（秒）：小于此不写 currentTime，避免每帧抖动 */
const SEEK_EPSILON = 0.25;

interface Ramp {
  element: HTMLAudioElement;
  from: number;
  to: number;
  start: number;
  ms: number;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface WebAudioPortOptions {
  /** 播放失败诊断（缺失/损坏资源不静默：08-U7 报错诊断） */
  onError?: (message: string) => void;
}

export function createWebAudioPort(
  portOptions: WebAudioPortOptions = {},
): AudioPort {
  /** 常驻通道元素（se 为一次性，不入表——允许叠放） */
  const elements = new Map<AudioChannel, HTMLAudioElement>();
  const urls = new Map<AudioChannel, string>();
  const ramps = new Map<AudioChannel, Ramp>();
  /** 被自动播放策略拒绝的通道：首次用户交互后重试 */
  const blocked = new Set<AudioChannel>();
  let gestureHandler: (() => void) | null = null;
  let rafId = 0;

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
      const shot = new Audio(url);
      shot.volume = clamp(options.volume);
      shot.addEventListener("error", () => {
        portOptions.onError?.(`音效资源无法解码或缺失：${url}`);
      });
      void shot.play().catch(() => undefined);
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
    element.src = url;
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
  }

  function stop(channel: AudioChannel, fadeMs = 0): void {
    const element = elements.get(channel);
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
  }

  return { play, stop, position, dispose };
}
