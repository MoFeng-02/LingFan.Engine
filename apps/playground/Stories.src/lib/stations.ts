/**
 * 词汇全席站点菜单（共享收束）：枢纽列与其余站点列尾同形菜单的唯一来源。
 *
 * 菜单是运行期 op：编译器把本函数体前置为各列 func 命令、列尾发射 call——
 * 菜单等待中选中即跳转，enterColumn 整体替换帧栈，func 帧随之干净销毁。
 * （数组/对象复合值不得作常量绑定内联，故经函数共享而非共享 const。）
 */
import { script } from "@lingfan/editor";

const { menu, option } = script;

export function stationsMenu(): void {
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
