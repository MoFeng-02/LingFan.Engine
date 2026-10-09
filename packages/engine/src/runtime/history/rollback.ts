/**
 * 历史回溯：游标移动、可达性判定与历史视图。
 */
import { SYS, isReplayableColumn, type ColumnCoordinate } from "../../contracts";
import { snapshotText, type Frame, type OpContext } from "../internal";
import { Scope } from "../scope";
import { restore } from "./snapshot";

/**
 * 找到「最后一个可回溯坐标」的历史游标（菜单态存档时用）。
 *
 * 为什么需要：菜单期间**不建检查点**（见 `commitCheckpoint` 守卫），
 * 但 `cursor` 仍可能停在菜单之前那个坐标上——直接用它会把菜单产生的
 * **前向时间线截断**语义带进档里。取「最后一个坐标属可回溯列」的检查点，
 * 保证档里的历史**只含玩家真正走过的游戏步骤**。
 *
 * 找不到（历史为空/全在菜单列）⇒ 返回 `null`（调用方按「无历史」处理）。
 */
export function lastReplayableCursor(ctx: OpContext): number | null {
  for (let i = Math.min(ctx.cursor, ctx.history.length - 1); i >= 0; i -= 1) {
    const cp = ctx.history[i];
    if (cp === undefined) continue;
    const column = ctx.columnById(cp.coord.columnId);
    if (column !== undefined && isReplayableColumn(column)) return i;
  }
  return null;
}

/**
 * 当前列是否参与历史/存档（`type` 缺省 = game ⇒ 参与）。
 *
 * **单一判定点**：`isReplayableColumn` 来自契约，引擎守卫与编辑器分组
 * 共用它——**不各写一份**（两份判据必然漂移）。
 */
export function isCurrentColumnReplayable(ctx: OpContext): boolean {
  const columnId = ctx.coord.columnId;
  if (columnId === "") return true; // 尚未进入任何列（启动期）⇒ 视为可回溯
  const column = ctx.columnById(columnId);
  // 列不存在（热重载后坐标失效等）⇒ **不拦**（保持既有行为：让流程自己 fail-closed 报错）
  if (column === undefined) return true;
  return isReplayableColumn(column);
}

/** 当前 live 位置所在的列帧（块帧之下） */
export function columnFrame(ctx: OpContext): Frame | undefined {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    if (ctx.frames[i]!.columnId !== null) return ctx.frames[i];
  }
  return undefined;
}

/** 按坐标重建列帧（存档不进帧栈——块/列级作用域不进档，读档后确定性重放重建） */
export function columnFrameAt(ctx: OpContext, coord: ColumnCoordinate): Frame {
  const column = ctx.columnById(coord.columnId)!;
  return {
    columnId: coord.columnId,
    commands:
      column.kind === "flow" ? column.commands! : (column.entry ?? []),
    index: coord.index,
    scope: Scope.root(),
  };
}

/**
 * 回溯三步：找目标检查点 → 恢复快照 → 重放到该等待点。
 * target = 检查点下标或坐标（取坐标之前最近的检查点）。
 */
export function rollbackTo(ctx: OpContext, target: number | ColumnCoordinate): void {
  if (!ctx.started) {
    ctx.fail("rollback-invalid", "故事尚未启动");
    return;
  }
  if (ctx.rollbackActive) {
    ctx.fail("rollback-in-progress", "回放进行中，拒绝重入");
    return;
  }
  ctx.flushPendingCheckpoint(); // 离开当前画面：所见即入档（forward 可回到离开位置）
  let index: number;
  if (typeof target === "number") {
    index = target;
  } else {
    index = -1;
    for (let i = 0; i <= ctx.cursor; i += 1) {
      const c = ctx.history[i]!;
      if (
        c.coord.columnId === target.columnId &&
        c.coord.index <= target.index
      )
        index = i;
    }
    if (index < 0) {
      ctx.fail(
        "rollback-target-not-found",
        `坐标之前没有检查点：(${target.columnId}, ${target.index})`,
      );
      return;
    }
  }
  if (index < 0 || index >= ctx.history.length) {
    ctx.fail(
      "rollback-target-out-of-range",
      `检查点下标越界：${index}（共 ${ctx.history.length}）`,
    );
    return;
  }
  restore(ctx, ctx.history[index]!);
  ctx.cursor = index;
  // 重放期输入锁 + 完成后解除并广播
  ctx.rollbackActive = true;
  ctx.setSystem(SYS.rollbackActive, true);
  ctx.run(); // 同步重放至等待点（menu 真实等待）
  ctx.rollbackActive = false;
  ctx.setSystem(SYS.rollbackActive, false);
  // 重放落点即检查点 k 的等待点——live 视为已入档，back() 才能继续向前回退
  ctx.liveCheckpointed = true;
  ctx.emitEvent({ kind: "rollback.done", coordinate: { ...ctx.coord } });
}

/**
 * 历史长度（**只读出口**，供 UI 判据与测试共用）。
 *
 * 为什么需要出口：`back()` 会先`flushPendingCheckpoint`（离开当前画面即所见入档），
 * 所以「有没有在菜单里建点」**不能靠 back() 的落点反推**——那测的是 flush 语义，
 * 不是守卫。要精确断言「菜单期间历史没变」必须直接读长度。
 */
export function historyLength(ctx: OpContext): number {
  return ctx.history.length;
}

/** 历史游标（只读出口；配`historyLength` 判定「回退了几步」） */
export function historyCursor(ctx: OpContext): number {
  return ctx.cursor;
}

/**
 * 滚轮上：回退一步。
 * 先把当前画面落成检查点（所见即入档，之后 forward 才能回到离开位置），
 * 再按 live 是否已入档决定目标；未启动、重放中或已到最早保留点一律 fail-closed。
 */
export function back(ctx: OpContext): void {
  if (!ctx.started || ctx.rollbackActive) {
    ctx.fail("rollback-invalid", "当前不可回退");
    return;
  }
  ctx.flushPendingCheckpoint(); // 离开当前画面：所见即入档（forward 可回到离开位置）
  const target = ctx.liveCheckpointed ? ctx.cursor - 1 : ctx.cursor;
  if (target < 0) {
    ctx.fail("history-empty", "已回溯到最早保留点");
    return;
  }
  rollbackTo(ctx, target);
}

/** 滚轮下：沿未截断时间线 rollforward（分岔后旧前向已截断） */
export function forward(ctx: OpContext): void {
  if (!ctx.started || ctx.rollbackActive) {
    ctx.fail("rollback-invalid", "当前不可前进");
    return;
  }
  if (ctx.cursor >= ctx.history.length - 1) {
    ctx.fail("no-forward", "没有可前进的历史（已在最新处或时间线已分岔）");
    return;
  }
  rollbackTo(ctx, ctx.cursor + 1);
}

/**
 * 历史面板数据（前端职责的可视化皮）：对话类检查点带说话者与文本；
 * NVL 检查点额外带 `nvl` 标记与**累积行快照**（nvlLines = 该时刻玩家已见的整块文本）——
 * 宿主按「段聚合」呈现（历史不灌水），回溯粒度不变（逐检查点仍全在 history 里）。
 */
export function historyView(ctx: OpContext): Array<{
  index: number;
  coord: ColumnCoordinate;
  speaker: string;
  text: string;
  nvl: boolean;
  nvlLines: string[];
}> {
  return ctx.history.map((cp, index) => {
    const mode = cp.snapshot.state.find(([k]) => k === SYS.nvlMode)?.[1];
    const buffer = cp.snapshot.state.find(([k]) => k === SYS.nvlBuffer)?.[1];
    return {
      index,
      coord: { ...cp.coord },
      speaker: snapshotText(cp, SYS.currentDialogSpeaker),
      text: snapshotText(cp, SYS.currentDialogText),
      nvl: mode === "active",
      nvlLines:
        mode === "active" && Array.isArray(buffer)
          ? (buffer as string[])
          : [],
    };
  });
}
