/**
 * 存档导出。
 */
import { SYS, type ColumnCoordinate, type SaveDataV1 } from "../../contracts";
import { parseMenuReturn, type OpContext } from "../internal";
import { findJsonValueError } from "../stateContract";

  /**
   * 导出存档载荷。必须在等待点调用（列尾/未启动 fail-closed 拒绝）。
   * 载荷 = 等待点坐标 + 全局状态 + rngState + 函数表 + 历史；不含块/列级作用域与帧栈。
   *
   * **场景类型守卫**：在 `menu`/`ui` 场景按存档，**存的是「菜单前的游戏进度」
   * 而不是菜单状态**（对标 Ren'Py Esc 菜单存档）。
   * 手法：维护 `__menuReturn`（进入菜单前的**可回溯坐标** + 等待态），
   * 导出时用它替换当前坐标；**没有 `__menuReturn` ⇒ 拒绝存档**
   * （没有正在进行的游戏）。
   */
export function exportSave(ctx: OpContext): SaveDataV1 | null {
    const waiting = ctx.get(SYS.waiting);
    const columnFrame = ctx.columnFrame();
    if (
      waiting === undefined ||
      waiting === "none" ||
      columnFrame === undefined ||
      columnFrame.columnId === null
    ) {
      ctx.fail("save-invalid", "当前不在等待点，无法存档");
      return null;
    }
    // 序列化边界深校验（「存档时」半边）：写入时契约 + 写时复制
    // 挡不住「拿到引用后原地改值」（作者行为）——在真正序列化前拦下，杜绝"写档才抛/静默变形"。
    // 快照里的 state 与活状态共享同一批值引用（写时复制），校验活状态即覆盖历史副本。
    for (const [key, value] of ctx.state) {
      const unsafe = findJsonValueError(value, key);
      if (unsafe !== null) {
        ctx.fail(
          "value-not-serializable",
          `状态含不可序列化值，存档被拒绝：${unsafe}（请检查是否有原地修改已写入的值；应整值替换）`,
        );
        return null;
      }
    }
    // 场景类型守卫：非 game 场景导出 ⇒ 存「菜单前的游戏进度」。
    // 手法：把当前坐标/等待态换成`__menu_return` 里记的游戏点；
    // **无该记账 ⇒ 拒绝存档**（没有正在进行的游戏）。
    const rawReturn = ctx.get(SYS.menuReturn);
    const menuReturn = parseMenuReturn(rawReturn);
    let coord: ColumnCoordinate;
    let historyCursor = ctx.cursor;
    let historyList = ctx.history;
    if (!ctx.isCurrentColumnReplayable()) {
      if (menuReturn === null) {
        ctx.fail(
          "save-invalid",
          "当前在菜单/界面中，且没有可返回的游戏进度——无法存档（请先回到游戏场景）",
        );
        return null;
      }
      coord = menuReturn.coord;
      // 历史游标一并回退：菜单期间的历史是「覆盖」产生的，不该算进玩家进度
      const back = ctx.lastReplayableCursor();
      if (back !== null) historyCursor = back;
      historyList = ctx.history.slice(0, historyCursor + 1);
    } else {
      coord = {
        columnId: columnFrame.columnId,
        index: Math.max(0, columnFrame.index - 1),
      };
    }
    return {
      formatVersion: 1,
      storyId: ctx.story.id,
      coord,
      state: [...ctx.state.entries()],
      rngState: ctx.rngState,
      functions: [...ctx.functions.entries()],
      cursor: historyCursor,
      history: historyList.map((cp) => ({
        coord: { ...cp.coord },
        state: cp.snapshot.state,
        rngState: cp.snapshot.rngState,
      })),
      // 本档实际执行过的扩展（未用到 = 字段缺席，缺扩展也能读——防假阳性）
      ...(ctx.usedExtensions.size > 0
        ? {
            extensions: [...ctx.usedExtensions].flatMap((id) => {
              const ext = ctx.extensionById.get(id);
              return ext ? [{ id, stateVersion: ext.stateVersion }] : [];
            }),
          }
        : {}),
    };
}
