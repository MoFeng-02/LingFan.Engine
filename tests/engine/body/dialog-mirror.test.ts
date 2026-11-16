/**
 * 换画面时的对话镜像清理。
 *
 * 对话镜像（`__current_dialog_text` / `__current_dialog_speaker` /
 * `__current_dialog_color` / `__dialog_complete`）是「上一句上屏内容」的运行期副本。
 * 换了画面它就不该跟过去——否则不等对话的画面（组件身体、纯元素列）会把上一屏
 * 的对话文字重新露出来：那些画面既不重画文本，也没有等待态把对话层压下去。
 *
 * 语义要点：
 * - `jump` 直调进列也要清（`navigate` 早就清了，两条路径必须同结果）
 * - 只清非缺省值：缺省是空串与 `false`，无条件重写会让每次进列都多出状态变更
 * - 回退把旧对话带回来：清理是状态写入，因此天然随快照还原
 */
import { describe, expect, it } from "vitest";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

function makeEngine(columns: object[], entry = "a"): StoryEngine {
  return new StoryEngine(
    parseStory({ formatVersion: 1, id: "t", entry, columns }),
  );
}

/** 一句 say 之后接一条跳转的流程列 */
function sayThenJump(id: string, text: string, target: string): object {
  return {
    id,
    kind: "flow",
    commands: [
      { op: "say", text, speaker: "甲" },
      { op: "jump", target },
    ],
  };
}

/** 组件身体列：不等对话，也不重画文本 */
function bodyColumn(id: string, name: string): object {
  return { id, kind: "scene", body: { name }, entry: [] };
}

function expectMirrorEmpty(engine: StoryEngine): void {
  expect(engine.get(SYS.currentDialogText)).toBe("");
  expect(engine.get(SYS.currentDialogSpeaker)).toBe("");
  expect(engine.get(SYS.currentDialogColor)).toBe("");
  expect(engine.get(SYS.dialogComplete)).toBe(false);
}

describe("换画面 · 对话镜像清理", () => {
  it("jump 到组件身体列：上一句的文字与说话人不跟过去", () => {
    const engine = makeEngine([
      sayThenJump("a", "上一屏的话", "b"),
      bodyColumn("b", "comp"),
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("上一屏的话");

    engine.advance();

    expect(engine.get(SYS.currentSceneColumn)).toBe("b");
    expectMirrorEmpty(engine);
  });

  it("jump 到另一条有 say 的流程列：旧文本先清空，新文本再上屏", () => {
    const engine = makeEngine([
      sayThenJump("a", "第一列的话", "b"),
      {
        id: "b",
        kind: "flow",
        commands: [{ op: "say", text: "第二列的话", speaker: "乙" }],
      },
    ]);
    engine.start();
    engine.advance();

    expect(engine.get(SYS.currentSceneColumn)).toBe("b");
    expect(engine.get(SYS.currentDialogText)).toBe("第二列的话");
    expect(engine.get(SYS.currentDialogSpeaker)).toBe("乙");
  });

  it("jump 到纯元素列：上一句不残留，也不带入说话人颜色", () => {
    const engine = makeEngine([
      {
        id: "a",
        kind: "flow",
        commands: [
          {
            op: "say",
            text: "有颜色的一句话",
            speaker: "丙",
            color: "#ff0000",
          },
          { op: "jump", target: "b" },
        ],
      },
      {
        id: "b",
        kind: "scene",
        elements: [{ type: "text", id: "b-title", text: "元素列" }],
        entry: [],
      },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogColor)).toBe("#ff0000");

    engine.advance();

    expect(engine.get(SYS.currentSceneColumn)).toBe("b");
    expectMirrorEmpty(engine);
  });

  it("回退把旧对话带回来：清理随快照还原", () => {
    const engine = makeEngine([
      sayThenJump("a", "回退要看的那句", "b"),
      bodyColumn("b", "comp"),
    ]);
    engine.start();
    engine.advance();
    expectMirrorEmpty(engine);

    engine.back();

    expect(engine.get(SYS.currentSceneColumn)).toBe("a");
    expect(engine.get(SYS.currentDialogText)).toBe("回退要看的那句");
    expect(engine.get(SYS.currentDialogSpeaker)).toBe("甲");
  });

  it("镜像本来就空时不产生多余的状态变更", () => {
    const engine = makeEngine([
      { id: "a", kind: "flow", commands: [{ op: "jump", target: "b" }] },
      bodyColumn("b", "comp"),
    ]);
    const keys: string[] = [];
    engine.onStateChanged((c) => keys.push(c.key));

    engine.start();

    // 进 b 这一次不该出现任何对话镜像键的写入（空串与 false 已是缺省）
    expect(keys).not.toContain(SYS.currentDialogText);
    expect(keys).not.toContain(SYS.currentDialogSpeaker);
    expect(keys).not.toContain(SYS.currentDialogColor);
    expect(keys).not.toContain(SYS.dialogComplete);
  });
});
