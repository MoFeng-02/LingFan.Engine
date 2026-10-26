/**
 * 词汇层声明生成器（纯函数：无 fs、无副作用、无控制台输出）。
 *
 * 两个真相源在渲染时合流成一份机器可读声明（vocabulary.g.ts，由同目录
 * generate-vocabulary.ts 重建），词表不再手写双份：
 * - **op 注册表**（OP_SCHEMA_MAP 键集）→ `VOCABULARY_OPS`：注册表面的单一快照；
 * - **words 域源码扫描**：返回注解为 `CommandOf<"op">` 的导出函数 = 直接词条。
 * 不产独立 op 的导出词（复合词、菜单项、扩展出口等）走 `HELPER_WORDS` 显式补充表，
 * 缺登记 = fail-closed（抛错），新词不可能静默漏网。
 */
import * as ts from "typescript";

/** 单个被扫描源文件（file = 展示与分组用短名，text = 全文） */
export interface VocabSource {
  readonly file: string;
  readonly text: string;
}

/** 扫描出的直接词条（builder ↔ op） */
export interface DirectEntry {
  readonly builder: string;
  readonly op: string;
  readonly file: string;
}

/** 扫描名单的排除集：barrel 出口 + 两处非词汇词文件
 * （cells = 具名实现槽位、compile-time = 编译期构造，都不产词汇词）。 */
const SKIP_FILES = new Set(["index.ts", "cells.ts", "compile-time.ts"]);

/** 扫描名单规则（重建 CLI 与新鲜度测试共用，规则只有这一份） */
export function selectWordSources(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((f) => f.endsWith(".ts") && !SKIP_FILES.has(f))
    .sort();
}

/** 辅助词补充表：words 域里不产独立 op 的导出词。
 *  `$` 前缀 = 互锁比较跳过标记；新增辅助词必须在此登记，
 *  未登记的新导出词会让重建失败（见 renderVocabulary 的缺登记核对）。 */
export const HELPER_WORDS: Readonly<Record<string, string>> = {
  option: "$menu.option",
  inputCandidate: "$input.candidate",
  whenChain: "$if.chain",
  reward: "$minigame.reward",
  extOp: "$ext.op",
  sceneSetup: "$composite.scene",
  buttonElement: "$composite.button",
  textElement: "$composite.text",
  imageElement: "$composite.image",
  sceneType: "$column.type",
};

/** 返回注解是否为 CommandOf<"op"> 字面量形态，是则取 op 名 */
function commandOfOpName(
  returnType: ts.TypeNode | undefined,
): string | undefined {
  if (!returnType || !ts.isTypeReferenceNode(returnType)) return undefined;
  if (
    !ts.isIdentifier(returnType.typeName) ||
    returnType.typeName.text !== "CommandOf"
  ) {
    return undefined;
  }
  const arg = returnType.typeArguments?.[0];
  if (!arg || !ts.isLiteralTypeNode(arg) || !ts.isStringLiteral(arg.literal)) {
    return undefined;
  }
  return arg.literal.text;
}

function isExportedFunction(
  node: ts.Statement,
): node is ts.FunctionDeclaration {
  if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) return false;
  return (
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

/** 扫描直接词条：导出函数中返回注解为 `CommandOf<"op">` 者。
 *  同一 op 被两个 builder 声明 = 抛错（双射面不允许一 op 多词）。 */
export function scanDirectBuilders(
  sources: readonly VocabSource[],
): DirectEntry[] {
  const entries: DirectEntry[] = [];
  const opOwner = new Map<string, string>();
  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    for (const node of sf.statements) {
      // FunctionDeclaration.name 可选：谓词收窄不含「名字存在」，此处再核一次
      if (!isExportedFunction(node) || !node.name) continue;
      const op = commandOfOpName(node.type);
      if (op === undefined) continue;
      const builder = node.name.text;
      const clash = opOwner.get(op);
      if (clash !== undefined) {
        throw new Error(
          `op "${op}" 被两个 builder 声明：${clash} 与 ${builder}（${file}）`,
        );
      }
      opOwner.set(op, builder);
      entries.push({ builder, op, file });
    }
  }
  return entries;
}

/** 扫描 words 域全部导出函数名（辅助词核对用） */
export function scanExportedFunctionNames(
  sources: readonly VocabSource[],
): Set<string> {
  const names = new Set<string>();
  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    for (const node of sf.statements) {
      if (!isExportedFunction(node) || !node.name) continue;
      names.add(node.name.text);
    }
  }
  return names;
}

/** 渲染词汇层声明全文（与入库存量逐字节比对的就是这个输出）。
 *  三处不一致都会抛错而非静默产出：
 *  - 词条 op 不在注册表快照（词先于 schema）；
 *  - 补充表登记了不存在的导出函数（幽灵登记）；
 *  - words 域出现既非直接词条也无补充条目的导出函数（漏登记）。 */
export function renderVocabulary(
  registryKeys: readonly string[],
  sources: readonly VocabSource[],
): string {
  const direct = scanDirectBuilders(sources);
  const unknownOps = direct
    .map((e) => e.op)
    .filter((op) => !registryKeys.includes(op));
  if (unknownOps.length > 0) {
    throw new Error(
      `词条产出注册表快照之外的 op：${unknownOps.join(", ")}——先在 OP_SCHEMA_MAP 登记再重建`,
    );
  }
  const exported = scanExportedFunctionNames(sources);
  const ghostHelpers = Object.keys(HELPER_WORDS).filter(
    (b) => !exported.has(b),
  );
  if (ghostHelpers.length > 0) {
    throw new Error(
      `辅助词补充表登记了不存在的导出函数：${ghostHelpers.join(", ")}`,
    );
  }
  const missingHelpers = [...exported].filter(
    (b) => !direct.some((e) => e.builder === b) && !(b in HELPER_WORDS),
  );
  if (missingHelpers.length > 0) {
    throw new Error(
      `words 域存在未登记的导出函数（既非直接词条也无补充表条目）：${missingHelpers.join(", ")}`,
    );
  }

  const lines: string[] = [
    "/**",
    " * 生成文件：词汇层声明（勿手改）。",
    " *",
    " * 由 packages/editor/src/script/generate-vocabulary.ts 重建（两个真相源）：",
    " * - OP_SCHEMA_MAP 键快照 → VOCABULARY_OPS（op 注册表面的单一来源）；",
    " * - words/*.ts 导出函数扫描 → SCRIPT_COVERAGE（builder ↔ op 双射面，",
    ' *   返回注解 CommandOf<"op"> = 直接词条；不产独立 op 的走补充表）。',
    " * 手改会在下次重建时被覆盖；改注册表/词条后未重建 =",
    " * tests/editor/script-vocabulary.test.ts 的生成物新鲜度用例红。",
    " */",
    "",
    "/** op 注册表键快照（与 OP_SCHEMA_MAP 键集恒等；排序保证 diff 稳定） */",
    "export const VOCABULARY_OPS = [",
  ];
  for (const op of [...registryKeys].sort()) {
    lines.push(`  "${op}",`);
  }
  lines.push(
    "] as const;",
    "",
    "/** op 名字面量联合（快照派生，与 ScriptOpName 同键集） */",
    "export type VocabularyOp = (typeof VOCABULARY_OPS)[number];",
    "",
    "/**",
    " * builder ↔ op 双射面（词汇层互锁守卫的数据源）。",
    " * `$` 前缀 = 辅助词（不直接产出独立 op）——互锁比较时跳过。",
    " */",
    "export const SCRIPT_COVERAGE: Readonly<Record<string, string>> = {",
  );
  let lastFile = "";
  for (const { builder, op, file } of direct) {
    if (file !== lastFile) {
      lines.push(`  // —— ${file} ——`);
      lastFile = file;
    }
    lines.push(`  ${builder}: "${op}",`);
  }
  lines.push("  // —— 辅助词（补充表登记，不产独立 op） ——");
  for (const [builder, op] of Object.entries(HELPER_WORDS)) {
    lines.push(`  ${builder}: "${op}",`);
  }
  lines.push("};", "");
  return lines.join("\n");
}
