/**
 * 出站事件契约：引擎向外发的事件信封，以及信封里能装的各类负载。
 * 事件流只承载离散变化（帧级键除外），宿主据此更新界面。
 */
import type { ColumnCoordinate } from "../story";

/** ValueChanged：外部观察唯一接缝（旁路读改违反单一接缝约束） */
export interface ValueChanged {
  key: string;
  value: unknown;
  scope: string;
}

/** engine.error 负载 */
export interface EngineErrorPayload {
  kind: "engine.error";
  code: string;
  message: string;
  coordinate?: ColumnCoordinate;
}

/** notify 事件：UI 覆盖层 toast */
export interface NotifyPayload {
  kind: "notify";
  text: string;
  notifyType?: string;
  duration?: number;
}

/** 回放完成事件（UI 解除输入锁、同步渲染状态） */
export interface RollbackDonePayload {
  kind: "rollback.done";
  coordinate: ColumnCoordinate;
}

/**
 * 中止句柄：引擎在等待外部系统期间，用来告知「本次接管是否已被撤销」的中立形态。
 *
 * 契约层只用语言核心类型表达，因此这里只承诺一个事实：回溯 / 导航 / 读档 / 销毁一旦
 * 发生，`aborted` 即置位，外部系统据此立即收尾，且**不得**再回填结果。
 *
 * 需要「中止时被通知」（而不是轮询 `aborted`）的宿主，可把句柄收窄回自己运行环境的
 * 中止类型再订阅事件——引擎给出的就是该环境的真实实现，收窄只发生在宿主侧。
 */
export interface AbortHandle {
  /** 已中止：本次接管已作废，外部系统应立即收尾 */
  readonly aborted: boolean;
}

/** 小游戏挂载事件：UI 据此挂载（注册表 fail-closed）；`signal.aborted` 置位 = 立即卸载 */
export interface MinigameMountPayload {
  kind: "minigame.mount";
  game: string;
  config: Record<string, unknown>;
  /** 本次挂载的中止句柄（回溯 / 导航 / 读档 / 销毁时置位） */
  signal: AbortHandle;
  /** 单调序号：重放重新挂载与旧挂载可分辨 */
  seq: number;
}

/**
 * 外部玩法系统接管事件：宿主经注册表解析系统并挂载（未注册 = fail-closed）；
 * `signal.aborted` 置位 = 立即卸载（回溯/导航/读档/销毁）。
 *
 * 与 [`MinigameMountPayload`] 同构——两者都是「引擎让出控制权 → 外部系统跑 →
 * 回传结果 → 引擎继续」的等待形态；区别只在语义专一程度
 * （minigame = 小游戏专用；interaction = 通用玩法系统）。
 */
export interface InteractionMountPayload {
  kind: "interaction.mount";
  /** 玩法系统标识（宿主注册表键；未注册 fail-closed 不伪造完成） */
  system: string;
  config: Record<string, unknown>;
  /** 本次挂载的中止句柄（回溯 / 导航 / 读档 / 销毁时置位） */
  signal: AbortHandle;
  /** 单调序号：重放重新挂载与旧挂载可分辨 */
  seq: number;
}

/** 存档命令面完成信号：`save(slot, title)` 写档成功（UI 据此提示；写失败走 engine.error） */
export interface SaveDonePayload {
  kind: "save.done";
  slot: string;
}

/** 存档命令面完成信号：`load(slot)` 读档并恢复完成（UI 据此同步渲染与媒体） */
export interface LoadDonePayload {
  kind: "load.done";
  slot: string;
}

/**
 * 读档诊断（非致命、宿主应知情）：扩展状态迁移成功 / 存档版本经
 * migrateSave 钩子迁移等。宿主不消费即忽略；致命失败走 `engine.error` + 整档拒绝。
 */
export interface LoadNoticePayload {
  kind: "load.notice";
  text: string;
}

/**
 * 出站负载的全集：核心层向外发事件时，`payload` 只可能是这里列出的成员之一。
 *
 * 宿主按各自的 `kind` 判别式分支处理；新增一种出站事件 = 在此联合加一个成员，
 * 消费方的穷尽分支会随之报错，因此不会漏接。
 */
export type OutboundPayload =
  | EngineErrorPayload
  | NotifyPayload
  | RollbackDonePayload
  | SaveDonePayload
  | LoadDonePayload
  | LoadNoticePayload
  | MinigameMountPayload
  | InteractionMountPayload;

/** 出站统一信封：核心层出站全部 `{v, kind:'event', payload}` */
export interface OutboundEvent {
  v: 1;
  kind: "event";
  payload: OutboundPayload;
}

/** 状态变化订阅者：收到「哪个键变成了什么值」，只读回调，不应回写引擎 */
export type StateListener = (change: ValueChanged) => void;
/** 出站事件订阅者：收到统一信封，按 `payload.kind` 分派处理 */
export type EventListener = (event: OutboundEvent) => void;
