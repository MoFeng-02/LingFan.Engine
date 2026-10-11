/**
 * 第四章 · 守卫工坊：set 词逃生舱写深路径状态（tour.open）→ guard(句柄) 两层执法——
 * 状态变更走 set、闸门读 SSOT 事实；没过守卫的故事在运行期被拦停。
 */
import { guard, menu, notify, option, say, set } from "../lib/vocabulary";
import { tourOpen } from "../lib/guards";

export default function tour_guard(): void {
  set("tour.open", true);
  say("守卫工坊——先 set 深路径状态（tour.open），再交给 guard 执法。", "灵泛");
  guard(tourOpen);
  say("guard 通过：巡礼闸门开启（本列状态已置位）。");
  notify("守卫与断言（assert）都在运行期执法：非法状态 → fail-fast 拦停。", { type: "info" });
  say("守卫工坊到此为止——从本列回主菜单收尾。");
  menu("下一道？", [
    option("变量盛宴", "tour_vars"),
    option("流程厨房", "tour_flow"),
    option("存档试吃", "tour_save"),
    option("声光餐车", "tour_av"),
    option("舞台窗口", "tour_stage"),
    option("扩展工坊", "tour_ext"),
    option("守卫工坊", "tour_guard"),
    option("回主线菜单", "start"),
    option("离席（终幕）", "end"),
  ]);
}
