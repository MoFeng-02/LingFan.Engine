/**
 * 流水线域：把各域串成一次构建，并做写盘前的门禁。
 *
 * `orchestrate` 是整条链的主入口（也是包出口导出 `buildStories` 的来源），
 * `gates` 是它在写盘前调用的最后一道校验——两者同处一层，依赖方向单向朝下。
 */
export {
  buildStories,
  DEFAULT_GENERATED_DIR,
  DEFAULT_RESOURCES_DIR,
  DEFAULT_SOURCES_DIR,
  type StoryBuildOptions,
} from "./orchestrate";
export { assertKnownGuards, assertKnownOps, type GateOptions } from "./gates";
