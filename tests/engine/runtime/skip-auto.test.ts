/**
 * skip/auto 玩家功能回归：模式切换、noskip 硬闸门、未读停、守卫与检查点时机。
 *
 * skip/auto 是引擎方法 + 偏好驱动（零新 op）；advanceAutomated 走既有 advance 接缝，
 * 检查点时机不变；noskip 硬闸门只拦自动推进不拦玩家手动；__rollback_active/ui 列让位停模式。
 *
 * 证伪锚：删 noskip 闸门 / 删未读停 / 删守卫，本册对应例转红。
 */
import { describe, expect, it } from "vitest";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

function story() {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: "a",
    columns: [
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "say", text: "一" },
          { op: "say", text: "二", noskip: true },
          { op: "say", text: "三" },
        ],
      },
    ],
  });
}

describe("auto/skip 模式切换（互斥会话态）", () => {
  it("auto 开 → autoActive；skip 开 → 互斥关 auto", () => {
    const engine = new StoryEngine(story(), {});
    engine.start();
    engine.auto(true);
    expect(engine.autoActive()).toBe(true);
    expect(engine.skipActive()).toBe(false);
    engine.skip(true);
    expect(engine.skipActive()).toBe(true);
    expect(engine.autoActive()).toBe(false);
    engine.auto(true);
    expect(engine.autoActive()).toBe(true);
    expect(engine.skipActive()).toBe(false);
    engine.dispose();
  });

  it("关模式归零；回溯清模式", () => {
    const engine = new StoryEngine(story(), {});
    engine.start();
    engine.skip(true);
    engine.skip(false);
    expect(engine.skipActive()).toBe(false);
    engine.advance(); // 建检查点
    engine.auto(true);
    expect(engine.autoActive()).toBe(true);
    engine.back(); // 回溯=会话倒带，清自动模式
    expect(engine.autoActive()).toBe(false);
    engine.dispose();
  });
});

describe("advanceAutomated 推进与守卫", () => {
  it("auto 驱动推进走 advance 接缝并记已读", () => {
    const engine = new StoryEngine(story(), {});
    engine.start();
    engine.auto(true);
    expect(engine.advanceAutomated()).toBe(true);
    expect(engine.isSeen({ columnId: "a", index: 0 })).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("二");
    engine.dispose();
  });

  it("noskip 硬闸门：自动推进停模式，玩家手动仍可推进", () => {
    const engine = new StoryEngine(story(), {});
    engine.start();
    engine.advance(); // 到 noskip 句「二」
    expect(engine.get(SYS.dialogNoskip)).toBe(true);
    engine.skip(true);
    expect(engine.advanceAutomated()).toBe(false);
    expect(engine.skipActive()).toBe(false); // 停模式
    expect(engine.get(SYS.currentDialogText)).toBe("二"); // 未推进
    engine.advance(); // 玩家手动不受 noskip 拦
    expect(engine.get(SYS.currentDialogText)).toBe("三");
    engine.dispose();
  });

  it("未读停：skipUnseenOnly 遇未读 say 停；已读则快进", () => {
    const engine = new StoryEngine(story(), {});
    engine.start();
    engine.skip(true);
    // 当前 say0 未读 → 停
    expect(engine.advanceAutomated({ skipUnseenOnly: true })).toBe(false);
    expect(engine.skipActive()).toBe(false);
    expect(engine.get(SYS.currentDialogText)).toBe("一");
    // 读过 say0（advance 离开记已读）再回到它：已读 → 快进
    engine.advance(); // 离开 say0 记已读，到 say1(noskip)
    engine.back(); // 回到 say0（已读）
    engine.skip(true);
    expect(engine.advanceAutomated({ skipUnseenOnly: true })).toBe(true);
    engine.dispose();
  });

  it("无模式时 advanceAutomated 不推进", () => {
    const engine = new StoryEngine(story(), {});
    engine.start();
    expect(engine.advanceAutomated()).toBe(false);
    expect(engine.get(SYS.currentDialogText)).toBe("一");
    engine.dispose();
  });

  it("检查点时机不变：自动推进与手动推进同样建检查点", () => {
    const auto = new StoryEngine(story(), {});
    auto.start();
    auto.auto(true);
    auto.advanceAutomated();
    const manual = new StoryEngine(story(), {});
    manual.start();
    manual.advance();
    expect(auto.rollbackAvailable()).toBe(manual.rollbackAvailable());
    expect(auto.rollbackAvailable()).toBe(true);
    auto.dispose();
    manual.dispose();
  });
});

describe("ui 列（界面场景）不执行 skip/auto", () => {
  function typedStory() {
    return parseStory({
      formatVersion: 1,
      id: "typed",
      entry: "play",
      columns: [
        {
          id: "play",
          kind: "flow",
          commands: [
            { op: "say", text: "第一步" },
            {
              op: "menu",
              prompt: "去哪",
              options: [{ text: "进菜单", target: "main_menu" }],
            },
          ],
        },
        {
          id: "main_menu",
          kind: "flow",
          type: "ui",
          commands: [{ op: "say", text: "主菜单" }],
        },
      ],
    });
  }

  it("进入 ui 列后自动推进停模式（界面层让位）", () => {
    const engine = new StoryEngine(typedStory(), {});
    engine.start();
    engine.advance(); // 到菜单等待点
    engine.choose("main_menu"); // 进 ui 列
    expect(engine.get(SYS.currentDialogText)).toBe("主菜单");
    engine.auto(true);
    expect(engine.advanceAutomated()).toBe(false);
    expect(engine.autoActive()).toBe(false); // 停模式
    expect(engine.get(SYS.currentDialogText)).toBe("主菜单"); // 未推进
    engine.dispose();
  });
});
