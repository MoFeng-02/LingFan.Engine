/**
 * 等待态零件：输入回填、定时器清理与外部接管中断。
 * 等待的建立分散在各自的命令处理器里，这里只收解除侧。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS } from "../../contracts";
import type { OpContext } from "./context";

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

export function clearTimer(ctx: OpContext): void {    if (ctx.pendingTimer !== null) {
      clearTimeout(ctx.pendingTimer);
      ctx.pendingTimer = null;
    }
  }

export function abortExternalTakeovers(ctx: OpContext): void {
    ctx.abortMinigame();
    ctx.abortInteraction();
  }
