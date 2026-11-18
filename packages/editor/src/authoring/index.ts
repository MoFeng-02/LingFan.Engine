/**
 * 创作期配置域出口（`@lingfan-engine/editor/authoring` 子入口）：
 * 工程清单 i18n 别名配置的纯函数解析。与 scan/ 同为创作期专属——
 * 包根运行期出口不转发本域；CLI 与 Node 宿主经本子入口取用。
 */
export { resolveI18nFunctions } from "./manifest";