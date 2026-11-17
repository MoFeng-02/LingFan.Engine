/**
 * i18n 创作期 CLI 域出口（唯一出口，只转发）。
 *
 * 公共面 = 入口编排（runI18nCli）+ 参数解析（parseI18nArgs）及其类型；
 * IO 接线（i18n-io.ts）是域内实现细节，不经本出口对外。
 * bin/lingfan-i18n.mjs 垫片经本出口装载入口，不直引实现叶。
 */

export { runI18nCli, type I18nCliOutput } from "./i18n-cli.ts";
export {
  parseI18nArgs,
  type I18nArgsContext,
  type I18nCliArgs,
  type I18nCommand,
  type I18nFailOn,
} from "./args.ts";