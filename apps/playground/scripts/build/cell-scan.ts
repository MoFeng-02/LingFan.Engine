import { scanCells, type CellScan } from "../cell";
import { StoryBuildError } from "./errors";

/**
 * cell 声明扫描（构建期 AST 扫描）：`Stories.src` 树（排除生成物目录，仅 `.ts`）。
 * 「名字在数据、实现在代码、build 做名字闭合」：实现住生成模块，故事 JSON 只留名字。
 * 任一条扫描问题都 fail-closed，一次报全部（每条带 `路径:行` 定位）。
 */
export function scanCellSources(
  sourcesTree: ReadonlyMap<string, string>,
  generatedDir: string,
): CellScan {
  const cellSourceTree = new Map<string, string>();
  for (const [rel, text] of sourcesTree) {
    if (rel.startsWith(`${generatedDir}/`) || !rel.endsWith(".ts")) continue;
    cellSourceTree.set(rel, text);
  }
  const cellScanResult = scanCells(cellSourceTree);
  if (cellScanResult.errors.length > 0) {
    throw new StoryBuildError(
      `cell 声明扫描失败：\n${cellScanResult.errors
        .map((issue) => `- ${issue.origin}：${issue.message}`)
        .join("\n")}`,
    );
  }
  return cellScanResult.scan;
}
