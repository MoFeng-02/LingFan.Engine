/**
 * 宿主注入引擎的文案整形：把句子里的槽位名换成面板叫法。
 *
 * 引擎缺省模板把槽位 id 原样嵌进句子（`槽位 ${slot}`），而宿主的槽位 id 是
 * `slot_1` 这种形式，直出就是「槽位 slot_2」——玩家在面板上点的是「槽位 2」，
 * 失败横幅却报一个他从没见过的 id。这里按 `defaultSlotLabel` 改名，让面板怎么
 * 称呼、报错里就怎么称呼。
 *
 * 只摊开引擎缺省表改这两句，其余句子跟着引擎演进：整表手写会在引擎新增句子时
 * 静默漏接。整体改写或本地化玩家文案时改的是底表，这套槽位名规则不动。
 */
import { type EngineTexts } from "@lingfan/engine";
import { defaultSlotLabel } from "./slots.ts";

/** 槽位名与面板同源的引擎文案表（未改写的句子 = 传入底表的原句） */
export function withSlotLabels(texts: EngineTexts): EngineTexts {
  return {
    ...texts,
    saveWriteFailed: (slot, error) =>
      `${defaultSlotLabel(slot)} 写档失败：${error}`,
    loadReadFailed: (slot, error) =>
      `${defaultSlotLabel(slot)} 读取或解析失败：${error}`,
  };
}
