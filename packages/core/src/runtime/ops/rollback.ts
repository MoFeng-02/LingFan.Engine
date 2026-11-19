/**
 * 回退控制 op：op 级临时锁定 / 解锁回退（block_rollback / fix_rollback）。
 *
 * 与工程级 `rollbackEnabled`（装配期总开关）的区别：这是故事进行中由命令临时锁 / 解的
 * 闸，例如一段演出期间不许回退。写 `SYS.rollbackLocked`（会话态：进快照随回溯，不进
 * 存档——读档等于会话重开，锁定不跨档继承）。锁定只关回退这条路，不改回溯语义；存读档
 * 照常。无负载参数（未知字段 fail-closed）。
 */
import { SYS, type StoryCommand } from "../../contracts/index.ts";
import type { OpContext } from "../internal/index.ts";

/** 回退控制 op 已知负载字段（无参数，仅 op 键；未知字段 fail-closed） */
const ROLLBACK_FIELDS: Record<string, ReadonlySet<string>> = {
  block_rollback: new Set(["op"]),
  fix_rollback: new Set(["op"]),
};

/**
 * block_rollback 置 `SYS.rollbackLocked=true`（锁定回退）；fix_rollback 置 false（解锁）。
 * 非阻塞：写状态后故事继续。锁定期间 back/forward/rollbackTo 一律 fail-closed（见 history/rollback.ts）。
 */
export function execRollbackLock(ctx: OpContext, cmd: StoryCommand): boolean {
  const known = ROLLBACK_FIELDS[cmd.op]!;
  const unknown = Object.keys(cmd).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  ctx.setSystem(SYS.rollbackLocked, cmd.op === "block_rollback");
  return true;
}
