import * as ts from "typescript";
import { scanEnum } from "./fold.ts";
import type { Binding, DiagBag, ModuleRecord } from "./core.ts";

/**
 * 模块语句扫描：把单个 .ts 模块的顶层语句归类登记进 ModuleRecord
 * （导入/导出/函数/enum/const/构建期 define 与角色声明/故事 default 导出），
 * 遇到不支持的语句形态记诊断。状态根名发现独立在 ./state-root.ts。
 */

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
    if (ts.isExpressionStatement(stmt) && isBuildCharacterStatement(stmt)) {
      continue; // 构建期角色声明：由模块层收集器求值前置，图谱层不展开
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
      "模块层不支持此语句：只允许 const/函数/enum/导入/类型声明/default 导出、构建期 define 与构建期角色声明",
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

/** 顶层 `character(…)` 表达式语句（构建期角色声明；参数合法性由收集器判定） */
function isBuildCharacterStatement(stmt: ts.ExpressionStatement): boolean {
  return (
    ts.isCallExpression(stmt.expression) &&
    ts.isIdentifier(stmt.expression.expression) &&
    stmt.expression.expression.text === "character"
  );
}
