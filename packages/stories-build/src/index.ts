/**
 * TS 故事源编译流水线出口（唯一出口）：把 `Stories.src/` 多目录原生 TS 语句源编译成
 * `Resources/Stories/**` + `project.json`，并维护 cell 生成物。
 *
 * 布局声明 `Stories.src/config.ts`（根级唯一根文件，named exports 单次求值）：
 * `folders` 声明源目录（可含 `"*"` 通配全部目录）、`start` 声明入口故事文件名（跨目录全局
 * 恰一）；`vars`（键集对象）登记插值变量键、`state`（形态 A）/`define(...)`（形态 B）
 * 声明 state 初始值，两者可缺省但互斥。
 * 源发现按「default 导出存在」区分故事/模块文件；产物路径 = 源文件路径
 * （`Stories/<相对源路径>.json`，文件名与列 id 解耦）。`config.start` 经托管键
 * 更新落到 `project.json` 的 `entry`（`serializeProject` 既有语义）。
 *
 * 零第二套规则：TS 源合法 ⇔ 其编译产物作为 JSON 合法（与 JSON 同一 `parseStory`）。
 * 工程清单（entry/defines/shell）不归 TS 源管——必须先有 `Resources/project.json`，
 * 编译只更新其托管键。`Stories/**` 列集由源全量管理：启用 TS 源的工程，手写列文件
 * 会被当作陈旧产物清理（报告逐条列出）。构建在清单写入非托管标记键 `tsSource`，
 * 编辑器据此对 TS 源工程的 JSON 产物只读（`packages/editor` 的 `tsSourceGuard`）。
 *
 * 编译器对接：`compileStories` 契约（`./compiler`）——默认装载其中的
 * `story-compiler.ts`，`StoryBuildOptions.compiler` 可注入（过渡期/测试）。
 *
 * 扩展 op 放行（对齐运行期声明制）：清单 `extensions` 声明扩展模块说明符——编译期
 * 用与运行期同一个装载契约（`loadDeclaredExtensions`）装载，收集其提供的 op 名；
 * 故事里既非内建、也未被声明扩展提供的 op 名 = 运行期必 unknown-op ⇒ 构建期即拦截
 * （fail-early，带列与命令指针定位，一次报全部）。声明缺席/为空 = 零装载零副作用。
 *
 * 测试直接调 `buildStories`（纯编排，fs 全在参数 root 之下）；CLI 主守卫在
 * `cli` 域——那里依赖被直接执行这一事实，不属于本流水线的出口面，故不在下面导出
 * （它以包说明符 `@lingfan-engine/stories-build/cli` 暴露给宿主）。
 */

/** 构建失败（fail-closed）。消息即 CLI 打印的失败原因，逐字稳定——不要在别处重写措辞 */
export { StoryBuildError } from "./shared/index.ts";
/** 集中文案表（StoryBuildOptions.texts / compileStories input.texts 的注入类型与缺省值） */
export {
  defaultStoriesBuildTexts,
  type StoriesBuildTexts,
} from "./shared/index.ts";
/** 一次构建的结果与词汇层警告的取口 */
export { drainBuildWarnings, type BuildReport } from "./emit/index.ts";
/** 目录布局的默认值与可配置项 */
export {
  DEFAULT_GENERATED_DIR,
  DEFAULT_RESOURCES_DIR,
  DEFAULT_SOURCES_DIR,
  type StoryBuildOptions,
} from "./pipeline/index.ts";
/** 十二段串行编排（流水线主入口） */
export { buildStories } from "./pipeline/index.ts";
/** 编译期求值域（config.ts 单次求值 + define 内建 + 形态 A/B 状态降维） */
export {
  evalConfigModule,
  type ConfigEvalOutcome,
} from "./const-eval/index.ts";
/** 布局声明与 config.ts 契约类型 */
export { CONFIG_FILE, type StorySourceConfig } from "./config/index.ts";
/** 创作垫片类型（@lingfan-engine/stories-build/authoring 随包 .d.ts 的主出口同源） */
export type { InferStateSchema } from "./config/state-type.ts";
/** 源发现 v2（folders 多目录 + start 全局恰一） */
export { discoverSources, type DiscoveredSources } from "./discovery/index.ts";
/** 编译器契约（story-compiler 对接面） */
export {
  loadDefaultCompiler,
  type CompiledStories,
  type CompiledStoryEntry,
  type CompilerDiagnostic,
  type StoriesCompiler,
} from "./compiler/index.ts";
/** 字体名注册表（Resources/Fonts 扫描；宿主 Vite 插件与构建期检查同源消费） */
export {
  FONTS_DIR_NAME,
  FONT_EXTENSIONS,
  fontNameSet,
  scanFontRegistry,
  type FontEntry,
} from "./fonts/index.ts";
/** UI 名注册表（源根兄弟目录 `ui/<名>/` 扫描；构建期 uis 闸门的判据来源） */
export {
  UI_DIR_NAME,
  scanUiRegistry,
  uiNameSet,
  type UiFileEntry,
} from "./ui/index.ts";
/** UI import 面静态校验（UI 不归构建管，越界依赖只能在这里拦） */
export {
  checkUiImports,
  scanUiImports,
  type UiImportRef,
  type UiImportViolation,
} from "./ui/index.ts";
