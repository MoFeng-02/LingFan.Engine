/**
 * 运行层域出口：执行器与它的协作模块（宿主解析 / 文本国际化 / 玩家偏好 / 壳配置解析 /
 * 写入契约守卫 / op 注册表 / 等待声明表 / 扩展装载 / 表达式求值 / 状态读口）。
 *
 * 这是包出口（`src/index.ts`）取运行层符号的唯一入口——包出口不再逐个深入实现文件；
 * 运行层内部各模块之间仍按需直接引用（`./resolver` 属内部零件，不经此出口；
 * `./scope` 供 `tests/engine/runtime/scope.test.ts` 的白盒用例经域出口取用）。
 */
export { StoryEngine } from "./engine";
export type { EngineOptions, GuardContext, GuardFn } from "./engine";
export { isValidSayColor } from "./ops";
export { resolveHost } from "./host";
export { mergeOverlayFiles } from "./i18n";
export { PlayerPreferences } from "./preferences";
export { createStateReader } from "./state";
export { Scope } from "./scope";
export {
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  INSTANCE_Z_KEYS,
  instanceZLayer,
  LAYER_IDS,
  manifestOrientation,
  resolveInstanceZ,
  resolveLayerZ,
  resolveOrientationMode,
  resolveSavesConfig,
  slotIds,
} from "./shell";
export type {
  LayerId,
  LayerZOverrides,
  LayerZTable,
  SavesConfig,
  SavesThumbnailConfig,
} from "./shell";
export { findJsonValueError, jsonUnsafeReason } from "./stateContract";
export {
  BUILTIN_OP_NAMES,
  buildOpRegistry,
  collectTextProjections,
} from "./opRegistry";
export { waitSpecOfOp, WAITING_OPS, waitingStateOfOp } from "./waitingOps";
export {
  loadDeclaredExtensions,
  type ExtensionModuleLoader,
} from "./extensionLoader";
export {
  evaluateExpression,
  ExpressionError,
  interpolateText,
  type NameResolver,
} from "./expr";
