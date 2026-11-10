/**
 * 平台壳契约：屏幕方向、舞台层级（z 序）、存档壳配置与舞台适配。
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
import type { AudioChannel } from "./media/entities.ts";

/** 方向模式：auto = 跟随系统与用户自动旋转；portrait/landscape = 锁定方向 */
export type OrientationMode = "auto" | "portrait" | "landscape";

/**
 * 工程级音频配置（`project.json` 的 `shell.audio`；解析见 `runtime/shell.ts`）。
 *
 * **音量的第二级**：命令没写 `volume=` 时取这里，再没有才是内建 1。
 * 玩家偏好不在这里——偏好是最外层的乘算（`op 音量 × 通道偏好`），
 * 顺序不能反：工程默认是作者写的、偏好是玩家设的，把作者默认塞进偏好层
 * 会让「换个工程，玩家设置被这个工程的默认值改掉」。
 *
 * 解析结果是**完整表**（四个通道各一个数），缺声明的通道回 1。
 */
export interface AudioConfig {
  /** 各通道的工程默认音量（0..1） */
  readonly volumes: Readonly<Record<AudioChannel, number>>;
}

/** 内建默认音频配置：四个通道都是 1（与「未声明 = 满音量」的既有行为一致） */
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  volumes: { bgm: 1, se: 1, ambient: 1, voice: 1 },
};

/**
 * 工程级壳配置（project.json `shell` 段）：作者声明的作品形态。
 * 缺省 = auto（跟随系统）；玩家偏好可覆盖（偏好与存档分离）。
 */
export interface ProjectShellConfig {
  /** 作品默认方向（缺省 = auto） */
  orientation?: OrientationMode;
  /** 作者声明的通道默认音量（缺省 = 四通道皆 1） */
  audio?: {
    /** 通道 → 0..1；未列出的通道回内建 1 */
    volumes?: Partial<Record<AudioChannel, number>>;
  };
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

/** 视口尺寸（宿主提供的逻辑像素尺寸；来源由宿主决定，契约只认这两个数） */
export interface StageViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * 适配结果：把整场从作者坐标换算到屏幕坐标的**唯一事实源**。
 *
 * 宿主拿到它只做一件事——原样套到舞台容器上；缩放与偏移都是算好的数值，
 * 宿主不自乘、不自加、不按自己的窗口比例再推一遍，否则同一场在不同壳上会算出
 * 不同的坐标系。变换串（`transform` 文本）由便捷序列化器从这些数派生，派生规则
 * 也只有一处，所以「先平移再缩放」的顺序不会在某个宿主里被写反。
 */
export interface StageLayout {
  /** 实际生效的缩放策略（配置显式值优先，缺省取预设展开的结果） */
  readonly policy: StageScalePolicy;
  readonly scaleX: number;
  readonly scaleY: number;
  /** 设计基准宽高（作者坐标系） */
  readonly width: number;
  readonly height: number;
  /** 缩放后的实际占位尺寸 */
  readonly scaledWidth: number;
  readonly scaledHeight: number;
  /** 舞台内容左上角相对视口左上角的偏移（逻辑像素） */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * 舞台适配的平台动作：宿主只提供这两件事，编排归引擎。
 *
 * 只放两个动作是刻意的——读一次视口、落一次布局，两端之间没有任何平台概念透出，
 * 于是浏览器、小程序与未来的绘制后端能共用同一份编排：计算、等值跳过、退化保护
 * 都在引擎侧，宿主换壳只换这两个动作的实现。这里不放订阅（`resize` 之类）：
 * 注册与注销的时机、成对关系、生命周期在各平台语义不同，订阅归宿主，
 * 编排件只暴露一次性的 `refresh()`。
 */
export interface StagePort {
  /** 读当前可用视口（CSS px）。宿主自行决定来源：窗口、容器、系统信息 */
  measure(): StageViewport;
  /**
   * 应用一次布局。平台各自解释：CSS 宿主写 `transform`；小程序写页面数据；
   * 绘制后端用于矩阵。允许幂等重复调用；不允许在这里再做一次计算。
   */
  apply(layout: StageLayout): void;
}

/**
 * 舞台容器的样式写入面：宿主传真实元素即可结构化满足，纯层不得出现 DOM 类型。
 *
 * 只声明舞台要用到的四个属性，是让「写样式」这件事在平台之外也能描述——
 * 宿主侧传进来的是真实元素，引擎侧看到的是一个只读结构，两边共用同一份签名。
 */
export interface StageStyleTarget {
  readonly style: {
    width: string;
    height: string;
    transformOrigin: string;
    transform: string;
  };
}
