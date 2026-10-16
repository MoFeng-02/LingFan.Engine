/**
 * 舞台适配的公共类型：视口、设计基准与适配策略。
 *
 * 配置契约（`StageConfig` 与三个策略别名）**声明在引擎**（`project.json shell.stage` 是工程
 * 事实，与 `shell.saves` 同属契约层，解析也在引擎），此处按原路径转出，消费方无需改 import。
 * 本域只留「算出来的东西」：视口与布局结果。类型单独成文件，是让策略表与计算实现都只依赖
 * 类型，实现文件之间不成环。
 */

import type { StageScalePolicy } from "@lingfan/engine";

export type {
  StageAlign,
  StageConfig,
  StageFit,
  StageScalePolicy,
} from "@lingfan/engine";

/** 视口尺寸（宿主提供的逻辑像素尺寸） */
export interface StageViewport {
  readonly width: number;
  readonly height: number;
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
