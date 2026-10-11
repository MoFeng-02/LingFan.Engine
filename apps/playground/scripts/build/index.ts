/**
 * TS 故事源编译流水线出口（唯一出口）：把 `Stories.src/` 多目录原生 TS 语句源编译成
 * `Resources/Stories/**` + `project.json`，并维护 cell 生成物。
 *
 * 布局声明 `Stories.src/config.ts`（根级唯一根文件）：`{ folders, start }`——folders
 * 声明源目录（可含 `"*"` 全量兜底），start 声明入口故事文件名（跨目录全局恰一）。
 * 源发现按「default 导出存在」区分故事/模块文件；产物路径 = 源文件路径
 * （`Stories/<相对源路径>.story`，文件名与列 id 解耦）。`config.start` 经托管键
 * 更新落到 `project.json` 的 `entry`（`serializeProject` 既有语义）。
 *
 * 零第二套规则：TS 源合法 ⇔ 其编译产物作为 JSON 合法（与 JSON 同一 `parseStory`）。
 * 工程清单（entry/defines/shell）不归 TS 源管——必须先有 `Resources/project.json`，
 * 编译只更新其托管键。`Stories/**` 列集由源全量管理：启用 TS 源的工程，手写列文件
 * 会被当作陈旧产物清理（报告逐条列出）。构建在清单写入非托管标记键 `tsSource`，
 * 编辑器据此对 TS 源工程的 JSON 产物只读（`packages/editor` 的 `tsSourceGuard`）。
 *
 * 编译器对接：`compileStories` 契约（`./compiler-contract`）——默认装载
 * `./story-compiler`，`StoryBuildOptions.compiler` 可注入（过渡期/测试）。
 *
 * 扩展 op 放行（对齐运行期声明制）：清单 `extensions` 声明扩展模块说明符——编译期
 * 用与运行期同一个装载契约（`loadDeclaredExtensions`）装载，收集其提供的 op 名；
 * 故事里既非内建、也未被声明扩展提供的 op 名 = 运行期必 unknown-op ⇒ 构建期即拦截
 * （fail-early，带列与命令指针定位，一次报全部）。声明缺席/为空 = 零装载零副作用。
 *
 * 测试直接调 `buildStories`（纯编排，fs 全在参数 root 之下）；CLI 主守卫在
 * `scripts/stories-build.ts`——那里依赖脚本自身位置，不属于本流水线。
 */

/** 构建失败（fail-closed）。消息即 CLI 打印的失败原因，逐字稳定——不要在别处重写措辞 */
export { StoryBuildError } from "./errors";
/** 一次构建的结果与词汇层警告的取口 */
export { drainBuildWarnings, type BuildReport } from "./report";
/** 目录布局的默认值与可配置项 */
export {
  DEFAULT_GENERATED_DIR,
  DEFAULT_RESOURCES_DIR,
  DEFAULT_SOURCES_DIR,
  type StoryBuildOptions,
} from "./orchestrate";
/** 十二段串行编排（流水线主入口） */
export { buildStories } from "./orchestrate";
/** 布局声明装载与校验（`Stories.src/config.ts`） */
export {
  CONFIG_FILE,
  loadStoryConfig,
  type StorySourceConfig,
} from "./story-config";
/** 源发现 v2（folders 多目录 + start 全局恰一） */
export { discoverSources, type DiscoveredSources } from "./source-discovery";
/** 编译器契约（story-compiler 对接面） */
export {
  loadDefaultCompiler,
  type CompiledStories,
  type CompiledStoryEntry,
  type CompilerDiagnostic,
  type StoriesCompiler,
} from "./compiler-contract";
