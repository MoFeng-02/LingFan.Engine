/**
 * 小游戏契约：核心层管等待/奖励/分流，挂载与完成归 UI（任意技术）。
 *
 * 引擎只负责「发起一次小游戏并等结果」：把配置交给宿主注册的工厂，工厂在自己的
 * 挂载容器里把游戏跑起来，跑完回传结果。挂载容器长什么样、用什么技术渲染，都由
 * 宿主决定——契约层只用语言核心类型表达，因此容器是 `unknown`，中止是可轮询的
 * 句柄（见 [`AbortHandle`]）。
 */
import type { AbortHandle, MinigameMountPayload } from "./runtime";

export type { MinigameMountPayload };

/**
 * 挂载上下文：`config` = minigame 命令的 config 负载原样透传；
 * `signal.aborted` 置位 = 回溯/读档/导航/销毁，小游戏应立即收尾且不得回填结果。
 */
export interface MinigameContext {
  config: Record<string, unknown>;
  signal: AbortHandle;
}

/** 小游戏完成结果：outcome 驱动 on_success/on_fail 分流；score 供 UI/统计，核心层不消费 */
export interface MinigameResult {
  outcome: "success" | "fail";
  score?: number;
}

/**
 * 小游戏工厂：宿主注册到注册表后，引擎等待期经 `minigame.mount` 事件唤起。
 *
 * **不得抛**；返回的 Promise 在 `signal.aborted` 置位后应尽快结束（引擎不再接收其结果）。
 * `host` 是宿主提供的挂载容器，契约层只承诺「有个可挂载的东西」，不承诺它是什么类型；
 * 宿主在自己的实现里把它收窄回具体容器类型即可。
 */
export type MinigameFactory = (
  host: unknown,
  ctx: MinigameContext,
) => Promise<MinigameResult>;
