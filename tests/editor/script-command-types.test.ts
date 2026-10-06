/**
 * ScriptCommand 判别联合守卫（裸写命令的强类型形态）。
 *
 * 两层把关：
 * - **编译期**（`pnpm typecheck` / vue-tsc 把关）：`@ts-expect-error` 锚定「未知 op /
 *   未知字段 / 缺必填 / 扩展 op 混入」必须报红——停止报红 = 指令本身失效 = 测试红。
 *   判别联合派生自 `OP_SCHEMA_MAP` ⇒ 与 validateCommand 的 unknown-op / unknown-field
 *   编辑期口径同源，把同类错误从编辑期提前到构建期。
 * - **运行期**（vitest）：联合成员可赋给 StoryCommand envelope、builder 产物过
 *   validateCommand、Options 派生的能力面（如 character.textColor）真实可用。
 */
import { describe, expect, it } from "vitest";
import type { StoryCommand } from "@lingfan/engine";
import {
  OP_SCHEMAS,
  validateCommand,
  type CommandOf,
  type ScriptCommand,
  type ScriptValue,
} from "../../packages/editor/src/schema/opSchemas";
import * as script from "../../packages/editor/src/script";
import { SCRIPT_COVERAGE } from "../../packages/editor/src/script";

describe("ScriptCommand · 编译期断言（vue-tsc 把关）", () => {
  it("正例：op 决定字段 + 判别收窄 + envelope 兼容", () => {
    const cmd: ScriptCommand = { op: "say", text: "你好", z: 2000 };
    if (cmd.op === "say") {
      const text: string = cmd.text;
      expect(text).toBe("你好");
    }
    const envelope: StoryCommand = cmd;
    expect(envelope.op).toBe("say");
  });

  it("🔴 未知 op / 未知字段 / 缺必填（@ts-expect-error 锚定——停止报红即失效）", () => {
    // @ts-expect-error op 拼写错 ⇒ 联合无此成员
    const badOp: ScriptCommand = { op: "sayy", text: "x" };
    // @ts-expect-error say 未知负载字段（编辑期 unknown-field 同口径提前到编译期）
    const badField: ScriptCommand = { op: "say", text: "x", typoField: 1 };
    // @ts-expect-error 必填 text 缺失
    const missing: ScriptCommand = { op: "say" };
    void badOp;
    void badField;
    void missing;
  });

  it("🔴 联合闭合：扩展 op 混入被编译期拒绝（逃生舱 = extOp / 显式 envelope 注解）", () => {
    // @ts-expect-error 扩展 op 不在内建联合内
    const ext: ScriptCommand = { op: "demoquest.step", step: 1 };
    void ext;
    const extLoose: StoryCommand = { op: "demoquest.step", step: 1 };
    expect(extLoose.op).toBe("demoquest.step");
    expect(script.extOp("demoquest.step", { step: 1 })).toEqual({
      op: "demoquest.step",
      step: 1,
    });
  });

  it("Options 派生自 schema 的能力面锚定", () => {
    // character.textColor：schema 既有、旧手写 Options 缺失的能力缺口（本批派生修复）
    const char: script.CharacterOptions = { textColor: "#ff0000" };
    expect(char.textColor).toBe("#ff0000");
    // @ts-expect-error notify type 保持作者侧窄联合（schema 为 string）
    const notifyOpts: script.NotifyOptions = { type: "bogus" };
    void notifyOpts;
  });

  it("ScriptValue 标量口径（与 zod Value 同源）", () => {
    const expr: ScriptValue = "+= {20}";
    expect(typeof expr).toBe("string");
    // @ts-expect-error 对象不是标量 Value（同 validateCommand 口径）
    const bad: ScriptValue = { a: 1 };
    void bad;
  });

  it("CommandOf 单 op 形态可用（builder 产物即成员）", () => {
    const paused: CommandOf<"pause"> = script.pause(1);
    expect(paused).toEqual({ op: "pause", seconds: 1 });
    // @ts-expect-error pause 负载只有 seconds——多给字段编译期红
    const bad: CommandOf<"pause"> = { op: "pause", seconds: 1, skipable: true };
    void bad;
    const guarded: CommandOf<"guard"> = script.guard("quest-state");
    expect(guarded.op).toBe("guard");
  });
});

describe("ScriptCommand · 运行期互锁", () => {
  it("🔴 判别联合的派生源 = 词汇层双射面（OP_SCHEMA_MAP 键集 ↔ SCRIPT_COVERAGE op 集）", () => {
    // 联合成员由 OP_SCHEMA_MAP 派生（构造即保证）；此处锁「派生源本身」仍是词汇层全集
    const directOps = new Set(
      Object.values(SCRIPT_COVERAGE).filter((op) => !op.startsWith("$")),
    );
    expect(directOps).toEqual(new Set(Object.keys(OP_SCHEMAS)));
  });

  it("builder 产物（联合成员）过编辑期校验 + envelope 兼容", () => {
    const commands: readonly StoryCommand[] = [
      script.say("欢迎", "灵泛", { z: 2000 }),
      script.bgm("Audio/main.mp3", { volume: 0.4, fade: 1200 }),
      script.set("player.gold", "+= {20}"),
      script.character("灵泛", { name: "灵泛", color: "#7aa2f7" }),
      script.menu(undefined, [script.option("前进", "next")]),
      script.minigame("click3", {
        reward: [script.reward("player.gold", 1)],
      }),
    ];
    for (const cmd of commands) {
      expect(validateCommand(cmd), `${cmd.op} 应过校验`).toEqual([]);
    }
  });

  it("🔴 收窄不放松：错形状产物仍被编辑期校验拒绝（分层各司其职）", () => {
    // 裸对象绕过类型面（envelope 注解）⇒ 编辑期兜底仍在
    const sloppy: StoryCommand = { op: "pause", skipable: true };
    const diagnostics = validateCommand(sloppy);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.code).toBe("missing-required");
  });

  it("🔴 值口径二分：guard args 被运输走 JSON（嵌套合法，同 minigame.config 口径）", () => {
    // 被求值的走 Value（call args / reward / set）；被运输的走 JSON（guard args）——
    // 编辑期 schema 必须与运行期 findJsonValueError（JSON 语义）同口径，不得更严
    const cmd = script.guard("quest-state", {
      args: { required: ["sword", "shield"], state: { step: 2, ring: null } },
    });
    expect(cmd).toEqual({
      op: "guard",
      fn: "quest-state",
      args: { required: ["sword", "shield"], state: { step: 2, ring: null } },
    });
    expect(validateCommand(cmd)).toEqual([]);
    const envelope: StoryCommand = cmd;
    expect(envelope.op).toBe("guard");
  });
});
