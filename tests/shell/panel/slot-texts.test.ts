/**
 * 引擎文案的槽位名整形：报错里的槽位名 = 面板上的槽位名。
 *
 * 用户实测回归（随规则一起从演示宿主上移）：引擎缺省模板把槽位 id 原样嵌进句子，
 * 而槽位 id 形如 `slot_1`，直出就是玩家从没见过的「槽位 slot_2」，他在面板上点的
 * 却是「槽位 2」。规则收在这里后，各宿主共用同一处改名，底表可换（本地化）而规则不动。
 */
import { defaultEngineTexts } from "@lingfan/engine";
import { describe, expect, it } from "vitest";
import { withSlotLabels } from "../../../packages/shell/src/panel";

describe("引擎文案的槽位名整形", () => {
  it("用户实测回归：读档失败报面板上的槽位名，不报槽位 id", () => {
    const texts = withSlotLabels(defaultEngineTexts);
    const message = texts.loadReadFailed("slot_2", "boom");
    expect(message).toContain("槽位 2");
    expect(message).not.toContain("slot_2");
    expect(message).toContain("boom");
  });

  it("用户实测回归：写档失败同样报面板上的槽位名", () => {
    const texts = withSlotLabels(defaultEngineTexts);
    const message = texts.saveWriteFailed("slot_12", "disk");
    expect(message).toContain("槽位 12");
    expect(message).not.toContain("slot_12");
  });

  it("非 slot_ 形状的槽位 id 原样透传（与面板显示名规则同一处）", () => {
    const texts = withSlotLabels(defaultEngineTexts);
    const message = texts.loadReadFailed("quick", "e");
    expect(message).toContain("quick");
    expect(message).not.toContain("槽位");
  });

  it("未改写的句子沿用传入底表（换底表即本地化，规则不动）", () => {
    const texts = withSlotLabels(defaultEngineTexts);
    const keys = Object.keys(defaultEngineTexts);
    for (const key of keys) {
      if (key === "loadReadFailed" || key === "saveWriteFailed") continue;
      expect(texts[key as keyof typeof texts]).toBe(
        defaultEngineTexts[key as keyof typeof defaultEngineTexts],
      );
    }
    expect(Object.keys(texts).sort()).toEqual([...keys].sort());

    const localized = withSlotLabels({
      ...defaultEngineTexts,
      callSceneColumn: (name: string) => `cannot call ${name}`,
    });
    expect(localized.callSceneColumn("foo")).toBe("cannot call foo");
    expect(localized.loadReadFailed("slot_3", "e")).toContain("槽位 3");
  });
});
