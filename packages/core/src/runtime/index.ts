/**
 * 运行层域出口：执行器与它的协作模块（宿主解析 / 文本国际化 / 玩家偏好 / 壳配置解析 /
 * 写入契约守卫 / op 注册表 / 等待声明表 / 扩展装载 / 表达式求值 / 状态读口）。
 *
 * 这是包出口（`src/index.ts`）取运行层符号的唯一入口——包出口不再逐个深入实现文件；
 * 运行层内部各模块之间仍按需直接引用（`./resolver` 属内部零件，不经此出口；
 * `./scope` 供 `tests/engine/runtime/scope.test.ts` 的白盒用例经域出口取用）。
 */
export { StoryEngine } from "./engine.ts";
export type { EngineOptions, GuardContext, GuardFn } from "./engine.ts";
export { columnSummaries } from "./columns.ts";
export { isValidSayColor } from "./ops/index.ts";
export { resolveHost } from "./host.ts";
export { mergeOverlayFiles } from "./i18n/index.ts";
export { PlayerPreferences } from "./preferences.ts";
export { createStateReader } from "./state/index.ts";
export { Scope } from "./scope.ts";
export {
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  DEFAULT_STAGE_CONFIG,
  INSTANCE_Z_KEYS,
  instanceZLayer,
  LAYER_IDS,
  manifestOrientation,
  resolveAudioConfig,
  resolveInstanceZ,
  resolveLayerZ,
  resolveOrientationMode,
  resolveProjectName,
  resolveSavesConfig,
  resolveStageConfig,
  slotIds,
} from "./shell.ts";
export type {
  AudioConfig,
  LayerId,
  LayerZOverrides,
  LayerZTable,
  SavesConfig,
  SavesThumbnailConfig,
  StageAlign,
  StageConfig,
  StageFit,
  StageScalePolicy,
} from "./shell.ts";
export { findJsonValueError, jsonUnsafeReason } from "./stateContract.ts";
export { collectGuardNames, findMissingGuards } from "./guardNames.ts";
export {
  BUILTIN_OP_NAMES,
  buildOpRegistry,
  collectTextProjections,
} from "./opRegistry.ts";
export {
  collectWaitSpecs,
  waitSpecOfOp,
  WAITING_OPS,
  waitingStateOfOp,
  type WaitSpec,
} from "./waitingOps.ts";
export {
  loadDeclaredExtensions,
  type ExtensionModuleLoader,
} from "./extensionLoader.ts";
export {
  evaluateExpression,
  ExpressionError,
  interpolateText,
  type NameResolver,
} from "./expr/index.ts";
export { directionOf } from "./paramDirection.ts";
