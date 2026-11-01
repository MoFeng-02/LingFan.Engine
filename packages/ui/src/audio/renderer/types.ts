import type { PlayerPreferences } from "@lingfan-engine/core";

/** 音频渲染器：订阅通道事件 → 差量应用；位置回写由帧循环驱动 */
export interface AudioRenderer {
  /** 与引擎状态对齐（订阅外的显式同步，如读档/回溯完成） */
  sync(): void;
  /** 帧循环回写播放位置：帧级键静默写，不进事件流 */
  pollPosition(): void;
  dispose(): void;
}

/**
 * 宿主侧回调：解析失败的诊断出口；不传则该失败被静默忽略。
 * `preferences` 是唯一的可选注入——不传即无偏好，音量按引擎状态算。
 */
export interface AudioRendererOptions {
  /** 资源解析失败诊断（报错诊断：不静默吞错） */
  onError?: (message: string) => void;
  /** 玩家偏好（可选）：合成通道有效音量；偏好变化即时重规划（滑块/静音即时生效） */
  preferences?: PlayerPreferences;
}
