/**
 * 步骤布局（列内切分 + 列间分支）测试：拟态旅程为主，故意错误与边界为对抗面。
 *
 * 验收集点：
 * 1. **划分口径**（验收①的可测定义）：步骤的成员是**列内顶层命令的有序精确划分**——
 *    `steps.flatMap(commands)` 必须与顶层行指针序列逐元素相等（无重、无漏、无乱序）；
 * 2. **引擎驱动交叉验证**：线性/含块体故事逐等待点推进，`SYS.waiting` 的
 *    `none → 非 none` 转移次数 == 等待步骤数（步骤数 = 顺序执行产生的检查点数）；
 * 3. **分叉**（验收②）：菜单多选项 → 多条出边（带选项文案）；跳转/导航各成一类；
 * 4. 边界与对抗：空列 / 单命令列 / scene 列 / 纯元素列 / 块体含等待 / `call` 到含等待函数 /
 *    函数互为环 / 非对象命令 / 缺 op / 悬空目标。
 */
import { describe, expect, it } from "vitest";
import type { Story } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";
import { columnSteps, storySteps } from "@lingfan/editor";

/** 顶层命令指针序列（时间线行口径：flow→commands，scene→entry） */
function topLevelPointers(story: Story, columnIndex: number): string[] {
  const column = story.columns[columnIndex]!;
  const field: "commands" | "entry" =
    column.kind === "flow" ? "commands" : "entry";
  const list = (field === "commands" ? column.commands : column.entry) ?? [];
  return list.map((_, i) => `/columns/${columnIndex}/${field}/${i}`);
}

/** 造故事（多列 flow/scene 混合；走真实解析器，保证形状合法） */
function storyOf(columns: object[], entry?: string): Story {
  return parseStory({
    formatVersion: 1,
    id: "steps-demo",
    ...(entry === undefined ? {} : { entry }),
    columns,
  });
}

/** 绕过解析器造畸形故事（对抗：算法必须不崩） */
function rawStory(columns: unknown[]): Story {
  return { formatVersion: 1, id: "raw", entry: "start", columns } as Story;
}

const say = (text: string): object => ({ op: "say", text });

describe("划分口径：步骤是顶层命令行的有序精确划分", () => {
  it("线性列：非边界命令并入其后最近的边界，逐步收尾", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          say("一"),
          { op: "set", key: "n", value: 1 },
          say("二"),
          { op: "menu", prompt: "选", options: [{ text: "走", target: "start" }] },
          { op: "set", key: "m", value: 2 },
          { op: "wait", seconds: 1 },
          { op: "input", prompt: "名", store: "name" },
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    expect(steps.map((s) => s.waiting)).toEqual([
      "dialog",
      "dialog",
      "menu",
      "wait",
      "input",
    ]);
    expect(steps.map((s) => s.commands.length)).toEqual([1, 2, 1, 2, 1]);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(steps.every((s) => s.kind === "wait")).toBe(true);
    // 验收①的口径：成员指针与顶层行指针序列逐元素相等
    expect(steps.flatMap((s) => s.commands)).toEqual(
      topLevelPointers(story, 0),
    );
    // 首尾指针与成员一致（点击定位用 endPointer）
    expect(steps[0]!.startPointer).toBe("/columns/0/commands/0");
    expect(steps[1]!.endPointer).toBe("/columns/0/commands/2");
  });

  it("列尾无等待点 → 产出口步（kind:exit，waiting:none）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [say("一"), { op: "set", key: "n", value: 1 }],
      },
    ]);
    const steps = columnSteps(story, 0);
    expect(steps.map((s) => [s.kind, s.waiting])).toEqual([
      ["wait", "dialog"],
      ["exit", "none"],
    ]);
    expect(steps.flatMap((s) => s.commands)).toEqual(
      topLevelPointers(story, 0),
    );
  });

  it("pause 与 wait 同等待态、「不可跳过」标记不同", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "wait", seconds: 1 },
          { op: "pause", seconds: 1 },
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    expect(steps.map((s) => [s.waiting, s.hard])).toEqual([
      ["wait", false],
      ["wait", true],
    ]);
  });

  it("空列 / 命令字段缺失 → 0 步（不崩）", () => {
    const empty = storyOf([{ id: "start", kind: "flow", commands: [] }]);
    expect(columnSteps(empty, 0)).toEqual([]);
    expect(columnSteps(rawStory([{ id: "s", kind: "flow" }]), 0)).toEqual([]);
    expect(columnSteps(empty, 99)).toEqual([]); // 越界列
  });
});

describe("引擎驱动交叉验证：等待转移次数 == 等待步骤数", () => {
  /** 顺序推进并统计 waiting 的 none → 非 none 转移（= 检查点建立次数） */
  function countWaits(story: Story): number {
    const engine = new StoryEngine(story);
    let previous: string = "none";
    let count = 0;
    engine.onStateChanged(({ key, value }) => {
      if (key !== SYS.waiting) return;
      const next = typeof value === "string" ? value : "none";
      if (previous === "none" && next !== "none") count += 1;
      previous = next;
    });
    try {
      engine.start();
      // 线性故事全程可用 advance 推进（无 menu/input/定时器）
      for (let i = 0; i < 20 && previous !== "none"; i += 1) {
        engine.advance();
      }
      // 末步之后引擎回到 idle：补一次推进以触发最后一步的转移
      engine.advance();
    } finally {
      engine.dispose();
    }
    return count;
  }

  function waitStepsOf(story: Story): number {
    return columnSteps(story, 0).filter((s) => s.kind === "wait").length;
  }

  it("纯对话列：3 句 say → 3 个等待步骤 = 3 次转移", () => {
    const story = storyOf([
      { id: "start", kind: "flow", commands: [say("一"), say("二"), say("三")] },
    ]);
    expect(waitStepsOf(story)).toBe(3);
    expect(countWaits(story)).toBe(3);
  });

  it("含块体：if 体内 say 与顶层 say 各成一步（块帧坐标回退语义）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          say("一"),
          { op: "if", cond: "1 == 1", then: [say("体内")] },
          say("二"),
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    expect(steps.map((s) => s.waiting)).toEqual(["dialog", "dialog", "dialog"]);
    // 块命令本身即第二步的收尾（体内等待回退到块进入命令）
    expect(steps[1]!.commands).toEqual(["/columns/0/commands/1"]);
    expect(waitStepsOf(story)).toBe(3);
    expect(countWaits(story)).toBe(3);
  });
});

describe("分叉：菜单选项 / 跳转 / 导航各自成边（验收②）", () => {
  const forkStory = storyOf([
    {
      id: "start",
      kind: "flow",
      commands: [
        { op: "set", key: "n", value: 1 },
        {
          op: "menu",
          prompt: "去哪",
          options: [
            { text: "酒馆", target: "inn" },
            { text: "广场", target: "square" },
            { text: "回家", target: "home" },
          ],
        },
      ],
    },
    { id: "inn", kind: "flow", commands: [say("酒馆线")] },
    { id: "square", kind: "flow", commands: [say("广场线")] },
    { id: "home", kind: "flow", commands: [say("回家线")] },
  ]);

  it("菜单三选项 → 三条 menu 边，带选项文案，且全部挂在同一步（分叉而非独立链）", () => {
    const layout = storySteps(forkStory);
    const menuEdges = layout.edges.filter((e) => e.kind === "menu");
    expect(menuEdges).toHaveLength(3);
    expect(menuEdges.map((e) => e.toColumnId).sort()).toEqual([
      "home",
      "inn",
      "square",
    ]);
    expect(menuEdges.map((e) => e.label).sort()).toEqual([
      "回家",
      "广场",
      "酒馆",
    ]);
    // 三条边同源（同一列同一步）——这就是「一条链分叉」而非「三条独立链」
    expect(new Set(menuEdges.map((e) => `${e.fromColumnId}#${e.fromStep}`)).size).toBe(1);
    expect(menuEdges[0]!.fromColumnId).toBe("start");
    expect(menuEdges[0]!.fromStep).toBe(0); // set + menu 同属第一步
  });

  it("跳转 / 导航出边：jump 走 target，navigate 走 scene 优先（与引擎 execNavigate 同序）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          say("一"),
          { op: "jump", target: "inn" },
          { op: "navigate", path: "square", scene: "home" },
        ],
      },
      { id: "inn", kind: "flow", commands: [say("x")] },
      { id: "square", kind: "flow", commands: [say("y")] },
      { id: "home", kind: "flow", commands: [say("z")] },
    ]);
    const steps = columnSteps(story, 0);
    // jump/navigate 非边界 → 并入其后的出口步
    const exit = steps.at(-1)!;
    expect(exit.kind).toBe("exit");
    expect(exit.forks.map((f) => [f.kind, f.target])).toEqual([
      ["jump", "inn"],
      ["navigate", "home"],
    ]);
  });

  it("悬空目标不画幽灵边（交诊断报 missing-target）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "menu", prompt: "选", options: [{ text: "去", target: "ghost" }] },
        ],
      },
    ]);
    const layout = storySteps(story);
    expect(layout.edges).toEqual([]); // 目标列不存在 → 视图不画边
    expect(columnSteps(story, 0)[0]!.forks.map((f) => f.target)).toEqual([
      "ghost", // 步内仍如实记录出边事实（诊断据此报错）
    ]);
  });
});

describe("函数调用：call 到含等待的函数算边界（引擎的块帧坐标语义）", () => {
  it("call 追进被调函数体：函数体内的 say 使 call 成为边界", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "greet",
            params: [],
            body: [say("你好")],
          },
          { op: "call", target: "greet" },
          say("尾"),
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    expect(steps.map((s) => s.waiting)).toEqual(["dialog", "dialog"]);
    // func 定义体不执行 ⇒ func 是非边界，与 call 同属一步
    expect(steps[0]!.commands).toEqual([
      "/columns/0/commands/0",
      "/columns/0/commands/1",
    ]);
    expect(steps[1]!.commands).toEqual(["/columns/0/commands/2"]);
  });

  it("不含等待的函数：call 不是边界（并入其后最近的等待点）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "func", name: "noop", params: [], body: [{ op: "set", key: "k", value: 1 }] },
          { op: "call", target: "noop" },
          say("尾"),
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.commands).toHaveLength(3);
    expect(steps[0]!.waiting).toBe("dialog");
  });

  it("函数互为调用环：不死循环（visited 防环）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "func", name: "a", params: [], body: [{ op: "call", target: "b" }] },
          { op: "func", name: "b", params: [], body: [{ op: "call", target: "a" }] },
          { op: "call", target: "a" },
          say("尾"),
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    expect(steps).toHaveLength(1); // 环中无等待 ⇒ 全程并入尾句
    expect(steps[0]!.commands).toHaveLength(4);
  });
});

describe("scene 列与泳道总装", () => {
  it("scene 列：entry 计步、elements 不计步（仅作泳道徽标）", () => {
    const story = storyOf([
      { id: "start", kind: "flow", commands: [say("入口")] },
      {
        id: "stage",
        kind: "scene",
        elements: [{ type: "text", x: 0, y: 0 }, { type: "image", x: 1, y: 1 }],
        entry: [say("场景内")],
      },
    ]);
    const steps = columnSteps(story, 1);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.waiting).toBe("dialog");
    const layout = storySteps(story);
    const lane = layout.lanes.find((l) => l.columnId === "stage")!;
    expect(lane.kind).toBe("scene");
    expect(lane.elementCount).toBe(2);
    expect(lane.steps).toHaveLength(1);
  });

  it("纯元素 scene 列（无 entry）→ 0 步，但泳道仍在", () => {
    const story = storyOf([
      { id: "start", kind: "flow", commands: [say("入口")] },
      { id: "stage", kind: "scene", elements: [{ type: "text", x: 0, y: 0 }] },
    ]);
    const layout = storySteps(story);
    const lane = layout.lanes.find((l) => l.columnId === "stage")!;
    expect(lane.steps).toEqual([]);
    expect(lane.elementCount).toBe(1);
    expect(layout.stepCounts.get("stage")).toBe(0);
  });

  it("泳道分层：入口列 0 层，被跳转指向的列在其后（含未达列归末层）", () => {
    const story = storyOf([
      {
        id: "start",
        kind: "flow",
        commands: [say("一"), { op: "jump", target: "second" }],
      },
      { id: "second", kind: "flow", commands: [say("二")] },
      { id: "orphan", kind: "flow", commands: [say("孤")] },
    ]);
    const layout = storySteps(story);
    const layerOf = new Map(layout.lanes.map((l) => [l.columnId, l.layer]));
    expect(layerOf.get("start")).toBe(0);
    expect(layerOf.get("second")).toBe(1);
    expect(layerOf.get("orphan")).toBe(2); // 无入边 → 末层
  });

  it("层内保持列声明序（确定性排布，不依赖任何外部状态）", () => {
    const story = storyOf([
      { id: "start", kind: "flow", commands: [say("一")] },
      { id: "b", kind: "flow", commands: [say("二")] },
      { id: "c", kind: "flow", commands: [say("三")] },
    ]);
    const layout = storySteps(story);
    expect(layout.lanes.map((l) => l.columnId)).toEqual(["start", "b", "c"]);
  });
});

describe("对抗：畸形输入不崩且不误报", () => {
  it("非对象命令 / 缺 op / 缺块体字段", () => {
    const story = rawStory([
      {
        id: "start",
        kind: "flow",
        commands: [
          null,
          42,
          "字符串",
          { text: "缺 op" },
          { op: "if", cond: "1 == 1" }, // 缺 then
          { op: "if", cond: "1 == 1", then: [say("体内")] },
          say("尾"),
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    // 畸形命令一律按非边界处理（不外扩判定），全部并入最近的两个边界
    expect(steps.flatMap((s) => s.commands)).toEqual(
      topLevelPointers(story, 0),
    );
    expect(steps.map((s) => s.waiting)).toEqual(["dialog", "dialog"]);
  });

  it("畸形 op / 残缺出边栏位（target 非字符串 / 选项缺 target）不产生虚假出边", () => {
    const story = rawStory([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: 42 },
          { op: "jump", target: 7 },
          { op: "navigate", path: 8 },
          { op: "menu", options: [{ text: "x" }] },
          say("尾"),
        ],
      },
    ]);
    const steps = columnSteps(story, 0);
    // menu 仍是等待 op（等待态的建立与负载是否完整无关）⇒ 两步
    expect(steps.map((s) => s.waiting)).toEqual(["menu", "dialog"]);
    expect(steps.flatMap((s) => s.forks)).toEqual([]);
    expect(steps.flatMap((s) => s.commands)).toEqual(
      topLevelPointers(story, 0),
    );
  });

  it("storySteps 对空故事 / 无 columns 不崩", () => {
    const empty = { formatVersion: 1, id: "e", entry: "x", columns: [] } as Story;
    expect(storySteps(empty)).toEqual({
      lanes: [],
      edges: [],
      stepCounts: new Map(),
    });
    expect(columnSteps(empty, 0)).toEqual([]);
  });
});