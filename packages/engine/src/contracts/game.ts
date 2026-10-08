/**
 * 玩法能力集成契约：外部系统（行走 / 战斗 / 背包 / QTE…）与叙事引擎的数据交换面。
 *
 * 定位：叙事引擎是**基础层**，外部玩法能力经本契约与它双向交换数据。三条不变量：
 *
 * 1. **状态即接口**——两侧不共享对象引用，只共享键值对（JSON 安全值）。
 *    ⇒ 天然可序列化、可快照、可回溯；外部系统**禁止**持有旁路状态
 *    （旁路状态不会进快照，回溯后与引擎状态不一致 = 数据撕裂）。
 * 2. **写入即入档**——任何外部写入都进 SSOT（引擎单一事实源），
 *    因此自动随快照 / 存档 / 回溯随行（回溯到进入城镇前，人物坐标一并回退）。
 * 3. **fail-closed**——写入违规（键保留 / 值不可序列化）一律拒绝 + 诊断，状态原样。
 *
 * 频率二分（沿用引擎既有裁定，见 `reportMediaPosition`）：
 * - **高频**（每帧坐标、朝向）→ [`GameStateWriter.setSilent`]：静默写，不进事件流（防事件风暴）
 * - **低频**（拾取物品、完成任务、切换场景）→ [`GameStateWriter.set`]：进事件流（UI 需响应）
 *
 * 由调用方按**自身频率**选择，引擎不猜（猜错要么丢 UI 响应，要么事件风暴）。
 */

/** 外部玩法系统标识形态：小写字母开头，小写字母/数字/`_`/`-`，1..32（与扩展 id 同口径） */
export const GAME_SYSTEM_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** 玩法系统写状态的命名空间前缀（`game.<systemId>.`）——与作者变量、`ext.` 三方隔离 */
export function gameScopedKey(systemId: string, key: string): string {
  return `game.${systemId}.${key}`;
}

/**
 * 外部状态写入端口（宿主组合根持有；外部玩法系统只经它写引擎状态）。
 *
 * 实现归引擎（[`StoryEngine`] 提供），因为它必须复用引擎的写入契约
 * （保留键拒绝 + JSON 安全深走查）——外部自建写入面必然绕过守卫。
 */
export interface GameStateWriter {
  /**
   * 写全局状态并**进事件流**（UI 可响应）。适用于低频、需要界面反馈的变更。
   * @returns 是否写入成功（false = 已出站 `engine.error`，状态原样）
   */
  set(key: string, value: unknown): boolean;

  /**
   * 写全局状态**不进事件流**（帧级静默写）。适用于高频变更（每帧坐标）。
   * 值仍随快照/存档持久化（回溯一致性与 `set` 相同）。
   * @returns 是否写入成功
   */
  setSilent(key: string, value: unknown): boolean;

  /**
   * 写本系统命名空间（`game.<systemId>.<key>`）并进事件流。
   * 推荐用法：外部系统状态与作者变量隔离，避免撞名；作者读 `{game.walk.x}` 即可。
   * @returns 是否写入成功。systemId 非法 / 写入违规 ⇒ false + 诊断
   */
  setScoped(systemId: string, key: string, value: unknown): boolean;

  /**
   * 写本系统命名空间**不进事件流**（帧级静默写；每帧坐标的标准通道）。
   * @returns 是否写入成功
   */
  setScopedSilent(systemId: string, key: string, value: unknown): boolean;

  /** 读状态（供外部系统做差分 / 断言；读不到返回 undefined） */
  get(key: string): unknown;
}

/**
 * 外部玩法系统的**接管句柄**（宿主经 `interaction.mount` 事件收到）。
 *
 * 生命周期与 `minigame.mount` 完全同构（不新造语义）：
 * 挂载 → 外部系统运行 → `resolve` 回传结果 / `signal` 中止（回溯、导航、读档、destroy）。
 */
export interface InteractionContext {
  /** 该系统的配置（`interaction` op 的 `config`，原样透传，引擎不解释） */
  readonly config: Readonly<Record<string, unknown>>;
  /** 中止信号：回溯 / 导航 / 读档 / 销毁时 abort，外部系统据此卸载（不得回填结果） */
  readonly signal: AbortSignal;
  /** 本次挂载的单调序号（重放 = 新序号新 signal） */
  readonly seq: number;
}

/**
 * 外部玩法系统的执行结果：`outcome` 决定走 `on_success` 还是 `on_fail`；
 * `score` 可选（供宿主展示；引擎不解释）。
 */
export interface InteractionResult {
  readonly outcome: "success" | "fail";
  readonly score?: number;
  /** 可选：外部系统写入的补充状态（键 = 本系统命名空间内的键，引擎负责落 `game.<系统>.` 前缀） */
  readonly state?: Readonly<Record<string, unknown>>;
}

/**
 * 玩法系统工厂：宿主注册到注册表后，引擎等待期经 `interaction.mount` 事件唤起。
 *
 * **不得抛**（同 minigame 约束）；返回的 Promise 在 `signal` abort 后应尽快结束
 * （引擎不再接收其结果，见 `resolveInteraction` 的等待态守卫）。
 */
export type InteractionFactory = (
  host: HTMLElement,
  ctx: InteractionContext,
) => Promise<InteractionResult>;
