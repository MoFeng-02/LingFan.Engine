/**
 * 参考展示层出口：按渲染域归类（dialogue 对话渲染 / audio 音频差量 / video 视频命令流），
 * 框架无关的可测纯逻辑。具体宿主（Vue/React/原生 DOM）只消费这些入口，换框架不影响核心。
 */
export {
  renderInlineMarkup,
  Typewriter,
  renderDialogueLine,
  type DialogueLineInput,
  type DialogueLineView,
} from "./dialogue";
export {
  builtinBubbleTemplate,
  createDialogueTemplateRegistry,
  type DialogueTemplateFn,
  type DialogueTemplateInput,
  type DialogueTemplateRegistry,
  type DialogueTemplateView,
} from "./dialogue";
export {
  TemplateRegistry,
  createTemplateRegistry,
  type TemplateFn,
  type TemplateViewBase,
} from "./templates";
export {
  builtinChoiceTemplate,
  createChoiceTemplateRegistry,
  type ChoiceTemplateFn,
  type ChoiceTemplateInput,
  type ChoiceTemplateOption,
  type ChoiceTemplateRegistry,
  type ChoiceTemplateView,
} from "./choices";
export {
  builtinNotifyTemplate,
  createNotifyTemplateRegistry,
  toNotifyTone,
  type NotifyTemplateFn,
  type NotifyTemplateInput,
  type NotifyTemplateRegistry,
  type NotifyTemplateView,
  type NotifyTone,
} from "./notify";
export {
  EMPTY_AUDIO_VIEW,
  createAudioRenderer,
  planAudioActions,
  readAudioView,
  type AudioAction,
  type AudioRenderer,
  type AudioRendererOptions,
  type AudioView,
} from "./audio";
export {
  createVideoRenderer,
  type VideoRenderer,
  type VideoRendererOptions,
} from "./video";
export { createMinigameRegistry, type MinigameRegistry } from "./minigame";
export {
  createElementRegistry,
  createElementResourceResolver,
  easingFn,
  easingNames,
  elementClassName,
  elementSource,
  elementStyle,
  hasElementInteraction,
  interpolateAnimation,
  isElementDisabled,
  registerBuiltinElementRenderers,
  renderElementTree,
  resolveElementAction,
  shakeOffset,
  transitionOpacity,
  type ElementAction,
  type ElementActionOptions,
  type ElementRegistry,
  type ElementRenderer,
  type ElementRenderContext,
  type ElementResourceResolver,
  type ElementTreeRenderOptions,
} from "./element";
export {
  createCommandRegistry,
  type CommandRegistry,
  type NamedCommandHandler,
} from "./commands";
export {
  GAME_INPUT_BLOCKED_SELECTOR,
  INPUT_SCOPES,
  createInputScopeState,
  isGameInputTarget,
  isInputScope,
  routesToNarrative,
  type ClosestLike,
  type InputScope,
  type InputScopeState,
} from "./input";
export {
  createNarrativeOverlay,
  type NarrativeMounts,
  type NarrativeOverlay,
  type NarrativeOverlayOptions,
  type NarrativeOverlayView,
} from "./overlay";
