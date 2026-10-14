import * as ts from "typescript";
import { scanEnum } from "./fold";
import { DEFAULT_STATE_ROOT, WORD_NAMES } from "./core";
import type { Binding, DiagBag, ModuleRecord } from "./core";

/**
 * node_modules 值导入的本地名登记：扫描期即收集（scanConstStatement
 * 先于第二遍导入解析运行，const 初始化链的专用提示在登记时就要可用）。是否放行
 * 该导入由 resolveImports 依求值喂入决定；`import type` 与纯类型元素不登记。
 */
function collectNpmNames(
  record: ModuleRecord,
  imp: ts.ImportDeclaration,
): void {
  const spec = ts.isStringLiteral(imp.moduleSpecifier)
    ? imp.moduleSpecifier.text
    : "";
  if (
    spec.startsWith(".") ||
    spec === "@lingfan/editor" ||
    spec === "@lingfan/engine"
  )
    return;
  const clause = imp.importClause;
  if (clause === undefined || clause.isTypeOnly) return;
  if (clause.name !== undefined) record.npmNames.add(clause.name.text);
  if (
    clause.namedBindings !== undefined &&
    ts.isNamespaceImport(clause.namedBindings)
  ) {
    record.npmNames.add(clause.namedBindings.name.text);
  }
  if (
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings)
  ) {
    for (const el of clause.namedBindings.elements) {
      if (el.isTypeOnly) continue;
      record.npmNames.add(el.propertyName?.text ?? el.name.text);
    }
  }
}

export function scanModule(record: ModuleRecord, diags: DiagBag): void {
  const { sf, rel } = record;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      record.imports.push(stmt);
      collectNpmNames(record, stmt);
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      if (
        stmt.moduleSpecifier !== undefined ||
        stmt.exportClause === undefined ||
        !ts.isNamedExports(stmt.exportClause)
      ) {
        diags.add(rel, sf, stmt, "转发导出不支持：请直接从来源模块导入");
        continue;
      }
      for (const el of stmt.exportClause.elements) {
        const wanted = el.propertyName?.text ?? el.name.text;
        const binding = record.bindings.get(wanted);
        if (binding === undefined) {
          diags.add(rel, sf, el, `本地未声明 \`${wanted}\`，无法导出`);
          continue;
        }
        record.exports.set(el.name.text, binding);
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      if (stmt.isExportEquals) {
        diags.add(rel, sf, stmt, "不支持 export = 形式");
        continue;
      }
      if (
        ts.isFunctionDeclaration(stmt.expression) &&
        stmt.expression.name !== undefined &&
        stmt.expression.body !== undefined
      ) {
        record.story = {
          name: stmt.expression.name.text,
          node: stmt.expression,
        };
      } else {
        diags.add(
          rel,
          sf,
          stmt,
          "default 导出必须是具名函数声明：export default function 名字() { … }",
        );
      }
      continue;
    }
    if (ts.isFunctionDeclaration(stmt)) {
      if (stmt.name === undefined) continue;
      const hasDefault =
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ??
        false;
      if (hasDefault) {
        if (stmt.body === undefined) {
          diags.add(
            rel,
            sf,
            stmt,
            "default 导出必须是具名函数声明：export default function 名字() { … }",
          );
          continue;
        }
        record.story = { name: stmt.name.text, node: stmt };
        continue;
      }
      if (stmt.body === undefined) {
        const declared: Binding = { kind: "declare", name: stmt.name.text };
        record.bindings.set(stmt.name.text, declared);
        if (
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          record.exports.set(stmt.name.text, declared);
        }
        continue;
      }
      const binding: Binding = {
        kind: "function",
        file: rel,
        name: stmt.name.text,
      };
      record.functions.set(stmt.name.text, stmt);
      record.bindings.set(stmt.name.text, binding);
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        record.exports.set(stmt.name.text, binding);
      }
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) {
      const members = scanEnum(stmt, sf, diags, rel);
      if (members === null) continue;
      const binding: Binding = {
        kind: "enum",
        file: rel,
        name: stmt.name.text,
        members,
      };
      record.bindings.set(stmt.name.text, binding);
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        record.exports.set(stmt.name.text, binding);
      }
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      record.consts.push(stmt);
      continue;
    }
    if (ts.isExpressionStatement(stmt) && isBuildDefineStatement(stmt)) {
      continue; // 构建期 define 语句：由模块层收集器求值合并，图谱层不展开
    }
    if (
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isModuleDeclaration(stmt) ||
      stmt.kind === ts.SyntaxKind.ImportEqualsDeclaration
    ) {
      continue;
    }
    diags.add(
      rel,
      sf,
      stmt,
      "模块层不支持此语句：只允许 const/函数/enum/导入/类型声明/default 导出与构建期 define",
    );
  }
}

/** 顶层 `define(…)` 表达式语句（构建期合并树词；参数合法性由收集器判定） */
function isBuildDefineStatement(stmt: ts.ExpressionStatement): boolean {
  return (
    ts.isCallExpression(stmt.expression) &&
    ts.isIdentifier(stmt.expression.expression) &&
    stmt.expression.expression.text === "define"
  );
}

const STATE_ROOT_ANNOTATION = "StoryState";
const MAX_ALIAS_HOPS = 10;

interface StateRootCandidate {
  rel: string;
  sf: ts.SourceFile;
  node: ts.Node;
  name: string;
}

/** 本文件 type 别名表：别名 → 目标注解文本（仅无限定标识符；限定名与复合类型不是候选注解） */
function collectStateAliases(sf: ts.SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue;
    const target =
      ts.isTypeReferenceNode(stmt.type) && ts.isIdentifier(stmt.type.typeName)
        ? stmt.type.typeName.text
        : undefined;
    if (target !== undefined) aliases.set(stmt.name.text, target);
  }
  return aliases;
}

function resolvesToStateAnnotation(
  name: string,
  aliases: ReadonlyMap<string, string>,
): boolean {
  let cur = name;
  for (let hop = 0; hop <= MAX_ALIAS_HOPS; hop += 1) {
    if (cur === STATE_ROOT_ANNOTATION) return true;
    const next = aliases.get(cur);
    if (next === undefined) return false;
    cur = next;
  }
  return false;
}

/** 单声明的状态根判形：恰一声明、标识符名、标识符 TypeReference 注解且解析到 StoryState */
function stateRootDeclaration(
  stmt: ts.VariableStatement,
  aliases: ReadonlyMap<string, string>,
): { name: string; decl: ts.VariableDeclaration } | undefined {
  if (stmt.declarationList.declarations.length !== 1) return undefined;
  const decl = stmt.declarationList.declarations[0];
  if (!ts.isIdentifier(decl.name) || decl.type === undefined) return undefined;
  const annotation =
    ts.isTypeReferenceNode(decl.type) && ts.isIdentifier(decl.type.typeName)
      ? decl.type.typeName.text
      : undefined;
  if (
    annotation === undefined ||
    !resolvesToStateAnnotation(annotation, aliases)
  ) {
    return undefined;
  }
  return { name: decl.name.text, decl };
}

/**
 * 状态根候选扫描：两种拼写都算声明——
 * 1. 顶层 `export declare const <根名>: StoryState`（直接形态）；
 * 2. ambient 全局增补块 `declare global { var <根名>: StoryState }`（桥文件形态：
 *    根名不进模块作用域，只挂全局，供运行期裸名访问；块内无需 export/declare 修饰）。
 */
function scanStateRootCandidates(
  rel: string,
  sf: ts.SourceFile,
): StateRootCandidate[] {
  const candidates: StateRootCandidate[] = [];
  const aliases = collectStateAliases(sf);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const modifiers = stmt.modifiers ?? [];
    if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      continue;
    if (!modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword))
      continue;
    const found = stateRootDeclaration(stmt, aliases);
    if (found === undefined) continue;
    candidates.push({ rel, sf, node: found.decl, name: found.name });
  }
  for (const stmt of sf.statements) {
    // declare global 的名字节点是普通 Identifier（"global"），用 GlobalAugmentation
    // 旗标判别增补块（TS 6.0 AST：name.kind 仍为 Identifier）。
    if (!ts.isModuleDeclaration(stmt)) continue;
    if ((stmt.flags & ts.NodeFlags.GlobalAugmentation) === 0) continue;
    if (stmt.body === undefined || !ts.isModuleBlock(stmt.body)) continue;
    for (const inner of stmt.body.statements) {
      if (!ts.isVariableStatement(inner)) continue;
      const found = stateRootDeclaration(inner, aliases);
      if (found === undefined) continue;
      candidates.push({ rel, sf, node: found.decl, name: found.name });
    }
  }
  return candidates;
}

/**
 * 状态根名发现（SSOT）：全树唯一的 `export declare const <根名>: StoryState`（或 ambient
 * 桥 `declare global { var <根名>: StoryState }`，注解均可是本文件 type 别名链）决定源侧
 * 状态前缀，转译剥根按该名进行。无声明回退 DEFAULT_STATE_ROOT；根名与词函数冲突、或多个
 * 异名声明并存 → fail-closed 诊断（定位声明处）。
 */
export function discoverStateRoot(
  records: ReadonlyMap<string, ModuleRecord>,
  diags: DiagBag,
): string {
  const found: StateRootCandidate[] = [];
  for (const record of records.values()) {
    found.push(...scanStateRootCandidates(record.rel, record.sf));
  }
  const byName = new Map<string, StateRootCandidate>();
  for (const candidate of found) {
    if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
  }
  if (byName.size === 0) return DEFAULT_STATE_ROOT;
  if (byName.size > 1) {
    const names = [...byName.keys()]
      .sort()
      .map((n) => `\`${n}\``)
      .join("、");
    for (const candidate of byName.values()) {
      diags.add(
        candidate.rel,
        candidate.sf,
        candidate.node,
        `状态根声明不唯一（${names}）：只允许一个 \`export declare const <根名>: ${STATE_ROOT_ANNOTATION}\`（ambient 桥为 \`var <根名>: ${STATE_ROOT_ANNOTATION}\`）`,
      );
    }
    return DEFAULT_STATE_ROOT;
  }
  const [name, candidate] = [...byName.entries()][0];
  if (WORD_NAMES.has(name)) {
    diags.add(
      candidate.rel,
      candidate.sf,
      candidate.node,
      `状态根名 \`${name}\` 与词汇层词函数冲突：请另选标识符（\`export declare const <根名>: ${STATE_ROOT_ANNOTATION}\`）`,
    );
  }
  return name;
}
