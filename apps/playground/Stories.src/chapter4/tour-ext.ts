/** 第四章 · 扩展工坊：extOp 词逃生舱——引擎未内置的领域命令（quest 插件）走 ext 扩展位。 */
import { extOp, menu, option, say } from "../lib/vocabulary";

export default function tour_ext(): void {
  say(
    "扩展工坊——引擎未内置的领域命令走 extOp 扩展位（宿主注册 quest 插件后生效）。",
    "灵泛",
  );
  extOp("quest", { step: "接取委托" });
  say(
    "任务面板：{ext.demoquest.step}——extOp 写入插件命名空间，插值按路径读取。",
  );
  extOp("quest_gate", { title: "交付确认" });
  extOp("quest", { step: "完成交付" });
  say(
    "同一扩展位再次写入：{ext.demoquest.step}——数据进了 SSOT，回溯/存档随行。",
  );
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
