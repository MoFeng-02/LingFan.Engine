/**
 * 叙事视图状态：输入候选的订阅与落地。
 *
 * 候选是 `{ text, value }` 的对象数组（与菜单的 `{ text, target }` 刻意不同名）。
 * 本文件锁三件事：候选随状态键落到单元、畸形项整项丢弃、整体回档时也重新读一遍
 * （读档后界面不能留着上一局的候选）。
 */
import { describe, expect, it, vi } from "vitest";
import { SYS } from "@lingfan-engine/core";
import { createNarrativeState } from "../../../packages/shell/src/state/narrativeState";
import type { Cell } from "../../../packages/shell/src/cell";

/** 最小状态单元：普通对象即满足 Cell 形状 */
function cell<T>(initial: T): Cell<T> {
  return { value: initial };
}

function makeState() {
  return createNarrativeState({
    cells: { cell },
    resolveLayer: () => undefined,
    readTypingSetting: () => undefined,
    readCharacterColor: () => null,
    readColorOverride: () => null,
    onLayerZ: vi.fn(),
    onLayerZRestore: vi.fn(),
    onDialogText: vi.fn(),
  });
}

describe("输入候选落点", () => {
  it("状态键到达即落到单元（显示文本与填入值都保留）", () => {
    const state = makeState();
    state.handleState(SYS.inputOptions, [
      { text: "旅人", value: "traveler" },
      { text: "商人", value: "merchant" },
    ]);
    expect(state.inputCandidates.value).toEqual([
      { text: "旅人", value: "traveler" },
      { text: "商人", value: "merchant" },
    ]);
  });

  it("畸形项整项丢弃，全丢即等于无候选", () => {
    const state = makeState();
    state.handleState(SYS.inputOptions, [
      { text: "甲", value: "A" },
      { text: "缺值" },
      { value: "缺文本" },
      null,
      "字符串不是项",
      { text: 1, value: 2 },
    ]);
    expect(state.inputCandidates.value).toEqual([{ text: "甲", value: "A" }]);

    state.handleState(SYS.inputOptions, [{ text: "缺值" }]);
    expect(state.inputCandidates.value).toEqual([]);

    state.handleState(SYS.inputOptions, "不是数组");
    expect(state.inputCandidates.value).toEqual([]);
  });

  it("整体回档时重新读候选（读档不留上一局的）", () => {
    const state = makeState();
    state.handleState(SYS.inputOptions, [{ text: "甲", value: "A" }]);
    expect(state.inputCandidates.value).toHaveLength(1);

    // 读档：引擎侧已经没有候选了
    state.syncFromEngine((key) => (key === SYS.inputOptions ? undefined : ""));
    expect(state.inputCandidates.value).toEqual([]);
  });
});
