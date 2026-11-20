/**
 * 机器级持久数据的信任边界与已读读写（纯函数，core 零 DOM）。
 *
 * hydrate 逐项校验降级：非法的列/下标忽略，绝不补默认——「没读过」与「读过了」
 * 是两种事实，缺省空集合不等于伪造已读。seen 读写都返回新对象（不可变），
 * 快照/落盘各自持有独立引用，互不串改。
 */
import {
  EMPTY_PERSISTENT,
  type ColumnCoordinate,
  type PersistentData,
  type SeenRecord,
} from "../contracts/index.ts";

/** 单列已读下标上限（防恶意/损坏载荷撑爆内存；超出截断，与键位封顶同口径） */
const SEEN_INDEX_MAX = 100000;

/** 校验一个已读下标：非负安全整数才合法 */
function isSeenIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= SEEN_INDEX_MAX
  );
}

/** 规整一列的已读下标：剔非法、去重、升序（返回新数组） */
function normalizeIndices(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const entry of raw) {
    if (isSeenIndex(entry)) set.add(entry);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 载荷信任边界：只认 v:1；seen 逐列校验降级（非法列忽略、非法下标剔除）。
 * 非法/缺失载荷回落空持久数据（不伪造已读）；合法部分原样保留。
 */
export function hydratePersistent(raw: unknown): PersistentData {
  if (raw === null || typeof raw !== "object") {
    return { v: 1, seen: {} };
  }
  const source = raw as Record<string, unknown>;
  if (source.v !== 1) return { v: 1, seen: {} };
  const seen: SeenRecord = {};
  const rawSeen = source.seen;
  if (rawSeen !== null && typeof rawSeen === "object") {
    for (const [columnId, indices] of Object.entries(
      rawSeen as Record<string, unknown>,
    )) {
      if (columnId.length === 0) continue;
      const normalized = normalizeIndices(indices);
      if (normalized.length > 0) seen[columnId] = normalized;
    }
  }
  return { v: 1, seen };
}

/** 该 say 坐标是否已读（列缺席或下标不在集合 = 未读） */
export function isSeen(seen: SeenRecord, coord: ColumnCoordinate): boolean {
  const indices = seen[coord.columnId];
  return indices !== undefined && indices.includes(coord.index);
}

/** 记一个 say 坐标为已读（返回新 seen；已读则原样返回，不重复写入） */
export function markSeen(
  seen: SeenRecord,
  coord: ColumnCoordinate,
): SeenRecord {
  if (!isSeenIndex(coord.index)) return seen;
  const indices = seen[coord.columnId];
  if (indices !== undefined && indices.includes(coord.index)) return seen;
  const next = normalizeIndices([...(indices ?? []), coord.index]);
  return { ...seen, [coord.columnId]: next };
}

/** 合并两份已读（取并集；hydrate 竞态下内存已读与落盘已读都不丢） */
export function mergeSeen(a: SeenRecord, b: SeenRecord): SeenRecord {
  const out: SeenRecord = { ...a };
  for (const [columnId, indices] of Object.entries(b)) {
    out[columnId] = normalizeIndices([...(out[columnId] ?? []), ...indices]);
    if (out[columnId].length === 0) delete out[columnId];
  }
  return out;
}

/** 空持久数据的独立副本（内存基线；避免共享 EMPTY_PERSISTENT 引用被串改） */
export function emptyPersistent(): PersistentData {
  return { v: EMPTY_PERSISTENT.v, seen: {} };
}
