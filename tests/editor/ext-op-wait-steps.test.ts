/**
 * 扩展 op 等待 · 编辑器静态面（E3）验收门：ext-op-wait-steps。
 *
 * 语义对齐引擎等待声明表（SSOT = `WAITING_OPS` + `collectWaitSpecs` 合并面）：
 * `wait: true` 的扩展 op 经 `mergeOpSurface` 进编辑器 `OpSurface.waiting`，
 * 步骤切分把它当边界（waiting="extension"）；未合并面时回退内建表口径
 * （`waitingStateOfOp` / `waitSpecOfOp`），扩展 op 不产生切分——静态假边界由合并面决定。
 *
 * 不变量：步骤成员仍是顶层命令行的有序精确划分（不重、不漏、不乱序）。
 */
import { describe, expect, it } from "vitest";
import type { OpExtension, Story } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";
import {
  BUILTIN_OP_SURFACE,
  columnSteps,
  mergeOpSurface,
  type OpSurface,
} from "@lingfan/editor";

/** 演示扩展：一个声明等待的 op + 一个不声明的 op（回退口径下都是非边界） */
const waitExt: OpExtension = {
  id: "demo",
  stateVersion: 1,
  ops: [
    {
      op: "demo_gate",
      wait: true,
      exec: () => ({ ok: "wait", config: { level: 3 } }),
    },
    { op: "demo_nowait", exec: () => ({ ok: true }) },
  ],
};

/** 合并面（判定⑦）：内建表 + wait:true 扩展 op；SSOT 在引擎，编辑器只透传 */
const surfaceWithExt: OpSurface = mergeOpSurface([waitExt]);

/** 造故事（走真实解析器；扩展 op 名对解析器是普通命令名） */
function storyOf(columns: object[]): Story {
  return parseStory({ formatVersion: 1, id: "ext-steps", columns });
}

/** 顶层命令指针序列（时间线行口径：flow→commands） */
function topLevelPointers(story: Story, columnIndex: number): string[] {
  const column = story.columns[columnIndex]!;
  return (column.commands ?? []).map((_, i) => `/columns/${columnIndex}/commands/${i}`);
}

const say = (text: string): object => ({ op: "say", text });

describe("合并面：OpSurface.waiting 是引擎等待声明表的透传", () => {
  it("wait:true 的扩展 op 进表（state=extension），内建行保留，未声明的不进", () => {
    expect(surfaceWithExt.waiting!.get("demo_gate")).toEqual({
      state: "extension",
    });
    expect(surfaceWithExt.waiting!.get("say")).toEqual({ state: "dialog" });
    expect(surfaceWithExt.waiting!.get("demo_nowait")).toBeUndefined();
  });

  it("内建基面无 waiting 字段 ⇒ 切分回退内建表口径（waitingStateOfOp）", () => {
    expect(BUILTIN_OP_SURFACE.waiting).toBeUndefined();
  });
});

describe("列内切分：扩展等待点是边界（合并面决定，回退时不切分）", () => {
  const story = storyOf([
    {
      id: "start",
      kind: "flow",
      commands: [say("一"), { op: "demo_gate" }, say("二")],
    },
  ]);

  it("合并面下：扩展等待自成一个 waiting=extension 步，成员划分不重不漏", () => {
    const steps = columnSteps(story, 0, { surface: surfaceWithExt });
    expect(steps.map((s) => s.waiting)).toEqual(["dialog", "extension", "dialog"]);
    expect(steps.every((s) => s.kind === "wait")).toBe(true);
    expect(steps.flatMap((s) => s.commands)).toEqual(topLevelPointers(story, 0));
    expect(steps[1]!.commands).toEqual(["/columns/0/commands/1"]);
  });

  it("回退口径下：扩展 op 不是边界（静态假边界），并入其后最近的边界步", () => {
    const steps = columnSteps(story, 0); // 默认内建面
    expect(steps.map((s) => s.waiting)).toEqual(["dialog", "dialog"]);
    // 非边界命令归入其后的边界步：say 一 自成一步，demo_gate 与 say 二 同步
    expect(steps[0]!.commands).toEqual(["/columns/0/commands/0"]);
    expect(steps[1]!.commands).toEqual([
      "/columns/0/commands/1",
      "/columns/0/commands/2",
    ]);
    expect(steps.flatMap((s) => s.commands)).toEqual(topLevelPointers(story, 0));
  });

  it("hard 标记：扩展 WaitSpec 未声明 hard ⇒ false（与 pause 的 hard:true 对照）", () => {
    const story = storyOf([
      { id: "start", kind: "flow", commands: [{ op: "demo_gate" }, { op: "pause", seconds: 1 }] },
    ]);
    const steps = columnSteps(story, 0, { surface: surfaceWithExt });
    expect(steps.map((s) => [s.waiting, s.hard])).toEqual([
      ["extension", false],
      ["wait", true],
    ]);
  });
});

describe("引擎驱动交叉验证：等待转移次数 == 等待步骤数", () => {
  /** 顺序推进并统计 waiting 的 none → 非 none 转移（= 检查点建立次数） */
  function countWaits(story: Story): number {
    const engine = new StoryEngine(story, { extensions: [waitExt] });
    let previous = "none";
    let count = 0;
    engine.onStateChanged(({ key, value }) => {
      if (key !== SYS.waiting) return;
      const next = typeof value === "string" ? value : "none";
      if (previous === "none" && next !== "none") count += 1;
      previous = next;
    });
    try {
      engine.start();
      for (let i = 0; i < 20 && previous !== "none"; i += 1) {
        if (previous === "extension") {
          // 扩展等待以宿主口径解除（成功回执）后继续走列
          engine.resolveExtensionOp("demo_gate", { outcome: "success" });
          continue;
        }
        engine.advance(); // dialog 等待推进
      }
    } finally {
      engine.dispose();
    }
    return count;
  }

  it("say + 扩展门 + say：3 个等待步骤 = 3 次等待转移（extension 与内建同账）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [say("一"), { op: "demo_gate" }, say("二")],
      },
    ]);
    const waitSteps = columnSteps(story, 0, {
      surface: surfaceWithExt,
    }).filter((s) => s.kind === "wait").length;
    expect(waitSteps).toBe(3);
    expect(countWaits(story)).toBe(3);
  });
});
