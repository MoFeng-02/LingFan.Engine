/**
 * 模块层构建期角色声明收集器（编排层段）：扫描 Stories.src 各 .ts 模块顶层的
 * character(...) 表达式语句，产出全工程角色表；汇编层把它前置成每个故事
 * start 列头的 character 命令（进场即有，跨章共用）。
 *
 * 收集规则（与模块层 define 收集器同一套）：
 * - 只收顶层表达式语句的 character 调用（列体内的 character 是运行期词，不在此碰）；
 * - config.ts 走自己的求值通道，根级文件的结构违规与生成物目录由既有诊断负责，
 *   两者都跳过；
 * - 实参文法 = `character(key, spec)`：key 必须字符串字面量；spec 走 const-expr
 *   折叠（字符串/数字/布尔/null/数组/对象字面量/枚举成员引用），引用运行期值
 *   fail-closed 报错带声明位置；
 * - spec 对象只认 CharacterDef 的六个可选样式字段（name/color/size/font/
 *   textColor/screen），全部收窄为字符串，未知字段拒绝；
 * - 顶层声明遮蔽 character（同名 import/const/函数/enum）时 fail-closed——
 *   构建期声明只识别全局内建，遮蔽即语义歧义。
 *
 * 冲突处理：跨文件同名角色且定义不等 = 构建期 fail-closed（报两处声明位置）；
 * 定义完全相同 = 幂等合并。
 *
 * fail-closed：一次报全部，格式与其余管线诊断同构（`- 源文件:行:列 原因`）。
 */
import * as ts from "typescript";
import { CONFIG_FILE } from "../config/index.ts";
import { StoryBuildError } from "../shared/index.ts";
import type { CharacterDef } from "@lingfan/engine";
import {
  type ConstExprContext,
  evalConstExpr,
} from "./const-expr.ts";

/** 一条模块层角色声明：求值产物 + 声明位置（跨文件冲突诊断要带两处位置） */
export interface LocatedCharacterDecl {
  readonly key: string;
  readonly def: CharacterDef;
  /** `源文件相对路径:行:列`（行列为 1 基，与其余管线诊断同构） */
  readonly origin: string;
  readonly rel: string;
}

export interface CollectModuleCharactersInput {
  /** 源目录绝对路径：被 import 的枚举文件按它读盘折叠 */
  readonly sourcesDir: string;
  /** 源树（rel → 源文，walkFiles 结果）；收集器只读，不改写 */
  readonly files: ReadonlyMap<string, string>;
  /** 生成物目录名（相对源根）：gen 产物不参与收集 */
  readonly generatedDirName: string;
}

/** 全工程角色表（key → 定义；同名冲突已在收集期判定处理） */
export type CharacterTable = Map<string, CharacterDef>;

/** CharacterDef 的可选样式字段（key 之外）；spec 对象只认这些键 */
const CHARACTER_FIELDS = [
  "name",
  "color",
  "size",
  "font",
  "textColor",
  "screen",
] as const;

export function collectModuleCharacters(
  input: CollectModuleCharactersInput,
): CharacterTable {
  const decls: LocatedCharacterDecl[] = [];
  const diags: string[] = [];
  for (const rel of [...input.files.keys()].sort()) {
    if (rel === CONFIG_FILE) continue;
    if (!rel.endsWith(".ts")) continue;
    if (!rel.includes("/")) continue; // 根级结构违规由图谱层既有诊断负责
    if (rel.startsWith(`${input.generatedDirName}/`)) continue;
    const text = input.files.get(rel);
    if (text !== undefined) collectFromFile(input.sourcesDir, rel, text, decls, diags);
  }
  // 冲突判定：同名角色定义不等 = fail-closed；全等 = 幂等
  const table: CharacterTable = new Map();
  const origins = new Map<string, string>();
  for (const decl of decls) {
    const existing = table.get(decl.key);
    if (existing === undefined) {
      table.set(decl.key, decl.def);
      origins.set(decl.key, decl.origin);
      continue;
    }
    if (JSON.stringify(existing) === JSON.stringify(decl.def)) continue; // 幂等
    diags.push(
      `${decl.origin}角色 "${decl.key}" 与 ${origins.get(decl.key)} 处的声明冲突（同名不同义）：请统一两处定义，或改用列内 character 覆盖`,
    );
  }
  if (diags.length > 0) {
    throw new StoryBuildError(
      `模块层构建期角色声明收集失败（${diags.length} 条）：\n${diags.join("\n")}`,
    );
  }
  return table;
}

function collectFromFile(
  sourcesDir: string,
  rel: string,
  text: string,
  decls: LocatedCharacterDecl[],
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
  const shadows = collectTopLevelBindingNames(sf).has("character");
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const call = stmt.expression;
    if (!isCharacterCall(call)) continue;
    const origin = formatOrigin(rel, sf, call);
    if (shadows) {
      diags.push(
        `${origin}character 被本文件顶层声明遮蔽——构建期角色声明只识别全局内建，请消除遮蔽`,
      );
      continue;
    }
    collectCall(call, origin, ctx, decls, diags);
  }
}

function collectCall(
  call: ts.CallExpression,
  origin: string,
  ctx: ConstExprContext,
  decls: LocatedCharacterDecl[],
  diags: string[],
): void {
  const [first, second] = call.arguments;
  if (first === undefined || second === undefined || call.arguments.length > 2) {
    diags.push(`${origin}character 调用接受 2 个实参：(key, 样式对象)`);
    return;
  }
  const keyExpr = unwrapExpr(first);
  if (!ts.isStringLiteral(keyExpr) || keyExpr.text === "") {
    diags.push(`${origin}character 首参必须是非空字符串字面量 key`);
    return;
  }
  const spec = evalConstExpr(second, ctx);
  if (!spec.ok) {
    diags.push(`${origin}character("${keyExpr.text}")：${spec.reason}`);
    return;
  }
  if (!isRecord(spec.value)) {
    diags.push(`${origin}character("${keyExpr.text}")：第二参必须是普通对象字面量`);
    return;
  }
  const def: CharacterDef = { key: keyExpr.text };
  for (const [field, raw] of Object.entries(spec.value)) {
    if (!(CHARACTER_FIELDS as readonly string[]).includes(field)) {
      diags.push(
        `${origin}character("${keyExpr.text}")：未知字段 "${field}"（只认 ${CHARACTER_FIELDS.join("/")}）`,
      );
      return;
    }
    if (typeof raw !== "string") {
      diags.push(`${origin}character("${keyExpr.text}")：字段 ${field} 必须是字符串`);
      return;
    }
    def[field as keyof CharacterDef] = raw;
  }
  decls.push({ key: keyExpr.text, def, origin, rel: ctx.rel });
}

function isCharacterCall(expr: ts.Expression): expr is ts.CallExpression {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "character"
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

function isRecord(value: unknown): value is Record<string, unknown> {
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

/** 模块 import 登记（与 const-expr 的 ImportedEnum 同文法；值/type 导入同等可用） */
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
    unwrapped.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrapped.operand)
  ) {
    return -Number(unwrapped.operand.text);
  }
  return undefined;
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
        collectBindingNames(decl.name, names);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isEnumDeclaration(stmt)) &&
      stmt.name !== undefined
    ) {
      names.add(stmt.name.text);
    }
  }
  return names;
}

/** 绑定名递归收集：标识符直取，对象/数组解构展开元素（缺省名、重命名取属性名侧） */
function collectBindingNames(pattern: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(pattern)) {
    names.add(pattern.text);
    return;
  }
  for (const element of pattern.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (element.propertyName !== undefined && ts.isIdentifier(element.propertyName)) {
      names.add(element.propertyName.text);
    }
    collectBindingNames(element.name, names);
  }
}
