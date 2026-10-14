/**
 * 模块层构建期 define 收集器（编排层段）：扫描 Stories.src 各 .ts 模块顶层的
 * define(...) 表达式语句，产出带落点定位的调用清单，与 config.ts 的 define
 * 求值通道汇入同一棵合并树（汇入在 pipeline：mergeDefineCallsInto）。
 *
 * 收集规则（define 域放宽）：
 * - 只收顶层表达式语句的 define 调用（函数体内的 define 是运行期词，语义
 *   define-once 归编译器/运行期管，此处刻意不碰）；
 * - config.ts 走自己的求值通道，根级文件的结构违规与生成物目录由既有诊断负责，
 *   两者都跳过；
 * - 值域 = 字面量/数组/对象/枚举成员引用（const-expr 折叠，AST 侧零求值）；
 * - 顶层声明遮蔽 define（同名 import/const/函数/enum）时 fail-closed——构建期
 *   define 只识别全局内建，遮蔽即语义歧义。
 *
 * fail-closed：一次报全部，格式与其余管线诊断同构（`- 源文件:行:列 原因`）。
 */
import * as ts from "typescript";
import { CONFIG_FILE } from "../config";
import { StoryBuildError } from "../shared";
import type { DefineCall, JsonValue } from "./const-eval";
import {
  type ConstExprContext,
  evalConstExpr,
} from "./const-expr";

/** 一条模块层 define 调用：求值产物 + 落点（跨文件冲突诊断要带两处位置） */
export interface LocatedDefineCall {
  readonly call: DefineCall;
  /** `源文件相对路径:行:列`（行列为 1 基，与其余管线诊断同构） */
  readonly origin: string;
  readonly rel: string;
}

export interface CollectModuleDefinesInput {
  /** 源目录绝对路径：被 import 的枚举文件按它读盘折叠 */
  readonly sourcesDir: string;
  /** 源树（rel → 源文，walkFiles 结果）；收集器只读，不改写 */
  readonly files: ReadonlyMap<string, string>;
  /** 生成物目录名（相对源根）：gen 产物不参与收集 */
  readonly generatedDirName: string;
}

export function collectModuleDefines(
  input: CollectModuleDefinesInput,
): readonly LocatedDefineCall[] {
  const calls: LocatedDefineCall[] = [];
  const diags: string[] = [];
  for (const rel of [...input.files.keys()].sort()) {
    if (rel === CONFIG_FILE) continue;
    if (!rel.endsWith(".ts")) continue;
    if (!rel.includes("/")) continue; // 根级结构违规由图谱层既有诊断负责
    if (rel.startsWith(`${input.generatedDirName}/`)) continue;
    const text = input.files.get(rel);
    if (text !== undefined) collectFromFile(input.sourcesDir, rel, text, calls, diags);
  }
  if (diags.length > 0) {
    throw new StoryBuildError(
      `模块层构建期 define 收集失败（${diags.length} 条）：\n${diags.join("\n")}`,
    );
  }
  return calls;
}

function collectFromFile(
  sourcesDir: string,
  rel: string,
  text: string,
  calls: LocatedDefineCall[],
  diags: string[],
): void {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const ctx: ConstExprContext = {
    sourcesDir,
    rel,
    imports: collectImportBindings(sf),
    localEnums: collectLocalEnums(sf),
    enumFiles: new Map(),
  };
  const shadows = collectTopLevelBindingNames(sf).has("define");
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const call = stmt.expression;
    if (!isDefineCall(call)) continue;
    const origin = formatOrigin(rel, sf, call);
    if (shadows) {
      diags.push(
        `${origin}define 被本文件顶层声明遮蔽——构建期 define 只识别全局内建，请消除遮蔽`,
      );
      continue;
    }
    collectCall(call, origin, ctx, calls, diags);
  }
}

function collectCall(
  call: ts.CallExpression,
  origin: string,
  ctx: ConstExprContext,
  calls: LocatedDefineCall[],
  diags: string[],
): void {
  const [first, second] = call.arguments;
  if (first === undefined) {
    diags.push(`${origin}define 调用只接受 1 个对象实参或 2 个（路径, 值）实参`);
    return;
  }
  if (second !== undefined && call.arguments.length > 2) {
    diags.push(`${origin}define 调用只接受 1 个对象实参或 2 个（路径, 值）实参`);
    return;
  }
  if (second === undefined) {
    const spec = evalConstExpr(first, ctx);
    if (!spec.ok) {
      diags.push(`${origin}define({…})：${spec.reason}`);
      return;
    }
    if (!isRecord(spec.value)) {
      diags.push(`${origin}define({…})：对象实参必须是普通对象字面量`);
      return;
    }
    calls.push({ call: { kind: "spec", spec: spec.value }, origin, rel: ctx.rel });
    return;
  }
  const pathExpr = unwrapExpr(first);
  if (!ts.isStringLiteral(pathExpr)) {
    diags.push(
      `${origin}define 首参必须是字符串字面量路径，或单参对象实参`,
    );
    return;
  }
  const path = pathExpr.text;
  const value = evalConstExpr(second, ctx);
  if (!value.ok) {
    diags.push(`${origin}define("${path}")：${value.reason}`);
    return;
  }
  calls.push({ call: { kind: "path", path, value: value.value }, origin, rel: ctx.rel });
}

function isDefineCall(expr: ts.Expression): expr is ts.CallExpression {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "define"
  );
}

function unwrapExpr(expr: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isTypeAssertionExpression(expr)
  ) {
    return unwrapExpr(expr.expression);
  }
  return expr;
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatOrigin(
  rel: string,
  sf: ts.SourceFile,
  node: ts.Node,
): string {
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${rel}:${pos.line + 1}:${pos.character + 1} `;
}

/** 顶层值绑定名（import/const/函数/enum）——只用于遮蔽判定 */
function collectTopLevelBindingNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (clause === undefined) continue;
      if (clause.name !== undefined) names.add(clause.name.text);
      if (clause.namedBindings !== undefined) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          names.add(clause.namedBindings.name.text);
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) names.add(el.name.text);
        }
      }
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
      names.add(stmt.name.text);
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) names.add(stmt.name.text);
  }
  return names;
}

/** 模块 import 登记（与 state-enum-ast 同文法；值/type 导入同等可用） */
function collectImportBindings(
  sf: ts.SourceFile,
): Map<string, { specifier: string; exportedName: string }> {
  const imports = new Map<string, { specifier: string; exportedName: string }>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (clause === undefined) continue;
    const specifier = stmt.moduleSpecifier.text;
    if (clause.name !== undefined) {
      imports.set(clause.name.text, { specifier, exportedName: "default" });
    }
    if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        imports.set(el.name.text, {
          specifier,
          exportedName: el.propertyName?.text ?? el.name.text,
        });
      }
    }
  }
  return imports;
}

/** 本文件 enum 声明的成员表（折叠规则与跨文件枚举一致；不可折叠成员不登记） */
function collectLocalEnums(sf: ts.SourceFile): Map<string, ReadonlyMap<string, string | number>> {
  const enums = new Map<string, ReadonlyMap<string, string | number>>();
  for (const stmt of sf.statements) {
    if (!ts.isEnumDeclaration(stmt)) continue;
    const table = new Map<string, string | number>();
    let auto = 0;
    let sawAuto = false;
    let foldable = true;
    for (const member of stmt.members) {
      if (!ts.isIdentifier(member.name)) {
        foldable = false;
        break;
      }
      const init = member.initializer;
      if (init === undefined) {
        if (sawAuto) {
          table.set(member.name.text, auto);
          auto += 1;
        } else if (table.size === 0) {
          sawAuto = true;
          table.set(member.name.text, 0);
          auto = 1;
        } else {
          foldable = false;
          break;
        }
        continue;
      }
      const value = foldEnumInitializer(init);
      if (value === undefined) {
        foldable = false;
        break;
      }
      if (typeof value === "number") {
        sawAuto = true;
        auto = value + 1;
      }
      table.set(member.name.text, value);
    }
    if (foldable) enums.set(stmt.name.text, table);
  }
  return enums;
}

function foldEnumInitializer(init: ts.Expression): string | number | undefined {
  const unwrapped = unwrapExpr(init);
  if (ts.isStringLiteral(unwrapped)) return unwrapped.text;
  if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.MinusToken
  ) {
    const operand = unwrapExpr(unwrapped.operand);
    if (ts.isNumericLiteral(operand)) return -Number(operand.text);
  }
  return undefined;
}
