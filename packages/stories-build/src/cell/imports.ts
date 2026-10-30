import * as ts from "typescript";
import type { CellIssue, FileImports } from "./types.ts";

/**
 * 字面量内自由标识符校验：全部 Identifier 必须 ∈（参数、内部声明、导入绑定与全局白名单的并集），
 * 属性位置（`ctx.get` 的 `get`）不算自由标识符。flat 集（不做作用域链——影子同名属
 * 已注记的伪接受边界，v1 不为它上作用域机）。
 */
export function checkFreeIdentifiers(
  impl: ts.Node,
  origin: string,
  importedNames: ReadonlySet<string>,
  globalWhitelist: ReadonlySet<string>,
  issues: CellIssue[],
): void {
  const allowed = new Set<string>([...globalWhitelist, ...importedNames]);
  const free = new Set<string>();
  const visit = (node: ts.Node): void => {
    // 声明与参数：名字进 allowed，继续递归初始化/函数体
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name)) allowed.add(node.name.text);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      if (node.name !== undefined && ts.isIdentifier(node.name))
        allowed.add(node.name.text);
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName =
        parent !== undefined &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isQualifiedName(parent) && parent.right === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node));
      if (!isPropertyName && !allowed.has(node.text)) free.add(node.text);
    }
    node.forEachChild(visit);
  };
  visit(impl);
  if (free.size > 0) {
    issues.push({
      message: `cell 内联实现引用了未导入的标识符（${[...free].map((n) => `"${n}"`).join("、")}）——把实现提为 import，或内联其依赖（不做传递闭包）`,
      origin,
    });
  }
}

/** 节点所在行号（1 起；读取 AST 只做定位，不改变任何判定） */
export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * 相对说明符重写：源文件（相对源根的目录 `fromDir`）→ 生成物所在目录。
 *
 * `rootPrefix` = 从生成物目录回到源根的相对路径（默认布局下 `"../Stories.src"`：
 * 生成物在 `src/gen/`，源根在 `src/Stories.src/`，两者同级）。缺省 `".."` = 生成物
 * 就在源根内一层（旧布局）。调用方按工程布局算好传进来，本函数不猜目录。
 *
 * 解析到源根内的规范相对路径后拼前缀；越出根 = null（调用方 fail-closed）；
 * 裸说明符（包名）原样。
 */
export function adjustSpecifier(
  specifier: string,
  fromDir: string,
  rootPrefix = "..",
): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../"))
    return specifier;
  const segments: string[] = [];
  for (const part of `${fromDir}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.pop() === undefined) return null; // 越出源根
      continue;
    }
    segments.push(part);
  }
  if (segments.length === 0) return null;
  return `${rootPrefix}/${segments.join("/")}`;
}

/** 文件顶层 import 声明 → 绑定名集 + 「按生成物位置重写过」的语句文本 */
export function collectFileImports(
  sf: ts.SourceFile,
  text: string,
  fromDir: string,
  issues: CellIssue[],
  relPath: string,
  rootPrefix = "..",
  isForeignImport?: (fromRel: string, specifier: string) => boolean,
): FileImports {
  const statements: Array<{ adjustedText: string; bindings: string[] }> = [];
  const bindingNames = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings: string[] = [];
    const clause = statement.importClause;
    if (clause !== undefined) {
      if (clause.name !== undefined) bindings.push(clause.name.text); // import X from
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) bindings.push(element.name.text);
      }
      if (named !== undefined && ts.isNamespaceImport(named)) {
        bindings.push(named.name.text); // import * as X
      }
    }
    for (const binding of bindings) bindingNames.add(binding);
    // `import type` 只进类型面，运行期不存在 ⇒ 不搬运、也不受源根沙箱约束
    // （与编译图的导入扫描同一口径：`clause.isTypeOnly` 先放行）
    if (clause?.isTypeOnly === true) continue;
    // 说明符重写（生成物在源根之外的同级目录，比源文件深一层）
    const raw = statement.moduleSpecifier;
    let adjustedText = text.slice(statement.getStart(sf), statement.getEnd());
    if (ts.isStringLiteralLike(raw)) {
      // 由别的通道处置的导入（如 UI 句柄）不搬进生成物，也不受源根沙箱约束：
      // 生成注册物只需要 cell 实现文本，句柄是构建期事实，运行期不再需要那条语句。
      if (isForeignImport?.(relPath, raw.text) === true) continue;
      const adjusted = adjustSpecifier(raw.text, fromDir, rootPrefix);
      if (adjusted === null) {
        issues.push({
          message: `cell 所在文件 import "${raw.text}" 越出 Stories.src——生成物无法搬运该导入`,
          origin: `${relPath}:${lineOf(sf, statement)}`,
        });
        continue;
      }
      if (adjusted !== raw.text) {
        const rawQuoted = text.slice(raw.getStart(sf), raw.getEnd());
        adjustedText = adjustedText.replace(
          rawQuoted,
          JSON.stringify(adjusted),
        );
      }
    }
    statements.push({ adjustedText, bindings });
  }
  return { bindingNames, statements };
}
