/**
 * state 类型面的枚举 type 槽位回收（AST 侧，供 state-render 生成 import type）。
 *
 * 为什么需要：config 求值走 esbuild 打包，标识符在求值产物里消失——`type: Sex` 到了
 * 合并树里只剩枚举对象本身，渲染层无从知道它来自哪个模块，也就生成不出
 * `import type { Sex } from …`。本段用 TS AST 重读源文，把 define(...) 调用、形态 A
 * `export const state` 初始化器与 default 对象（export default { … } satisfies）的
 * state 字段里、descriptor 形对象的 `type` 槽位按点路径回收
 * （esbuild 求值语义保证：同名调用/同形初始化器 = 合并树里的同一条数据），并解析
 * 该标识符的 import 来源。
 *
 * 收集域（define 域定稿）：config.ts 收全树；其余模块只收顶层
 * define 表达式语句（函数体内是运行期词，不回收）。模块的 import 说明符相对
 * 各自文件目录，登记前统一折算为「源根相对路径」，config 的说明符相对源根
 * 本就无需折算。
 *
 * 用法：入参 = config.ts 源文本；出参 = 点路径 → 槽位列表（直接槽位与并集成员
 * 槽位按位置累积，同位置首见胜）。渲染层只把「路径能在合并树里对上且槽位存在」
 * 的枚举生成为 import 引用，其余一律回退为内联字面量联合（类型仍精确，只是少了
 * 跨模块引用）。
 *
 * 注意：本文件只做「名称回收」，不做文法校验——槽位形状合法性由求值与降维段统一
 * 判定；qualified name（`Enums.Sex`）与本地声明的枚举不回收（gen 只引用 import 进
 * 源文件的类型模块），走回退。
 */
import { posix } from "node:path";
import * as ts from "typescript";
import { MAX_ALIAS_HOPS } from "../shared/index.ts";

/** 一个可 import 的枚举 type 槽位：源文件里的本地绑定名 + 模块说明符 */
export interface EnumTypeSlot {
  /** 源文件内使用的本地名（生成物沿用该名，必要时以 `as` 别名导入） */
  readonly localName: string;
  /** 模块出口名；default 导入记为 "default"，渲染层生成默认导入形态 */
  readonly importedName: string;
  /** 相对源根的模块路径（渲染层按生成物目录改写相对层级） */
  readonly source: string;
  /**
   * 并集成员下标：type 槽位为多元素数组（并集）时记录枚举所在的成员位置，
   * 渲染层按下标配对；undefined = 直接 type 槽位（非并集）。
   */
  readonly memberIndex?: number;
}

/** 别名回溯上限：有限跳数防环（与 module-scan 状态根别名链同思路） */

export function collectEnumTypeSlots(
  configSource: string,
): ReadonlyMap<string, EnumTypeSlot[]> {
  return collectEnumTypeSlotsForBuild({ configSource, moduleFiles: new Map() });
}

/** 多源槽位回收入参：config 源文 + 模块层源文（rel → 源文，不含 config） */
export interface EnumSlotBuildInput {
  readonly configSource: string;
  readonly moduleFiles: ReadonlyMap<string, string>;
}

/**
 * 从 config.ts 与各模块源文回收枚举 type 槽位（求值产物丢标识符，AST 侧按
 * 同一叶路径配对；模块说明符按各自目录折算为源根相对路径）。
 */
export function collectEnumTypeSlotsForBuild(
  input: EnumSlotBuildInput,
): ReadonlyMap<string, EnumTypeSlot[]> {
  const slots = new Map<string, EnumTypeSlot[]>();
  const configSf = ts.createSourceFile(
    "config.ts",
    input.configSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = collectImportBindings(configSf);
  const aliases = collectLocalAliases(configSf);
  ts.forEachChild(configSf, (node) =>
    scanDefineSlots(node, imports, aliases, slots),
  );
  collectStateSlots(configSf, imports, aliases, slots);
  collectDefaultConfigSlots(configSf, imports, aliases, slots);
  for (const [rel, source] of input.moduleFiles) {
    const sf = ts.createSourceFile(
      rel,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const moduleImports = collectImportBindings(sf, (spec) =>
      resolveSourceFor(rel, spec),
    );
    const moduleAliases = collectLocalAliases(sf);
    for (const stmt of sf.statements) {
      if (!ts.isExpressionStatement(stmt)) continue; // 只收顶层 define 语句
      scanDefineSlots(stmt, moduleImports, moduleAliases, slots);
    }
  }
  return slots;
}

/** 形态 A：export const state = { … } 初始化器（与求值侧同一棵树的源文） */
function collectStateSlots(
  sf: ts.SourceFile,
  imports: ReadonlyMap<string, EnumTypeSlot>,
  aliases: ReadonlyMap<string, string>,
  slots: Map<string, EnumTypeSlot[]>,
): void {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      continue;
    for (const decl of stmt.declarationList.declarations) {
      const initializer = decl.initializer;
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === "state" &&
        initializer !== undefined &&
        ts.isObjectLiteralExpression(unwrapExpr(initializer))
      ) {
        collectFromValue(unwrapExpr(initializer), "", imports, aliases, slots);
      }
    }
  }
}

/** default 对象形态：export default { … } satisfies … —— state 字段内递归回收槽位 */
function collectDefaultConfigSlots(
  sf: ts.SourceFile,
  imports: ReadonlyMap<string, EnumTypeSlot>,
  aliases: ReadonlyMap<string, string>,
  slots: Map<string, EnumTypeSlot[]>,
): void {
  for (const stmt of sf.statements) {
    if (!ts.isExportAssignment(stmt)) continue;
    const expr = ts.isSatisfiesExpression(stmt.expression)
      ? stmt.expression.expression
      : stmt.expression;
    const obj = unwrapExpr(expr);
    if (!ts.isObjectLiteralExpression(obj)) continue;
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name))
        continue;
      if (prop.name.text === "state") {
        collectFromValue(prop.initializer, "", imports, aliases, slots);
      }
    }
  }
}

/** 从一个节点起找 define 调用（config 全树 / 模块顶层语句两用） */
function scanDefineSlots(
  node: ts.Node,
  imports: ReadonlyMap<string, EnumTypeSlot>,
  aliases: ReadonlyMap<string, string>,
  slots: Map<string, EnumTypeSlot[]>,
): void {
  const visit = (current: ts.Node): void => {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "define" &&
      current.arguments.length >= 1
    ) {
      const [first, second] = current.arguments;
      if (second !== undefined && ts.isStringLiteral(first)) {
        // define("a.b", value)：value 从该点路径起折叠
        collectFromValue(
          unwrapExpr(second),
          first.text,
          imports,
          aliases,
          slots,
        );
      } else if (ts.isObjectLiteralExpression(unwrapExpr(first))) {
        // define({ a: { b: … } })：从根起递归折叠
        collectFromValue(unwrapExpr(first), "", imports, aliases, slots);
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

/**
 * 模块 import 说明符 → 源根相对路径；相对结果统一带 "./" 前缀，
 * 与包导入（原样保留）在渲染层的换算分支区分开。
 */
function resolveSourceFor(rel: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const resolved = posix.normalize(posix.join(posix.dirname(rel), specifier));
  return resolved.startsWith(".") ? resolved : `./${resolved}`;
}

/** 解包 `as const` / 括号包裹（求值语义等价于内层字面量，AST 侧按内层收集） */
function unwrapExpr(expr: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expr) ||
    ts.isParenthesizedExpression(expr) ||
    ts.isTypeAssertionExpression(expr)
  ) {
    return unwrapExpr(expr.expression);
  }
  return expr;
}

/** 从一个「嵌套分支或 descriptor」值起递归折叠点路径，遇 descriptor 形登记槽位 */
function collectFromValue(
  valueExpr: ts.Expression,
  path: string,
  imports: ReadonlyMap<string, EnumTypeSlot>,
  aliases: ReadonlyMap<string, string>,
  slots: Map<string, EnumTypeSlot[]>,
): void {
  const value = unwrapExpr(valueExpr);
  if (!ts.isObjectLiteralExpression(value)) return;
  if (isDescriptorShape(value)) {
    recordTypeSlot(value, path, imports, aliases, slots);
    return; // descriptor 是叶，不再下钻
  }
  for (const prop of value.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue;
    const key = prop.name.text;
    collectFromValue(
      prop.initializer,
      path === "" ? key : `${path}.${key}`,
      imports,
      aliases,
      slots,
    );
  }
}

/** descriptor 形 = 含 "type"/"default" 具名属性的普通对象字面量（不安全形态不识别） */
function isDescriptorShape(obj: ts.ObjectLiteralExpression): boolean {
  let named = false;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) return false;
    if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
      return false;
    }
    if (prop.name.text === "type" || prop.name.text === "default") named = true;
  }
  return named;
}

function recordTypeSlot(
  obj: ts.ObjectLiteralExpression,
  path: string,
  imports: ReadonlyMap<string, EnumTypeSlot>,
  aliases: ReadonlyMap<string, string>,
  slots: Map<string, EnumTypeSlot[]>,
): void {
  if (path === "") return; // 根级路径与合并树键不可能对齐（求值侧同样不产空键）
  const typeProp = obj.properties.find(
    (prop): prop is ts.PropertyAssignment =>
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "type",
  );
  if (typeProp === undefined) return;
  const init = unwrapExpr(typeProp.initializer);
  if (ts.isIdentifier(init)) {
    const slot = resolveTypeRef(init.text, imports, aliases);
    if (slot !== undefined) addSlot(path, slot, slots);
    return;
  }
  if (ts.isArrayLiteralExpression(init) && init.elements.length >= 2) {
    // 并集成员：逐元素回收枚举标识符并记成员下标（嵌套并集内的枚举不回收，走内联回退）
    init.elements.forEach((element, index) => {
      const expr = unwrapExpr(element);
      if (!ts.isIdentifier(expr)) return;
      const slot = resolveTypeRef(expr.text, imports, aliases);
      if (slot !== undefined)
        addSlot(path, { ...slot, memberIndex: index }, slots);
    });
  }
}

/** 同路径槽位累积：同位置首见胜（重复声明不漂移既有登记） */
function addSlot(
  path: string,
  slot: EnumTypeSlot,
  slots: Map<string, EnumTypeSlot[]>,
): void {
  const list = slots.get(path);
  if (list === undefined) {
    slots.set(path, [slot]);
    return;
  }
  if (list.some((existing) => existing.memberIndex === slot.memberIndex))
    return;
  list.push(slot);
}

function resolveTypeRef(
  name: string,
  imports: ReadonlyMap<string, EnumTypeSlot>,
  aliases: ReadonlyMap<string, string>,
): EnumTypeSlot | undefined {
  let cur = name;
  for (let hop = 0; hop <= MAX_ALIAS_HOPS; hop += 1) {
    const imported = imports.get(cur);
    if (imported !== undefined) return imported;
    const next = aliases.get(cur);
    if (next === undefined) return undefined;
    cur = next;
  }
  return undefined;
}

/** import 登记：default 与 named 都要（type-only 与值导入同等可用，只取类型） */
function collectImportBindings(
  sf: ts.SourceFile,
  resolveSource: (specifier: string) => string = (spec) => spec,
): Map<string, EnumTypeSlot> {
  const imports = new Map<string, EnumTypeSlot>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (clause === undefined) continue;
    const source = resolveSource(stmt.moduleSpecifier.text);
    if (clause.name !== undefined) {
      imports.set(clause.name.text, {
        localName: clause.name.text,
        importedName: "default",
        source,
      });
    }
    if (
      clause.namedBindings !== undefined &&
      ts.isNamedImports(clause.namedBindings)
    ) {
      for (const el of clause.namedBindings.elements) {
        imports.set(el.name.text, {
          localName: el.name.text,
          importedName: el.propertyName?.text ?? el.name.text,
          source,
        });
      }
    }
  }
  return imports;
}

/** 本地别名表（`const 性别 = Sex;` 一类；本地 enum 声明不登记——gen 不可引用它） */
function collectLocalAliases(sf: ts.SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (
        decl.initializer === undefined ||
        !ts.isIdentifier(decl.initializer)
      ) {
        continue;
      }
      aliases.set(decl.name.text, decl.initializer.text);
    }
  }
  return aliases;
}
