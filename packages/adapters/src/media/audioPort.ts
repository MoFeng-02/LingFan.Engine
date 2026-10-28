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
} from "@lingfan-engine/core";
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
  /** 斜坡走完后的收尾（音效停止时用来 pause；常驻通道靠 to===0 的既有约定） */
  onDone?: () => void;
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
  const ramps = new Map<AudioChannel, Ramp>();
  /**
   * 无名元素的斜坡（音效停止时的淡出）。
   *
   * 常驻通道的斜坡按通道键存在 `ramps` 里；音效没有通道键（每次触发都是新元素），
   * 故单列一个数组。与 `ramps` 共用同一条 rAF。
   */
  const unnamedRamps: Ramp[] = [];
  /** 实例元素：每个实例 id 一个（与四通道互不干扰，可任意叠放） */
  const instanceElements = new Map<string, HTMLAudioElement>();
  /** 实例的最远一次起播逻辑 URL：仅供 error 文案点名资源 */
  const instanceUrls = new Map<string, string>();
  /** 实例的淡入淡出坡（按实例 id 键；坡体借道 `unnamedRamps` 走同一条 rAF） */
  const instanceRamps = new Map<string, Ramp>();
  /** 每实例世代号：作废在途物化（停止 / 新起播取代后的迟到回填） */
  const instanceGenerations = new Map<string, number>();
  /** 被自动播放策略拒绝的实例：首次用户交互后重试 */
  const blockedInstances = new Set<string>();
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
    for (let i = unnamedRamps.length - 1; i >= 0; i -= 1) {
      const ramp = unnamedRamps[i]!;
      const t = Math.min(1, (now - ramp.start) / ramp.ms);
      ramp.element.volume = clamp(ramp.from + (ramp.to - ramp.from) * t);
      if (t >= 1) {
        unnamedRamps.splice(i, 1);
        // 实例斜坡走完要出表，否则 setVolumeInstance 会去改一个已经死掉的坡
        for (const [id, at] of instanceRamps) {
          if (at === ramp) instanceRamps.delete(id);
        }
        ramp.onDone?.();
      }
    }
    if (ramps.size > 0 || unnamedRamps.length > 0) {
      rafId = requestAnimationFrame(tick);
    }
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

  /** 无名元素的淡出（音效停止用）：走完调用 `onDone` */
  function rampElement(
    element: HTMLAudioElement,
    to: number,
    ms: number,
    onDone: () => void,
  ): void {
    unnamedRamps.push({
      element,
      from: element.volume,
      to: clamp(to),
      start: performance.now(),
      ms,
      onDone,
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
    for (const instanceId of [...blockedInstances]) {
      const element = instanceElements.get(instanceId);
      if (element === undefined) continue;
      void element.play().then(
        () => blockedInstances.delete(instanceId),
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
    if (channel === "se") {
      // 音效停止 = 停掉当前在播的全部一次性元素（每次触发独立叠放，没有「哪一个」的概念）。
      // 元素从集合移除后，仍在途的解析结果不再回填（见 play 的 se 分支）。
      const playing = [...shots];
      shots.clear();
      for (const shot of playing) {
        if (fadeMs > 0) {
          rampElement(shot, 0, fadeMs, () => shot.pause());
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

  // —— 实例维度：每个 id 一个元素，与四通道互不干扰 ——

  /**
   * 取实例元素（必要时创建）。
   *
   * 与常驻通道同一套 error 文案策略：元素复用、监听器只挂一次，
   * 故报错时读 `instanceUrls` 的最新值才点得出是哪个资源。
   */
  function ensureInstance(instanceId: string, url: string): HTMLAudioElement {
    let element = instanceElements.get(instanceId);
    if (element === undefined) {
      element = new Audio();
      element.preload = "auto";
      element.addEventListener("error", () => {
        portOptions.onError?.(
          `音频实例无法解码或缺失：${instanceUrls.get(instanceId) ?? url}（实例 ${instanceId}）`,
        );
      });
      instanceElements.set(instanceId, element);
    }
    instanceUrls.set(instanceId, url);
    return element;
  }

  function instanceGenerationOf(instanceId: string): number {
    return instanceGenerations.get(instanceId) ?? 0;
  }

  function bumpInstanceGeneration(instanceId: string): number {
    const next = instanceGenerationOf(instanceId) + 1;
    instanceGenerations.set(instanceId, next);
    return next;
  }

  /**
   * 实例的淡入淡出：走无名斜坡（`unnamedRamps`），与音效停止共用一条 rAF。
   *
   * 为什么不塞进 `ramps`：那张表按**通道**键，一张通道表里放不下同通道的多个实例
   * （后写的会覆盖前一个，前一个的音量就冻在半路）。实例按 id 键，故另表。
   */
  function instanceFade(
    instanceId: string,
    element: HTMLAudioElement,
    to: number,
    ms: number,
  ): void {
    const existing = instanceRamps.get(instanceId);
    if (existing !== undefined) {
      // 同实例连续改音量：把旧坡整个摘掉再从当前音量重新起坡——
      // 只删映射不摘坡体的话，旧坡还会继续往旧目标推，两个坡互相打架。
      const at = unnamedRamps.indexOf(existing);
      if (at >= 0) unnamedRamps.splice(at, 1);
      instanceRamps.delete(instanceId);
    }
    const target = clamp(to);
    if (ms <= 0) {
      element.volume = target;
      return;
    }
    const ramp: Ramp = {
      element,
      from: element.volume,
      to: target,
      start: performance.now(),
      ms,
    };
    instanceRamps.set(instanceId, ramp);
    unnamedRamps.push(ramp);
    if (rafId === 0) rafId = requestAnimationFrame(tick);
  }

  function playInstance(
    instanceId: string,
    url: string,
    options: AudioPlayOptions,
  ): void {
    // 先取旧值再 ensureInstance：后者会把本次 url 写进 instanceUrls，
    // 那之后比较「是不是同一个资源」就恒为真，换源会被当成更新而永不重设 src。
    const previousUrl = instanceUrls.get(instanceId);
    const element = ensureInstance(instanceId, url);
    const sameUrl = previousUrl === url;
    if (sameUrl && !options.restart) {
      // 同实例 + 同资源：更新而非叠放（改音量/循环/位置，不打断解码）
      element.loop = options.loop;
      instanceFade(instanceId, element, options.volume, options.fadeMs);
      if (Math.abs(element.currentTime - options.position) > SEEK_EPSILON) {
        element.currentTime = options.position;
      }
      return;
    }
    if (sameUrl) {
      element.loop = options.loop;
      element.currentTime = options.position;
      startInstance(instanceId, element, options);
      return;
    }
    instanceUrls.set(instanceId, url);
    instanceRamps.delete(instanceId);
    blockedInstances.delete(instanceId);
    const mine = bumpInstanceGeneration(instanceId);
    void resolveSource(url).then((source) => {
      if (instanceGenerationOf(instanceId) !== mine) return; // 已被停止 / 新起播取代
      element.src = source;
      element.loop = options.loop;
      if (options.position > 0) {
        element.addEventListener(
          "loadedmetadata",
          () => {
            element.currentTime = options.position;
          },
          { once: true },
        );
      }
      startInstance(instanceId, element, options);
    });
  }

  function startInstance(
    instanceId: string,
    element: HTMLAudioElement,
    options: AudioPlayOptions,
  ): void {
    if (options.fadeMs > 0) {
      element.volume = 0;
      instanceFade(instanceId, element, options.volume, options.fadeMs);
    } else {
      element.volume = clamp(options.volume);
    }
    void element.play().then(
      () => blockedInstances.delete(instanceId),
      () => {
        // 实例被自动播放策略拒绝：同一套「首次用户交互后重试」
        blockedInstances.add(instanceId);
        bindGestureRetry();
      },
    );
  }

  function stopInstance(instanceId: string, fadeMs = 0): void {
    const element = instanceElements.get(instanceId);
    bumpInstanceGeneration(instanceId); // 作废在途物化：停止后不得再回填 src
    instanceUrls.delete(instanceId);
    blockedInstances.delete(instanceId);
    const ramp = instanceRamps.get(instanceId);
    if (ramp !== undefined) {
      const at = unnamedRamps.indexOf(ramp);
      if (at >= 0) unnamedRamps.splice(at, 1);
      instanceRamps.delete(instanceId);
    }
    if (element === undefined) return;
    if (fadeMs > 0) {
      rampElement(element, 0, fadeMs, () => element.pause());
      return;
    }
    element.pause();
  }

  function setVolumeInstance(instanceId: string, volume: number): void {
    const element = instanceElements.get(instanceId);
    if (element === undefined) return; // 未起播的实例没有元素可改
    const ramp = instanceRamps.get(instanceId);
    if (ramp !== undefined) {
      // 斜坡进行中：改的是坡的终点，坡本身继续走完（不跳音量）
      ramp.to = clamp(volume);
      return;
    }
    element.volume = clamp(volume);
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
    unnamedRamps.length = 0;
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
    instanceRamps.clear();
    blockedInstances.clear();
    for (const element of instanceElements.values()) {
      element.pause();
      element.removeAttribute("src");
    }
    instanceElements.clear();
    instanceUrls.clear();
    instanceGenerations.clear();
    urls.clear();
    errorUrls.clear();
    generations.clear();
    blobSource?.dispose(); // 元素已断源，物化结果可安全释放
  }

  return {
    play,
    stop,
    position,
    dispose,
    playInstance,
    stopInstance,
    setVolumeInstance,
  };
}
