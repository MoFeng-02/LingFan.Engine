/**
 * 历史容量上限的装配期校验：正整数才放行，非法降级到内建默认并标记需诊断。
 *
 * 为什么需要校验：上限直接决定检查点序列的增长边界——NaN / 0 / 负数 / 非整数一旦
 * 穿透，容量淘汰会失效（历史无限增长）或行为异常。装配期把非法值挡在默认值上，并
 * 如实标记（不静默吞），由装配层据此发诊断，宿主据此修正工程配置。
 */

/** 内建历史容量默认值（缺省与非法时的回落点） */
export const DEFAULT_HISTORY_LIMIT = 200;

/** 校验结果：limit = 实际采用的正整数上限；degraded = 入参非法被降级（需诊断） */
export interface HistoryLimitResolution {
  limit: number;
  degraded: boolean;
}

/**
 * 把宿主传入的上限规范化为正整数：缺省取默认；NaN / 非有限 / 非整数 / ≤0 降级到
 * 默认 200 并置 degraded。纯函数（同入参同结果），不抛——degraded 交给装配层发诊断。
 * 缺省（undefined）是正常取默认，不算降级，不触发诊断。
 */
export function clampHistoryLimit(
  raw: number | undefined,
): HistoryLimitResolution {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return { limit: raw, degraded: false };
  }
  return { limit: DEFAULT_HISTORY_LIMIT, degraded: raw !== undefined };
}
