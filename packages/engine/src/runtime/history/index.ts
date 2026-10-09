/**
 * 历史子层出口：检查点快照与回溯控制。
 *
 * 执行器与运行层内部模块从这里取检查点与回溯成员；子层各文件之间仍按需直接引用。
 * 这里只做转发，不放任何实现。
 */
export {
  autoSaveAtCheckpoint,
  checkpointCoord,
  commitCheckpoint,
  flushPendingCheckpoint,
  restore,
  takeSnapshot,
} from "./snapshot";
export {
  back,
  columnFrame,
  columnFrameAt,
  forward,
  historyCursor,
  historyLength,
  historyView,
  isCurrentColumnReplayable,
  lastReplayableCursor,
  rollbackTo,
} from "./rollback";
