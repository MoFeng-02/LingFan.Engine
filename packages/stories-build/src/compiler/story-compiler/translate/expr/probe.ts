/**
 * 引擎表达式文法探针：把候选文本交给引擎求值器试跑，判断是否落在引擎文法内。
 *
 * 探针只关心文法（`evaluateExpression` 抛错即不合法），结果按源串缓存——
 * 同一表达式在构建期会被反复试探，缓存是必须的（模块级单例，不可复制成两份）。
 */
import { evaluateExpression } from "@lingfan/engine";

const probeCache = new Set<string>();

/** 探针免检前缀：路径型内建的实参由编译器构造性生成（文法必然合法），运行期语义不归探针管 */
const PROBE_LENIENT = /^(arrayGet|dictGet|optGet|len)\(/;

export function probeExpression(src: string): boolean {
  if (probeCache.has(src) || PROBE_LENIENT.test(src)) return true;
  try {
    evaluateExpression(src, () => ({ found: true as const, value: 1 }));
    probeCache.add(src);
    return true;
  } catch {
    return false;
  }
}
