/**
 * 06 §二.1 小游戏契约：核心层管等待/奖励/分流（D5/F8），挂载与完成归 UI（任意技术）。
 * MinigameFactory 的宿主元素由 UI 层提供——引擎核心只承载类型（Web 标准 DOM，零框架依赖）。
 */
import type { MinigameMountPayload } from "./runtime";

export type { MinigameMountPayload };

/** 挂载上下文：config = minigame 命令的 config 负载原样透传；signal = 回溯/读档/导航中断时 abort */
export interface MinigameContext {
  config: Record<string, unknown>;
  signal: AbortSignal;
}

/** 小游戏完成结果：outcome 驱动 on_success/on_fail 分流（F8）；score 供 UI/统计，核心层不消费 */
export interface MinigameResult {
  outcome: "success" | "fail";
  score?: number;
}

export type MinigameFactory = (
  host: HTMLElement,
  ctx: MinigameContext,
) => Promise<MinigameResult>;
