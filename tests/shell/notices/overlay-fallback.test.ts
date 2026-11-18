/**
 * 提示条文案双轨：译文（translate 查表）优先，未命中回落缺省模板/宿主覆盖句。
 *
 * 查表函数按引擎 translate 的契约替身实现（命中给译文、未命中返回原文），
 * 不复制引擎实现；缺省模板本身的行为由 default-texts.test.ts 锁住，这里只测双轨接线。
 */
import { describe, expect, it, vi } from "vitest";

import type { TimerHandle, TimerPort } from "@lingfan-engine/core";

import { createNotices } from "../../../packages/shell/src/notices";

/** 假计时器：只记录登记，不到期（本组用例不关心摘除） */
function fakeTimer(): TimerPort {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    set(fn: () => void, ms: number): TimerHandle {
      pending.push({ fn, ms });
      return pending.length as unknown as TimerHandle;
    },
    clear(): void {},
  };
}

/** 契约替身：译文表命中给译文，未命中返回原文（同引擎 translate） */
function fakeTranslate(table: ReadonlyMap<string, string>) {
  return vi.fn((text: string): string => table.get(text) ?? text);
}

describe("提示条文案：双轨", () => {
  it("译文命中时三类动作提示都给译文（整句查表）", () => {
    const translate = fakeTranslate(
      new Map([
        ["已保存到 槽位 1", "Saved to Slot 1"],
        ["已读取 槽位 2（回到存档时刻）", "Loaded Slot 2 (back to save point)"],
        ["已回溯", "Rolled back"],
      ]),
    );
    const notices = createNotices({ timer: fakeTimer(), translate });
    notices.saved("slot_1");
    notices.loaded("slot_2");
    notices.rollbackDone();
    expect(notices.items.value.map((n) => n.text)).toEqual([
      "Saved to Slot 1",
      "Loaded Slot 2 (back to save point)",
      "Rolled back",
    ]);
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it("译文未命中时回落缺省模板（引擎返回原文即天然回落）", () => {
    const translate = fakeTranslate(new Map([["别的句子", "Other"]]));
    const notices = createNotices({ timer: fakeTimer(), translate });
    notices.saved("slot_1");
    notices.loaded("slot_3");
    notices.rollbackDone();
    expect(notices.items.value.map((n) => n.text)).toEqual([
      "已保存到 槽位 1",
      "已读取 槽位 3（回到存档时刻）",
      "已回溯",
    ]);
  });

  it("宿主覆盖句（旧键）仍是回落基准：未命中时给覆盖句", () => {
    const translate = fakeTranslate(new Map());
    const notices = createNotices({
      timer: fakeTimer(),
      translate,
      texts: { saved: (slot) => `SAVED:${slot}` },
    });
    notices.saved("slot_9");
    expect(notices.items.value[0]?.text).toBe("SAVED:slot_9");
    expect(translate).toHaveBeenCalledWith("SAVED:slot_9");
  });

  it("逐句混合：命中的给译文，未命中的给缺省模板", () => {
    const translate = fakeTranslate(new Map([["已回溯", "Rolled back"]]));
    const notices = createNotices({ timer: fakeTimer(), translate });
    notices.saved("slot_1");
    notices.rollbackDone();
    expect(notices.items.value.map((n) => n.text)).toEqual([
      "已保存到 槽位 1",
      "Rolled back",
    ]);
  });

  it("不传查表时行为与旧版全同（缺省模板/覆盖句原样）", () => {
    const notices = createNotices({ timer: fakeTimer() });
    notices.saved("slot_1");
    expect(notices.items.value[0]?.text).toBe("已保存到 槽位 1");
  });

  it("引擎旁路通知（notify/loadNotice）不经查表——文本由引擎读口供译文", () => {
    const translate = fakeTranslate(new Map([["警告", "Warning"]]));
    const notices = createNotices({ timer: fakeTimer(), translate });
    notices.notify("警告", "warn", undefined);
    notices.loadNotice("警告");
    expect(notices.items.value.map((n) => n.text)).toEqual(["警告", "警告"]);
    expect(translate).not.toHaveBeenCalled();
  });
});
