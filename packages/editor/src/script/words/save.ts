/**
 * Script 词汇层 · **存档域**（save / load / auto_save / save_delete）。
 */
import type { CommandOf } from "../../schema";

/**
 * 声明一个存档点：把「存进槽位 `slot`」记下来，等到**下一个玩家所见
 * 等待画面**（对话/菜单/输入等）出现时才真正写盘——保证存档画面
 * 可重放重建。声明本身立即继续，不等待。
 * @param slot 槽位名（字母/数字/_/-，1–64 字符）。
 * @param title 存档显示名（可省略）。
 * @returns `save` 故事命令。
 * @example
 * say("要休息了吗？");
 * save("inn", "客栈过夜");
 */
export function save(slot: string, title?: string): CommandOf<"save"> {
  return { op: "save", slot, ...(title === undefined ? {} : { title }) };
}

/**
 * 读档传送：从槽位 `slot` 异步读档，画面与状态整体回到存档时刻，
 * 故事从存档时的等待画面继续。
 * @param slot 槽位名。
 * @returns `load` 故事命令。
 * @example
 * menu("回到存档点？", [option("是", "do_load"), option("否", "stay")]);
 */
export function load(slot: string): CommandOf<"load"> {
  return { op: "load", slot };
}

/**
 * 开关自动存档：开启后，每个玩家所见等待画面建立时都会自动写入
 * 自动存档槽。开关本身随存档/读档一并恢复。
 * @param enabled true = 开启自动存档。
 * @returns `auto_save` 故事命令。
 * @example
 * autoSave(true);
 */
export function autoSave(enabled: boolean): CommandOf<"auto_save"> {
  return { op: "auto_save", enabled };
}

/**
 * 删除槽位 `slot` 的存档（异步执行；不影响回档基准）。
 * @param slot 槽位名。
 * @returns `save_delete` 故事命令。
 * @example
 * saveDelete("inn");
 */
export function saveDelete(slot: string): CommandOf<"save_delete"> {
  return { op: "save_delete", slot };
}
