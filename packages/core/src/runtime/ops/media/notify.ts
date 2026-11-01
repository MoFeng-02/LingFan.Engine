/**
 * 出站通知：`notify` 只发事件，不碰状态（覆盖层的 toast 归宿主渲染）。
 */
import {
  SYS,
  type OutboundEvent,
  type OutboundPayload,
  type StoryCommand,
} from "../../../contracts/index.ts";
import { interpolateText } from "../../expr/index.ts";
import type { OpContext } from "../../internal/index.ts";

/** notify：出站 toast 事件（覆盖层）；文本插值与 say 同语义 */
export function execNotify(ctx: OpContext, cmd: StoryCommand): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  const { text, errors } = interpolateText(
    ctx.translate(cmd.text as string),
    ctx.resolveName,
    ctx.draw,
  );
  for (const e of errors)
    ctx.fail(e.code, ctx.texts.interpolationFallback(e.message));
  ctx.setInstanceZ(SYS.notificationsZ, cmd.z); // 本条通知的实例 z（notifications 层）
  const payload: OutboundPayload = {
    kind: "notify",
    text,
    ...(typeof cmd.type === "string" ? { notifyType: cmd.type } : {}),
    ...(typeof cmd.duration === "number" ? { duration: cmd.duration } : {}),
  };
  const event: OutboundEvent = { v: 1, kind: "event", payload };
  for (const listener of ctx.eventListeners) listener(event);
}
