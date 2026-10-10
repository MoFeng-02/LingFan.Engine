/**
 * TS 故事源编译流水线出口（唯一出口）：把 `Stories.src/<name>.ts` 编译成
 * `Resources/Stories/**` + `project.json`，并维护 cell 生成物。
 *
 * 零第二套规则：TS 源合法 ⇔ 其编译产物作为 JSON 合法（与 JSON 同一 `parseStory`）。
 * 工程清单（entry/defines/shell）不归 TS 源管——必须先有 `Resources/project.json`，
 * 编译只更新其托管键（`serializeProject` 既有语义）。`Stories/**` 列集由源全量管理：
 * 启用 TS 源的工程，手写列文件会被当作陈旧产物清理（报告逐条列出）。
 * 编辑器/引擎/Rust 对 TS 零感知；TS 源不进打包产物（运行期零攻击面）。
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
