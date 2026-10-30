import { scanCells, type CellScan } from "../cell/index.ts";
import { StoryBuildError } from "../shared/index.ts";

/**
 * cell 声明扫描（构建期 AST 扫描）：源树（排除生成物目录，仅 `.ts`）。
 * 「名字在数据、实现在代码、build 做名字闭合」：实现住生成模块，故事 JSON 只留名字。
 * 任一条扫描问题都 fail-closed，一次报全部（每条带 `路径:行` 定位）。
 *
 * `generatedDir` 排除项是防手工把生成物放进源树林；`rootPrefix` 只在生成物住在源根
 * 之外时给（见 `ScanCellsOptions`），决定搬运进来的 import 说明符怎么写。
 * `isForeignImport` 交给调用方指认「这条导入由别的通道处置」（如 UI 句柄）——这类语句
 * 既不搬进生成物，也不参与越界判定。
 */
export function scanCellSources(
  sourcesTree: ReadonlyMap<string, string>,
  generatedDir: string,
  rootPrefix = "..",
  isForeignImport?: (fromRel: string, specifier: string) => boolean,
): CellScan {
  const cellSourceTree = new Map<string, string>();
  for (const [rel, text] of sourcesTree) {
    if (rel.startsWith(`${generatedDir}/`) || !rel.endsWith(".ts")) continue;
    cellSourceTree.set(rel, text);
  }
  const cellScanResult = scanCells(cellSourceTree, {
    rootPrefix,
    ...(isForeignImport === undefined ? {} : { isForeignImport }),
  });
  if (cellScanResult.errors.length > 0) {
    throw new StoryBuildError(
      `cell 声明扫描失败：\n${cellScanResult.errors
        .map((issue) => `- ${issue.origin}：${issue.message}`)
        .join("\n")}`,
    );
  }
  return cellScanResult.scan;
}
