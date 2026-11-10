/**
 * 舞台适配的公共类型：视口、设计基准、适配策略、布局结果与样式写入面。
 *
 * 全部声明在引擎并在此按原路径转出——`StageConfig` 来自 `project.json shell.stage`
 * 这个工程事实，`StageViewport` / `StageLayout` 是作者坐标到屏幕坐标的事实源，
 * 两者都与 `shell.saves` 同属契约层，宿主与各写面一律取同一声明。
 * 消费方无需改 import：类型单独成文件，是让策略表与计算实现都只依赖类型，
 * 实现文件之间不成环。
 */

export type {
  StageAlign,
  StageConfig,
  StageFit,
  StageLayout,
  StageScalePolicy,
  StageStyleTarget,
  StageViewport,
} from "@lingfan-engine/core";
