/**
 * 01 §二.1 navigate op + 02 §三.3 会话 navigate + 07 §三.2 热重载测试。
 * 锚点：
 * - navigate-no-checkpoint（导航不建站：03-R1 检查点=玩家所见，back 跨导航可达导航前画面）
 * - navigate-scene-priority（目标列 = scene ?? path，老引擎 NavigateHandler 优先级）
 * - navigate-clears-dialog（切导航清旧对话镜像）
 * - navigate-unknown-fails / navigate-missing-path-fails（F1/E3 fail-closed，拒绝后状态原样）
 * - session-navigate-interrupts-wait（坐标切换打断任意等待）
 * - reload-preserves-state-reenters-column（热重载保变量、当前列重入、历史保留）
 * - reload-missing-column-falls-back（当前列被删 → engine.error + 回入口列）
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, ValueChanged } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

interface Harness {
  engine: StoryEngine;
  changes: ValueChanged[];
  errors: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const changes: ValueChanged[] = [];
  const errors: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    changes,
    errors,
    dispose: () => {
      offState();
      offEvent();
      engine.dispose();
    },
  };
}

function makeEngine(columns: object[], entry = "a"): Harness {
  return instrument(
    new StoryEngine(parseStory({ formatVersion: 1, id: "t", entry, columns })),
  );
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

function say(text: string): object {
  return { op: "say", text };
}

function engineErrorCode(h: Harness): string | undefined {
  const last = h.errors.at(-1);
  return last !== undefined && last.payload.kind === "engine.error"
    ? last.payload.code
    : undefined;
}

describe("01 §二.1 navigate op（跨列导航）", () => {
  it("path 导航进目标列，目标列首句上屏", () => {
    const h = makeEngine([
      column("a", [say("一"), { op: "navigate", path: "b" }]),
      column("b", [say("乙")]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("b");
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    h.dispose();
  });

  it("scene 优先进 scene 列（老引擎 SceneName ?? Path 优先级语义）", () => {
    const h = makeEngine([
      column("a", [{ op: "navigate", path: "decoy", scene: "b" }]),
      column("b", [say("乙")]),
      column("decoy", [say("陷阱")]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("b");
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    expect(engineErrorCode(h)).toBeUndefined();
    h.dispose();
  });

  it("导航清旧列对话镜像（老引擎导航清屏语义）", () => {
    const h = makeEngine([
      column("a", [say("一"), { op: "navigate", path: "b" }]),
      column("b", []), // 空列：导航后无新 say 覆盖，镜像应为空串
    ]);
    h.engine.start();
    h.engine.advance(); // 「一」解除 → navigate 执行
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("b");
    expect(h.engine.get(SYS.currentDialogText)).toBe("");
    expect(h.engine.get(SYS.currentDialogSpeaker)).toBe("");
    h.dispose();
  });

  it("未知目标列 fail-closed（F1/E3），拒绝后引擎状态原样", () => {
    const h = makeEngine([
      column("a", [say("一"), { op: "navigate", path: "ghost" }]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(engineErrorCode(h)).toBe("unknown-column");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a");
    expect(h.engine.get(SYS.currentDialogText)).toBe("");
    h.dispose();
  });

  it("缺 path fail-closed（运行期兜底：绕过解析层直接构造命令对象）", () => {
    const engine = new StoryEngine({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [{ id: "a", kind: "flow", commands: [{ op: "navigate" }] }],
    });
    const h = instrument(engine);
    h.engine.start();
    expect(engineErrorCode(h)).toBe("navigate-invalid");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a");
    h.dispose();
  });
});

describe("navigate × 回溯（锚点: navigate-no-checkpoint）", () => {
  it("navigate 不建独立检查点：back 从目标列一步跨过导航回导航前画面（03-R1：检查点=玩家所见）", () => {
    const h = makeEngine([
      column("a", [say("一"), { op: "navigate", path: "b" }]),
      column("b", [say("乙")]),
    ]);
    h.engine.start();
    h.engine.advance(); // 「一」入档 → navigate（无站）→ 「乙」等待
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    h.engine.back(); // 唯一前站 = 「一」：跨过导航落回导航前所见画面
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a");
    expect(h.engine.get(SYS.currentDialogText)).toBe("一");
    h.engine.forward(); // 前向恢复 → 重新导航进 b → 「乙」
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("b");
    h.dispose();
  });

  it("重放期导航照常执行：回溯/前进跨导航点时间线不破坏", () => {
    const h = makeEngine([
      column("a", [say("一"), { op: "navigate", path: "b" }]),
      column("b", [say("乙"), say("丙")]),
    ]);
    h.engine.start();
    h.engine.advance();
    h.engine.advance(); // 「乙」入档，「丙」等待
    expect(h.engine.get(SYS.currentDialogText)).toBe("丙");
    h.engine.back(); // 「乙」站
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    h.engine.forward(); // 「丙」站
    expect(h.engine.get(SYS.currentDialogText)).toBe("丙");
    h.dispose();
  });
});

describe("02 §三.3 会话命令 navigate（坐标切换）", () => {
  it("等待中导航：打断等待、清镜像、进目标列（会话命令不建检查点）", () => {
    const h = makeEngine([column("a", [say("一")]), column("b", [say("乙")])]);
    h.engine.start();
    expect(h.engine.get(SYS.waiting)).toBe("dialog"); // 「一」等待中
    h.engine.navigate("b");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("b");
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    h.dispose();
  });

  it("wait 定时等待中导航：旧定时器废弃，不双触发", () => {
    const h = makeEngine([
      column("a", [{ op: "wait", seconds: 60, skipable: true }]),
      column("b", [say("乙")]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.waiting)).toBe("wait");
    h.engine.navigate("b");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("b");
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    h.dispose();
  });

  it("未知列 fail-closed + 未启动 fail-closed", () => {
    const h = makeEngine([column("a", [say("一")]), column("b", [])]);
    h.engine.navigate("ghost");
    expect(engineErrorCode(h)).toBe("navigate-invalid"); // 未启动
    h.engine.start();
    h.engine.navigate("ghost");
    expect(engineErrorCode(h)).toBe("unknown-column");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a"); // 拒绝后原样
    h.dispose();
  });
});

describe("07 §三.2 热重载 reloadStory（锚点: reload-preserves-state-reenters-column）", () => {
  it("保变量、当前列重入起点、新文案即改即所见、历史保留可回溯", () => {
    const h = makeEngine([
      column("a", [
        { op: "set", key: "gold", value: 5 },
        say("旧一"),
        say("旧二"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance(); // 「旧一」入档，「旧二」等待中
    const fresh = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        column("a", [
          { op: "set", key: "gold", value: 5 },
          say("新一"),
          say("新二"),
        ]),
      ],
    });
    h.engine.reloadStory(fresh);
    expect(h.engine.get("gold")).toBe(5); // 运行态保留
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a"); // 当前列重入
    expect(h.engine.get(SYS.currentDialogText)).toBe("新一"); // 起点重放：新文案自重入起生效
    // 历史保留：回溯站重放**快照帧**（历史 = 玩家见过的旧内容，文案不随热重载改写）
    h.engine.back();
    expect(h.engine.get(SYS.currentDialogText)).toBe("旧二");
    h.engine.back();
    expect(h.engine.get(SYS.currentDialogText)).toBe("旧一");
    expect(engineErrorCode(h)).toBeUndefined();
    h.dispose();
  });

  it("当前列被删：engine.error 显式信号 + 回入口列（fail-closed 不假装成功）", () => {
    const h = makeEngine([
      column("a", [say("一"), { op: "jump", target: "b" }]),
      column("b", [say("旧乙")]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("b");
    const fresh = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [column("a", [say("一"), { op: "jump", target: "b" }])],
    }); // b 列被删（组装器放行：b 仅是跳转目标，F1 校验在执行期 fail-closed）
    h.engine.reloadStory(fresh);
    expect(engineErrorCode(h)).toBe("reload-column-missing");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a"); // 回入口列
    expect(h.engine.get(SYS.currentDialogText)).toBe("一");
    h.dispose();
  });

  it("未启动 reload fail-closed", () => {
    const h = makeEngine([column("a", [say("一")])]);
    h.engine.reloadStory(
      parseStory({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [column("a", [say("一")])],
      }),
    );
    expect(engineErrorCode(h)).toBe("reload-invalid");
    h.dispose();
  });
});
