/**
 * 第四章 · 守卫工坊：set 词逃生舱写深路径状态（tour.open）→ guard(句柄) 两层执法——
 * 状态变更走 set、闸门读 SSOT 事实；没过守卫的故事在运行期被拦停。
 */
import { script } from "@lingfan/editor";

const { guard, notify, say, set } = script;

import { tourOpen } from "../lib/guards";
import { stationsMenu } from "../lib/stations";

export default function tour_guard(): void {
  set("tour.open", true);
  say("守卫工坊——先 set 深路径状态（tour.open），再交给 guard 执法。", "灵泛");
  guard(tourOpen);
  say("guard 通过：巡礼闸门开启（本列状态已置位）。");
  notify("守卫与断言（assert）都在运行期执法：非法状态 → fail-fast 拦停。", {
    type: "info",
  });
  say("守卫工坊到此为止——从本列回主菜单收尾。");
  stationsMenu();
}
