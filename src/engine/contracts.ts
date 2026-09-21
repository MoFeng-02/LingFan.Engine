/**
 * 01-故事格式契约（最小闭环子集：列模型 + say）。
 * op 全集按规约 01 §二渐进补齐；契约只增不改（宪法 §3.1）。
 */

/** 命令：已知 op 的负载由执行器窄化校验，未知字段/未知 op fail-closed（02-E3） */
export interface StoryCommand {
  op: string;
  [field: string]: unknown;
}

/** 01 §一.3 两类列：scene（空间层）与 flow（纯流程） */
export interface StoryColumn {
  id: string;
  kind: "scene" | "flow";
  /** scene 专有：元素命令数组（元素系统按规约 01 §二.2 延后实现） */
  elements?: StoryCommand[];
  /** scene 专有：入口命令，元素后按序执行 */
  entry?: StoryCommand[];
  /** flow 专有：纯流程命令 */
  commands?: StoryCommand[];
}

/** 01 §一.1 故事 = 列的集合；formatVersion 自 v1 起版本化 */
export interface Story {
  formatVersion: 1;
  id: string;
  columns: StoryColumn[];
  /** 01 §一.6 顶层结构化定义：无条件 Set，后加载覆盖先加载 */
  defines?: Record<string, unknown>;
}

/** 01 §一.4 坐标：故事流唯一位置 `(columnId, index)` */
export interface ColumnCoordinate {
  columnId: string;
  index: number;
}

/** 02 §一.3 ValueChanged：外部观察唯一接缝（旁路读改 = 违反规约） */
export interface ValueChanged {
  key: string;
  value: unknown;
  scope: string;
}

/** 02 §三.3 engine.error 负载 */
export interface EngineErrorPayload {
  code: string;
  message: string;
  coordinate?: ColumnCoordinate;
}

/** 02 §三.1 出站统一信封：核心层出站全部 `{v, kind:'event', payload}` */
export interface OutboundEvent {
  v: 1;
  kind: "event";
  payload: EngineErrorPayload;
}

export type StateListener = (change: ValueChanged) => void;
export type EventListener = (event: OutboundEvent) => void;

/** 02 §一.4 系统键（`__` 前缀：不进用户存档、不进变量命名空间；v1 起类型化单一来源） */
export const SYS = {
  currentDialogText: "__current_dialog_text",
  currentDialogSpeaker: "__current_dialog_speaker",
  currentSceneColumn: "__current_scene_column",
  dialogComplete: "__dialog_complete",
  dialogClickable: "__dialog_clickable",
  dialogNoskip: "__dialog_noskip",
  waiting: "__waiting",
} as const;

/** 02 §二.2 等待状态（`__waiting` 取值全集） */
export type WaitingState =
  "none" | "dialog" | "menu" | "wait" | "minigame" | "input";
