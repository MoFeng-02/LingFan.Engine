/**
 * 第四章 · 词汇全席（菜单枢纽列）：开席两句 + 站点菜单。
 * 菜单选项是字面量清单——站点/出口改这里，各站同步（各站菜单同形）。
 */
import { menu, option, say } from "../lib/vocabulary";

export default function tour(): void {
  say("词汇全席开席——每个站点把一个词汇域做成一道菜，随便点、随便续。", "灵泛");
  say("（本列由 TS 源第四章生成：源里就是普通函数体，编译器逐句转译成 op 序列。）");
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
