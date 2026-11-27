/**
 * 小程序层外部接管等待态的 fail-closed 诊断：三种挂载事件必须显式出声。
 *
 * 本宿主没有 minigame / interaction / extension 的渲染通道——故事停在这些等待态时，
 * 静默只改状态等于「永久停滞且无从下手」。判据锁三件事：
 * - 三种事件各有整句诊断（带身份与离开办法）；其余事件不产诊断。
 * - 同一次接管只报一次（seq 进键：重放重新挂载要能重新出声）。
 * - 宿主装配真的接了这个出口（源码互锁），且回溯完成也走同一订阅对齐媒体。
 */
import { describe, expect, it } from "vitest";
import type { OutboundPayload } from "@lingfan-engine/core";
import {
  createTakeoverNoticeGate,
  takeoverNoticeOf,
} from "../../template/v1/overlays/miniprogram/src/mp/takeover-notice";
import mpHostSource from "../../template/v1/overlays/miniprogram/src/mp/host.ts?raw";

const signal = new AbortController().signal;

function payload(kind: string): OutboundPayload {
  switch (kind) {
    case "minigame.mount":
      return { kind, game: "puzzle", config: {}, signal, seq: 1 };
    case "interaction.mount":
      return { kind, system: "walk", config: {}, signal, seq: 2 };
    case "extension.mount":
      return {
        kind,
        op: "demo_wait",
        extensionId: "demo",
        config: {},
        signal,
        seq: 3,
      };
    default:
      return { kind: "notify", text: "无关事件" } as OutboundPayload;
  }
}

describe("接管诊断翻译（mp-takeover-notice-kinds）", () => {
  it("三种接管事件各有整句诊断：身份 + 停滞后果 + 离开办法", () => {
    for (const [kind, identity] of [
      ["minigame.mount", "puzzle"],
      ["interaction.mount", "walk"],
      ["extension.mount", "demo_wait"],
    ] as const) {
      const notice = takeoverNoticeOf(payload(kind), "小程序宿主");
      expect(notice, kind).not.toBeNull();
      expect(notice!.text).toContain(identity);
      expect(notice!.text).toContain("小程序宿主");
      expect(notice!.text).toContain("回溯");
      expect(notice!.key).toContain(identity);
    }
  });

  it("非接管事件不产诊断（notify / save.done 等）", () => {
    expect(takeoverNoticeOf(payload("notify"), "小程序宿主")).toBeNull();
    expect(
      takeoverNoticeOf({ kind: "save.done", slot: "slot_1" }, "小程序宿主"),
    ).toBeNull();
  });

  it("去重键含 seq：重放重新挂载（新 seq）要能重新出声", () => {
    const first = takeoverNoticeOf(payload("minigame.mount"), "x")!;
    const replay = takeoverNoticeOf(
      { kind: "minigame.mount", game: "puzzle", config: {}, signal, seq: 9 },
      "x",
    )!;
    expect(first.key).not.toBe(replay.key);
  });
});

describe("去重出口（mp-takeover-notice-dedupe）", () => {
  it("同一 key 只放行一次；reset 后重新出声", () => {
    const gate = createTakeoverNoticeGate();
    expect(gate.admit("k")).toBe(true);
    expect(gate.admit("k")).toBe(false);
    gate.reset();
    expect(gate.admit("k")).toBe(true);
  });
});

describe("宿主装配接线（mp-takeover-wired）", () => {
  it("事件订阅认领三种接管并接去重出口", () => {
    expect(mpHostSource).toContain("takeoverNoticeOf(payload");
    expect(mpHostSource).toContain("takeoverGate.admit(notice.key)");
  });

  it("同一订阅里 rollback.done 对齐媒体与投影（滚轮回退不再有第二份对齐）", () => {
    expect(mpHostSource).toContain('payload.kind === "rollback.done"');
    const at = mpHostSource.indexOf('payload.kind === "rollback.done"');
    const tail = mpHostSource.slice(at, at + 200);
    expect(tail).toContain("overlay.sync()");
    expect(tail).toContain("syncMedia()");
  });

  it("load.notice 落诊断口（非致命知情，不静默）", () => {
    expect(mpHostSource).toContain('payload.kind === "load.notice"');
  });
});
