/**
 * 宿主公共面出口（唯一出口）：两个参考宿主（Vue 参考宿主、原生 DOM 模板宿主）共用的
 * 「表现层骨架」——帧循环、状态分发、层级下发、帧驱动表现、节律默认值。
 *
 * 这里只放**与平台无关的纯逻辑**：DOM 写入、框架状态、样式表统统留在各宿主自己的目录里。
 * 判据很简单——本目录不得出现 `document` / `window` / 框架 import / 模块级可变状态；
 * 需要碰 DOM 的地方一律以接口形式把动作注入进来。
 */
export {
  DEFAULT_LOAD_TOAST_MS,
  DEFAULT_NOTIFY_MS,
  DEFAULT_ROLLBACK_NOTICE_MS,
  DEFAULT_TEXT_CPS,
  DEFAULT_TOAST_MS,
  DEFAULT_VUE_TOAST_MS,
} from "./duration";
export {
  createVisualEffects,
  resolveAnimatedStyle,
  type AnimatedStyle,
  type AnimationHost,
  type EffectSource,
  type EffectSurfaceHost,
  type VisualEffectsOptions,
} from "./effects";
export {
  createFrameLoop,
  type FrameLoop,
  type FrameLoopOptions,
  type FrameSource,
} from "./frame-loop";
export {
  createLayerView,
  type LayerView,
  type LayerViewOptions,
} from "./layer-view";
export {
  createStateView,
  isDialogueSuppressed,
  isNvlActive,
  isTypingEnabled,
  resolveTypingCps,
  type StateIntent,
  type StateKeyTable,
  type StateViewOptions,
  type TypingSetting,
} from "./state-view";
