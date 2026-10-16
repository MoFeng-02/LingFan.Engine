/**
 * 舞台适配的预设表：基准尺寸与内置策略。
 *
 * 内置策略不是独立实现，而是「缩放策略 + 对齐锚点」的命名组合：`contain` 短边铺满 +
 * 居中，`cover` 长边铺满 + 居中，`fill` 两轴各自拉满，`none` 固定 1 倍。作者需要特殊
 * 行为时直接写 `scaleBy`/`alignX`/`alignY`，与预设走同一条计算路径，所以预设与自定义
 * 之间不存在两套代码。
 */
import { DEFAULT_STAGE_CONFIG } from "@lingfan/engine";
import {
  type StageAlign,
  type StageFit,
  type StageScalePolicy,
} from "./types.ts";

/** 基准尺寸预设：编辑器与宿主的下拉项，作者另填任意尺寸同样可用 */
export interface StageBaseline {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

/** 内置策略展开后的参数 */
export interface StagePreset {
  readonly fit: StageFit;
  readonly label: string;
  readonly scaleBy: StageScalePolicy;
  readonly alignX: StageAlign;
  readonly alignY: StageAlign;
}

/**
 * 缺省基准宽：取自引擎内建舞台配置（横屏 16:9，与视频、存档缩略图同比例）。
 * 基准的**唯一事实源**在契约层；这里只把它摆成预设下拉要用的名字，避免两处各写一个 1280。
 */
export const DEFAULT_STAGE_WIDTH = DEFAULT_STAGE_CONFIG.width;
/** 缺省基准高 */
export const DEFAULT_STAGE_HEIGHT = DEFAULT_STAGE_CONFIG.height;

/** 基准尺寸预设（横竖屏各两档，覆盖常见发布形态） */
export const STAGE_BASELINES: readonly StageBaseline[] = [
  {
    id: "landscape-1280x720",
    label: "横屏 1280 × 720",
    width: 1280,
    height: 720,
  },
  {
    id: "landscape-1920x1080",
    label: "横屏 1920 × 1080",
    width: 1920,
    height: 1080,
  },
  {
    id: "portrait-750x1334",
    label: "竖屏 750 × 1334",
    width: 750,
    height: 1334,
  },
  {
    id: "portrait-1080x1920",
    label: "竖屏 1080 × 1920",
    width: 1080,
    height: 1920,
  },
];

/** 缺省策略（同样取契约层的内建值；工程未声明 `fit` 时落到这里） */
export const DEFAULT_STAGE_FIT: StageFit =
  DEFAULT_STAGE_CONFIG.fit ?? "contain";

/** 内置策略表 */
export const STAGE_PRESETS: Readonly<Record<StageFit, StagePreset>> = {
  contain: {
    fit: "contain",
    label: "完整显示（留边）",
    scaleBy: "min",
    alignX: "center",
    alignY: "center",
  },
  cover: {
    fit: "cover",
    label: "铺满裁切",
    scaleBy: "max",
    alignX: "center",
    alignY: "center",
  },
  fill: {
    fit: "fill",
    label: "拉伸铺满",
    scaleBy: "fill",
    alignX: "center",
    alignY: "center",
  },
  none: {
    fit: "none",
    label: "原始尺寸",
    scaleBy: 1,
    alignX: "center",
    alignY: "center",
  },
};

/** 取内置策略：名字不在表内时回退缺省（配置来自外部，运行期不假定合法） */
export function resolveStagePreset(fit: StageFit | undefined): StagePreset {
  const fallback = STAGE_PRESETS[DEFAULT_STAGE_FIT];
  if (fit === undefined) return fallback;
  return STAGE_PRESETS[fit] ?? fallback;
}
