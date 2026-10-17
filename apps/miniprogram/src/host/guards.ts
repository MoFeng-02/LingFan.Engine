/**
 * 演示工程的守卫实现：故事 JSON 里只写守卫名（`{"op":"guard","fn":"gold-non-negative"}`），
 * 实现必须由宿主提供——引擎是「组合根注册制」，没登记的守卫名在运行期会 fail-closed。
 *
 * 内容是包外的、守卫是包内的，这是有意为之：守卫属于代码而不是内容，服务端换一份故事
 * 也换不掉它。演示工程用到的两个守卫语义与 `apps/playground/Stories.src/lib/guards.ts`
 * 的 cell 声明一致（那边由 `stories:build` 生成注册表，这边没有生成器，手写同一份语义）。
 *
 * 名字闭合靠 `tests/miniprogram/app-host.test.ts` 的互锁：`project/Stories/**` 里出现的
 * 每个 `"fn"` 都必须在 `guards` 里登记，缺一个就是运行期的「未注册的守卫」。
 */
import type { GuardFn } from "@lingfan/engine";

export const guards: Readonly<Record<string, GuardFn>> = {
  /** 金币非负：`player.gold` 被改成负数即拦下，故事停在当前命令。 */
  "gold-non-negative": (ctx) => {
    const gold = ctx.get("player.gold");
    if (typeof gold !== "number" || gold < 0) {
      ctx.fail(`player.gold 非法：${String(gold)}`);
    }
  },
  /** 巡礼守卫：站点自带的闸门演示——先 set 状态再 guard，守卫读的是 SSOT 事实。 */
  "tour-open": (ctx) => {
    if (ctx.get("tour.open") !== true) {
      ctx.fail("巡礼尚未开始（tour.open 未置位）");
    }
  },
};
