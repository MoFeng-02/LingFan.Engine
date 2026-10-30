/**
 * 启动界面「继续」按钮的存档面契约测试：`SavePort.list()` → 挑槽 → 按钮状态。
 *
 * 守的是三件在演示工程里看不出来的事：
 *
 * 1. **「最近」= `timestamp` 最大**，不是「数组第一个」也不是「槽名最小」。
 *    原生端的 `save_list` 返回顺序取决于目录枚举，把它当有序用就是随机跳档。
 * 2. **无档是合法返回值**（空数组），不是错误。宿主 `reloadSaves()` 把它当异常处理
 *    就会在首启时弹错——而首启无档是**最常见**的状态。
 * 3. **挑不出槽 = 按钮必须置灰并给提示**。静默绑定一个 `undefined` 槽会让按钮看着可点、
 *    点了没反应，这种「像在工作」的缺陷没有报错可查。
 *
 * 这里按契约造 `SavePort` 替身（只实现 `packages/core` 的 `SavePort` 四个方法），
 * 不替身 `continueSlot` / `latestSave` 的实现——被验的正是挑选规则本身。
 */
import { describe, expect, it } from "vitest";
import type { SavePort, SlotSummary } from "@lingfan-engine/core";
import { continueSlot, latestSave, screenViewOf } from "@lingfan-engine/ui";

/**
 * 按契约造的存档端口替身：内存表，`list()` 按**乱序**返回。
 *
 * 乱序是刻意的：真实 `save_list` 的返回顺序由目录枚举决定，按「数组第 0 个就是最新」
 * 写的实现必须在这里失败，否则这条判据就白守了。
 */
function createSavePort(summaries: readonly SlotSummary[]): SavePort {
  return {
    async write(): Promise<void> {
      throw new Error("本替身只用于读取场景");
    },
    async read(): Promise<string> {
      throw new Error("本替身只用于读取场景");
    },
    async remove(): Promise<void> {
      throw new Error("本替身只用于读取场景");
    },
    async list(): Promise<SlotSummary[]> {
      return [...summaries];
    },
  };
}

/** 造一条槽位摘要：`saveCount` 与 `timestamp` 分开给，好让「取最大」只可能靠时间戳 */
function summary(slot: string, timestamp: number, saveCount = 1): SlotSummary {
  return { slot, saveCount, timestamp, mode: "machine-bound" };
}

describe("SavePort.list() → 继续按钮", () => {
  it("有档：按 timestamp 取最大列出，与数组顺序无关", async () => {
    const port = createSavePort([
      summary("slot_2", 1_700_000_300_000, 3),
      summary("slot_1", 1_700_000_100_000, 1),
      summary("slot_3", 1_700_000_200_000, 2),
    ]);
    const slots = ["slot_1", "slot_2", "slot_3"];

    const saves = await port.list();
    // 替身原样返回：证明判据不是「先替身排好序」蒙过去的
    expect(saves.map((s) => s.slot)).toEqual(["slot_2", "slot_1", "slot_3"]);

    expect(latestSave(saves, slots)?.slot).toBe("slot_2");
    expect(continueSlot(saves, slots)).toEqual({ slot: "slot_2" });
  });

  it("只认配置内的槽：历史遗留槽再新也不选", async () => {
    // 工程把槽位数从 6 改到 3 之后，`list()` 仍会带回 slot_4/5/6 的旧档
    const port = createSavePort([
      summary("slot_6", 1_700_000_900_000, 9),
      summary("slot_1", 1_700_000_100_000, 1),
    ]);
    const slots = ["slot_1", "slot_2", "slot_3"];

    expect(latestSave(await port.list(), slots)?.slot).toBe("slot_1");
  });

  it("无档：空数组是合法返回值，不抛且「继续」置灰带提示", async () => {
    const port = createSavePort([]);
    const slots = ["slot_1", "slot_2", "slot_3"];

    // ① 端口本身不抛（空数组不是错误）
    await expect(port.list()).resolves.toEqual([]);

    // ② 挑不出槽 = slot 为 undefined（按钮据此 disabled）
    expect(continueSlot([], slots)).toEqual({ slot: undefined });
    expect(latestSave([], slots)).toBeUndefined();

    // ③ 折成渲染输入后：slot 与 reason 互补——不可继续时 slot 无值、reason 有话说
    const view = screenViewOf({
      columnId: "",
      columnType: "game",
      title: "示例工程",
      slots,
      saves: [],
      start: () => {},
      load: () => {},
    });
    expect(view.screen).toBe("start");
    expect(view.resume.slot).toBeUndefined();
    expect(view.resume.reason).not.toBe("");
  });
});
