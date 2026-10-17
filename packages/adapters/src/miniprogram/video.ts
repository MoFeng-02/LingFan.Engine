/**
 * 视频端口适配器（小程序）：小程序的 `video` 是声明式组件，宿主实现呈现面（建节点、绑 `bindended`），
 * 本包只推状态。与 Web 实现（`../media/videoPort.ts`）对齐的语义：
 * 新 `play` 替换当前；`stop` 停并隐藏；自然结束经 `onEnded` 上报（cutscene 由它解除引擎等待）。
 * 小程序原生 `video` 组件不受 `z-index` 控制，因此**不实现** `VideoPort.setZIndex` 这个可选能力：
 * 层 z 取构造期值，随 `show` 一起交给呈现面（缺省 5 = 旧行为）。
 */
import type { VideoPort } from "@lingfan/engine";
import type { MiniprogramVideoSurfaceLike } from "./platform.ts";

/** 视频端口的装配参数 */
export interface MiniprogramVideoOptions {
  /** 层 z 序（层级契约）：组合根传入解析后的层表值；缺省 5 = 旧行为 */
  zIndex?: number;
}

/** 音量夹到 [0, 1]（与 Web 实现同口径） */
function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 造一个视频端口（小程序）。
 * @param surface 呈现面：宿主注入「把状态落到 `video` 组件上」的实现
 * @param options 层 z 等装配参数
 */
export function createMiniprogramVideoPort(
  surface: MiniprogramVideoSurfaceLike,
  options: MiniprogramVideoOptions = {},
): VideoPort {
  const zIndex = options.zIndex ?? 5;
  let endedHandler: (() => void) | null = null;
  let visible = false;
  // 结束回调由呈现面注册一次（组件 `bindended` 转发），每次 play 换的是上面这个处理器
  surface.onEnded(() => {
    if (endedHandler !== null) endedHandler();
  });
  return {
    play(url, playOptions, onEnded): void {
      endedHandler = onEnded ?? null;
      visible = true;
      surface.show({
        url,
        volume: clamp(playOptions.volume),
        loop: playOptions.loop,
        zIndex,
      });
    },
    pause(): void {
      if (visible) surface.pause();
    },
    resume(): void {
      if (visible) surface.resume();
    },
    seek(seconds): void {
      if (visible) surface.seek(Math.max(0, seconds));
    },
    stop(): void {
      endedHandler = null;
      visible = false;
      surface.hide();
    },
    dispose(): void {
      endedHandler = null;
      visible = false;
      surface.hide();
    },
  };
}
