/**
 * 小游戏契约：核心层管等待/奖励/分流，挂载与完成归 UI（任意技术）。
 *
 * 引擎只负责「发起一次小游戏并等结果」：把配置交给宿主注册的工厂，工厂在自己的
 * 挂载容器里把游戏跑起来，跑完回传结果。挂载容器长什么样、用什么技术渲染，都由
 * 宿主决定——契约层只用语言核心类型表达，因此容器是 `unknown`，中止是可轮询的
 * 句柄（见 [`AbortHandle`]）。
 */
import type { AbortHandle, MinigameMountPayload } from "./runtime/index.ts";

export type { MinigameMountPayload };

/**
 * 挂载上下文：`config` = minigame 命令的 config 负载原样透传；
 * `signal.aborted` 置位 = 回溯/读档/导航/销毁，小游戏应立即收尾且不得回填结果。
 */
export interface MinigameContext {
  config: Record<string, unknown>;
  signal: AbortHandle;
  /** 本次挂载的单调序号（重放 = 新序号新 signal） */
  readonly seq: number;
}

/** 小游戏完成结果：outcome 驱动 on_success/on_fail 分流；score 供 UI/统计，核心层不消费 */
export interface MinigameResult {
  outcome: "success" | "fail";
  score?: number;
  /** 可选：小游戏写入的补充状态（键 = 本游戏命名空间内的键，引擎负责落 `game.<gameId>.` 前缀） */
  state?: Readonly<Record<string, unknown>>;
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

/**
 * 玩法系统注册元数据（宿主经 `EngineOptions.minigames` 注入，与 `OpExtension`
 * 声明制同构；工厂注册表仍归 UI 层——引擎只持有这份数据面）。
 * 读档时按档内 `minigames` 依赖标记校验注册与版本（缺注册 = `minigame-missing`，
 * 版本不可达且无 migrate = `minigame-version`），保证玩法系统状态不静默串版本。
 */
export interface MinigameRegistration {
  /** 玩法系统 id（与 minigame 命令的 `game` 同域，注册期按 `GAME_SYSTEM_ID_PATTERN` 校验） */
  readonly gameId: string;
  /** 状态 schema 版本（≠ 代码版本）：存档校验的是它，代码升级不等于状态升级 */
  readonly stateVersion: number;
  /**
   * 可选：状态迁移（stateVersion 升级路径）。`state` = 本系统命名空间内的键值
   * （**不含** `game.<gameId>.` 前缀），返回同构对象（引擎负责重新落前缀）。
   * **不抛**；返回 null = 无法迁移 → 整档拒绝（`minigame-version`，状态原样）。
   */
  readonly migrate?: (
    fromStateVersion: number,
    state: Readonly<Record<string, unknown>>,
  ) => Record<string, unknown> | null;
}
