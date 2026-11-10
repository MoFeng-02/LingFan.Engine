/**
 * 视频端口适配器（小程序）：小程序的 `video` 是声明式组件，宿主实现呈现面（建节点、绑 `bindended`），
 * 本包只推状态。与 Web 实现（`../media/videoPort.ts`）对齐的语义：
 * 新 `play` 替换当前；`stop` 停并隐藏；自然结束经 `onEnded` 上报（cutscene 由它解除引擎等待）。
 * 小程序原生 `video` 组件不受 `z-index` 控制，因此**不实现** `VideoPort.setZIndex` 这个可选能力：
 * 层 z 取构造期值，随 `show` 一起交给呈现面（缺省 5 = 旧行为）。
 */
import type { ElementFit, VideoPort } from "@lingfan-engine/core";
import { DEFAULT_ELEMENT_FIT } from "@lingfan-engine/core";
import type { MiniprogramVideoSurfaceLike } from "./platform.ts";

/** 视频端口的装配参数 */
export interface MiniprogramVideoOptions {
  /** 层 z 序（层级契约）：组合根传入解析后的层表值；缺省 5 = 旧行为 */
  zIndex?: number;
  /**
   * 填充方式（组合根注入的惰性读数，缺省 `cover`）。
   *
   * 与 Web 端口同一模式：填充来自当前故事里 `video` 元素的 `stretch` 属性，
   * 元素表在运行期才确定、还会随换列变化，所以用 `readX: () => X` 的惰性读数而非常量。
   */
  fit?: () => ElementFit;
}

/**
 * 填充方式 → 小程序 `video` 组件的 `object-fit` 值。
 *
 * 平台事实：小程序的 `object-fit` **只接受 `contain` / `fill` / `cover`**（没有 `none`，
 * 也没有 `scale-down`）。两个缺口都退化为 `contain`——那是「整幅都看得见」的一侧，
 * 裁切比留边更容易丢掉画面信息。
 */
function objectFitOf(fit: ElementFit): string {
  switch (fit) {
    case "fill":
      return "fill";
    case "cover":
      return "cover";
    default:
      return "contain";
  }
}

/** 音量夹到 [0, 1]（与 Web 实现同口径） */
function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 造一个视频端口（小程序）。
 * @param surface 呈现面：宿主注入「把状态落到 `video` 组件上」的实现
 * @param options 层 z 与填充方式等装配参数
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
        // 每次 play 重读：`video` 元素的 `stretch` 可能是这一列刚写的
        objectFit: objectFitOf(options.fit?.() ?? DEFAULT_ELEMENT_FIT),
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
