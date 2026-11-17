/**
 * 构建期扫描域出口（唯一出口，只转发）。
 *
 * 为什么独立成域而不是住 i18n/：扫描器依赖 typescript 编译器 API（构建期专属），
 * 运行期出口可达图（包根 → 域出口 → 实现叶）不得触达它——i18n/ 与包根都不值转发
 * 本域导出，创作期 CLI 经本出口取用。与 stories-build 的 Node 侧工具同口径。
 */

export {
  findUnmarkedHostTexts,
  isScannableSourcePath,
  scanHostSource,
  type AstScanOptions,
  type AstScanResult,
  type DynamicCallSite,
  type UnmarkedTextSite,
} from "./ast-scan.ts";