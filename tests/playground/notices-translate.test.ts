/**
 * 参考宿主提示条双轨接线（apps/playground/src/host/engine/app-events）：
 * createAppEvents 把引擎 translate 注入 createNotices——玩家可见整句
 * （存/读/回溯完成）先查当前语言 overlay，未命中回落缺省模板；
 * 读档诊断（loadNotice）是开发者诊断，原样出站不查表。
 *
 * 锁三件事：overlay 命中即译文、未命中回落缺省句、诊断不迁。
 * shell 双轨本体由 tests/shell/notices/overlay-fallback.test.ts 锁，
 * 这里测「宿主把翻译能力接对」——含重启换引擎后翻译跟随新实例。
 */
import type { StoryEngine } from "@lingfan-engine/core";
import { describe, expect, it } from "vitest";
import {
  createAppEvents,
  type AppEventsOptions,
} from "../../apps/playground/src/host/engine/app-events";
import type { AppMedia } from "../../apps/playground/src/host/stage/media/app-media";
import type { VueNarrativeState } from "../../apps/playground/src/host/narrative/runtime/narrative-state";
import type { TypewriterHandle } from "../../apps/playground/src/host/narrative/wiring/app-narrative";

/** 普通单元格（Cell 结构同形 { value }）：本装配只同步读写这些字段，
 * 不需要 Vue 响应式；避开根 vue 与 apps vue 双补丁版的 Ref 品牌不互通（既有问题）。 */
const cell = <T>(value: T): { value: T } => ({ value });

/** 叙事状态替身：只实现本装配消费到的字段与方法（装配期解构 + 事件落点转发） */
function fakeNarrative(): VueNarrativeState {
  return {
    canAdvance: cell(false),
    inWait: cell(false),
    inVideo: cell(false),
    inputValue: cell(""),
    shownText: cell(""),
    handleState: () => {},
    syncFromEngine: () => {},
  } as unknown as VueNarrativeState;
}

/** 媒体替身：渲染器缺席（syncMedia 的可选链安全路径） */
const fakeMedia = {} as AppMedia;

/** 打字机替身：无活动实例（本测试不触发舞台点击） */
const fakeTypewriter = { get: () => null } as unknown as TypewriterHandle;

/** 引擎替身：只实现 translate（本装配的提示条翻译唯一消费面） */
function engineWith(overlay: Map<string, string>): StoryEngine {
  return {
    translate: (text: string) => overlay.get(text) ?? text,
  } as unknown as StoryEngine;
}

function assemble(overlay: Map<string, string>) {
  let engine = engineWith(overlay);
  // 入参整体经 unknown 转契约形：error 的 Ref 品牌在根 vue 与 apps vue
  // 双补丁版间不互通（既有问题）；替身只测接线，不消费 Vue 响应式语义
  const options = {
    narrative: fakeNarrative(),
    media: fakeMedia,
    error: cell(""),
    getEngine: () => engine,
    typewriter: fakeTypewriter,
  } as unknown as AppEventsOptions;
  const events = createAppEvents(options);
  return {
    events,
    swapEngine: (next: Map<string, string>) => (engine = engineWith(next)),
  };
}

/** 最新一条提示的文案 */
const lastText = (events: ReturnType<typeof assemble>["events"]): string =>
  events.notifications.value.at(-1)?.text ?? "";

describe("玩家可见整句：overlay 优先、未命中回落", () => {
  it("saved 整句命中 overlay ⇒ 译文出站", () => {
    const { events } = assemble(
      new Map([["已保存到 槽位 1", "Saved to slot 1"]]),
    );
    events.narrativeEvents.saved("slot_1");
    expect(lastText(events)).toBe("Saved to slot 1");
  });

  it("overlay 未命中 ⇒ 回落缺省模板（含槽位显示名）", () => {
    const { events } = assemble(new Map());
    events.narrativeEvents.saved("slot_1");
    expect(lastText(events)).toBe("已保存到 槽位 1");
    events.narrativeEvents.loaded("slot_2");
    expect(lastText(events)).toBe("已读取 槽位 2（回到存档时刻）");
    events.narrativeEvents.rollbackDone();
    expect(lastText(events)).toBe("已回溯");
  });

  it("逐句混合：命中用译文、未命中用缺省句", () => {
    const { events } = assemble(new Map([["已回溯", "Rolled back"]]));
    events.narrativeEvents.saved("slot_1");
    events.narrativeEvents.rollbackDone();
    const texts = events.notifications.value.map((n) => n.text);
    expect(texts).toContain("已保存到 槽位 1");
    expect(texts).toContain("Rolled back");
  });

  it("重启换引擎后翻译跟随新实例（getEngine 现取）", () => {
    const { events, swapEngine } = assemble(new Map());
    events.narrativeEvents.rollbackDone();
    expect(lastText(events)).toBe("已回溯");
    swapEngine(new Map([["已回溯", "Rolled back"]]));
    events.narrativeEvents.rollbackDone();
    expect(lastText(events)).toBe("Rolled back");
  });
});

describe("开发者诊断不迁", () => {
  it("loadNotice 原样出站，即使 overlay 收录同文案也不查表", () => {
    const diagnostic = "存档版本较旧：已按兼容模式读取";
    const { events } = assemble(new Map([[diagnostic, "SHOULD NOT APPEAR"]]));
    events.narrativeEvents.loadNotice(diagnostic);
    expect(lastText(events)).toBe(diagnostic);
  });

  it("notify（引擎通知事件）原样出站不查表", () => {
    const { events } = assemble(new Map([["系统通知", "SHOULD NOT APPEAR"]]));
    events.narrativeEvents.notify("系统通知", "info", undefined);
    expect(lastText(events)).toBe("系统通知");
  });
});
