/**
 * 音频端口适配器（小程序）：微信 `InnerAudioContext` 解码。
 * 语义与 Web 实现（`../media/audioPort.ts`）对齐，差异只来自平台：
 * - 同 URL 且 `restart=false` = 更新（改音量/循环/位置），不重设 `src`（避免重复解码）；
 * - `restart=true` / 换 URL = 重设 `src` 起播；
 * - 淡入淡出用音量斜坡（定时器推进；小程序侧没有统一的 rAF 通道，用 16ms 步长 ≈ 一帧）；
 * - `se` 一次性、不入常驻表（允许叠放），靠 `onEnded` 回收实例。
 * 平台没有「自动播放策略拒绝」这类需要补偿的形态，因此不登记重试。
 */
import type {
  AudioChannel,
  AudioPlayOptions,
  AudioPort,
} from "@lingfan-engine/core";
import type { MiniprogramAudioContextLike } from "./platform.ts";

/** 位置写入容差（秒）：小于此不 seek，避免每帧抖动（与 Web 实现同口径） */
const SEEK_EPSILON = 0.25;
/** 音量斜坡步长（毫秒）：≈ 一帧 */
const RAMP_STEP_MS = 16;
/** 常驻通道（`se` 为一次性实例，不入表——允许叠放） */
const PERSISTENT_CHANNELS: readonly AudioChannel[] = [
  "bgm",
  "ambient",
  "voice",
];

/** 一条常驻通道的实例状态 */
interface Slot {
  ctx: MiniprogramAudioContextLike;
  url: string;
  /** 在跑的音量斜坡定时器句柄 */
  ramp?: ReturnType<typeof setTimeout>;
  /** 暂停时记下的播放位置（秒）：这个平台没有可恢复暂停，恢复靠它 seek 回去 */
  pausedAt?: number;
}

/** 音量夹到 [0, 1]：外部传入不合法时按边界值处理，而不是整段静音 */
function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 造一个音频端口（小程序）。
 * @param createAudio 造实例：宿主注入 `() => wx.createInnerAudioContext()`
 */
export function createMiniprogramAudioPort(
  createAudio: () => MiniprogramAudioContextLike,
): AudioPort {
  /** 常驻通道实例（bgm / ambient / voice） */
  const slots = new Map<AudioChannel, Slot>();
  /** 一次性实例（se）：播完或 stop 后销毁 */
  const oneShots = new Set<Slot>();

  /** 停掉某条槽位的斜坡（不影响音量） */
  function cancelRamp(slot: Slot): void {
    if (slot.ramp !== undefined) {
      clearTimeout(slot.ramp);
      slot.ramp = undefined;
    }
  }

  /** 音量斜坡：`ms <= 0` 直接落值；到 0 时执行 onReach（用于淡出后停） */
  function rampTo(
    slot: Slot,
    to: number,
    ms: number,
    onReach?: () => void,
  ): void {
    cancelRamp(slot);
    const target = clamp(to);
    if (ms <= 0) {
      slot.ctx.volume = target;
      onReach?.();
      return;
    }
    const from = slot.ctx.volume;
    const start = Date.now();
    const step = (): void => {
      const t = Math.min(1, (Date.now() - start) / ms);
      slot.ctx.volume = clamp(from + (target - from) * t);
      if (t < 1) {
        slot.ramp = setTimeout(step, RAMP_STEP_MS);
        return;
      }
      slot.ramp = undefined;
      onReach?.();
    };
    step();
  }

  /** 销毁一条槽位（先停斜坡再销毁实例） */
  function destroySlot(slot: Slot): void {
    cancelRamp(slot);
    slot.ctx.destroy();
  }

  function play(
    channel: AudioChannel,
    url: string,
    options: AudioPlayOptions,
  ): void {
    const persistent = PERSISTENT_CHANNELS.includes(channel);
    const current = persistent ? slots.get(channel) : undefined;
    if (current !== undefined && current.url === url && !options.restart) {
      // 同源续播：只改音量/循环/位置，不重设 src
      current.ctx.loop = options.loop;
      rampTo(current, options.volume, options.fadeMs);
      const position = options.position;
      if (
        position > 0 &&
        Math.abs((current.ctx.currentTime ?? 0) - position) > SEEK_EPSILON
      ) {
        current.ctx.seek(position);
      }
      return;
    }
    // 换源或重播：常驻通道复用实例（避免重复解码），一次性通道新建（允许叠放）
    const reused = persistent ? current : undefined;
    const slot: Slot = { ctx: reused?.ctx ?? createAudio(), url };
    // 起播即作废暂停记账：之后 resume 不该把位置拉回上一次暂停点
    if (reused !== undefined) {
      cancelRamp(reused);
      reused.pausedAt = undefined;
    }
    // 复用实例才需要清掉上一次（同源重播靠它回到起点）；全新实例没什么可停的
    if (reused !== undefined) reused.ctx.stop();
    slot.ctx.src = url;
    slot.ctx.loop = options.loop;
    slot.ctx.volume = options.fadeMs > 0 ? 0 : clamp(options.volume);
    if (persistent) {
      slots.set(channel, slot);
    } else {
      oneShots.add(slot);
      slot.ctx.onEnded?.(() => {
        oneShots.delete(slot);
        destroySlot(slot);
      });
    }
    slot.ctx.play();
    if (options.position > 0) slot.ctx.seek(options.position);
    if (options.fadeMs > 0) rampTo(slot, options.volume, options.fadeMs);
  }

  function stop(channel: AudioChannel, fadeMs = 0): void {
    const slot = slots.get(channel);
    if (slot === undefined) return;
    // 停止即作废暂停记账：停止之后没有「继续」这回事
    slot.pausedAt = undefined;
    // 停完复位音量：下次淡入以满音量为基准（与 Web 实现同口径）
    const settle = (): void => {
      slot.ctx.stop();
      slot.ctx.volume = 1;
    };
    cancelRamp(slot);
    if (fadeMs > 0) {
      rampTo(slot, 0, fadeMs, settle);
      return;
    }
    settle();
  }

  function position(channel: AudioChannel): number {
    return slots.get(channel)?.ctx.currentTime ?? 0;
  }

  /**
   * 暂停通道。
   *
   * 这个平台的播放器没有 pause：只有 play / stop / seek。所以「暂停」用
   * 「记下当前位置 + stop」模拟，`resume` 再 `play` + `seek` 回记录位置。
   * 代价是恢复时有一次重新解码（不是无缝续播），语义上仍从原位置继续。
   * `se` 是一次性触发，不参与暂停；未起播或已停止的通道是空操作。
   */
  function pause(channel: AudioChannel): void {
    const slot = slots.get(channel);
    if (slot === undefined) return;
    cancelRamp(slot); // 在途斜坡作废：暂停后音量不该继续被坡改
    slot.pausedAt = slot.ctx.currentTime ?? 0;
    slot.ctx.stop();
  }

  /** 从暂停位置继续；未暂停（含未起播、已停止）是空操作 */
  function resume(channel: AudioChannel): void {
    const slot = slots.get(channel);
    if (slot === undefined || slot.pausedAt === undefined) return;
    const at = slot.pausedAt;
    slot.pausedAt = undefined;
    slot.ctx.play();
    if (at > 0) slot.ctx.seek(at);
  }

  function dispose(): void {
    for (const slot of slots.values()) destroySlot(slot);
    for (const slot of oneShots) destroySlot(slot);
    slots.clear();
    oneShots.clear();
  }

  // 实例族（play/stop/setVolume/pause/resumeInstance）全部不实现：本平台的音频
  // 上下文只有 play / stop / seek 三个动作面，没有 pause——暂停只能 stop + 记住位置
  // 再 seek 回来。实例是作者可同时编排的多个声部，这种「伪暂停」逐个实例做会与
  // 常驻通道的位置记账打架，收益不抵复杂度；实例族在契约里是可选能力，缺省即降级
  // 为「实例不发声」，渲染层用 `?.` 静默跳过，不会因此卡住整段音频。
  return { play, stop, pause, resume, position, dispose };
}
