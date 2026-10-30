/**
 * 编译期求值接入段（编排层）：扫描源清单，把含 node_modules 值导入的文件
 * 整体交给 const-eval 求值，产出「文件 → 导出名 → JSON 值」喂给 story-compiler 内联。
 *
 * 触发判据（npm 值导入边界）：静态 import 的模块说明符非相对路径、非 @lingfan-engine/editor、
 * 非 @lingfan-engine/core，且存在值绑定（default / 命名空间 / 任一非 type 具名绑定）。
 * `import type` 整句编译期擦除，不触发求值；副作用导入同样不触发（图谱层自有
 * fail-closed 诊断）。
 *
 * 能展开成工程 `paths` 别名的说明符也不算 npm 值导入：别名指向的是工程内的文件，
 * 由图谱层按普通模块连边。这里只问一次解析器（「有模式命中吗」），不判存在性与越界——
 * 那两类错误由图谱层给出各自的诊断，本段提前拦会把别名笔误误报成 npm 导入。
 *
 * fail-closed（一次报全部）：
 * - 故事文件含 node_modules 值导入 → 定向诊断（求值器只作用于纯模块；故事文件的
 *   default 函数导出必然不可序列化，npm 值请收敛为纯模块的导出 const 再相对导入）；
 * - 求值诊断（不可序列化导出 / 顶层抛错 / 超时 / esbuild 失败）→ 原样透传；
 * - 双求值不一致（E13 确定性闸门，逐键 deepEqual）内建于 evalConstModule，诊断同此透传。
 *
 * 注意：被求值文件整体求值，因此不得再导出函数/类等非序列化值——请把函数与
 * node_modules 值分模块放置（函数导出留在普通支撑模块）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { evalConstModule } from "./const-eval.ts";
import type { CompilerConstValues } from "../compiler/index.ts";
import {
  defaultStoriesBuildTexts,
  StoryBuildError,
  type StoriesBuildTexts,
} from "../shared/index.ts";
import { expandAlias, type PathsConfig } from "../pipeline/tsconfig-paths.ts";

/** 词汇层两包不触发求值：editor 是词汇出口（图谱层按词/命名空间绑定），engine 不参与创作导入。 */
const RESERVED_SPECS: ReadonlySet<string> = new Set([
  "@lingfan-engine/editor",
  "@lingfan-engine/core",
]);

interface NpmValueImport {
  spec: string;
  line: number;
  col: number;
}

function findNpmValueImports(
  rel: string,
  text: string,
  paths: PathsConfig | null,
): NpmValueImport[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const hits: NpmValueImport[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (spec.startsWith(".") || RESERVED_SPECS.has(spec)) continue;
    // 工程别名指向工程内文件，不是 npm 值：留给图谱层按普通模块连边。
    if (paths !== null && expandAlias(paths, spec).length > 0) continue;
    const clause = stmt.importClause;
    if (clause === undefined) continue; // 副作用导入：不触发求值（图谱层自有诊断）
    if (clause.isTypeOnly) continue; // import type：编译期擦除，不在 npm 值导入约束内
    const hasValueBinding =
      clause.name !== undefined ||
      (clause.namedBindings !== undefined &&
        (ts.isNamespaceImport(clause.namedBindings) ||
          (ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.some((el) => !el.isTypeOnly))));
    if (!hasValueBinding) continue;
    const pos = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
    hits.push({ spec, line: pos.line + 1, col: pos.character + 1 });
  }
  return hits;
}

/**
 * 求值段：返回喂给编译器的 constValues（无触发文件 = 空对象，行为与未接入一致）。
 * `paths` 为工程 `tsconfig.json` 的别名配置——别名说明符指向工程内文件，不算 npm 值导入。
 */
export async function runConstEvalPass(
  sourcesDir: string,
  storyFiles: readonly string[],
  moduleFiles: readonly string[],
  sourcesDirName: string,
  texts: StoriesBuildTexts = defaultStoriesBuildTexts,
  timeoutMs?: number,
  paths: PathsConfig | null = null,
): Promise<CompilerConstValues> {
  const storySet = new Set(storyFiles);
  const failures: string[] = [];
  const constValues: Record<string, Record<string, unknown>> = {};
  // 排序保证诊断顺序确定（同一份输入 ⇒ 同一份报告）。
  for (const rel of [...new Set([...storyFiles, ...moduleFiles])].sort()) {
    let text: string;
    try {
      text = readFileSync(join(sourcesDir, rel), "utf8");
    } catch {
      continue; // 文件消失等读取异常交由源发现/编译段按既有路径报错
    }
    const hits = findNpmValueImports(rel, text, paths);
    if (hits.length === 0) continue;
    if (storySet.has(rel)) {
      for (const hit of hits) {
        failures.push(
          texts.storyNpmValueImport(
            rel,
            hit.line,
            hit.col,
            hit.spec,
            sourcesDirName,
          ),
        );
      }
      continue;
    }
    const result = await evalConstModule(join(sourcesDir, rel), timeoutMs);
    if ("diags" in result) {
      failures.push(
        ...result.diags.map(
          (diag) =>
            `- ${formatConstDiagFile(diag.file, sourcesDir, sourcesDirName)}:${diag.line}:${diag.col} ${diag.message}`,
        ),
      );
      continue;
    }
    constValues[rel] = result.values;
  }
  if (failures.length > 0) {
    throw new StoryBuildError(
      `编译期求值失败（${failures.length} 条）：\n${failures.join("\n")}`,
    );
  }
  return constValues;
}

/** const-eval 诊断的 file 是绝对入口路径；归一为 `Stories.src/<rel>` 与其余诊断同构。 */
export function formatConstDiagFile(
  file: string,
  sourcesDir: string,
  sourcesDirName: string,
): string {
  const norm = file.replace(/\\/g, "/");
  const prefix = `${sourcesDir.replace(/\\/g, "/").replace(/\/$/, "")}/`;
  return norm.startsWith(prefix)
    ? `${sourcesDirName}/${norm.slice(prefix.length)}`
    : norm;
}
