/**
 * 演示宿主的引擎用户可见文案：只改槽位名一处，其余沿用引擎缺省。
 *
 * 引擎缺省模板把槽位 id 原样嵌进句子（`槽位 ${slot}`），而演示宿主的槽位 id 是
 * `slot_1` 这种形式，直出就是「槽位 slot_2」——玩家在面板上点的是「槽位 2」，
 * 失败横幅却报一个他从没见过的 id。这里把句子里的槽位名换成面板那一套
 * （`defaultSlotLabel`）：面板怎么称呼，报错里就怎么称呼。
 *
 * 整体改写或本地化玩家文案时从这里换，引擎缺省不动。
 */
import { defaultEngineTexts, type EngineTexts } from "@lingfan/engine";
import { defaultSlotLabel } from "@lingfan/shell";

/** 演示宿主注入引擎的文案表（未改写的句子 = 引擎缺省） */
export const playgroundEngineTexts: EngineTexts = {
  ...defaultEngineTexts,
  saveWriteFailed: (slot, error) =>
    `${defaultSlotLabel(slot)} 写档失败：${error}`,
  loadReadFailed: (slot, error) =>
    `${defaultSlotLabel(slot)} 读取或解析失败：${error}`,
};
