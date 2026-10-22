/**
 * 提示条编排：缺省文案、槽位显示名来源与驻留摘除。
 *
 * 用户实测回归：存读档提示条里的槽位名必须与槽位面板同规——面板写「槽位 1」，
 * 提示条也写「槽位 1」，不得退回槽位 id（`已保存到 slot_1`）。逐句覆盖与
 * `labelFor` 覆盖的优先级也在此锁住。
 */
import type { TimerHandle, TimerPort } from "@lingfan-engine/core";
import { describe, expect, it } from "vitest";
import { createNotices } from "../../../packages/shell/src/notices";
import { defaultSlotLabel } from "../../../packages/shell/src/panel";

/** 受控定时器：只记下「谁排在哪一档」，不真正等时钟 */
function fakeTimer(): TimerPort & {
  pending: Array<{ fn: () => void; ms: number }>;
} {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    pending,
    set(fn, ms) {
      pending.push({ fn, ms });
      return pending.length as unknown as TimerHandle;
    },
    clear() {
      // 本套用例不取消排期，占位实现即可
    },
  };
}

describe("提示条缺省文案", () => {
  it("存/读文案用槽位显示名，不是槽位 id", () => {
    const notices = createNotices();
    notices.saved("slot_1");
    notices.loaded("slot_3");
    notices.rollbackDone();
    expect(notices.items.value.map((n) => n.text)).toEqual([
      "已保存到 槽位 1",
      "已读取 槽位 3（回到存档时刻）",
      "已回溯",
    ]);
  });

  it("槽位名与槽位面板同一规则（defaultSlotLabel）", () => {
    const notices = createNotices();
    notices.loaded("slot_2");
    expect(notices.items.value[0]?.text).toContain(defaultSlotLabel("slot_2"));
    expect(defaultSlotLabel("slot_2")).toBe("槽位 2");
  });

  it("不符合缺省命名的槽位 id 原样透传", () => {
    const notices = createNotices();
    notices.saved("quick-save");
    expect(notices.items.value[0]?.text).toBe("已保存到 quick-save");
  });

  it("宿主自定义 labelFor 时提示条跟着改（与面板同传即同名）", () => {
    const notices = createNotices({
      labelFor: (id: string): string => `存档 ${id}`,
    });
    notices.saved("slot_1");
    expect(notices.items.value[0]?.text).toBe("已保存到 存档 slot_1");
  });

  it("texts 逐句覆盖优先于缺省模板，未覆盖的句子仍走缺省", () => {
    const notices = createNotices({
      labelFor: () => "自定义名",
      texts: { saved: (slot) => `SAVED:${slot}` },
    });
    notices.saved("slot_1");
    notices.loaded("slot_1");
    expect(notices.items.value.map((n) => n.text)).toEqual([
      "SAVED:slot_1",
      "已读取 自定义名（回到存档时刻）",
    ]);
  });
});

describe("提示条驻留与语气", () => {
  it("存/读/回溯各用自己那一档驻留", () => {
    const timer = fakeTimer();
    const notices = createNotices({
      timer,
      toastDurationMs: 111,
      loadToastDurationMs: 222,
      rollbackNoticeDurationMs: 333,
    });
    notices.saved("slot_1");
    notices.loaded("slot_1");
    notices.rollbackDone();
    expect(timer.pending.map((p) => p.ms)).toEqual([111, 222, 333]);
  });

  it("到期按 id 摘除，同文案的另一条不受影响", () => {
    const timer = fakeTimer();
    const notices = createNotices({ timer });
    notices.saved("slot_1");
    notices.saved("slot_1");
    const [first, second] = notices.items.value;
    expect(notices.items.value).toHaveLength(2);
    expect(first?.id).not.toBe(second?.id);
    timer.pending[0]?.fn();
    expect(notices.items.value.map((n) => n.id)).toEqual([second?.id]);
  });

  it("引擎侧读档诊断走 warning 语气（非致命但要宿主知情）", () => {
    const notices = createNotices();
    notices.loadNotice("存档版本与当前故事不符");
    expect(notices.items.value[0]).toMatchObject({
      text: "存档版本与当前故事不符",
      tone: "warning",
    });
  });

  it("push / toast 可显式给时长与语气（模板皮肤按 tone 选）", () => {
    const timer = fakeTimer();
    const notices = createNotices({ timer, toastDurationMs: 999 });
    notices.toast("操作成功");
    notices.push("出错了", "error", 50);
    expect(timer.pending.map((p) => p.ms)).toEqual([999, 50]);
    expect(notices.items.value.map((n) => n.tone)).toEqual(["info", "error"]);
  });
});
