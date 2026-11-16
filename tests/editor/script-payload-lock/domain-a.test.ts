/**
 * 域 A 锁：域 A 全部键的 zod 输出 ↔ core 负载双向可赋值 + 键集相等，
 * 加故意错误锚与运行期校验互锁。
 *
 * 三件套缺一不可：可赋值（A/B）对单侧多余字段不敏感，键集（K）补上这一盲区；
 * satisfies 是同一判据在施工面的载体，本文件是测试面的载体。
 * 空负载 op（break/continue）用专用锁：键集判据对 Record<string, never> 不适用。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StoryCommand } from "@lingfan-engine/core";
import type {
  ArrayOpPayload,
  ArrayPopOpPayload,
  ArrayPushOpPayload,
  AssertOpPayload,
  AssignOpPayload,
  AutoSaveOpPayload,
  CallOpPayload,
  CharacterOpPayload,
  CommandOf,
  DictOpPayload,
  DictSetOpPayload,
  EmptyOpPayload,
  ForeachOpPayload,
  ForOpPayload,
  FuncOpPayload,
  GuardOpPayload,
  IfOpPayload,
  InputOpPayload,
  JumpOpPayload,
  LoadOpPayload,
  MenuOpPayload,
  NavigateOpPayload,
  NotifyOpPayload,
  NvlOpPayload,
  PauseOpPayload,
  RandomOpPayload,
  ReturnOpPayload,
  SaveDeleteOpPayload,
  SaveOpPayload,
  SayOpPayload,
  SwitchOpPayload,
  UncharacterOpPayload,
  UndefOpPayload,
  WaitOpPayload,
  WhileOpPayload,
} from "@lingfan-engine/core/script";
import {
  arrayPopSchema,
  arrayPushSchema,
  arraySchema,
  assertSchema,
  assignSchema,
  autoSaveSchema,
  callSchema,
  characterSchema,
  dictSchema,
  dictSetSchema,
  emptySchema,
  foreachSchema,
  forSchema,
  funcSchema,
  guardSchema,
  ifSchema,
  inputSchema,
  jumpSchema,
  loadSchema,
  menuSchema,
  navigateSchema,
  notifySchema,
  nvlSchema,
  pauseSchema,
  randomSchema,
  returnSchema,
  saveDeleteSchema,
  saveSchema,
  saySchema,
  switchSchema,
  uncharacterSchema,
  undefSchema,
  waitSchema,
  whileSchema,
} from "../../../packages/editor/src/schema/opSchemas/commands";
import { validateCommand } from "../../../packages/editor/src/schema/opSchemas";
import * as script from "../../../packages/editor/src/script";
import type { Assignable, SameKeys } from "./harness";

describe("域 A 锁 · 叙事域", () => {
  it("say：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof saySchema>, SayOpPayload> = true;
    const b: Assignable<SayOpPayload, z.infer<typeof saySchema>> = true;
    const k: SameKeys<keyof z.infer<typeof saySchema>, keyof SayOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("menu：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof menuSchema>, MenuOpPayload> = true;
    const b: Assignable<MenuOpPayload, z.infer<typeof menuSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof menuSchema>, keyof MenuOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("input：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof inputSchema>, InputOpPayload> = true;
    const b: Assignable<InputOpPayload, z.infer<typeof inputSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof inputSchema>, keyof InputOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("notify：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof notifySchema>, NotifyOpPayload> = true;
    const b: Assignable<NotifyOpPayload, z.infer<typeof notifySchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof notifySchema>,
      keyof NotifyOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("nvl：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof nvlSchema>, NvlOpPayload> = true;
    const b: Assignable<NvlOpPayload, z.infer<typeof nvlSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof nvlSchema>, keyof NvlOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("character：A/B/K 三件套", () => {
    const a: Assignable<
      z.infer<typeof characterSchema>,
      CharacterOpPayload
    > = true;
    const b: Assignable<
      CharacterOpPayload,
      z.infer<typeof characterSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof characterSchema>,
      keyof CharacterOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("uncharacter：A/B/K 三件套", () => {
    const a: Assignable<
      z.infer<typeof uncharacterSchema>,
      UncharacterOpPayload
    > = true;
    const b: Assignable<
      UncharacterOpPayload,
      z.infer<typeof uncharacterSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof uncharacterSchema>,
      keyof UncharacterOpPayload
    > = true;
    void a;
    void b;
    void k;
  });
});

describe("域 A 锁 · 流程域", () => {
  it("wait：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof waitSchema>, WaitOpPayload> = true;
    const b: Assignable<WaitOpPayload, z.infer<typeof waitSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof waitSchema>, keyof WaitOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("if：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof ifSchema>, IfOpPayload> = true;
    const b: Assignable<IfOpPayload, z.infer<typeof ifSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof ifSchema>, keyof IfOpPayload> = true;
    void a;
    void b;
    void k;
  });

  it("jump：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof jumpSchema>, JumpOpPayload> = true;
    const b: Assignable<JumpOpPayload, z.infer<typeof jumpSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof jumpSchema>, keyof JumpOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("navigate：A/B/K 三件套", () => {
    const a: Assignable<
      z.infer<typeof navigateSchema>,
      NavigateOpPayload
    > = true;
    const b: Assignable<
      NavigateOpPayload,
      z.infer<typeof navigateSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof navigateSchema>,
      keyof NavigateOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("call：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof callSchema>, CallOpPayload> = true;
    const b: Assignable<CallOpPayload, z.infer<typeof callSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof callSchema>, keyof CallOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("return：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof returnSchema>, ReturnOpPayload> = true;
    const b: Assignable<ReturnOpPayload, z.infer<typeof returnSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof returnSchema>,
      keyof ReturnOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("pause：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof pauseSchema>, PauseOpPayload> = true;
    const b: Assignable<PauseOpPayload, z.infer<typeof pauseSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof pauseSchema>, keyof PauseOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("random：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof randomSchema>, RandomOpPayload> = true;
    const b: Assignable<RandomOpPayload, z.infer<typeof randomSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof randomSchema>,
      keyof RandomOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("func：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof funcSchema>, FuncOpPayload> = true;
    const b: Assignable<FuncOpPayload, z.infer<typeof funcSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof funcSchema>, keyof FuncOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("while：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof whileSchema>, WhileOpPayload> = true;
    const b: Assignable<WhileOpPayload, z.infer<typeof whileSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof whileSchema>, keyof WhileOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("assert：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof assertSchema>, AssertOpPayload> = true;
    const b: Assignable<AssertOpPayload, z.infer<typeof assertSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof assertSchema>,
      keyof AssertOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("guard：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof guardSchema>, GuardOpPayload> = true;
    const b: Assignable<GuardOpPayload, z.infer<typeof guardSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof guardSchema>, keyof GuardOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("for：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof forSchema>, ForOpPayload> = true;
    const b: Assignable<ForOpPayload, z.infer<typeof forSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof forSchema>, keyof ForOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("foreach：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof foreachSchema>, ForeachOpPayload> = true;
    const b: Assignable<ForeachOpPayload, z.infer<typeof foreachSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof foreachSchema>,
      keyof ForeachOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("switch：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof switchSchema>, SwitchOpPayload> = true;
    const b: Assignable<SwitchOpPayload, z.infer<typeof switchSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof switchSchema>,
      keyof SwitchOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("break：空负载锁（schema 零字段 + CommandOf 特判双向）", () => {
    // zod v4 空 strictObject 的 infer 带索引签名（keyof 非 never），
    // 零字段判据用「输出可赋给空负载」而非 keyof extends never
    const e: Assignable<z.infer<typeof emptySchema>, EmptyOpPayload> = true;
    const c1: Assignable<CommandOf<"break">, { op: "break" }> = true;
    const c2: Assignable<{ op: "break" }, CommandOf<"break">> = true;
    void e;
    void c1;
    void c2;
  });

  it("continue：空负载锁（schema 零字段 + CommandOf 特判双向）", () => {
    const e: Assignable<z.infer<typeof emptySchema>, EmptyOpPayload> = true;
    const c1: Assignable<CommandOf<"continue">, { op: "continue" }> = true;
    const c2: Assignable<{ op: "continue" }, CommandOf<"continue">> = true;
    void e;
    void c1;
    void c2;
  });
});

describe("域 A 锁 · 变量域（赋值四兄弟共用负载）", () => {
  it("set：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof assignSchema>, AssignOpPayload> = true;
    const b: Assignable<AssignOpPayload, z.infer<typeof assignSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof assignSchema>,
      keyof AssignOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"set">,
      { op: "set" } & AssignOpPayload
    > = true;
    const mapB: Assignable<
      { op: "set" } & AssignOpPayload,
      CommandOf<"set">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("define：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof assignSchema>, AssignOpPayload> = true;
    const b: Assignable<AssignOpPayload, z.infer<typeof assignSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof assignSchema>,
      keyof AssignOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"define">,
      { op: "define" } & AssignOpPayload
    > = true;
    const mapB: Assignable<
      { op: "define" } & AssignOpPayload,
      CommandOf<"define">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("let：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof assignSchema>, AssignOpPayload> = true;
    const b: Assignable<AssignOpPayload, z.infer<typeof assignSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof assignSchema>,
      keyof AssignOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"let">,
      { op: "let" } & AssignOpPayload
    > = true;
    const mapB: Assignable<
      { op: "let" } & AssignOpPayload,
      CommandOf<"let">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("local：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof assignSchema>, AssignOpPayload> = true;
    const b: Assignable<AssignOpPayload, z.infer<typeof assignSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof assignSchema>,
      keyof AssignOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"local">,
      { op: "local" } & AssignOpPayload
    > = true;
    const mapB: Assignable<
      { op: "local" } & AssignOpPayload,
      CommandOf<"local">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("undef：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof undefSchema>, UndefOpPayload> = true;
    const b: Assignable<UndefOpPayload, z.infer<typeof undefSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof undefSchema>, keyof UndefOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("array：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof arraySchema>, ArrayOpPayload> = true;
    const b: Assignable<ArrayOpPayload, z.infer<typeof arraySchema>> = true;
    const k: SameKeys<keyof z.infer<typeof arraySchema>, keyof ArrayOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("array_push：A/B/K 三件套", () => {
    const a: Assignable<
      z.infer<typeof arrayPushSchema>,
      ArrayPushOpPayload
    > = true;
    const b: Assignable<
      ArrayPushOpPayload,
      z.infer<typeof arrayPushSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof arrayPushSchema>,
      keyof ArrayPushOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("array_pop：A/B/K 三件套", () => {
    const a: Assignable<
      z.infer<typeof arrayPopSchema>,
      ArrayPopOpPayload
    > = true;
    const b: Assignable<
      ArrayPopOpPayload,
      z.infer<typeof arrayPopSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof arrayPopSchema>,
      keyof ArrayPopOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("dict：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof dictSchema>, DictOpPayload> = true;
    const b: Assignable<DictOpPayload, z.infer<typeof dictSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof dictSchema>, keyof DictOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("dict_set：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof dictSetSchema>, DictSetOpPayload> = true;
    const b: Assignable<DictSetOpPayload, z.infer<typeof dictSetSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof dictSetSchema>,
      keyof DictSetOpPayload
    > = true;
    void a;
    void b;
    void k;
  });
});

describe("域 A 锁 · 存档域", () => {
  it("save：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof saveSchema>, SaveOpPayload> = true;
    const b: Assignable<SaveOpPayload, z.infer<typeof saveSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof saveSchema>, keyof SaveOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("load：A/B/K 三件套", () => {
    const a: Assignable<z.infer<typeof loadSchema>, LoadOpPayload> = true;
    const b: Assignable<LoadOpPayload, z.infer<typeof loadSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof loadSchema>, keyof LoadOpPayload> =
      true;
    void a;
    void b;
    void k;
  });

  it("auto_save：A/B/K 三件套", () => {
    const a: Assignable<
      z.infer<typeof autoSaveSchema>,
      AutoSaveOpPayload
    > = true;
    const b: Assignable<
      AutoSaveOpPayload,
      z.infer<typeof autoSaveSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof autoSaveSchema>,
      keyof AutoSaveOpPayload
    > = true;
    void a;
    void b;
    void k;
  });

  it("save_delete：A/B/K 三件套", () => {
    const a: Assignable<
      z.infer<typeof saveDeleteSchema>,
      SaveDeleteOpPayload
    > = true;
    const b: Assignable<
      SaveDeleteOpPayload,
      z.infer<typeof saveDeleteSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof saveDeleteSchema>,
      keyof SaveDeleteOpPayload
    > = true;
    void a;
    void b;
    void k;
  });
});

describe("域 A 锁 · 故意错误锚（@ts-expect-error 停止报红即失效）", () => {
  it("缺必填 / 未知字段 / 值类型错", () => {
    // @ts-expect-error say 缺必填 text
    const missing: CommandOf<"say"> = { op: "say" };
    // @ts-expect-error jump 未知负载字段
    const ghost: CommandOf<"jump"> = { op: "jump", target: "x", ghost: 1 };
    // @ts-expect-error wait seconds 必须是 number
    const wrongType: CommandOf<"wait"> = { op: "wait", seconds: "3" };
    void missing;
    void ghost;
    void wrongType;
  });

  it("域 A 补全：缺必填 / 未知字段 / 值类型错 / 空负载多字段 / 形状错", () => {
    // @ts-expect-error notify 缺必填 text
    const missingNotify: CommandOf<"notify"> = { op: "notify" };
    // @ts-expect-error character 缺必填 key
    const missingChar: CommandOf<"character"> = { op: "character" };
    const ghostPause: CommandOf<"pause"> = {
      op: "pause",
      seconds: 1,
      // @ts-expect-error pause 无 ghost 字段
      ghost: 1,
    };
    const wrongEnabled: CommandOf<"auto_save"> = {
      op: "auto_save",
      // @ts-expect-error enabled 必须是 boolean
      enabled: "yes",
    };
    const extraBreak: CommandOf<"break"> = {
      op: "break",
      // @ts-expect-error 空负载不收任何字段
      seconds: 1,
    };
    const badRange: CommandOf<"random"> = {
      op: "random",
      seed: 1,
      // @ts-expect-error range 是二元组，三元必须红
      range: [1, 2, 3],
      var: "d",
    };
    const badCase: CommandOf<"switch"> = {
      op: "switch",
      on: "{state}",
      cases: [
        {
          // @ts-expect-error case value 是 ScriptValue，不含 null
          value: null,
          body: [],
        },
      ],
    };
    const badMode: CommandOf<"nvl"> = {
      op: "nvl",
      // @ts-expect-error mode 只收 enter/auto/clear/exit
      mode: "bogus",
    };
    void missingNotify;
    void missingChar;
    void ghostPause;
    void wrongEnabled;
    void extraBreak;
    void badRange;
    void badCase;
    void badMode;
  });

  it("分发保持：联合入参逐成员分发；全可选负载不得成为逃生舱", () => {
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
    // @ts-expect-error {op:"say"} 缺 text：return 全可选不得让 say 分支免检
    const escape: CommandOf<"return" | "say"> = { op: "say" };
    void escape;
  });
});

describe("域 A 锁 · 运行期互锁", () => {
  it("试点词函数产物全部通过 validateCommand", () => {
    const commands: StoryCommand[] = [
      script.say("欢迎"),
      script.menu(undefined, [script.option("前进", "next")]),
      script.input("名字", "player.name"),
      script.wait(1),
      script.set("player.gold", 10),
      script.define("flag", true),
      script.letVar("tmp", null),
      script.localVar("local.x", 1),
      script.when("{player.gold} > 0", [script.say("有钱")]),
      script.jump("next"),
      script.navigate("chapter2"),
      script.call("fn", [1, "x"], "result"),
      script.ret(1),
    ];
    expect(commands).toHaveLength(13);
    for (const cmd of commands) {
      expect(validateCommand(cmd)).toEqual([]);
    }
  });

  it("undefined 字段不写入：say 最小产物只含 op + text", () => {
    const cmd = script.say("欢迎");
    expect(cmd).toEqual({ op: "say", text: "欢迎" });
    expect("speaker" in cmd).toBe(false);
  });

  it("域 A 补全词函数产物全部通过 validateCommand", () => {
    const commands: StoryCommand[] = [
      script.notify("提示"),
      script.nvl("enter"),
      script.character("alice", { name: "爱丽丝" }),
      script.uncharacter("alice"),
      script.pause(2),
      script.random(42, 1, 6, "dice"),
      script.func("greet", ["name"], [script.say("你好")]),
      script.whileDo("{flag}", [script.say("循环")]),
      script.assert("{player.gold} >= 0", "金币不能为负"),
      script.guard("gold-non-negative", {
        args: { item: "key", nested: { deep: [1, 2] } },
      }),
      script.forIn("i", "{items}", [script.say("项")]),
      script.forEach("v", "{map}", [script.say("值")]),
      script.switchOn(
        "{state}",
        [
          [1, [script.say("一")]],
          ["x", [script.say("叉")]],
        ],
        [script.say("默认")],
      ),
      script.breakLoop(),
      script.continueLoop(),
      script.undef("tmp"),
      script.newArray("inventory", ["sword", null], { once: true }),
      script.arrayPush("inventory", "shield"),
      script.arrayPop("inventory"),
      script.dict("stats", { hp: 100, mp: null }, { once: true }),
      script.dictSet("stats", "hp", 80),
      script.save("slot1", "第一章"),
      script.load("slot1"),
      script.autoSave(true),
      script.saveDelete("slot1"),
    ];
    expect(commands).toHaveLength(25);
    for (const cmd of commands) {
      expect(validateCommand(cmd)).toEqual([]);
    }
  });

  it("空负载产物只含 op；notify 最小产物不写入可选字段", () => {
    expect(script.breakLoop()).toEqual({ op: "break" });
    expect(script.continueLoop()).toEqual({ op: "continue" });
    expect(script.notify("提示")).toEqual({ op: "notify", text: "提示" });
  });

  it("校验器诊断码：missing-required / unknown-field / invalid-value", () => {
    const missing: StoryCommand = { op: "say" };
    const unknown: StoryCommand = { op: "jump", target: "x", ghost: 1 };
    // min(1) 约束失败 → invalid-value（数值/格式约束归校验器，类型面不收窄）
    const invalid: StoryCommand = { op: "menu", options: [] };
    expect(validateCommand(missing)[0]?.code).toBe("missing-required");
    expect(validateCommand(unknown)[0]?.code).toBe("unknown-field");
    expect(validateCommand(invalid)[0]?.code).toBe("invalid-value");
  });
});
