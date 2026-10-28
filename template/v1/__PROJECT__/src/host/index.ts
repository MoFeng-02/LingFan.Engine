/**
 * 模板宿主出口：组合根与外部只从这里取本宿主的零件，不深入具体文件。
 *
 * 转发的都是本宿主的装配入口与契约类型；具体实现留在各自叶子里，
 * 换一处实现不影响调用方的 import 路径。
 */

export {
  must,
  optional,
  createErrorReporter,
  reportBootFailure,
  type StageDom,
} from "./stage-dom";
export { createHostLayerZ, type HostLayerZOptions } from "./layer-z";
export { fillSaveSlots, wireSaveSlots } from "./save-slots";
export { createToast, type ToastOptions } from "./toast";
export {
  createDialogueView,
  type DialogueEngine,
  type DialogueView,
  type DialogueViewOptions,
} from "./dialogue-view";
export { createHostEffects, type HostEffectsOptions } from "./effects";
export { wireEngine, type HostWiringOptions } from "./engine-wiring";
export { startHostFrameLoop, type HostFrameLoopOptions } from "./frame-loop";
export { wireInput, type HostInputOptions } from "./input-map";
export {
  bootHost,
  type BootPortOverrides,
  type HostBootOptions,
  type HostHandle,
} from "./boot";
export {
  createPreferencesPanel,
  PREF_CHANNELS,
  type PreferencesPanel,
  type PreferencesPanelOptions,
  type PreferencesPanelView,
} from "./panels/preferences";
export {
  createPageRegistry,
  type Page,
  type PageContext,
  type PageFactory,
  type PageRegistry,
  type PageRegistryOptions,
} from "./pages/registry";
export { createPageMounter, type PageMounter } from "./pages/mount";
export {
  createHudPanel,
  type HudPanel,
  type HudPanelOptions,
} from "./pages/hud";
export { createTitlePage, type TitlePageOptions } from "./pages/title-page";
