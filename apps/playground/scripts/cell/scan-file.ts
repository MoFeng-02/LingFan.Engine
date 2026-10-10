import * as ts from "typescript";
import { checkFreeIdentifiers, collectFileImports, lineOf } from "./imports";
import type { CellIssue, FileImports } from "./types";

/** 沿成员/下标链下钻取最左标识符名（`cc.getInfo` → "cc"） */
export function rootIdentifier(node: ts.Node): string | undefined {
  let cursor: ts.Node = node;
  while (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor)) {
    cursor = cursor.expression;
  }
  return ts.isIdentifier(cursor) ? cursor.text : undefined;
}

/**
 * 单文件扫描：收集 `cell(...)` 调用（含校验），fail 项进 issues 不中断其它文件。
 * 实现三形态之外的参数形态按各自文案 fail-closed——判定条件与文案逐字固定。
 */
export function scanFile(
  relPath: string,
  text: string,
  globalWhitelist: ReadonlySet<string>,
  issues: CellIssue[],
): Array<{ name: string; implText: string; fingerprint: string; imports: FileImports }> {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true);
  const fromDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  const fileImports = collectFileImports(sf, text, fromDir, issues, relPath);
  const found: Array<{ name: string; implText: string; fingerprint: string; imports: FileImports }> = [];
  const origin = (node: ts.Node): string => `${relPath}:${lineOf(sf, node)}`;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "cell") {
      const [nameArg, implArg] = node.arguments;
      if (nameArg === undefined || !ts.isStringLiteralLike(nameArg)) {
        issues.push({ message: 'cell 第一个参数必须是字符串字面量名（如 cell("gold-non-negative", …)）', origin: origin(node) });
      } else if (implArg === undefined) {
        issues.push({ message: "cell 缺第二个参数（实现）", origin: origin(node) });
      } else if (ts.isCallExpression(implArg)) {
        issues.push({
          message: "cell 实现不支持调用表达式（参数固化属 L2）——改为函数字面量或引用导入的函数",
          origin: origin(implArg),
        });
      } else if (ts.isArrowFunction(implArg) || ts.isFunctionExpression(implArg)) {
        const implText = text.slice(implArg.getStart(sf), implArg.getEnd());
        checkFreeIdentifiers(implArg, origin(implArg), fileImports.bindingNames, globalWhitelist, issues);
        found.push({ name: nameArg.text, implText, fingerprint: implText.trim(), imports: fileImports });
      } else {
        const root = rootIdentifier(implArg);
        if (root === undefined || !fileImports.bindingNames.has(root)) {
          issues.push({
            message: `cell 引用形态的根标识符必须是本文件导入的绑定${root === undefined ? "" : `（收到 "${root}"，非导入绑定——本地绑定不搬运）`}`,
            origin: origin(implArg),
          });
        } else {
          const implText = text.slice(implArg.getStart(sf), implArg.getEnd());
          found.push({ name: nameArg.text, implText, fingerprint: implText.trim(), imports: fileImports });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return found;
}
