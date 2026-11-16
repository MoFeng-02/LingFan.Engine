/**
 * 函数闭包展开：把一列里被 `call`／被引用的函数按引用关系递归编译出来。
 *
 * 闭包不是「文件里的全部函数」，而是「这一列真的会走到的那几个」——引用集合来自
 * 翻译阶段登记的 `refs`（函数体里出现的调用点），按工作列表推到不动点为止。
 * 单列编译与按需产列共用这一份实现，避免两处各写一遍「先 pop 再 push refs」。
 */
import type { DiagBag, Graph } from "../graph.ts";
import { compileFunction } from "./functions.ts";
import type { AssembleSession, CompiledFunction } from "./types.ts";

/**
 * 从若干函数键（`<文件>#<函数名>`）出发，展开成「键 → 编译产物」的完整闭包。
 *
 * 找不到声明或编译失败的条目直接跳过（诊断已在 `compileFunction` 内落到 `diags`），
 * 这样调用方只需关心成功的那部分，不需要区分「没这个函数」和「函数体有错」。
 */
export function expandClosure(
  session: AssembleSession,
  graph: Graph,
  diags: DiagBag,
  seeds: Iterable<string>,
): Map<string, CompiledFunction> {
  const closure = new Map<string, CompiledFunction>();
  const worklist = [...seeds];
  while (worklist.length > 0) {
    const key = worklist.pop()!;
    if (closure.has(key)) continue;
    const sep = key.indexOf("#");
    const file = key.slice(0, sep);
    const name = key.slice(sep + 1);
    const target = graph.records.get(file);
    const decl = target?.functions.get(name);
    if (target === undefined || decl === undefined) continue;
    const compiled = compileFunction(session, graph, diags, file, [], decl, []);
    if (compiled === undefined) continue;
    closure.set(key, compiled);
    worklist.push(...compiled.refs);
  }
  return closure;
}
