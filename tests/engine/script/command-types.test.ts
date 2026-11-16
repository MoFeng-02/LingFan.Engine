/**
 * core/script 命令类型机制（core 侧消费者视角，只经包名子路径消费）。
 *
 * 正例构造 + 判别收窄 + envelope 兼容 + 分发/逃生舱/未知 op/闭合联合锚。
 * 运行期校验互锁在 editor 侧（tests/editor/script-payload-lock），本文件
 * 不引 editor——core 消费者不需要也不应该依赖编辑器。
 */
import { describe, expect, it } from "vitest";
import type { StoryCommand } from "@lingfan-engine/core";
import type {
  CommandOf,
  ScriptCommand,
  ScriptOpName,
} from "@lingfan-engine/core/script";
import type { Assignable } from "../../editor/script-payload-lock/harness";

// 未知 op 必须在类型实参处被拒（TS2344）：约束若被删除，此引用变得可编译，
// 抑制指令未使用 ⇒ typecheck 红，锚自证活性。
// @ts-expect-error "nope" 不在内置 op 名集
export type UnknownOpCommand = CommandOf<"nope">;

describe("core/script · 命令类型机制", () => {
  it("正例构造：13 键字面量命令 + op 序列", () => {
    const commands: ScriptCommand[] = [
      { op: "say", text: "你好" },
      { op: "menu", options: [{ text: "前进", target: "next" }] },
      { op: "input", prompt: "名字", store: "player.name" },
      { op: "wait", seconds: 1 },
      { op: "set", key: "player.gold", value: 10 },
      { op: "define", key: "flag", value: true },
      { op: "let", key: "tmp", value: null },
      { op: "local", key: "local.x", value: 1 },
      { op: "if", cond: "{flag}", then: [{ op: "say", text: "真" }] },
      { op: "jump", target: "next" },
      { op: "navigate", path: "chapter2" },
      { op: "call", target: "fn", args: [1, "x"], into: "result" },
      { op: "return", value: 1 },
    ];
    expect(commands.map((c) => c.op)).toEqual([
      "say",
      "menu",
      "input",
      "wait",
      "set",
      "define",
      "let",
      "local",
      "if",
      "jump",
      "navigate",
      "call",
      "return",
    ]);
  });

  it("判别收窄：op 决定可用字段", () => {
    const cmd: ScriptCommand = { op: "say", text: "你好", z: 2000 };
    if (cmd.op === "say") {
      const text: string = cmd.text;
      expect(text).toBe("你好");
    }
  });

  it("envelope 兼容：联合成员可赋给 StoryCommand（开放索引签名）", () => {
    const cmd: CommandOf<"say"> = { op: "say", text: "你好" };
    const envelope: StoryCommand = cmd;
    expect(envelope.op).toBe("say");
  });

  it("闭合联合锚：扩展 op / 未知字段 / 缺必填必须红", () => {
    // @ts-expect-error 扩展 op 不在内置联合（扩展走 extOp 或显式 StoryCommand）
    const ext: ScriptCommand = { op: "demoquest.step", step: 1 };
    // @ts-expect-error say 未知负载字段
    const badField: ScriptCommand = { op: "say", text: "x", typoField: 1 };
    // @ts-expect-error 缺必填 text
    const missing: ScriptCommand = { op: "say" };
    void ext;
    void badField;
    void missing;
  });

  it("分发保持 + 逃生舱锚", () => {
    const distA: Assignable<
      CommandOf<"say" | "jump">,
      CommandOf<"say"> | CommandOf<"jump">
    > = true;
    const distB: Assignable<
      CommandOf<"say"> | CommandOf<"jump">,
      CommandOf<"say" | "jump">
    > = true;
    void distA;
    void distB;
    // @ts-expect-error {op:"say"} 缺 text：全可选负载不得成为逃生舱
    const escape: CommandOf<"return" | "say"> = { op: "say" };
    void escape;
  });

  it("名集锚：13 个字面量全部在 ScriptOpName（少登记一键即编译红）", () => {
    const keys: ScriptOpName[] = [
      "say",
      "menu",
      "input",
      "wait",
      "set",
      "define",
      "let",
      "local",
      "if",
      "jump",
      "navigate",
      "call",
      "return",
    ];
    expect(keys).toHaveLength(13);
  });
});
