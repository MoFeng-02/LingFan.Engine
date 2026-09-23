/**
 * 02-执行模型契约：出站事件信封、系统键、等待状态。
 * ValueChanged 是外部观察唯一接缝；事件流只承载离散变化（08 §三.3 帧级键除外）。
 */
import type { ColumnCoordinate } from "./story";

/** 02 §一.3 ValueChanged：外部观察唯一接缝（旁路读改 = 违反规约） */
export interface ValueChanged {
  key: string;
  value: unknown;
  scope: string;
}

/** 02 §三.3 engine.error 负载 */
export interface EngineErrorPayload {
  kind: "engine.error";
  code: string;
  message: string;
  coordinate?: ColumnCoordinate;
}

/** 01 §二.1 notify → 08 §二.4 覆盖层 toast */
export interface NotifyPayload {
  kind: "notify";
  text: string;
  notifyType?: string;
  duration?: number;
}

/** 03-R4：回放完成事件（UI 解除输入锁、同步渲染状态） */
export interface RollbackDonePayload {
  kind: "rollback.done";
  coordinate: ColumnCoordinate;
}

export type OutboundPayload =
  EngineErrorPayload | NotifyPayload | RollbackDonePayload;

/** 02 §三.1 出站统一信封：核心层出站全部 `{v, kind:'event', payload}` */
export interface OutboundEvent {
  v: 1;
  kind: "event";
  payload: OutboundPayload;
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
  menuPrompt: "__menu_prompt",
  menuOptions: "__menu_options",
  menuTargets: "__menu_targets",
  menuSelected: "__menu_selected",
  inputPrompt: "__input_prompt",
  rollbackActive: "__rollback_active",
  nvlMode: "__nvl_mode",
  nvlBuffer: "__nvl_buffer",
  waiting: "__waiting",
  // 08 §六 媒体（四音频通道）：状态入 SSOT → 快照/存档自动随行（03-R7 / 05 §四）
  audioBgm: "__audio_bgm",
  audioSe: "__audio_se",
  audioAmbient: "__audio_ambient",
  audioVoice: "__audio_voice",
  /** 帧级键（08 §三.3）：UI 每帧回写，不进事件流 */
  bgmPosition: "__bgm_position",
  // 08 §六.5 视频（单通道命令流）：状态入 SSOT → 快照随行；cutscene 等待跨端一致
  video: "__video",
  /** video_skipable op 的持久开关（后续 video/cutscene 的缺省 skipable） */
  videoSkipable: "__video_skipable",
} as const;

/** 02 §二.2 等待状态（`__waiting` 取值全集） */
export type WaitingState =
  "none" | "dialog" | "menu" | "wait" | "minigame" | "input" | "video";

/** 08-U5 NVL 模式（`__nvl_mode` 取值）：累积层开关与清屏动作 */
export type NvlMode = "none" | "active" | "clear" | "exit";

/** 08-U4 角色定义（character op 注册；say speaker 匹配自动套样式） */
export interface CharacterDef {
  key: string;
  name?: string;
  color?: string;
  size?: string;
  font?: string;
  textColor?: string;
}
