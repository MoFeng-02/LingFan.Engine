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

/** 06 §二.1 小游戏挂载事件：UI 据此挂载（注册表 fail-closed，D5）；signal abort = 立即卸载 */
export interface MinigameMountPayload {
  kind: "minigame.mount";
  game: string;
  config: Record<string, unknown>;
  signal: AbortSignal;
  /** 单调序号：重放重新挂载与旧挂载可分辨 */
  seq: number;
}

/** 05 存档命令面完成信号：`save(slot, title)` 写档成功（UI 据此提示；写失败走 engine.error） */
export interface SaveDonePayload {
  kind: "save.done";
  slot: string;
}

/** 05 存档命令面完成信号：`load(slot)` 读档并恢复完成（UI 据此同步渲染与媒体） */
export interface LoadDonePayload {
  kind: "load.done";
  slot: string;
}

export type OutboundPayload =
  | EngineErrorPayload
  | NotifyPayload
  | RollbackDonePayload
  | SaveDonePayload
  | LoadDonePayload
  | MinigameMountPayload;

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
  /** 08 §四.5 对话框模板名（老引擎 __dialog_template 同语义；null = 全局默认） */
  dialogTemplate: "__dialog_template",
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
  /** 01 §四 I18N 当前语言（02 §一.4；setLanguage 命令写入，空串 = 默认语言/原文直出） */
  currentLanguage: "__current_language",
  /** 05 §四 auto_save 开关（auto_save op / 灵泛 PlaybackControl.AutoSave 同语义：检查点建立时消费） */
  autoSave: "__auto_save",
  nvlMode: "__nvl_mode",
  nvlBuffer: "__nvl_buffer",
  waiting: "__waiting",
  /**
   * 08 §八.3 实例级 z（T01-03）：**单控件实例显式指定**的层级（story 命令上的 `z`）。
   * 进 SSOT → 随快照 / 存档 / 回溯自动随行（重放到同一条命令即重新写入同一值）。
   * 宿主用 `resolveInstanceZ(层, 该值, 表)` 解析（**实例 > 层默认 > 内建**）；键不存在 = 未指定 = 层默认。
   * 键 ↔ 层映射单一事实源 = `runtime/shell.ts` 的 `INSTANCE_Z_KEYS`。
   */
  dialogueZ: "__dialogue_z",
  choicesZ: "__choices_z",
  notificationsZ: "__notifications_z",
  minigameZ: "__minigame_z",
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
  /** 06 §二.1 小游戏挂载信息（game/config/seq；signal 走事件不进 SSOT——运行时对象不可快照） */
  minigame: "__minigame",
  /**
   * 08 §二.1 舞台元素（声明式空间层，ElementInstance[]）：进入 scene 列时整体装载，
   * 列切换清空（空间层属于列），随快照/存档/回溯自动随行（整体 state Map 快照）。
   */
  elements: "__elements",
  /**
   * 08 §二.6 `window auto|show|hide`：对话框显隐三态（UI 层据此控制对话层可见性；
   * 叙事语义归核心层，DOM 操作归 UI）。
   */
  dialogVisible: "__dialog_visible",
  // —— 08 §二.2 表现类（帧驱动）：核心只写「启动/动画描述」，UI 每帧插值（08 §三.2） ——
  /**
   * 元素动画队列（`animate` / `animate_block` 写入）：`AnimationSpec[]`。
   * UI 每帧插值应用到 DOM（**不逐帧写 SSOT**），完成后调 `animationFinished(seq)`
   * 由核心把终值写回元素 `props` 并移除条目（快照/回溯自然随行）。
   */
  animations: "__animations",
  /** 全屏转场（`transition`）：`{ type, duration, seq }`；UI 播放完毕调 `transitionFinished()` 清除 */
  transition: "__transition",
  /** 屏幕震动（`shake`）：`{ intensity, duration, seq }`；UI 驱动偏移，播毕调 `shakeFinished()` */
  shake: "__shake",
  /** 故事级打字机设置（`text_typewriter`）：`{ enabled?, speed? }`；玩家偏好可覆盖（U10） */
  typewriter: "__typewriter",
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
  /** 08 §四.5 角色级对话框模板（say.template 优先于此；老引擎 screen 同语义） */
  screen?: string;
}
