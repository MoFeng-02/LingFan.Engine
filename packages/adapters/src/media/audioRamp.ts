/**
 * 音频端口共用的斜坡词汇：位置容差、一条在跑的淡入淡出、音量夹取。
 *
 * 单独成文件是因为这三样被端口的两套维度共用（四通道与实例表各有自己的斜坡表，
 * 但斜坡的形状、容差与夹取规则必须是同一套——两套口径会让「同一个音量」在两个
 * 维度上落到不同的值）。斜坡的调度仍归端口：`requestAnimationFrame` 只该有一条。
 */

/** 位置写入容差（秒）：小于此不写 currentTime，避免每帧抖动 */
export const SEEK_EPSILON = 0.25;

/** 一条在跑的淡入淡出：音量从 from 线性走到 to，start/ms 给出时间轴 */
export interface Ramp {
  element: HTMLAudioElement;
  from: number;
  to: number;
  start: number;
  ms: number;
  /** 斜坡走完后的收尾（音效停止时用来 pause；常驻通道靠 to===0 的既有约定） */
  onDone?: () => void;
}

/** 音量夹到 [0, 1]：外部传入的音量不合法时按边界值处理，而不是整段静音 */
export function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
