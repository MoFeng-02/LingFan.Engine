/** 舞台适配域：纯计算，视口尺寸由宿主提供。 */

export { computeStageLayout, stageTransform } from "./layout.ts";
export {
  createStageFitter,
  type StageFitter,
  type StageFitterOptions,
} from "./fitter.ts";
export { createStagePort, type StageCssPortOptions } from "./css.ts";
export {
  DEFAULT_STAGE_FIT,
  DEFAULT_STAGE_HEIGHT,
  DEFAULT_STAGE_WIDTH,
  resolveStagePreset,
  STAGE_BASELINES,
  STAGE_PRESETS,
  type StageBaseline,
  type StagePreset,
} from "./presets.ts";
export type {
  StageAlign,
  StageConfig,
  StageFit,
  StageLayout,
  StageScalePolicy,
  StageStyleTarget,
  StageViewport,
} from "./types.ts";
