/**
 * 玩家偏好契约：独立于存档（不随档变动、不进引擎快照/SSOT），
 * 独立持久化（系统配置语义）。载荷为纯数据（v1 起版本化），信任边界在
 * PlayerPreferences.hydrate（逐字段校验降级），端口只做搬运。
 */
import type { ElementFit } from "./element.ts";
import type { AudioChannel } from "./media/index.ts";
import type { OrientationMode } from "./shell.ts";

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
  /** 回溯键覆盖（滚轮是既有触发，键位为可选补充；tap 单次） */
  rollback?: string[];
  /** 快速存档键覆盖（组合键如 "ctrl+s"；tap 单次） */
  quickSave?: string[];
  /** 快速读档键覆盖（组合键如 "ctrl+l"；tap 单次） */
  quickLoad?: string[];
  /** 快进键覆盖（hold 按住持续；可绑修饰键本身如 "Control"） */
  skip?: string[];
  /** 隐藏 HUD 键覆盖（tap 单次切换） */
  hideUI?: string[];
}

/**
 * 字速归属声明：作者的 `text_typewriter` 命令与玩家滑杆谁说了算。
 *
 * 三态刻意区分「缺省」与「显式」：缺省（字段缺席）保持既有行为——玩家偏好覆盖
 * 故事设置，兼容已发布的偏好文件；显式 "story" 把字速锁在作者声明上，玩家滑杆
 * 仍会记住偏好值但不作用于当前故事；显式 "player" 与缺省同效，但意图已写明。
 * 信任边界（hydrate）对非法取值**忽略该键**而不是补默认——缺省≠显式。
 */
export type TextSpeedSource = "story" | "player";

/**
 * 玩家偏好的持久化快照：音量、静音、打字机速度、屏幕方向、键位、全屏，
 * 以及音频主音量、文本节奏、显示外观、元素填充默认槽、窗口尺寸与语言等机器级设置。
 *
 * 与存档**分离**——偏好是「玩的人怎么用这台机器」，跨存档共享；
 * 因此它不进存档文件，由 `PreferencesPort` 单独落盘，缺失字段按各自注释的缺省处理。
 * 可选字段一律「缺省 ≠ 显式」：缺席表示跟随（系统/作者/内建），显式写入才是覆盖。
 */
export interface PlayerPrefsData {
  v: 1;
  /** 四通道音量 0..1（键 = AudioChannel；有效音量 = op 音量 × 通道偏好，静音再归零） */
  volumes: Record<AudioChannel, number>;
  /** 全局静音（有效音量归零而非停播——取消静音即时恢复） */
  muted: boolean;
  /** 打字机速度（字符/秒，≥1；SetTextSpeed 玩家偏好可覆盖） */
  textSpeed: number;
  /**
   * 字速归属（可选，见 {@link TextSpeedSource}）：缺省 = 玩家偏好覆盖故事设置
   * （既有行为）；"story" = 锁作者声明；"player" = 玩家偏好赢。
   */
  textSpeedSource?: TextSpeedSource;
  /** 屏幕方向偏好（缺省 = 未设置，跟随工程默认；与存档分离） */
  orientation?: OrientationMode;
  /** 键位覆盖（缺省动作 = 内建默认键位） */
  keymap?: PlayerKeymap;
  /** 全屏偏好（缺省 = 未设置 = 窗口化；宿主尽力而为应用） */
  fullscreen?: boolean;

  /** 主音量（0..1，缺省 = 1）：有效音量 = op 音量 × 通道偏好 × 主音量，静音再归零 */
  masterVolume?: number;

  /** 即时文本（缺省 = false）：true 时整句直出、跳过打字机；不改变故事的跳过权限 */
  instantText?: boolean;
  /** 自动播放每句停留时长（毫秒，缺省 = 1500；消费归自动播放功能） */
  autoDelayMs?: number;
  /** 自动播放开关（缺省 = false；消费归自动播放功能） */
  autoEnabled?: boolean;
  /** 快进每句停留时长（毫秒，缺省 = 50；消费归快进功能） */
  skipDelayMs?: number;
  /** 仅快进已读文本（缺省 = false；消费归快进功能，已读追踪属故事状态而非偏好） */
  skipUnseenOnly?: boolean;
  /** 打字音效开关（缺省 = false）：核心只发打字事件、音效资源归宿主；无资源时开关禁用 */
  typeSound?: boolean;

  /** 转场速度倍率（0.1..10，缺省 = 1）：乘在故事声明的转场时长上，相对节奏保留 */
  transitionSpeed?: number;
  /** 抖动强度倍率（0..1，缺省 = 1）：0 = 关闭抖动（无障碍诉求） */
  shakeScale?: number;
  /**
   * 减弱动效（可选，三态）：缺省 = 跟随系统「减弱动态效果」；显式 true/false 覆盖系统。
   * 生效时转场瞬时完成、抖动归零、元素动画直达终值（故事终值不变）。
   */
  reducedMotion?: boolean;
  /** 故事文本字号倍率（0.5..3，缺省 = 1）：只缩放显示，不改舞台逻辑尺寸 */
  fontScale?: number;
  /** 对话框不透明度（0..1，缺省 = 跟随作者样式；显式写入即覆盖） */
  dialogueOpacity?: number;
  /** 对话框位置（缺省 = 跟随作者样式；闭合词表，见 {@link DialoguePosition}） */
  dialoguePosition?: DialoguePosition;
  /** 对话框高度倍率（0.5..2，缺省 = 跟随作者样式） */
  dialogueHeightScale?: number;
  /**
   * 默认字体（缺省 = 跟随工程默认字体）：只填「作者没指定」的默认槽——
   * 逐句 `say.font` / 角色字体显式声明优先于它（作者演出意图）。
   * 字体是否可用由宿主装配期按字体注册表校验，非法值不静默套用。
   */
  fontFamily?: string;
  /** NVL 每页行数（正整数 1..200，缺省 = 不分页全量滚动）：只分页显示，绝不截断故事缓冲 */
  nvlPageSize?: number;
  /**
   * 元素填充默认槽（可选，三态）：缺省 = 内建 cover。
   * 优先级 **op 显式 stretch > 玩家默认槽 > 内建 cover**——与屏幕方向「玩家赢」有意不同：
   * 填充承载玩法语义（立绘不能被裁），作者显式声明必须赢，玩家只填作者没指定的缺省。
   */
  elementFit?: ElementFit;
  /** 窗口尺寸（缺省 = 跟随壳初始尺寸）：仅桌面壳尽力而为应用，浏览器静默忽略 */
  windowSize?: WindowSize;

  /**
   * 语言偏好（可选，三态）：缺省 = 不干预。仅作**新会话启动种子**——
   * 读档时存档里的语言赢（语言是故事事实）；会话中切换语言会记住到本字段（机器级）。
   */
  language?: string;
}

/** 窗口尺寸（整数像素；宽 320..16384、高 200..16384，非法整体丢弃不部分采纳） */
export interface WindowSize {
  width: number;
  height: number;
}

/** 对话框位置闭合词表（底部 / 顶部 / 居中；宿主映射到布局，非法值回退作者样式） */
export const DIALOGUE_POSITIONS = ["bottom", "top", "center"] as const;
/** 对话框位置合法取值（从 `DIALOGUE_POSITIONS` 派生） */
export type DialoguePosition = (typeof DIALOGUE_POSITIONS)[number];

/** 数值偏好的值域（sanitize 与 setter 共用，单一事实源；越界钳制、非有限数丢弃） */
export const TRANSITION_SPEED_RANGE = { min: 0.1, max: 10 } as const;
export const FONT_SCALE_RANGE = { min: 0.5, max: 3 } as const;
export const DIALOGUE_HEIGHT_SCALE_RANGE = { min: 0.5, max: 2 } as const;
export const NVL_PAGE_SIZE_RANGE = { min: 1, max: 200 } as const;
export const AUTO_DELAY_MS_RANGE = { min: 0, max: 60000 } as const;
export const SKIP_DELAY_MS_RANGE = { min: 0, max: 5000 } as const;
export const WINDOW_WIDTH_RANGE = { min: 320, max: 16384 } as const;
export const WINDOW_HEIGHT_RANGE = { min: 200, max: 16384 } as const;
/** 语言标签长度上限（BCP-47 风格字符串，如 zh-CN / en） */
export const LANGUAGE_MAX = 32;
/** 默认字体名长度上限 */
export const FONT_FAMILY_MAX = 64;

/**
 * 内建默认键位（键位覆盖缺席时生效；与既有宿主行为一致：Space/Enter=推进、H=历史、
 * Ctrl+S/L 与 Cmd+S/L=快速存读档、按住 Ctrl=快进）。回溯走滚轮、隐藏 HUD 无内建键（改绑面板可配）。
 * 组合键 `[mod+]<key>` 大小写不敏感；修饰键本身可作键（skip 绑 Control 按住持续）。
 */
export const DEFAULT_KEYMAP: Required<PlayerKeymap> = {
  advance: [" ", "Enter"],
  history: ["h"],
  rollback: [],
  quickSave: ["ctrl+s", "meta+s"],
  quickLoad: ["ctrl+l", "meta+l"],
  skip: ["Control"],
  hideUI: [],
};

/** 键位动作全集（键位覆盖的合法键） */
export const KEYMAP_ACTIONS = [
  "advance",
  "history",
  "rollback",
  "quickSave",
  "quickLoad",
  "skip",
  "hideUI",
] as const;
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
