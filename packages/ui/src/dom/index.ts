/** DOM 物化域出口：`RenderSpec` → Web 节点（ui 内唯一允许碰 DOM 的目录，见本目录文件头规则）。 */
export { createDomRenderPort, materialize } from "./materialize";
export {
  createDomOverlaySurface,
  type DomOverlaySurface,
  type NarrativeMounts,
} from "./overlay-surface";
export {
  applyDialogueAppearance,
  DIALOGUE_FONT_SCALE_VAR,
  DIALOGUE_HEIGHT_SCALE_VAR,
  DIALOGUE_OPACITY_VAR,
  DIALOGUE_POSITION_ATTR,
} from "./dialogue-appearance";
export {
  createReducedMotionQuery,
  type ReducedMotionQuery,
} from "./reduced-motion";
