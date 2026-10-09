/**
 * 运行层出站面：状态变更广播、出站事件信封、engine.error 上报。
 *
 * 三者是执行器与宿主之间的唯一观察通道：状态写入经 `emitChange` 通知，
 * 事件经 `publishEvent` 出站，凡不可继续的错误都必须经 `emitErrorEvent` 到达宿主
 * （绝不静默）。实现集中在这里一份，调用方一律经 `ctx` 取用。
 */
import type {
  OutboundEvent,
  OutboundPayload,
  ValueChanged,
} from "../../contracts";
import type { OpContext } from "../internal";

/** 状态变更广播 */
export function emitChange(
  ctx: OpContext,
  key: string,
  value: unknown,
  scope: string,
): void {
  const change: ValueChanged = { key, value, scope };
  for (const listener of ctx.stateListeners) listener(change);
}

/** 出站事件统一发射：信封 `{v,kind:'event',payload}` + 广播全体监听者 */
export function publishEvent(ctx: OpContext, payload: OutboundPayload): void {
  const event: OutboundEvent = { v: 1, kind: "event", payload };
  for (const listener of ctx.eventListeners) listener(event);
}

/** engine.error 事件出站，绝不静默 */
export function emitErrorEvent(
  ctx: OpContext,
  code: string,
  message: string,
): void {
  publishEvent(ctx, {
    kind: "engine.error",
    code,
    message,
    coordinate: { ...ctx.coord },
  });
}
