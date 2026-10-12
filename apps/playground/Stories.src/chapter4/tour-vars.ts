/** 第四章 · 变量盛宴：数组 / 字典 / let / undef 词逃生舱——SSOT 状态随快照、存档、回溯随行。 */
import { script } from "@lingfan/editor";

const { arrayPop, arrayPush, dict, dictSet, letVar, newArray, say, undef } = script;

import { stationsMenu } from "../lib/stations";

export default function tour_vars(): void {
  say(
    "变量盛宴——数组、字典、临时变量都是 SSOT 状态，随快照/存档/回溯随行。",
    "灵泛",
  );
  newArray("bag", ["火把"]);
  arrayPush("bag", "面包");
  arrayPush("bag", "旧地图");
  arrayPush("bag", "提灯");
  say("行囊就绪：array 建列 + 三次 array_push（火把、面包、旧地图、提灯）。");
  arrayPop("bag");
  say("array_pop 取走最后一件（提灯）——现在剩三件。");
  dict("gear", { weapon: "木剑", armor: "布衣" });
  dictSet("gear", "weapon", "铁剑");
  say(
    "装备字典：dict 建档 + dict_set 把武器从木剑升级成铁剑（历史面板可查每次变更）。",
  );
  letVar("ticket", 1);
  say("let 临时变量：ticket = {ticket}。");
  undef("ticket");
  say("undef 已把 ticket 从变量表回收（这句故意不再插值它）。");
  stationsMenu();
}
