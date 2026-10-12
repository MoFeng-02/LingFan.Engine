/** 第四章 · 扩展工坊：extOp 词逃生舱——引擎未内置的领域命令（quest 插件）走 ext 扩展位。 */
import { script } from "@lingfan/editor";

const { extOp, say } = script;

import { stationsMenu } from "../lib/stations";

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
  stationsMenu();
}
