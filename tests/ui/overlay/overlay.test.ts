/**
 * 叙事覆盖层装配器（`packages/ui`）。
 *
 * node 环境无 document：用最小 DOM 替身（沿用元素渲染测试的手法，只覆盖
 * 装配器用到的表面积）。测的是**接线与生命周期**：五挂载点建齐、层级 z 走
 * 实例 > 层默认、状态经 ValueChanged 投影、点击选项交核心（目标是列 id 而非显示文本）、
 * 卸载彻底（退订 + 清 DOM + 停帧）；模板缺失回退默认（fail-soft）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYS } from "@lingfan/engine";
import { createNarrativeOverlay } from "@lingfan/ui";

interface FakeEl {
  tagName: string;
  className: string;
  style: Record<string, string>;
  textContent: string;
  innerHTML: string;
  type: string;
  value: string;
  dataset: Record<string, string>;
  children: FakeEl[];
  attrs: Record<string, string>;
  listeners: Record<string, Array<(e: unknown) => void>>;
  parent: FakeEl | null;
  appendChild(child: FakeEl): FakeEl;
  append(...nodes: FakeEl[]): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (e: unknown) => void): void;
  set onclick(handler: (e: unknown) => void);
}

function createEl(tag: string): FakeEl {
  const node: FakeEl = {
    tagName: tag.toUpperCase(),
    className: "",
    style: {},
    textContent: "",
    innerHTML: "",
    type: "",
    value: "",
    dataset: {},
    children: [],
    attrs: {},
    listeners: {},
    parent: null,
    appendChild(child: FakeEl): FakeEl {
      child.parent = node;
      node.children.push(child);
      return child;
    },
    append(...nodes: FakeEl[]): void {
      for (const n of nodes) node.appendChild(n);
    },
    remove(): void {
      const p = node.parent;
      if (p === null) return;
      const i = p.children.indexOf(node);
      if (i >= 0) p.children.splice(i, 1);
      node.parent = null;
    },
    setAttribute(name: string, value: string): void {
      node.attrs[name] = value;
    },
    addEventListener(type: string, handler: (e: unknown) => void): void {
      node.listeners[type] ??= [];
      node.listeners[type]!.push(handler);
    },
    set onclick(handler: (e: unknown) => void) {
      node.addEventListener("click", handler);
    },
  };
  // 真实 DOM 的每个节点都带 ownerDocument；装配器据此建子节点，替身须同形
  (node as unknown as { ownerDocument: unknown }).ownerDocument = fakeDocument;
  // innerHTML 语义：写入即记住内容**并清空子节点**（真实行为）；
  // 否则反复重渲会堆叠出幽灵节点，断言会数到旧节点。
  let html = "";
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set: (value: unknown) => {
      html = String(value ?? "");
      node.children.length = 0;
    },
  });
  return node;
}

/** 共享的假 document（装配器从任一节点取 ownerDocument 建子节点） */
const fakeDocument = {
  createElement: (tag: string): FakeEl => createEl(tag),
  defaultView: {
    requestAnimationFrame: (cb: (t: number) => void): number => {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame: (): void => {
      rafQueue.length = 0;
    },
  },
};

/** 递归找后代（替身无 querySelector） */
function findAll(
  root: FakeEl,
  pred: (el: FakeEl) => boolean,
  out: FakeEl[] = [],
): FakeEl[] {
  for (const child of root.children) {
    if (pred(child)) out.push(child);
    findAll(child, pred, out);
  }
  return out;
}

const rafQueue: Array<(t: number) => void> = [];

/** 跑一帧（供打字机推进断言） */
function runFrame(t: number): void {
  const pending = rafQueue.splice(0, rafQueue.length);
  for (const cb of pending) cb(t);
}

interface FakeEngine {
  listeners: Array<(c: { key: string; value: unknown; scope: string }) => void>;
  events: Array<(e: unknown) => void>;
  state: Map<string, unknown>;
  onStateChanged: (l: (c: { key: string; value: unknown; scope: string }) => void) => () => void;
  onEvent: (l: (e: unknown) => void) => () => void;
  get: (key: string) => unknown;
  advance: ReturnType<typeof vi.fn>;
  choose: ReturnType<typeof vi.fn>;
  input: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  runElementOps: ReturnType<typeof vi.fn>;
  interpolate: (s: string) => string;
  getCharacter: (key: string) => { color?: string } | undefined;
  /** 角色定义表（测试注入角色色以验派生优先级） */
  characters: Map<string, { color?: string }>;
  /** 测试驱动：改状态并派发（模拟引擎写 SSOT） */
  emit(key: string, value: unknown): void;
}

function createEngine(): FakeEngine {
  const characters = new Map<string, { color?: string }>();
  const engine: FakeEngine = {
    listeners: [],
    events: [],
    state: new Map<string, unknown>(),
    onStateChanged(listener): () => void {
      engine.listeners.push(listener);
      return () => {
        const i = engine.listeners.indexOf(listener);
        if (i >= 0) engine.listeners.splice(i, 1);
      };
    },
    onEvent(listener): () => void {
      engine.events.push(listener);
      return () => {
        const i = engine.events.indexOf(listener);
        if (i >= 0) engine.events.splice(i, 1);
      };
    },
    get: (key) => engine.state.get(key),
    advance: vi.fn(),
    choose: vi.fn(),
    input: vi.fn(),
    navigate: vi.fn(),
    runElementOps: vi.fn(() => true),
    interpolate: (s) => s,
    /** 角色定义（供说话人色派生：覆盖色 > 角色色） */
    getCharacter: (key: string) => characters.get(key),
    characters,
    emit(key, value): void {
      engine.state.set(key, value);
      for (const l of [...engine.listeners]) l({ key, value, scope: "global" });
    },
  };
  return engine;
}

let container: FakeEl;

beforeEach(() => {
  rafQueue.length = 0;
  container = createEl("div");
  vi.stubGlobal("document", fakeDocument);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function build(options: Record<string, unknown> = {}): {
  overlay: ReturnType<typeof createNarrativeOverlay>;
  engine: FakeEngine;
} {
  const engine = createEngine();
  const overlay = createNarrativeOverlay({
    container: container as unknown as HTMLElement,
    engine: engine as never,
    ...options,
  });
  return { overlay, engine };
}

describe("骨架：五挂载点建齐且层级正确", () => {
  it("root 下建齐 stage / dialogue / choices / notifications / takeover / transition", () => {
    const { overlay } = build();
    const { mounts } = overlay;
    expect(mounts.stage.parentElement ?? container).toBeTruthy();
    // 五挂载点都在 DOM 里（用替身的父子关系判断）
    const all = findAll(container, () => true);
    for (const el of [
      mounts.stage,
      mounts.elementLayer,
      mounts.dialogue,
      mounts.choices,
      mounts.overlay,
      mounts.takeover,
      mounts.transition,
    ]) {
      expect(all).toContain(el as unknown as FakeEl);
    }
  });

  it("层级 z 按内建默认（对话在舞台之上、通知在对话之上）", () => {
    const { overlay } = build();
    const z = (el: unknown): number => Number((el as FakeEl).style.zIndex);
    expect(z(overlay.mounts.stage)).toBe(0);
    expect(z(overlay.mounts.dialogue)).toBe(999);
    expect(z(overlay.mounts.choices)).toBe(1100);
    expect(z(overlay.mounts.overlay)).toBe(1300);
    expect(z(overlay.mounts.dialogue)).toBeGreaterThan(z(overlay.mounts.stage));
    expect(z(overlay.mounts.overlay)).toBeGreaterThan(z(overlay.mounts.dialogue));
  });

  it("层自身不吃事件，控件另行恢复（空白区透传给宿主游戏）", () => {
    const { overlay, engine } = build();
    const pe = (el: unknown): string => (el as FakeEl).style.pointerEvents;
    // 全部层自身透明：对话框铺满视口时，玩家仍能点到对话框之外的宿主游戏
    for (const layer of [
      overlay.mounts.root,
      overlay.mounts.stage,
      overlay.mounts.dialogue,
      overlay.mounts.choices,
      overlay.mounts.overlay,
      overlay.mounts.takeover,
    ]) {
      expect(pe(layer)).toBe("none");
    }
    // 实际控件逐个恢复点击
    engine.emit(SYS.waiting, "menu");
    engine.emit(SYS.menuOptions, ["A"]);
    engine.emit(SYS.menuTargets, ["a"]);
    const btn = findAll(
      overlay.mounts.choices as unknown as FakeEl,
      (el) => el.tagName === "BUTTON",
    )[0]!;
    expect(btn.style.pointerEvents).toBe("auto");
  });

  it("工程层覆盖经 layerZ 注入生效", () => {
    const { overlay } = build({
      layerZ: {
        stage: 0,
        video: 100,
        dialogue: 500,
        choices: 600,
        minigame: 700,
        notifications: 800,
        toolbar: 1400,
        history: 1500,
        prefs: 1500,
      },
    });
    expect((overlay.mounts.dialogue as unknown as FakeEl).style.zIndex).toBe("500");
    expect((overlay.mounts.overlay as unknown as FakeEl).style.zIndex).toBe("800");
  });
});

describe("状态投影：只经 ValueChanged 渲染", () => {
  it("say 文本上屏且模板 skin 类叠加", () => {
    const { overlay, engine } = build();
    const dialogue = overlay.mounts.dialogue as unknown as FakeEl;
    /** 每次重渲都会重建正文节点 ⇒ 断言前重新查询（不持有陈旧引用） */
    const body = (): FakeEl =>
      findAll(dialogue, (el) => el.className === "lf-text")[0]!;

    engine.emit(SYS.currentDialogSpeaker, "旅人");
    engine.emit(SYS.currentDialogText, "你好");
    expect(dialogue.className).toContain("tpl-bubble"); // 内建默认模板
    expect(body().innerHTML).toBe(""); // 打字机未推进 ⇒ 可见前缀为空

    runFrame(1000);
    runFrame(1333); // ~10 字 @30cps
    expect(body().innerHTML).not.toBe("");
    expect(body().innerHTML).toContain("你");
  });

  it("说话人行在说话人为空时隐藏", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.currentDialogText, "旁白");
    expect(
      findAll(overlay.mounts.dialogue as unknown as FakeEl, (el) =>
        el.className.includes("lf-speaker"),
      ),
    ).toHaveLength(0);
  });

  it("等待态驱动选择层显隐（none 时隐藏）", () => {
    const { overlay, engine } = build();
    const choices = overlay.mounts.choices as unknown as FakeEl;
    expect(choices.style.display).toBe("none");
    engine.emit(SYS.waiting, "menu");
    expect(choices.style.display).toBe("");
    engine.emit(SYS.waiting, "none");
    expect(choices.style.display).toBe("none");
  });

  it("dialogVisible=hide 隐藏对话层（随快照回档）", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.currentDialogText, "x");
    engine.emit(SYS.dialogVisible, "show");
    expect((overlay.mounts.dialogue as unknown as FakeEl).style.display).toBe("");
    engine.emit(SYS.dialogVisible, "hide");
    expect((overlay.mounts.dialogue as unknown as FakeEl).style.display).toBe("none");
  });

  it("实例级 z（命令带 z）覆盖层默认", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.dialogueZ, 42);
    expect((overlay.mounts.dialogue as unknown as FakeEl).style.zIndex).toBe("42");
  });

  it("说话人色：命令覆盖色 > 角色定义色", () => {
    const { overlay, engine } = build();
    engine.characters.set("旅人", { color: "#88ccff" });
    const speakerEl = (): FakeEl | undefined =>
      findAll(overlay.mounts.dialogue as unknown as FakeEl, (el) =>
        el.className.includes("lf-speaker"),
      )[0];

    engine.emit(SYS.currentDialogText, "x");
    engine.emit(SYS.currentDialogSpeaker, "旅人");
    expect(speakerEl()?.style.color).toBe("#88ccff"); // 角色定义色
    engine.emit(SYS.currentDialogColor, "#ff0000");
    expect(speakerEl()?.style.color).toBe("#ff0000"); // 命令覆盖色优先
  });

  it("颜色键先到、说话人后到也不滞后（派生值不依赖事件到达顺序）", () => {
    const { overlay, engine } = build();
    engine.characters.set("旅人", { color: "#88ccff" });
    engine.emit(SYS.currentDialogText, "x");
    // 覆盖色先到（此时还没有说话人）
    engine.emit(SYS.currentDialogColor, "#ff0000");
    // 说话人后到：应立刻用覆盖色，而不是角色色（滞后一句的经典症状）
    engine.emit(SYS.currentDialogSpeaker, "旅人");
    const speakerEl = findAll(
      overlay.mounts.dialogue as unknown as FakeEl,
      (el) => el.className.includes("lf-speaker"),
    )[0];
    expect(speakerEl?.style.color).toBe("#ff0000");
  });
});

describe("选项：点击交核心 choose，且传的是目标列 id", () => {
  it("选项文本与目标成对，点击传 target 而非显示文本", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.waiting, "menu");
    engine.emit(SYS.menuPrompt, "去哪里？");
    engine.emit(SYS.menuOptions, ["酒馆", "离开"]);
    engine.emit(SYS.menuTargets, ["tavern", "leave"]);

    const buttons = findAll(
      overlay.mounts.choices as unknown as FakeEl,
      (el) => el.tagName === "BUTTON",
    );
    expect(buttons).toHaveLength(2);
    // 可访问名 = 显示文本（innerHTML 内容不进无障碍名计算）
    expect(buttons[0]!.attrs["aria-label"]).toBe("酒馆");
    expect(buttons[1]!.attrs["aria-label"]).toBe("离开");
    // 点击 → 核心 choose(列 id)
    buttons[1]!.listeners["click"]![0]!({});
    expect(engine.choose).toHaveBeenCalledWith("leave");
    expect(engine.choose).not.toHaveBeenCalledWith("离开");
  });

  it("两个键任一到达都重读成对数据（不会只更新一半）", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.waiting, "menu");
    engine.emit(SYS.menuOptions, ["A"]);
    const buttons = (): FakeEl[] =>
      findAll(overlay.mounts.choices as unknown as FakeEl, (el) => el.tagName === "BUTTON");
    expect(buttons()[0]!.attrs["aria-label"]).toBe("A");
    engine.emit(SYS.menuTargets, ["col-a"]);
    buttons()[0]!.listeners["click"]![0]!({});
    expect(engine.choose).toHaveBeenCalledWith("col-a");
  });
});

describe("输入等待：提交走核心 input", () => {
  it("input 等待渲染输入框与提交按钮，提交送核心", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.waiting, "input");
    engine.emit(SYS.inputPrompt, "报上名来：");
    const inputs = findAll(
      overlay.mounts.choices as unknown as FakeEl,
      (el) => el.tagName === "INPUT",
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.attrs["aria-label"]).toBe("报上名来：");
    inputs[0]!.value = "  小明  ";
    overlay.submitInput("小明"); // 宿主路径
    expect(engine.input).toHaveBeenCalledWith("小明");
  });
});

describe("推进：二段式（打字中先瞬间完成，完成后才交引擎）", () => {
  it("打字未完成时 advance 只完成当前句，不推进故事", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.waiting, "dialog"); // 引擎在 say 上屏时建立的等待态
    engine.emit(SYS.currentDialogText, "一句很长的话要慢慢打出来");
    overlay.advance();
    expect(engine.advance).not.toHaveBeenCalled(); // 第一次点击 = 瞬间完成
    overlay.advance();
    expect(engine.advance).toHaveBeenCalledTimes(1); // 第二次才推进
  });

  it("非推进类等待态不交引擎（避免无效调用误报）", () => {
    // 回归：input 等待时按推进键 ⇒ 引擎回「advance 仅在对话等待中有效」，
    // 的错误横幅，玩家看到的是误报（那是装配器误用，不是故事问题）。
    for (const wait of ["menu", "input", "minigame", "interaction"]) {
      const { overlay, engine } = build();
      engine.emit(SYS.currentDialogText, "短句");
      engine.emit(SYS.waiting, wait);
      overlay.advance(); // 完成打字机
      overlay.advance(); // 该等待态不归推进
      expect(engine.advance).not.toHaveBeenCalled();
    }
  });

  it("推进类等待态（dialog/wait/video）仍交引擎", () => {
    for (const wait of ["dialog", "wait", "video"]) {
      const { overlay, engine } = build();
      engine.emit(SYS.currentDialogText, "短句");
      engine.emit(SYS.waiting, wait);
      overlay.advance(); // 完成打字机
      overlay.advance(); // 推进
      expect(engine.advance).toHaveBeenCalledTimes(1);
    }
  });

  it("无等待态时不交引擎（引擎会回无效调用）", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.currentDialogText, "短句");
    overlay.advance();
    overlay.advance();
    expect(engine.advance).not.toHaveBeenCalled();
  });
});

describe("通知：引擎事件 → 覆盖层，到时自动移除", () => {
  it("notify 事件上屏并按 tone 加皮肤，超过时长移除", () => {
    vi.useFakeTimers();
    const { overlay, engine } = build();
    engine.events[0]!({
      payload: { kind: "notify", text: "钱袋沉了一点", notifyType: "warning" },
    });
    const items = findAll(
      overlay.mounts.overlay as unknown as FakeEl,
      (el) => el.className.includes("tpl-notify"),
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.className).toContain("warning");
    vi.advanceTimersByTime(3001);
    expect(
      findAll(overlay.mounts.overlay as unknown as FakeEl, (el) =>
        el.className.includes("tpl-notify"),
      ),
    ).toHaveLength(0);
  });

  it("引擎错误经 onError 上报（不静默吞）", () => {
    const errors: string[] = [];
    const { engine } = build({ onError: (m: string) => errors.push(m) });
    engine.events[0]!({
      payload: { kind: "engine.error", code: "x", message: "出了点问题" },
    });
    expect(errors).toEqual(["出了点问题"]);
  });
});

describe("生命周期：卸载彻底", () => {
  it("dispose 后退订（状态变化不再渲染）且根从容器移除", () => {
    const { overlay, engine } = build();
    overlay.dispose();
    expect(engine.listeners).toHaveLength(0);
    expect(engine.events).toHaveLength(0);
    expect(findAll(container, () => true)).not.toContain(
      overlay.mounts.root as unknown as FakeEl,
    );
  });

  it("dispose 幂等（重复调用不抛）", () => {
    const { overlay } = build();
    overlay.dispose();
    expect(() => overlay.dispose()).not.toThrow();
  });

  it("setRunning(false) 停帧：打字不再推进", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.currentDialogText, "这句话不该继续打字");
    const before = overlay.view().lineHtml;
    overlay.setRunning(false);
    runFrame(5000);
    runFrame(9000);
    expect(overlay.view().lineHtml).toBe(before);
  });
});

describe("输入判据：复用展示层唯一口径（不另立第二份）", () => {
  it("控件/面板内的目标不吃输入，舞台目标可吃", () => {
    const { overlay } = build();
    const inControl = {
      target: { closest: () => ({}) },
    } as unknown as Event;
    const onStage = { target: { closest: () => null } } as unknown as Event;
    expect(overlay.shouldConsumeInput(inControl)).toBe(false);
    expect(overlay.shouldConsumeInput(onStage)).toBe(true);
    // 非元素目标保守视为可消费
    expect(overlay.shouldConsumeInput({ target: null } as unknown as Event)).toBe(true);
  });
});

describe("视图投影：状态同步与元素在场", () => {
  it("view 反映当前等待态与元素在场", () => {
    const { overlay, engine } = build();
    engine.emit(SYS.waiting, "dialog");
    engine.emit(SYS.elements, [{ id: "a", type: "text", props: {}, z: 0, children: [] }]);
    const v = overlay.view();
    expect(v.waiting).toBe("dialog");
    expect(v.canAdvance).toBe(true);
    expect(v.hasElements).toBe(true);
  });

  it("sync 从引擎状态整体对齐（读档/回溯后调用）", () => {
    const { overlay, engine } = build();
    engine.state.set(SYS.currentDialogText, "回档后的句子");
    engine.state.set(SYS.waiting, "menu");
    engine.state.set(SYS.menuOptions, ["选项"]);
    engine.state.set(SYS.menuTargets, ["t"]);
    overlay.sync();
    const v = overlay.view();
    expect(v.text).toBe("回档后的句子");
    expect(v.waiting).toBe("menu");
    expect(v.menuOptions).toEqual([{ text: "选项", target: "t" }]);
  });
});
