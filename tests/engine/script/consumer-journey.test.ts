/**
 * 消费者旅程（实值形态）：core 侧消费者经 @lingfan-engine/core/script 包名
 * 直接取词函数构造命令，交 parseStory → StoryEngine 执行——全程不经 editor。
 *
 * 通路四判据：① 包名解析（本文件运行期断言）；② 命令字面量经子路径编译
 * （本文件类型面）；③ publish-check 绿（tests/tools 随 test:unit）；
 * ④ typecheck 绿（门禁二）。实值旅程另证：词函数产物就是引擎可执行的命令
 * （构造 → 解析 → 执行 → 状态观察闭环）。
 */
import { describe, expect, it } from "vitest";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";
import type { StoryCommand } from "@lingfan-engine/core";
import * as coreScript from "@lingfan-engine/core/script";
import type { CommandOf, ScriptCommand } from "@lingfan-engine/core/script";

describe("core/script · 消费者旅程", () => {
  it("包名解析：子路径命名空间可在运行期导入", () => {
    expect(coreScript).toBeDefined();
    expect(typeof coreScript).toBe("object");
    expect(typeof coreScript.say).toBe("function");
  });

  it("命令字面量经子路径编译 + 判别收窄消费", () => {
    const commands: ScriptCommand[] = [
      { op: "say", text: "第一句" },
      { op: "wait", seconds: 1 },
      { op: "say", text: "第二句" },
    ];
    const spoken: string[] = [];
    for (const cmd of commands) {
      if (cmd.op === "say") {
        spoken.push(cmd.text);
      }
    }
    expect(spoken).toEqual(["第一句", "第二句"]);
    const single: CommandOf<"say"> = { op: "say", text: "你好" };
    expect(single.text).toBe("你好");
  });

  it("实值旅程：词函数构造 → parseStory → StoryEngine 执行（对白 + 变量）", () => {
    const commands: StoryCommand[] = [
      coreScript.say("第一句", "灵泛"),
      coreScript.set("player.gold", 10),
      coreScript.say("第二句"),
    ];
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "journey",
        columns: [{ id: "start", kind: "flow", commands }],
      }),
    );
    engine.start();
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("第一句");
    expect(engine.get(SYS.currentDialogSpeaker)).toBe("灵泛");

    engine.advance();
    expect(engine.get("player.gold")).toBe(10);
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    expect(engine.get(SYS.currentDialogSpeaker)).toBe("");

    engine.advance();
    expect(engine.get(SYS.waiting)).toBe("none");
  });

  it("实值旅程：jump 跨列跳转（词函数 target 与列 id 同源）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "journey-jump",
        columns: [
          {
            id: "start",
            kind: "flow",
            commands: [coreScript.say("出发"), coreScript.jump("end")],
          },
          { id: "end", kind: "flow", commands: [coreScript.say("到达")] },
        ],
      }),
    );
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("出发");
    engine.advance();
    expect(engine.get(SYS.currentSceneColumn)).toBe("end");
    expect(engine.get(SYS.currentDialogText)).toBe("到达");
  });

  it("实值旅程：when 条件分支（表达式求值 + 块体执行）", () => {
    const commands: StoryCommand[] = [
      coreScript.set("player.gold", 5),
      coreScript.when("{player.gold > 0}", [coreScript.say("富有")]),
      coreScript.say("尾声"),
    ];
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "journey-when",
        columns: [{ id: "start", kind: "flow", commands }],
      }),
    );
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("富有");
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("尾声");
  });
});
