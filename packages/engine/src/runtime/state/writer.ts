/**
 * 全局层、系统层与外部玩法状态的写入通道。
 */
import { GAME_SYSTEM_ID_PATTERN, RESERVED_STATE_KEYS } from "../../contracts";
import type { OpContext } from "../internal";
import { findJsonValueError } from "../stateContract";

/**
 * 全局层写入（作者 `set`/`define` / 小游戏奖励 / 数组族 op 的唯一汇聚点）。
 *
 * 写入契约（fail-closed，拒绝时**状态原样**）：
 * - **键**：保留键（`RESERVED_STATE_KEYS` = SYS 精确名全集）拒绝（`reserved-key`）——
 *   SYS 键归引擎所有，外部写入会破坏等待状态机/回溯；
 * - **值**：JSON 安全（白名单 + 对新值深走查拒循环引用，带定位）（`value-not-serializable`）。
 */
export function setGlobal(ctx: OpContext, key: string, value: unknown): void {
  if (RESERVED_STATE_KEYS.has(key)) {
    ctx.fail(
      "reserved-key",
      `保留键不可写入：${key}（SYS 全集为引擎所有；作者/扩展请改用其他键名）`,
    );
    return;
  }
  const unsafe = findJsonValueError(value, key);
  if (unsafe !== null) {
    ctx.fail(
      "value-not-serializable",
      `值不可序列化，写入被拒绝：${unsafe}（状态原样；请只写 JSON 安全值并按写时复制更新）`,
    );
    return;
  }
  ctx.state.set(key, value);
  ctx.emit(key, value, "global");
}

/**
 * 系统层写入（引擎内部专用，`SYS` 键的所有者）。
 * 值契约同样适用（引擎内部违约 = 引擎 bug，同样 fail-closed 暴露）；
 * 键不受保留键约束——`setSystem` 本来就是写 SYS 键的通道。
 */
export function setSystem(ctx: OpContext, key: string, value: unknown): void {
  const unsafe = findJsonValueError(value, key);
  if (unsafe !== null) {
    ctx.fail(
      "value-not-serializable",
      `系统键写入值不可序列化：${unsafe}（引擎内部契约违约）`,
    );
    return;
  }
  ctx.state.set(key, value);
  ctx.emit(key, value, "system");
}

/**
 * 静默写（帧级键通道）：值契约照常（违规仍拒绝 + 诊断），但**不进事件流**。
 *
 * 用途：高频变更（每帧媒体位置、外部玩法系统的每帧坐标）——进事件流会造成
 * 事件风暴（每帧一次全量广播）。值仍随快照/存档持久化，回溯一致性与普通写相同。
 */
export function setSilentKey(ctx: OpContext, key: string, value: unknown): boolean {
  const unsafe = findJsonValueError(value, key);
  if (unsafe !== null) {
    ctx.fail(
      "value-not-serializable",
      `值不可序列化，写入被拒绝：${unsafe}（状态原样；请只写 JSON 安全值）`,
    );
    return false;
  }
  ctx.state.set(key, value);
  return true;
}

/**
 * 外部写入的公共实现：键校验（保留键 + 命名空间合法性）→ 值契约 → 落 SSOT。
 * `emitChange = false` 走静默通道（帧级高频写）。
 */
export function writeExternal(ctx: OpContext, 
  key: string,
  value: unknown,
  emitChange: boolean,
  systemId?: string,
): boolean {
  if (systemId !== undefined && !GAME_SYSTEM_ID_PATTERN.test(systemId)) {
    ctx.fail(
      "game-system-invalid",
      `玩法系统标识非法：${JSON.stringify(systemId)}（须匹配 ${String(GAME_SYSTEM_ID_PATTERN)}）`,
    );
    return false;
  }
  if (RESERVED_STATE_KEYS.has(key)) {
    ctx.fail(
      "reserved-key",
      `保留键不可写入：${key}（SYS 全集为引擎所有；外部玩法状态请用 setScoped 走 game.<系统>.<键> 命名空间）`,
    );
    return false;
  }
  if (!emitChange) return setSilentKey(ctx, key, value);
  const unsafe = findJsonValueError(value, key);
  if (unsafe !== null) {
    ctx.fail(
      "value-not-serializable",
      `值不可序列化，写入被拒绝：${unsafe}（状态原样；请只写 JSON 安全值并按写时复制更新）`,
    );
    return false;
  }
  ctx.state.set(key, value);
  ctx.emit(key, value, "global");
  return true;
}
