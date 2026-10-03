/**
 * 游戏输入域锚点（`game-input-zone`）：滚轮回溯与键盘推进只在游戏域生效。
 *
 * 舞台铺满视口且内部挂着工具条与历史/设置/槽位面板，事件会从这些控件冒泡上来；
 * 若不判来源，在历史面板里滚动查看会连带把游戏回退。本用例以真值表锁判据行为，
 * 以源级断言锁接线顺序与「标记名两侧一致」——把「面板/控件不算游戏输入」变成可回归的约定。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/playground/src/App.vue?raw";
import {
  GAME_INPUT_BLOCKED_SELECTOR,
  isGameInputTarget,
  type ClosestLike,
} from "../../apps/playground/src/gameZone";

/** 最小替身：模拟 Element.closest 的命中语义，并记录收到的选择器 */
function targetMock(matched: boolean): { el: ClosestLike; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    el: {
      closest(selector: string) {
        seen.push(selector);
        return matched ? {} : null;
      },
    },
  };
}

describe("判据真值表：控件/面板内为非游戏输入，其余为游戏输入", () => {
  it("命中原生输入控件或 UI 容器标记 ⇒ 非游戏域（面板内滚动不回溯、输入框内不吞键）", () => {
    const { el, seen } = targetMock(true);
    expect(isGameInputTarget(el)).toBe(false);
    expect(seen).toEqual([GAME_INPUT_BLOCKED_SELECTOR]);
  });

  it("未命中 ⇒ 游戏域（舞台空白/元素层/对话层仍可滚轮回溯与键盘推进）", () => {
    const { el } = targetMock(false);
    expect(isGameInputTarget(el)).toBe(true);
  });

  it("不具备 closest 能力的目标保守视为游戏域（视口/文档/非元素不可能是控件内部）", () => {
    expect(isGameInputTarget(null)).toBe(true);
    expect(isGameInputTarget(undefined)).toBe(true);
    expect(isGameInputTarget("div")).toBe(true);
    expect(isGameInputTarget(42)).toBe(true);
    expect(isGameInputTarget({})).toBe(true); // Document/Window 类目标：无 closest
  });
});

describe("选择器契约：四类关键项在场（防选择器被改窄而静默失效）", () => {
  it("含原生输入控件与 UI 容器标记", () => {
    for (const token of ["input", "textarea", "select", "contenteditable", "data-ui-zone"]) {
      expect(GAME_INPUT_BLOCKED_SELECTOR).toContain(token);
    }
  });
});

describe("组合根接线：滚轮与键盘都先过判据，再谈游戏动作", () => {
  it("onWheel 判据位于 engine.back/forward 之前", () => {
    const fnAt = appSource.indexOf("function onWheel");
    const judgeAt = appSource.indexOf("isGameInputTarget(event.target)", fnAt);
    const backAt = appSource.indexOf("engine.back()", fnAt);
    const forwardAt = appSource.indexOf("engine.forward()", fnAt);
    expect(fnAt).toBeGreaterThan(-1);
    expect(judgeAt).toBeGreaterThan(fnAt);
    expect(judgeAt).toBeLessThan(backAt);
    expect(judgeAt).toBeLessThan(forwardAt);
  });

  it("onKeydown 判据位于推进/历史键位处理之前", () => {
    const fnAt = appSource.indexOf("function onKeydown");
    const judgeAt = appSource.indexOf("isGameInputTarget(e.target)", fnAt);
    const advanceAt = appSource.indexOf('keyMatches("advance"', fnAt);
    expect(judgeAt).toBeGreaterThan(fnAt);
    expect(judgeAt).toBeLessThan(advanceAt);
  });
});

describe("UI 容器标记：工具条与三个面板都覆盖（新增面板需同步打标）", () => {
  it("工具条、历史/设置/槽位面板均带 data-ui-zone", () => {
    expect(appSource).toContain('class="toolbar" data-ui-zone');
    expect(appSource).toContain('class="history-panel saves-panel" data-ui-zone');
    const marks = appSource.match(/data-ui-zone/g) ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(4); // toolbar + 历史 + 设置 + 槽位
  });
});