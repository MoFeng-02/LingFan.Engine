/**
 * 列身体进列写入（`SYS.body`）测试。
 *
 * 语义要点：
 * - 有 `column.body` ⇒ 进列写入 `{ name, props? }`；无身体 ⇒ **删键**（不是写 `undefined`）
 * - 形状相同不重写：同列重进不触发重挂（宿主据此保住组件本地状态）
 * - 身体随快照/回溯整表还原：`back()` 回到前一检查点时身体随之换回
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, ValueChanged } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

interface Harness {
  engine: StoryEngine;
  changes: ValueChanged[];
  events: OutboundEvent[];
}

function instrument(engine: StoryEngine): Harness {
  const changes: ValueChanged[] = [];
  const events: OutboundEvent[] = [];
  engine.onStateChanged((c) => changes.push(c));
  engine.onEvent((e) => events.push(e));
  return { engine, changes, events };
}

function errorCodes(events: readonly OutboundEvent[]): string[] {
  return events
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload as { code: string }).code);
}

function makeEngine(columns: object[], entry = "a"): Harness {
  return instrument(
    new StoryEngine(parseStory({ formatVersion: 1, id: "t", entry, columns })),
  );
}

function bodyColumn(id: string, name: string, props?: object): object {
  return {
    id,
    kind: "scene",
    body: props === undefined ? { name } : { name, props },
  };
}

function elementColumn(id: string, entry: object[]): object {
  return {
    id,
    kind: "scene",
    elements: [{ type: "text", id: `${id}-title`, text: id }],
    entry,
  };
}

function bodyChanges(changes: ValueChanged[]): ValueChanged[] {
  return changes.filter((c) => c.key === SYS.body);
}

describe("enterColumn · SYS.body 写入", () => {
  it("有身体 ⇒ 进列写入 { name, props }", () => {
    const { engine } = makeEngine([
      bodyColumn("a", "kitchen", { title: "厨房", hotplate: false }),
    ]);
    engine.start();
    expect(engine.get(SYS.body)).toEqual({
      name: "kitchen",
      props: { title: "厨房", hotplate: false },
    });
  });

  it("无 props ⇒ 值里不含 props 键（不是空对象）", () => {
    const { engine } = makeEngine([bodyColumn("a", "kitchen")]);
    engine.start();
    const value = engine.get(SYS.body) as Record<string, unknown>;
    expect(value).toEqual({ name: "kitchen" });
    expect(Object.prototype.hasOwnProperty.call(value, "props")).toBe(false);
  });

  it("无身体的列 ⇒ 删掉该键（存档里根本不出现该键）", () => {
    const { engine, events } = makeEngine([
      { id: "a", kind: "flow", commands: [{ op: "jump", target: "b" }] },
      elementColumn("b", [{ op: "say", text: "无身体的房间" }]),
    ]);
    engine.start();
    expect(engine.get(SYS.body)).toBeUndefined();
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    expect(save!.state.map(([key]) => key)).not.toContain(SYS.body);
    // 「删键」是唯一实现方式：写 `undefined` 过不了系统键的值校验（JSON 安全），
    // 会在进列时冒出一条 engine.error——所以无身体列必须零错误。
    expect(errorCodes(events)).toEqual([]);
  });

  it("换列 ⇒ 身体跟着换成目标列的", () => {
    const { engine } = makeEngine([
      bodyColumn("a", "kitchen"),
      bodyColumn("b", "hall"),
      { id: "c", kind: "flow", commands: [] },
    ]);
    engine.start();
    expect((engine.get(SYS.body) as { name: string }).name).toBe("kitchen");
    engine.navigate("b");
    expect((engine.get(SYS.body) as { name: string }).name).toBe("hall");
  });

  it("同列重进 ⇒ 形状相同，不重写（不发变更通知）", () => {
    const { engine, changes } = makeEngine([
      bodyColumn("a", "kitchen", { title: "厨房" }),
    ]);
    engine.start();
    const before = bodyChanges(changes).length;
    engine.navigate("a");
    expect(bodyChanges(changes).length).toBe(before);
  });

  it("身体相同的不同列对象（值相等）同样不重写", () => {
    const { engine, changes } = makeEngine([
      bodyColumn("a", "kitchen", { list: [1, 2], nested: { k: "v" } }),
      bodyColumn("b", "kitchen", { list: [1, 2], nested: { k: "v" } }),
    ]);
    engine.start();
    const before = bodyChanges(changes).length;
    engine.navigate("b");
    expect(bodyChanges(changes).length).toBe(before);
  });

  it("props 值不同 ⇒ 重写（宿主应换画面）", () => {
    const { engine, changes } = makeEngine([
      bodyColumn("a", "kitchen", { title: "厨房" }),
      bodyColumn("b", "kitchen", { title: "客厅" }),
    ]);
    engine.start();
    const before = bodyChanges(changes).length;
    engine.navigate("b");
    expect(bodyChanges(changes).length).toBe(before + 1);
    expect(engine.get(SYS.body)).toEqual({
      name: "kitchen",
      props: { title: "客厅" },
    });
  });

  it("back() ⇒ 身体随检查点整表还原", () => {
    const harness = makeEngine([
      { ...bodyColumn("a", "kitchen"), entry: [{ op: "say", text: "厨房" }] },
      { ...bodyColumn("b", "hall"), entry: [{ op: "say", text: "客厅" }] },
    ]);
    harness.engine.start();
    expect((harness.engine.get(SYS.body) as { name: string }).name).toBe(
      "kitchen",
    );
    harness.engine.navigate("b");
    expect((harness.engine.get(SYS.body) as { name: string }).name).toBe(
      "hall",
    );
    harness.engine.back();
    expect((harness.engine.get(SYS.body) as { name: string }).name).toBe(
      "kitchen",
    );
  });

  it("back() ⇒ 身体换回时补发变更通知（宿主渲染面是订阅制）", () => {
    const harness = makeEngine([
      { ...bodyColumn("a", "kitchen"), entry: [{ op: "say", text: "厨房" }] },
      { ...bodyColumn("b", "hall"), entry: [{ op: "say", text: "客厅" }] },
    ]);
    harness.engine.start();
    harness.engine.navigate("b");
    const before = bodyChanges(harness.changes).length;
    harness.engine.back();
    const after = bodyChanges(harness.changes);
    // 快照是整表替换，本身不产生逐键通知；宿主只订 SYS 键的那几面全靠这一条
    expect(after.length).toBeGreaterThan(before);
    expect(after[after.length - 1]!.value).toEqual({ name: "kitchen" });
  });
});

/**
 * 画面归属：`scene` 列是「这一屏」，`flow` 列只是流程。
 *
 * 这条分流的作者可见价值：写一句话不必换掉整屏，对话列也不必复述所属场景的身体。
 */
describe("enterColumn · 画面归属（flow 列不改画面）", () => {
  function talkColumn(id: string, lines: readonly string[]): object {
    return {
      id,
      kind: "flow",
      commands: lines.map((text) => ({ op: "say", text })),
    };
  }

  it("进无身体的 flow 列 ⇒ 上一个画面原样留着", () => {
    const harness = makeEngine([
      bodyColumn("a", "kitchen", { title: "厨房" }),
      talkColumn("talk", ["第一句", "第二句"]),
    ]);
    harness.engine.start();
    const before = harness.engine.get(SYS.body);
    expect(before).toEqual({ name: "kitchen", props: { title: "厨房" } });
    const changesBefore = bodyChanges(harness.changes).length;
    harness.engine.navigate("talk");
    // 画面没换，也就不该有任何身体变更通知——宿主不必重挂组件
    expect(harness.engine.get(SYS.body)).toEqual(before);
    expect(bodyChanges(harness.changes).length).toBe(changesBefore);
    expect(errorCodes(harness.events)).toEqual([]);
  });

  it("flow 列里的每句 say 各占一个检查点，逐句可退而画面始终不变", () => {
    const harness = makeEngine([
      bodyColumn("a", "kitchen", { title: "厨房" }),
      talkColumn("talk", ["第一句", "第二句"]),
    ]);
    harness.engine.start();
    const before = harness.engine.get(SYS.body);
    const lenAtRoom = harness.engine.historyLength();
    harness.engine.navigate("talk");
    harness.engine.advance();
    expect(harness.engine.historyLength()).toBe(lenAtRoom + 1);
    harness.engine.advance();
    expect(harness.engine.historyLength()).toBe(lenAtRoom + 2);
    // 两句都推完时停在列尾（waiting=none）：第一次 back 先把「所见」入档再退一格，
    // 落点是第二句的等待点；再退一格才回到第一句。两格都在，才叫「逐句可退」。
    harness.engine.back();
    expect(harness.engine.get(SYS.currentDialogText)).toBe("第二句");
    expect(harness.engine.get(SYS.body)).toEqual(before);
    harness.engine.back();
    expect(harness.engine.get(SYS.currentDialogText)).toBe("第一句");
    expect(harness.engine.get(SYS.body)).toEqual(before);
  });

  it("scene 列没声明身体 ⇒ 仍然清空画面（那一屏由它自己的元素画）", () => {
    const harness = makeEngine([
      bodyColumn("a", "kitchen"),
      elementColumn("b", [{ op: "say", text: "元素画的一屏" }]),
    ]);
    harness.engine.start();
    harness.engine.navigate("b");
    expect(harness.engine.get(SYS.body)).toBeUndefined();
    expect(errorCodes(harness.events)).toEqual([]);
  });

  it("flow 列声明了身体 ⇒ 照常换上（流程列不是不能画）", () => {
    const harness = makeEngine([
      bodyColumn("a", "kitchen"),
      {
        id: "talk",
        kind: "flow",
        body: { name: "hall", props: { title: "大厅" } },
        commands: [{ op: "say", text: "换了一屏" }],
      },
    ]);
    harness.engine.start();
    harness.engine.navigate("talk");
    expect(harness.engine.get(SYS.body)).toEqual({
      name: "hall",
      props: { title: "大厅" },
    });
  });
});
