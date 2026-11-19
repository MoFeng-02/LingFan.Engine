/**
 * 帧栈推进与列进入：解释执行循环与门面共用的帧栈零件。
 * 循环帧的压栈、轮次推进与 break/continue 定位也在这里，与分发循环配套。
 *
 * 只在运行层内部使用，不进包出口。
 */
import {
  SYS,
  type StoryCommand,
  type StoryColumn,
} from "../../contracts/index.ts";
import { isReplayableColumn } from "../../shared/index.ts";
import { loadElements } from "../../data/index.ts";
import { loadBody } from "../body/index.ts";
import type { ExprValue } from "../expr/index.ts";
import { updateSources } from "../i18n/index.ts";
import { Scope } from "../scope.ts";
import { parseMenuReturn } from "./helpers.ts";
import type { Frame, LoopState } from "./frame.ts";
import type { OpContext } from "./context.ts";
import { abortExternalTakeovers } from "./waiting.ts";

/** 防死循环安全网：单个循环帧的迭代上限（fail-closed） */
const LOOP_LIMIT = 10000;

/**
 * 清对话镜像：换了画面，上一句的文字、说话人与颜色都不该跟过去。
 *
 * 判据是「**真的有残留**」而不是「一律写一遍」：空串与 `false` 本来就是缺省
 * 表示，无条件重写会让每次进列都多出几次 `ValueChanged`，而「键序列精确匹配」
 * 那类测试正是靠键序列抓多余的写。这里因此只清非缺省值。
 *
 * 与 `navigate` 里的清屏互补而非重复：那边无条件清（导航语义 = 明确的换屏动作），
 * 这边兜住不经过 `navigate` 的进列路径（`jump`、菜单选择、热重载重入）。
 */
function clearDialogMirror(ctx: OpContext): void {
  // 内部清屏判断读原始态（ctx.get 对派生键给译文，判残留要用原文）
  const text = ctx.state.get(SYS.currentDialogText);
  if (typeof text === "string" && text !== "") {
    updateSources(ctx, { dialog: undefined }); // 源先于键清：出站派生不读旧源
    ctx.setSystem(SYS.currentDialogText, "");
  }
  const speaker = ctx.state.get(SYS.currentDialogSpeaker);
  if (typeof speaker === "string" && speaker !== "") {
    updateSources(ctx, { speaker: undefined });
    ctx.setSystem(SYS.currentDialogSpeaker, "");
  }
  const color = ctx.get(SYS.currentDialogColor);
  if (typeof color === "string" && color !== "") {
    ctx.setSystem(SYS.currentDialogColor, "");
  }
  if (ctx.get(SYS.dialogComplete) === true) {
    ctx.setSystem(SYS.dialogComplete, false);
  }
}

/** 按 id 取列定义；未命中返回 undefined，调用方决定是否 fail-closed */
export function columnById(
  ctx: OpContext,
  id: string,
): StoryColumn | undefined {
  return ctx.story.columns.find((c) => c.id === id);
}

/** 进入列：替换整个帧栈（出块、出列即销毁作用域），建列级作用域，坐标归零 */
export function enterColumn(ctx: OpContext, columnId: string): boolean {
  const column = ctx.columnById(columnId);
  if (column === undefined) {
    ctx.fail("unknown-column", `目标列不存在：${columnId}`);
    return false;
  }
  // 换列即中断全部外部接管（小游戏/玩法/扩展 op 的挂载信号）：`jump` 直调本函数，
  // 不经过 `navigate` 那条已带中断的路径，若不在这里收口，旧列的接管信号会存活到新列。
  // 收敛到单一收尾函数（与 leftColumn 分支同一入口）：分两处各写一份迟早漏掉一边，
  // 表现为「换列后旧系统还在跑、推进键永久失效」。对已自行收尾的完成转列是幂等空操作。
  abortExternalTakeovers(ctx);
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
  if (
    isReplayableColumn(column) &&
    parseMenuReturn(ctx.get(SYS.menuReturn)) !== null
  ) {
    ctx.setSystem(SYS.menuReturn, "");
  }
  // 空间层：scene 列的元素是**声明式装载**（不进命令流），entry 才是进入后
  // 按序执行的命令流；列切换整体替换 __elements（空间层属于列），回溯由快照还原。
  // 元素存原文：译文只在派生读口产生（装载时翻译会把译文写进快照，切语言无法重译）。
  ctx.setSystem(
    SYS.elements,
    column.kind === "scene"
      ? loadElements(column.elements ?? [], columnId)
      : [],
  );
  // 身体层：与元素层同理属于列——进列即对账，回溯/存档由快照整表还原。
  // 列没有身体时这里删键（不写 `undefined`），「无身体」因此只有一种表示。
  loadBody(ctx, column);
  // 对话镜像：`navigate` 在调本函数前已清过，`jump` 直调本函数则没有——
  // 同一份「换了画面」的事实因此有两条不同结果，上一句的文字会跟到新列里
  // （组件身体/纯元素列既不等对话也不重画文本，残留就露出来）。
  // 收口到这里：进列即清，与清理发生在哪条路径无关。
  // **只在真有残留时才写**：空串是缺省值，无条件写会给每次进列都多几次
  // `ValueChanged`（「键序列精确匹配」测试会正确地撞红）。
  clearDialogMirror(ctx);
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

/** for 与 foreach 同构：物化数组后压入循环帧逐元素推进；循环变量是块级局部 */
export function pushIterateLoop(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
  items: ExprValue[],
): boolean {
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

/** 开始一轮迭代：每轮新块作用域，声明循环变量，游标归零；超上限 fail-closed */
export function beginLoopIteration(
  ctx: OpContext,
  frame: Frame,
  loop: LoopState,
): boolean {
  if (loop.iterations >= LOOP_LIMIT) {
    ctx.fail("loop-limit", ctx.texts.loopLimitExceeded(LOOP_LIMIT));
    return false;
  }
  frame.scope = loop.parentScope.enterChild();
  if (loop.kind === "iterate") {
    frame.scope.declare(loop.varName!, loop.items![loop.iterations]!);
  }
  frame.index = 0;
  return true;
}

/**
 * 自内向外找最近的循环帧下标，供 break 与 continue 定位。
 * 遇到函数帧即停（循环不得跨函数边界），未找到返回 -1。
 */
export function nearestLoopIndex(ctx: OpContext): number {
  for (let i = ctx.frames.length - 1; i >= 0; i -= 1) {
    if (ctx.frames[i]!.func === true) return -1; // 函数边界：循环不得跨函数
    if (ctx.frames[i]!.loop !== undefined) return i;
  }
  return -1;
}
