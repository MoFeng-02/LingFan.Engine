/**
 * 舞台适配的公共类型：视口、设计基准与适配策略。
 *
 * 类型单独成文件，是让策略表与计算实现都只依赖类型，实现文件之间不成环。
 */

/** 视口尺寸（宿主提供的逻辑像素尺寸） */
export interface StageViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * 缩放策略：`min` 短边铺满、`max` 长边铺满、`width` 与 `height` 单轴对齐、
 * `fill` 两轴各自拉满（允许变形）、数字为固定倍率。
 */
export type StageScalePolicy =
  "min" | "max" | "width" | "height" | "fill" | number;

/** 留边方向上的对齐锚点 */
export type StageAlign = "start" | "center" | "end";

/** 内置适配策略名 */
export type StageFit = "contain" | "cover" | "fill" | "none";

/** 舞台配置：设计基准尺寸 + 策略 + 可选缩放夹取 */
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

/** 计算结果：宿主把它套成舞台容器的缩放与定位 */
export interface StageLayout {
  /** 实际生效的缩放策略 */
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
