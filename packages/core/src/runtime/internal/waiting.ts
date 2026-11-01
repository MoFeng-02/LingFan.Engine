/**
 * 等待态零件：输入回填、等待定时器的建立与清理、外部接管中断。
 * 等待的建立分散在各自的命令处理器里，这里收「定时器」这一件的两端（建立与解除）
 * 以及解除侧的回填与中断。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS } from "../../contracts/index.ts";
import type { OpContext } from "./context.ts";

/**
 * 输入回填：输入等待的唯一解除入口，把玩家输入写进 `store` 指定的状态键后继续执行。
 * 非输入等待期或 store 缺失一律 fail-closed。
 */
export function input(ctx: OpContext, value: string): void {
  if (!ctx.started || ctx.get(SYS.waiting) !== "input") {
    ctx.fail(
      "input-invalid",
      `input 仅在输入等待中有效（当前 __waiting=${String(ctx.get(SYS.waiting))}）`,
    );
    return;
  }
  const store = ctx.inputStore;
  if (store === null) {
    ctx.fail("input-state-corrupt", "输入等待缺少 store 目标");
    return;
  }
  ctx.inputStore = null;
  ctx.setGlobal(store, value);
  ctx.setSystem(SYS.waiting, "none");
  ctx.liveCheckpointed = false; // 提交改变画面：live 未入档
  ctx.run();
}

/**
 * 当前时刻（毫秒时间轴）。
 *
 * 走定时器端口而不是直接读宿主时钟：没有 JS 运行时的宿主（原生编译目标）
 * 可以自己给时刻，核心就不必假设全局 `Date` 存在。
 */
export function nowMs(ctx: OpContext): number {
  return ctx.timerPort.now?.() ?? Date.now();
}

/**
 * 安排等待定时器：到点解除 wait 等待并继续执行。
 *
 * 回调体与等待建立是同一件事，所以建立与「暂停后按剩余量重排」共用本函数——
 * 两处各写一份的话，漏掉 `__waiting` 判定就会推进一个已经结束的等待。
 * 到期时刻一并记账，暂停靠它算出还剩多少毫秒。
 */
export function armWaitTimer(ctx: OpContext, ms: number): void {
  ctx.pendingTimerDueAt = nowMs(ctx) + ms;
  ctx.pendingTimer = ctx.timerPort.set(() => {
    ctx.pendingTimer = null;
    ctx.pendingTimerDueAt = null;
    ctx.waitSkipable = false;
    if (ctx.get(SYS.waiting) !== "wait") return; // dispose 等场景防御
    ctx.setSystem(SYS.waiting, "none");
    ctx.liveCheckpointed = false; // live 已越过该检查点
    ctx.run();
  }, ms);
}

/**
 * 清掉挂起的等待定时器（导航、销毁、读档与回溯前调用，避免旧计时器醒来改状态）。
 *
 * 暂停记账一并抹掉：这些入口都意味着「这一段等待作废」，留着剩余毫秒只会在
 * 恢复时排出一个属于旧等待的定时器。
 */
export function clearTimer(ctx: OpContext): void {
  if (ctx.pendingTimer !== null) {
    ctx.timerPort.clear(ctx.pendingTimer);
    ctx.pendingTimer = null;
  }
  ctx.pendingTimerDueAt = null;
  ctx.pausedTimerRemainingMs = null;
}

/**
 * 引擎是否处于暂停态：`SYS.paused` 的唯一读口。
 *
 * 暂停标记只由 `pause()` / `resume()` 写；推进类命令据此 fail-closed，
 * 别的模块不要自己 `get` 一次再判——判据分叉后「谁能推进」就会有两套答案。
 */
export function pausedSession(ctx: OpContext): boolean {
  return ctx.get(SYS.paused) === true;
}

/**
 * 中断全部外部接管（小游戏、玩法系统与扩展 op 等待）：向宿主发挂载信号的 abort，重放到该坐标时重新挂载。
 * 合成单一入口是因为五处中断点（导航、销毁、读档、回溯、热重载）对三类接管的处置完全相同，
 * 分开调用迟早漏掉一边，那时表现为「回溯后旧系统还在跑」。
 */
export function abortExternalTakeovers(ctx: OpContext): void {
  ctx.abortMinigame();
  ctx.abortInteraction();
  ctx.abortExtensionOp();
}
