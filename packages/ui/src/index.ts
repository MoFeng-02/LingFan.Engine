/**
 * 参考展示层出口：按渲染域归类（dialogue 对话渲染 / audio 音频差量 / video 视频命令流），
 * 框架无关的可测纯逻辑。具体宿主（Vue/React/原生 DOM）只消费这些入口，换框架不影响核心（08-U1）。
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
  DialogueTemplateRegistry,
  type DialogueTemplateFn,
  type DialogueTemplateInput,
  type DialogueTemplateView,
} from "./dialogue/templates";
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
