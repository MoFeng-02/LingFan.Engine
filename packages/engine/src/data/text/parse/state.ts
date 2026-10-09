/** 读向解析的共享状态与分发上下文：行表、错误/警告两级通道、源名与扩展投影表。 */
import type { SourceLine } from "../lexer";
import type { CustomOpProjections } from "../../../contracts";

export interface ParseState {
  lines: SourceLine[];
  issues: string[];
  /**
   * **警告级问题**：「语义暂未生效」类提示，**不阻塞解析**。
   *
   * 为什么要分两级：若**任何** issue 都让整文件拒绝（`issues.length > 0` 即抛），
   * 于是「`say` 的 color 暂未生效」这种**如实告知**也会让整个工程打不开——
   * 惩罚大于收益。分级口径：
   * - `issues` = **结构/语法错误** ⇒ fail-closed（数据不可信，不能猜）
   * - `warnings` = **语义未落地** ⇒ 照常解析，但要让人看见
   */
  warnings: string[];
  sourceName: string;
  /** 扩展投影：自定义 op 行的分发表（缺省 undefined = 现行为不变） */
  projections?: CustomOpProjections;
}

/**
 * 单命令行语句的解析上下文：`parseSimpleStatement` 的入参、定位闭包与失败出口，
 * 一次性交给各 op 族文件，避免每个族各写一份取词与定位逻辑。
 */
export interface StatementContext {
  op: string;
  rest: string;
  tokens: string[];
  at: string;
  issues: string[];
  /** 警告级问题（不阻塞解析）；缺省 = 无处可投 */
  warnings?: string[];
  /** 记一条 issue 并返回 null（各族的统一失败出口） */
  fail(message: string): null;
  /** 取第 index 个已去引号的参数（越界 = 空串） */
  quoted(index: number): string;
}
