/**
 * 具名实现槽位（cell）：构建期扫描进 `fun_register.g.ts`，故事里 guard(handle) 引用——
 * 名字只写一次（声明点即引用点）。
 *
 * 注意：实现里只能引用导入绑定 / 参数 / 全局（构建期名字闸门 fail-closed）；
 * 参数类型由 cell 签名语境推断（GuardFn），无需注记。
 */
import { cell } from "./vocabulary";

/** 金币非负守卫：`player.gold` 被改成负数即 fail，阻止故事继续推进。 */
export const checkGold = cell("gold-non-negative", (ctx) => {
  const gold = ctx.get("player.gold");
  if (typeof gold !== "number" || gold < 0) ctx.fail(`player.gold 非法：${String(gold)}`);
});
/** 巡礼守卫：站点自带的闸门演示——先 set 状态再 guard，守卫读的是 SSOT 事实。 */
export const tourOpen = cell("tour-open", (ctx) => {
  if (ctx.get("tour.open") !== true) ctx.fail("巡礼尚未开始（tour.open 未置位）");
});
