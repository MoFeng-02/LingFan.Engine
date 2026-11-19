/**
 * mount 通道写面：挂载组件经 HostControls.submit 够到 op 全集（与 body 通道同源）。
 *
 * 判据对着「两通道纪律有没有破」写：submit 必须转发引擎的场景提交入口（单一声明，
 * 不另建第二份实现），存档类动作整批拒、状态原样；props 通道仍 JSON 安全（函数进不去）。
 * 用真引擎——submit 的生效与拒收只有对着真实状态才有意义。
 */
import { describe, expect, it } from "vitest";
import {
  SYS,
  StoryEngine,
  parseStory,
  type AudioPort,
  type OutboundEvent,
  type VideoPort,
} from "@lingfan-engine/core";
import { createHostControls } from "../../template/v1/__PROJECT__/src/host/controls";

function makeEngine(): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "第一句" },
            { op: "say", text: "第二句" },
          ],
        },
        { id: "other", kind: "flow", commands: [{ op: "say", text: "别处" }] },
      ],
    }),
  );
}

const audioPort = {
  play: () => {},
  stop: () => {},
  pause: () => {},
  resume: () => {},
  position: () => 0,
  dispose: () => {},
} as unknown as AudioPort;
const videoPort = {
  play: () => {},
  pause: () => {},
  resume: () => {},
  seek: () => {},
  stop: () => {},
  dispose: () => {},
} as unknown as VideoPort;

function makeControls(engine: StoryEngine) {
  return createHostControls({
    engine: () => engine,
    audio: () => audioPort,
    video: () => videoPort,
  });
}

describe("mount 组件经 controls.submit 提交 op（mount-controls-submit-ops）", () => {
  it("submit 一条 say 生效：玩家可见事实落引擎状态", () => {
    const engine = makeEngine();
    engine.start();
    const controls = makeControls(engine);

    expect(controls.submit([{ op: "say", text: "来自挂载组件" }])).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("来自挂载组件");
    engine.dispose();
  });

  it("submit menu 进入菜单等待（与 body 通道同一提交入口）", () => {
    const engine = makeEngine();
    engine.start();
    const controls = makeControls(engine);

    expect(
      controls.submit([
        {
          op: "menu",
          prompt: "去哪",
          options: [{ text: "别处", target: "other" }],
        },
      ]),
    ).toBe(true);
    expect(engine.get(SYS.waiting)).toBe("menu");
    engine.dispose();
  });
});

describe("submit 的存档类动作整批拒（submit-load-rejected）", () => {
  it("含 load 整批拒：返回 false 且状态原样（连前面的 say 也不生效）", () => {
    const engine = makeEngine();
    engine.start();
    engine.advance(); // 走到第二句
    const controls = makeControls(engine);
    const before = engine.get(SYS.currentDialogText);

    const ok = controls.submit([
      { op: "say", text: "不该生效" },
      { op: "load", slot: "slot_1" },
    ]);

    expect(ok).toBe(false);
    expect(engine.get(SYS.currentDialogText)).toBe(before);
    engine.dispose();
  });
});

describe("props 通道 JSON 安全纪律不破（props-json-safe）", () => {
  it("mount props 里的函数进不了状态（随 JSON 语义丢弃，穿透即红）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "start",
            kind: "flow",
            commands: [
              {
                op: "mount",
                name: "hub",
                visible: true,
                props: { fn: () => {}, scene: "forest" },
              },
              { op: "say", text: "停在这里看状态" },
            ],
          },
        ],
      }),
    );
    engine.start();

    // 函数随 JSON 序列化被丢弃（与 JSON.stringify 同语义）：进得了内存态，进不了存档
    const table = JSON.parse(JSON.stringify(engine.get(SYS.mounts))) as Record<
      string,
      { props: Record<string, unknown> }
    >;
    expect(table.hub.props).toEqual({ scene: "forest" });
    expect(table.hub.props.fn).toBeUndefined();
    engine.dispose();
  });

  it("mount props 带 Map（非 JSON 安全对象）→ fail-closed 拒收，挂载表原样", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "start",
            kind: "flow",
            commands: [
              {
                op: "mount",
                name: "hub",
                visible: true,
                props: { cache: new Map([["k", 1]]) },
              },
              { op: "say", text: "停在这里看状态" },
            ],
          },
        ],
      }),
    );
    const errors: OutboundEvent[] = [];
    engine.onEvent((e) => errors.push(e));
    engine.start();

    const codes = errors
      .filter((e) => e.payload.kind === "engine.error")
      .map((e) => (e.payload as { code: string }).code);
    expect(codes).toContain("mount-unsafe-props");
    expect(
      (engine.get(SYS.mounts) ?? {}) as Record<string, unknown>,
    ).not.toHaveProperty("hub");
    engine.dispose();
  });
});
