/**
 * 检查点快照的建立、恢复与落档。
 */
import { SYS, type ColumnCoordinate, type SaveDataV1 } from "../../contracts";
import { cloneFrame, sameCoord, type Checkpoint, type Frame, type OpContext } from "../internal";

/**
 * 检查点/存档坐标恒指「能重放重建本等待点」的列内顶层位置。
 * - 列帧等待点：index 尚未前移 → 即等待命令本身（读档/重放重新执行它）
 * - 块帧（if/while/func 体）等待点：所在列帧 index 已指向块进入命令的下一命令 → 回退一格 = 重入命令
 */
export function checkpointCoord(ctx: OpContext, waitingFrame: Frame): ColumnCoordinate {
  if (waitingFrame.columnId !== null) {
    return { columnId: waitingFrame.columnId, index: waitingFrame.index };
  }
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    const f = ctx.frames[i]!;
    if (f.columnId !== null) {
      return { columnId: f.columnId, index: Math.max(0, f.index - 1) };
    }
  }
  return { ...ctx.coord };
}

/** 快照捕获：状态 + rngState + 帧栈 + 函数表（Scope 深拷贝，回溯恢复后互不串扰） */
export function takeSnapshot(ctx: OpContext, coord: ColumnCoordinate): Checkpoint {
  return {
    coord,
    snapshot: {
      state: [...ctx.state.entries()],
      rngState: ctx.rngState,
      frames: ctx.frames.map(cloneFrame),
      coord: { ...ctx.coord },
      functions: [...ctx.functions.entries()],
    },
  };
}

/** 恢复快照：写时复制不变量使 state 浅拷贝安全；waiting 归零后由重放重新建立等待 */
export function restore(ctx: OpContext, cp: Checkpoint): void {
  ctx.state = new Map(cp.snapshot.state);
  ctx.rngState = cp.snapshot.rngState;
  ctx.frames = cp.snapshot.frames.map(cloneFrame);
  ctx.coord = { ...cp.snapshot.coord };
  ctx.functions = new Map(cp.snapshot.functions);
  ctx.pendingSay = null;
  // 回溯清挂起的 wait 定时器：重放若落在另一 wait 上，旧定时器不得提前双触发
  ctx.clearTimer();
  ctx.abortExternalTakeovers(); // 回溯打断外部接管：abort 挂载信号，重放重新挂载
  ctx.waitSkipable = false;
  ctx.liveCheckpointed = true; // 检查点 k 即当前 live 位置（重放中的等待点会自行改写）
  ctx.setSystem(SYS.waiting, "none");
}

/**
 * 提交检查点（分岔 + 容量淘汰）：
 * - 重取同坐标（回溯后重放推进）→ 原位替换，不动时间线
 * - 与前向时间线同坐标 → cursor 前移（rollforward 保留）
 * - 同列内介于 cursor 与下一检查点之间 → 新发现的中间站：插入（残缺历史自愈）
 * - 其余坐标不同 → 截断旧前向（重选≠ 旧选择 = 新时间线）
 *
 * **场景类型守卫**：`type !== "game"`
 * 的列（menu/ui）**不建检查点**——菜单/弹窗是「覆盖」，不是玩家经历的一步。
 */
export function commitCheckpoint(ctx: OpContext, cp: Checkpoint): void {
  // 非 game 场景不进历史（menu/ui 是覆盖层，不构成可回溯的一步）
  if (!ctx.isCurrentColumnReplayable()) return;
  const current = ctx.history[ctx.cursor];
  if (current !== undefined && sameCoord(current.coord, cp.coord)) {
    ctx.history[ctx.cursor] = cp;
    return;
  }
  if (ctx.cursor < ctx.history.length - 1) {
    const next = ctx.history[ctx.cursor + 1]!;
    if (sameCoord(next.coord, cp.coord)) {
      ctx.cursor += 1;
      ctx.history[ctx.cursor] = cp;
      return;
    }
    const previous = ctx.history[ctx.cursor]!;
    const sameColumn =
      previous !== undefined &&
      cp.coord.columnId === previous.coord.columnId &&
      cp.coord.columnId === next.coord.columnId;
    const between =
      cp.coord.index > previous.coord.index &&
      cp.coord.index < next.coord.index;
    if (sameColumn && between) {
      // 残缺历史自愈：重放重入的中间等待点（如 input）插入时间线，前向保留
      ctx.history.splice(ctx.cursor + 1, 0, cp);
      ctx.cursor += 1;
      return;
    }
    ctx.history.length = ctx.cursor + 1; // 开辟新时间线，旧前向作废
  }
  if (
    ctx.history.length >= ctx.historyLimit &&
    ctx.cursor === ctx.history.length - 1
  ) {
    ctx.history.shift(); // 容量淘汰最旧（未回溯状态下安全）
  }
  ctx.history.push(cp);
  ctx.cursor = ctx.history.length - 1;
}

/**
 * 存档点消费：等待画面建立（say 上屏 / menu / wait / input）= 玩家所见稳定点。
 * ①save op 的一次性声明（pendingSave）优先落档（一画面一写）；②auto_save 开关持续写专用
 * `auto` 槽。解除时提交（waiting=none）与重放期（rollbackActive）不触发；
 * 异步失败经 engine.error 可观测（不吞）。
 */
export function autoSaveAtCheckpoint(ctx: OpContext): void {
  if (ctx.rollbackActive) return;
  if (ctx.savePort === undefined) return;
  const waiting = ctx.get(SYS.waiting);
  if (waiting === undefined || waiting === "none") return;
  const pending = ctx.pendingSave;
  if (pending !== null) {
    ctx.pendingSave = null;
    const data = ctx.exportSave();
    if (data === null) return; // 不在等待点（理论不可达，防御；exportSave 已发错误）
    const payload: SaveDataV1 =
      pending.title === undefined ? data : { ...data, title: pending.title };
    void ctx.savePort
      .write(pending.slot, JSON.stringify(payload), ctx.saveMode)
      .catch((e: unknown) => {
        ctx.fail(
          "save-write-failed",
          `槽位 ${pending.slot} 写档失败：${String(e)}`,
        );
      });
    return; // pending 消费即本画面已写，不叠加 auto 写
  }
  if (ctx.get(SYS.autoSave) !== true) return;
  const data = ctx.exportSave();
  if (data === null) return;
  void ctx.savePort
    .write("auto", JSON.stringify(data), ctx.saveMode)
    .catch((e: unknown) => {
      ctx.fail("save-write-failed", `自动存档写入失败：${String(e)}`);
    });
}

/**
 * 补交规则：离开当前画面（回退/跳转）前，把已上屏未入档的 say 检查点补交入档。
 * 玩家所见画面即有效历史——入档后 forward 才能回到「离开时的位置」（否则回退后前进无路）。
 */
export function flushPendingCheckpoint(ctx: OpContext): void {
  if (ctx.pendingSay !== null) {
    ctx.commitCheckpoint(ctx.pendingSay);
    ctx.pendingSay = null;
    ctx.liveCheckpointed = true;
  }
}
