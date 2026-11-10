/**
 * 模板输入映射：舞台点击在哪些等待态下才算「继续」。
 *
 * 守的是一条玩家能直接看见的边界：引擎对非对话等待的 `advance` 是 fail-closed
 * （发 `advance-invalid`，宿主把它写进错误条），而错误条一旦出现就不会自己消失。
 * 于是「菜单态多点两下舞台」在浏览器里会留下一条永不消退的红字——这不是引擎的错，
 * 引擎按契约拒绝了非法推进；错在宿主把每一次舞台点击都无条件翻译成 `advance`。
 *
 * 四组用例：
 * 1. **可推进态放行**：dialog / wait / video 三态下点击与空格都调到 `engine.advance()`；
 * 2. **交互等待期不放行**：menu / input / minigame / interaction / extension / none
 *    下点击与空格都不调——那几态各有自己的推进出口（选项、提交、玩法完成）；
 * 3. **打字机优先**：未打完时点击只让打字机瞬间完成，不碰 `advance`；
 * 4. **交互层截流**：选项 / 工具条 / 通知里的点击不冒泡成推进。
 *
 * 替身带冒泡：真实 DOM 里 `#choices` 是 `#stage-viewport` 的后代（经 `#shell-ui`），
 * 点选项会先冒到 `dom.viewport` 的监听；替身必须复现这条路径，否则「截流」那条用例是空跑。
 *
 * 用 `vi.stubGlobal("document", …)` 造最小替身而不引 jsdom：`tests/template` 属前端域，
 * 禁 Node 导入，本仓其他前端域测试也是这个手法。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYS, type StoryEngine } from "@lingfan-engine/core";
import { wireInput } from "../../template/v1/__PROJECT__/src/host/input-map.ts";
import type { StageDom } from "../../template/v1/__PROJECT__/src/host/stage-dom.ts";
import type { DialogueView } from "../../template/v1/__PROJECT__/src/host/dialogue-view.ts";

// ---------- 最小 DOM 替身（带冒泡） ----------

interface FakeEvent {
  target: unknown;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

type FakeListener = (event: FakeEvent) => void;

interface FakeElement {
  parent: FakeElement | null;
  addEventListener(type: string, handler: FakeListener): void;
  /** 派发一次事件：先本节点，未被 stopPropagation 就继续冒到 parent */
  fire(type: string): void;
}

function fakeElement(parent: FakeElement | null = null): FakeElement {
  const listeners = new Map<string, FakeListener[]>();
  const node: FakeElement = {
    parent,
    addEventListener(type: string, handler: FakeListener): void {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    fire(type: string): void {
      const event: FakeEvent = {
        target: node,
        stopped: false,
        preventDefault(): void {},
        stopPropagation(): void {
          event.stopped = true;
        },
      };
      let cursor: FakeElement | null = node;
      while (cursor !== null && !event.stopped) {
        for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
        cursor = cursor.parent;
      }
    },
  };
  return node;
}

/** 文档级键盘监听落在哪：`document.addEventListener("keydown", …)` 的那个集合 */
let documentListeners: FakeListener[];

beforeEach(() => {
  documentListeners = [];
  vi.stubGlobal("document", {
    addEventListener(type: string, handler: FakeListener): void {
      if (type === "keydown") documentListeners.push(handler);
    },
  });
  // 键盘处理里用 `event.target instanceof HTMLInputElement` 排除输入框；
  // 测试环境没有这个全局，不补就是 handler 自己抛 TypeError（静默吞掉推进）。
  vi.stubGlobal("HTMLInputElement", class FakeHTMLInputElement {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- 引擎与视图替身 ----------

/** 造一套接线输入：只实现本模块真正调用到的面 */
function harness(waiting: string, typingDone: boolean) {
  const calls: string[] = [];
  const viewport = fakeElement();
  const choices = fakeElement(viewport);
  const toolbar = fakeElement(viewport);
  const notifications = fakeElement(viewport);

  const engine = {
    get(key: string): unknown {
      return key === SYS.waiting ? waiting : undefined;
    },
    advance(): void {
      calls.push("advance");
    },
  } as unknown as StoryEngine;

  const dialogue = {
    readTypewriter(): unknown {
      if (typingDone) {
        return { done: true, click: (): void => void calls.push("click-done") };
      }
      return {
        done: false,
        click: (): void => void calls.push("click-typing"),
      };
    },
  } as unknown as DialogueView;

  const dom = {
    viewport,
    choices,
    toolbar,
    notifications,
  } as unknown as StageDom;

  wireInput({ dom, engine, dialogue });
  return { calls, viewport, choices, toolbar, notifications };
}

/** 按空格键：走 document 上的 keydown 监听 */
function pressSpace(): void {
  for (const handler of [...documentListeners]) {
    handler({
      key: " ",
      target: {},
      stopped: false,
      preventDefault(): void {},
      stopPropagation(): void {},
    } as FakeEvent & { key: string });
  }
}

describe("模板输入映射 · 舞台点击只在可推进等待态生效", () => {
  it("dialog / wait / video 三态：点击与空格都推进", () => {
    for (const waiting of ["dialog", "wait", "video"]) {
      const { calls, viewport } = harness(waiting, true);
      viewport.fire("click");
      pressSpace();
      expect(calls, waiting).toEqual(["advance", "advance"]);
    }
  });

  it("**菜单态点击不推进**（回归：曾无条件 advance，红字挂满屏且不消失）", () => {
    const { calls, viewport } = harness("menu", true);
    viewport.fire("click");
    pressSpace();
    expect(calls).toEqual([]);
  });

  it("其余交互等待期一律不推进：input / minigame / interaction / extension / none", () => {
    for (const waiting of [
      "input",
      "minigame",
      "interaction",
      "extension",
      "none",
    ]) {
      const { calls, viewport } = harness(waiting, true);
      viewport.fire("click");
      pressSpace();
      expect(calls, waiting).toEqual([]);
    }
  });

  it("打字机未打完：点击只让打字机瞬间完成，不碰 advance（任何等待态）", () => {
    const { calls, viewport } = harness("dialog", false);
    viewport.fire("click");
    expect(calls).toEqual(["click-typing"]);
  });

  it("交互层内的点击不冒泡成推进（选项 / 工具条 / 通知各自截流）", () => {
    const { calls, choices, toolbar, notifications } = harness("dialog", true);
    choices.fire("click");
    toolbar.fire("click");
    notifications.fire("click");
    expect(calls).toEqual([]);
  });
});
