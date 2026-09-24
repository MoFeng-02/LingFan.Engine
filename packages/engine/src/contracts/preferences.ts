/**
 * 08 §八.2 / U10 玩家偏好契约：独立于存档（不随档变动、不进引擎快照/SSOT），
 * 独立持久化（系统配置语义）。载荷为纯数据（v1 起版本化），信任边界在
 * PlayerPreferences.hydrate（逐字段校验降级），端口只做搬运。
 */
import type { AudioChannel } from "./media";
import type { OrientationMode } from "./shell";

/**
 * 08 §八.2 玩家偏好载荷（四通道音量 + 全局静音 + 文字速度 + 屏幕方向；键位配置随编辑器阶段增补）。
 * `orientation` **可选**：缺省 = 未设置（跟随工程默认），显式写入即覆盖工程默认
 * （含显式选 auto——玩家要求跟随系统优先于作者默认）。
 */
export interface PlayerPrefsData {
  v: 1;
  /** 四通道音量 0..1（键 = AudioChannel；有效音量 = op 音量 × 通道偏好，静音再归零） */
  volumes: Record<AudioChannel, number>;
  /** 全局静音（老引擎 MasterMuted 同语义：有效音量归零而非停播——取消静音即时恢复） */
  muted: boolean;
  /** 打字机速度（字符/秒，≥1；08 §四.1 SetTextSpeed 玩家偏好可覆盖） */
  textSpeed: number;
  /** 屏幕方向偏好（缺省 = 未设置，跟随工程默认；U10 与存档分离） */
  orientation?: OrientationMode;
}

/** 08 §八.2 偏好持久化端口（组合根注入；Tauri = app_data JSON 文件，浏览器 = localStorage 兜底） */
export interface PreferencesPort {
  load(): Promise<PlayerPrefsData | null>;
  save(data: PlayerPrefsData): Promise<void>;
}

/** 默认偏好（老引擎 PreferencesService.EnsureDefaults 同基线：bgm 0.8 / se 0.6 / voice 1 / 文字速度 30） */
export const DEFAULT_PLAYER_PREFS: PlayerPrefsData = {
  v: 1,
  volumes: { bgm: 0.8, se: 0.6, ambient: 0.8, voice: 1 },
  muted: false,
  textSpeed: 30,
};
