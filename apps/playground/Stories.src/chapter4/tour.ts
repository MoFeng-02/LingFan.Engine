/**
 * 第四章 · 词汇全席（菜单枢纽列）：开席两句 + 站点菜单。
 * 站点菜单唯一来源 = lib/stations.ts 的 stationsMenu()，本列与其余站点列尾同形调用。
 */
import { script } from "@lingfan/editor";

const { say } = script;

import { stationsMenu } from "../lib/stations";

export default function tour(): void {
  say("词汇全席开席——每个站点把一个词汇域做成一道菜，随便点、随便续。", "灵泛");
  say(
    "（本列由 TS 源第四章生成：源里就是普通函数体，编译器逐句转译成 op 序列。）",
  );
  stationsMenu();
}
