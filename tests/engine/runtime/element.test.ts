/**
 * 元素系统（运行期）测试：声明式空间层的装载 / 列切换 / 快照回溯。
 *
 * 与视频族（`__video` 命令流 + seq）的关键差异：元素是**累积状态**，
 * 快照整体还原即恢复，无需重放重建。
 */
import { describe, expect, it } from "vitest";
import type {
  ElementInstance,
  OutboundEvent,
  SaveDataV1,
} from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

function sceneStory(): unknown {
  return {
    formatVersion: 1,
    id: "demo",
    columns: [
      {
        id: "scene1",
        kind: "scene",
        elements: [
          { type: "image", id: "bg", source: "Images/bg.png" },
          { type: "button", id: "go", text: "出发", nav: "scene2" },
        ],
        entry: [{ op: "say", text: "第一句" }],
      },
      {
        id: "scene2",
        kind: "scene",
        elements: [{ type: "text", text: "第二幕" }],
        entry: [{ op: "say", text: "第二句" }],
      },
      { id: "flow1", kind: "flow", commands: [{ op: "say", text: "流程" }] },
    ],
  };
}

function makeEngine(): { engine: StoryEngine; errors: OutboundEvent[] } {
  const engine = new StoryEngine(parseStory(sceneStory()));
  const errors: OutboundEvent[] = [];
  engine.onEvent((e) => errors.push(e));
  return { engine, errors };
}

function elements(engine: StoryEngine): ElementInstance[] {
  const value = engine.get(SYS.elements);
  return Array.isArray(value) ? (value as ElementInstance[]) : [];
}

describe("进入列装载空间层", () => {
  it("start 后 __elements = 该列声明；entry 照常执行且无 unknown-op", () => {
    const { engine, errors } = makeEngine();
    engine.start();
    expect(elements(engine).map((e) => e.id)).toEqual(["bg", "go"]);
    expect(engine.get(SYS.currentDialogText)).toBe("第一句"); // entry 正常执行
    expect(errors).toHaveLength(0); // 元素是声明，不再撞 unknown-op
    engine.dispose();
  });

  it("列切换整体替换；flow 列 = 空（空间层属于列）", () => {
    const { engine } = makeEngine();
    engine.start();
    engine.navigate("scene2");
    expect(elements(engine).map((e) => e.type)).toEqual(["text"]);
    engine.navigate("flow1");
    expect(elements(engine)).toEqual([]);
    engine.dispose();
  });
});

describe("元素随快照/回溯", () => {
  it("回溯到 scene 列 → 元素随快照还原", () => {
    const { engine } = makeEngine();
    engine.start();
    engine.advance(); // 提交 scene1 检查点
    engine.navigate("scene2");
    expect(elements(engine).map((e) => e.type)).toEqual(["text"]);
    engine.navigate("flow1");
    expect(elements(engine)).toEqual([]);

    engine.back(); // 回溯
    expect(elements(engine).map((e) => e.type)).toEqual(["text"]);

    engine.back();
    expect(elements(engine).map((e) => e.id)).toEqual(["bg", "go"]);
    engine.dispose();
  });

  it("存档往返：元素随档还原（读档重放目标列装载 + 快照还原）", () => {
    const { engine } = makeEngine();
    engine.start(); // 停在 scene1 的 say 等待 = 可存档坐标
    const data = engine.exportSave() as SaveDataV1;
    expect(data).not.toBeNull();

    const target = new StoryEngine(parseStory(sceneStory()));
    target.start();
    target.navigate("flow1");
    expect(elements(target)).toEqual([]); // 先离开 scene 列（空间层已清空）
    expect(target.importSave(data)).toBe(true);
    expect(elements(target).map((e) => e.id)).toEqual(["bg", "go"]);
    target.dispose();
  });
});
