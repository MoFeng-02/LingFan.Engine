/**
 * 槽位面板的数据装配：显示名来源、空槽判定、读取容错与点选门槛。
 *
 * 回归锚定（用户实测回归）：用户在演示宿主里存完档再点读档，判断「没反应」。
 * 一是面板显示名与提示条文案分叉，二是读档模式下空槽照样可点（点下去只换来一条
 * 读档失败横幅），三是端口拒读个别槽位时整张面板列不出槽位——最后这条才是「没反应」
 * 的正身：面板照旧打开，槽位却一个都没有。三条都在这里锁住。
 */
import type { SavePort, SlotSummary } from "@lingfan/engine";
import { describe, expect, it } from "vitest";
import {
  canChooseSlot,
  defaultSlotLabel,
  loadSlotViews,
  parseSlotMeta,
  type SlotView,
} from "../../../packages/shell/src/panel";
import { createNotices } from "../../../packages/shell/src/notices";

const SLOT_IDS = ["slot_1", "slot_2", "slot_3"] as const;
const TIMESTAMP = 1_700_000_000_000;

/**
 * 只读存档端口：面板只该 list/read；写与删一律判红，
 * 这样一旦面板越界动了存档，用例立刻失败而不是悄悄通过。
 */
function fakeSavePort(stored: Record<string, string>): SavePort {
  return {
    async list(): Promise<SlotSummary[]> {
      return Object.keys(stored).map((slot) => ({
        slot,
        saveCount: 1,
        timestamp: TIMESTAMP,
        mode: "machine-bound",
      }));
    },
    async read(slot: string): Promise<string> {
      const raw = stored[slot];
      if (raw === undefined) throw new Error(`槽位不存在：${slot}`);
      return raw;
    },
    async write(): Promise<void> {
      throw new Error("面板不得写入存档端口");
    },
    async remove(): Promise<void> {
      throw new Error("面板不得删除槽位");
    },
  };
}

describe("槽位显示名", () => {
  it("缺省规则：slot_N → 槽位 N，其余 id 原样", () => {
    expect(defaultSlotLabel("slot_1")).toBe("槽位 1");
    expect(defaultSlotLabel("slot_12")).toBe("槽位 12");
    expect(defaultSlotLabel("quick")).toBe("quick");
  });

  it("视图 label 与提示条文案同源：面板写「槽位 1」，提示条就不再写 slot_1", async () => {
    const notices = createNotices();
    const views = await loadSlotViews({
      savePort: fakeSavePort({ slot_1: "{}" }),
      slotIds: SLOT_IDS,
    });
    const first = views.find((v) => v.id === "slot_1");
    expect(first?.label).toBe("槽位 1");
    notices.saved("slot_1");
    expect(notices.items.value[0]?.text).toBe("已保存到 槽位 1");
    expect(notices.items.value[0]?.text).toContain(first?.label ?? "");
  });

  it("宿主自定义 labelFor 时面板整列跟着改", async () => {
    const views = await loadSlotViews({
      savePort: fakeSavePort({}),
      slotIds: SLOT_IDS,
      labelFor: (id) => `存档 ${id}`,
    });
    expect(views.map((v) => v.label)).toEqual([
      "存档 slot_1",
      "存档 slot_2",
      "存档 slot_3",
    ]);
  });
});

describe("槽位视图装配", () => {
  it("空槽 empty=true，且不呈现时间戳与标题", async () => {
    const views = await loadSlotViews({
      savePort: fakeSavePort({}),
      slotIds: SLOT_IDS,
    });
    expect(views.map((v) => v.empty)).toEqual([true, true, true]);
    expect(views.every((v) => v.timestamp === undefined)).toBe(true);
    expect(views.every((v) => v.title === undefined)).toBe(true);
  });

  it("有档则 empty=false，并取出快照里的标题与缩略图", async () => {
    const views = await loadSlotViews({
      savePort: fakeSavePort({
        slot_2: JSON.stringify({
          title: "第二章",
          screenshot: "data:image/png;base64,AA",
        }),
      }),
      slotIds: SLOT_IDS,
    });
    expect(views.find((v) => v.id === "slot_2")).toEqual({
      id: "slot_2",
      label: "槽位 2",
      empty: false,
      timestamp: TIMESTAMP,
      title: "第二章",
      screenshot: "data:image/png;base64,AA",
    });
  });

  it("槽位顺序跟随 slotIds，与清单返回顺序无关", async () => {
    const views = await loadSlotViews({
      savePort: fakeSavePort({ slot_3: "{}", slot_1: "{}" }),
      slotIds: SLOT_IDS,
    });
    expect(views.map((v) => v.id)).toEqual(["slot_1", "slot_2", "slot_3"]);
  });

  it("清单整体读不到按全空槽呈现（面板不因此炸掉）", async () => {
    const savePort: SavePort = {
      ...fakeSavePort({ slot_1: "{}" }),
      async list(): Promise<SlotSummary[]> {
        throw new Error("存档端口不可用");
      },
    };
    const views = await loadSlotViews({ savePort, slotIds: SLOT_IDS });
    expect(views.map((v) => v.empty)).toEqual([true, true, true]);
  });

  it("单槽内容损坏只丢该槽的标题，empty 判定仍按清单为准", async () => {
    const views = await loadSlotViews({
      savePort: fakeSavePort({ slot_1: "{ 这不是 JSON" }),
      slotIds: SLOT_IDS,
    });
    const broken = views.find((v) => v.id === "slot_1");
    expect(broken?.empty).toBe(false);
    expect(broken?.title).toBeUndefined();
    expect(broken?.screenshot).toBeUndefined();
  });

  it("用户实测回归：个别槽读取被端口拒绝时，整张面板照样列出全部槽位", async () => {
    // 端口可以拒读某些槽（演示端高水位拒旧档、宿主安全策略）；这种拒绝一旦冒泡出
    // loadSlotViews，宿主拿到的就是被拒的 Promise——面板照旧打开，槽位却一个都不列，
    // 玩家看到的就是「点了存再点读档没反应」。
    const base = fakeSavePort({ slot_1: "{}", slot_2: "{}" });
    const savePort: SavePort = {
      ...base,
      async read(slot: string): Promise<string> {
        if (slot === "slot_1") throw new Error("回档尝试被拒绝（演示高水位）");
        return base.read(slot);
      },
    };
    const views = await loadSlotViews({ savePort, slotIds: SLOT_IDS });
    expect(views.map((v) => v.id)).toEqual(["slot_1", "slot_2", "slot_3"]);
    const rejected = views.find((v) => v.id === "slot_1");
    expect(rejected?.empty).toBe(false);
    expect(rejected?.timestamp).toBe(TIMESTAMP);
    expect(rejected?.title).toBeUndefined();
    expect(rejected?.screenshot).toBeUndefined();
    expect(views.find((v) => v.id === "slot_2")?.empty).toBe(false);
    expect(views.find((v) => v.id === "slot_3")?.empty).toBe(true);
  });
});

describe("parseSlotMeta 容错", () => {
  it("字段齐全则逐项取出", () => {
    expect(parseSlotMeta('{"title":"支线","screenshot":"data:x"}')).toEqual({
      title: "支线",
      screenshot: "data:x",
    });
  });

  it("非 JSON、非对象、字段类型不符都按「没有」处理", () => {
    expect(parseSlotMeta("{ 坏档")).toEqual({});
    expect(parseSlotMeta("[1,2,3]")).toEqual({});
    expect(parseSlotMeta('{"title":7,"screenshot":false}')).toEqual({});
  });
});

describe("点选门槛（canChooseSlot）", () => {
  const filled: SlotView = { id: "slot_1", label: "槽位 1", empty: false };
  const blank: SlotView = { id: "slot_2", label: "槽位 2", empty: true };

  it("存档模式：空槽可点（点下去就是一次覆盖写入）", () => {
    expect(canChooseSlot(blank, "save")).toBe(true);
    expect(canChooseSlot(filled, "save")).toBe(true);
  });

  it("读档模式：空槽不可点，有档可点", () => {
    expect(canChooseSlot(blank, "load")).toBe(false);
    expect(canChooseSlot(filled, "load")).toBe(true);
  });

  it("面板未打开（mode = null）一律不可点", () => {
    expect(canChooseSlot(filled, null)).toBe(false);
    expect(canChooseSlot(blank, null)).toBe(false);
  });
});
