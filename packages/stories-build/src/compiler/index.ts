/**
 * 编译器域：把 `Stories.src` 的 TS 源编译成引擎故事对象。
 *
 * 对外只有 `loadDefaultCompiler` 与 `compileStories` 两条——宿主既可以
 * 走默认实现，也可以注入自己的编译器（测试就是这么干的）。外部扩展模块的
 * 装载、cell 声明的扫描也在这域：它们是「读源」的三种不同入口，共用同一套
 * fail-closed 口径。
 */
export {
  loadDefaultCompiler,
  type CompiledStories,
  type CompiledStoryEntry,
  type CompilerConstValues,
  type CompilerDiagnostic,
  type StoriesCompiler,
} from "./compiler-contract";
export {
  loadExtensions,
  readDeclaredExtensions,
  defaultExtensionLoader,
} from "./extension-load";
export { scanCellSources } from "./cell-scan";
