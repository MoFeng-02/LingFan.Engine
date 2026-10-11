/** 第四章 · 变量盛宴：数组 / 字典 / let / undef 词逃生舱——SSOT 状态随快照、存档、回溯随行。 */
import { arrayPop, arrayPush, dict, dictSet, letVar, menu, newArray, option, say, undef } from "../lib/vocabulary";

export default function tour_vars(): void {
  say("变量盛宴——数组、字典、临时变量都是 SSOT 状态，随快照/存档/回溯随行。", "灵泛");
  newArray("bag", ["火把"]);
  arrayPush("bag", "面包");
  arrayPush("bag", "旧地图");
  arrayPush("bag", "提灯");
  say("行囊就绪：array 建列 + 三次 array_push（火把、面包、旧地图、提灯）。");
  arrayPop("bag");
  say("array_pop 取走最后一件（提灯）——现在剩三件。");
  dict("gear", { weapon: "木剑", armor: "布衣" });
  dictSet("gear", "weapon", "铁剑");
  say("装备字典：dict 建档 + dict_set 把武器从木剑升级成铁剑（历史面板可查每次变更）。");
  letVar("ticket", 1);
  say("let 临时变量：ticket = {ticket}。");
  undef("ticket");
  say("undef 已把 ticket 从变量表回收（这句故意不再插值它）。");
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
