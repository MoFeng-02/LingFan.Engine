/**
 * 平台壳契约：屏幕方向、舞台层级（z 序）与存档壳配置。
 *
 * 这些都不是叙事语义——引擎核心不解释、不参与回溯/存档，只提供契约类型；
 * 由组合根读工程默认与玩家偏好、装配给壳层实现（Android `Activity.requestedOrientation` /
 * iOS `UIWindowScene.requestGeometryUpdate` / 无壳形态 no-op）。
 *
 * 平台边界（官方文档已核）：静态声明（AndroidManifest 的 screenOrientation / Info.plist 的
 * UISupportedInterfaceOrientations）决定「允许集合」的上限，本端口只做运行期覆盖——
 * Android 16 起 sw≥600dp 大屏忽略方向限制（游戏凭 `appCategory="game"` 豁免）；
 * iOS 必须在 plist 内声明过该方向且未开启多任务（iPad）才可能生效。
 */

/** 方向模式：auto = 跟随系统与用户自动旋转；portrait/landscape = 锁定方向 */
export type OrientationMode = "auto" | "portrait" | "landscape";

/**
 * 工程级壳配置（project.json `shell` 段）：作者声明的作品形态。
 * 缺省 = auto（跟随系统）；玩家偏好可覆盖（偏好与存档分离）。
 */
export interface ProjectShellConfig {
  /** 作品默认方向（缺省 = auto） */
  orientation?: OrientationMode;
}

/**
 * 屏幕方向端口：应用是「尽力而为」——平台忽略（Android 16 大屏 / iOS 未声明该方向 /
 * 无壳形态）时不视为错误，由实现返回布尔告知是否已应用；非法模式一律拒绝（fail-closed）。
 */
export interface OrientationPort {
  apply(mode: OrientationMode): Promise<boolean>;
}

/* ============================ 层级（z 序）============================ */

/** 舞台渲染层 id（与渲染目标及舞台 DOM 一一对应） */
export type LayerId =
  | "stage"
  | "video"
  | "dialogue"
  | "choices"
  | "minigame"
  | "notifications"
  | "toolbar"
  | "history"
  | "prefs";

/** 每层一个 z 值（缺键即非法表——`LAYER_IDS` 是键集合的单一事实源） */
export type LayerZTable = Record<LayerId, number>;

/** 工程对部分层的 z 覆盖（未列出的层回内建默认） */
export type LayerZOverrides = Partial<Record<LayerId, number>>;

/** 层 id 全集（顺序即语义基线顺序；与默认 z 表的键集合互为互锁） */
export const LAYER_IDS: readonly LayerId[] = [
  "stage",
  "video",
  "dialogue",
  "choices",
  "minigame",
  "notifications",
  "toolbar",
  "history",
  "prefs",
];

/**
 * 内建默认 z（语义化基线，间隔 100 便于工程插入自定义层）：
 * - `stage`(0)：舞台容器（背景 + 元素）——位于 video(100) 之下，元素间叠放在舞台内独立比较（两级叠放）
 * - `video`(100)：过场视频——盖舞台，**不盖 say**（对话层在 video 等待期让位）
 * - `dialogue`(999)：say/对话层——内容层中最高
 * - `choices`(1100)：menu/input——对话层之上（等待期对话层已让位）
 * - `minigame`(1200)：整屏小游戏
 * - `notifications`(1300)：toast
 * - `toolbar`(1400) / `history`(1500) / `prefs`(1500)：常驻 HUD 与面板
 */
export const DEFAULT_LAYER_Z: LayerZTable = {
  stage: 0,
  video: 100,
  dialogue: 999,
  choices: 1100,
  minigame: 1200,
  notifications: 1300,
  toolbar: 1400,
  history: 1500,
  prefs: 1500,
};

/* ============================ 存档壳配置 ============================ */

/** 存档缩略图配置（由宿主合成截图，引擎只读配置） */
export interface SavesThumbnailConfig {
  /** 缩略图宽（px） */
  width: number;
  /** 缩略图高（px） */
  height: number;
  /** JPEG 质量（0..1） */
  quality: number;
  /** 是否在缩略图上绘制文本（说话人/正文/时间戳） */
  showText: boolean;
}

/** 存档壳配置（槽位数与缩略图口径；解析见 `runtime/shell.ts`） */
export interface SavesConfig {
  /** 存档槽位数（slot_1..slot_N） */
  slots: number;
  thumbnail: SavesThumbnailConfig;
}

/** 内建默认存档壳配置（工程未声明或声明非法时使用） */
export const DEFAULT_SAVES_CONFIG: SavesConfig = {
  slots: 6,
  thumbnail: { width: 320, height: 180, quality: 0.7, showText: true },
};

/* ============================ 舞台适配配置 ============================ */

/**
 * 缩放策略：`min` 短边铺满、`max` 长边铺满、`width` 与 `height` 单轴对齐、
 * `fill` 两轴各自拉满（允许变形）、数字为固定倍率。
 */
export type StageScalePolicy =
  "min" | "max" | "width" | "height" | "fill" | number;

/** 留边方向上的对齐锚点 */
export type StageAlign = "start" | "center" | "end";

/** 内置适配策略名（展开成缩放策略 + 对齐锚点，见 `@lingfan-engine/shell` 的预设表） */
export type StageFit = "contain" | "cover" | "fill" | "none";

/**
 * 舞台适配配置（`project.json` 的 `shell.stage`；解析见 `runtime/shell.ts`）。
 *
 * 作者按设计基准像素书写元素与控件坐标，宿主把整场等比缩放套进窗口——**只影响宿主表现**，
 * 不进引擎状态、快照与存档（与方向偏好同属壳配置口径）。计算件在 `@lingfan-engine/shell`，
 * 契约与解析在引擎：宿主一律取解析结果，不各自读清单、不各自定缺省。
 */
export interface StageConfig {
  /** 设计基准宽（作者坐标系的宽） */
  readonly width: number;
  /** 设计基准高（作者坐标系的高） */
  readonly height: number;
  /** 预设策略，缺省 `contain` */
  readonly fit?: StageFit;
  /** 显式缩放策略，给了就覆盖预设 */
  readonly scaleBy?: StageScalePolicy;
  /** 横向留边对齐，缺省跟随预设 */
  readonly alignX?: StageAlign;
  /** 纵向留边对齐，缺省跟随预设 */
  readonly alignY?: StageAlign;
  /** 缩放下限（极小屏可读性兜底） */
  readonly minScale?: number;
  /** 缩放上限（大屏封顶） */
  readonly maxScale?: number;
}

/** 内建默认舞台配置（工程未声明或声明非法时使用）：横屏 16:9，与视频、缩略图同比例 */
export const DEFAULT_STAGE_CONFIG: StageConfig = {
  width: 1280,
  height: 720,
  fit: "contain",
};
