/**
 * cell 声明提取器（构建期 AST 扫描，纯函数零 IO）：
 * 从 `Stories.src/**` 树收集 `cell("name", impl)` 调用，产出生成注册物
 * （`fun_register.g.ts`）所需的实现文本、导入搬运集与冲突/违规判定。
 *
 * 「名字在数据、实现在代码、build 做名字闭合」的提取半边。规则硬点：
 * - 实现三形态：箭头/函数字面量（原文落生成物）、标识符引用、成员访问引用；
 *   **调用表达式（参数固化）= L2，v1 显式不支持**；
 * - 字面量内自由标识符必须 ∈（所在文件导入绑定 ∪ 函数参数 ∪ 内部声明 ∪ 标准全局），
 *   引用模块级本地 const = fail-closed（**不做传递闭包**——规则简单才可靠）；
 * - 身份键 = (face, name)、指纹 = 实现文本 trim：**同键同纹去重、同键异纹冲突**
 *   （fail-closed 带两处定位，不隐式覆盖）；
 * - face v1 恒 `guards`；`cell` 只认裸标识符调用（house style 解构导入）；
 * - **导入搬运按生成物位置重写相对说明符**：生成物在 `Stories.src/gen/`（比源文件
 *   深一层），`"./x"`/`"../x"` 必须换算到同一目标——越出 `Stories.src` 根 fail-closed。
 */
import * as ts from "typescript";

export class CellExtractError extends Error {
  constructor(
    message: string,
    readonly origin: string,
  ) {
    super(`${origin} —— ${message}`);
    this.name = "CellExtractError";
  }
}

/** 提取产出（书写序；已按 (face,name)+指纹去重） */
export interface CellScan {
  guards: ReadonlyArray<{ readonly name: string; readonly implText: string }>;
  /** 生成物头部的 import 语句（说明符已按 gen/ 位置重写；跨文件去重，保序） */
  importStatements: readonly string[];
}

/** 单条问题（origin = "相对路径:行"） */
export interface CellIssue {
  readonly message: string;
  readonly origin: string;
}

/** cell 所在文件的 import 上下文：绑定名 + 重写后的语句文本 */
interface FileImports {
  readonly bindingNames: ReadonlySet<string>;
  readonly statements: ReadonlyArray<{ readonly adjustedText: string; readonly bindings: readonly string[] }>;
}

/** 标准全局白名单（字面量内允许直接引用；刻意最小——需要更多就走 import） */
const GLOBAL_WHITELIST = new Set([
  "JSON",
  "Math",
  "String",
  "Number",
  "Boolean",
  "Object",
  "Array",
  "Date",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "Infinity",
  "NaN",
  "undefined",
  "console",
]);

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * 相对说明符重写：源文件（相对 Stories.src 的目录 `fromDir`）→ 生成物（`gen/`，恰深一层）。
 * 解析到 Stories.src 内的规范相对路径后加 `../` 前缀；越出根 = null（调用方 fail-closed）；
 * 裸说明符（包名）原样。
 */
function adjustSpecifier(
  specifier: string,
  fromDir: string,
): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
  const segments: string[] = [];
  for (const part of `${fromDir}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.pop() === undefined) return null; // 越出 Stories.src 根
      continue;
    }
    segments.push(part);
  }
  if (segments.length === 0) return null;
  return `../${segments.join("/")}`;
}

/** 文件顶层 import 声明 → 绑定名集 + 「按 gen/ 位置重写过」的语句文本 */
function collectFileImports(
  sf: ts.SourceFile,
  text: string,
  fromDir: string,
  issues: CellIssue[],
  relPath: string,
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
    // 说明符重写（生成物在 gen/，比源文件深一层）
    const raw = statement.moduleSpecifier;
    let adjustedText = text.slice(statement.getStart(sf), statement.getEnd());
    if (ts.isStringLiteralLike(raw)) {
      const adjusted = adjustSpecifier(raw.text, fromDir);
      if (adjusted === null) {
        issues.push({
          message: `cell 所在文件 import "${raw.text}" 越出 Stories.src——生成物无法搬运该导入`,
          origin: `${relPath}:${lineOf(sf, statement)}`,
        });
        continue;
      }
      if (adjusted !== raw.text) {
        const rawQuoted = text.slice(raw.getStart(sf), raw.getEnd());
        adjustedText = adjustedText.replace(rawQuoted, JSON.stringify(adjusted));
      }
    }
    statements.push({ adjustedText, bindings });
  }
  return { bindingNames, statements };
}

/** 沿成员/下标链下钻取最左标识符名（`cc.getInfo` → "cc"） */
function rootIdentifier(node: ts.Node): string | undefined {
  let cursor: ts.Node = node;
  while (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor)) {
    cursor = cursor.expression;
  }
  return ts.isIdentifier(cursor) ? cursor.text : undefined;
}

/**
 * 字面量内自由标识符校验：全部 Identifier 必须 ∈（参数 ∪ 内部声明 ∪ 导入绑定 ∪ 全局白名单），
 * 属性位置（`ctx.get` 的 `get`）不算自由标识符。flat 集（不做作用域链——影子同名属
 * 已注记的伪接受边界，v1 不为它上作用域机）。
 */
function checkFreeIdentifiers(
  impl: ts.Node,
  origin: string,
  importedNames: ReadonlySet<string>,
  issues: CellIssue[],
): void {
  const allowed = new Set<string>([...GLOBAL_WHITELIST, ...importedNames]);
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
      if (node.name !== undefined && ts.isIdentifier(node.name)) allowed.add(node.name.text);
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

/** 单文件扫描：收集 cell 调用（含校验），fail 项进 issues 不中断其它文件 */
function scanFile(
  relPath: string,
  text: string,
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
        checkFreeIdentifiers(implArg, origin(implArg), fileImports.bindingNames, issues);
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

/** 全树扫描 + 聚合去重/冲突（输入 = 相对路径 → 文本；不含 gen/，由调用方过滤） */
export function scanCells(
  files: ReadonlyMap<string, string>,
): { errors: CellIssue[]; scan: CellScan } {
  const issues: CellIssue[] = [];
  const byName = new Map<string, { name: string; implText: string; origin: string }>();
  const importsInOrder: string[] = [];
  const seenImports = new Set<string>();

  for (const [relPath, text] of files) {
    for (const found of scanFile(relPath, text, issues)) {
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

/** 生成物渲染（逐字节确定：同扫描同文本；入库文件，手改会被覆盖） */
export function renderFunRegister(scan: CellScan): string {
  const lines: string[] = [];
  lines.push("/* GENERATED by stories:build (cell) — 手改会在下次构建被覆盖 */");
  // Record<string, GuardFn> 给字面量参数提供语境类型（strict 下无 implicit-any）
  lines.push('import type { GuardFn } from "@lingfan/engine";');
  for (const statement of scan.importStatements) lines.push(statement);
  lines.push("");
  lines.push("export const guards: Record<string, GuardFn> = {");
  for (const guardEntry of scan.guards) {
    lines.push(`  ${JSON.stringify(guardEntry.name)}: ${guardEntry.implText},`);
  }
  lines.push("};");
  lines.push("");
  lines.push('declare module "@lingfan/editor" {');
  lines.push("  interface GuardNameRegistry {");
  for (const guardEntry of scan.guards) {
    lines.push(`    ${JSON.stringify(guardEntry.name)}: 1;`);
  }
  lines.push("  }");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}
