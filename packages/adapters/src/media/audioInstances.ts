/**
 * 音频端口的实例维度：每个实例 id 一个 `HTMLAudioElement`，与四通道互不干扰。
 *
 * 实例是作者的编排单元（两段环境音交叉、三段音效各调各的），不是叙事语义；
 * 两者并存而非替换——归属通道只在状态里，供偏好分档。
 *
 * 与通道维度的三点差别：
 * - 同一 id 重复起播是「更新」而非叠放（改音量/循环/位置，不打断解码）；
 * - 不同 id 各自独立，可任意叠放；
 * - 每实例一个世代号，作废在途物化（停止 / 新起播取代后的迟到回填不得写回 `src`）。
 *
 * 元素、URL、世代与斜坡逐实例持有；被自动播放策略拒绝时登记该实例，等首次用户交互重试。
 */
import type { AudioPlayOptions } from "@lingfan-engine/core";
import { SEEK_EPSILON, clamp, type Ramp } from "./audioRamp";
import type { AudioRampScheduler } from "./audioRamps";

/** 实例维度的装配参数：错误出口、源物化、斜坡调度与阻塞重试登记都由此注入 */
export interface AudioInstancesOptions {
  /** 播放失败诊断（元素复用、监听器只挂一次，文案取 `urls` 的最新值） */
  onError?: (message: string) => void;
  /** 逻辑 URL → 可喂元素的 URL（未配置物化 = 原样返回） */
  resolveSource: (url: string) => Promise<string>;
  /** 斜坡调度：与通道维度共用同一条 rAF */
  ramps: AudioRampScheduler;
  /** 登记「需要首次用户交互后重试」：调度归端口，实例不自持监听器 */
  requestGestureRetry: () => void;
}

/** 实例维度面：端口的五个可选实例方法 + 重试与释放 */
export interface AudioInstances {
  play(instanceId: string, url: string, options: AudioPlayOptions): void;
  stop(instanceId: string, fadeMs?: number): void;
  setVolume(instanceId: string, volume: number): void;
  pause(instanceId: string): void;
  resume(instanceId: string): void;
  /** 首次用户交互后重试被拒实例（每次交互只调一次） */
  retryBlocked(): void;
  dispose(): void;
}

/** 造一套实例维度：元素与状态逐实例持有，与四通道各管各的 */
export function createAudioInstances(
  options: AudioInstancesOptions,
): AudioInstances {
  /** 实例元素：每个实例 id 一个（与四通道互不干扰，可任意叠放） */
  const elements = new Map<string, HTMLAudioElement>();
  /** 实例的最远一次起播逻辑 URL：仅供 error 文案点名资源 */
  const urls = new Map<string, string>();
  /** 实例的淡入淡出坡（按实例 id 键；坡体借道无名坡走同一条 rAF） */
  const ramps = new Map<string, Ramp>();
  /** 每实例世代号：作废在途物化（停止 / 新起播取代后的迟到回填） */
  const generations = new Map<string, number>();
  /** 被自动播放策略拒绝的实例：首次用户交互后重试 */
  const blocked = new Set<string>();

  /**
   * 取实例元素（必要时创建）。
   *
   * 与常驻通道同一套 error 文案策略：元素复用、监听器只挂一次，
   * 故报错时读 `urls` 的最新值才点得出是哪个资源。
   */
  function ensure(instanceId: string, url: string): HTMLAudioElement {
    let element = elements.get(instanceId);
    if (element === undefined) {
      element = new Audio();
      element.preload = "auto";
      element.addEventListener("error", () => {
        options.onError?.(
          `音频实例无法解码或缺失：${urls.get(instanceId) ?? url}（实例 ${instanceId}）`,
        );
      });
      elements.set(instanceId, element);
    }
    urls.set(instanceId, url);
    return element;
  }

  function generationOf(instanceId: string): number {
    return generations.get(instanceId) ?? 0;
  }

  function bumpGeneration(instanceId: string): number {
    const next = generationOf(instanceId) + 1;
    generations.set(instanceId, next);
    return next;
  }

  /** 摘掉实例的在途坡度：只删映射会留下坡体继续往旧目标推，两个坡互相打架 */
  function dropRamp(instanceId: string): void {
    const ramp = ramps.get(instanceId);
    if (ramp === undefined) return;
    options.ramps.drop(ramp);
    ramps.delete(instanceId);
  }

  /**
   * 实例的淡入淡出：走无名坡（与音效停止共用一条 rAF）。
   *
   * 为什么不走具名坡：那张表按**通道**键，放不下同通道的多个实例
   * （后写的会覆盖前一个，前一个的音量就冻在半路）。
   */
  function instanceFade(
    instanceId: string,
    element: HTMLAudioElement,
    to: number,
    ms: number,
  ): void {
    if (ramps.has(instanceId)) {
      // 同实例连续改音量：把旧坡整个摘掉再从当前音量重新起坡
      dropRamp(instanceId);
    }
    const target = clamp(to);
    if (ms <= 0) {
      element.volume = target;
      return;
    }
    const ramp = options.ramps.ramp(element, target, ms, () => {
      // 走完出表，否则 setVolume 会去改一个已经死掉的坡
      if (ramps.get(instanceId) === ramp) ramps.delete(instanceId);
    });
    ramps.set(instanceId, ramp);
  }

  function start(
    instanceId: string,
    element: HTMLAudioElement,
    playOptions: AudioPlayOptions,
  ): void {
    if (playOptions.fadeMs > 0) {
      element.volume = 0;
      instanceFade(instanceId, element, playOptions.volume, playOptions.fadeMs);
    } else {
      element.volume = clamp(playOptions.volume);
    }
    void element.play().then(
      () => blocked.delete(instanceId),
      () => {
        // 实例被自动播放策略拒绝：同一套「首次用户交互后重试」
        blocked.add(instanceId);
        options.requestGestureRetry();
      },
    );
  }

  function play(
    instanceId: string,
    url: string,
    playOptions: AudioPlayOptions,
  ): void {
    // 先取旧值再 ensure：后者会把本次 url 写进 urls，
    // 那之后比较「是不是同一个资源」就恒为真，换源会被当成更新而永不重设 src。
    const previousUrl = urls.get(instanceId);
    const element = ensure(instanceId, url);
    const sameUrl = previousUrl === url;
    if (sameUrl && !playOptions.restart) {
      // 同实例 + 同资源：更新而非叠放（改音量/循环/位置，不打断解码）
      element.loop = playOptions.loop;
      instanceFade(instanceId, element, playOptions.volume, playOptions.fadeMs);
      if (Math.abs(element.currentTime - playOptions.position) > SEEK_EPSILON) {
        element.currentTime = playOptions.position;
      }
      return;
    }
    if (sameUrl) {
      element.loop = playOptions.loop;
      element.currentTime = playOptions.position;
      start(instanceId, element, playOptions);
      return;
    }
    urls.set(instanceId, url);
    ramps.delete(instanceId);
    blocked.delete(instanceId);
    const mine = bumpGeneration(instanceId);
    void options.resolveSource(url).then((source) => {
      if (generationOf(instanceId) !== mine) return; // 已被停止 / 新起播取代
      element.src = source;
      element.loop = playOptions.loop;
      if (playOptions.position > 0) {
        element.addEventListener(
          "loadedmetadata",
          () => {
            element.currentTime = playOptions.position;
          },
          { once: true },
        );
      }
      start(instanceId, element, playOptions);
    });
  }

  function stop(instanceId: string, fadeMs = 0): void {
    const element = elements.get(instanceId);
    bumpGeneration(instanceId); // 作废在途物化：停止后不得再回填 src
    urls.delete(instanceId);
    blocked.delete(instanceId);
    dropRamp(instanceId);
    if (element === undefined) return;
    if (fadeMs > 0) {
      options.ramps.ramp(element, 0, fadeMs, () => element.pause());
      return;
    }
    element.pause();
  }

  function setVolume(instanceId: string, volume: number): void {
    const element = elements.get(instanceId);
    if (element === undefined) return; // 未起播的实例没有元素可改
    const ramp = ramps.get(instanceId);
    if (ramp !== undefined) {
      // 斜坡进行中：改的是坡的终点，坡本身继续走完（不跳音量）
      ramp.to = clamp(volume);
      return;
    }
    element.volume = clamp(volume);
  }

  /** 暂停实例：与通道 `pause` 同一语义——留元素留位置，不作废世代、不复位音量 */
  function pause(instanceId: string): void {
    const element = elements.get(instanceId);
    if (element === undefined) return;
    dropRamp(instanceId);
    element.pause();
  }

  /** 从暂停位置继续；未暂停（含未起播、已停止）是空操作 */
  function resume(instanceId: string): void {
    const element = elements.get(instanceId);
    if (element === undefined || !element.paused) return;
    void element.play().then(
      () => blocked.delete(instanceId),
      () => {
        blocked.add(instanceId);
        options.requestGestureRetry();
      },
    );
  }

  function retryBlocked(): void {
    for (const instanceId of [...blocked]) {
      const element = elements.get(instanceId);
      if (element === undefined) continue;
      void element.play().then(
        () => blocked.delete(instanceId),
        () => undefined,
      );
    }
  }

  function dispose(): void {
    ramps.clear();
    blocked.clear();
    for (const element of elements.values()) {
      element.pause();
      element.removeAttribute("src");
    }
    elements.clear();
    urls.clear();
    generations.clear();
  }

  return { play, stop, setVolume, pause, resume, retryBlocked, dispose };
}
