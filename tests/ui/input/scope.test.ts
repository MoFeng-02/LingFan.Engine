/**
 * 输入域锚点（`game-input-zone`）：叙事层只消费「对话域 + 目标不在控件内」的输入。
 *
 * 舞台铺满视口且内部挂着工具条与面板，事件会从这些控件冒泡上来；若不判来源，
 * 在历史面板里滚动会连带把故事回退，输入框里的空格会被推进逻辑吞掉。
 * 外部玩法系统接管期间（行走 / 战斗 / QTE）另有**模式层面**的让位——两者正交，
 * 本用例以真值表分别锁定，并以源级断言锁接线顺序与「判据只写一份」。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../../apps/playground/src/App.vue?raw";
import {
  GAME_INPUT_BLOCKED_SELECTOR,
  INPUT_SCOPES,
  createInputScopeState,
  isGameInputTarget,
  isInputScope,
  routesToNarrative,
  type ClosestLike,
} from "@lingfan/ui";

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

describe("路由判据：域为对话 且 目标不在控件内，叙事层才消费", () => {
  it("对话域 + 舞台目标 ⇒ 归叙事", () => {
    expect(routesToNarrative("dialogue", targetMock(false).el)).toBe(true);
    expect(routesToNarrative("dialogue", null)).toBe(true);
  });

  it("非对话域一律不归叙事——玩法接管/面板期间连 advance 都不发", () => {
    for (const scope of ["world", "ui"] as const) {
      expect(routesToNarrative(scope, targetMock(false).el)).toBe(false);
      expect(routesToNarrative(scope, null)).toBe(false);
    }
  });

  it("控件内目标一律不归叙事（与域正交：对话域下面板仍不吃键）", () => {
    expect(routesToNarrative("dialogue", targetMock(true).el)).toBe(false);
  });
});

describe("域值收窄与状态：非法值不猜、同值不重通知", () => {
  it("只认三个声明值", () => {
    expect(INPUT_SCOPES).toEqual(["dialogue", "world", "ui"]);
    for (const ok of INPUT_SCOPES) expect(isInputScope(ok)).toBe(true);
    for (const bad of ["", "DIALOGUE", "World", "game", null, undefined, 1, {}]) {
      expect(isInputScope(bad)).toBe(false);
    }
  });

  it("默认叙事域；切换通知订阅者；非法值忽略且不通知", () => {
    const state = createInputScopeState();
    expect(state.current()).toBe("dialogue");
    const seen: string[] = [];
    const off = state.subscribe((s) => seen.push(s));
    state.set("world");
    expect(state.current()).toBe("world");
    expect(seen).toEqual(["world"]);
    state.set("world"); // 同值：宿主可能每帧断言域，不应产生通知风暴
    expect(seen).toEqual(["world"]);
    state.set("nonsense" as never); // 畸形值：保持原域
    expect(state.current()).toBe("world");
    expect(seen).toEqual(["world"]);
    state.set("dialogue");
    expect(seen).toEqual(["world", "dialogue"]);
    off();
    state.set("ui");
    expect(seen).toEqual(["world", "dialogue"]); // 退订后不再收到
  });

  it("可指定初始域（嵌入方按需起手）", () => {
    expect(createInputScopeState("world").current()).toBe("world");
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
    const judgeAt = appSource.indexOf("routesToNarrative(", fnAt);
    const backAt = appSource.indexOf("engine.back()", fnAt);
    const forwardAt = appSource.indexOf("engine.forward()", fnAt);
    expect(fnAt).toBeGreaterThan(-1);
    expect(judgeAt).toBeGreaterThan(fnAt);
    expect(judgeAt).toBeLessThan(backAt);
    expect(judgeAt).toBeLessThan(forwardAt);
  });

  it("onKeydown 判据位于推进/历史键位处理之前", () => {
    const fnAt = appSource.indexOf("function onKeydown");
    const judgeAt = appSource.indexOf("routesToNarrative(", fnAt);
    const advanceAt = appSource.indexOf('keyMatches("advance"', fnAt);
    expect(judgeAt).toBeGreaterThan(fnAt);
    expect(judgeAt).toBeLessThan(advanceAt);
  });

  it("外部接管期间声明玩法域，两条结束路径都交还叙事域", () => {
    // 接管建立时切域
    const mountAt = appSource.indexOf('payload.kind === "interaction.mount"');
    const toWorldAt = appSource.indexOf('inputScope.set("world")', mountAt);
    expect(mountAt).toBeGreaterThan(-1);
    expect(toWorldAt).toBeGreaterThan(mountAt);
    // 结束（回填 / 中断共用收尾）切回对话域
    const backAt = appSource.indexOf('inputScope.set("dialogue")', toWorldAt);
    expect(backAt).toBeGreaterThan(toWorldAt);
  });

  it("判据只写一份：宿主不再自持输入域实现", () => {
    // 域判据与状态归 @lingfan/ui（换宿主复用同一份），宿主只消费
    expect(appSource).toMatch(/createInputScopeState/);
    expect(appSource).not.toMatch(/GAME_INPUT_BLOCKED_SELECTOR\s*=/);
    expect(appSource).not.toMatch(/function isGameInputTarget/);
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

describe("共享宿主类名随接管卸载移除（回归：残留类会让已结束的接管仍被算作进行中）", () => {
  // 真缺陷：接管工厂在**共享宿主元素**上加演示类，收尾只清 innerHTML 没摘类
  // ⇒ 残留类跟到下一次接管，症状是「已结束的接管仍被算作进行中」。
  // 修法：类名移除写在**两条结束路径的唯一收口**（宿主 onAbort / abort 监听）里。
  it("两个演示工厂都在共享宿主上加类", () => {
    expect(appSource).toMatch(/host\.classList\.add\("walk-demo"\)/);
    expect(appSource).toMatch(/host\.classList\.add\("minigame-demo"\)/);
  });

  it("两个类都在收尾处被移除（加了几次就摘几次）", () => {
    const adds = appSource.match(/host\.classList\.add\("([a-z-]+)"\)/g) ?? [];
    const removes = appSource.match(/host\.classList\.remove\("([a-z-]+)"\)/g) ?? [];
    expect(removes.length).toBeGreaterThanOrEqual(adds.length);
    for (const add of adds) {
      const cls = /"([a-z-]+)"/.exec(add)![1];
      expect(removes.some((r) => r.includes(cls))).toBe(true);
    }
  });

  it("walk 的类移除以宿主收口为唯一处（不在工厂内分两处写）", () => {
    // 工厂内只 add 不 remove：移除归宿主 onAbort（覆盖「抵达」与「中断」两条路径）
    const factoryAt = appSource.indexOf('interactions.set("walk"');
    const hostAbortAt = appSource.indexOf('payload.kind === "interaction.mount"');
    expect(factoryAt).toBeGreaterThan(-1);
    const factoryBody = appSource.slice(factoryAt, hostAbortAt);
    expect(factoryBody).not.toMatch(/classList\.remove\("walk-demo"\)/);
    const after = appSource.slice(hostAbortAt);
    expect(after).toMatch(/classList\.remove\("walk-demo"\)/);
  });
});
