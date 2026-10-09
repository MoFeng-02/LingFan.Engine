/**
 * 实例级 z 的校验与写入。
 */
import type { StoryCommand } from "../../contracts";
import type { OpContext } from "../internal";

/**
 * 实例级 z 的**执行期防御**（解析期 `data/format/` 已拒；这里是纵深防御）：
 * 非法（负数 / NaN / Infinity / 非数字）→ `engine.error` 且**不动任何状态**，调用方立即 return。
 * 返回 `true` = 已拒绝（调用方必须 `return`）。
 */
export function rejectBadInstanceZ(ctx: OpContext, cmd: StoryCommand): boolean {
  if (cmd.z === undefined) return false;
  if (typeof cmd.z === "number" && Number.isFinite(cmd.z) && cmd.z >= 0) {
    return false;
  }
  ctx.fail(
    "instance-z-invalid",
    `实例级 z 必须为非负有限数，收到 ${String(cmd.z)}`,
  );
  return true;
}

/**
 * 实例级 z：把命令上的 `z` 写进 SSOT（键 ↔ 层见 `INSTANCE_Z_KEYS`）。
 *
 * - **有值**（非负有限数）→ `setSystem`（进事件流，宿主据此改该层 z）；
 * - **缺省/非法** → **删除键**（回层默认）并广播 `undefined` —— 保证「不带 z 的下一条命令」
 *   不会沿用上一条的覆盖（这正是「只影响这一个，不影响其他 say」的要求）。
 *
 * 进 SSOT 的收益：随快照 / 存档 / 回溯自动随行（重放到同一条命令重新写入同一值）。
 * 前置：调用方已用 `rejectBadInstanceZ` 拒掉非法值。
 */
export function setInstanceZ(ctx: OpContext, key: string, raw: unknown): void {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    ctx.setSystem(key, raw);
    return;
  }
  if (ctx.state.delete(key)) ctx.emit(key, undefined, "system");
}
