/**
 * 01-故事格式契约（渐进子集）+ 02 执行契约 + 07 工程清单。
 * op 全集按规约 01 §二渐进补齐；契约只增不改（宪法 §3.1）。
 */

/** 命令：已知 op 的负载由解析器/执行器窄化校验，未知字段/未知 op fail-closed（02-E3） */
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

/** 01 §一.1 故事 = 列的集合（多文件组装后的运行时形态）；formatVersion 自 v1 起版本化 */
export interface Story {
  formatVersion: 1;
  id: string;
  /** 01 §一.7 入口列：project.json entry 字段；单文件故事默认首列 */
  entry: string;
  columns: StoryColumn[];
  /** 01 §一.6 顶层结构化定义：无条件 Set，后加载覆盖先加载 */
  defines?: Record<string, unknown>;
}

/** 07 §三 工程清单（project.json）：结构化/原子化多文件工程的组装契约 */
export interface ProjectManifest {
  formatVersion: 1;
  id: string;
  /** 入口列（01 §一.7：story.start 导航至入口列） */
  entry: string;
  /** 工程显示名（可选） */
  name?: string;
  /** 默认语言（01 §四 I18N 三层） */
  lang?: string;
  /** 工程级 defines：无条件 Set，先于故事文件应用（后加载覆盖） */
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
} as const;

/** 02 §二.2 等待状态（`__waiting` 取值全集） */
export type WaitingState =
  "none" | "dialog" | "menu" | "wait" | "minigame" | "input";

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

// —— 05 存档编排（TS 侧）契约：安全（加密/AAD/高水位）在 Rust 层（K7） ——

/** 05 §四 存档载荷 v1（S3：块/列级作用域不进档——读档后按坐标确定性重放重建） */
export interface SaveDataV1 {
  formatVersion: 1;
  storyId: string;
  /** 等待点命令坐标：读档时从该命令重放，重建等待画面 */
  coord: ColumnCoordinate;
  state: [string, unknown][];
  rngState: number;
  functions: [string, { params: string[]; body: StoryCommand[] }][];
  /** 03-R8：检查点序列随档，读档后可继续回溯 */
  cursor: number;
  history: Array<{
    coord: ColumnCoordinate;
    state: [string, unknown][];
    rngState: number;
  }>;
}

/** 05 §五 K5 存档模式：MachineBound 默认（跨机不可解）/ Portable 可选（仅存档） */
export type SaveMode = "machine-bound" | "portable";

/** 槽位摘要（Rust save_list 头部解析，适配器已转驼峰） */
export interface SlotSummary {
  slot: string;
  saveCount: number;
  timestamp: number;
  mode: string;
}

/** 05 §五 存档端口：实现 = infra 适配器（Tauri invoke / 演示兜底） */
export interface SavePort {
  write(slot: string, payload: string, mode: SaveMode): Promise<void>;
  read(slot: string): Promise<string>;
  list(): Promise<SlotSummary[]>;
}
