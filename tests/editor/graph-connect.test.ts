/**
 * 节点图连线建分支测试。
 *
 * 测试纪律：
 * - 纯语义边界：无 menu → jump / 有 menu → 最后一个 menu 追加 / scene 列与自连 fail-closed
 * - 拟态作者旅程：拉线 → 一个 undo 单元 → 一步回滚；**文本投影往返等价**
 * - fail-closed 可见：删列后拉出的分支报 missing-target（引用同步复用既有诊断面）
 * - 源码互锁：提交走 session 单提交、组件不绕会话
 */

import { describe, expect, it } from "vitest";
import type { Story, StoryColumn, StoryCommand } from "@lingfan/engine";
import { generateText, parseTextStory } from "@lingfan/engine";
import {
  analyzeStory,
  branchPointerToCommand,
  EditorSession,
  getAtPointer,
  insertAtPointer,
  isBranchTarget,
  planBranchInsertion,
  removeColumn,
} from "@lingfan/editor";
import appSource from "../../apps/editor/src/App.vue?raw";
import nodeGraphSource from "../../apps/editor/src/components/NodeGraph.vue?raw";

function flowColumn(id: string, commands: StoryCommand[]): StoryColumn {
  return { id, kind: "flow", commands };
}

function makeStory(): Story {
  return {
    formatVersion: 1,
    id: "demo",
    entry: "start",
    columns: [
      flowColumn("start", [{ op: "say", text: "开场" }]),
      flowColumn("tavern", [{ op: "say", text: "酒馆" }]),
      flowColumn("square", [
        { op: "say", text: "广场" },
        {
          op: "menu",
          prompt: "去哪？",
          options: [{ text: "回酒馆", target: "tavern" }],
        },
      ]),
    ],
  };
}

/** 与 App.vue `connectBranch` 相同的提交体（纯函数组合；一次调用 = 一个 undo 单元） */
function connectBranchViaApi(
  session: EditorSession,
  fromColumnId: string,
  toColumnId: string,
  optionText?: string,
): boolean {
  return session.apply(`连分支 ${fromColumnId} → ${toColumnId}`, (s) => {
    const index = s.columns.findIndex((c) => c.id === fromColumnId);
    if (index < 0) return null;
    const plan = planBranchInsertion(s.columns[index], toColumnId, optionText);
    if (plan === null) return null;
    const value =
      plan.kind === "jump"
        ? { op: "jump", target: plan.target }
        : { text: plan.text ?? "新选项", target: plan.target };
    return insertAtPointer(
      s,
      `/columns/${index}/${plan.containerPointer}`,
      plan.index,
      value,
    );
  });
}

describe("planBranchInsertion：拉线落库语义", () => {
  it("无 menu → commands 末尾追加 jump", () => {
    const column = flowColumn("start", [{ op: "say", text: "开场" }]);
    expect(planBranchInsertion(column, "tavern")).toEqual({
      kind: "jump",
      containerPointer: "commands",
      index: 1,
      target: "tavern",
    });
  });

  it("有 menu（多个取最后一个）→ options 末尾追加选项；optionText 缺省「新选项」", () => {
    const column = {
      id: "square",
      kind: "flow",
      commands: [
        {
          op: "menu",
          prompt: "一",
          options: [{ text: "a", target: "start" }],
        },
        { op: "say", text: "中转" },
        {
          op: "menu",
          prompt: "二",
          options: [{ text: "b", target: "start" }],
        },
      ],
    } as unknown as StoryColumn;
    expect(planBranchInsertion(column, "tavern")).toEqual({
      kind: "menu-option",
      containerPointer: "commands/2/options",
      index: 1,
      text: "新选项",
      target: "tavern",
    });
    expect(planBranchInsertion(column, "tavern", "去酒馆")?.text).toBe(
      "去酒馆",
    );
  });

  it("fail-closed：scene 源 / 自连 → null；scene 目标 → isBranchTarget false", () => {
    const scene = { id: "stage", kind: "scene", elements: [] };
    const flow = flowColumn("start", []);
    expect(planBranchInsertion(scene, "tavern")).toBeNull();
    expect(planBranchInsertion(flow, "start")).toBeNull();
    expect(isBranchTarget(scene)).toBe(false);
    expect(isBranchTarget(flow)).toBe(true);
  });
});

describe("branchPointerToCommand：边点击 → 命令指针", () => {
  it("jump / menu 选项 / 非命令形态三种形状", () => {
    expect(branchPointerToCommand("/columns/0/commands/2/target")).toBe(
      "/columns/0/commands/2",
    );
    expect(
      branchPointerToCommand("/columns/1/commands/3/options/1/target"),
    ).toBe("/columns/1/commands/3");
    expect(branchPointerToCommand("/columns/2")).toBe("/columns/2");
  });
});

describe("拟态作者旅程：拉线 → 一步回滚 → 投影往返等价", () => {
  it("拉 jump：一个 undo 单元；generateText ∘ parseTextStory 深等；undo 回原状", () => {
    const story = makeStory();
    const before = JSON.stringify(story);
    const session = new EditorSession(story);

    expect(connectBranchViaApi(session, "start", "tavern")).toBe(true);
    expect(session.undoDepth).toBe(1); // 一次拉线 = 一个 undo 单元
    const commands = getAtPointer(
      session.story,
      "/columns/0/commands",
    ) as StoryCommand[];
    expect(commands).toEqual([
      { op: "say", text: "开场" },
      { op: "jump", target: "tavern" },
    ]);
    // 文本投影往返等价。story.id 不在文本形态承载（工程 id 归 project.json 清单，
    // → parse 缺省 id="story"，对比时归一；其余字段（含新 jump）必须深等。
    const reparsed = parseTextStory(generateText(session.story));
    expect({ ...reparsed, id: session.story.id }).toEqual(session.story);

    expect(session.undo()).toBe(true);
    expect(JSON.stringify(session.story)).toBe(before);
  });

  it("拉 menu 选项：追加到最后一个 menu 的 options；投影往返等价", () => {
    const story = makeStory();
    const session = new EditorSession(story);
    expect(connectBranchViaApi(session, "square", "start", "回起点")).toBe(
      true,
    );
    const menu = getAtPointer(
      session.story,
      "/columns/2/commands/1",
    ) as { options?: unknown[] };
    expect(menu.options).toEqual([
      { text: "回酒馆", target: "tavern" },
      { text: "回起点", target: "start" },
    ]);
    const reparsed = parseTextStory(generateText(session.story));
    expect({ ...reparsed, id: story.id }).toEqual(session.story);
  });

  it("删列后拉出的分支 → missing-target（fail-closed 可见，引用同步复用既有语义）", () => {
    const story = makeStory();
    const session = new EditorSession(story);
    expect(connectBranchViaApi(session, "start", "tavern")).toBe(true);
    const next = removeColumn(session.story, "tavern");
    expect(next).not.toBeNull();
    session.commit("删除列 tavern", next!);
    const missing = analyzeStory(session.story).filter(
      (d) => d.code === "missing-target",
    );
    // 新拉出的 jump + square 既有 menu 选项都指向被删的 tavern → 两条诊断（fail-closed 全可见）
    expect(missing.length).toBe(2);
    expect(missing.map((d) => d.pointer)).toEqual([
      "/columns/0/commands/1/target",
      "/columns/1/commands/1/options/0/target",
    ]);
  });

  it("非法组合零副作用：connectBranch 返回 false 且会话不动", () => {
    const story = makeStory();
    const session = new EditorSession(story);
    const scene = { id: "stage", kind: "scene", elements: [] };
    // 源为 scene（plan null → apply no-op）
    expect(connectBranchViaApi(session, "stage", "tavern")).toBe(false);
    expect(session.story).toBe(story);
    expect(session.undoDepth).toBe(0);
    expect(session.dirty).toBe(false);
    void scene;
  });
});

describe("源码互锁", () => {
  it("节点图：拉线判定走纯函数、提交走宿主 api、边点击选中命令", () => {
    expect(nodeGraphSource).toContain("planBranchInsertion");
    expect(nodeGraphSource).toContain("isBranchTarget");
    expect(nodeGraphSource).toContain("branchPointerToCommand");
    expect(nodeGraphSource).toContain("connect-dot");
    expect(nodeGraphSource).toContain("connectBranch(");
    expect(nodeGraphSource).not.toMatch(/session\.apply/); // 提交在宿主
  });

  it("宿主：connectBranch 走 session.apply 单提交，语义标签可读", () => {
    expect(appSource).toContain("connectBranch(");
    expect(appSource).toMatch(/session\.apply\(`连分支 \$\{fromColumnId\} → \$\{toColumnId\}`/);
  });
});

describe("回归锚定：节点图布局缓存随工程切换归位", () => {
  it("NodeGraph 以 story.id 为挂载 key（换工程必重挂载，位置缓存从新存储键重读）", () => {
    // 病灶：storageKey 是 computed 却只在 onMounted 读一次，停在节点图切工程时
    // 旧 positions 留在内存，松手即写进新 story.id 的键（列 id 重名则串位）。
    // 修法 = 挂载 key 绑 story.id ⇒ 换工程整组件重置（同型风险 ColumnList 已用 watch 规避）。
    expect(appSource).toMatch(/<NodeGraph[^>]*:key="story\.id"/);
  });
});