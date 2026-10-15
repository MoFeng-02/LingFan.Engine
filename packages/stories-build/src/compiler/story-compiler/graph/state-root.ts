/**
 * 状态根名发现（SSOT）：全树唯一的 `export declare const <根名>: StoryState`
 * （或 ambient 桥 `declare global { var <根名>: StoryState }`，注解均可是本文件
 * type 别名链）决定源侧状态前缀，转译剥根按该名进行。无声明回退 DEFAULT_STATE_ROOT；
 * 根名与词函数冲突、或多个异名声明并存 → fail-closed 诊断（定位声明处）。
 */
import * as ts from "typescript";
import { DEFAULT_STATE_ROOT, WORD_NAMES } from "./core.ts";
import type { DiagBag, ModuleRecord } from "./core.ts";

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
