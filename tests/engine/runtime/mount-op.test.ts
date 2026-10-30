/**
 * `mount` op 的行为判据：挂载 / 卸载 UI 组件写成 `SYS.mounts` 里的状态。
 *
 * 这一族最容易写错的三处，各有对应用例：
 * - **隐藏 ≠ display:none**：`visible: false` 是「从渲染树移除」，状态里必须留一条
 *   `visible: false` 的记录（而不是删掉键）——宿主靠这条记录卸载组件，删键等于「没提过」。
 * - **写时复制**：原地改表会与快照共享引用，回溯后旧值被一起改掉。判据用「回溯读到
 *   当时的值」来咬这件事，而不是只看当前值。
 * - **props 必须 JSON 安全**：`Map` / `Date` / 循环引用进状态后写档才炸且无定位，
 *   所以在写入点就 fail-closed。
 */
import { describe, expect, it } from "vitest";
import type { MountTable, OutboundEvent, Story } from "@lingfan-engine/core";
import {
  parseStory,
  parseTextStory,
  projectText,
  SYS,
  StoryEngine,
} from "@lingfan-engine/core";

function makeStory(commands: object[]): Story {
  return parseStory({
    formatVersion: 1,
    id: "mounts",
    columns: [{ id: "start", kind: "flow", commands }],
  });
}

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
  dispose: () => void;
}

function makeEngine(commands: object[]): Harness {
  const engine = new StoryEngine(makeStory(commands), { rngSeed: 3 });
  const errors: OutboundEvent[] = [];
  const off = engine.onEvent((e) => errors.push(e));
  engine.start();
  return {
    engine,
    errors,
    dispose: () => {
      off();
      engine.dispose();
    },
  };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  const codes: string[] = [];
  for (const event of errors) {
    if (event.payload.kind === "engine.error") codes.push(event.payload.code);
  }
  return codes;
}

function tableOf(engine: StoryEngine): MountTable {
  return (engine.get(SYS.mounts) ?? {}) as MountTable;
}

const TAIL = { op: "say", text: "停在这里看状态" };

describe("mount · 显示与隐藏", () => {
  it("挂载：状态里留一条 visible: true 的记录", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "mount", name: "hub", visible: true },
      TAIL,
    ]);
    expect(errorCodes(errors)).toEqual([]);
    expect(tableOf(engine).hub).toEqual({ visible: true, props: {} });
    dispose();
  });

  it("隐藏：留 visible: false 的记录（不是删键——宿主靠它卸载组件）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "mount", name: "hub", visible: true },
      { op: "mount", name: "hub", visible: false },
      TAIL,
    ]);
    expect(errorCodes(errors)).toEqual([]);
    expect(tableOf(engine).hub).toEqual({ visible: false, props: {} });
    dispose();
  });
});

describe("mount · 入参", () => {
  it("带 props：整份写进记录", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "mount", name: "map", visible: true, props: { scene: "forest" } },
      TAIL,
    ]);
    expect(errorCodes(errors)).toEqual([]);
    expect(tableOf(engine).map).toEqual({
      visible: true,
      props: { scene: "forest" },
    });
    dispose();
  });

  it("props 整份替换而不是浅合并（能表达「删掉一个入参」）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "mount", name: "map", visible: true, props: { a: 1, b: 2 } },
      { op: "mount", name: "map", visible: true, props: { a: 1 } },
      TAIL,
    ]);
    expect(errorCodes(errors)).toEqual([]);
    expect(tableOf(engine).map).toEqual({ visible: true, props: { a: 1 } });
    dispose();
  });
});

describe("mount · fail-closed", () => {
  it("未知负载字段被拒（不静默忽略）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "mount", name: "hub", visible: true, bogus: 1 },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("mount-unknown-field");
    expect(tableOf(engine).hub).toBeUndefined();
    dispose();
  });

  it("非 JSON 安全的 props 被拒（Map 会静默序列化成 {}）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        op: "mount",
        name: "hub",
        visible: true,
        props: { cache: new Map([["k", 1]]) },
      },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("mount-unsafe-props");
    expect(tableOf(engine).hub).toBeUndefined();
    dispose();
  });

  it("非法 UI 名被拒（名字同时是产物键与目录名，形态必须统一）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "mount", name: "Hub", visible: true },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("mount-invalid-name");
    expect(tableOf(engine)).toEqual({});
    dispose();
  });

  it('非布尔 visible 被拒（字符串 "true" 不是 true）', () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "mount", name: "hub", visible: "true" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("mount-invalid-visible");
    expect(tableOf(engine)).toEqual({});
    dispose();
  });
});

describe("mount · 随快照与存档", () => {
  it("回溯回原值（写时复制：旧表引用没被污染）", () => {
    const { engine, dispose } = makeEngine([
      { op: "mount", name: "hub", visible: true, props: { step: 1 } },
      { op: "say", text: "第一步" },
      { op: "mount", name: "hub", visible: true, props: { step: 2 } },
      { op: "say", text: "第二步" },
    ]);
    engine.rollbackTo(1);
    expect(tableOf(engine).hub).toEqual({ visible: true, props: { step: 1 } });
    dispose();
  });

  it("挂载表进存档并能原样读回", () => {
    const { engine, dispose } = makeEngine([
      { op: "mount", name: "hub", visible: true, props: { scene: "inn" } },
      { op: "mount", name: "map", visible: false },
      TAIL,
    ]);
    const saved = engine.exportSave();
    expect(saved).not.toBeNull();
    const before = tableOf(engine);
    expect(before).toEqual({
      hub: { visible: true, props: { scene: "inn" } },
      map: { visible: false, props: {} },
    });
    dispose();

    const second = makeEngine([TAIL]);
    expect(second.engine.importSave(saved!)).toBe(true);
    expect(tableOf(second.engine)).toEqual(before);
    second.dispose();
  });
});

describe("mount · 文本形态双向投影", () => {
  const commands = [
    { op: "mount", name: "hub", visible: true },
    { op: "mount", name: "map", visible: false },
    { op: "mount", name: "map", visible: true, props: { scene: "forest" } },
  ];

  it("JSON → 文本 → JSON 往返等价", () => {
    const text = projectText(makeStory(commands)).text;
    const again = parseTextStory(text);
    expect(again.columns[0]?.commands).toEqual(commands);
  });

  it("文本形态把 UI 名与显隐写成位置参数、props 写成字典字段", () => {
    const text = projectText(makeStory(commands)).text;
    expect(text).toContain("mount hub true");
    expect(text).toContain("mount map false");
    expect(text).toContain('mount map true props={"scene": "forest"}');
  });

  it("缺显隐、未知参数、非布尔显隐都 fail-closed（不猜默认值）", () => {
    const base = projectText(
      makeStory([{ op: "mount", name: "hub", visible: true }]),
    ).text;
    expect(() =>
      parseTextStory(base.replace("mount hub true", "mount hub")),
    ).toThrow(/mount 需要 true\|false/);
    expect(() =>
      parseTextStory(base.replace("mount hub true", "mount hub true extra=1")),
    ).toThrow(/mount 未知参数/);
    expect(() =>
      parseTextStory(base.replace("mount hub true", "mount hub yes")),
    ).toThrow(/mount 需要 true\|false/);
  });
});
