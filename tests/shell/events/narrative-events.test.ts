/**
 * 叙事事件落点：收尾顺序与错误横幅的生命周期。
 *
 * 回归锚定（用户实测回归）：读档失败在底部留下红字横幅后，再成功存一次档，红字
 * 仍然挂着（此前只有读档与回溯会清它）——横幅报的是「上一次操作的结果」，这一次
 * 既然成功，上一次的失败就已经过期。写档不动画面，故只清错误，不对齐视图与媒体。
 *
 * 本文件只锚分流落点自身，事件怎么分流（哪个 `kind` 走哪条）留在组合根。
 */
import { describe, expect, it } from "vitest";
import type { Cell } from "../../../packages/shell/src/cell";
import type { Notice } from "../../../packages/shell/src/notices";
import {
  createNarrativeEvents,
  type NarrativeEventOptions,
  type NarrativeEvents,
} from "../../../packages/shell/src/events";

/** 记录调用顺序的落点替身：只关心「谁被调了、什么次序、带了什么」 */
function createHarness(overrides: Partial<NarrativeEventOptions> = {}): {
  events: NarrativeEvents;
  calls: string[];
  errors: string[];
} {
  const calls: string[] = [];
  const errors: string[] = [];
  const items: Cell<Notice[]> = { value: [] };
  const options: NarrativeEventOptions = {
    notices: {
      items,
      push: () => calls.push("push"),
      notify: (text, notifyType, durationMs) =>
        calls.push(
          `notify:${text}:${String(notifyType)}:${String(durationMs)}`,
        ),
      toast: () => calls.push("toast"),
      saved: (slot) => calls.push(`saved:${slot}`),
      loaded: (slot) => calls.push(`loaded:${slot}`),
      rollbackDone: () => calls.push("rollbackDone"),
      loadNotice: (text) => calls.push(`loadNotice:${text}`),
    },
    clearError: () => calls.push("clearError"),
    syncFromEngine: () => calls.push("syncFromEngine"),
    syncMedia: () => calls.push("syncMedia"),
    reportError: (message) => {
      calls.push("reportError");
      errors.push(message);
    },
    ...overrides,
  };
  return { events: createNarrativeEvents(options), calls, errors };
}

describe("叙事事件落点", () => {
  it("用户实测回归：写档成功清掉上一次失败留下的红字", () => {
    const { events, calls, errors } = createHarness();
    events.failed("load-failed", "槽位 2 读取或解析失败");
    expect(errors).toEqual(["load-failed: 槽位 2 读取或解析失败"]);

    calls.length = 0;
    events.saved("slot_3");
    expect(calls).toEqual(["clearError", "saved:slot_3"]);
  });

  it("写档不动画面：只清错误，不对齐视图与媒体", () => {
    const { events, calls } = createHarness();
    events.saved("slot_1");
    expect(calls).not.toContain("syncFromEngine");
    expect(calls).not.toContain("syncMedia");
  });

  it("读档收尾顺序：清错误 → 对齐视图 → 对齐媒体 → 提示", () => {
    const { events, calls } = createHarness();
    events.loaded("slot_1");
    expect(calls).toEqual([
      "clearError",
      "syncFromEngine",
      "syncMedia",
      "loaded:slot_1",
    ]);
  });

  it("回溯走同一条收尾顺序", () => {
    const { events, calls } = createHarness();
    events.rollbackDone();
    expect(calls).toEqual([
      "clearError",
      "syncFromEngine",
      "syncMedia",
      "rollbackDone",
    ]);
  });

  it("引擎错误进错误横幅：缺省拼法 `code: message`", () => {
    const { events, errors } = createHarness();
    events.failed("save-format", "存档结构不完整");
    expect(errors).toEqual(["save-format: 存档结构不完整"]);
  });

  it("错误拼法可整体覆盖（本地化入口）", () => {
    const { events, errors } = createHarness({
      formatError: (code, message) => `[${code}] ${message}`,
    });
    events.failed("load-failed", "读不到");
    expect(errors).toEqual(["[load-failed] 读不到"]);
  });

  it("通知与读档诊断原样透传（语气、时长、文案都不改写）", () => {
    const { events, calls } = createHarness();
    events.notify("提示文本", "warning", 2500);
    events.loadNotice("存档已迁移");
    expect(calls).toEqual([
      "notify:提示文本:warning:2500",
      "loadNotice:存档已迁移",
    ]);
  });
});
