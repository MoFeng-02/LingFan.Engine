/**
 * 玩家偏好契约：独立于存档（不随档变动、不进引擎快照/SSOT），
 * 独立持久化（系统配置语义）。载荷为纯数据（v1 起版本化），信任边界在
 * PlayerPreferences.hydrate（逐字段校验降级），端口只做搬运。
 */
import type { AudioChannel } from "./media";
import type { OrientationMode } from "./shell";

/**
 * 玩家偏好载荷（四通道音量 + 全局静音 + 文字速度 + 屏幕方向 + 键位覆盖 + 全屏；契约只增，可选字段向后兼容）。
 * `orientation` **可选**：缺省 = 未设置（跟随工程默认），显式写入即覆盖工程默认
 * （含显式选 auto——玩家要求跟随系统优先于作者默认）。
 * `keymap` **可选**：键位覆盖（缺省动作 = 内建默认键位 DEFAULT_KEYMAP）。
 * `fullscreen` **可选**：全屏偏好（缺省 = 窗口化）；应用归宿主（尽力而为，缺手势静默失败）。
 */
export interface PlayerKeymap {
  /** 推进键覆盖（KeyboardEvent.key 字面量；比较大小写不敏感） */
  advance?: string[];
  /** 历史面板键覆盖 */
  history?: string[];
}

/**
 * 玩家偏好的持久化快照：音量、静音、打字机速度、屏幕方向、键位与全屏。
 *
 * 与存档**分离**——偏好是「玩的人怎么用这台机器」，跨存档共享；
 * 因此它不进存档文件，由 `PreferencesPort` 单独落盘，缺失字段按各自注释的缺省处理。
 */
export interface PlayerPrefsData {
  v: 1;
  /** 四通道音量 0..1（键 = AudioChannel；有效音量 = op 音量 × 通道偏好，静音再归零） */
  volumes: Record<AudioChannel, number>;
  /** 全局静音（有效音量归零而非停播——取消静音即时恢复） */
  muted: boolean;
  /** 打字机速度（字符/秒，≥1；SetTextSpeed 玩家偏好可覆盖） */
  textSpeed: number;
  /** 屏幕方向偏好（缺省 = 未设置，跟随工程默认；与存档分离） */
  orientation?: OrientationMode;
  /** 键位覆盖（缺省动作 = 内建默认键位） */
  keymap?: PlayerKeymap;
  /** 全屏偏好（缺省 = 未设置 = 窗口化；宿主尽力而为应用） */
  fullscreen?: boolean;
}

/** 内建默认键位（键位覆盖缺席时生效；与既有宿主行为一致：Space/Enter=推进、H=历史） */
export const DEFAULT_KEYMAP: Required<PlayerKeymap> = {
  advance: [" ", "Enter"],
  history: ["h"],
};

/** 键位动作全集（键位覆盖的合法键） */
export const KEYMAP_ACTIONS = ["advance", "history"] as const;
/** 键位动作的合法取值（从 `KEYMAP_ACTIONS` 派生，两者不会脱节） */
export type KeymapAction = (typeof KEYMAP_ACTIONS)[number];

/** 偏好持久化端口（组合根注入；Tauri = app_data JSON 文件，浏览器 = localStorage 兜底） */
export interface PreferencesPort {
  load(): Promise<PlayerPrefsData | null>;
  save(data: PlayerPrefsData): Promise<void>;
}

/** 默认偏好（基线：bgm 0.8 / se 0.6 / voice 1 / 文字速度 30） */
export const DEFAULT_PLAYER_PREFS: PlayerPrefsData = {
  v: 1,
  volumes: { bgm: 0.8, se: 0.6, ambient: 0.8, voice: 1 },
  muted: false,
  textSpeed: 30,
};
