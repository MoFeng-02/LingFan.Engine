import { scanFile } from "./scan-file";
import type { CellIssue, CellScan, ScanCellsOptions } from "./types";
import { DEFAULT_GLOBAL_WHITELIST } from "./whitelist";

/**
 * 全树扫描 + 聚合去重/冲突（输入 = 相对路径 → 文本；不含 gen/，由调用方过滤）。
 * 同名同实现合并为一条；同名不同实现按冲突 fail-closed（不隐式覆盖）。
 * `options.globalWhitelist` 缺省 = 标准全局白名单，给别的名字要显式注入。
 */
export function scanCells(
  files: ReadonlyMap<string, string>,
  options: ScanCellsOptions = {},
): { errors: CellIssue[]; scan: CellScan } {
  const globalWhitelist = options.globalWhitelist ?? DEFAULT_GLOBAL_WHITELIST;
  const issues: CellIssue[] = [];
  const byName = new Map<string, { name: string; implText: string; origin: string }>();
  const importsInOrder: string[] = [];
  const seenImports = new Set<string>();

  for (const [relPath, text] of files) {
    for (const found of scanFile(relPath, text, globalWhitelist, issues)) {
      const existing = byName.get(found.name);
      if (existing === undefined) {
        byName.set(found.name, {
          name: found.name,
          implText: found.implText,
          origin: `${relPath} (cell "${found.name}")`,
        });
      } else if (existing.implText.trim() !== found.fingerprint) {
        issues.push({
          message: `cell "${found.name}" 同名不同实现（冲突）——换名字或统一实现（已有：${existing.origin}）`,
          origin: `${relPath} (cell "${found.name}")`,
        });
      }
      // 导入搬运：该 cell 所在文件中「声明了实现文本引用到的绑定」的语句（词边界匹配）
      const needed = [...found.imports.bindingNames].filter((binding) =>
        new RegExp(`\\b${binding}\\b`).test(found.implText),
      );
      for (const statement of found.imports.statements) {
        if (!statement.bindings.some((binding) => needed.includes(binding))) continue;
        if (!seenImports.has(statement.adjustedText)) {
          seenImports.add(statement.adjustedText);
          importsInOrder.push(statement.adjustedText);
        }
      }
    }
  }

  return {
    errors: issues,
    scan: {
      guards: [...byName.values()].map(({ name, implText }) => ({ name, implText })),
      importStatements: importsInOrder,
    },
  };
}
