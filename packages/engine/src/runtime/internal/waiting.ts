/**
 * 等待态零件：输入回填、定时器清理与外部接管中断。
 * 等待的建立分散在各自的命令处理器里，这里只收解除侧。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS } from "../../contracts";
import type { OpContext } from "./context";

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

/** 清掉挂起的等待定时器（导航、销毁、读档与回溯前调用，避免旧计时器醒来改状态） */
export function clearTimer(ctx: OpContext): void {
  if (ctx.pendingTimer !== null) {
    clearTimeout(ctx.pendingTimer);
    ctx.pendingTimer = null;
  }
}

/**
 * 中断全部外部接管（小游戏与玩法系统）：向宿主发挂载信号的 abort，重放到该坐标时重新挂载。
 * 合成单一入口是因为五处中断点（导航、销毁、读档、回溯、热重载）对两类接管的处置完全相同，
 * 分开调用迟早漏掉一边，那时表现为「回溯后旧系统还在跑」。
 */
export function abortExternalTakeovers(ctx: OpContext): void {
  ctx.abortMinigame();
  ctx.abortInteraction();
}
