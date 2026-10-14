/**
 * 模块层构建期 define 的常量求值器（AST 侧，零 esbuild）。
 *
 * config.ts 的 define 走 esbuild 求值通道（const-eval，esbuild 求值语义保证常量
 * 折叠与标识符消解）；模块层的 define 只发生在顶层语句，值域刻意收窄为
 * 「字面量 / 数组 / 对象 / 枚举成员引用」，本文件用 TS AST 直接折叠，不引入第二套
 * 打包器。枚举值是唯一的非常量字面量形态：标识符按本文件 import 与本地 enum 解析，
 * 被引用的枚举文件再按同文法折叠成员表（只认声明在该文件内的 enum，不追 re-export）。
 *
 * fail-closed：任何不可折叠形态（模板插值、展开、简写、计算属性、npm 枚举、
 * 引用型枚举初始化……）都返回可读原因，由收集器统一挂源文件:行:列定位。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import * as ts from "typescript";
import type { JsonValue } from "./const-eval.ts";

/** 一个枚举的成员值表（声明序；值 = 字符串或数字） */
type EnumTable = ReadonlyMap<string, string | number>;

/** 模块 import 登记：本地名 → 模块说明符与出口名（default 导入 exportedName = "default"） */
interface ImportedEnum {
  readonly specifier: string;
  readonly exportedName: string;
}

/** 求值上下文：当前模块的 import 表、本地 enum 表与跨文件枚举缓存（缓存可变） */
export interface ConstExprContext {
  /** 源目录绝对路径（枚举文件按它读盘） */
  readonly sourcesDir: string;
  /** 当前模块相对源根的 posix 路径（import 说明符按它的目录归一） */
  readonly rel: string;
  readonly imports: ReadonlyMap<string, ImportedEnum>;
  readonly localEnums: ReadonlyMap<string, EnumTable>;
  /** 已解析枚举文件的缓存：文件路径 → 枚举名 → 成员表 */
  readonly enumFiles: Map<string, Map<string, EnumTable>>;
}

export type ConstExprResult =
  | { ok: true; value: JsonValue }
  | { ok: false; reason: string };

/** 折叠一个表达式为 JSON 可序列化常量；任何非常量形态都返回可读原因 */
export function evalConstExpr(
  expr: ts.Expression,
  ctx: ConstExprContext,
): ConstExprResult {
  const unwrapped = unwrapExpr(expr);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return { ok: true, value: unwrapped.text };
  }
  if (ts.isNumericLiteral(unwrapped)) {
    return { ok: true, value: Number(unwrapped.text) };
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isPrefixUnaryExpression(unwrapped)) {
    return evalPrefixUnary(unwrapped);
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return evalArray(unwrapped, ctx);
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return evalObject(unwrapped, ctx);
  }
  if (ts.isIdentifier(unwrapped)) {
    return resolveEnumObject(unwrapped.text, ctx);
  }
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression)
  ) {
    return resolveEnumMember(unwrapped.expression.text, unwrapped.name.text, ctx);
  }
  if (
    ts.isElementAccessExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    ts.isStringLiteral(unwrapped.argumentExpression)
  ) {
    return resolveEnumMember(
      unwrapped.expression.text,
      unwrapped.argumentExpression.text,
      ctx,
    );
  }
  if (ts.isTemplateExpression(unwrapped)) {
    return { ok: false, reason: "模板串不支持插值——构建期 define 值请用字符串字面量" };
  }
  return {
    ok: false,
    reason: "值必须是可序列化常量：字符串/数字/布尔/null、数组或对象字面量、枚举成员引用",
  };
}

/** 解包括号与 as/类型断言包裹（求值语义 = 内层表达式） */
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

function evalPrefixUnary(
  expr: ts.PrefixUnaryExpression,
): ConstExprResult {
  if (expr.operator !== ts.SyntaxKind.MinusToken && expr.operator !== ts.SyntaxKind.PlusToken) {
    return { ok: false, reason: "一元运算符不支持构建期折叠（只支持正负号）" };
  }
  const inner = unwrapExpr(expr.operand);
  if (!ts.isNumericLiteral(inner)) {
    return { ok: false, reason: "正负号只能作用于数字字面量" };
  }
  const value = Number(inner.text);
  return { ok: true, value: expr.operator === ts.SyntaxKind.MinusToken ? -value : value };
}

function evalArray(
  expr: ts.ArrayLiteralExpression,
  ctx: ConstExprContext,
): ConstExprResult {
  const out: JsonValue[] = [];
  for (const element of expr.elements) {
    if (ts.isOmittedExpression(element)) {
      return { ok: false, reason: "数组字面量不允许空洞" };
    }
    if (ts.isSpreadElement(element)) {
      return { ok: false, reason: "数组字面量不支持展开元素" };
    }
    const item = evalConstExpr(element, ctx);
    if (!item.ok) return item;
    out.push(item.value);
  }
  return { ok: true, value: out };
}

function evalObject(
  expr: ts.ObjectLiteralExpression,
  ctx: ConstExprContext,
): ConstExprResult {
  const out: Record<string, JsonValue> = {};
  for (const prop of expr.properties) {
    if (ts.isPropertyAssignment(prop)) {
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
        return { ok: false, reason: "对象字面量不支持计算属性名" };
      }
      const value = evalConstExpr(prop.initializer, ctx);
      if (!value.ok) return value;
      out[prop.name.text] = value.value;
      continue;
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
      return { ok: false, reason: "对象字面量不支持简写属性——请写显式的 键: 值" };
    }
    if (ts.isSpreadAssignment(prop)) {
      return { ok: false, reason: "对象字面量不支持展开属性" };
    }
    return { ok: false, reason: "对象字面量只支持普通键值属性" };
  }
  return { ok: true, value: out };
}

/** 标识符 → 枚举对象（本地 enum 优先，其次 import 来源的枚举文件） */
function resolveEnumObject(
  name: string,
  ctx: ConstExprContext,
): ConstExprResult {
  const local = ctx.localEnums.get(name);
  if (local !== undefined) {
    return { ok: true, value: Object.fromEntries(local) };
  }
  const table = loadImportedEnum(name, ctx);
  if (!table.ok) return table;
  return { ok: true, value: Object.fromEntries(table.value) };
}

/** 枚举成员取值：`Sex.Male` / `Sex["Male"]` */
function resolveEnumMember(
  objName: string,
  member: string,
  ctx: ConstExprContext,
): ConstExprResult {
  const local = ctx.localEnums.get(objName);
  if (local !== undefined) {
    return takeEnumMember(local, objName, member);
  }
  const table = loadImportedEnum(objName, ctx);
  if (!table.ok) return table;
  return takeEnumMember(table.value, objName, member);
}

function takeEnumMember(
  table: EnumTable,
  objName: string,
  member: string,
): ConstExprResult {
  const value = table.get(member);
  if (value === undefined) {
    return { ok: false, reason: `枚举 "${objName}" 没有 "${member}" 成员` };
  }
  return { ok: true, value };
}

/** 按模块 import 表解析枚举文件并折叠成员表（解析失败返回可读原因） */
function loadImportedEnum(
  name: string,
  ctx: ConstExprContext,
): { ok: true; value: EnumTable } | { ok: false; reason: string } {
  const imported = ctx.imports.get(name);
  if (imported === undefined) {
    return {
      ok: false,
      reason: `无法识别的标识符 "${name}"——构建期 define 值只支持字面量与枚举成员引用`,
    };
  }
  if (imported.exportedName === "default") {
    return {
      ok: false,
      reason: `枚举 "${name}" 经 default 导入——构建期枚举折叠只支持具名导出的 enum`,
    };
  }
  if (!imported.specifier.startsWith(".")) {
    return {
      ok: false,
      reason: `枚举 "${name}" 来自 npm 包——构建期常量折叠只支持 Stories.src 内的枚举，请把枚举放进源目录再相对导入`,
    };
  }
  const fileRel = resolveEnumFileRel(imported.specifier, ctx);
  if (fileRel === undefined) {
    return { ok: false, reason: `无法解析枚举导入 "${imported.specifier}"（源目录内找不到对应文件）` };
  }
  const cachedFile = ctx.enumFiles.get(fileRel);
  if (cachedFile !== undefined) {
    const cached = cachedFile.get(imported.exportedName);
    if (cached !== undefined) return { ok: true, value: cached };
    return { ok: false, reason: `"${fileRel}" 中没有名为 "${imported.exportedName}" 的枚举` };
  }
  const parsed = parseEnumFile(fileRel, ctx);
  ctx.enumFiles.set(fileRel, parsed);
  const table = parsed.get(imported.exportedName);
  if (table === undefined) {
    return { ok: false, reason: `"${fileRel}" 中没有名为 "${imported.exportedName}" 的枚举` };
  }
  return { ok: true, value: table };
}

/** import 说明符 → 源根内 posix 路径（相对当前模块目录归一；补 .ts / index.ts） */
function resolveEnumFileRel(specifier: string, ctx: ConstExprContext): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(ctx.rel), specifier));
  const candidates = base.endsWith(".ts")
    ? [base]
    : [`${base}.ts`, `${base}/index.ts`];
  return candidates.find((cand) => existsSync(join(ctx.sourcesDir, cand)));
}

/** 读盘折叠一个枚举文件的全部 enum 声明（成员表按文法折叠，引用型初始化 fail-closed） */
function parseEnumFile(
  fileRel: string,
  ctx: ConstExprContext,
): Map<string, EnumTable> {
  const out = new Map<string, EnumTable>();
  let text: string;
  try {
    text = readFileSync(join(ctx.sourcesDir, fileRel), "utf8");
  } catch {
    return out;
  }
  const sf = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (!ts.isEnumDeclaration(stmt)) continue;
    const table = foldEnumMembers(stmt);
    if (table !== undefined) out.set(stmt.name.text, table);
  }
  return out;
}

/** 折叠一个 enum 声明的成员表；不可折叠成员（引用/计算名等）= 整枚举不登记 */
function foldEnumMembers(stmt: ts.EnumDeclaration): EnumTable | undefined {
  const table = new Map<string, string | number>();
  let auto = 0;
  let sawAuto = false;
  for (const member of stmt.members) {
    if (!ts.isIdentifier(member.name)) return undefined;
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
        return undefined; // 字符串枚举的无初始化成员（TS 本身也报错）
      }
      continue;
    }
    const value = foldEnumInit(init);
    if (value === undefined) return undefined;
    if (typeof value === "number") {
      sawAuto = true;
      auto = value + 1;
    }
    table.set(member.name.text, value);
  }
  return table;
}

/** 枚举成员初始化器：字符串/数字字面量或带符号数字字面量；其余不支持 */
function foldEnumInit(init: ts.Expression): string | number | undefined {
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
