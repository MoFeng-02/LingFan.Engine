/**
 * 帧栈推进与列进入：解释执行循环与门面共用的帧栈零件。
 * 循环帧的压栈、轮次推进与 break/continue 定位也在这里，与分发循环配套。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS, isReplayableColumn, type StoryCommand, type StoryColumn } from "../../contracts";
import { loadElements } from "../../data";
import type { ExprValue } from "../expr";
import { Scope } from "../scope";
import { parseMenuReturn } from "./helpers";
import type { Frame, LoopState } from "./frame";
import type { OpContext } from "./context";

/** 防死循环安全网：单个循环帧的迭代上限（fail-closed） */
const LOOP_LIMIT = 10000;

export function columnById(ctx: OpContext, id: string): StoryColumn | undefined {
    return ctx.story.columns.find((c) => c.id === id);
  }

export function enterColumn(ctx: OpContext, columnId: string): boolean {
    const column = ctx.columnById(columnId);
    if (column === undefined) {
      ctx.fail(
        "unknown-column",
        `目标列不存在：${columnId}`,
      );
      return false;
    }
    // 场景类型分流：
    // 进入 menu/ui 列 ⇒ 记下**进入前**的可回溯坐标与等待态（`__menu_return`），
    // 供「在菜单里存档」时还原成菜单前的游戏进度（Ren'Py Esc 菜单存档语义）。
    // 必须在改 `ctx.coord` **之前**取旧值。
    if (!isReplayableColumn(column)) {
      const prevColumnId = ctx.coord.columnId;
      const prevColumn = ctx.columnById(prevColumnId);
      // 只有「从可回溯列进入菜单」才记（菜单→菜单导航不覆盖上一个游戏点，
      // 否则连开两个菜单会把游戏点写坏）
      if (prevColumn !== undefined && isReplayableColumn(prevColumn)) {
        ctx.setSystem(SYS.menuReturn, {
          coord: { columnId: prevColumnId, index: ctx.coord.index },
          waiting: ctx.get(SYS.waiting) ?? "none",
        });
      }
    }
    ctx.coord = { columnId, index: 0 };
    ctx.setSystem(SYS.currentSceneColumn, columnId);
    // 返回 game 列 ⇒ **清掉**菜单记账（已经回到游戏里）。
    // **只在真的有记账时才写**：空串是缺省值，无条件写会给每次进列都多一次
    // `ValueChanged`（「键序列精确匹配」测试会正确地撞红）。
    if (isReplayableColumn(column) && parseMenuReturn(ctx.get(SYS.menuReturn)) !== null) {
      ctx.setSystem(SYS.menuReturn, "");
    }
    // 空间层：scene 列的元素是**声明式装载**（不进命令流），entry 才是进入后
    // 按序执行的命令流；列切换整体替换 __elements（空间层属于列），回溯由快照还原。
    ctx.setSystem(
      SYS.elements,
      column.kind === "scene"
        ? ctx.translateElements(loadElements(column.elements ?? [], columnId))
        : [],
    );
    ctx.frames = [
      {
        columnId,
        commands:
          column.kind === "flow" ? column.commands! : (column.entry ?? []),
        index: 0,
        scope: Scope.root(), // 列级作用域
      },
    ];
    return true;
  }

export function pushIterateLoop(ctx: OpContext, frame: Frame, cmd: StoryCommand, items: ExprValue[]): boolean {
    frame.index += 1;
    if (items.length === 0) return true;
    const loop: LoopState = {
      kind: "iterate",
      varName: cmd.var as string,
      items,
      parentScope: frame.scope,
      iterations: 0,
    };
    ctx.frames.push({
      columnId: null,
      commands: cmd.body as readonly StoryCommand[],
      index: 0,
      scope: frame.scope,
      loop,
    });
    return ctx.beginLoopIteration(ctx.frames[ctx.frames.length - 1]!, loop);
  }

export function beginLoopIteration(ctx: OpContext, frame: Frame, loop: LoopState): boolean {
    if (loop.iterations >= LOOP_LIMIT) {
      ctx.fail(
        "loop-limit",
        `循环迭代超过 ${LOOP_LIMIT} 次上限，已中断（防死循环安全网）`,
      );
      return false;
    }
    frame.scope = loop.parentScope.enterChild();
    if (loop.kind === "iterate") {
      frame.scope.declare(loop.varName!, loop.items![loop.iterations]!);
    }
    frame.index = 0;
    return true;
  }

export function nearestLoopIndex(ctx: OpContext): number {
    for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
      if (ctx.frames[i]!.func === true) return -1; // 函数边界：循环不得跨函数
      if (ctx.frames[i]!.loop !== undefined) return i;
    }
    return -1;
  }
