/**
 * 宿主注入引擎的用户可见文案（apps/playground/src/host/engine/engine-texts）：
 * 锁住「报错里的槽位名 = 面板上的槽位名」这条接线——引擎缺省模板把槽位 id 原样
 * 嵌进句子，而演示宿主槽位 id 形如 `slot_1`，直出就是玩家从没见过的「槽位 slot_2」，
 * 而他在面板上点的是「槽位 2」。
 *
 * 未改写句子的来源也一并锚住：整张文案表必须是引擎缺省表的摊开，而不是另起一份
 * 手写表——后者会在引擎新增句子时静默漏接。
 */
import { describe, expect, it } from "vitest";
import { defaultEngineTexts, type EngineTexts } from "@lingfan/engine";
import { playgroundEngineTexts } from "../../apps/playground/src/host/engine/engine-texts";

describe("宿主引擎文案（槽位名与面板同源）", () => {
  it("用户实测回归：读档失败报面板上的槽位名，不报槽位 id", () => {
    const message = playgroundEngineTexts.loadReadFailed("slot_2", "boom");
    expect(message).toContain("槽位 2");
    expect(message).not.toContain("slot_2");
    expect(message).toContain("boom");
  });

  it("用户实测回归：写档失败同样报面板上的槽位名", () => {
    const message = playgroundEngineTexts.saveWriteFailed("slot_12", "disk");
    expect(message).toContain("槽位 12");
    expect(message).not.toContain("slot_12");
  });

  it("非 slot_ 形状的槽位 id 原样透传（与面板显示名规则同一处）", () => {
    const message = playgroundEngineTexts.loadReadFailed("quick", "e");
    expect(message).toContain("quick");
    expect(message).not.toContain("槽位");
  });

  it("未改写的句子逐条仍是引擎缺省（整表是缺省表的摊开）", () => {
    const overridden = new Set(["loadReadFailed", "saveWriteFailed"]);
    const keys = Object.keys(defaultEngineTexts) as (keyof EngineTexts)[];
    for (const key of keys) {
      if (overridden.has(key)) continue;
      expect(playgroundEngineTexts[key]).toBe(defaultEngineTexts[key]);
    }
    expect(Object.keys(playgroundEngineTexts).sort()).toEqual([...keys].sort());
  });
});
