/** 元素渲染域出口（UI 侧单一入口）。 */
export {
  createElementRegistry,
  type ElementRegistry,
  type ElementRenderer,
  type ElementRenderContext,
} from "./registry";
export {
  createElementResourceResolver,
  type ElementResourceResolver,
  type ElementResourceResolverOptions,
} from "./resource";
export { elementClassName, elementSource, elementStyle } from "./style";
export { registerBuiltinElementRenderers } from "./renderers";
export { renderElementTree, type ElementTreeRenderOptions } from "./render";
export {
  type RenderEvent,
  type RenderEventName,
  type RenderEventPatch,
  type RenderKind,
  type RenderPort,
  type RenderPropValue,
  type RenderSpec,
} from "./spec";
export {
  hasElementInteraction,
  isElementDisabled,
  resolveElementAction,
  type ElementAction,
  type ElementActionOptions,
  type ElementActionSource,
} from "./interaction";
export {
  parseWritebackTarget,
  routeElementValueChange,
  type ElementWritebackPorts,
  type WritebackTarget,
} from "./writeback";
export {
  easingFn,
  easingNames,
  interpolateAnimation,
  shakeOffset,
  transitionOpacity,
} from "./animation";
