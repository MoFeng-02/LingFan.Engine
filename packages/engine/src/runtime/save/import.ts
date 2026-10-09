/**
 * 存档导入。
 */
import { SYS, type ColumnCoordinate, type SaveDataV1 } from "../../contracts";
import type { OpContext } from "../internal";

  /**
   * 读档——恢复全局态与历史，从存档坐标重放重建等待点。
   * 帧栈按坐标重建列帧；故事版本不匹配 fail-closed。
   * 返回 false = 已拒绝（engine.error 事件已出站），调用方不得当作成功处理。
   */
export function importSave(ctx: OpContext, data: SaveDataV1): boolean {
    if (data?.formatVersion !== 1) {
      const migrated = ctx.tryMigrateSave(data); // 版本迁移优先于拒绝
      if (migrated === null) return false;
      data = migrated;
    }
    // fail-closed：结构不完整或坐标失效（列定义已变更）= 存档与当前故事版本不匹配。
    // 全量预校验（含历史检查点坐标），任何不符都不得进入恢复流程（防 TypeError 式崩溃）。
    if (
      !Array.isArray(data.state) ||
      !Array.isArray(data.functions) ||
      !Array.isArray(data.history) ||
      typeof data.coord?.columnId !== "string" ||
      !Number.isFinite(data.coord.index) || // NaN/Infinity 不得深入恢复流程
      !Number.isFinite(data.rngState)
    ) {
      ctx.fail("save-format", "存档结构不完整");
      return false;
    }
    const coords: ColumnCoordinate[] = [
      data.coord,
      ...data.history.map((h) => h?.coord),
    ];
    for (const coord of coords) {
      if (
        typeof coord?.columnId !== "string" ||
        typeof coord?.index !== "number" ||
        ctx.columnById(coord.columnId) === undefined
      ) {
        ctx.fail(
          "save-story-mismatch",
          "该存档与当前故事版本不匹配（列定义已变更）",
        );
        return false;
      }
    }
    if (data.storyId !== ctx.story.id) {
      ctx.fail("save-story-mismatch", "该存档与当前故事不匹配");
      return false;
    }
    // 深层校验：历史检查点 state/rngState 逐项校验——缺失/畸形时
    // 会静默产出 NaN 或恢复期 TypeError；cursor 缺失回默认值、类型错 fail-closed（见下）。
    for (const h of data.history) {
      if (!h || !Array.isArray(h.state) || !Number.isFinite(h.rngState)) {
        ctx.fail(
          "save-format",
          "存档历史检查点不完整（state/rngState 缺失或类型错误）",
        );
        return false;
      }
    }
    if (data.cursor !== undefined && !Number.isFinite(data.cursor)) {
      ctx.fail("save-format", "存档 cursor 类型错误（须为有限数字；缺失可回默认值）");
      return false;
    }
    // 扩展依赖校验（fail-closed 整档预校验；migrate 在进入恢复流程前完成）
    const stagedState = ctx.resolveSaveExtensions(data);
    if (stagedState === null) return false; // 已发 engine.error（整档拒绝）
    ctx.clearTimer();
    ctx.abortExternalTakeovers(); // 读档打断外部接管：abort 挂载信号（重放重新挂载）
    // 引用备份（restore 失败 = 整档拒绝 → 原样回退；以下字段在读档路径只做整体换引用）
    const backup = {
      state: ctx.state,
      rngState: ctx.rngState,
      functions: ctx.functions,
      history: ctx.history,
      cursor: ctx.cursor,
      frames: ctx.frames,
      coord: ctx.coord,
      started: ctx.started,
      pendingSay: ctx.pendingSay,
      liveCheckpointed: ctx.liveCheckpointed,
    };
    ctx.state = new Map(stagedState);
    ctx.rngState = data.rngState;
    ctx.functions = new Map(data.functions);
    ctx.history = data.history.map((h) => ({
      coord: { ...h.coord },
      snapshot: {
        state: h.state,
        rngState: h.rngState,
        frames: [ctx.columnFrameAt(h.coord)],
        coord: { ...h.coord },
        functions: data.functions,
      },
    }));
    // cursor 缺失回默认 = 最近检查点（空历史落 -1，与「无检查点」初始语义一致）
    ctx.cursor =
      data.cursor === undefined
        ? ctx.history.length - 1
        : Math.min(Math.max(data.cursor, 0), ctx.history.length - 1);
    ctx.started = true;
    ctx.pendingSay = null;
    ctx.frames = [ctx.columnFrameAt(data.coord)];
    ctx.coord = { ...data.coord };
    ctx.liveCheckpointed = true;
    if (!ctx.restoreSaveExtensions(data.extensions)) {
      // 原样回退（备份点之后零事件出站，观察面无脏镜像）：逐字段写回备份引用
      ctx.state = backup.state;
      ctx.rngState = backup.rngState;
      ctx.functions = backup.functions;
      ctx.history = backup.history;
      ctx.cursor = backup.cursor;
      ctx.frames = backup.frames;
      ctx.coord = backup.coord;
      ctx.started = backup.started;
      ctx.pendingSay = backup.pendingSay;
      ctx.liveCheckpointed = backup.liveCheckpointed;
      return false; // restore 失败 = 整档拒绝
    }
    // 依赖标记随档继承（读档后再存档不丢依赖；restore 成功后才落账）
    ctx.usedExtensions.clear();
    for (const mark of data.extensions ?? []) ctx.usedExtensions.add(mark.id);
    ctx.setSystem(SYS.waiting, "none");
    ctx.run(); // 确定性重放：从存档命令重建等待画面（同坐标提交由 commitCheckpoint 原位替换）
    return true;
}
